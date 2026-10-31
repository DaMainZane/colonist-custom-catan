// MODULE: per-cell data for terrain and number styles (height, moisture, coast distance, landmass) and neighbour lists | DEPENDS ON: shared/mapoptions, shared/mapshape, shared/noise | USED BY: shared/index, shared/mapgen, shared/mapterrain
import type { CellInfo } from './mapoptions';
import { HEX_DIRS } from './mapshape';
import { cellPoint } from './noise';
import type { NoiseFn } from './noise';

/**
 * For each cell, the indices of the cells that touch it, in HEX_DIRS order. Only cells in the list count:
 * a missing neighbour is water or the canvas edge. Works for any cell list (all land, or only the numbered tiles).
 */
export function cellNeighbours(cells: readonly { q: number; r: number }[]): number[][] {
  const at = new Map<number, number>();
  const key = (q: number, r: number) => (q + 1024) * 4096 + (r + 1024);
  cells.forEach((c, i) => at.set(key(c.q, c.r), i));
  return cells.map(c => {
    const out: number[] = [];
    for (const [dq, dr] of HEX_DIRS) {
      const j = at.get(key(c.q + dq, c.r + dr));
      if (j !== undefined) out.push(j);
    }
    return out;
  });
}

/** Values to 0..1 by rank. Ties break on the index, never on engine sort order. One value alone gets 0.5. */
export function rankNormalize(raw: readonly number[]): number[] {
  const n = raw.length;
  const out: number[] = new Array(n).fill(0.5);
  if (n < 2) return out;
  const order = raw.map((_, i) => i).sort((a, b) => raw[a] - raw[b] || a - b);
  order.forEach((idx, rank) => { out[idx] = rank / (n - 1); });
  return out;
}

export interface CellSource {
  radius: number;
  /** Every canvas cell, in canvas order. */
  canvas: readonly { q: number; r: number }[];
  /** 1 = land, by canvas index. */
  land: Uint8Array;
  /** The shape's height by canvas index, or null when the shape drew none (noise is used instead). */
  h: readonly number[] | null;
  /** The terrain stage's noise. */
  noise: NoiseFn;
}

/**
 * Cell data for the land cells, in canvas order (the same order terrain and number styles work in).
 * `h` is the shape's height field when there is one, else noise. `m` is noise plus a coast term (wetter near the sea).
 * Both are rank-normalized over the land cells. Only + - * / and floor are used, so a saved seed stays portable.
 */
export function buildCellInfo(src: CellSource): CellInfo[] {
  const idx: number[] = [];
  src.canvas.forEach((_, i) => { if (src.land[i] === 1) idx.push(i); });
  const cells = idx.map(i => src.canvas[i]);
  const n = cells.length;
  const near = cellNeighbours(cells);

  // Landmasses in discovery order.
  const landmass: number[] = new Array(n).fill(-1);
  let masses = 0;
  for (let s = 0; s < n; s++) {
    if (landmass[s] >= 0) continue;
    landmass[s] = masses;
    const queue = [s];
    for (let k = 0; k < queue.length; k++) {
      for (const j of near[queue[k]]) {
        if (landmass[j] >= 0) continue;
        landmass[j] = masses;
        queue.push(j);
      }
    }
    masses++;
  }

  // A land cell with fewer than six land neighbours touches water or the canvas edge: that is the coast.
  const coastDist: number[] = new Array(n).fill(-1);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (near[i].length < 6) { coastDist[i] = 0; queue.push(i); }
  }
  for (let k = 0; k < queue.length; k++) {
    const c = queue[k];
    for (const j of near[c]) {
      if (coastDist[j] >= 0) continue;
      coastDist[j] = coastDist[c] + 1;
      queue.push(j);
    }
  }
  let maxCoast = 0;
  for (let i = 0; i < n; i++) if (coastDist[i] > maxCoast) maxCoast = coastDist[i];

  // Features about half the canvas wide, like the shape stage.
  const freq = 1 / (0.5 * src.radius + 1.5);
  const hRaw = cells.map((c, k) => {
    if (src.h) return src.h[idx[k]];
    const p = cellPoint(c.q, c.r);
    return src.noise(p.x * freq + 7.1, p.y * freq + 3.7, 3);
  });
  const mRaw = cells.map((c, k) => {
    const p = cellPoint(c.q, c.r);
    return src.noise(p.x * freq + 101.3, p.y * freq + 57.9, 3) + 0.7 * (1 - coastDist[k] / (maxCoast + 1));
  });
  const h = rankNormalize(hRaw);
  const m = rankNormalize(mRaw);

  return cells.map((c, k) => ({ q: c.q, r: c.r, h: h[k], m: m[k], coastDist: coastDist[k], landmass: landmass[k] }));
}
