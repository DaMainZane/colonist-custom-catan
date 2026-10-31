// MODULE: map profile (landmasses, fog and gold share, average pips, port count; built once per board, refreshed when fog is revealed) | DEPENDS ON: server/util, shared/index | USED BY: server/bots/brain, server/bots/dialogue/context
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
  /** Total pips per resource across revealed numbered land tiles. */
  resourcePips: Record<string, number>;
  /** Scarcity bonus (0..4.5) per resource: higher when a resource has fewer pips on this board than average. */
  scarcityBonus: Record<string, number>;
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

  const resIds = [...reg.resources.keys()];
  const resourcePips: Record<string, number> = Object.fromEntries(resIds.map(r => [r, 0]));

  let numbered = 0;
  let gold = 0;
  let pipSum = 0;
  let resPipSum = 0;
  for (const h of board.hexes) {
    if (h.ext?.hidden) continue;
    const t = reg.tiles.get(h.type);
    if (!t || !t.land || !t.numbered) continue;
    numbered++;
    const pp = getPips(h.number);
    pipSum += pp;
    if (!t.produces) {
      gold++;
    } else if (t.produces in resourcePips) {
      resourcePips[t.produces] += pp;
      resPipSum += pp;
    }
  }

  const avgResPips = resIds.length > 0 ? resPipSum / resIds.length : 0;
  const scarcityBonus: Record<string, number> = {};
  for (const r of resIds) {
    if (avgResPips <= 0) {
      scarcityBonus[r] = 0;
    } else {
      const ratio = (resourcePips[r] || 0) / avgResPips;
      scarcityBonus[r] = ratio < 1 ? Math.min(4.5, (1 - ratio) * 5.0) : 0;
    }
  }

  const mp: MapProfile = {
    hexCount: board.hexes.length,
    landCount: land.landCount,
    vertexCount: board.vertices.length,
    portCount: land.portCount,
    goldShare: numbered > 0 ? gold / numbered : 0,
    avgPips: numbered > 0 ? pipSum / numbered : 3.5,
    resourcePips,
    scarcityBonus,
    landOfHex: land.landOfHex,
    landmassSize: land.landmassSize,
    hiddenCount: hidden
  };
  PROFILE_CACHE.set(board, mp);
  return mp;
}
