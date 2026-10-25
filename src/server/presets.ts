// MODULE: custom map presets (the lobby map as plain JSON: save, validate, rebuild) | USED BY: server/socket, tests
// Presets are stored in the host's browser. The server never keeps them: it turns the lobby map into JSON when the host
// saves, and checks every value again when the host loads one, so a stale or edited preset cannot break a room.
import { buildTopology, cleanSeed, makeRecipe, validateBoard } from '../shared';
import type { Board, HexInit, MapRecipe } from '../shared';
import { mergeSettings } from './lobby';
import { registry } from './runtime';
import type { MapMeta, Room, Settings } from './types';

/** Settings a preset carries. Seats (maxPlayers) and game speed stay with the lobby. */
export const PRESET_SETTING_KEYS = [
  'boardRadius', 'goldTiles', 'desertTiles', 'fogTiles', 'vpToWin', 'cardDiscardLimit', 'bankResourcePerType',
  'devKnights', 'devVp', 'devRoadBuilding', 'devYearOfPlenty', 'devMonopoly',
  'maxSettlements', 'maxCities', 'maxRoads'
] as const;

const MAX_HEXES = 8000;
const MAX_COORD = 60;
const MAX_NAME = 24;
const MAX_PORTS = 4000;

/** One hex as [q, r, tile type, number (0 = none), flags (1 = hidden by fog)]. */
export type PresetHex = [number, number, string, number, number];

export interface CustomPreset {
  /** 1 = snapshot only. 2 = snapshot plus the recipe it was made from (when there is one). */
  v: 1 | 2;
  id: string;
  name: string;
  savedAt: number;
  settings: Record<string, number>;
  hexes: PresetHex[];
  /** Coastal edge key -> port id. */
  ports: Record<string, string>;
  /** Robber start tile as [q, r]. */
  robber: [number, number] | null;
  /** v2: how the map was made. Null for a painted-over map or one that never had a recipe (Blank, v1 presets). */
  recipe?: MapRecipe | null;
  /** v2: generator version of the recipe, so a client can tell that the seed may now give another map. */
  genVersion?: number | null;
}

export interface LoadedPreset {
  board: Board;
  settings: Settings;
  name: string;
  /** The recipe the preset carried, cleaned (ids are checked against the registry only when it is applied). Null for v1. */
  recipe: MapRecipe | null;
}

const isLand = (type: string): boolean => !!registry.tiles.get(type)?.land;

export function cleanPresetName(name: any): string {
  const s = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  return s || 'My map';
}

