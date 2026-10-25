// MODULE: rooms (registry of rooms, lobby roster, status, helpers over the engine game) | USED BY: server/*, bots
import { AVATARS, PLAYER_COLORS } from '../shared';
import type { PlayerState } from '../shared';
import { newBoard } from './lobby';
import { defaultSettings } from './runtime';
import { clearTurnClock } from './turnClock';
import type { LobbyPlayer, Room, RoomStatus } from './types';

export const rooms: Record<string, Room> = {};

export function createLobbyPlayer(id: string, name: string, index: number, isBot = false): LobbyPlayer {
  return {
    id,
    name,
    avatar: isBot ? '🤖' : AVATARS[index % AVATARS.length],
    color: PLAYER_COLORS[index % PLAYER_COLORS.length],
    isBot,
    difficulty: isBot ? 'ADVANCED HARD' : null
  };
}

/** First avatar nobody in the lobby is using yet (falls back to the first one if all are taken). */
export function freeAvatar(room: Room): string {
  return AVATARS.find(a => !room.lobbyPlayers.some(p => p.avatar === a)) ?? AVATARS[0];
}

export function createRoom(hostId: string, hostName: string): Room {
  let code = '';
  do {
    code = Math.random().toString(36).substring(2, 7).toUpperCase();
  } while (rooms[code] || code.length < 5);

  const settings = defaultSettings();
  const room: Room = {
    code,
    hostId,
    settings,
    lobbyPlayers: [createLobbyPlayer(hostId, hostName, 0, false)],
    board: newBoard(settings),
    game: null,
    lobbyLog: [{ text: `Lobby created. Bots are set to ADVANCED HARD.`, color: '#1565c0' }],
    chats: [{ sender: hostName, avatar: AVATARS[0], color: PLAYER_COLORS[0], text: 'Welcome! Customize the board or add Hard Bots to start.' }],
    fx: { lastRollHexIds: [], recentProductions: [], recentTransfers: [] },
    startedAt: null,
    finishedAt: null
  };
  rooms[code] = room;
  return room;
}

export function roomStatus(room: Room): RoomStatus {
  const g = room.game;
  if (!g) return 'LOBBY';
  if (g.phase === 'gameover') return 'GAMEOVER';
  if (g.phase === 'setup_settlement' || g.phase === 'setup_road') return 'SETUP';
  // A pick (gold) during setup keeps the status SETUP until the first turn begins.
  if (g.turnCount === 0) return 'SETUP';
  return 'PLAYING';
}

/** Lobby log before the game, the engine log during it. */
export function addLobbyLog(room: Room, text: string, color: string | null = null): void {
  room.lobbyLog.push({ text, color });
  if (room.lobbyLog.length > 80) room.lobbyLog.shift();
}

/** The people in the room: engine players during a game, the lobby roster before it. */
export function roster(room: Room): { id: string; name: string; isBot: boolean }[] {
  return room.game ? room.game.players : room.lobbyPlayers;
}

export function humanIds(room: Room): string[] {
  return roster(room).filter(p => !p.isBot).map(p => p.id);
}

export function enginePlayer(room: Room, id: string): PlayerState | undefined {
  return room.game?.players.find(p => p.id === id);
}

export function clearBotTimers(room: Room): void {
  if (room.botTimer) clearTimeout(room.botTimer);
  if (room.tradeTimer) clearTimeout(room.tradeTimer);
  if (room.tradeTimers) {
    for (const entry of room.tradeTimers.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    room.tradeTimers.clear();
  }
  room.botTimer = undefined;
  room.tradeTimer = undefined;
  room.tradeTimerFor = null;
  clearTurnClock(room);
}
