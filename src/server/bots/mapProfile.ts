// MODULE: map profile (landmasses, fog and gold share, average pips, port count; built once per board, refreshed when fog is revealed) | USED BY: bots/brain
import { findLandmasses } from '../../shared';
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

/** Landmasses come from the shared map checker (one implementation for the generator, the lobby and the bots). Never changes during a game. */
function buildLand(g: GameState, reg: Registry): LandInfo {
  const { landOfHex, landmassSize, landCount } = findLandmasses(g.board, h => isLandHex(reg, h));
  return {
    landOfHex,
    landmassSize,
    landCount,
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
