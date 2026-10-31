// MODULE: terrain placement algorithms (swap energy for spread and clustered, habitat fit for realistic) | DEPENDS ON: shared/mapcells, shared/registry, shared/rng | USED BY: shared/index
import { cellNeighbours } from './mapcells';
import type { Habitat } from './registry';
import { rngInt, rngNext, rngShuffle } from './rng';
import type { RngState } from './rng';

/** Probability of accepting a swap that makes things worse, at the start of the run, for a loss of one pair. */
const START_WARMTH = 0.15;

/**
 * Places the tile multiset so same-type neighbours are rarer (`like = -1`, spread) or more common (`like = 1`, clustered).
 * One algorithm for both: the energy is `-like x (adjacent same-type pairs)`. Start from a plain shuffle, then swap the
 * types of two cells and keep the swap when the pair count moves the right way (or stays equal). A swap that goes the
 * wrong way is kept with a small chance that cools to zero by the last sweep (Metropolis), so patches can escape a
 * dead end. Counts are preserved by construction: it only ever swaps. `sweeps` is the strength, 0 = the plain shuffle.
 *
 * Only `rng`, + - * / and comparisons are used (no exp: the chance of losing `d` pairs is `warmth` multiplied `d` times),
 * so the same seed gives the same board on any engine.
 * `cells` are the land cells (canvas order); the result is one type per cell, aligned with `cells`.
 */
export function swapPlace(cells: readonly { q: number; r: number }[], types: string[], rng: RngState, like: 1 | -1, sweeps: number): string[] {
  const t = rngShuffle(rng, types);
  const n = t.length;
  const rounds = Math.max(0, Math.floor(sweeps));
  if (n < 3 || rounds === 0 || cells.length !== n) return t;

  const near = cellNeighbours(cells);
  const same = (i: number): number => {
    let c = 0;
    for (const j of near[i]) if (t[j] === t[i]) c++;
    return c;
  };

  for (let s = 0; s < rounds; s++) {
    // Linear cooling: uphill steps are possible early and gone in the last sweep.
    const warmth = START_WARMTH * (1 - (s + 1) / rounds);
    for (let k = 0; k < n; k++) {
      const i = rngInt(rng, n);
      let j = rngInt(rng, n);
      // Half of the proposals stay local (a short walk from i), so a patch can actually move.
      if (rngNext(rng) < 0.5) {
        j = i;
        for (let w = 0; w < 2; w++) {
          const around = near[j];
          if (around.length > 0) j = around[rngInt(rng, around.length)];
        }
      }
      if (i === j || t[i] === t[j]) continue;

      // The pair (i, j) itself is a different-type pair before and after the swap, so it never counts.
      const before = same(i) + same(j);
      [t[i], t[j]] = [t[j], t[i]];
      const gain = like * (same(i) + same(j) - before);
      if (gain >= 0) continue;
      let chance = 1;
      for (let d = 0; d < -gain; d++) chance *= warmth;
      if (rngNext(rng) < chance) continue;
      [t[i], t[j]] = [t[j], t[i]];
    }
  }
  return t;
}

/** A tile's habitat only counts when it names a height or a moisture. */
const hasHabitat = (s: Habitat | undefined): s is Habitat => !!s && (s.h !== undefined || s.m !== undefined);

/**
 * Realistic placement: every tile type with a habitat takes the free cells that fit it best, strict types first
 * (`weight` high to low, then the type with fewer tiles, then the id). A cell fits by `|h - target| + |m - target|`
 * over the axes the habitat names. Types without a habitat fill the leftovers in random order. Then `sweeps` rounds of
 * swaps: two cells trade types when that lowers the total weighted misfit. Only types move, so the counts never change.
 * `cells` carry `h` and `m` (rank-normalized, 0..1); the result is one type per cell, aligned with `cells`.
 */
export function habitatPlace(
  cells: readonly { h: number; m: number }[],
  types: string[],
  habitatOf: (type: string) => Habitat | undefined,
  rng: RngState,
  sweeps: number
): string[] {
  const n = types.length;
  if (cells.length !== n) return rngShuffle(rng, types);

  const count = new Map<string, number>();
  for (const t of types) count.set(t, (count.get(t) ?? 0) + 1);
  const kinds = [...count.keys()];
  const weightOf = (t: string) => habitatOf(t)?.weight ?? 1;
  const fitted = kinds.filter(t => hasHabitat(habitatOf(t)));
  const loose = kinds.filter(t => !hasHabitat(habitatOf(t)));
  fitted.sort((a, b) => weightOf(b) - weightOf(a) || count.get(a)! - count.get(b)! || (a < b ? -1 : a > b ? 1 : 0));

  const misfit = (c: number, t: string): number => {
    const s = habitatOf(t);
    if (!hasHabitat(s)) return 0;
    let d = 0;
    if (s.h !== undefined) d += Math.abs(cells[c].h - s.h);
    if (s.m !== undefined) d += Math.abs(cells[c].m - s.m);
    return d;
  };
  const cost = (c: number, t: string) => weightOf(t) * misfit(c, t);

  const out: string[] = new Array(n).fill('');
  const taken = new Uint8Array(n);
  for (const t of fitted) {
    const free: number[] = [];
    for (let c = 0; c < n; c++) if (!taken[c]) free.push(c);
    free.sort((a, b) => misfit(a, t) - misfit(b, t) || a - b);
    for (const c of free.slice(0, count.get(t)!)) { out[c] = t; taken[c] = 1; }
  }
  const leftovers: string[] = [];
  for (const t of loose) for (let i = 0; i < count.get(t)!; i++) leftovers.push(t);
  const mixed = rngShuffle(rng, leftovers);
  let k = 0;
  for (let c = 0; c < n; c++) if (!taken[c]) out[c] = mixed[k++];

  const rounds = Math.max(0, Math.floor(sweeps));
  for (let s = 0; s < rounds; s++) {
    for (let p = 0; p < n; p++) {
      const i = rngInt(rng, n);
      const j = rngInt(rng, n);
      if (i === j || out[i] === out[j]) continue;
      const delta = cost(i, out[j]) + cost(j, out[i]) - cost(i, out[i]) - cost(j, out[j]);
      if (delta < 0) [out[i], out[j]] = [out[j], out[i]];
    }
  }
  return out;
}