/** The lobby map (tiles, numbers, fog, ports, robber) plus the rule settings, as plain JSON. `meta` adds the recipe, unless the map was painted after generating. */
export function serializePreset(board: Board, settings: Settings, name: any, meta?: MapMeta): CustomPreset {
  const saved: Record<string, number> = {};
  for (const key of PRESET_SETTING_KEYS) {
    const value = (settings as any)[key];
    if (typeof value === 'number' && Number.isFinite(value)) saved[key] = value;
  }

  const ports: Record<string, string> = {};
  for (const e of board.edges) if (e.port) ports[e.key] = e.port;

  const robberHex = board.hexes[board.robberHexId];
  // An edited map no longer matches its seed, so its recipe would promise a map the preset does not hold.
  const recipe = meta && !meta.edited ? meta.recipe : null;
  return {
    v: 2,
    id: `custom_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    name: cleanPresetName(name),
    savedAt: Date.now(),
    settings: saved,
    hexes: board.hexes.map(h => [h.q, h.r, h.type, h.number ?? 0, h.ext?.hidden ? 1 : 0] as PresetHex),
    ports,
    robber: robberHex ? [robberHex.q, robberHex.r] : null,
    recipe,
    genVersion: recipe ? recipe.g : null
  };
}

/** A recipe from a preset, cleaned and clamped. Null when it is not one (no seed, wrong types). Never throws. */
function cleanRecipe(raw: any): MapRecipe | null {
  if (!raw || typeof raw !== 'object' || typeof raw.seed !== 'string' || !cleanSeed(raw.seed)) return null;
  const picks = Array.isArray(raw.picks) ? raw.picks.slice(0, 32).map(String) : [];
  const params = raw.params && typeof raw.params === 'object' && !Array.isArray(raw.params) ? raw.params : {};
  return makeRecipe({ g: raw.g, seed: raw.seed, radius: raw.radius, picks, params });
}

/** The style of a preset's recipe (radius, picks, params), without its seed: what "new seed" applies. Null when the preset has no recipe. */
export function presetStyle(raw: any): { radius: number; picks: string[]; params: Record<string, number> } | null {
  const recipe = cleanRecipe(raw?.recipe);
  return recipe ? { radius: recipe.radius, picks: recipe.picks, params: recipe.params } : null;
}

/**
 * Puts a loaded preset in the lobby. The board is the snapshot, exactly as saved. When the preset carries a recipe the
 * seed, picks and params come back too, so the menu shows the style again and the seed line stays meaningful.
 */
export function applyLoadedPreset(room: Pick<Room, 'settings' | 'board' | 'mapMeta'>, loaded: LoadedPreset): void {
  room.board = loaded.board;
  room.settings = loaded.settings;
  const recipe = loaded.recipe;
  if (!recipe) {
    // A snapshot only: the seed no longer describes this board.
    room.mapMeta = undefined;
    return;
  }
  room.settings = mergeSettings(
    { boardRadius: loaded.settings.boardRadius, mapPicks: recipe.picks, mapParams: recipe.params, mapSeed: recipe.seed },
    loaded.settings
  );
  const { boardRadius, mapPicks, mapParams } = room.settings;
  room.mapMeta = {
    recipe: { ...recipe, radius: boardRadius, picks: mapPicks ?? [], params: mapParams ?? {} },
    report: validateBoard(loaded.board, registry),
    edited: false
  };
}

/** Validates a preset from the client and rebuilds the board and settings from it. */
export function loadPreset(raw: any, old: Settings): LoadedPreset | { error: string } {
  const bad = { error: 'That preset could not be loaded.' };
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.hexes)) return bad;
  if (raw.hexes.length < 1 || raw.hexes.length > MAX_HEXES) return bad;

  const seen = new Set<string>();
  const inits: HexInit[] = [];
  for (const row of raw.hexes) {
    if (!Array.isArray(row) || row.length < 4) return bad;
    const [q, r, type, number, flags] = row;
    if (!Number.isInteger(q) || !Number.isInteger(r) || Math.abs(q) > MAX_COORD || Math.abs(r) > MAX_COORD) return bad;
    // 'fog' is only the mask players see, never a real tile type.
    if (typeof type !== 'string' || type === 'fog') return bad;
    const def = registry.tiles.get(type);
    if (!def) return bad;

    const spot = `${q},${r}`;
    if (seen.has(spot)) return bad;
    seen.add(spot);

    const n = Number(number);
    if (!Number.isInteger(n) || (n !== 0 && (n < 2 || n > 12))) return bad;

    const numbered = !!(def.land && def.numbered);
    const hidden = numbered && Number(flags) === 1;
    inits.push({
      q,
      r,
      type,
      number: numbered && n > 0 ? n : null,
      ext: hidden ? { hidden: true, maskAs: 'fog' } : {}
    });
  }
  if (!inits.some(h => isLand(h.type))) return { error: 'That preset has no land tiles.' };

  const ports: Record<string, string> = {};
  if (raw.ports && typeof raw.ports === 'object') {
    let count = 0;
    for (const [key, value] of Object.entries(raw.ports)) {
      if (++count > MAX_PORTS) break;
      if (key.length <= 24 && typeof value === 'string' && registry.ports.has(value)) ports[key] = value;
    }
  }

  // Saved ports are kept as they are ('coast' only relaxes the final pass to one port per hex; nothing is auto-placed).
  const board = buildTopology(inits, { ports, isLand, portMode: 'coast' });

  const robber = raw.robber;
  if (Array.isArray(robber)) {
    const spot = board.hexes.find(h => h.q === robber[0] && h.r === robber[1]);
    if (spot && isLand(spot.type) && !spot.ext.hidden) board.robberHexId = spot.id;
  }

  const input: Record<string, number> = {};
  const rawSettings = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  for (const key of PRESET_SETTING_KEYS) {
    const value = rawSettings[key];
    if (typeof value === 'number' && Number.isFinite(value)) input[key] = value;
  }

  return { board, settings: mergeSettings(input, old), name: cleanPresetName(raw.name), recipe: cleanRecipe(raw.recipe) };
}
