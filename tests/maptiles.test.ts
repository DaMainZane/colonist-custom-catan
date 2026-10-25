import { describe, expect, it } from 'vitest';
import { createRegistry, generateMap, habitatPlace, rngShuffle, swapPlace, createRng, REAL_NUMBER_POOL, settleNumbers } from '../src/shared';
import type { Habitat } from '../src/shared';
import type { Board, CellInfo, Hex, Pack } from '../src/shared';
import { allPacks } from '../src/packs';
import { defaultSettings, fullRules, registry } from '../src/server/runtime';

// M4: terrain styles (spread, clustered, realistic) and number styles. Terrain styles only place the tile
// multiset; the shape and the counts never change with the style.

const rules = () => fullRules(defaultSettings());
const isLandHex = (h: Hex) => !!registry.tiles.get(h.type)?.land;
const make = (picks: string[], radius: number, seed: string, params: Record<string, number> = {}) =>
  generateMap(registry, rules(), { seed, radius, picks, params });
const seeds = (n: number) => Array.from({ length: n }, (_, i) => `T${i + 1}`);
const landKeys = (b: Board) => b.hexes.filter(isLandHex).map(h => `${h.q},${h.r}`).join('|');
const sig = (b: Board) => b.hexes.map(h => `${h.q},${h.r}:${h.type}:${h.number}:${h.ext.hidden ? 1 : 0}`).join('|');
const typeCounts = (b: Board) => {
  const out: Record<string, number> = {};
  for (const h of b.hexes) out[h.type] = (out[h.type] ?? 0) + 1;
  return out;
};

/** Every terrain style the shipped packs register (the tests grow with the registry). */
const TERRAINS = [...registry.mapTerrains.keys()];

/** Adjacent pairs of land hexes with the same type. Three directions, so each pair is counted once. */
function samePairs(b: Board): number {
  const at = new Map(b.hexes.map(h => [`${h.q},${h.r}`, h] as const));
  let n = 0;
  for (const h of b.hexes) {
    if (!isLandHex(h)) continue;
    for (const [dq, dr] of [[1, 0], [0, 1], [-1, 1]]) {
      const o = at.get(`${h.q + dq},${h.r + dr}`);
      if (o && o.type === h.type) n++;
    }
  }
  return n;
}

describe('terrain styles are registered', () => {
  it('random, spread, clustered and realistic share the terrain slot, random is the default', () => {
    for (const id of ['random', 'spread', 'clustered', 'realistic']) {
      expect(registry.mapTerrains.get(id)?.slot).toBe('terrain');
    }
    expect(registry.mapTerrains.get('random')?.default).toBe(true);
    expect(registry.mapTerrains.get('spread')?.default).toBeFalsy();
  });
});

describe('cell info reaches the terrain style', () => {
  const seen: CellInfo[][] = [];
  const probePack: Pack = {
    id: 'probe',
    name: 'Probe',
    deps: ['base'],
    register(api) {
      api.mapTerrain({
        id: 'probe',
        label: 'Probe',
        stage: 'terrain',
        slot: 'terrain',
        place: (cells, types, ctx) => { seen.push(cells.map(c => ({ ...c }))); return rngShuffle(ctx.rng, types); }
      });
    }
  };
  const probe = createRegistry([...allPacks, probePack]);
  const run = (picks: string[], radius: number, seed: string) => {
    seen.length = 0;
    const m = generateMap(probe, rules(), { seed, radius, picks: [...picks, 'probe'] });
    return { m, cells: seen[seen.length - 1] };
  };

  it('one cell per land cell, with h and m in 0..1 spanning the whole range', () => {
    for (const picks of [[], ['continent'], ['islands'], ['continent', 'lake']]) {
      const { m, cells } = run(picks, 5, 'CELLS');
      expect(cells, picks.join('+')).toHaveLength(m.report.stats.land);
      for (const c of cells) {
        expect(c.h).toBeGreaterThanOrEqual(0);
        expect(c.h).toBeLessThanOrEqual(1);
        expect(c.m).toBeGreaterThanOrEqual(0);
        expect(c.m).toBeLessThanOrEqual(1);
      }
      expect(Math.min(...cells.map(c => c.h))).toBe(0);
      expect(Math.max(...cells.map(c => c.h))).toBe(1);
      expect(Math.min(...cells.map(c => c.m))).toBe(0);
      expect(Math.max(...cells.map(c => c.m))).toBe(1);
    }
  });

  it('coastDist is 0 exactly on the coast and counts steps inland', () => {
    // Plain hexagon, radius 2: ring 2 is the coast, ring 1 is one step in, the center is two.
    const { cells } = run([], 2, 'RINGS');
    expect(cells).toHaveLength(19);
    for (const c of cells) {
      const ring = Math.max(Math.abs(c.q), Math.abs(c.r), Math.abs(c.q + c.r));
      expect(c.coastDist, `${c.q},${c.r}`).toBe(2 - ring);
    }
    // A shaped map: the coast is every land cell with fewer than six land neighbours.
    const shaped = run(['continent'], 6, 'COAST');
    const land = new Set(shaped.cells.map(c => `${c.q},${c.r}`));
    for (const c of shaped.cells) {
      let n = 0;
      for (const [dq, dr] of [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]) if (land.has(`${c.q + dq},${c.r + dr}`)) n++;
      if (n < 6) expect(c.coastDist).toBe(0);
      else expect(c.coastDist).toBeGreaterThan(0);
    }
  });

  it('landmass matches the landmasses in the report', () => {
    for (const picks of [['continent'], ['islands'], ['continents'], ['continent', 'satellites']]) {
      const { m, cells } = run(picks, 8, 'MASSES');
      const sizes: number[] = [];
      for (const c of cells) sizes[c.landmass] = (sizes[c.landmass] ?? 0) + 1;
      expect([...sizes].sort((a, b) => a - b), picks.join('+')).toEqual([...m.report.stats.landmasses].sort((a, b) => a - b));
    }
  });

  it('is deterministic', () => {
    const a = run(['continent'], 6, 'SAMEC').cells;
    const b = run(['continent'], 6, 'SAMEC').cells;
    expect(a).toEqual(b);
  });
});

