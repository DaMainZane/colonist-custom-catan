// MODULE: board checks (landmasses, lakes, usable spots, fairness, MapReport) | USED BY: mapgen, bots/mapProfile, lobby report (later), tests
import type { Registry } from './registry';
import { createRng, rngShuffle } from './rng';
import type { RngState } from './rng';
import { GEN_VERSION } from './maprecipe';
import type { Board, Hex } from './types';

export interface MapIssue { code: string; message: string }

export interface MapReport {
  /** No errors. */
  ok: boolean;
  errors: MapIssue[];
  warnings: MapIssue[];
  /** Best attempt, not every check passed (set by the retry loop, M5). */
  degraded?: boolean;
  stats: {
    /** Land hexes, hidden (fog) ones included. */
    land: number;
    /** Hexes per landmass, in discovery order. */
    landmasses: number[];
    lakes: number;
    vertices: number;
    /** Usable settlement spots (greedy independent set over vertices that touch a numbered tile). */
    spots: number;
    /** Spots per landmass, aligned with `landmasses`. */
    landmassSpots: number[];
    ports: number;
    pipsByResource: Record<string, number>;
    /** Pips of the 8th best spot divided by the best spot (4 players, 2 spots each). 0 when there are fewer than 8 spots. */
    fairness: number;
    attempts: number;
    /** Board attempts the retry loop ran (token layouts tried on the chosen shape); absent for painted or loaded maps. */
    boardAttempts?: number;
    genVersion: number;
  };
}

/** Spots the biggest landmass must hold: 4 players, 2 spots each. Generation never reads the real roster. */
export const BASELINE_SPOTS = 8;
export const MIN_LANDMASS = 3;

const DIRS: [number, number][] = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

/** Dice pips of a token: 6 and 8 = 5, 5 and 9 = 4, 4 and 10 = 3, 3 and 11 = 2, 2 and 12 = 1. */
export function pipsOf(n: number | null | undefined): number {
  if (n == null || n < 2 || n > 12 || n === 7) return 0;
  return 6 - Math.abs(7 - n);
}

/** Vertices of a board, estimated before any topology exists: 2L + B/2 + C - h. Standard board: 19, 30, 1, 0 -> 54. */
export function estimateVertices(land: number, coastEdges: number, landmasses: number, lakes: number): number {
  return 2 * land + coastEdges / 2 + landmasses - lakes;
}

export interface Landmasses {
  /** hex id -> landmass index, -1 for water. */
  landOfHex: number[];
  /** Hexes per landmass. */
  landmassSize: number[];
  landCount: number;
}

/** Landmasses: land hexes joined across shared edges (union-find). */
export function findLandmasses(board: Board, isLandHex: (h: Hex) => boolean): Landmasses {
  const hexes = board.hexes;
  const land = hexes.map(h => isLandHex(h));
  const parent = hexes.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  };
  for (const e of board.edges) {
    if (e.hexIds.length !== 2) continue;
    const [a, b] = e.hexIds;
    if (land[a] && land[b]) parent[find(a)] = find(b);
  }
  const index = new Map<number, number>();
  const landmassSize: number[] = [];
  const landOfHex = hexes.map((_, i) => {
    if (!land[i]) return -1;
    const root = find(i);
    if (!index.has(root)) { index.set(root, landmassSize.length); landmassSize.push(0); }
    const c = index.get(root)!;
    landmassSize[c]++;
    return c;
  });
  return { landOfHex, landmassSize, landCount: land.filter(Boolean).length };
}

export type CellKind = 'land' | 'ocean' | 'lake';

/**
 * Land cells squeezed between water on two sides: their land neighbours form two or more separate arcs around them, so the
 * land is one tile wide there (a neck that roads have to squeeze through). A closed ring has no cut cell (take one away and
 * the rest is still a path), so the check is local. `ring(i)` lists the six neighbours of cell i in direction order, -1 outside the board.
 */
