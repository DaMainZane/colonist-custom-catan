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
      room.recentProductions = [];
      for (const hId of v.hexIds) {
        const hex = room.board.hexes[hId];
        if (!hex || hex.fog) continue;
        if (RESOURCES.includes(hex.type)) {
          const granted = givePlayerResourceFromBank(room, player, hex.type, 1);
          if (granted > 0) {
            room.recentProductions.push({ hexId: hId, playerId: player.id, resource: hex.type, amount: granted });
          }
        } else if (hex.type === 'gold') {
          player.goldPending++;
        }
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

  const edge = room.board.edges[edgeId];
  edge.road = player.id;
  player.roadsLeft--;
  addLog(room, `${player.avatar} ${player.name} placed a Road`, player.color);

  // Fog mechanic: when a road touches any fog tile (via edge or endpoint vertices), reveal it and grant 1 resource of that tile
  const v1 = room.board.vertices[edge.v1];
  const v2 = room.board.vertices[edge.v2];
  const touchedHexIds = new Set<number>([
    ...edge.hexIds,
    ...(v1 ? v1.hexIds : []),
    ...(v2 ? v2.hexIds : [])
  ]);

  const fallbackNums = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
  if (!room.recentProductions) room.recentProductions = [];
  for (const hId of touchedHexIds) {
    const hex = room.board.hexes[hId];
    if (!hex || !hex.fog) continue;
    hex.fog = false;
    if (!RESOURCES.includes(hex.type) && hex.type !== 'gold' && hex.type !== 'desert') {
      hex.type = RESOURCES[Math.floor(Math.random() * RESOURCES.length)];
    }
    if (hex.type !== 'desert' && !hex.number) {
      hex.number = fallbackNums[Math.floor(Math.random() * fallbackNums.length)];
    }

    if (RESOURCES.includes(hex.type)) {
      const granted = givePlayerResourceFromBank(room, player, hex.type, 1);
      if (granted > 0) {
        room.recentProductions.push({ hexId: hId, playerId: player.id, resource: hex.type, amount: granted });
      }
      addLog(
        room,
        `🌫️ ${player.avatar} ${player.name} revealed ${hex.type.toUpperCase()} (${hex.number}) from Fog${granted > 0 ? ` (+1 ${hex.type})` : ''}!`,
        player.color
      );
    } else if (hex.type === 'gold') {
      player.goldPending++;
      addLog(
        room,
        `🌫️ ${player.avatar} ${player.name} revealed GOLD (${hex.number}) from Fog (+1 Gold pick)!`,
        player.color
      );
    } else if (hex.type === 'desert') {
      addLog(room, `🌫️ ${player.avatar} ${player.name} revealed a DESERT from Fog!`, player.color);
    }
  }

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
    checkGoldPhaseTransition(room);
    if (room.players.some(p => p.goldPending > 0)) {
      room.PreGoldPhase = 'MAIN';
      room.phase = 'GOLD_PICK';
    }
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
  if (!room.diceStats) room.diceStats = { 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0 };
  room.diceStats[sum] = (room.diceStats[sum] || 0) + 1;
  room.recentProductions = [];
  addLog(room, `${player.avatar} ${player.name} rolled ${sum} (${d1} + ${d2})`, player.color);

  if (sum === 7) {
    room.lastRollHexIds = [];
    room.PreRobberPhase = 'MAIN';
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
    const matching = room.board.hexes.filter(h => !h.fog && h.number === sum && h.id !== room.board.robberHexId && h.type !== 'water');
    room.lastRollHexIds = matching.map(h => h.id);
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
              const granted = givePlayerResourceFromBank(room, owner, hex.type, amt);
              if (granted > 0) {
                room.recentProductions.push({ hexId: hex.id, playerId: owner.id, resource: hex.type, amount: granted });
              }
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

function stealOneRandomResource(room: Room, thief: Player, victim: Player): void {
  const pool: string[] = [];
  RESOURCES.forEach(r => {
    for (let i = 0; i < (victim.resources[r] || 0); i++) pool.push(r);
  });
  if (pool.length > 0) {
    const stolen = pool[Math.floor(Math.random() * pool.length)];
    victim.resources[stolen]--;
    thief.resources[stolen]++;
    if (!room.recentTransfers) room.recentTransfers = [];
    room.recentTransfers.push({
      from: victim.id,
      to: thief.id,
      resource: stolen,
      amount: 1,
      kind: 'steal',
      secretForOthers: true
    });
    addLog(room, `${thief.avatar} ${thief.name} stole 1 resource from ${victim.name}`, thief.color);
  } else {
    addLog(room, `${thief.avatar} ${thief.name} robbed ${victim.name}, but they had no cards!`, thief.color);
  }
}

export function handleMoveRobber(room: Room, player: Player, hexId: number): void {
  if (room.phase !== 'ROBBER') return;
  const hex = room.board.hexes[hexId];
  if (!hex || hex.type === 'water' || hex.fog || hex.id === room.board.robberHexId) return;

  room.board.robberHexId = hex.id;
  addLog(room, `${player.avatar} ${player.name} moved the Robber`, player.color);

  const victimIds = new Set<string>();
  for (const vId of hex.vertexIds || []) {
    const b = room.board.vertices[vId]?.building;
    if (b && b.owner !== player.id) victimIds.add(b.owner);
  }

  const playersOnHex = [...victimIds]
    .map(id => room.players.find(p => p.id === id))
    .filter((p): p is Player => !!p);

  const finishRobberPhase = () => {
    room.robberVictims = [];
    room.phase = room.PreRobberPhase || 'MAIN';
    room.PreRobberPhase = null;
  };

  if (playersOnHex.length === 0) {
    finishRobberPhase();
    broadcastRoom(room);
    return;
  }

  if (playersOnHex.length === 1) {
    stealOneRandomResource(room, player, playersOnHex[0]);
    finishRobberPhase();
    broadcastRoom(room);
    return;
  }

  // 2 or more other players have buildings on this hex
  if (player.isBot) {
    const withCards = playersOnHex.filter(p => getTotalResources(p) > 0);
    const pool = withCards.length > 0 ? withCards : playersOnHex;
    pool.sort((a, b) => getPlayerVP(room, b, false) - getPlayerVP(room, a, false));
    stealOneRandomResource(room, player, pool[0]);
    finishRobberPhase();
    broadcastRoom(room);
    return;
  }

  room.robberVictims = playersOnHex.map(p => p.id);
  room.phase = 'ROBBER_STEAL';
  broadcastRoom(room);
}

export function handleStealFromVictim(room: Room, player: Player, victimId: string): void {
  if (room.phase !== 'ROBBER_STEAL') return;
  const allowed = room.robberVictims || [];
  if (!allowed.includes(victimId)) return;

  const victim = room.players.find(p => p.id === victimId);
  if (victim && victim.id !== player.id) {
    stealOneRandomResource(room, player, victim);
  }
  room.robberVictims = [];
  room.phase = room.PreRobberPhase || 'MAIN';
  room.PreRobberPhase = null;
  broadcastRoom(room);
}

export function executeTradeBetweenPlayers(room: Room, proposer: Player, partner: Player, trade: Trade): boolean {
  if (!proposer || !partner || proposer.id === partner.id) return false;
  for (const r of RESOURCES) {
    if ((Number(trade.offer[r]) || 0) > (proposer.resources[r] || 0)) return false;
    if ((Number(trade.request[r]) || 0) > (partner.resources[r] || 0)) return false;
  }
  if (!room.recentTransfers) room.recentTransfers = [];
  for (const r of RESOURCES) {
    const o = Number(trade.offer[r]) || 0;
    const req = Number(trade.request[r]) || 0;
    proposer.resources[r] = proposer.resources[r] - o + req;
    partner.resources[r] = partner.resources[r] - req + o;
    if (o > 0) {
      room.recentTransfers.push({ from: proposer.id, to: partner.id, resource: r, amount: o, kind: 'playerTrade' });
    }
    if (req > 0) {
      room.recentTransfers.push({ from: partner.id, to: proposer.id, resource: r, amount: req, kind: 'playerTrade' });
    }
  }
  if (!proposer.stats) proposer.stats = { resourcesEarned: 0, tradesMade: 0 };
  if (!partner.stats) partner.stats = { resourcesEarned: 0, tradesMade: 0 };
  proposer.stats.tradesMade++;
  partner.stats.tradesMade++;
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
  room.lastRollHexIds = [];
  room.turnCount = (room.turnCount || 1) + 1;

  if (checkWinner(room)) return broadcastRoom(room);

  room.turnIndex = (room.turnIndex + 1) % room.players.length;
  room.phase = 'ROLL';
  broadcastRoom(room);
}
