// MODULE: number tokens (real-game pool, scaled to any board size, red numbers never touch) | USED BY: mapgen, lobby, tests
import { rngInt, rngShuffle } from './rng';
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

/**
 * Shuffles `pool` over the tiles, then swaps tokens until no two red numbers touch
 * (and, as a softer goal, no two equal numbers touch). Best effort on very dense boards.
 * `cells` are axial coordinates; the result is aligned with `cells`.
 */
export function assignNumbers(cells: { q: number; r: number }[], pool: number[], rng: RngState): number[] {
  const nums = rngShuffle(rng, pool);
  const size = Math.min(cells.length, nums.length);
  if (size < 2) return nums;

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

  const pair = (a: number, b: number) => (HOT.has(a) && HOT.has(b) ? 10 : a === b ? 1 : 0);
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
    let j = rngInt(rng, size);
    for (let k = 0; k < 6 && HOT.has(nums[i]) && HOT.has(nums[j]); k++) j = rngInt(rng, size);
    if (j === i || nums[i] === nums[j]) continue;
    const before = cost(i) + cost(j);
    [nums[i], nums[j]] = [nums[j], nums[i]];
    const after = cost(i) + cost(j);
    if (after > before) [nums[i], nums[j]] = [nums[j], nums[i]];
    else total += 2 * (after - before);
  }
  return nums;
}
