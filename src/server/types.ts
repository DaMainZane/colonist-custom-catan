// Loose types for the legacy rules. Tightened when the engine is rewritten (Step 2).
export type Resources = Record<string, number>;

export interface Settings {
  boardRadius: number;
  goldTiles: number;
  desertTiles: number;
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
}

export interface Building {
  owner: string;
  type: 'settlement' | 'city';
}

export interface Hex {
  id: number;
  q: number;
  r: number;
  x?: number;
  y?: number;
  type: string;
  number: number | null;
  corners?: { x: number; y: number }[];
  vertexIds?: number[];
}

export interface Vertex {
  id: number;
  x: number;
  y: number;
  hexIds: number[];
  adjacentVertices: number[];
  edgeIds: number[];
  building: Building | null;
  port: string | null;
}

export interface Edge {
  id: number;
  v1: number;
  v2: number;
  key: string;
  hexIds: number[];
  road: string | null;
  port: string | null;
}

export interface Board {
  hexes: Hex[];
  vertices: Vertex[];
  edges: Edge[];
  robberHexId: number;
}

export interface Player {
  id: string;
  name: string;
  avatar: string;
  color: string;
  isBot: boolean;
  difficulty: string | null;
  resources: Resources;
  devCards: string[];
  newDevCards: string[];
  knightsPlayed: number;
  longestRoadLength: number;
  goldPending: number;
  discardPending: number;
  freeRoads: number;
  playedDevCardThisTurn: boolean;
  proposedTradeThisTurn: boolean;
  settlementsLeft: number;
  citiesLeft: number;
  roadsLeft: number;
}

export interface LogEntry {
  text: string;
  color: string | null;
}

export interface ChatEntry {
  sender: string;
  avatar: string;
  color: string;
  text: string;
}

export interface Trade {
  id: number;
  fromId: string;
  fromName: string;
  fromAvatar: string;
  fromColor: string;
  offer: Resources;
  request: Resources;
  responses: Record<string, string>;
  timeoutScheduled?: boolean;
}

export interface Winner {
  id: string;
  name: string;
  vp: number;
  color: string;
}

export interface Room {
  code: string;
  hostId: string;
  status: string;
  settings: Settings;
  players: Player[];
  board: Board;
  devDeck: string[];
  turnIndex: number;
  setupStep: number;
  setupOrder: number[];
  phase: string;
  PreGoldPhase: string | null;
  lastDice: number[];
  longestRoadOwner: string | null;
  largestArmyOwner: string | null;
  activeTrade: Trade | null;
  winner: Winner | null;
  logs: LogEntry[];
  chats: ChatEntry[];
  lastSetupVertexId?: number | null;
  botTimer?: any;
}
