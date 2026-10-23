import { RESOURCES } from './constants';
import { broadcastRoom } from './net';
import { addLog } from './rooms';
import {
  advanceSetupTurn,
  canPlaceRoad,
  canPlaceSettlement,
  checkGoldPhaseTransition,
  checkWinner,
  getPlayerVP,
  getTotalResources,
  givePlayerResourceFromBank,
  updateLongestRoad
} from './rules';
import type { Player, Room, Trade } from './types';

export function handlePlaceSettlement(room: Room, player: Player, vertexId: number): void {
  const isSetup = room.phase === 'SETUP_SETTLEMENT';
  if (!isSetup && room.phase !== 'MAIN') return;
  if (player.settlementsLeft <= 0) return;
  if (!canPlaceSettlement(room, player.id, vertexId, isSetup)) return;

  if (!isSetup) {
    if (player.resources.wood < 1 || player.resources.brick < 1 || player.resources.sheep < 1 || player.resources.wheat < 1) return;
    player.resources.wood--; player.resources.brick--; player.resources.sheep--; player.resources.wheat--;
  }

  const v = room.board.vertices[vertexId];
  v.building = { owner: player.id, type: 'settlement' };
  player.settlementsLeft--;
  addLog(room, `${player.avatar} ${player.name} placed a Settlement`, player.color);

  if (isSetup) {
    room.lastSetupVertexId = vertexId;
    if (room.setupStep >= room.players.length) {
      for (const hId of v.hexIds) {
        const hex = room.board.hexes[hId];
        if (!hex) continue;
        if (RESOURCES.includes(hex.type)) givePlayerResourceFromBank(room, player, hex.type, 1);
        else if (hex.type === 'gold') player.goldPending++;
      }
    }
    room.phase = 'SETUP_ROAD';
  } else {
    updateLongestRoad(room);
    checkWinner(room);
  }
  broadcastRoom(room);
}

export function handlePlaceRoad(room: Room, player: Player, edgeId: number): void {
  const isSetup = room.phase === 'SETUP_ROAD';
  if (!isSetup && room.phase !== 'MAIN') return;
  if (player.roadsLeft <= 0) return;

  const mustConnect = isSetup ? room.lastSetupVertexId : null;
  if (!canPlaceRoad(room, player.id, edgeId, mustConnect)) return;

  if (!isSetup) {
    if (player.freeRoads > 0) player.freeRoads--;
    else {
      if (player.resources.wood < 1 || player.resources.brick < 1) return;
      player.resources.wood--; player.resources.brick--;
    }
  }

  room.board.edges[edgeId].road = player.id;
  player.roadsLeft--;
  addLog(room, `${player.avatar} ${player.name} placed a Road`, player.color);
  updateLongestRoad(room);

  if (isSetup) {
    room.lastSetupVertexId = null;
    checkGoldPhaseTransition(room);
    if (room.players.some(p => p.goldPending > 0)) {
      room.PreGoldPhase = 'SETUP_NEXT';
      room.phase = 'GOLD_PICK';
    } else {
      advanceSetupTurn(room);
    }
  } else {
    checkWinner(room);
  }
  broadcastRoom(room);
}

export function handlePlaceCity(room: Room, player: Player, vertexId: number): void {
  if (room.phase !== 'MAIN' || player.citiesLeft <= 0) return;
  if (player.resources.wheat < 2 || player.resources.ore < 3) return;

  const v = room.board.vertices[vertexId];
  if (!v || !v.building || v.building.owner !== player.id || v.building.type !== 'settlement') return;

  player.resources.wheat -= 2;
  player.resources.ore -= 3;
  v.building.type = 'city';
  player.citiesLeft--;
  player.settlementsLeft++;
  addLog(room, `${player.avatar} ${player.name} upgraded to a City`, player.color);
  checkWinner(room);
  broadcastRoom(room);
}