export function countPinches(count: number, land: (i: number) => boolean, ring: (i: number) => number[]): number {
  let n = 0;
  for (let i = 0; i < count; i++) {
    if (!land(i)) continue;
    const nb = ring(i);
    let arcs = 0;
    for (let k = 0; k < 6; k++) {
      const a = nb[k] >= 0 && land(nb[k]);
      const b = nb[(k + 1) % 6] >= 0 && land(nb[(k + 1) % 6]);
      if (a && !b) arcs++;
    }
    if (arcs >= 2) n++;
  }
  return n;
}

/**
 * Water that reaches the canvas edge is ocean (the canvas border is open sea). Water that is walled in by
 * land is a lake. Indexed by hex id.
 */
export function classifyCells(board: Board, isLandHex: (h: Hex) => boolean): { kind: CellKind[]; lakes: number } {
  const hexes = board.hexes;
  const at = new Map<string, number>();
  hexes.forEach((h, i) => at.set(`${h.q},${h.r}`, i));
  const kind: CellKind[] = hexes.map(() => 'land');
  const seen = new Uint8Array(hexes.length);
  let lakes = 0;
  for (let i = 0; i < hexes.length; i++) {
    if (seen[i] || isLandHex(hexes[i])) continue;
    const comp = [i];
    seen[i] = 1;
    let open = false;
    for (let k = 0; k < comp.length; k++) {
      const h = hexes[comp[k]];
      for (const [dq, dr] of DIRS) {
        const j = at.get(`${h.q + dq},${h.r + dr}`);
        if (j === undefined) { open = true; continue; }
        if (seen[j] || isLandHex(hexes[j])) continue;
        seen[j] = 1;
        comp.push(j);
      }
    }
    for (const c of comp) kind[c] = open ? 'ocean' : 'lake';
    if (!open) lakes++;
  }
  return { kind, lakes };
}

function greedyPick(board: Board, order: number[], ok: boolean[]): number[] {
  const blocked = new Uint8Array(board.vertices.length);
  const out: number[] = [];
  for (const id of order) {
    if (!ok[id] || blocked[id]) continue;
    out.push(id);
    blocked[id] = 1;
    for (const n of board.vertices[id].adjacentVertices) blocked[n] = 1;
  }
  return out;
}

export interface ValidateOptions {
  /** The land count the shape stage promised. Omit for painted or loaded maps. */
  expectLand?: number;
  /** Warn about land tiles squeezed between water on two sides (a 1-wide neck). Used for the ring shape. Default false. */
  checkNecks?: boolean;
  minLandmass?: number;
  /** 'forbid' (default) warns about touching 6/8, 'allow' skips that check. */
  hotTouch?: 'forbid' | 'allow';
  /** Warn when a resource has under half the average pips (default true; off for balanced styles). */
  balanceCheck?: boolean;
  /** One landmass only: split land is an error (shapes that must stay whole). Default false. */
  requireConnected?: boolean;
  /** Thin-land warning limit: the share of land tiles with 2 or fewer land neighbours. Default 0.25. */
  thinLand?: number;
  attempts?: number;
  /** Order source for the spot search, so the report is deterministic. */
  rng?: RngState;
}

