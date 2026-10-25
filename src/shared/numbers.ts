// MODULE: number tokens (real-game pool, scaled to any board size, red numbers never touch) | USED BY: mapgen, lobby, tests
import { rngInt, rngNext, rngShuffle } from './rng';
import type { RngState } from './rng';

/** The 18 tokens of the real game (one per resource tile; the desert gets none). */
export const REAL_NUMBER_POOL: number[] = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

/** The red numbers. The real rules never let two of them touch. */
const HOT = new Set([6, 8]);

/**
 * Bigger boards lean slightly toward the numbers that actually roll. Each weight multiplies that number's
 * share in the real pool. 2/12 drop the most, 3/11 a little, 5/6/8/9 gain a little.
 */
const TILT: Record<number, number> = { 2: 0.65, 3: 0.85, 4: 1, 5: 1.05, 6: 1.1, 8: 1.1, 9: 1.05, 10: 1, 11: 0.85, 12: 0.65 };

/**
 * Number tokens for `count` numbered tiles.
 * Exactly 18 tiles gets the real pool. Any other size splits `count` by the tilted real shares
 * (largest remainder, ties go to the numbers nearer 7), so a small board drops 2/12 first.
 */
export function buildNumberPool(count: number): number[] {
  const n = Math.max(0, Math.floor(count));
  if (n === REAL_NUMBER_POOL.length) return [...REAL_NUMBER_POOL];
  if (n === 0) return [];

  const ids = [...new Set(REAL_NUMBER_POOL)];
  const weight = (id: number) => REAL_NUMBER_POOL.filter(x => x === id).length * (TILT[id] ?? 1);
  const total = ids.reduce((sum, id) => sum + weight(id), 0);

  const rows = ids.map(id => {
    const exact = (weight(id) / total) * n;
    return { id, base: Math.floor(exact), rest: exact - Math.floor(exact) };
  });
  let left = n - rows.reduce((sum, r) => sum + r.base, 0);
  const byRest = [...rows].sort((a, b) =>
    b.rest - a.rest || Math.abs(a.id - 7) - Math.abs(b.id - 7) || a.id - b.id);
  for (let i = 0; left > 0; i = (i + 1) % byRest.length, left--) byRest[i].base++;

  const pool: number[] = [];
  for (const r of rows) for (let i = 0; i < r.base; i++) pool.push(r.id);
  return pool;
}

const AXIAL_DIRS: [number, number][] = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

/** Rule flags and limits for placing tokens. The defaults are today's rules. */
export interface NumberOpts {
  /** 'forbid' (default): 6 and 8 may not touch. 'allow' skips that. */
  hotTouch?: 'forbid' | 'allow';
  /** 'avoid' (default): equal numbers kept apart as a soft goal. 'allow' skips that. */
  equalTouch?: 'avoid' | 'allow';
  /** A group index per cell. Swaps stay inside a group, so each group keeps its tokens (and its pip total). */
  group?: number[];
}

/**
 * Shuffles `pool` over the tiles, then swaps tokens until no two red numbers touch
 * (and, as a softer goal, no two equal numbers touch). Best effort on very dense boards.
 * `cells` are axial coordinates; the result is aligned with `cells`.
 */
export function assignNumbers(cells: { q: number; r: number }[], pool: number[], rng: RngState, opts: NumberOpts = {}): number[] {
  return settleNumbers(cells, rngShuffle(rng, pool), rng, opts);
}

/**
 * Swaps tokens of an already dealt list (changed in place and returned) until the touching rules in `opts` hold.
 * With `opts.group` a token only trades places with a tile of its own group.
 */