describe('every terrain style keeps the counts and the land', () => {
  const recipes: [string[], number][] = [[[], 2], [['gold'], 3], [['continent'], 5], [['continent', 'lake', 'gold'], 6], [['islands'], 6], [['archipelago', 'fog'], 6]];

  it('same tile counts as the random style, same land set, no invalid-terrain warning', () => {
    for (const style of TERRAINS) {
      for (const [picks, radius] of recipes) {
        for (const seed of seeds(3)) {
          const plain = make(picks, radius, seed);
          const styled = make([...picks, style], radius, seed);
          const label = `${style} ${picks.join('+')} r${radius} ${seed}`;
          expect(typeCounts(styled.board), label).toEqual(typeCounts(plain.board));
          expect(landKeys(styled.board), label).toBe(landKeys(plain.board));
          expect(styled.report.warnings.some(w => w.code === 'terrain-invalid'), label).toBe(false);
        }
      }
    }
  });

  it('is deterministic', () => {
    for (const style of TERRAINS) {
      for (const picks of [[], ['continent'], ['islands']]) {
        const a = make([...picks, style], 5, 'REPLAY');
        const b = make([...picks, style], 5, 'REPLAY');
        expect(sig(a.board), `${style} ${picks.join('+')}`).toBe(sig(b.board));
        expect(a.report).toEqual(b.report);
      }
    }
  });

  it('a different seed gives a different board', () => {
    for (const style of TERRAINS) {
      const sigs = new Set(seeds(4).map(s => sig(make([style], 4, s).board)));
      expect(sigs.size, style).toBeGreaterThan(1);
    }
  });
});

