// MODULE: server room types (lobby settings, room, client-facing effects) | USED BY: server/*, bots, sim
import type { Board, GameState, MapRecipe, MapReport } from '../shared';
import type { BotChatLevel } from './bots/dialogue/types';

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
  /** Seconds a human gets per turn (0 = no turn timer). */
  turnTimerSec?: number;
  /** Seconds added to the turn clock each time the player completes an action. */
  turnIncrementSec?: number;
  /** Seconds a human-proposed trade offer stays open. */
  tradeTimerSec?: number;
  /** How much bots talk: off, quiet, normal (default) or chatty. Host only. */
  botChat?: BotChatLevel;
  /** Seed of the lobby map. Empty = roll a fresh one on the next generation (it is stored once rolled). */
  mapSeed?: string;
  /** Keep the seed on rematch. */
  mapSeedLocked?: boolean;
  /** Ticked menu ids (shape ops, styles, perks), in the order they were ticked. Defaults for empty slots are not stored. */
  mapPicks?: string[];
  /** Numeric params by id (see ParamDef), clamped to their ranges. */
  mapParams?: Record<string, number>;
}

/** How the lobby map was made, kept beside the board (the recipe is enough to rebuild it with the same generator version). */
export interface MapMeta {
  recipe: MapRecipe;
  report: MapReport;
  /** A paint event touched the board, so the seed no longer describes it. */
  edited: boolean;
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
  /** Recipe and report of the lobby board. Undefined for blank, legacy-preset and loaded-preset boards. */
  mapMeta?: MapMeta;
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
  /** Turn clock of the human whose turn it is (see turnClock.ts). */
  turnClock?: { key: string; playerId: string; deadline: number; timer?: any };
}

/** Legacy status strings the client switches on. */
export type RoomStatus = 'LOBBY' | 'SETUP' | 'PLAYING' | 'GAMEOVER';
