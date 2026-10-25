import { describe, expect, it } from 'vitest';
import { computeVP, createGame, dispatch, getPlayer, makeCtx } from '../src/shared';
import type { Board, GameState } from '../src/shared';
import { longestRoadFor } from '../src/packs/base/longestRoad';
import { canPlaceSettlement } from '../src/packs/base/placement';
import { victimsOnHex } from '../src/packs/base/robbing';
import { tradeRatios } from '../src/packs/base/trading';
import { registry } from '../src/server/runtime';

/** A fresh game with fixed seat order: p1, p2, ... */
function newGame(n = 2): GameState {
  return createGame(registry, {
    players: Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` })),
    seed: 1,
    shuffleSeats: false
  });
}

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
    const g = newGame();
    const ctx = makeCtx(g, registry);
    const v0 = g.board.vertices[0];
    v0.piece = { owner: 'p1', type: 'settlement' };

    for (const adj of v0.adjacentVertices) {
      expect(canPlaceSettlement(ctx, 'p1', adj, 'setup')).toBe(false);
    }
    const far = g.board.vertices.find(v => v.id !== 0 && !v0.adjacentVertices.includes(v.id))!;
    expect(canPlaceSettlement(ctx, 'p1', far.id, 'setup')).toBe(true);
    // Outside setup, a settlement also needs a connected road
    expect(canPlaceSettlement(ctx, 'p1', far.id, 'build')).toBe(false);
  });

  it('counts city as 2 VP and settlement as 1', () => {
    const g = newGame();
    g.board.vertices[0].piece = { owner: 'p1', type: 'settlement' };
    g.board.vertices[10].piece = { owner: 'p1', type: 'city' };
    expect(computeVP(g, registry, getPlayer(g, 'p1')!, false)).toBe(3);
  });

  it('counts hidden VP cards only when requested', () => {
    const g = newGame();
    const p = getPlayer(g, 'p1')!;
    p.devCards = ['vp', 'knight'];
    p.newDevCards = ['vp'];
    expect(computeVP(g, registry, p, false)).toBe(0);
    expect(computeVP(g, registry, p, true)).toBe(2);
  });

  it('computes longest road for a 5-road chain', () => {
    const g = newGame();
    const path = findPath(g.board, 5);
    expect(path).not.toBeNull();
    for (const eId of path!) g.board.edges[eId].piece = { owner: 'p1', type: 'road' };
    expect(longestRoadFor(makeCtx(g, registry), 'p1')).toBe(5);
  });

  it('gives 4:1 by default and better ratios on a port', () => {
    const g = newGame();
    expect(tradeRatios(g, registry, 'p1')).toEqual({ wood: 4, brick: 4, sheep: 4, wheat: 4, ore: 4 });

    const portVertex = g.board.vertices.find(v => v.port)!;
    expect(portVertex).toBeDefined();
    portVertex.piece = { owner: 'p1', type: 'settlement' };
    const ratios = tradeRatios(g, registry, 'p1');
    const port = registry.ports.get(portVertex.port!)!;
    if (port.resource === null) {
      expect(Object.values(ratios).every(r => r <= port.ratio)).toBe(true);
    } else {
      expect(ratios[port.resource]).toBe(port.ratio);
    }
  });

  it('reveals a fog tile and grants 1 resource when a road touches it', () => {
    const g = newGame();
    g.phase = 'main';
    g.turnCount = 1;
    const p = getPlayer(g, 'p1')!;
    p.resources.wood = 1;
    p.resources.brick = 1;

    const hex = g.board.hexes.find(h => registry.tiles.get(h.type)?.land && h.number !== null)!;
    hex.type = 'ore';
    hex.number = 8;
    hex.ext = { ...hex.ext, hidden: true, maskAs: 'fog' };

    const vId = hex.vertexIds[0];
    g.board.vertices[vId].piece = { owner: 'p1', type: 'settlement' };
    const edgeId = g.board.vertices[vId].edgeIds[0];

    const res = dispatch(g, registry, { type: 'build', playerId: 'p1', payload: { piece: 'road', loc: edgeId } });
    expect(res.ok).toBe(true);
    expect(hex.ext.hidden).toBeUndefined();
    expect(p.resources.ore).toBe(1);
  });

  it('prompts the thief to choose when the robber hex has 2 or more opponents', () => {
    const g = newGame(3);
    g.phase = 'robber';
    g.turnCount = 1;
    const p1 = getPlayer(g, 'p1')!;
    const p2 = getPlayer(g, 'p2')!;
    const p3 = getPlayer(g, 'p3')!;
    p2.resources.wheat = 2;
    p3.resources.sheep = 3;

    const target = g.board.hexes.find(
      h => h.id !== g.board.robberHexId && registry.tiles.get(h.type)?.land && !h.ext.hidden && h.vertexIds.length === 6
    )!;
    expect(target).toBeDefined();
    g.board.vertices[target.vertexIds[0]].piece = { owner: 'p2', type: 'settlement' };
    g.board.vertices[target.vertexIds[2]].piece = { owner: 'p3', type: 'settlement' };

    const moved = dispatch(g, registry, { type: 'move_robber', playerId: 'p1', payload: { hexId: target.id } });
    expect(moved.ok).toBe(true);
    expect(g.phase).toBe('robber_steal');
    expect(victimsOnHex(g, target.id, 'p1')).toEqual(expect.arrayContaining(['p2', 'p3']));

    const stolen = dispatch(g, registry, { type: 'steal', playerId: 'p1', payload: { victimId: 'p3' } });
    expect(stolen.ok).toBe(true);
    expect(g.phase).toBe('main');
    expect(p1.resources.sheep).toBe(1);
    expect(p3.resources.sheep).toBe(2);
  });

  it('rejects actions from the wrong player and in the wrong phase', () => {
    const g = newGame();
    // Setup: only p1 may place the first settlement, and only a settlement.
    const wrongPlayer = dispatch(g, registry, { type: 'build', playerId: 'p2', payload: { piece: 'settlement', loc: 0 } });
    expect(wrongPlayer.ok).toBe(false);
    const wrongPiece = dispatch(g, registry, { type: 'build', playerId: 'p1', payload: { piece: 'road', loc: 0 } });
    expect(wrongPiece.ok).toBe(false);
    const wrongPhase = dispatch(g, registry, { type: 'roll', playerId: 'p1', payload: {} });
    expect(wrongPhase.ok).toBe(false);
  });

  it('stacks multiple trade offers with newest on top and prunes offers when cards are spent', () => {
    const g = newGame(3);
    g.phase = 'main';
    g.turnCount = 1;
    const p1 = getPlayer(g, 'p1')!;
    const p2 = getPlayer(g, 'p2')!;
    const p3 = getPlayer(g, 'p3')!;
    p1.resources.wood = 1;
    p2.resources.brick = 1;
    p3.resources.wheat = 1;

    // Offer 1 (oldest)
    expect(dispatch(g, registry, {
      type: 'propose_trade',
      playerId: 'p1',
      payload: { offer: { wood: 1 }, request: { brick: 1, wheat: 1 } }
    }).ok).toBe(true);

    // Offer 2 (newest, pushed to top of g.trades)
    expect(dispatch(g, registry, {
      type: 'propose_trade',
      playerId: 'p1',
      payload: { offer: { wood: 1 }, request: { brick: 1 } }
    }).ok).toBe(true);

    expect(g.trades.length).toBe(2);
    expect(g.trades[0].id).toBe(2);
    expect(g.trades[1].id).toBe(1);
    expect(g.trade?.id).toBe(2);

    // p2 accepts Offer 2 specifically
    expect(dispatch(g, registry, {
      type: 'respond_trade',
      playerId: 'p2',
      payload: { tradeId: 2, decision: 'accepted' }
    }).ok).toBe(true);

    // p1 confirms Offer 2 with p2; Offer 1 is automatically pruned because p1 spent their only wood
    expect(dispatch(g, registry, {
      type: 'confirm_trade',
      playerId: 'p1',
      payload: { tradeId: 2, partnerId: 'p2' }
    }).ok).toBe(true);

    expect(p1.resources.wood).toBe(0);
    expect(p1.resources.brick).toBe(1);
    expect(g.trades.length).toBe(0);
    expect(g.trade).toBeNull();
    expect(p1.stats.tradesProposed).toBe(2);
    expect(p1.stats.playerTrades).toBe(1);
    expect(p2.stats.playerTrades).toBe(1);
    expect(p1.stats.resTradedOut).toBe(1);
    expect(p1.stats.resTradedIn).toBe(1);
    expect(p1.stats.res_brick).toBe(1);
  });
});

