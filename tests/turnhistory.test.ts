import { describe, expect, it } from 'vitest';
import { recordTurnHistory } from '../src/server/turnHistory';
import { createGame } from '../src/shared';
import { defaultSettings, rulesFromSettings, gameRegistry } from '../src/server/runtime';
import type { Room } from '../src/server/types';

function makeMockRoom(): Room {
  const settings = defaultSettings();
  const rules = rulesFromSettings(settings);
  const reg = gameRegistry(rules);
  const game = createGame(reg, {
    players: [
      { id: 'p1', name: 'Alice', avatar: '👩', color: '#e74c3c' },
      { id: 'p2', name: 'Bob', avatar: '🧔', color: '#3498db' }
    ]
  });

  return {
    code: 'TEST1',
    hostId: 'p1',
    settings,
    lobbyPlayers: [
      { id: 'p1', name: 'Alice', avatar: '👩', color: '#e74c3c', isBot: false, difficulty: null },
      { id: 'p2', name: 'Bob', avatar: '🧔', color: '#3498db', isBot: true, difficulty: 'Main' }
    ],
    spectators: [],
    board: game.board,
    game,
    lobbyLog: [],
    chats: [],
    fx: { lastRollHexIds: [], recentProductions: [], recentTransfers: [] },
    startedAt: Date.now(),
    finishedAt: null,
    turnHistory: []
  };
}

describe('Turn History recorder & round summarizer', () => {
  it('records setup phase placements under round 0 (Setup Phase)', () => {
    const room = makeMockRoom();
    room.game!.phase = 'setup_settlement';
    room.game!.turnCount = 0;

    recordTurnHistory(room, 'p1', 'placeSettlement', { piece: 'settlement' }, [
      { type: 'built', data: { piece: 'settlement', vertexId: 10, playerId: 'p1' } }
    ]);

    recordTurnHistory(room, 'p1', 'placeRoad', { piece: 'road' }, [
      { type: 'built', data: { piece: 'road', edgeId: 15, playerId: 'p1' } }
    ]);

    expect(room.turnHistory).toHaveLength(1);
    const setupRound = room.turnHistory![0];
    expect(setupRound.round).toBe(0);
    expect(setupRound.title).toBe('Setup Phase');
    expect(setupRound.turns).toHaveLength(1);
    expect(setupRound.turns[0].playerId).toBe('p1');
    expect(setupRound.turns[0].actions).toHaveLength(2);
    expect(setupRound.turns[0].actions[0].category).toBe('build');
    expect(setupRound.turns[0].actions[0].text).toContain('Settlement');
    expect(setupRound.turns[0].actions[1].text).toContain('Road');
  });

  it('records rolls, consolidates productions, and tracks builds and dev cards during normal rounds', () => {
    const room = makeMockRoom();
    room.game!.phase = 'main';
    room.game!.round = 1;
    room.game!.turnCount = 1;

    // Alice rolls an 8
    recordTurnHistory(room, 'p1', 'rollDice', {}, [
      { type: 'rolled', data: { sum: 8, d1: 4, d2: 4, hexIds: [2] } },
      { type: 'produced', data: { playerId: 'p1', resource: 'wheat', amount: 1 } },
      { type: 'produced', data: { playerId: 'p1', resource: 'wheat', amount: 1 } },
      { type: 'produced', data: { playerId: 'p1', resource: 'wood', amount: 1 } }
    ]);

    // Alice builds a road
    recordTurnHistory(room, 'p1', 'buildRoad', { piece: 'road' }, [
      { type: 'built', data: { piece: 'road', edgeId: 22, playerId: 'p1' } }
    ]);

    // Alice plays a knight
    recordTurnHistory(room, 'p1', 'playDevCard', { card: 'knight' }, [
      { type: 'devPlayed', data: { card: 'knight', playerId: 'p1' } },
      { type: 'robberMoved', data: { hexId: 5, playerId: 'p1' } },
      { type: 'transferred', data: { kind: 'steal', from: 'p2', to: 'p1', amount: 1 } }
    ]);

    expect(room.turnHistory).toHaveLength(1);
    const r1 = room.turnHistory![0];
    expect(r1.round).toBe(1);
    expect(r1.title).toBe('Round 1');
    expect(r1.turns).toHaveLength(1);

    const aliceTurn = r1.turns[0];
    expect(aliceTurn.playerId).toBe('p1');
    // Expected actions: Roll 8, Consolidated Production (+2 Wheat, +1 Wood), Built Road, Played Knight, Moved Robber, Stole resource
    expect(aliceTurn.actions).toHaveLength(6);

    expect(aliceTurn.actions[0].category).toBe('roll');
    expect(aliceTurn.actions[0].text).toBe('Rolled 8 (4 + 4)');

    expect(aliceTurn.actions[1].category).toBe('produce');
    expect(aliceTurn.actions[1].text).toContain('+2 Wheat');
    expect(aliceTurn.actions[1].text).toContain('+1 Wood');

    expect(aliceTurn.actions[2].category).toBe('build');
    expect(aliceTurn.actions[2].text).toBe('Built Road');

    expect(aliceTurn.actions[3].category).toBe('dev');
    expect(aliceTurn.actions[3].badge).toBe('Knight');

    expect(aliceTurn.actions[4].category).toBe('rob');
    expect(aliceTurn.actions[4].text).toContain('hex #5');

    expect(aliceTurn.actions[5].category).toBe('rob');
    expect(aliceTurn.actions[5].text).toContain('Bob');
  });

  it('records trades, discards on 7, and advances across multiple rounds', () => {
    const room = makeMockRoom();
    room.game!.phase = 'main';
    room.game!.round = 1;
    room.game!.turnCount = 1;

    // Trade with bank
    recordTurnHistory(room, 'p1', 'tradeBank', {}, [
      { type: 'transferred', data: { kind: 'bankTrade', from: 'p1', to: 'bank', amount: 4 } }
    ]);

    // Pass turn to Bob
    recordTurnHistory(room, 'p1', 'endTurn', {}, []);

    // Round 2: Bob rolls 7
    room.game!.round = 2;
    room.game!.turnCount = 2;
    recordTurnHistory(room, 'p2', 'rollDice', {}, [
      { type: 'rolled', data: { sum: 7, d1: 4, d2: 3 } },
      { type: 'transferred', data: { kind: 'discard', from: 'p1', to: 'bank', amount: 4 } }
    ]);

    expect(room.turnHistory).toHaveLength(2);
    expect(room.turnHistory![0].round).toBe(1);
    expect(room.turnHistory![1].round).toBe(2);

    const bobTurn = room.turnHistory![1].turns[0];
    expect(bobTurn.playerId).toBe('p2');
    expect(bobTurn.actions[0].text).toContain('Rolled 7 — Robber activated!');
    expect(bobTurn.actions[1].text).toContain('Alice discarded 4 cards');
  });
});
