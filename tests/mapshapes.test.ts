import { describe, expect, it } from 'vitest';
import { buildTopology, classifyCells, createNoise, createRng, findLandmasses, generateMap, hexDistance } from '../src/shared';
import type { Board, GeneratedMap, Hex, HexInit } from '../src/shared';
import { createLandField, fixCount, isArc, splitSizes } from '../src/shared/mapshape';
import { PORTS_PER_LAND_HEX, portCap } from '../src/shared/topology';
import { defaultSettings, fullRules, registry } from '../src/server/runtime';

// M3: shape ops, exact land counts, landmass rules, per-landmass ports. Generation is heuristic (it retries and may
// fall back to the plain hexagon), so the property tests skip a fallback map and a separate test bounds how often it happens.

const rules = () => fullRules(defaultSettings());
const canvasSize = (r: number) => 3 * r * (r + 1) + 1;
const isLandHex = (h: Hex) => !!registry.tiles.get(h.type)?.land;
const fellBack = (m: GeneratedMap) => m.report.warnings.some(w => w.code === 'shape-fallback');
const landKeys = (b: Board) => b.hexes.filter(isLandHex).map(h => `${h.q},${h.r}`).join('|');
const sig = (b: Board) => b.hexes.map(h => `${h.q},${h.r}:${h.type}:${h.number}:${h.ext.hidden ? 1 : 0}`).join('|');
const seeds = (n: number) => Array.from({ length: n }, (_, i) => `S${i + 1}`);
const make = (picks: string[], radius: number, seed: string, params: Record<string, number> = {}) =>
  generateMap(registry, rules(), { seed, radius, picks, params });

/** Default land density of each base shape, in percent (the same numbers the ops declare). */
const DENSITY: Record<string, number> = { continent: 70, islands: 55, archipelago: 45, continents: 65 };
const RADII = [3, 4, 5, 6, 8];

describe('the plain hexagon is unchanged', () => {
  it('has no water, no shape warnings and the classic port placement', () => {
    const m = make([], 2, 'CLASSIC');
    expect(m.board.hexes).toHaveLength(19);
    expect(m.board.hexes.every(isLandHex)).toBe(true);
    expect(fellBack(m)).toBe(false);
    expect(m.report.stats.vertices).toBe(54);
    expect(m.report.stats.ports).toBe(9);
  });
});

describe('shape registry', () => {
  it('registers the M3 shapes with the right phases', () => {
    const phase = (id: string) => registry.mapShapes.get(id)?.phase;
    for (const id of ['hexagon', 'continent', 'ring', 'islands', 'archipelago', 'continents']) expect(phase(id)).toBe('base');
    expect(phase('lake')).toBe('carve');
    expect(phase('river')).toBe('carve');
    expect(phase('satellites')).toBe('scatter');
    expect(phase('ragged')).toBe('tweak');
  });
});

