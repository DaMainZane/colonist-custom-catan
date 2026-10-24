// MODULE: server room types (lobby settings, room, client-facing effects) | USED BY: server/*, bots, sim
import type { Board, GameState } from '../shared';

/** Lobby settings the client edits. The adapter maps them to engine rules (runtime.rulesFromSettings). */
export interface Settings {
  boardRadius: number;
  goldTiles: number;
  desertTiles: number;
  fogTiles?: number;
  vpToWin: number;
  maxPlayers: number;
  cardDiscardLimit: number;
  bankResourcePerType: number;
  devKnights: number;
  devVp: number;
  devRoadBuilding: number;
  devYearOfPlenty: number;
  devMonopoly: number;
  maxSettlements: number;
  maxCities: number;
  maxRoads: number;
  gameSpeed?: number;
}

export interface LobbyPlayer {
  id: string;
  name: string;
  avatar: string;
  color: string;
  isBot: boolean;
  difficulty: string | null;
}

export interface ChatEntry {
  sender: string;
  avatar: string;
  color: string;
  text: string;
}

export interface RecentProduction {
  hexId: number;
  playerId: string;
  resource: string;
  amount: number;
}

export interface RecentTransfer {
  from: string;
  to: string;
  resource: string;
  amount: number;
  kind: string;
  secretForOthers?: boolean;
}

/** Things the client animates once (cleared after every broadcast), except lastRollHexIds. */
export interface Effects {
  lastRollHexIds: number[];
  recentProductions: RecentProduction[];
  recentTransfers: RecentTransfer[];
}

export interface Room {
  code: string;
  hostId: string;
  settings: Settings;
  /** Roster while in the lobby. During a game the engine's players are the roster. */
  lobbyPlayers: LobbyPlayer[];
  /** Lobby board (editable). Copied into the game at start. */
  board: Board;
  /** null = lobby. */
  game: GameState | null;
  lobbyLog: { text: string; color: string | null }[];
  chats: ChatEntry[];
  fx: Effects;
  startedAt: number | null;
  finishedAt: number | null;
  botTimer?: any;
  /** Trade id the bot-proposal timeout was scheduled for. */
  tradeTimerFor?: number | null;
  tradeTimer?: any;
  /** Per-trade expiration timers and timestamps keyed by trade id. */
  tradeTimers?: Map<number, { createdAt: number; expiresAt: number; durationMs: number; timer: any }>;
}

/** Legacy status strings the client switches on. */
export type RoomStatus = 'LOBBY' | 'SETUP' | 'PLAYING' | 'GAMEOVER';