describe('spread and clustered', () => {
  const average = (picks: string[], radius: number) => {
    const list = seeds(10).map(s => samePairs(make(picks, radius, s).board));
    return list.reduce((a, b) => a + b, 0) / list.length;
  };

  it('spread has fewer same-type neighbours than random, clustered has more', () => {
    for (const radius of [4, 6]) {
      const random = average([], radius);
      const spread = average(['spread'], radius);
      const clustered = average(['clustered'], radius);
      expect(spread, `r${radius} spread ${spread} vs random ${random}`).toBeLessThan(random * 0.8);
      expect(clustered, `r${radius} clustered ${clustered} vs random ${random}`).toBeGreaterThan(random * 1.25);
    }
  });

  it('strength 0 is plain random: the same board as the random style', () => {
    for (const style of ['spread', 'clustered']) {
      const plain = make([], 4, 'ZERO');
      const zero = make([style], 4, 'ZERO', { [`${style}.strength`]: 0 });
      expect(sig(zero.board), style).toBe(sig(plain.board));
    }
  });

  it('more sweeps push further', () => {
    const at = (style: string, sweeps: number) => {
      const list = seeds(10).map(s => samePairs(make([style], 5, s, { [`${style}.strength`]: sweeps }).board));
      return list.reduce((a, b) => a + b, 0) / list.length;
    };
    expect(at('spread', 12)).toBeLessThanOrEqual(at('spread', 1));
    expect(at('clustered', 20)).toBeGreaterThanOrEqual(at('clustered', 1));
  });

  it('swapPlace only moves tiles: the multiset never changes', () => {
    const cells = Array.from({ length: 30 }, (_, i) => ({ q: i % 6, r: Math.floor(i / 6) }));
    const types = [...'aaaaaabbbbbbccccccddddddeeeeee'];
    for (const like of [1, -1] as const) {
      for (const sweeps of [0, 1, 5, 30]) {
        const out = swapPlace(cells, types, createRng(`swap${like}${sweeps}`), like, sweeps);
        expect([...out].sort().join('')).toBe([...types].sort().join(''));
      }
    }
  });

  it('the land set and the tokens are untouched by the style', () => {
    const plain = make(['continent'], 6, 'KEEP');
    const styled = make(['continent', 'clustered'], 6, 'KEEP');
    expect(landKeys(styled.board)).toBe(landKeys(plain.board));
    const tokens = (b: Board) => b.hexes.map(h => h.number).filter((n): n is number => n != null).sort((a, b) => a - b);
    expect(tokens(styled.board)).toEqual(tokens(plain.board));
  });
});

describe('realistic terrain', () => {
  it('base tiles and gold carry a habitat, water does not', () => {
    for (const id of ['wood', 'brick', 'sheep', 'wheat', 'ore', 'desert', 'gold']) {
      expect(registry.tiles.get(id)?.habitat, id).toBeDefined();
    }
    expect(registry.tiles.get('water')?.habitat).toBeUndefined();
  });

  it('tiles sit where they fit: high ground high, the dry tile on the driest cells', () => {
    const n = 40;
    // h climbs with the index; m is a permutation of the same range (7 is coprime with 40).
    const cells = Array.from({ length: n }, (_, i) => ({ h: i / (n - 1), m: ((i * 7) % n) / (n - 1) }));
    const habitat: Record<string, Habitat> = { H: { h: 0.9, weight: 2 }, L: { h: 0.1 }, D: { m: 0, weight: 3 } };
    const types = [...'H'.repeat(8), ...'L'.repeat(8), ...'D'.repeat(4), ...'x'.repeat(20)];
    for (const seed of seeds(10)) {
      const out = habitatPlace(cells, types, t => habitat[t], createRng(seed), 3);
      const mean = (kind: string, key: 'h' | 'm') => {
        const at = out.map((t, i) => (t === kind ? cells[i][key] : null)).filter((v): v is number => v !== null);
        return at.reduce((a, b) => a + b, 0) / at.length;
      };
      expect([...out].sort().join(''), seed).toBe([...types].sort().join(''));
      expect(mean('H', 'h') - mean('L', 'h'), seed).toBeGreaterThan(0.5);
      expect(mean('D', 'm'), seed).toBeLessThan(0.15);
    }
  });

  it('zero sweeps still places by habitat, and a tile without one is only shuffled', () => {
    const cells = Array.from({ length: 12 }, (_, i) => ({ h: i / 11, m: 0.5 }));
    const types = [...'HHHH', ...'xxxxxxxx'];
    const out = habitatPlace(cells, types, t => (t === 'H' ? { h: 1 } : undefined), createRng('flat'), 0);
    expect(out.map((t, i) => (t === 'H' ? i : -1)).filter(i => i >= 0)).toEqual([8, 9, 10, 11]);
  });

  it('a size mismatch falls back to a plain shuffle instead of throwing', () => {
    const out = habitatPlace([{ h: 0, m: 0 }], ['a', 'b'], () => undefined, createRng('mismatch'), 3);
    expect([...out].sort()).toEqual(['a', 'b']);
  });
});

// ---- Number styles --------------------------------------------------------------------------------------------------

/** Every number style the shipped packs register (the tests grow with the registry). */
const NUMBERINGS = [...registry.mapNumberings.keys()];
const tokensOf = (b: Board) => b.hexes.map(h => h.number).filter((n): n is number => n != null).sort((a, b) => a - b);
const hotNumber = (h: Hex) => h.number === 6 || h.number === 8;

