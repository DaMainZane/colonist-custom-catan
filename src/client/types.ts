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
  /** Held wild tokens such as `{ fish: 2 }` (Tidebound). Same visibility as `resources`; undefined when none are held. */
  wildTokens?: Record<string, number>;
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
  bridgesLeft?: number;
  vp: number;
  /** What other players see (differs from `vp` only for your own hidden VP cards). */
  publicVp?: number;
  /** Effective cost of each piece type for this player, including 2x above-base scaling and active addon modifiers. */
  pieceCosts?: Record<string, Resources>;
  /** Your price to upgrade a rickety bridge to a full bridge. Only sent to you, and only when rickety bridges are in the game. */
  bridgeUpgradeCost?: Resources;
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

export interface SpectatorView {
  id: string;
  name: string;
  avatar: string;
  color: string;
}

export interface GameState {
  code: string;
  hostId: string;
  status: string;
  /** Lobby only: the host is on the world setup page, so everyone else waits and nobody new can join. */
  setup?: boolean;
  isSpectator?: boolean;
  spectators?: SpectatorView[];
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
  round?: number;
  turnHistory?: RoundSummary[];
  winner: { id: string; name: string; vp: number; color: string } | null;
  logs: { text: string; color: string | null }[];
  chats: { sender: string; avatar: string; color: string; text: string }[];
  tradeRatios: Resources;
  players: PlayerView[];
  /** How the lobby map was made (lobby only; null for blank, snapshot and legacy boards). */
  mapMeta?: MapMetaView | null;
  /** Your tech panel: one row per tech the game offers. Null when the tech tree is off or you are spectating. */
  techTree?: TechRowView[] | null;
  /** What your root techs can act on (harbor cities, Ground work tiles). Null on the same terms as `techTree`. */
  techActions?: TechActionsView | null;
  /** Tidebound Tides (T6): flooded tiles (`flood`) and tiles a turn from flooding (`flood-warn`), by hex id. Null when Tides is off. */
  hexOverlays?: Record<number, { kind: string; label?: string }> | null;
  /** Tidebound Tides (T6): tide facts for the title card, the warning and the heat map. Null when Tides is off. */
  tide?: TideView | null;
}

export interface TideView {
  level: number;
  levelName: string;
  round: number;
  /** A tide rose at the start of this round (for the title card). */
  rose: { round: number; spring: boolean; count: number } | null;
  /** A tide will rise at the next round start (shown during the last turn of this round). */
  warning: { round: number; spring: boolean; count: number } | null;
  /** Height of every visible land tile (1 to 3). Null when all tiles are the same, so the heat map toggle stays hidden. */
  elevation: Record<number, number> | null;
}

export interface TechActionsView {
  /** Null until you have Harbor charters. */
  harbor: {
    cost: Resources;
    affordable: boolean;
    /** Your cities on a 3:1 port; `level` 0 = not raised yet, 1 = raised to 2:1 for every resource. */
    ports: { vertexId: number; level: number }[];
  } | null;
  /** Null until you have Ground work. `hexes` is empty once it is used. */
  groundWork: {
    used: boolean;
    choices: string[];
    hexes: { hexId: number; type: string; number: number | null }[];
  } | null;
}

export interface TechRowView {
  id: string;
  name: string;
  branch: string;
  tier: 1 | 2 | 3;
  description: string;
  prereqs: string[];
  /** Your price in cards. */
  cost: number;
  /** What research takes (wheat + ore). */
  payment: Resources;
  owned: boolean;
  canResearch: boolean;
  reason: string | null;
}

export interface TurnActionItem {
  category: 'roll' | 'produce' | 'build' | 'rob' | 'dev' | 'trade' | 'discard' | 'event' | 'award';
  icon: string;
  text: string;
  badge?: string;
  timestamp: number;
}

export interface PlayerTurnSummary {
  turnCount: number;
  playerId: string;
  playerName: string;
  playerAvatar: string;
  playerColor: string;
  isBot: boolean;
  actions: TurnActionItem[];
}

export interface RoundSummary {
  round: number;
  title: string;
  turns: PlayerTurnSummary[];
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

export interface AddonInfoView {
  id: string;
  name: string;
  description?: string;
  pack: string;
  deps: string[];
  /** The addon may depend on an addon from another DLC (set by the setup page catalog). */
  allowCrossDlcDep?: boolean;
  links: { target: string; kind: string }[];
}

export interface DlcInfoView {
  id: string;
  name: string;
  addons: string[];
}

export interface ScenarioPresetView {
  id: string;
  label: string;
  description: string;
  quickStart: string;
  boardRadius: number;
  vpToWin: number;
  dlc: Record<string, boolean>;
  addons?: Record<string, boolean>;
  eventsOn?: boolean;
  fateTokens?: number;
}

export interface MapOptionsView {
  options: MapOptionView[];
  quickStarts: { id: string; label: string; blank: boolean }[];
  dlcs?: DlcInfoView[];
  addons?: AddonInfoView[];
  scenarios?: ScenarioPresetView[];
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
