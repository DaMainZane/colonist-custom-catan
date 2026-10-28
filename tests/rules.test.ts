import { describe, expect, it } from 'vitest';
import { computeVP, createGame, dispatch, getPlayer, legalActions, makeCtx } from '../src/shared';
import type { Board, GameState } from '../src/shared';
import { longestRoadFor } from '../src/packs/base/longestRoad';
import { canPlaceSettlement } from '../src/packs/base/placement';
import { victimsOnHex } from '../src/packs/base/robbing';
import { tradeRatios } from '../src/packs/base/trading';
import { defaultSettings, registry, rulesFromSettings, scaledSupply, settingsForPlayers } from '../src/server/runtime';
import { createRoom, rooms } from '../src/server/rooms';
import { tryReclaimSeat } from '../src/server/socket';
import { startGame as startServerGame } from '../src/server/game';

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

describe('bank and dev deck auto-scale', () => {
  const deckTotal = (s: ReturnType<typeof scaledSupply>) =>
    s.devKnights + s.devVp + s.devRoadBuilding + s.devYearOfPlenty + s.devMonopoly;

  it('keeps the standard numbers on the standard 19 land tiles', () => {
    for (const players of [2, 3, 4]) {
      expect(scaledSupply(players, 19)).toEqual({
        bankResourcePerType: 19,
        devKnights: 14,
        devVp: 5,
        devRoadBuilding: 2,
        devYearOfPlenty: 2,
        devMonopoly: 2
      });
    }
    // Unknown board size (0) must also fall back to the table floor
    expect(scaledSupply(4, 0).bankResourcePerType).toBe(19);
  });

  it('never goes below the player-count floor', () => {
    const six = scaledSupply(6, 19);
    expect(six.bankResourcePerType).toBe(24);
    expect(six.devKnights).toBe(20);
    expect(deckTotal(six)).toBe(34);
  });

  it('grows the bank and deck on a bigger board', () => {
    const small = scaledSupply(4, 19);
    const big = scaledSupply(4, 61);
    expect(big.bankResourcePerType).toBeGreaterThan(small.bankResourcePerType);
    expect(deckTotal(big)).toBeGreaterThan(deckTotal(small));
    expect(big.devVp).toBeGreaterThanOrEqual(5);
    expect(big.devRoadBuilding).toBeGreaterThanOrEqual(2);
  });

  it('only rescales settings the host left at the standard values', () => {
    const untouched = settingsForPlayers(defaultSettings(), 4, 61);
    expect(untouched.bankResourcePerType).toBeGreaterThan(19);

    const custom = { ...defaultSettings(), bankResourcePerType: 25 };
    expect(settingsForPlayers(custom, 4, 61)).toBe(custom);
  });
});