/** Pairs of touching 6/8 tokens. */
function hotPairs(b: Board): number {
  const at = new Map(b.hexes.map(h => [`${h.q},${h.r}`, h] as const));
  let n = 0;
  for (const h of b.hexes) {
    if (!hotNumber(h)) continue;
    for (const [dq, dr] of [[1, 0], [0, 1], [-1, 1]]) {
      const o = at.get(`${h.q + dq},${h.r + dr}`);
      if (o && hotNumber(o)) n++;
    }
  }
  return n;
}

/** The gap between the best and the worst resource, in pips. */
const pipSpread = (m: ReturnType<typeof make>) => {
  const v = Object.values(m.report.stats.pipsByResource);
  return Math.max(...v) - Math.min(...v);
};

describe('number styles keep the tokens, the tiles and the land', () => {
  const recipes: [string[], number][] = [[[], 2], [['gold'], 3], [['continent'], 5], [['islands', 'fog'], 6]];

  it('same token pool, same tiles, same land set as the standard style', () => {
    for (const style of NUMBERINGS) {
      for (const [picks, radius] of recipes) {
        for (const seed of seeds(3)) {
          const plain = make(picks, radius, seed);
          const styled = make([...picks, style], radius, seed);
          const label = `${style} ${picks.join('+')} r${radius} ${seed}`;
          expect(tokensOf(styled.board), label).toEqual(tokensOf(plain.board));
          expect(styled.board.hexes.map(h => h.type), label).toEqual(plain.board.hexes.map(h => h.type));
          expect(landKeys(styled.board), label).toBe(landKeys(plain.board));
          expect(styled.report.warnings.some(w => w.code === 'numbers-invalid'), label).toBe(false);
          expect(styled.report.errors.some(e => e.code === 'token-mismatch'), label).toBe(false);
        }
      }
    }
  });

  it('is deterministic', () => {
    for (const style of NUMBERINGS) {
      for (const picks of [[], ['continent', 'gold']]) {
        const a = make([...picks, style], 5, 'REPLAY');
        const b = make([...picks, style], 5, 'REPLAY');
        expect(sig(a.board), `${style} ${picks.join('+')}`).toBe(sig(b.board));
        expect(a.report).toEqual(b.report);
      }
    }
  });

  it('a number style does not change the terrain style result', () => {
    for (const style of NUMBERINGS) {
      const a = make(['clustered'], 4, 'ORDER');
      const b = make(['clustered', style], 4, 'ORDER');
      expect(b.board.hexes.map(h => h.type)).toEqual(a.board.hexes.map(h => h.type));
    }
  });
});

describe('no touching 6/8 unless a pick overrides the flag', () => {
  const sunPack: Pack = {
    id: 'sunpack',
    name: 'Sun',
    deps: ['base'],
    register(api) {
      api.mapPerk({ id: 'sun', label: 'Sun', stage: 'extras', ruleOverrides: { hotTouch: 'allow' } });
    }
  };
  const sun = createRegistry([...allPacks, sunPack]);

  it('standard keeps 6 and 8 apart', () => {
    for (const radius of [2, 3, 4]) {
      for (const seed of seeds(15)) {
        const m = make(['standard'], radius, seed);
        expect(hotPairs(m.board), `r${radius} ${seed}`).toBe(0);
        expect(m.report.warnings.some(w => w.code === 'hot-touch'), `r${radius} ${seed}`).toBe(false);
      }
    }
  });

  it('with hotTouch allowed the rule is off: red numbers may touch, and the report does not warn', () => {
    let touching = 0;
    for (const seed of seeds(40)) {
      const m = generateMap(sun, rules(), { seed, radius: 3, picks: ['sun'] });
      touching += hotPairs(m.board);
      expect(m.report.warnings.some(w => w.code === 'hot-touch')).toBe(false);
    }
    // Plain shuffling at this size touches on most boards; none at all over 40 boards means the rule is still on.
    expect(touching).toBeGreaterThan(0);
  });
});

