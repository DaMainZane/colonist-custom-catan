// MODULE: lobby board tools (generate from a recipe, quick starts, settings merge, paint terrain/numbers/robber/ports) on the engine board | USED BY: server/socket, server/rooms, server/game
import {
  REAL_NUMBER_POOL, SHARE_PREFIX, buildTopology, cleanSeed, createRng, decodeRecipe, generateBoard, generateMap, hexDistance,
  isKnownMapId, randomSeed, resolveMapOptions, resolveParams, resolvePicks
} from '../shared';
import type { Board, HexInit } from '../shared';
import { normalizeBotChat } from './bots/dialogue/events';
import { fullRules, registry } from './runtime';
import type { MapMeta, Room, Settings } from './types';
import { clamp } from './util';

const NUMBERS = REAL_NUMBER_POOL;

const isLand = (type: string): boolean => !!registry.tiles.get(type)?.land;

// ---- Map from a recipe --------------------------------------------------------------------------------------

/** The lobby map for these settings: seed, radius, picks and params become a recipe. An empty seed rolls a fresh one (read it from `meta.recipe`). */
export function generateLobbyMap(settings: Settings): { board: Board; meta: MapMeta } {
  const res = generateMap(registry, fullRules(settings), {
    seed: settings.mapSeed ?? '',
    radius: settings.boardRadius,
    picks: settings.mapPicks ?? [],
    params: settings.mapParams ?? {}
  });
  return { board: res.board, meta: { recipe: res.recipe, report: res.report, edited: false } };
}

/** An all-water canvas for the painter (the Blank quick start). */
function blankBoard(settings: Settings): Board {
  return generateBoard(registry, fullRules(settings), createRng(randomSeed()), 'blank');
}

/**
 * A new board. Without `preset` it follows the settings' recipe (the seed in `mapSeed`; empty rolls a fresh one).
 * With a quick start id it applies that recipe with a fresh seed. Other preset ids use the legacy generator (Archipelago, until M3).
 */
export function newBoard(settings: Settings, preset?: string): Board {
  if (!preset) return generateLobbyMap(settings).board;
  const quick = registry.quickStarts.get(preset);
  if (quick?.blank) return blankBoard(settings);
  if (quick) {
    const picks = resolvePicks(registry, quick.picks).picks;
    return generateLobbyMap({ ...settings, mapSeed: '', mapPicks: picks, mapParams: quick.params ?? {} }).board;
  }
  return generateBoard(registry, fullRules(settings), createRng(randomSeed()), preset);
}

/** Rebuilds the room's lobby board from its settings and stores the seed that was used (so a rolled seed is never lost). */
export function refreshMap(room: Pick<Room, 'settings' | 'board' | 'mapMeta'>): void {
  const { board, meta } = generateLobbyMap(room.settings);
  room.settings.mapSeed = meta.recipe.seed;
  room.board = board;
  room.mapMeta = meta;
}

/**
 * A preset chip. Quick starts set the picks and params and roll a new seed; Blank is the special all-water canvas;
 * a legacy preset (Archipelago, until the M3 shape replaces it) draws a one-off board and clears the picks.
 */
export function applyMapStart(room: Pick<Room, 'settings' | 'board' | 'mapMeta'>, id: string): void {
  const quick = registry.quickStarts.get(id);
  if (quick) {
    room.settings.mapPicks = resolvePicks(registry, quick.picks).picks;
    room.settings.mapParams = { ...(quick.params ?? {}) };
    room.settings.mapSeed = '';
    if (quick.blank) {
      room.board = blankBoard(room.settings);
      room.mapMeta = undefined;
      return;
    }
    refreshMap(room);
    return;
  }
  room.settings.mapPicks = [];
  room.settings.mapParams = {};
  room.board = generateBoard(registry, fullRules(room.settings), createRng(randomSeed()), id);
  room.mapMeta = undefined;
}

