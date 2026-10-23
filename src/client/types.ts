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
  stats?: {
    resourcesEarned: number;
    tradesMade: number;
  };
}

export interface RecentProduction {
  hexId: number;
  playerId: string;
  resource: string;
  amount: number;
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
}

export interface GameState {
  code: string;
  hostId: string;
  status: string;
  settings: any;
  board: { hexes: any[]; vertices: any[]; edges: any[]; robberHexId: number };
  bank: Resources;
  devDeckCount: number;
  turnIndex: number;
  currentPlayerId: string;
  phase: string;
  robberVictims?: string[];
  lastSetupVertexId?: number | null;
  lastDice: number[];
  lastRollHexIds?: number[];
  recentProductions?: RecentProduction[];
  diceStats?: Record<number, number>;
  turnCount?: number;
  startedAt?: number | null;
  finishedAt?: number | null;
  longestRoadOwner: string | null;
  largestArmyOwner: string | null;
  activeTrade: TradeView | null;
  winner: { id: string; name: string; vp: number; color: string } | null;
  logs: { text: string; color: string | null }[];
  chats: { sender: string; avatar: string; color: string; text: string }[];
  tradeRatios: Resources;
  players: PlayerView[];
}
