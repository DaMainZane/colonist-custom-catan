import type { Server } from 'socket.io';
import { scheduleBotAction } from './bots/scheduler';
import { getBankRemaining, getPlayerVP, getTotalResources, getTradeRatios } from './rules';
import type { Room } from './types';

let io: Server;

export function setIo(server: Server): void {
  io = server;
}

export function broadcastRoom(room: Room): void {
  if (!room) return;
  const bank = getBankRemaining(room);
  const clientBoard = {
    ...room.board,
    hexes: room.board.hexes.map(h =>
      h.fog && room.status !== 'GAMEOVER'
        ? { ...h, type: 'fog', number: null, fog: true }
        : h
    )
  };
  for (const p of room.players) {
    if (p.isBot) continue;
    const state = {
      code: room.code,
      hostId: room.hostId,
      status: room.status,
      settings: room.settings,
      board: clientBoard,
      bank,
      devDeckCount: room.devDeck.length,
      turnIndex: room.turnIndex,
      currentPlayerId: room.players[room.turnIndex]?.id,
      phase: room.phase,
      robberVictims: room.robberVictims || [],
      lastSetupVertexId: room.lastSetupVertexId,
      lastDice: room.lastDice,
      lastRollHexIds: room.lastRollHexIds || [],
      recentProductions: room.recentProductions || [],
      diceStats: room.diceStats || {},
      turnCount: room.turnCount || 1,
      startedAt: room.startedAt,
      finishedAt: room.finishedAt,
      longestRoadOwner: room.longestRoadOwner,
      largestArmyOwner: room.largestArmyOwner,
      activeTrade: room.activeTrade,
      winner: room.winner,
      logs: room.logs,
      chats: room.chats,
      tradeRatios: getTradeRatios(room, p.id),
      players: room.players.map(pl => ({
        id: pl.id,
        name: pl.name,
        avatar: pl.avatar,
        color: pl.color,
        isBot: pl.isBot,
        difficulty: pl.difficulty,
        resourceCount: getTotalResources(pl),
        resources: pl.id === p.id || room.status === 'GAMEOVER' ? pl.resources : undefined,
        devCardCount: pl.devCards.length + pl.newDevCards.length,
        devCards: pl.id === p.id ? pl.devCards : undefined,
        newDevCards: pl.id === p.id ? pl.newDevCards : undefined,
        knightsPlayed: pl.knightsPlayed,
        longestRoadLength: pl.longestRoadLength,
        goldPending: pl.goldPending,
        discardPending: pl.discardPending,
        freeRoads: pl.freeRoads,
        playedDevCardThisTurn: pl.playedDevCardThisTurn,
        settlementsLeft: pl.settlementsLeft,
        citiesLeft: pl.citiesLeft,
        roadsLeft: pl.roadsLeft,
        stats: pl.stats || { resourcesEarned: 0, tradesMade: 0 },
        vp: getPlayerVP(room, pl, pl.id === p.id || room.status === 'GAMEOVER')
      }))
    };
    if (io) io.to(p.id).emit('gameState', state);
  }
  room.recentProductions = [];
  scheduleBotAction(room);
}