/** Everything that decides the lobby map. When this changes the board is rebuilt; other settings leave painted edits alone. */
export function recipeKey(s: Settings): string {
  const params = s.mapParams ?? {};
  return JSON.stringify([
    s.mapSeed ?? '', s.boardRadius, s.mapPicks ?? [],
    Object.keys(params).sort().map(k => [k, params[k]]),
    s.goldTiles, s.desertTiles, s.fogTiles ?? 0
  ]);
}

/** Smallest map radius that is comfortable for this many players (the default radius 2 fits 4). */
export function recommendedRadius(players: number): number {
  return players <= 4 ? 2 : players <= 6 ? 3 : 4;
}

export function isPreset(id: any): boolean {
  return typeof id === 'string' && (registry.quickStarts.has(id) || registry.presets.has(id));
}

// ---- Settings ---------------------------------------------------------------------------------------------------

/**
 * Clamps client-supplied settings to the allowed ranges. Anything missing or invalid keeps the old value.
 * Map picks go through the registry (unknown ids dropped, slots and conflicts resolved, params clamped).
 * A full share code in `mapSeed` applies the whole recipe (radius, picks, params, seed); `dropped` lists the ids it had that this server does not know.
 */
export function mergeSettingsDetailed(input: any, old: Settings): { settings: Settings; dropped: string[] } {
  const s = input ?? {};
  const dropped: string[] = [];
  const speed = Number(s.gameSpeed);
  const gameSpeed = Number.isFinite(speed) && speed > 0 ? Math.max(0.25, Math.min(10, speed)) : (old.gameSpeed ?? 1);

  let seedIn: any = s.mapSeed;
  let picksIn: any = s.mapPicks;
  let paramsIn: any = s.mapParams;
  let radiusIn: any = s.boardRadius;
  if (typeof seedIn === 'string' && seedIn.length <= 400 && seedIn.trim().startsWith(`${SHARE_PREFIX};`)) {
    const decoded = decodeRecipe(seedIn, id => isKnownMapId(registry, id));
    if (decoded) {
      seedIn = decoded.recipe.seed;
      picksIn = decoded.recipe.picks;
      paramsIn = decoded.recipe.params;
      radiusIn = decoded.recipe.radius;
      dropped.push(...decoded.dropped);
    }
  }

  const mapSeed = seedIn === undefined || seedIn === null ? (old.mapSeed ?? '') : cleanSeed(seedIn);
  const mapPicks = resolvePicks(registry, Array.isArray(picksIn) ? picksIn.slice(0, 32).map(String) : (old.mapPicks ?? [])).picks;
  const options = resolveMapOptions(registry, mapPicks).options;
  const mapParams = resolveParams(options, paramsIn && typeof paramsIn === 'object' && !Array.isArray(paramsIn) ? paramsIn : (old.mapParams ?? {}));

  const settings: Settings = {
    boardRadius: clamp(radiusIn, 1, 50, old.boardRadius),
    goldTiles: clamp(s.goldTiles, 0, 500, old.goldTiles),
    desertTiles: clamp(s.desertTiles, 0, 200, old.desertTiles),
    fogTiles: clamp(s.fogTiles, 0, 2000, old.fogTiles ?? 0),
    vpToWin: clamp(s.vpToWin, 3, 50, old.vpToWin),
    maxPlayers: clamp(s.maxPlayers, 2, 8, old.maxPlayers),
    cardDiscardLimit: clamp(s.cardDiscardLimit, 3, 50, old.cardDiscardLimit),
    bankResourcePerType: clamp(s.bankResourcePerType, 5, 999, old.bankResourcePerType),
    devKnights: clamp(s.devKnights, 0, 100, old.devKnights),
    devVp: clamp(s.devVp, 0, 50, old.devVp),
    devRoadBuilding: clamp(s.devRoadBuilding, 0, 50, old.devRoadBuilding),
    devYearOfPlenty: clamp(s.devYearOfPlenty, 0, 50, old.devYearOfPlenty),
    devMonopoly: clamp(s.devMonopoly, 0, 50, old.devMonopoly),
    maxSettlements: clamp(s.maxSettlements, 2, 20, old.maxSettlements),
    maxCities: clamp(s.maxCities, 1, 20, old.maxCities),
    maxRoads: clamp(s.maxRoads, 5, 50, old.maxRoads),
    gameSpeed,
    turnTimerSec: clamp(s.turnTimerSec, 0, 900, old.turnTimerSec ?? 0),
    turnIncrementSec: clamp(s.turnIncrementSec, 0, 120, old.turnIncrementSec ?? 0),
    tradeTimerSec: clamp(s.tradeTimerSec, 5, 300, old.tradeTimerSec ?? 20),
    botChat: normalizeBotChat(s.botChat, old.botChat),
    mapSeed,
    mapSeedLocked: typeof s.mapSeedLocked === 'boolean' ? s.mapSeedLocked : !!old.mapSeedLocked,
    mapPicks,
    mapParams
  };
  return { settings, dropped };
}