export function validateBoard(board: Board, reg: Registry, opts: ValidateOptions = {}): MapReport {
  const errors: MapIssue[] = [];
  const warnings: MapIssue[] = [];
  const isLandHex = (h: Hex) => !!h.ext?.hidden || !!reg.tiles.get(h.type)?.land;
  const hexes = board.hexes;
  const land = findLandmasses(board, isLandHex);
  const { lakes } = classifyCells(board, isLandHex);
  const rng = opts.rng ?? createRng('check');

  // Hex neighbours by coordinates.
  const at = new Map<string, number>();
  hexes.forEach((h, i) => at.set(`${h.q},${h.r}`, i));
  const neighbours = (i: number): number[] => {
    const out: number[] = [];
    for (const [dq, dr] of DIRS) {
      const j = at.get(`${hexes[i].q + dq},${hexes[i].r + dr}`);
      if (j !== undefined) out.push(j);
    }
    return out;
  };

  // Spots: vertices that touch a numbered tile (a hidden tile counts), picked greedily under the distance rule.
  const touchesNumber = (h: Hex | undefined) => !!h && (h.number != null || !!h.ext?.hidden);
  const ok = board.vertices.map(v => v.hexIds.some(id => touchesNumber(hexes[id])));
  const value = board.vertices.map(v => v.hexIds.reduce((s, id) => s + pipsOf(hexes[id]?.number), 0));
  const cand = board.vertices.map(v => v.id).filter(id => ok[id]);

  const byDegree = [...cand].sort((a, b) =>
    board.vertices[a].adjacentVertices.length - board.vertices[b].adjacentVertices.length || a - b);
  let best = greedyPick(board, byDegree, ok);
  for (let run = 0; run < 4; run++) {
    const picked = greedyPick(board, rngShuffle(rng, cand), ok);
    if (picked.length > best.length) best = picked;
  }
  const landmassSpots = land.landmassSize.map(() => 0);
  for (const id of best) {
    const hexId = board.vertices[id].hexIds[0];
    const m = hexId === undefined ? -1 : land.landOfHex[hexId];
    if (m >= 0) landmassSpots[m]++;
  }

  // Fairness: draft the best spots first (best value, then lowest id) and compare the 8th to the 1st.
  const byValue = [...cand].sort((a, b) => value[b] - value[a] || a - b);
  const drafted = greedyPick(board, byValue, ok).map(id => value[id]);
  const fairness = drafted.length >= BASELINE_SPOTS && drafted[0] > 0 ? drafted[BASELINE_SPOTS - 1] / drafted[0] : 0;

  // Pips per resource (hidden tiles included: this is the generator's view, not a player's).
  const pipsByResource: Record<string, number> = {};
  const hexCount: Record<string, number> = {};
  for (const def of reg.tiles.values()) {
    if (def.land && def.numbered && def.produces) { pipsByResource[def.produces] = 0; hexCount[def.produces] = 0; }
  }
  for (const h of hexes) {
    const res = reg.tiles.get(h.type)?.produces;
    if (!res || !(res in pipsByResource)) continue;
    if (h.number != null || h.ext?.hidden) hexCount[res]++;
    pipsByResource[res] += pipsOf(h.number);
  }

  const portEdges = board.edges.filter(e => !!e.port);
  const portedLand = new Set<number>();
  for (const e of portEdges) {
    const m = land.landOfHex[e.hexIds[0]];
    if (m >= 0) portedLand.add(m);
  }

  // Errors.
  if (opts.expectLand !== undefined && land.landCount !== opts.expectLand) {
    errors.push({ code: 'land-count', message: `Expected ${opts.expectLand} land tiles, got ${land.landCount}.` });
  }
  if (land.landCount === 0) errors.push({ code: 'no-land', message: 'The map has no land.' });
  const minSize = opts.minLandmass ?? MIN_LANDMASS;
  land.landmassSize.forEach((size, i) => {
    if (size < minSize) errors.push({ code: 'landmass-too-small', message: `Landmass ${i + 1} has ${size} tiles (minimum ${minSize}).` });
  });
  if (land.landCount > 0 && Math.max(0, ...landmassSpots) < BASELINE_SPOTS) {
    errors.push({ code: 'too-few-spots', message: `The biggest landmass has ${Math.max(0, ...landmassSpots)} usable spots (needs ${BASELINE_SPOTS}).` });
  }
  if (opts.requireConnected && land.landmassSize.length > 1) {
    errors.push({ code: 'not-connected', message: `The land is split into ${land.landmassSize.length} landmasses, but this shape must stay in one piece.` });
  }
  for (const res of Object.keys(pipsByResource)) {
    if (hexCount[res] === 0) errors.push({ code: 'resource-missing', message: `No tile produces ${res}.` });
  }
  for (const h of hexes) {
    if (h.ext?.hidden) continue;
    const def = reg.tiles.get(h.type);
    if (def?.land && def.numbered && h.number == null) {
      errors.push({ code: 'token-mismatch', message: `Numbered tile ${h.type} at ${h.q},${h.r} has no token.` });
      break;
    }
    if (def && !def.numbered && h.number != null) {
      errors.push({ code: 'token-mismatch', message: `Tile ${h.type} at ${h.q},${h.r} should not have a token.` });
      break;
    }
  }

  // Warnings.
  if (opts.hotTouch !== 'allow') {
    let touching = 0;
    hexes.forEach((h, i) => {
      if (h.number !== 6 && h.number !== 8) return;
      for (const j of neighbours(i)) if (j > i && (hexes[j].number === 6 || hexes[j].number === 8)) touching++;
    });
    if (touching > 0) warnings.push({ code: 'hot-touch', message: `${touching} pair(s) of 6/8 tokens touch.` });
  }
  if (land.landCount > 0 && best.length >= BASELINE_SPOTS && fairness < 0.5) {
    warnings.push({ code: 'low-fairness', message: `Spot fairness is ${fairness.toFixed(2)} (the 8th best spot is under half the best).` });
  }
  let thin = 0;
  hexes.forEach((h, i) => {
    if (land.landOfHex[i] < 0) return;
    if (neighbours(i).filter(j => land.landOfHex[j] >= 0).length <= 2) thin++;
  });
  if (land.landCount > 0 && thin / land.landCount > (opts.thinLand ?? 0.25)) {
    warnings.push({ code: 'thin-land', message: `${thin} of ${land.landCount} land tiles have 2 or fewer land neighbours.` });
  }
  land.landmassSize.forEach((size, i) => {
    if (size >= 6 && !portedLand.has(i)) warnings.push({ code: 'no-port', message: `Landmass ${i + 1} (${size} tiles) has no port.` });
  });
  if (opts.checkNecks && land.landCount > 0) {
    const ringOf = (i: number): number[] => DIRS.map(([dq, dr]) => at.get(`${hexes[i].q + dq},${hexes[i].r + dr}`) ?? -1);
    const pinched = countPinches(hexes.length, i => land.landOfHex[i] >= 0, ringOf);
    if (pinched > 0) warnings.push({ code: 'thin-neck', message: `${pinched} land tile${pinched === 1 ? ' is' : 's are'} squeezed between water on two sides (a 1-wide neck).` });
  }
  if (opts.balanceCheck !== false) {
    const res = Object.keys(pipsByResource).filter(r => hexCount[r] > 0);
    const mean = res.length > 0 ? res.reduce((s, r) => s + pipsByResource[r], 0) / res.length : 0;
    for (const r of res) {
      if (mean > 0 && pipsByResource[r] < mean / 2) {
        warnings.push({ code: 'weak-resource', message: `${r} has ${pipsByResource[r]} pips (average ${mean.toFixed(1)}).` });
      }
    }
  }
  if (land.landmassSize.length > 1) {
    warnings.push({ code: 'split-land', message: `The land is split into ${land.landmassSize.length} landmasses.` });
    // Terrain is dealt over the whole map, so a 4+ tile island can end up with a single resource.
    const kinds = land.landmassSize.map(() => new Set<string>());
    hexes.forEach((h, i) => {
      const m = land.landOfHex[i];
      if (m >= 0 && !h.ext?.hidden) kinds[m].add(reg.tiles.get(h.type)?.produces ?? h.type);
    });
    land.landmassSize.forEach((size, i) => {
      if (size >= 4 && kinds[i].size === 1) warnings.push({ code: 'one-resource-island', message: `Landmass ${i + 1} (${size} tiles) has only ${[...kinds[i]][0]}.` });
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      land: land.landCount,
      landmasses: land.landmassSize,
      lakes,
      vertices: board.vertices.length,
      spots: best.length,
      landmassSpots,
      ports: portEdges.length,
      pipsByResource,
      fairness,
      attempts: opts.attempts ?? 1,
      genVersion: GEN_VERSION
    }
  };
}
