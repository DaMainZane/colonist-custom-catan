import { PLAYER_COLORS } from './constants';
import { generateBoard } from './topology';
import type { Player, Room, Settings } from './types';
import { clamp, shuffle } from './util';

export const rooms: Record<string, Room> = {};

export function createDevDeck(settings: Settings): string[] {
  const deck: string[] = [];
  const kCount = clamp(settings.devKnights, 0, 100, 14);
  const vpCount = clamp(settings.devVp, 0, 50, 5);
  const rbCount = clamp(settings.devRoadBuilding, 0, 50, 2);
  const yopCount = clamp(settings.devYearOfPlenty, 0, 50, 2);
  const monoCount = clamp(settings.devMonopoly, 0, 50, 2);

  for (let i = 0; i < kCount; i++) deck.push('knight');
  for (let i = 0; i < vpCount; i++) deck.push('vp');
  for (let i = 0; i < rbCount; i++) deck.push('roadBuilding');
  for (let i = 0; i < yopCount; i++) deck.push('yearOfPlenty');
  for (let i = 0; i < monoCount; i++) deck.push('monopoly');

  return shuffle(deck);
}

export function createPlayer(id: string, name: string, colorIndex: number, isBot = false): Player {
  const avatars = ['🦊', '🐼', '🦁', '🐸', '🐯', '🐙', '🦄', '🦅'];
  return {
    id,
    name,
    avatar: isBot ? '🤖' : avatars[colorIndex % avatars.length],
    color: PLAYER_COLORS[colorIndex % PLAYER_COLORS.length],
    isBot,
    difficulty: isBot ? 'ADVANCED HARD' : null,
    resources: { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 },
    devCards: [],
    newDevCards: [],
    knightsPlayed: 0,
    longestRoadLength: 0,
    goldPending: 0,
    discardPending: 0,
    freeRoads: 0,
    playedDevCardThisTurn: false,
    proposedTradeThisTurn: false,
    settlementsLeft: 5,
    citiesLeft: 4,
    roadsLeft: 15,
    stats: { resourcesEarned: 0, tradesMade: 0 }
  };
}

export function createRoom(hostId: string, hostName: string): Room {
  const code = Math.random().toString(36).substring(2, 7).toUpperCase();
  const settings: Settings = {
    boardRadius: 2,
    goldTiles: 2,
    desertTiles: 1,
    fogTiles: 0,
    vpToWin: 10,
    maxPlayers: 4,
    cardDiscardLimit: 7,
    bankResourcePerType: 19,
    devKnights: 14,
    devVp: 5,
    devRoadBuilding: 2,
    devYearOfPlenty: 2,
    devMonopoly: 2,
    maxSettlements: 5,
    maxCities: 4,
    maxRoads: 15,
    gameSpeed: 1
  };

  const room: Room = {
    code,
    hostId,
    status: 'LOBBY',
    settings,
    players: [createPlayer(hostId, hostName, 0, false)],
    board: generateBoard(settings),
    devDeck: createDevDeck(settings),
    turnIndex: 0,
    setupStep: 0,
    setupOrder: [],
    phase: 'LOBBY',
    PreGoldPhase: null,
    lastDice: [4, 3],
    lastRollHexIds: [],
    recentProductions: [],
    recentTransfers: [],
    diceStats: { 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0 },
    turnCount: 1,
    startedAt: null,
    finishedAt: null,
    longestRoadOwner: null,
    largestArmyOwner: null,
    activeTrade: null,
    winner: null,
    robberVictims: [],
    logs: [{ text: `Room ${code} created. Bots are set to ADVANCED HARD.`, color: '#1565c0' }],
    chats: [{ sender: hostName, avatar: '🦊', color: PLAYER_COLORS[0], text: 'Welcome! Customize the board or add Hard Bots to start.' }]
  };
  rooms[code] = room;
  return room;
}

export function addLog(room: Room, text: string, color: string | null = null): void {
  if (!room) return;
  room.logs.push({ text, color });
  if (room.logs.length > 80) room.logs.shift();
}