export function mergeSettings(input: any, old: Settings): Settings {
  return mergeSettingsDetailed(input, old).settings;
}

// ---- Painting ---------------------------------------------------------------------------------------------------

function portsOf(board: Board): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of board.edges) if (e.port) out[e.key] = e.port;
  return out;
}

/** Recomputes the topology from the hexes, keeping the given ports. */
function rebuild(board: Board, ports: Record<string, string>): Board {
  const inits: HexInit[] = board.hexes.map(h => ({ q: h.q, r: h.r, type: h.type, number: h.number, ext: h.ext }));
  return buildTopology(inits, { ports, isLand });
}

function randomBaseTile(): string {
  const base = [...registry.tiles.values()].filter(t => t.base);
  return base[Math.floor(Math.random() * base.length)].id;
}

/** Terrain, number and robber painting. The client's values are validated against the registry. */
export function paintHex(board: Board, hexId: number, paintType: string, paintValue: any): Board {
  const hex = board.hexes[hexId];
  if (!hex) return board;

  if (paintType === 'terrain') {
    const value = String(paintValue);
    if (value === 'fog') {
      const def = registry.tiles.get(hex.type);
      if (!def || !def.land || !def.numbered) hex.type = randomBaseTile();
      if (!hex.number) hex.number = NUMBERS[Math.floor(Math.random() * NUMBERS.length)];
      hex.ext = { ...hex.ext, hidden: true, maskAs: 'fog' };
    } else {
      const def = registry.tiles.get(value);
      if (!def) return board;
      const ext = { ...hex.ext };
      delete ext.hidden;
      delete ext.maskAs;
      hex.ext = ext;
      hex.type = value;
      if (!def.land || !def.numbered) hex.number = null;
      else if (!hex.number) hex.number = 6;
    }
    return rebuild(board, portsOf(board));
  }

  if (paintType === 'number') {
    const def = registry.tiles.get(hex.type);
    if (def?.land && def.numbered) {
      if (paintValue === 'none') hex.number = null;
      else {
        const n = Number(paintValue);
        if (Number.isInteger(n) && n >= 2 && n <= 12) hex.number = n;
      }
    }
    return board;
  }

  if (paintType === 'robber') {
    if (isLand(hex.type) && !hex.ext.hidden) board.robberHexId = hex.id;
    return board;
  }
  return board;
}

/** Places or removes a port on a coastal edge. Neighbouring ports are dropped (no ports on adjacent tiles). */
export function paintPort(board: Board, edgeId: number, portValue: any): Board {
  const edge = board.edges[edgeId];
  if (!edge || edge.hexIds.length !== 1) return board;
  if (portValue !== 'none' && !registry.ports.has(portValue)) return board;

  const target = board.hexes[edge.hexIds[0]];
  const ports: Record<string, string> = {};
  for (const e of board.edges) {
    if (!e.port) continue;
    if (portValue !== 'none' && target && e.id !== edge.id && e.hexIds.length === 1) {
      const other = board.hexes[e.hexIds[0]];
      if (other && hexDistance(target, other) <= 1) continue;
    }
    ports[e.key] = e.port;
  }
  if (portValue === 'none') delete ports[edge.key];
  else ports[edge.key] = portValue;
  return rebuild(board, ports);
}
