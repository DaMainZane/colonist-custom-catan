// MODULE: custom map presets (the lobby map as plain JSON: save, validate, rebuild) | USED BY: server/socket, tests
// Presets are stored in the host's browser. The server never keeps them: it turns the lobby map into JSON when the host
// saves, and checks every value again when the host loads one, so a stale or edited preset cannot break a room.
import { buildTopology } from '../shared';
import type { Board, HexInit } from '../shared';
import { mergeSettings } from './lobby';
import { registry } from './runtime';
import type { Settings } from './types';

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
  v: 1;
  id: string;
  name: string;
  savedAt: number;
  settings: Record<string, number>;
  hexes: PresetHex[];
  /** Coastal edge key -> port id. */
  ports: Record<string, string>;
  /** Robber start tile as [q, r]. */
  robber: [number, number] | null;
}

export interface LoadedPreset {
  board: Board;
  settings: Settings;
  name: string;
}

const isLand = (type: string): boolean => !!registry.tiles.get(type)?.land;

export function cleanPresetName(name: any): string {
  const s = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  return s || 'My map';
}

/** The lobby map (tiles, numbers, fog, ports, robber) plus the rule settings, as plain JSON. */
export function serializePreset(board: Board, settings: Settings, name: any): CustomPreset {
  const saved: Record<string, number> = {};
  for (const key of PRESET_SETTING_KEYS) {
    const value = (settings as any)[key];
    if (typeof value === 'number' && Number.isFinite(value)) saved[key] = value;
  }

  const ports: Record<string, string> = {};
  for (const e of board.edges) if (e.port) ports[e.key] = e.port;

  const robberHex = board.hexes[board.robberHexId];
  return {
    v: 1,
    id: `custom_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    name: cleanPresetName(name),
    savedAt: Date.now(),
    settings: saved,
    hexes: board.hexes.map(h => [h.q, h.r, h.type, h.number ?? 0, h.ext?.hidden ? 1 : 0] as PresetHex),
    ports,
    robber: robberHex ? [robberHex.q, robberHex.r] : null
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

  const board = buildTopology(inits, { ports, isLand });

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

  return { board, settings: mergeSettings(input, old), name: cleanPresetName(raw.name) };
}
