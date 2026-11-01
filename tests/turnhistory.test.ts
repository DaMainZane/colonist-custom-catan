import { describe, expect, it } from 'vitest';
import { recordTurnHistory, takeNewLogLines } from '../src/server/turnHistory';
import { createGame, currentPlayer } from '../src/shared';
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
    expect(aliceTurn.actions[1].text).toContain('Produced');
    expect(aliceTurn.actions[1].resources).toEqual([
      { resource: 'wheat', amount: 2, sign: '+' },
      { resource: 'wood', amount: 1, sign: '+' }
    ]);

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
    expect(bobTurn.actions[0].text).toContain('Rolled 7 — Robber activated');
    expect(bobTurn.actions[1].text).toContain('Alice discarded');
  });

  // BUG 4: a bot that only answers a trade got an empty turn card, which the Live Log drew as "Passed turn".
  it('does not create a turn for a player who only answers a trade', () => {
    const room = makeMockRoom();
    room.game!.phase = 'main';
    room.game!.round = 1;
    room.game!.turnCount = 1;

    recordTurnHistory(room, 'p1', 'roll', {}, [{ type: 'rolled', data: { sum: 6, d1: 3, d2: 3 } }]);
    recordTurnHistory(room, 'p2', 'respond_trade', { decision: 'declined' }, [
      { type: 'tradeResponse', data: { tradeId: 1, playerId: 'p2', decision: 'declined' } }
    ]);

    const turns = room.turnHistory![0].turns;
    expect(turns).toHaveLength(1);
    expect(turns[0].playerId).toBe('p1');
    expect(turns.every(t => t.actions.length > 0)).toBe(true);
    expect(turns.some(t => t.actions.some(a => a.text === 'Passed turn'))).toBe(false);
  });

  it('logs an accepted trade on the turn of the player whose turn it is, from their side', () => {
    const room = makeMockRoom();
    room.game!.phase = 'main';
    room.game!.round = 1;
    room.game!.turnCount = 1;

    // createGame randomizes the turn order, so take whoever's turn it is instead of assuming Alice goes first.
    const mover = currentPlayer(room.game!)!;
    const other = room.game!.players.find(p => p.id !== mover.id)!;

    recordTurnHistory(room, mover.id, 'roll', {}, [{ type: 'rolled', data: { sum: 6, d1: 3, d2: 3 } }]);
    recordTurnHistory(room, other.id, 'respond_trade', { decision: 'accepted' }, [
      { type: 'transferred', data: { kind: 'playerTrade', from: mover.id, to: other.id, resource: 'wood', amount: 1 } },
      { type: 'transferred', data: { kind: 'playerTrade', from: other.id, to: mover.id, resource: 'brick', amount: 1 } }
    ]);

    const turns = room.turnHistory![0].turns;
    expect(turns).toHaveLength(1);
    expect(turns[0].playerId).toBe(mover.id);
    const trade = turns[0].actions.find(a => a.category === 'trade')!;
    expect(trade.text).toBe(`Traded with ${other.name}`);
    expect(trade.resources).toEqual([
      { resource: 'wood', amount: 1, sign: '-' },
      { resource: 'brick', amount: 1, sign: '+' }
    ]);
  });

  // BUG 3: dev card use must say what it did.
  it('says which resource a Monopoly named and how many cards it took, once', () => {
    const room = makeMockRoom();
    room.game!.phase = 'main';
    room.game!.round = 1;
    room.game!.turnCount = 1;

    recordTurnHistory(room, 'p1', 'play_dev', { card: 'monopoly', resource: 'wheat' }, [
      { type: 'devPlayed', data: { card: 'monopoly', playerId: 'p1' } },
      { type: 'transferred', data: { kind: 'monopoly', from: 'p2', to: 'p1', resource: 'wheat', amount: 3 } }
    ]);

    const dev = room.turnHistory![0].turns[0].actions.filter(a => a.category === 'dev');
    expect(dev).toHaveLength(1);
    expect(dev[0].text).toBe('Played Monopoly on Wheat');
    expect(dev[0].resources).toEqual([{ resource: 'wheat', amount: 3, sign: '+' }]);
  });

  it('says when a Monopoly took nothing', () => {
    const room = makeMockRoom();
    room.game!.phase = 'main';
    room.game!.round = 1;
    room.game!.turnCount = 1;

    recordTurnHistory(room, 'p1', 'play_dev', { card: 'monopoly', resource: 'ore' }, [
      { type: 'devPlayed', data: { card: 'monopoly', playerId: 'p1' } }
    ]);

    expect(room.turnHistory![0].turns[0].actions[0].text).toBe('Played Monopoly on Ore (nothing taken)');
  });

  it('names the victim of a Knight steal, and the robber move, as the Knight\'s', () => {
    const room = makeMockRoom();
    room.game!.phase = 'main';
    room.game!.round = 1;
    room.game!.turnCount = 1;

    recordTurnHistory(room, 'p1', 'play_dev', { card: 'knight' }, [{ type: 'devPlayed', data: { card: 'knight', playerId: 'p1' } }]);
    recordTurnHistory(room, 'p1', 'move_robber', { hexId: 5 }, [{ type: 'robberMoved', data: { hexId: 5, playerId: 'p1' } }]);
    recordTurnHistory(room, 'p1', 'steal', { victimId: 'p2' }, [
      { type: 'transferred', data: { kind: 'steal', from: 'p2', to: 'p1', amount: 1, secret: true } }
    ]);

    const texts = room.turnHistory![0].turns[0].actions.map(a => a.text);
    expect(texts).toEqual(['Played Knight', 'Knight moved Robber to hex #5', 'Knight stole from Bob']);
  });

  it('does not call a robber steal after a roll a Knight steal', () => {
    const room = makeMockRoom();
    room.game!.phase = 'main';
    room.game!.round = 1;
    room.game!.turnCount = 1;

    recordTurnHistory(room, 'p1', 'play_dev', { card: 'knight' }, [{ type: 'devPlayed', data: { card: 'knight', playerId: 'p1' } }]);
    recordTurnHistory(room, 'p1', 'roll', {}, [{ type: 'rolled', data: { sum: 7, d1: 3, d2: 4 } }]);
    recordTurnHistory(room, 'p1', 'steal', { victimId: 'p2' }, [
      { type: 'transferred', data: { kind: 'steal', from: 'p2', to: 'p1', amount: 1, secret: true } }
    ]);

    const texts = room.turnHistory![0].turns[0].actions.map(a => a.text);
    expect(texts[texts.length - 1]).toBe('Robbed from Bob');
  });

  it('says what a Year of Plenty picked', () => {
    const room = makeMockRoom();
    room.game!.phase = 'main';
    room.game!.round = 1;
    room.game!.turnCount = 1;

    recordTurnHistory(room, 'p1', 'play_dev', { card: 'yearOfPlenty' }, [
      { type: 'devPlayed', data: { card: 'yearOfPlenty', playerId: 'p1' } }
    ]);
    recordTurnHistory(room, 'p1', 'pick', { resource: 'ore' }, [
      { type: 'transferred', data: { kind: 'pick', from: 'bank', to: 'p1', resource: 'ore', amount: 1 } }
    ]);
    recordTurnHistory(room, 'p1', 'pick', { resource: 'sheep' }, [
      { type: 'transferred', data: { kind: 'pick', from: 'bank', to: 'p1', resource: 'sheep', amount: 1 } }
    ]);

    const texts = room.turnHistory![0].turns[0].actions.map(a => a.text);
    expect(texts).toEqual(['Played Year of Plenty', 'Year of Plenty: picked Ore', 'Year of Plenty: picked Sheep']);
  });

  // BUG 2: one stream. Engine log lines with no event of their own go into the turn cards instead of a second feed.
  it('folds log lines that no event covers into the turn card, and drops the ones an event already covers', () => {
    const room = makeMockRoom();
    room.game!.phase = 'setup_settlement';
    room.game!.turnCount = 0;

    recordTurnHistory(room, 'p1', 'note', {}, [], [{ text: '🎲 Turn order randomized! Alice goes first!' }]);
    recordTurnHistory(room, 'p1', 'build', { piece: 'settlement' }, [
      { type: 'built', data: { piece: 'settlement', vertexId: 10, playerId: 'p1' } }
    ], [{ text: 'Alice placed a Settlement' }]);

    const acts = room.turnHistory![0].turns[0].actions;
    expect(acts.map(a => a.text)).toEqual(['🎲 Turn order randomized! Alice goes first!', 'Placed initial Settlement']);
    expect(acts[0].category).toBe('event');
  });

  it('hands out each engine log line once', () => {
    const room = makeMockRoom();
    room.game!.log.push({ text: 'one', color: null });
    expect(takeNewLogLines(room).map(l => l.text)).toContain('one');
    expect(takeNewLogLines(room)).toEqual([]);
    room.game!.log.push({ text: 'two', color: null });
    expect(takeNewLogLines(room).map(l => l.text)).toEqual(['two']);
  });
});
