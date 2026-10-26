// Loose client-side view types. Tightened when shared engine types arrive (Step 2).
export type Resources = Record<string, number>;

export interface PlayerView {
  id: string;
  name: string;
  avatar: string;
  color: string;
  isBot: boolean;
  difficulty: string | null;
  resourceCount: number;
  resources?: Resources;
  devCardCount: number;
  devCards?: string[];
  newDevCards?: string[];
  knightsPlayed: number;
  longestRoadLength: number;
  goldPending: number;
  discardPending: number;
  freeRoads: number;
  playedDevCardThisTurn: boolean;
  settlementsLeft: number;
  citiesLeft: number;
  roadsLeft: number;
  vp: number;
  /** What other players see (differs from `vp` only for your own hidden VP cards). */
  publicVp?: number;
  stats?: {
    resourcesEarned: number;
    tradesMade: number;
    vpBreakdown?: {
      settlement: number;
      city: number;
      devVp: number;
      largestArmy: number;
      longestRoad: number;
    };
    resCards?: {
      produced: number;
      tradedIn: number;
      tradedOut: number;
      stolen: number;
      robbed: number;
      discarded: number;
      devGain: number;
    };
    devCards?: {
      bought: number;
      played: number;
      knight: number;
      vp: number;
      roadBuilding: number;
      yearOfPlenty: number;
      monopoly: number;
    };
    activity?: {
      turns: number;
      rolls: number;
      sevens: number;
      roadsOnBoard: number;
      settlementsOnBoard: number;
      citiesOnBoard: number;
      roadsBuilt: number;
      settlementsBuilt: number;
      citiesBuilt: number;
      robberMoves: number;
      tradesProposed: number;
      playerTrades: number;
      bankTrades: number;
      longestRoad: number;
      knightsPlayed: number;
    };
    byResource?: Record<string, number>;
  };
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
  kind: 'steal' | 'playerTrade' | 'bankTrade' | 'buyDev' | 'discard' | 'monopoly' | 'gold';
  secretForOthers?: boolean;
}

export interface TradeView {
  id: number;
  fromId: string;
  fromName: string;
  fromAvatar: string;
  fromColor: string;
  offer: Resources;
  request: Resources;
  responses: Record<string, string>;
  createdAt?: number;
  expiresAt?: number;
  durationMs?: number;
  /** Time left when this state was sent (ms). */
  remainingMs?: number;
}

export interface GameState {
  code: string;
  hostId: string;
  status: string;
  /** Lobby only: the host is on the world setup page, so everyone else waits and nobody new can join. */
  setup?: boolean;
  settings: any;
  board: { hexes: any[]; vertices: any[]; edges: any[]; robberHexId: number };
  bank: Resources;
  /** Cards of each resource in the game (bank + all hands); null in the lobby. */
  bankSupply?: Resources | null;
  devDeckCount: number;
  turnIndex: number;
  currentPlayerId: string;
  phase: string;
  robberVictims?: string[];
  lastSetupVertexId?: number | null;
  lastDice: number[];
  lastRollHexIds?: number[];
  recentProductions?: RecentProduction[];
  recentTransfers?: RecentTransfer[];
  diceStats?: Record<number, number>;
  turnCount?: number;
  startedAt?: number | null;
  finishedAt?: number | null;
  longestRoadOwner: string | null;
  largestArmyOwner: string | null;
  activeTrade: TradeView | null;
  activeTrades?: TradeView[];
  /** Turn clock of the human on turn (null when timers are off or a bot is playing). */
  turnClock?: { playerId: string; remainingMs: number } | null;
  winner: { id: string; name: string; vp: number; color: string } | null;
  logs: { text: string; color: string | null }[];
  chats: { sender: string; avatar: string; color: string; text: string }[];
  tradeRatios: Resources;
  players: PlayerView[];
  /** How the lobby map was made (lobby only; null for blank, snapshot and legacy boards). */
  mapMeta?: MapMetaView | null;
}

// ---- Map menu (lobby) ----

export interface MapParamView { id: string; label: string; min: number; max: number; step: number; default: number }

export interface MapOptionView {
  id: string;
  label: string;
  description: string;
  stage: 'shape' | 'terrain' | 'numbers' | 'extras';
  phase?: string;
  slot?: string;
  default: boolean;
  conflicts: string[];
  requires: string[];
  met: boolean;
  secret: boolean;
  params: MapParamView[];
}

export interface MapOptionsView {
  options: MapOptionView[];
  quickStarts: { id: string; label: string; blank: boolean }[];
}

export interface MapIssueView { code: string; message: string }

export interface MapMetaView {
  recipe: { g: number; seed: string; radius: number; picks: string[]; params: Record<string, number> };
  /** The one-line share code (`hx1;...`). */
  code: string;
  report: {
    ok: boolean;
    errors: MapIssueView[];
    warnings: MapIssueView[];
    degraded?: boolean;
    stats: { land: number; landmasses: number[]; lakes: number; spots: number; landmassSpots?: number[]; ports: number; fairness: number; boardAttempts?: number };
  };
  /** A paint event touched the board, so the seed no longer describes it. */
  edited: boolean;
  /** Made by another generator version: the seed may now give a different map. */
  otherVersion: boolean;
}
