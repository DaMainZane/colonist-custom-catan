import { RESOURCES } from './constants';
import { addLog } from './rooms';
import type { Board, Player, Resources, Room } from './types';
import { clamp } from './util';

export function getTotalResources(player: Player): number {
  if (!player || !player.resources) return 0;
  return RESOURCES.reduce((sum, r) => sum + (player.resources[r] || 0), 0);
}

export function getBankRemaining(room: Room): Resources {
  const maxPer = clamp(room.settings.bankResourcePerType, 1, 999, 19);
  const bank: Resources = { wood: maxPer, brick: maxPer, sheep: maxPer, wheat: maxPer, ore: maxPer };
  for (const p of room.players) {
    for (const r of RESOURCES) {
      bank[r] = Math.max(0, bank[r] - (p.resources[r] || 0));
    }
  }
  return bank;
}

export function givePlayerResourceFromBank(room: Room, player: Player, resource: string, amount: number): number {
  if (!RESOURCES.includes(resource) || amount <= 0) return 0;
  const bank = getBankRemaining(room);
  const available = bank[resource] || 0;
  const granted = Math.min(amount, available);
  player.resources[resource] = (player.resources[resource] || 0) + granted;
  return granted;
}

export function computePlayerLongestRoad(board: Board, playerId: string): number {
  const playerEdges = board.edges.filter(e => e.road === playerId);
  if (playerEdges.length === 0) return 0;

  let maxLen = 0;
  const visitedEdges = new Set<number>();

  function dfs(vertexId: number, currentLen: number) {
    if (currentLen > maxLen) maxLen = currentLen;
    const v = board.vertices[vertexId];
    if (!v) return;
    if (currentLen > 0 && v.building && v.building.owner !== playerId) return;

    for (const edgeId of v.edgeIds) {
      if (visitedEdges.has(edgeId)) continue;
      const edge = board.edges[edgeId];
      if (!edge || edge.road !== playerId) continue;

      visitedEdges.add(edgeId);
      const nextVertex = edge.v1 === vertexId ? edge.v2 : edge.v1;
      dfs(nextVertex, currentLen + 1);
      visitedEdges.delete(edgeId);
    }
  }

  const endpoints = new Set<number>();
  playerEdges.forEach(e => { endpoints.add(e.v1); endpoints.add(e.v2); });
  for (const vId of endpoints) dfs(vId, 0);
  return maxLen;
}

export function updateLongestRoad(room: Room): void {
  let bestLen = 4;
  if (room.longestRoadOwner) {
    const holder = room.players.find(p => p.id === room.longestRoadOwner);
    if (holder) {
      holder.longestRoadLength = computePlayerLongestRoad(room.board, holder.id);
      if (holder.longestRoadLength >= 5) bestLen = holder.longestRoadLength;
      else room.longestRoadOwner = null;
    }
  }
  for (const p of room.players) {
    p.longestRoadLength = computePlayerLongestRoad(room.board, p.id);
    if (p.longestRoadLength > bestLen) {
      bestLen = p.longestRoadLength;
      room.longestRoadOwner = p.id;
      addLog(room, `${p.avatar} ${p.name} claimed Longest Road (${bestLen})!`, p.color);
    }
  }
}

export function updateLargestArmy(room: Room): void {
  let bestCount = 2;
  if (room.largestArmyOwner) {
    const holder = room.players.find(p => p.id === room.largestArmyOwner);
    if (holder) bestCount = holder.knightsPlayed;
  }
  for (const p of room.players) {
    if (p.knightsPlayed > bestCount) {
      bestCount = p.knightsPlayed;
      room.largestArmyOwner = p.id;
      addLog(room, `${p.avatar} ${p.name} claimed Largest Army (${bestCount})!`, p.color);
    }
  }
}

export function getPlayerVP(room: Room, player: Player, includeHidden = false): number {
  let vp = 0;
  for (const v of room.board.vertices) {
    if (v.building && v.building.owner === player.id) {
      vp += v.building.type === 'city' ? 2 : 1;
    }
  }
  if (room.longestRoadOwner === player.id) vp += 2;
  if (room.largestArmyOwner === player.id) vp += 2;
  if (includeHidden) {
    vp += [...player.devCards, ...player.newDevCards].filter(c => c === 'vp').length;
  }
  return vp;
}

export function checkWinner(room: Room): boolean {
  for (const p of room.players) {
    const totalVp = getPlayerVP(room, p, true);
    if (totalVp >= room.settings.vpToWin) {
      room.status = 'GAMEOVER';
      room.phase = 'GAMEOVER';
      room.activeTrade = null;
      room.winner = { id: p.id, name: p.name, vp: totalVp, color: p.color };
      addLog(room, `🏆 ${p.name} wins the game with ${totalVp} VP!`, p.color);
      return true;
    }
  }
  return false;
}

export function canPlaceSettlement(room: Room, playerId: string, vertexId: number, isSetup = false): boolean {
  const v = room.board.vertices[vertexId];
  if (!v || v.building) return false;
  for (const adjId of v.adjacentVertices) {
    if (room.board.vertices[adjId]?.building) return false;
  }
  if (isSetup) return true;
  return v.edgeIds.some(eId => room.board.edges[eId]?.road === playerId);
}

export function canPlaceRoad(room: Room, playerId: string, edgeId: number, mustConnectVertexId: number | null = null): boolean {
  const e = room.board.edges[edgeId];
  if (!e || e.road !== null) return false;
  if (mustConnectVertexId !== null) {
    return e.v1 === mustConnectVertexId || e.v2 === mustConnectVertexId;
  }
  for (const vId of [e.v1, e.v2]) {
    const v = room.board.vertices[vId];
    if (!v) continue;
    if (v.building && v.building.owner === playerId) return true;
    if (v.building && v.building.owner !== playerId) continue;
    if (v.edgeIds.some(otherEdgeId => room.board.edges[otherEdgeId]?.road === playerId)) return true;
  }
  return false;
}

export function getTradeRatios(room: Room, playerId: string): Resources {
  const ratios: Resources = { wood: 4, brick: 4, sheep: 4, wheat: 4, ore: 4 };
  for (const v of room.board.vertices) {
    if (v.building && v.building.owner === playerId && v.port) {
      if (v.port === '3:1') {
        RESOURCES.forEach(r => { if (ratios[r] > 3) ratios[r] = 3; });
      } else if (ratios[v.port]) {
        ratios[v.port] = 2;
      }
    }
  }
  return ratios;
}

export function checkGoldPhaseTransition(room: Room): void {
  const bank = getBankRemaining(room);
  const totalBankAvailable = RESOURCES.reduce((s, r) => s + bank[r], 0);
  if (totalBankAvailable === 0) {
    room.players.forEach(p => { p.goldPending = 0; });
  }

  const anyGoldPending = room.players.some(p => p.goldPending > 0);
  if (!anyGoldPending && room.phase === 'GOLD_PICK') {
    room.phase = room.PreGoldPhase || 'MAIN';
    room.PreGoldPhase = null;
    if (room.phase === 'SETUP_NEXT') advanceSetupTurn(room);
  }
}

export function advanceSetupTurn(room: Room): void {
  room.setupStep++;
  if (room.setupStep >= room.setupOrder.length) {
    room.status = 'PLAYING';
    room.turnIndex = 0;
    room.phase = 'ROLL';
    addLog(room, `Setup complete! ${room.players[0]?.name}'s turn to roll.`);
  } else {
    room.turnIndex = room.setupOrder[room.setupStep];
    room.phase = 'SETUP_SETTLEMENT';
  }
}
