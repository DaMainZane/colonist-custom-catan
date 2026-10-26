import { describe, expect, it } from 'vitest';
import { GEN_VERSION, buildTopology, countPinches, createRng, generateMap, mixIslands, validateBoard } from '../src/shared';
import type { Board, CellInfo, HexInit } from '../src/shared';
import { defaultSettings, fullRules, registry } from '../src/server/runtime';

// Finishing pass after M6: the `island_mix` perk (every island of 4+ tiles gets two resources), the ring's 2-tile band
// check, and GEN_VERSION 2.

const kindOf = (t: string) => registry.tiles.get(t)?.produces ?? null;
const kindsIn = (types: string[], ids: number[]) => new Set(ids.map(i => kindOf(types[i])).filter(Boolean));
const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);

/** Land cells in canvas order, each tagged with its landmass. */
const cellsOf = (landmasses: number[]): CellInfo[] =>
  landmasses.map((landmass, i) => ({ q: i, r: 0, h: 0, m: 0, coastDist: 0, landmass }));

describe('GEN_VERSION', () => {
  it('is 5 (hexagon ports follow the real board layout, other shapes keep the general rule; the M3 shapes and add-ons came before)', () => {
    expect(GEN_VERSION).toBe(5);
  });
});

describe('mixIslands', () => {
  it('gives a one-resource island a second resource and keeps every tile count', () => {
    const types = ['wood', 'wood', 'wood', 'wood', 'ore', 'ore', 'brick', 'brick', 'sheep', 'wheat'];
    const cells = cellsOf([0, 0, 0, 0, 1, 1, 1, 1, 1, 1]);
    const out = mixIslands(registry, cells, types, createRng('mix1'));
    expect([...out].sort()).toEqual([...types].sort());
    expect(kindsIn(out, range(0, 4)).size).toBeGreaterThanOrEqual(2);
    expect(kindsIn(out, range(4, 10)).size).toBeGreaterThanOrEqual(2);
  });

  it('is deterministic for the same stream', () => {
    const types = ['wood', 'wood', 'wood', 'wood', 'ore', 'ore', 'brick', 'brick', 'sheep', 'wheat'];
    const cells = cellsOf([0, 0, 0, 0, 1, 1, 1, 1, 1, 1]);
    expect(mixIslands(registry, cells, types, createRng('same'))).toEqual(mixIslands(registry, cells, types, createRng('same')));
  });

  it('leaves an island alone when no other island has a different resource to give', () => {
    const types = ['wood', 'wood', 'wood', 'wood', 'wood', 'wood', 'wood', 'wood', 'wood', 'desert'];
    const cells = cellsOf([0, 0, 0, 0, 1, 1, 1, 1, 1, 1]);
    expect(mixIslands(registry, cells, types, createRng('stuck'))).toEqual(types);
  });

  it('never takes the only other resource of another big island', () => {
    // Island 1 has a single ore. Taking it would leave island 1 with wood only, so nothing moves.
    const types = ['wood', 'wood', 'wood', 'wood', 'wood', 'wood', 'wood', 'ore'];
    const cells = cellsOf([0, 0, 0, 0, 1, 1, 1, 1]);
    expect(mixIslands(registry, cells, types, createRng('keep'))).toEqual(types);
  });

  it('ignores islets under 4 tiles and a map with one landmass', () => {
    const small = ['wood', 'wood', 'wood', 'ore', 'brick', 'sheep', 'wheat'];
    expect(mixIslands(registry, cellsOf([0, 0, 0, 1, 1, 1, 1]), small, createRng('s'))).toEqual(small);
    expect(mixIslands(registry, cellsOf([0, 0, 0, 0]), ['wood', 'wood', 'wood', 'wood'], createRng('o'))).toEqual(['wood', 'wood', 'wood', 'wood']);
  });
});