describe('balanced numbers', () => {
  it('gives the resources near-equal pips, closer than standard', () => {
    let balanced = 0;
    let standard = 0;
    let n = 0;
    for (const radius of [2, 3, 4]) {
      for (const seed of seeds(10)) {
        const b = make(['balanced'], radius, seed);
        expect(pipSpread(b), `balanced r${radius} ${seed}`).toBeLessThanOrEqual(6);
        balanced += pipSpread(b);
        standard += pipSpread(make([], radius, seed));
        n++;
      }
    }
    expect(balanced / n, `balanced ${balanced / n} vs standard ${standard / n}`).toBeLessThan(standard / n);
  });

  it('is balanced on shaped maps too', () => {
    for (const picks of [['continent'], ['islands'], ['continent', 'lake']]) {
      for (const seed of seeds(5)) {
        const m = make([...picks, 'balanced'], 6, seed);
        expect(pipSpread(m), `${picks.join('+')} ${seed}`).toBeLessThanOrEqual(8);
      }
    }
  });

  it('mostly keeps 6 and 8 apart (swaps stay inside a resource, so it is best effort)', () => {
    let bad = 0;
    let total = 0;
    for (const radius of [2, 3, 4]) {
      for (const seed of seeds(15)) {
        total++;
        if (hotPairs(make(['balanced'], radius, seed).board) > 0) bad++;
      }
    }
    expect(bad / total, `${bad} of ${total} boards had touching reds`).toBeLessThanOrEqual(0.25);
  });

  it('gold is its own group', () => {
    const m = make(['gold', 'balanced'], 4, 'GOLD');
    expect(m.report.errors.some(e => e.code === 'token-mismatch')).toBe(false);
    expect(m.board.hexes.some(h => h.type === 'gold' && h.number != null)).toBe(true);
  });
});

const pipsOfToken = (n: number) => 6 - Math.abs(7 - n);

/** Average pip difference between touching numbered tiles (low = rich and poor tiles sit in zones). */
function neighbourPipGap(b: Board): number {
  const at = new Map(b.hexes.map(h => [`${h.q},${h.r}`, h] as const));
  let sum = 0;
  let n = 0;
  for (const h of b.hexes) {
    if (h.number == null) continue;
    for (const [dq, dr] of [[1, 0], [0, 1], [-1, 1]]) {
      const o = at.get(`${h.q + dq},${h.r + dr}`);
      if (o && o.number != null) { sum += Math.abs(pipsOfToken(h.number) - pipsOfToken(o.number)); n++; }
    }
  }
  return n > 0 ? sum / n : 0;
}

describe('feast or famine numbers', () => {
  const gap = (picks: string[], params: Record<string, number> = {}) => {
    const list = seeds(10).map(s => neighbourPipGap(make(picks, 5, s, params).board));
    return list.reduce((a, b) => a + b, 0) / list.length;
  };

  it('declares that red numbers may touch', () => {
    expect(registry.mapNumberings.get('feast_famine')?.ruleOverrides?.hotTouch).toBe('allow');
    expect(registry.mapNumberings.get('feast_famine')?.slot).toBe('numbers');
  });

  it('forms zones: touching tiles are closer in pips than with standard numbers', () => {
    const standard = gap([]);
    const zoned = gap(['feast_famine']);
    expect(zoned, `feast_famine ${zoned} vs standard ${standard}`).toBeLessThan(standard * 0.85);
  });

  it('soft edges: a higher mix is closer to random', () => {
    const sharp = gap(['feast_famine'], { 'feast_famine.mix': 0 });
    const soft = gap(['feast_famine'], { 'feast_famine.mix': 100 });
    expect(sharp, `mix 0 ${sharp} vs mix 100 ${soft}`).toBeLessThan(soft);
  });

  it('red numbers do touch on some boards, and the report does not warn about it', () => {
    let touching = 0;
    for (const seed of seeds(30)) {
      const m = make(['feast_famine'], 4, seed);
      touching += hotPairs(m.board);
      expect(m.report.warnings.some(w => w.code === 'hot-touch')).toBe(false);
    }
    expect(touching).toBeGreaterThan(0);
  });
});

describe('settleNumbers with groups', () => {
  it('swaps only inside a group, so every group keeps its tokens', () => {
    const cells: { q: number; r: number }[] = [];
    for (let q = -2; q <= 2; q++) {
      for (let r = Math.max(-2, -q - 2); r <= Math.min(2, -q + 2); r++) if (q !== 0 || r !== 0) cells.push({ q, r });
    }
    const group = cells.map((_, i) => i % 3);
    for (const seed of seeds(20)) {
      const nums = rngShuffle(createRng(seed), REAL_NUMBER_POOL);
      const before = [0, 1, 2].map(g => nums.filter((_, i) => group[i] === g).sort((a, b) => a - b).join(','));
      const out = settleNumbers(cells, [...nums], createRng(`${seed}x`), { group });
      const after = [0, 1, 2].map(g => out.filter((_, i) => group[i] === g).sort((a, b) => a - b).join(','));
      expect(after, seed).toEqual(before);
    }
  });
});