describe('player trade needs someone who holds the card', () => {
  const setup = () => {
    const g = newGame(3);
    g.phase = 'main';
    g.turnCount = 1;
    const [p1, p2, p3] = ['p1', 'p2', 'p3'].map(id => getPlayer(g, id)!);
    for (const p of [p1, p2, p3]) for (const k of Object.keys(p.resources)) p.resources[k] = 0;
    p1.resources.wood = 2;
    return { g, p1, p2, p3 };
  };

  it('refuses a request when no other player holds that resource, whatever the bank says', () => {
    const { g, p1 } = setup();
    p1.resources.brick = 3; // the proposer's own cards do not count
    g.bank.brick = 0;
    const res = dispatch(g, registry, { type: 'propose_trade', playerId: 'p1', payload: { offer: { wood: 1 }, request: { brick: 1 } } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/No one has any/);
  });

  it('allows it as soon as one other player holds the card (right after a roll, scaled bank or not)', () => {
    const { g, p3 } = setup();
    g.bank.brick = 24;
    p3.resources.brick = 1;
    const res = dispatch(g, registry, { type: 'propose_trade', playerId: 'p1', payload: { offer: { wood: 1 }, request: { brick: 1 } } });
    expect(res.ok).toBe(true);
  });
});

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

  it('scales settlement, city, and road limits with VP setting and charges double above base limits', () => {
    const g = createGame(registry, {
      players: [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }],
      rules: { vpToWin: 20 },
      seed: 1,
      shuffleSeats: false
    });
    expect(g.rules.pieceLimits).toEqual({
      road: 30,
      settlement: 10,
      city: 8
    });

    g.phase = 'main';
    g.turnCount = 1;
    const p1 = getPlayer(g, 'p1')!;
    expect(p1.pieces.road).toBe(30);
    expect(p1.pieces.settlement).toBe(10);
    expect(p1.pieces.city).toBe(8);

    // Place 15 active roads for p1 on the board so the 16th road is above the base limit (15)
    for (let i = 0; i < 15; i++) {
      g.board.edges[i].piece = { owner: 'p1', type: 'road' };
    }
    p1.pieces.road = 15;

    // Find an empty edge connected to one of p1's existing roads
    const connEdge = g.board.edges.find(e =>
      !e.piece &&
      (g.board.vertices[e.v1].edgeIds.some(oe => g.board.edges[oe].piece?.owner === 'p1') ||
       g.board.vertices[e.v2].edgeIds.some(oe => g.board.edges[oe].piece?.owner === 'p1'))
    )!;
    expect(connEdge).toBeDefined();

    // Normal 1x road cost (1 wood, 1 brick) should be rejected when building above the 15-road base limit
    p1.resources.wood = 1;
    p1.resources.brick = 1;
    const failRoad = dispatch(g, registry, { type: 'build', playerId: 'p1', payload: { piece: 'road', loc: connEdge.id } });
    expect(failRoad.ok).toBe(false);

    // Double road cost (2 wood, 2 brick) succeeds and deducts 2 wood + 2 brick
    p1.resources.wood = 2;
    p1.resources.brick = 2;
    const okRoad = dispatch(g, registry, { type: 'build', playerId: 'p1', payload: { piece: 'road', loc: connEdge.id } });
    expect(okRoad.ok).toBe(true);
    expect(p1.resources.wood).toBe(0);
    expect(p1.resources.brick).toBe(0);
    expect(p1.pieces.road).toBe(14);
  });

  it('allows only Knight development cards to be played before rolling the dice', () => {
    const g = newGame(2);
    g.phase = 'roll';
    g.turnCount = 1;
    const p1 = getPlayer(g, 'p1')!;
    p1.devCards = ['knight', 'monopoly', 'yearOfPlenty', 'roadBuilding'];

    const legal = legalActions(g, registry, 'p1').filter(a => a.type === 'play_dev');
    expect(legal.every(a => a.payload.card === 'knight')).toBe(true);
    expect(legal.length).toBe(1);

    const monoRes = dispatch(g, registry, { type: 'play_dev', playerId: 'p1', payload: { card: 'monopoly', resource: 'wood' } });
    expect(monoRes.ok).toBe(false);
    if (!monoRes.ok) expect(monoRes.error).toMatch(/Only a Knight card can be played before rolling the dice/);

    const yopRes = dispatch(g, registry, { type: 'play_dev', playerId: 'p1', payload: { card: 'yearOfPlenty', r1: 'wood', r2: 'brick' } });
    expect(yopRes.ok).toBe(false);

    const rbRes = dispatch(g, registry, { type: 'play_dev', playerId: 'p1', payload: { card: 'roadBuilding' } });
    expect(rbRes.ok).toBe(false);

    const knightRes = dispatch(g, registry, { type: 'play_dev', playerId: 'p1', payload: { card: 'knight' } });
    expect(knightRes.ok).toBe(true);
    expect(g.phase).toBe('robber');
  });

  it('guides 2d6 rolls along the bell curve when fairDice is enabled', () => {
    const s = { ...defaultSettings(), fairDice: true };
    expect(rulesFromSettings(s).fairDice).toBe(true);

    const g = createGame(registry, {
      players: [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }],
      rules: { fairDice: true },
      seed: 42,
      shuffleSeats: false
    });
    for (let i = 0; i < 30; i++) {
      g.phase = 'roll';
      g.phaseStack = [];
      const res = dispatch(g, registry, { type: 'roll', playerId: 'p1', payload: {} });
      expect(res.ok).toBe(true);
    }
    // Over 30 rolls from a 36-card 2d6 shoe (with 6-card cut), 6/7/8 each appear multiple times and 2/12 at most once
    expect(g.diceStats[7] || 0).toBeGreaterThanOrEqual(3);
    expect(g.diceStats[6] || 0).toBeGreaterThanOrEqual(2);
    expect(g.diceStats[8] || 0).toBeGreaterThanOrEqual(2);
    expect(g.diceStats[2] || 0).toBeLessThanOrEqual(1);
    expect(g.diceStats[12] || 0).toBeLessThanOrEqual(1);
  });

  it('auto-denies incoming trade offers for human players who do not have the requested resources', () => {
    const g = newGame(3);
    g.phase = 'main';
    g.turnCount = 1;
    const p1 = getPlayer(g, 'p1')!;
    const p2 = getPlayer(g, 'p2')!;
    const p3 = getPlayer(g, 'p3')!;
    p1.isBot = false;
    p2.isBot = false;
    p3.isBot = false;
    p1.resources = { wood: 1, brick: 0, sheep: 0, wheat: 0, ore: 0 };
    p2.resources = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 }; // cannot afford brick
    p3.resources = { wood: 0, brick: 1, sheep: 0, wheat: 0, ore: 0 }; // holds brick

    const res = dispatch(g, registry, {
      type: 'propose_trade',
      playerId: 'p1',
      payload: { offer: { wood: 1 }, request: { brick: 1 } }
    });
    expect(res.ok).toBe(true);
    expect(g.trade?.responses.p2).toBe('declined');
    expect(g.trade?.responses.p3).toBe('pending');
  });

  it('reconnects a disconnected player back to their bot replacement seat and preserves core state', () => {
    const room = createRoom('sock_old', 'Alice');
    room.clientTokens = { tok_alice: 'sock_old' };
    room.lobbyPlayers.push({
      id: 'bot_1',
      name: 'Breeze',
      avatar: '🤖',
      color: '#2980b9',
      isBot: true,
      difficulty: 'Main'
    });
    startServerGame(room);
    const g = room.game!;
    const aliceSeat = g.players.find(p => p.id === 'sock_old')!;
    expect(aliceSeat).toBeDefined();

    // Grant tech state to sock_old, then simulate mid-game disconnect where a bot replacement takes over
    g.ext.core = { techs: { sock_old: ['bulwark.stockpiling'] } };
    room.disconnectedSeats = {
      sock_old: {
        playerId: 'sock_old',
        clientId: 'tok_alice',
        originalName: 'Alice',
        originalAvatar: aliceSeat.avatar,
        wasHost: true,
        disconnectedAt: Date.now()
      }
    };
    aliceSeat.isBot = true;
    aliceSeat.difficulty = 'Secondary';
    aliceSeat.name = 'Alice (Bot)';

    const fakeSocket = {
      id: 'sock_new',
      join: () => {},
      emit: () => {}
    };
    const reclaimed = tryReclaimSeat(room, fakeSocket, 'tok_alice', 'Alice');
    expect(reclaimed).toBe(true);

    const restored = g.players.find(p => p.id === 'sock_new')!;
    expect(restored).toBeDefined();
    expect(restored.isBot).toBe(false);
    expect(restored.difficulty).toBeNull();
    expect(restored.name).toBe('Alice');
    expect(g.ext.core.techs.sock_new).toEqual(['bulwark.stockpiling']);
    expect(room.hostId).toBe('sock_new');

    delete rooms[room.code];
  });
});



