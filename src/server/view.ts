// MODULE: client state builder (engine state -> the `gameState` shape the current client renders) | USED BY: server/net
import { computeVP, getPlayer, totalCards } from '../shared';
import type { Board, GameState, PlayerState } from '../shared';
import { victimsOnHex } from '../packs/base/robbing';
import { tradeRatios } from '../packs/base/trading';
import { roomStatus } from './rooms';
import { registry } from './runtime';
import type { Room } from './types';

/** Engine phase ids -> the legacy phase names the client switches on. */
const PHASE_NAMES: Record<string, string> = {
  setup_settlement: 'SETUP_SETTLEMENT',
  setup_road: 'SETUP_ROAD',
  roll: 'ROLL',
  main: 'MAIN',
  discard: 'DISCARD',
  robber: 'ROBBER',
  robber_steal: 'ROBBER_STEAL',
  pick: 'GOLD_PICK',
  gameover: 'GAMEOVER'
};

/** Board in the legacy shape. Hidden (fog) hexes never leak their type or number before game over. */
export function clientBoard(board: Board, revealAll: boolean): any {
  return {
    hexes: board.hexes.map(h => {
      const { ext, ...rest } = h;
      const hidden = !!ext?.hidden;
      if (hidden && !revealAll) return { ...rest, type: ext.maskAs || 'fog', number: null, fog: true };
      return { ...rest, fog: hidden };
    }),
    vertices: board.vertices.map(v => {
      const { piece, ...rest } = v;
      return { ...rest, building: piece ? { owner: piece.owner, type: piece.type } : null };
    }),
    edges: board.edges.map(e => {
      const { piece, ...rest } = e;
      return { ...rest, road: piece ? piece.owner : null };
    }),
    robberHexId: board.robberHexId
  };
}

function zeroResources(): Record<string, number> {
  return Object.fromEntries([...registry.resources.keys()].map(r => [r, 0]));
}

function fillResources(partial: Record<string, number>): Record<string, number> {
  return { ...zeroResources(), ...partial };
}

function enginePlayerView(g: GameState, p: PlayerState, viewerId: string, over: boolean): any {
  const self = p.id === viewerId;
  const reveal = self || over;
  return {
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    color: p.color,
    isBot: p.isBot,
    difficulty: p.difficulty,
    resourceCount: totalCards(p),
    resources: reveal ? p.resources : undefined,
    devCardCount: p.devCards.length + p.newDevCards.length,
    devCards: self ? p.devCards : undefined,
    newDevCards: self ? p.newDevCards : undefined,
    knightsPlayed: p.stats.knightsPlayed || 0,
    longestRoadLength: p.stats.longestRoad || 0,
    goldPending: p.pending.pick || 0,
    discardPending: p.pending.discard || 0,
    freeRoads: p.pending.freeRoads || 0,
    playedDevCardThisTurn: !!p.flags.playedDev,
    settlementsLeft: p.pieces.settlement ?? 0,
    citiesLeft: p.pieces.city ?? 0,
    roadsLeft: p.pieces.road ?? 0,
    stats: { resourcesEarned: p.stats.earned || 0, tradesMade: p.stats.trades || 0 },
    vp: computeVP(g, registry, p, reveal)
  };
}

function lobbyPlayerView(room: Room, p: Room['lobbyPlayers'][number]): any {
  return {
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    color: p.color,
    isBot: p.isBot,
    difficulty: p.difficulty,
    resourceCount: 0,
    resources: zeroResources(),
    devCardCount: 0,
    devCards: [],
    newDevCards: [],
    knightsPlayed: 0,
    longestRoadLength: 0,
    goldPending: 0,
    discardPending: 0,
    freeRoads: 0,
    playedDevCardThisTurn: false,
    settlementsLeft: room.settings.maxSettlements,
    citiesLeft: room.settings.maxCities,
    roadsLeft: room.settings.maxRoads,
    stats: { resourcesEarned: 0, tradesMade: 0 },
    vp: 0
  };
}

/**
 * Returns a function that builds the state for one viewer. Everything that is the same for all viewers
 * (board, bank, trade...) is computed once per broadcast.
 */
export function makeStateBuilder(room: Room): (viewerId: string) => any {
  const g = room.game;
  const status = roomStatus(room);
  const over = status === 'GAMEOVER';
  const board = clientBoard(g ? g.board : room.board, over);

  const bank = g
    ? g.bank
    : Object.fromEntries([...registry.resources.keys()].map(r => [r, room.settings.bankResourcePerType]));
  const devDeckCount = g
    ? g.deck.length
    : room.settings.devKnights + room.settings.devVp + room.settings.devRoadBuilding +
      room.settings.devYearOfPlenty + room.settings.devMonopoly;

  let activeTrade: any = null;
  if (g?.trade) {
    const from = getPlayer(g, g.trade.fromId);
    activeTrade = {
      id: g.trade.id,
      fromId: g.trade.fromId,
      fromName: from?.name,
      fromAvatar: from?.avatar,
      fromColor: from?.color,
      offer: fillResources(g.trade.offer),
      request: fillResources(g.trade.request),
      responses: g.trade.responses
    };
  }

  const current = g ? g.players[g.turn] : room.lobbyPlayers[0];
  const robberVictims = g && g.phase === 'robber_steal' && current ? victimsOnHex(g, g.board.robberHexId, current.id) : [];
  const defaultRatios = Object.fromEntries([...registry.resources.keys()].map(r => [r, 4]));

  const shared = {
    code: room.code,
    hostId: room.hostId,
    status,
    settings: room.settings,
    board,
    bank,
    devDeckCount,
    turnIndex: g ? g.turn : 0,
    currentPlayerId: current?.id,
    phase: g ? PHASE_NAMES[g.phase] ?? g.phase.toUpperCase() : 'LOBBY',
    robberVictims,
    lastSetupVertexId: g ? g.setup.lastVertexId : null,
    lastDice: g && g.dice[0] ? g.dice : [4, 3],
    lastRollHexIds: room.fx.lastRollHexIds,
    recentProductions: room.fx.recentProductions,
    diceStats: g ? g.diceStats : {},
    turnCount: g ? Math.max(1, g.turnCount) : 1,
    startedAt: room.startedAt,
    finishedAt: room.finishedAt,
    longestRoadOwner: g ? g.awards.longestRoad ?? null : null,
    largestArmyOwner: g ? g.awards.largestArmy ?? null : null,
    activeTrade,
    winner: g ? g.winner : null,
    logs: g ? g.log : room.lobbyLog,
    chats: room.chats
  };

  return (viewerId: string) => {
    const recentTransfers = room.fx.recentTransfers.map(t => {
      if (t.secretForOthers && viewerId !== t.from && viewerId !== t.to && !over) return { ...t, resource: 'mystery' };
      return t;
    });
    return {
      ...shared,
      recentTransfers,
      tradeRatios: g ? tradeRatios(g, registry, viewerId) : defaultRatios,
      players: g
        ? g.players.map(p => enginePlayerView(g, p, viewerId, over))
        : room.lobbyPlayers.map(p => lobbyPlayerView(room, p))
    };
  };
}