describe('exact land count and landmasses', () => {
  for (const shape of Object.keys(DENSITY)) {
    it(`${shape}: exact land count at radii ${RADII.join(', ')}`, () => {
      for (const radius of RADII) {
        for (const seed of seeds(6)) {
          const m = make([shape], radius, seed);
          if (fellBack(m)) continue;
          const want = Math.max(7, Math.min(canvasSize(radius), Math.round((canvasSize(radius) * DENSITY[shape]) / 100)));
          expect(m.report.stats.land, `${shape} r${radius} ${seed}`).toBe(want);
          expect(m.board.hexes).toHaveLength(canvasSize(radius));
        }
      }
    });
  }

  it('continent and ring are one landmass', () => {
    for (const shape of ['continent', 'ring']) {
      for (const radius of [4, 5, 6, 8]) {
        for (const seed of seeds(6)) {
          const m = make([shape], radius, seed);
          if (fellBack(m)) continue;
          expect(m.report.stats.landmasses, `${shape} r${radius} ${seed}`).toHaveLength(1);
        }
      }
    }
  });

  it('ring has an enclosed lagoon (a lake)', () => {
    let checked = 0;
    for (const radius of [4, 5, 6]) {
      for (const seed of seeds(6)) {
        const m = make(['ring'], radius, seed);
        if (fellBack(m)) continue;
        expect(m.report.stats.lakes, `ring r${radius} ${seed}`).toBeGreaterThanOrEqual(1);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('islands are at least 6 tiles, archipelago islets at least 3, and one landmass holds a table', () => {
    for (const [shape, min] of [['islands', 6], ['archipelago', 3]] as const) {
      for (const radius of [4, 5, 6, 8]) {
        for (const seed of seeds(6)) {
          const m = make([shape], radius, seed);
          if (fellBack(m)) continue;
          const sizes = m.report.stats.landmasses;
          expect(Math.min(...sizes), `${shape} r${radius} ${seed}`).toBeGreaterThanOrEqual(min);
          expect(Math.max(...sizes)).toBeGreaterThanOrEqual(7);
          expect(m.report.errors.filter(e => e.code === 'too-few-spots' || e.code === 'landmass-too-small')).toEqual([]);
        }
      }
    }
  });

  it('continents keep their water gap and each holds at least 15% of the land', () => {
    for (const radius of [6, 8, 10]) {
      for (const seed of seeds(5)) {
        const m = make(['continents'], radius, seed, { 'continents.gap': 2 });
        if (fellBack(m)) continue;
        const land = findLandmasses(m.board, isLandHex);
        const sizes = m.report.stats.landmasses;
        const total = sizes.reduce((a, b) => a + b, 0);
        for (const s of sizes) expect(s, `r${radius} ${seed}`).toBeGreaterThanOrEqual(Math.floor(total * 0.15));
        // Land of different continents is at least gap + 1 = 3 apart.
        const hexes = m.board.hexes;
        for (let i = 0; i < hexes.length; i++) {
          for (let j = i + 1; j < hexes.length; j++) {
            if (land.landOfHex[i] < 0 || land.landOfHex[j] < 0 || land.landOfHex[i] === land.landOfHex[j]) continue;
            expect(hexDistance(hexes[i], hexes[j]), `r${radius} ${seed}`).toBeGreaterThanOrEqual(3);
          }
        }
      }
    }
  });
});

describe('carve, scatter and tweak ops', () => {
  it('lake: an enclosed lake that never touches the sea, exact land count', () => {
    let checked = 0;
    for (const radius of [3, 4, 5, 6]) {
      for (const seed of seeds(6)) {
        const m = make(['continent', 'lake'], radius, seed);
        if (fellBack(m)) continue;
        checked++;
        const want = Math.round((canvasSize(radius) * 70) / 100);
        expect(m.report.stats.land, `r${radius} ${seed}`).toBe(Math.max(7, want));
        expect(m.report.stats.lakes, `r${radius} ${seed}`).toBeGreaterThanOrEqual(1);
        const kinds = classifyCells(m.board, isLandHex).kind;
        expect(kinds.filter(k => k === 'lake').length).toBeGreaterThanOrEqual(1);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('hexagon + lake: a full hexagon with a hole in the middle', () => {
    const m = make(['lake'], 3, 'HEXLAKE');
    if (fellBack(m)) return;
    expect(m.report.stats.lakes).toBeGreaterThanOrEqual(1);
    expect(m.board.hexes.filter(h => !isLandHex(h)).length).toBeGreaterThanOrEqual(1);
  });

  it('river: carved water inside the land, marked on its hexes, and the land stays in one piece', () => {
    let rivers = 0;
    for (const radius of [4, 5, 6, 8]) {
      for (const seed of seeds(6)) {
        const m = make(['continent', 'river'], radius, seed);
        if (fellBack(m)) continue;
        expect(m.report.stats.landmasses, `r${radius} ${seed}`).toHaveLength(1);
        const river = m.board.hexes.filter(h => h.ext.river);
        for (const h of river) expect(isLandHex(h)).toBe(false);
        if (river.length > 0) rivers++;
      }
    }
    expect(rivers).toBeGreaterThan(0);
  });

  it('satellites: small islets around the mainland, never flagged as too small', () => {
    let seen = 0;
    for (const radius of [5, 6, 8]) {
      for (const seed of seeds(5)) {
        const m = make(['satellites'], radius, seed);
        if (fellBack(m)) continue;
        const sizes = m.report.stats.landmasses;
        expect(sizes.length, `r${radius} ${seed}`).toBeGreaterThan(1);
        expect(Math.max(...sizes)).toBeGreaterThanOrEqual(7);
        expect(m.report.errors.filter(e => e.code === 'landmass-too-small')).toEqual([]);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('ragged alone sits on a continent (the default hexagon conflicts with it)', () => {
    const m = make(['ragged'], 5, 'RAG1');
    if (fellBack(m)) return;
    expect(m.report.stats.land).toBeLessThan(canvasSize(5));
    expect(m.report.stats.landmasses).toHaveLength(1);
  });

  it('a conflicting pick replaces the earlier one and the map still builds', () => {
    const m = make(['islands', 'archipelago', 'lake'], 5, 'CLASH');
    const msgs = m.report.warnings.filter(w => w.code === 'pick-ignored').map(w => w.message).join(' ');
    expect(msgs).toContain('islands');
    expect(msgs).toContain('archipelago');
    expect(m.board.hexes).toHaveLength(canvasSize(5));
  });
});

describe('determinism and stage independence', () => {
  it('the same recipe gives the same map and the same report', () => {
    for (const picks of [['continent'], ['islands', 'satellites'], ['continents'], ['continent', 'lake', 'river']]) {
      const a = make(picks, 6, 'REPLAY');
      const b = make(picks, 6, 'REPLAY');
      expect(sig(a.board), picks.join('+')).toBe(sig(b.board));
      expect(a.report).toEqual(b.report);
    }
  });

  it('ticking a perk keeps the land set', () => {
    for (const perk of ['fog', 'gold']) {
      const plain = make(['continent'], 6, 'KEEPLAND');
      const perked = make(['continent', perk], 6, 'KEEPLAND');
      expect(landKeys(perked.board)).toBe(landKeys(plain.board));
    }
  });

  it('a new seed gives a different shape', () => {
    const a = make(['continent'], 6, 'AAA1');
    const b = make(['continent'], 6, 'BBB2');
    expect(landKeys(a.board)).not.toBe(landKeys(b.board));
  });

  it('tile counts and tokens follow the land count, fog hides land only', () => {
    const m = make(['continent', 'fog'], 6, 'FOGLAND');
    if (fellBack(m)) return;
    const land = m.board.hexes.filter(isLandHex);
    expect(land.filter(h => h.type === 'desert')).toHaveLength(1);
    expect(m.board.hexes.filter(h => h.ext.hidden).every(isLandHex)).toBe(true);
    expect(m.board.hexes.filter(h => !isLandHex(h)).every(h => h.number === null)).toBe(true);
  });
});

describe('ports per landmass', () => {
  const portHexes = (b: Board): Hex[] => {
    const out: Hex[] = [];
    for (const e of b.edges) if (e.port) out.push(b.hexes[e.hexIds[0]]);
    return out;
  };

  it('one port per hex, none on a corner next to a port, on coast edges only', () => {
    for (const picks of [['continent'], ['islands'], ['archipelago'], ['continent', 'lake']]) {
      for (const seed of seeds(4)) {
        const m = make(picks, 6, seed);
        if (fellBack(m)) continue;
        for (const e of m.board.edges) if (e.port) expect(e.hexIds).toHaveLength(1);
        const hexes = portHexes(m.board);
        for (let i = 0; i < hexes.length; i++) {
          for (let j = i + 1; j < hexes.length; j++) {
            expect(hexDistance(hexes[i], hexes[j]), `${picks.join('+')} ${seed}`).toBeGreaterThan(0);
          }
        }
        const portEdges = m.board.edges.filter(e => e.port);
        const portCorners = new Set(portEdges.flatMap(e => [e.v1, e.v2]));
        for (const e of portEdges) {
          for (const [v, partner] of [[e.v1, e.v2], [e.v2, e.v1]]) {
            for (const a of m.board.vertices[v].adjacentVertices) {
              if (a !== partner) expect(portCorners.has(a), `${picks.join('+')} ${seed}`).toBe(false);
            }
          }
        }
      }
    }
  });

  it('every landmass of 6 or more tiles has a port, and islets under 3 tiles have none', () => {
    for (const picks of [['islands'], ['continent', 'satellites'], ['continents']]) {
      for (const seed of seeds(4)) {
        const m = make(picks, 8, seed);
        if (fellBack(m)) continue;
        expect(m.report.warnings.filter(w => w.code === 'no-port'), `${picks.join('+')} ${seed}`).toEqual([]);
        const land = findLandmasses(m.board, isLandHex);
        for (const e of m.board.edges) {
          if (e.port) expect(land.landmassSize[land.landOfHex[e.hexIds[0]]]).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it('about one port per 3.3 coast edges', () => {
    const m = make(['continent'], 8, 'PORTCOUNT');
    if (fellBack(m)) return;
    const coast = m.board.edges.filter(e => e.hexIds.length === 1).length;
    expect(Math.abs(m.report.stats.ports - coast / 3.3)).toBeLessThanOrEqual(3);
  });
});

describe('port caps, port mix and tiles that take no port', () => {
  const EDGE_DIR: [number, number][] = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
  /** The hex a coast edge looks out onto (an edge's outward direction is the angle of its midpoint from the hex centre). */
  const facing = (b: Board, e: Board['edges'][number]) => {
    const h = b.hexes[e.hexIds[0]];
    const mx = (b.vertices[e.v1].x + b.vertices[e.v2].x) / 2 - h.x;
    const my = (b.vertices[e.v1].y + b.vertices[e.v2].y) / 2 - h.y;
    const k = ((Math.round(Math.atan2(my, mx) / (Math.PI / 3)) % 6) + 6) % 6;
    return { q: h.q + EDGE_DIR[k][0], r: h.r + EDGE_DIR[k][1] };
  };
  /** A radius 3 canvas: wood land out to radius 2, then a ring that `ring(q, r)` fills (or leaves as water). */
  const hand = (land: (q: number, r: number) => string, ring: (q: number, r: number) => string, opts: Record<string, any>) => {
    const inits: HexInit[] = [];
    for (let q = -3; q <= 3; q++) {
      for (let r = Math.max(-3, -q - 3); r <= Math.min(3, -q + 3); r++) {
        const dist = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
        inits.push({ q, r, type: dist <= 2 ? land(q, r) : ring(q, r), number: null });
      }
    }
    const autoPorts = ['any', 'wood', 'brick', 'any', 'sheep', 'wheat', 'any', 'ore', 'any', 'wood', 'brick'];
    return buildTopology(inits, { autoPorts, portMode: 'coast', portOffset: 0, ...opts });
  };

  it('a landmass never carries more ports than portCap allows', () => {
    expect(portCap(2)).toBe(0);
    expect(portCap(5)).toBe(1);
    expect(portCap(19)).toBe(9); // the real board: 9 ports on 19 tiles
    expect(PORTS_PER_LAND_HEX).toBeLessThan(0.5);
    for (const picks of [['islands'], ['archipelago'], ['continent', 'satellites'], ['continents']]) {
      for (const radius of [5, 6, 8]) {
        for (const seed of seeds(4)) {
          const m = make(picks, radius, seed);
          if (fellBack(m)) continue;
          const land = findLandmasses(m.board, isLandHex);
          const perMass = new Map<number, number>();
          for (const e of m.board.edges) {
            if (!e.port) continue;
            const id = land.landOfHex[e.hexIds[0]];
            perMass.set(id, (perMass.get(id) ?? 0) + 1);
          }
          for (const [id, n] of perMass) {
            expect(n, `${picks.join('+')} r${radius} ${seed}: landmass of ${land.landmassSize[id]}`).toBeLessThanOrEqual(portCap(land.landmassSize[id]));
          }
        }
      }
    }
  });

  it('the base board keeps its 9 ports and a bigger table keeps the real density with a full mix', () => {
    expect(make([], 2, 'BASE').report.stats.ports).toBe(9);
    for (const radius of [3, 4]) {
      const m = make([], radius, `BIG${radius}`);
      const coast = m.board.edges.filter(e => e.hexIds.length === 1).length;
      expect(Math.abs(m.report.stats.ports - coast / 3.3), `r${radius}`).toBeLessThanOrEqual(2);
      const used = new Set(m.board.edges.filter(e => e.port).map(e => e.port));
      for (const id of registry.ports.keys()) expect(used.has(id), `r${radius} has a ${id} port`).toBe(true);
    }
  });

  it('a land tile marked noPort never carries a port', () => {
    const b = hand((q) => (q >= 1 ? 'rock' : 'wood'), () => 'water', { isLand: (t: string) => t === 'wood' || t === 'rock', portBlocked: (t: string) => t === 'rock' });
    const ports = b.edges.filter(e => e.port);
    expect(ports.length).toBeGreaterThan(0);
    for (const e of ports) expect(b.hexes[e.hexIds[0]].type).toBe('wood');
    // Control: without the rule the rock coast takes ports too.
    const free = hand((q) => (q >= 1 ? 'rock' : 'wood'), () => 'water', { isLand: (t: string) => t === 'wood' || t === 'rock' });
    expect(free.edges.some(e => e.port && free.hexes[e.hexIds[0]].type === 'rock')).toBe(true);
  });

  it('no port faces a non-land tile marked noPort (swamp, ice) but ports still face real sea', () => {
    const opts = { isLand: (t: string) => t === 'wood' };
    const b = hand(() => 'wood', (q) => (q > 0 ? 'swamp' : 'water'), { ...opts, portBlocked: (t: string) => t === 'swamp' });
    const typeAt = (c: { q: number; r: number }) => b.hexes.find(h => h.q === c.q && h.r === c.r)?.type;
    const ports = b.edges.filter(e => e.port);
    expect(ports.length).toBeGreaterThan(0);
    for (const e of ports) expect(typeAt(facing(b, e))).not.toBe('swamp');
    // Control: left alone, the swamp counts as sea and gets ports.
    const free = hand(() => 'wood', (q) => (q > 0 ? 'swamp' : 'water'), opts);
    const freeAt = (c: { q: number; r: number }) => free.hexes.find(h => h.q === c.q && h.r === c.r)?.type;
    expect(free.edges.some(e => e.port && freeAt(facing(free, e)) === 'swamp')).toBe(true);
  });
});

describe('robustness', () => {
  it('never throws, whatever the shape and radius', () => {
    const shapes = ['continent', 'ring', 'islands', 'archipelago', 'continents', 'lake', 'river', 'satellites', 'ragged'];
    for (const shape of shapes) {
      for (const radius of [1, 2, 3, 12]) {
        const m = make([shape], radius, 'EDGE');
        expect(m.board.hexes, `${shape} r${radius}`).toHaveLength(canvasSize(radius));
        expect(m.report.stats.land).toBeGreaterThan(0);
      }
    }
  });

  it('a hard recipe falls back to the plain hexagon and says so', () => {
    const m = make(['islands'], 1, 'TINY');
    // Either a valid shaped map or the fallback, never a broken board.
    expect(m.board.hexes).toHaveLength(7);
    if (fellBack(m)) expect(m.report.stats.land).toBe(7);
  });

  it('the generator rarely falls back on ordinary recipes', () => {
    let total = 0;
    let fallbacks = 0;
    for (const shape of ['continent', 'ring', 'islands', 'archipelago', 'continents']) {
      for (const radius of [4, 5, 6, 8]) {
        for (const seed of seeds(5)) {
          total++;
          if (fellBack(make([shape], radius, seed))) fallbacks++;
        }
      }
    }
    // An empirical bound for the starting values; if this fails, look at the shape that fell back before loosening it.
    expect(fallbacks / total).toBeLessThanOrEqual(0.25);
  });
});

describe('add-ons on every base shape', () => {
  const BASES: string[][] = [[], ['continent'], ['ring'], ['islands'], ['continents']];
  const ADDONS = ['river', 'lake', 'satellites', 'ragged'];
  const label = (picks: string[]) => picks.join('+') || 'hexagon';
  const fallbackNote = (m: GeneratedMap) => m.report.warnings.find(w => w.code === 'shape-fallback');

  it('an add-on is applied, not swapped for the plain hexagon (the reasons are listed when it is)', () => {
    const misses: string[] = [];
    let total = 0;
    for (const base of BASES) {
      for (const addon of ADDONS) {
        // Continents need room for their water gaps, so they are only tried on big boards (small ones fall back by design).
        for (const radius of base[0] === 'continents' ? [6, 8] : [3, 4, 6]) {
          for (const seed of seeds(4)) {
            total++;
            const picks = [...base, addon];
            const fell = fallbackNote(make(picks, radius, seed));
            if (fell) misses.push(`${label(picks)} r${radius} ${seed}: ${fell.message}`);
          }
        }
      }
    }
    // Some combinations clash (a ring and a lake: the later pick wins), so this is a bound, not zero. The message lists the first misses.
    expect(misses.length / total, `${misses.length}/${total} fell back\n${misses.slice(0, 12).join('\n')}`).toBeLessThanOrEqual(0.15);
  });

  it('the default radius 2 board takes a river, a lake or islets without dropping to the hexagon', () => {
    const misses: string[] = [];
    let total = 0;
    for (const addon of ['river', 'lake', 'satellites']) {
      for (const seed of seeds(8)) {
        total++;
        const fell = fallbackNote(make([addon], 2, seed));
        if (fell) misses.push(`${addon} r2 ${seed}: ${fell.message}`);
      }
    }
    expect(misses.length / total, `${misses.length}/${total} fell back\n${misses.slice(0, 12).join('\n')}`).toBeLessThanOrEqual(0.25);
  });

  it('a river on islands or continents is carved into the biggest landmass and keeps every island at its minimum', () => {
    let rivers = 0;
    let tried = 0;
    for (const shape of ['islands', 'continents']) {
      for (const radius of shape === 'continents' ? [6, 8] : [4, 5, 6, 8]) {
        for (const seed of seeds(5)) {
          tried++;
          const m = make([shape, 'river'], radius, seed);
          if (fellBack(m)) continue;
          if (m.board.hexes.some(h => h.ext.river)) rivers++;
          const sizes = m.report.stats.landmasses;
          expect(Math.min(...sizes), `${shape} r${radius} ${seed}`).toBeGreaterThanOrEqual(shape === 'islands' ? 6 : 3);
        }
      }
    }
    expect(rivers / tried, `${rivers}/${tried} maps got a river`).toBeGreaterThanOrEqual(0.7);
  });

  it('a part-applied add-on says so in the report (shape-partial) and the map still builds', () => {
    // Radius 2 has almost no open water, so islets rarely fit; either they do or the report names what is short.
    for (const seed of seeds(6)) {
      const m = make(['satellites'], 2, seed);
      expect(m.board.hexes).toHaveLength(canvasSize(2));
      if (fellBack(m)) continue;
      const partial = m.report.warnings.filter(w => w.code === 'shape-partial');
      const sizes = m.report.stats.landmasses;
      if (sizes.length < 2) expect(partial.length, `r2 ${seed}`).toBeGreaterThan(0);
    }
  });
});

describe('land field helpers', () => {
  const field = (radius = 3) => createLandField(radius, createNoise('T'), createRng('T'));

  it('splitSizes: sums to the total, respects the minimum and the largest', () => {
    for (const seed of seeds(20)) {
      const sizes = splitSizes(createRng(seed), 40, 4, 6, 9);
      expect(sizes).not.toBeNull();
      expect(sizes!.reduce((a, b) => a + b, 0)).toBe(40);
      expect(Math.min(...sizes!)).toBeGreaterThanOrEqual(6);
      expect(Math.max(...sizes!)).toBeGreaterThanOrEqual(9);
    }
    expect(splitSizes(createRng('x'), 10, 4, 6, 6)).toBeNull();
  });

  it('isArc: one unbroken arc of land neighbours, or not', () => {
    const f = field();
    const c = f.at(0, 0);
    f.land[c] = 1;
    // Two neighbours side by side (directions 0 and 1) form one arc.
    f.land[f.nb[c][0]] = 1;
    f.land[f.nb[c][1]] = 1;
    expect(isArc(f, c)).toBe(true);
    // A third on the opposite side splits the land into two arcs.
    f.land[f.nb[c][3]] = 1;
    expect(isArc(f, c)).toBe(false);
  });

  it('fixCount adds the best-ranked cells next to the land until the target is hit', () => {
    for (const target of [7, 12, 20]) {
      const f = field(3);
      for (let i = 0; i < f.size; i++) f.h[i] = -f.dist[i];
      for (let i = 0; i < f.size; i++) f.land[i] = f.dist[i] <= 1 ? 1 : 0;
      f.target = target;
      expect(fixCount(f)).toBe(true);
      let n = 0;
      for (let i = 0; i < f.size; i++) if (f.land[i]) n++;
      expect(n).toBe(target);
    }
  });
});
