// MODULE: lobby board tools (generate, presets, paint terrain/numbers/robber/ports) on the engine board | USED BY: server/socket, server/rooms
import { buildTopology, createRng, generateBoard, hexDistance, randomSeed } from '../shared';
import type { Board, HexInit } from '../shared';
import { fullRules, registry } from './runtime';
import type { Settings } from './types';

const NUMBERS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

const isLand = (type: string): boolean => !!registry.tiles.get(type)?.land;

export function newBoard(settings: Settings, preset = 'standard'): Board {
  return generateBoard(registry, fullRules(settings), createRng(randomSeed()), preset);
}

export function isPreset(id: any): boolean {
  return typeof id === 'string' && registry.presets.has(id);
}

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