describe('the island_mix perk', () => {
  const rulesAt = (radius: number, over: Record<string, any> = {}) => ({ ...fullRules({ ...defaultSettings(), ...over }), boardRadius: radius });
  const make = (picks: string[], radius: number, seed: string, over: Record<string, any> = {}) =>
    generateMap(registry, rulesAt(radius, over), { seed, radius, picks });
  const seeds = (n: number) => Array.from({ length: n }, (_, i) => `MIX${i + 1}`);
  const lonely = (m: ReturnType<typeof make>) => m.report.warnings.filter(w => w.code === 'one-resource-island').length;

  it('is a free perk that only switches the flag on', () => {
    const perk = registry.mapPerks.get('island_mix');
    expect(perk?.stage).toBe('extras');
    expect(perk?.slot).toBeUndefined();
    expect(perk?.ruleOverrides?.islandMix).toBe(true);
  });

  it('keeps the land, the tile counts and never adds a one-resource island', () => {
    let without = 0;
    let withMix = 0;
    for (const shape of ['islands', 'archipelago']) {
      for (const seed of seeds(12)) {
        const plain = make([shape, 'clustered'], 8, seed);
        const mixed = make([shape, 'clustered', 'island_mix'], 8, seed);
        const label = `${shape} ${seed}`;
        expect(mixed.board.hexes.map(h => h.type === 'water'), label).toEqual(plain.board.hexes.map(h => h.type === 'water'));
        expect(mixed.board.hexes.map(h => h.type).sort(), label).toEqual(plain.board.hexes.map(h => h.type).sort());
        expect(lonely(mixed), label).toBeLessThanOrEqual(lonely(plain));
        without += lonely(plain);
        withMix += lonely(mixed);
      }
    }
    expect(withMix).toBeLessThanOrEqual(without);
  });

  it('is deterministic', () => {
    const sig = (b: Board) => b.hexes.map(h => `${h.q},${h.r}:${h.type}:${h.number}`).join('|');
    expect(sig(make(['islands', 'island_mix'], 7, 'DET').board)).toBe(sig(make(['islands', 'island_mix'], 7, 'DET').board));
  });

  it('cannot help when the whole map has one resource, and says so', () => {
    const r = rulesAt(5);
    const onlyWood = { tileCounts: { ...r.tileCounts, desert: 1, wood: 200 } };
    let checked = 0;
    for (const seed of seeds(5)) {
      const m = generateMap(registry, { ...r, ...onlyWood }, { seed, radius: 5, picks: ['islands', 'island_mix'] });
      if (m.report.stats.landmasses.length < 2) continue;
      checked++;
      expect(m.report.warnings.some(w => w.code === 'one-resource-island'), seed).toBe(true);
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('the ring band check', () => {
  const isLand = (t: string) => t !== 'water';
  function handBoard(radius: number, land: (q: number, r: number) => boolean) {
    const inits: HexInit[] = [];
    for (let q = -radius; q <= radius; q++) {
      for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
        inits.push({ q, r, type: land(q, r) ? 'wood' : 'water', number: null });
      }
    }
    return buildTopology(inits, { isLand });
  }
  const dist = (q: number, r: number) => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
  const band = (lo: number, hi: number) => (q: number, r: number) => dist(q, r) >= lo && dist(q, r) <= hi;

  it('a ring one tile wide is pinched everywhere, a ring two tiles wide nowhere', () => {
    const thin = validateBoard(handBoard(4, band(3, 3)), registry, { checkNecks: true });
    const wide = validateBoard(handBoard(4, band(2, 3)), registry, { checkNecks: true });
    expect(thin.warnings.some(w => w.code === 'thin-neck')).toBe(true);
    expect(wide.warnings.some(w => w.code === 'thin-neck')).toBe(false);
    // Only asked for when the shape needs it.
    expect(validateBoard(handBoard(4, band(3, 3)), registry).warnings.some(w => w.code === 'thin-neck')).toBe(false);
  });

  it('countPinches counts the tiles of a 1-wide line', () => {
    // A straight line of 5 cells on a radius 3 canvas: the 3 inner cells are pinched, the two ends are not.
    const board = handBoard(3, (q, r) => r === 0 && q >= -2 && q <= 2);
    const land = board.hexes.map(h => isLand(h.type));
    const at = new Map<string, number>();
    board.hexes.forEach((h, i) => at.set(`${h.q},${h.r}`, i));
    const dirs: [number, number][] = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    const ring = (i: number) => dirs.map(([dq, dr]) => at.get(`${board.hexes[i].q + dq},${board.hexes[i].r + dr}`) ?? -1);
    expect(countPinches(board.hexes.length, i => land[i], ring)).toBe(3);
  });

  it('generated rings from radius 4 up are almost never pinched', () => {
    let pinched = 0;
    let total = 0;
    for (const radius of [4, 5, 6, 8]) {
      for (let i = 0; i < 10; i++) {
        const m = generateMap(registry, { ...fullRules(defaultSettings()), boardRadius: radius }, { seed: `RING${radius}-${i}`, radius, picks: ['ring'] });
        total++;
        if (m.report.warnings.some(w => w.code === 'thin-neck')) pinched++;
        expect(m.report.stats.landmasses.length, `r${radius} ${i}`).toBe(1);
      }
    }
    expect(pinched).toBeLessThanOrEqual(Math.floor(total * 0.1));
  });
});
