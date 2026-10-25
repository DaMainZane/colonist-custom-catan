// MODULE: board generator (staged pipeline: shape, terrain, numbers, extras, ports; plus the old generateBoard) driven by the registry | USED BY: engine createGame, lobby preview, tests
import type { Registry } from './registry';
import { createNoise } from './noise';
import { assignNumbers, buildNumberPool } from './numbers';
import { rngNext, rngShuffle } from './rng';
import type { RngState } from './rng';
import { buildTopology } from './topology';
import type { HexInit } from './topology';
import type { Board, Rules } from './types';
import { makeRecipe, stageRng } from './maprecipe';
import type { MapRecipe, MapStage } from './maprecipe';
import { effectiveFlags, paramOf, resolveMapOptions, resolveParams } from './mapoptions';
import type { DropReason, MapCtx, NumbersDef, PerkDef, ShapeOpDef, TerrainDef } from './mapoptions';
import { validateBoard } from './mapcheck';
import type { MapIssue, MapReport } from './mapcheck';
import { canvasCoords, runShape } from './mapshape';

function clampInt(val: any, min: number, max: number, fallback: number): number {
  const n = Number(val);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

/**
 * The tile multiset for `total` land cells: special tiles first (always keep at least one base tile),
 * then base tiles cyclically. Unshuffled. Terrain styles only decide where each tile goes, never how many.
 */
function tileMultiset(reg: Registry, total: number, counts: Record<string, number>): string[] {
  const types: string[] = [];
  let budget = Math.max(0, total - 1);
  for (const [id, want] of Object.entries(counts)) {
    if (!reg.tiles.has(id)) continue;
    const n = Math.max(0, Math.min(Math.floor(Number(want) || 0), budget));
    for (let i = 0; i < n; i++) types.push(id);
    budget -= n;
  }
  const baseIds = [...reg.tiles.values()].filter(t => t.base).map(t => t.id);
  if (baseIds.length === 0) throw new Error('No base tiles registered (tile.base = true)');
  for (let i = 0; types.length < total; i++) types.push(baseIds[i % baseIds.length]);
  return types;
}

function portPool(reg: Registry): string[] {
  const pool: string[] = [];
  for (const p of reg.ports.values()) {
    for (let i = 0; i < (p.copies ?? 1); i++) pool.push(p.id);
  }
  return pool;
}

/**
 * The old entry point, driven by a preset id. Still used by `createGame` (sims, tests) and the legacy
 * Archipelago chip. The lobby builds its map through `generateMap` and recipes instead.
 */
export function generateBoard(reg: Registry, rules: Rules, rng: RngState, presetId = 'standard'): Board {
  const preset = reg.presets.get(presetId) ?? reg.presets.get('standard');
  const radius = clampInt(rules.boardRadius, 1, 50, 2);
  const isLand = (t: string) => !!reg.tiles.get(t)?.land;

  const coords = canvasCoords(radius);
  const total = coords.length;

  if (preset?.blank) {
    return buildTopology(coords.map(c => ({ q: c.q, r: c.r, type: 'water', number: null })), { isLand });
  }

  const counts: Record<string, number> = { ...rules.tileCounts, ...(preset?.tileCounts ? preset.tileCounts(rules, total) : {}) };
  const shuffledTypes = rngShuffle(rng, tileMultiset(reg, total, counts));
  const baseIds = [...reg.tiles.values()].filter(t => t.base).map(t => t.id);

  // Final tile types first (water chance may turn some into ocean), so the number pool matches the real count
  // of numbered tiles. Before, the pool was sized by every hex, which handed out extra 2s on the standard board.
  const finalTypes = coords.map((c, idx) => {
    const type = shuffledTypes[idx] || baseIds[0];
    if (preset?.waterChance && rngNext(rng) < preset.waterChance && (c.q !== 0 || c.r !== 0)) return 'water';
    return type;
  });
  const numberedIdx: number[] = [];
  finalTypes.forEach((type, idx) => {
    const def = reg.tiles.get(type);
    if (def && def.land && def.numbered) numberedIdx.push(idx);
  });
  const placed = assignNumbers(numberedIdx.map(i => coords[i]), buildNumberPool(numberedIdx.length), rng);
  const numberAt = new Map<number, number>();
  numberedIdx.forEach((idx, k) => numberAt.set(idx, placed[k]));

  const inits: HexInit[] = coords.map((c, idx) => ({
    q: c.q, r: c.r, type: finalTypes[idx], number: numberAt.get(idx) ?? null, ext: {}
  }));

  const extra = preset?.extra ? preset.extra(rules, total) : {};
  for (const hook of reg.hooks.afterMapGenerated) hook(inits, rules, rng, extra);

  return buildTopology(inits, { isLand, autoPorts: rngShuffle(rng, portPool(reg)) });
}

// ---------------------------------------------------------------------------------------------------------
// Staged generator (Map Generation Design). M1 built the classic pipeline, M2 made it registry-driven:
// terrain and number styles and perks come from the registry, picks go through slots and conflicts.
// M3 added the shape stage: ops from the registry decide which canvas cells are land (see mapshape.ts).
// Each stage draws from its own RNG stream (see stageRng).
// ---------------------------------------------------------------------------------------------------------

export interface GeneratedMap {
  board: Board;
  report: MapReport;
  recipe: MapRecipe;
}

const DROP_TEXT: Record<DropReason, string> = {
  unknown: 'is not available',
  unmet: 'needs a feature no pack provides',
  replaced: 'was replaced by a later pick in the same slot',
  conflict: 'conflicts with a later pick'
};

/** Same members, ignoring order (a style may place, never change, the counts). */
function sameMembers<T extends string | number>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  const left = new Map<T, number>();
  for (const x of a) left.set(x, (left.get(x) ?? 0) + 1);
  for (const x of b) {
    const n = left.get(x);
    if (!n) return false;
    left.set(x, n - 1);
  }
  return true;
}

