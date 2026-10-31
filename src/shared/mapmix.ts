// MODULE: island resource mix (terrain fix-up: every landmass of 4 or more tiles gets at least two resource types) | DEPENDS ON: shared/mapoptions, shared/registry, shared/rng | USED BY: shared/index, shared/mapgen
import type { CellInfo } from './mapoptions';
import type { Registry } from './registry';
import { rngInt } from './rng';
import type { RngState } from './rng';

/** Smallest landmass that must hold two resource types. Smaller islets may be anything. */
export const MIX_MIN_ISLAND = 4;

/**
 * Terrain is dealt over the whole map, so a small island can end up with one resource only (Map Generation Design,
 * section 6.8, islands). This fixes it by swapping tile types between landmasses: the tile counts never change, only
 * where they sit. A swap is only made when the island that gives a tile away keeps two resource types too.
 *
 * `cells` and `types` are aligned (land cells in canvas order, the terrain stage's output). Returns a new array.
 * Tiles that produce nothing (desert) do not count as a resource type. Stops after three passes, so an island that
 * cannot be fixed (no other island has a different resource to spare) stays as it is and keeps its warning.
 */
export function mixIslands(reg: Registry, cells: readonly CellInfo[], types: readonly string[], rng: RngState): string[] {
  const out = [...types];
  const kindOf = (t: string): string | null => reg.tiles.get(t)?.produces ?? null;

  const members = new Map<number, number[]>();
  cells.forEach((c, i) => {
    const list = members.get(c.landmass);
    if (list) list.push(i);
    else members.set(c.landmass, [i]);
  });
  if (members.size < 2) return out;

  const kindsOf = (ids: readonly number[]): Set<string> => {
    const kinds = new Set<string>();
    for (const i of ids) {
      const k = kindOf(out[i]);
      if (k) kinds.add(k);
    }
    return kinds;
  };

  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (const [m, ids] of members) {
      if (ids.length < MIX_MIN_ISLAND) continue;
      const kinds = kindsOf(ids);
      if (kinds.size >= 2) continue;
      const only = [...kinds][0] ?? null;

      // The island swaps one of its tiles (a) for a tile (b) of another resource from some other landmass.
      const a = ids[rngInt(rng, ids.length)];
      const donors: number[] = [];
      for (const [m2, ids2] of members) {
        if (m2 === m) continue;
        for (const b of ids2) {
          const kb = kindOf(out[b]);
          if (!kb || kb === only) continue;
          if (ids2.length >= MIX_MIN_ISLAND) {
            // The donor receives `a`'s tile in b's place and must still hold two resource types.
            const after = new Set<string>();
            for (const j of ids2) {
              const k = kindOf(j === b ? out[a] : out[j]);
              if (k) after.add(k);
            }
            if (after.size < 2) continue;
          }
          donors.push(b);
        }
      }
      if (donors.length === 0) continue;
      const b = donors[rngInt(rng, donors.length)];
      const keep = out[a];
      out[a] = out[b];
      out[b] = keep;
      changed = true;
    }
    if (!changed) break;
  }
  return out;
}
