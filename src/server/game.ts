// MODULE: game runner (start/rematch, dispatch one action, turn engine events into client effects) | USED BY: server/socket, bots/scheduler
import { PLAYER_COLORS, createGame, dispatch } from '../shared';
import type { DispatchResult, GameEvent } from '../shared';
import { emitBotDialogue, emitGameStartDialogue } from './bots/dialogue';
import { noteBotEvents } from './bots/brain';
import { refreshMap } from './lobby';
import { addLobbyLog, clearBotTimers } from './rooms';
import { registry, rulesFromSettings, settingsForPlayers } from './runtime';
import { noteActionCompleted } from './turnClock';
import type { LobbyPlayer, Room } from './types';

/** Engine events -> the one-shot effects the client animates (productions, card transfers, rolled hexes). */
export function recordEffects(room: Room, events: GameEvent[]): void {
  const fx = room.fx;
  let hasRolled = false;
  let hasProduced = false;
  let hasTransfer = false;
  let hasRobberMove = false;

  for (const ev of events) {
    const d = ev.data ?? {};
    switch (ev.type) {
      case 'turnStarted':
        fx.lastRollHexIds = [];
        break;
      case 'rolled':
        fx.lastRollHexIds = d.hexIds ?? [];
        hasRolled = true;
        break;
      case 'produced':
        fx.recentProductions.push({ hexId: d.hexId, playerId: d.playerId, resource: d.resource, amount: d.amount });
        hasProduced = true;
        break;
      case 'transferred':
        fx.recentTransfers.push({
          from: d.from,
          to: d.to,
          resource: d.resource,
          amount: d.amount,
          kind: d.kind === 'pick' ? 'gold' : d.kind,
          ...(d.secret ? { secretForOthers: true } : {})
        });
        hasTransfer = true;
        break;
      case 'devBought':
        fx.recentTransfers.push({ from: 'bank', to: d.playerId, resource: 'dev', amount: 1, kind: 'buyDev' });
        hasTransfer = true;
        break;
      case 'robberMoved':
        hasRobberMove = true;
        break;
      case 'gameOver':
        room.finishedAt = Date.now();
        break;
    }
  }

  let animDelayMs = 0;
  if (hasRolled && hasProduced) {
    // Wait for dice shake + flying resource cards to land in all players' hands before any bot acts
    animDelayMs = 1550;
  } else if (hasProduced) {
    // Setup settlement initial resource production flight
    animDelayMs = 1150;
  } else if (hasRolled) {
    // Dice shake on a 7 roll or non-producing roll
    animDelayMs = 700;
  }
  if (hasTransfer) {
    animDelayMs = Math.max(animDelayMs, 1150);
  }
  if (hasRobberMove) {
    animDelayMs = Math.max(animDelayMs, 750);
  }
  if (animDelayMs > 0) {
    fx.animDelayMs = Math.max(fx.animDelayMs || 0, animDelayMs);
  }
}

/** Validates and applies one action for a player (human or bot). Never throws. */
export function runAction(room: Room, playerId: string, type: string, payload: any = {}): DispatchResult {
  const g = room.game;
  if (!g) return { ok: false, error: 'No game in progress' };
  const res = dispatch(g, registry, { type, playerId, payload });
  if (res.ok) {
    recordEffects(room, res.events);
    noteBotEvents(g, res.events);
    emitBotDialogue(room, playerId, type, res.events);
    noteActionCompleted(room, playerId);
  }
  else if (res.error.startsWith('Internal error')) console.error(`[engine] ${type} by ${playerId}: ${res.error}`);
  return res;
}

export function startGame(room: Room): string | null {
  if (room.game) return 'Game already started!';
  if (room.lobbyPlayers.length < 2) return 'Add at least 1 Bot or wait for a 2nd player!';
  // Up to 4 players keep the old loose check. Bigger tables need real room: 2 settlements each, ~4 blocked spots per settlement.
  const need = room.lobbyPlayers.length > 4 ? room.lobbyPlayers.length * 8 : room.lobbyPlayers.length * 4;
  if (room.board.vertices.length < need) return 'Map needs more land tiles for this player count!';

  room.game = createGame(registry, {
    players: room.lobbyPlayers.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, isBot: p.isBot, difficulty: p.difficulty })),
    rules: rulesFromSettings(settingsForPlayers(room.settings, room.lobbyPlayers.length, room.board.hexes.filter(h => h.type !== 'water').length)),
    board: structuredClone(room.board),
    shuffleSeats: true
  });
  room.fx = { lastRollHexIds: [], recentProductions: [], recentTransfers: [], animDelayMs: 0 };
  room.animatingUntil = 0;
  room.startedAt = Date.now();
  room.finishedAt = null;
  emitGameStartDialogue(room);
  return null;
}

export function rematch(room: Room): void {
  const g = room.game;
  clearBotTimers(room);
  if (g) {
    // Keep the roster (including bots that replaced disconnected players), in the shuffled seat order.
    room.lobbyPlayers = g.players.map<LobbyPlayer>((p, i) => ({
      id: p.id, name: p.name, avatar: p.avatar, color: PLAYER_COLORS[i % PLAYER_COLORS.length], isBot: p.isBot, difficulty: p.difficulty
    }));
  }
  room.game = null;
  room.fx = { lastRollHexIds: [], recentProductions: [], recentTransfers: [], animDelayMs: 0 };
  room.animatingUntil = 0;
  room.startedAt = null;
  room.finishedAt = null;
  // A new map each rematch, unless the host locked the seed (then the same recipe gives the same map again).
  if (!room.settings.mapSeedLocked) room.settings.mapSeed = '';
  refreshMap(room);
  addLobbyLog(room, '🔄 Returned to Lobby for a rematch!', '#1565c0');
}