export function settleNumbers(cells: { q: number; r: number }[], nums: number[], rng: RngState, opts: NumberOpts = {}): number[] {
  const size = Math.min(cells.length, nums.length);
  if (size < 2) return nums;
  const forbidHot = opts.hotTouch !== 'allow';
  const avoidEqual = opts.equalTouch !== 'allow';

  const at = new Map<string, number>();
  for (let i = 0; i < size; i++) at.set(`${cells[i].q},${cells[i].r}`, i);
  const near: number[][] = [];
  for (let i = 0; i < size; i++) {
    const list: number[] = [];
    for (const [dq, dr] of AXIAL_DIRS) {
      const j = at.get(`${cells[i].q + dq},${cells[i].r + dr}`);
      if (j !== undefined) list.push(j);
    }
    near.push(list);
  }

  const grp = opts.group;
  const members = new Map<number, number[]>();
  if (grp) for (let i = 0; i < size; i++) { const l = members.get(grp[i]); if (l) l.push(i); else members.set(grp[i], [i]); }
  const pickPartner = (i: number): number => {
    if (!grp) return rngInt(rng, size);
    const own = members.get(grp[i])!;
    return own[rngInt(rng, own.length)];
  };

  const pair = (a: number, b: number) => (forbidHot && HOT.has(a) && HOT.has(b) ? 10 : avoidEqual && a === b ? 1 : 0);
  const cost = (i: number) => {
    let c = 0;
    for (const j of near[i]) c += pair(nums[i], nums[j]);
    return c;
  };

  let total = 0;
  for (let i = 0; i < size; i++) total += cost(i);
  const maxTries = Math.min(600000, size * 150 + 4000);
  for (let t = 0; t < maxTries && total > 0; t++) {
    const i = rngInt(rng, size);
    if (cost(i) === 0) continue;
    // A touching red number moves to a spot that holds a non-red one (a few random draws are enough).
    let j = pickPartner(i);
    for (let k = 0; k < 6 && HOT.has(nums[i]) && HOT.has(nums[j]); k++) j = pickPartner(i);
    if (j === i || nums[i] === nums[j]) continue;
    const before = cost(i) + cost(j);
    [nums[i], nums[j]] = [nums[j], nums[i]];
    const after = cost(i) + cost(j);
    if (after > before) [nums[i], nums[j]] = [nums[j], nums[i]];
    else total += 2 * (after - before);
  }
  return nums;
}

/** Dice pips of a token (6 and 8 = 5 down to 2 and 12 = 1). */
const tokenPips = (n: number): number => (n === 7 ? 0 : 6 - Math.abs(7 - n));

/**
 * Deals tokens by richness: the best pips go to the richest cells, so rich and poor zones form. `richness` is 0..1 per
 * cell (a smooth field, already rank-normalized). `mix` (0..1) adds random jitter to the ranking: 0 gives sharp zones,
 * 1 is close to a plain shuffle. Ties break on the index. The result is aligned with the cells.
 */
export function dealByRichness(richness: number[], pool: number[], mix: number, rng: RngState): number[] {
  const n = richness.length;
  const jitter = Math.max(0, Math.min(1, mix));
  const key = richness.map(v => v + jitter * (rngNext(rng) - 0.5) * 2);
  const cellOrder = key.map((_, i) => i).sort((a, b) => key[b] - key[a] || a - b);
  const tokens = [...pool].sort((a, b) => tokenPips(b) - tokenPips(a) || a - b);
  const out: number[] = new Array(n).fill(0);
  cellOrder.forEach((cell, k) => { out[cell] = tokens[k] ?? 0; });
  return out;
}

/**
 * Deals the pool so every group ends with about the same pip total. Best tokens first, each to the group with the lowest
 * running total that still has a free tile (ties: more free tiles, then the lower group index). Inside a group the tokens
 * are shuffled over its tiles. `groupOf[i]` is the group of cell i; the result is aligned with the cells.
 */
export function dealBalanced(groupOf: number[], groups: number, pool: number[], rng: RngState): number[] {
  const left: number[] = new Array(groups).fill(0);
  for (const g of groupOf) left[g]++;
  const total: number[] = new Array(groups).fill(0);
  const bucket: number[][] = Array.from({ length: groups }, () => []);
  const order = [...pool].sort((a, b) => tokenPips(b) - tokenPips(a) || a - b);
  for (const token of order) {
    let best = -1;
    for (let g = 0; g < groups; g++) {
      if (left[g] === 0) continue;
      if (best < 0 || total[g] < total[best] || (total[g] === total[best] && left[g] > left[best])) best = g;
    }
    if (best < 0) break;
    bucket[best].push(token);
    total[best] += tokenPips(token);
    left[best]--;
  }
  const out: number[] = new Array(groupOf.length).fill(0);
  for (let g = 0; g < groups; g++) {
    const mixed = rngShuffle(rng, bucket[g]);
    let k = 0;
    for (let i = 0; i < groupOf.length; i++) if (groupOf[i] === g) out[i] = mixed[k++];
  }
  return out;
}
