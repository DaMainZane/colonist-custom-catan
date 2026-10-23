import { describe, expect, it } from 'vitest';
import { createRoom } from '../src/server/rooms';
import {
  canPlaceSettlement,
  computePlayerLongestRoad,
  getPlayerVP,
  getTradeRatios
} from '../src/server/rules';
import type { Board } from '../src/server/types';

function findPath(board: Board, length: number): number[] | null {
  const used = new Set<number>();
  const path: number[] = [];
  function dfs(vId: number): boolean {
    if (path.length === length) return true;
    for (const eId of board.vertices[vId].edgeIds) {
      if (used.has(eId)) continue;
      const e = board.edges[eId];
      used.add(eId);
      path.push(eId);
      if (dfs(e.v1 === vId ? e.v2 : e.v1)) return true;
      path.pop();
      used.delete(eId);
    }
    return false;
  }
  for (const v of board.vertices) {
    if (dfs(v.id)) return path;
  }
  return null;
}

describe('rules', () => {
  it('enforces the distance rule for settlements', () => {
    const room = createRoom('host', 'Host');
    const v0 = room.board.vertices[0];
    v0.building = { owner: 'host', type: 'settlement' };

    for (const adj of v0.adjacentVertices) {
      expect(canPlaceSettlement(room, 'host', adj, true)).toBe(false);
    }
    const far = room.board.vertices.find(v => v.id !== 0 && !v0.adjacentVertices.includes(v.id));
    expect(canPlaceSettlement(room, 'host', far.id, true)).toBe(true);
    // Outside setup, a settlement also needs a connected road
    expect(canPlaceSettlement(room, 'host', far.id, false)).toBe(false);
  });

  it('counts city as 2 VP and settlement as 1', () => {
    const room = createRoom('host', 'Host');
    const player = room.players[0];
    room.board.vertices[0].building = { owner: 'host', type: 'settlement' };
    room.board.vertices[10].building = { owner: 'host', type: 'city' };
    expect(getPlayerVP(room, player)).toBe(3);
  });

  it('counts hidden VP cards only when requested', () => {
    const room = createRoom('host', 'Host');
    const player = room.players[0];
    player.devCards = ['vp', 'knight'];
    player.newDevCards = ['vp'];
    expect(getPlayerVP(room, player, false)).toBe(0);
    expect(getPlayerVP(room, player, true)).toBe(2);
  });

  it('computes longest road for a 5-road chain', () => {
    const room = createRoom('host', 'Host');
    const path = findPath(room.board, 5);
    expect(path).not.toBeNull();
    for (const eId of path) room.board.edges[eId].road = 'host';
    expect(computePlayerLongestRoad(room.board, 'host')).toBe(5);
  });

  it('gives 4:1 by default and better ratios on a port', () => {
    const room = createRoom('host', 'Host');
    expect(getTradeRatios(room, 'host')).toEqual({ wood: 4, brick: 4, sheep: 4, wheat: 4, ore: 4 });

    const portVertex = room.board.vertices.find(v => v.port);
    expect(portVertex).toBeDefined();
    portVertex.building = { owner: 'host', type: 'settlement' };
    const ratios = getTradeRatios(room, 'host');
    if (portVertex.port === '3:1') {
      expect(Object.values(ratios).every(r => r <= 3)).toBe(true);
    } else {
      expect(ratios[portVertex.port]).toBe(2);
    }
  });
});