/**
 * Builds a board from a recipe. The same recipe (with the same GEN_VERSION and packs) always gives the same map.
 * `input.radius` defaults to `rules.boardRadius`; an empty seed gets a fresh random one (read it from the result).
 * Never reads the player count (a new bot must not reroll the map).
 * A nonzero count in `rules.tileCounts` (Rules tab) wins over a perk's count for the same tile.
 */
export function generateMap(reg: Registry, rules: Rules, input: Partial<MapRecipe> = {}): GeneratedMap {
  const recipe = makeRecipe({ ...input, radius: input.radius ?? rules.boardRadius });
  const isLand = (t: string) => !!reg.tiles.get(t)?.land;
  const seed = recipe.seed;

  // 1 resolve: picks -> valid options (slots, conflicts, defaults), flags, params.
  const resolved = resolveMapOptions(reg, recipe.picks);
  const flags = effectiveFlags(resolved.options);
  const params = resolveParams(resolved.options, recipe.params);
  const ctxFor = (stage: MapStage): MapCtx => ({
    reg,
    rules,
    radius: recipe.radius,
    rng: stageRng(seed, stage),
    noise: createNoise(`${seed}:${stage}`),
    flags,
    param: (id: string) => paramOf(resolved.options, params, id)
  });
  const warnings: MapIssue[] = resolved.dropped.map(d => ({
    code: 'pick-ignored',
    message: `"${d.id}" ${DROP_TEXT[d.reason]} and was ignored.`
  }));

  // 2 canvas, 3 shape: shape ops decide which canvas cells are land (the plain hexagon is the whole canvas).
  // Terrain, numbers and extras then work on the land cells only; the rest of the canvas stays water.
  const canvas = canvasCoords(recipe.radius);
  const shapeOps = resolved.options.filter((o): o is ShapeOpDef => o.stage === 'shape');
  const shape = runShape({
    radius: recipe.radius,
    ops: shapeOps,
    // Picks like `ragged` or `satellites` clash with the default hexagon; they sit on a continent instead.
    fallbackBase: reg.mapShapes.get('continent') ?? reg.mapShapes.get('hexagon'),
    make: attempt => ({ ...ctxFor('shape'), rng: stageRng(seed, 'shape', attempt), noise: createNoise(`${seed}:shape:${attempt}`) })
  });
  if (shape.fallback) {
    warnings.push({ code: 'shape-fallback', message: 'No shape attempt passed the checks, so the plain hexagon was used. Try another seed or fewer options.' });
  }
  const coords = canvas.filter((_, i) => shape.land[i] === 1);
  const total = coords.length;

  // Counts first: rules.tileCounts, then perks fill in what the Rules tab left at zero.
  const perks = resolved.options.filter((o): o is PerkDef => o.stage === 'extras');
  const countsCtx = ctxFor('extras');
  const counts: Record<string, number> = { ...rules.tileCounts };
  const extra: Record<string, any> = {};
  for (const perk of perks) {
    if (perk.tileCounts) {
      for (const [id, n] of Object.entries(perk.tileCounts(rules, total, countsCtx))) {
        if (!(Number(rules.tileCounts?.[id]) > 0)) counts[id] = n;
      }
    }
    if (perk.extra) Object.assign(extra, perk.extra(rules, total, countsCtx));
  }

  // 4 terrain: the multiset is fixed, the style only places it.
  const multiset = tileMultiset(reg, total, counts);
  const terrain = resolved.options.find((o): o is TerrainDef => o.stage === 'terrain');
  let types = terrain ? terrain.place(coords, multiset, ctxFor('terrain')) : rngShuffle(stageRng(seed, 'terrain'), multiset);
  if (!Array.isArray(types) || !sameMembers(types, multiset)) {
    warnings.push({ code: 'terrain-invalid', message: `Terrain style "${terrain?.id}" changed the tile counts, so plain random placement was used.` });
    types = rngShuffle(stageRng(seed, 'terrain'), multiset);
  }

  // 5 numbers: pool sized by the numbered tiles.
  const numberedIdx: number[] = [];
  types.forEach((type, idx) => {
    const def = reg.tiles.get(type);
    if (def && def.land && def.numbered) numberedIdx.push(idx);
  });
  const numberedCells = numberedIdx.map(i => coords[i]);
  const pool = buildNumberPool(numberedIdx.length);
  const numbering = resolved.options.find((o): o is NumbersDef => o.stage === 'numbers');
  let tokens = numbering ? numbering.place(numberedCells, pool, ctxFor('numbers')) : assignNumbers(numberedCells, pool, stageRng(seed, 'numbers'));
  if (!Array.isArray(tokens) || !sameMembers(tokens, pool)) {
    warnings.push({ code: 'numbers-invalid', message: `Number style "${numbering?.id}" changed the tokens, so the standard placement was used.` });
    tokens = assignNumbers(numberedCells, pool, stageRng(seed, 'numbers'));
  }
  const numberAt = new Map<number, number>();
  numberedIdx.forEach((idx, k) => numberAt.set(idx, tokens[k]));

  // Every canvas cell becomes a hex: land cells take the next type and token, the rest is water.
  let ord = 0;
  const inits: HexInit[] = canvas.map((c, i) => {
    if (shape.land[i] !== 1) return { q: c.q, r: c.r, type: 'water', number: null, ext: shape.river[i] ? { river: true } : {} };
    const idx = ord++;
    return { q: c.q, r: c.r, type: types[idx], number: numberAt.get(idx) ?? null, ext: {} };
  });

  // 6 extras: each active perk, then the hooks that need no menu entry (fog hides tiles here).
  const extrasCtx = ctxFor('extras');
  for (const perk of perks) perk.afterGenerated?.(inits, extrasCtx);
  for (const hook of reg.hooks.afterMapGenerated) hook(inits, rules, extrasCtx.rng, extra);

  // 7 topology and ports, 8 check.
  // Ports: always per landmass along the coast (the plain hexagon too, which gives the real 9 ports on the standard board).
  const portRng = stageRng(seed, 'ports');
  const autoPorts = rngShuffle(portRng, portPool(reg));
  const portOffset = rngNext(portRng);
  const board = buildTopology(inits, { isLand, autoPorts, portMode: 'coast', portOffset });
  const report = validateBoard(board, reg, {
    expectLand: total,
    attempts: shape.attempts,
    rng: stageRng(seed, 'check'),
    hotTouch: flags.hotTouch,
    // Satellite islets are small on purpose.
    minLandmass: shapeOps.some(o => o.id === 'satellites') ? 1 : undefined
  });
  report.warnings.push(...warnings);
  return { board, report, recipe };
}