export function handleRollDice(room: Room, player: Player): void {
  if (room.phase !== 'ROLL') return;
  const d1 = Math.floor(Math.random() * 6) + 1;
  const d2 = Math.floor(Math.random() * 6) + 1;
  const sum = d1 + d2;
  room.lastDice = [d1, d2];
  addLog(room, `${player.avatar} ${player.name} rolled ${sum} (${d1} + ${d2})`, player.color);

  if (sum === 7) {
    let anyDiscard = false;
    for (const p of room.players) {
      const total = getTotalResources(p);
      if (total > room.settings.cardDiscardLimit) {
        p.discardPending = Math.floor(total / 2);
        anyDiscard = true;
      }
    }
    room.phase = anyDiscard ? 'DISCARD' : 'ROBBER';
  } else {
    const matching = room.board.hexes.filter(h => h.number === sum && h.id !== room.board.robberHexId && h.type !== 'water');
    for (const hex of matching) {
      for (const vId of hex.vertexIds) {
        const b = room.board.vertices[vId]?.building;
        if (b) {
          const owner = room.players.find(p => p.id === b.owner);
          const amt = b.type === 'city' ? 2 : 1;
          if (owner) {
            if (hex.type === 'gold') {
              owner.goldPending += amt;
              addLog(room, `${owner.avatar} ${owner.name} earned ${amt} Gold pick(s)!`, owner.color);
            } else if (RESOURCES.includes(hex.type)) {
              givePlayerResourceFromBank(room, owner, hex.type, amt);
            }
          }
        }
      }
    }
    checkGoldPhaseTransition(room);
    if (room.players.some(p => p.goldPending > 0)) {
      room.PreGoldPhase = 'MAIN';
      room.phase = 'GOLD_PICK';
    } else {
      room.phase = 'MAIN';
    }
  }
  broadcastRoom(room);
}

export function handleMoveRobber(room: Room, player: Player, hexId: number): void {
  if (room.phase !== 'ROBBER') return;
  const hex = room.board.hexes[hexId];
  if (!hex || hex.type === 'water' || hex.id === room.board.robberHexId) return;

  room.board.robberHexId = hex.id;
  addLog(room, `${player.avatar} ${player.name} moved the Robber`, player.color);

  const victimIds = new Set<string>();
  for (const vId of hex.vertexIds) {
    const b = room.board.vertices[vId]?.building;
    if (b && b.owner !== player.id) victimIds.add(b.owner);
  }
  const victims = [...victimIds]
    .map(id => room.players.find(p => p.id === id))
    .filter(p => p && getTotalResources(p) > 0);

  if (victims.length > 0) {
    // Target victim with highest VP
    victims.sort((a, b) => getPlayerVP(room, b, false) - getPlayerVP(room, a, false));
    const victim = victims[0];
    const pool: string[] = [];
    RESOURCES.forEach(r => { for (let i = 0; i < victim.resources[r]; i++) pool.push(r); });
    if (pool.length > 0) {
      const stolen = pool[Math.floor(Math.random() * pool.length)];
      victim.resources[stolen]--;
      player.resources[stolen]++;
      addLog(room, `${player.avatar} ${player.name} stole 1 resource from ${victim.name}`, player.color);
    }
  }
  room.phase = 'MAIN';
  broadcastRoom(room);
}

export function executeTradeBetweenPlayers(room: Room, proposer: Player, partner: Player, trade: Trade): boolean {
  if (!proposer || !partner || proposer.id === partner.id) return false;
  for (const r of RESOURCES) {
    if ((Number(trade.offer[r]) || 0) > (proposer.resources[r] || 0)) return false;
    if ((Number(trade.request[r]) || 0) > (partner.resources[r] || 0)) return false;
  }
  for (const r of RESOURCES) {
    const o = Number(trade.offer[r]) || 0;
    const req = Number(trade.request[r]) || 0;
    proposer.resources[r] = proposer.resources[r] - o + req;
    partner.resources[r] = partner.resources[r] - req + o;
  }
  addLog(room, `🤝 ${proposer.name} traded with ${partner.name}!`, proposer.color);
  room.activeTrade = null;
  broadcastRoom(room);
  return true;
}

export function handleEndTurn(room: Room, player: Player): void {
  if (room.phase !== 'MAIN') return;
  player.devCards.push(...player.newDevCards);
  player.newDevCards = [];
  player.playedDevCardThisTurn = false;
  player.proposedTradeThisTurn = false;
  player.freeRoads = 0;
  room.activeTrade = null;

  if (checkWinner(room)) return broadcastRoom(room);

  room.turnIndex = (room.turnIndex + 1) % room.players.length;
  room.phase = 'ROLL';
  broadcastRoom(room);
}
