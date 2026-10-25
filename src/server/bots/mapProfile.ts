// MODULE: map profile (landmasses, fog and gold share, average pips, port count; built once per board, refreshed when fog is revealed) | USED BY: bots/brain
import type { GameState, Registry } from '../../shared';
import { getPips } from '../util';

export interface MapProfile {
  hexCount: number;
  /** Land hexes, hidden (fog) ones included. */
  landCount: number;
  vertexCount: number;
  portCount: number;
  /** Numbered gold tiles as a share of all numbered land tiles that are revealed (0 when there is none). */
  goldShare: number;
  /** Average pips of revealed numbered land tiles (the best public guess for a fog tile). */
  avgPips: number;
  /** hex id -> landmass index, -1 for water. */
  landOfHex: number[];
  /** Hexes per landmass. */
  landmassSize: number[];
  /** Hidden hexes when the dynamic part was last computed. */
  hiddenCount: number;
}

interface LandInfo { landOfHex: number[]; landmassSize: number[]; landCount: number; portCount: number }

const LAND_CACHE = new WeakMap<object, LandInfo>();
const PROFILE_CACHE = new WeakMap<object, MapProfile>();

type HexT = GameState['board']['hexes'][number];

function isLandHex(reg: Registry, h: HexT): boolean {
  return !!h.ext?.hidden || !!reg.tiles.get(h.type)?.land;
}

/** Landmasses: land hexes joined across shared edges (union-find). Never changes during a game. */
function buildLand(g: GameState, reg: Registry): LandInfo {
  const hexes = g.board.hexes;
  const land = hexes.map(h => isLandHex(reg, h));
  const parent = hexes.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  };
  for (const e of g.board.edges) {
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
  return {
    landOfHex,
    landmassSize,
    landCount: land.filter(Boolean).length,
    portCount: g.board.edges.filter(e => !!e.port).length
  };
}

export function getMapProfile(g: GameState, reg: Registry): MapProfile {
  const board = g.board;
  let hidden = 0;
  for (const h of board.hexes) if (h.ext?.hidden) hidden++;

  const cached = PROFILE_CACHE.get(board);
  if (cached && cached.hiddenCount === hidden) return cached;

  let land = LAND_CACHE.get(board);
  if (!land) { land = buildLand(g, reg); LAND_CACHE.set(board, land); }

  let numbered = 0;
  let gold = 0;
  let pipSum = 0;
  for (const h of board.hexes) {
    if (h.ext?.hidden) continue;
    const t = reg.tiles.get(h.type);
    if (!t || !t.land || !t.numbered) continue;
    numbered++;
    pipSum += getPips(h.number);
    if (!t.produces) gold++;
  }

  const mp: MapProfile = {
    hexCount: board.hexes.length,
    landCount: land.landCount,
    vertexCount: board.vertices.length,
    portCount: land.portCount,
    goldShare: numbered > 0 ? gold / numbered : 0,
    avgPips: numbered > 0 ? pipSum / numbered : 3.5,
    landOfHex: land.landOfHex,
    landmassSize: land.landmassSize,
    hiddenCount: hidden
  };
  PROFILE_CACHE.set(board, mp);
  return mp;
}
