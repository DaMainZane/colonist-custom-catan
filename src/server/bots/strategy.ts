import { RESOURCES } from '../constants';
import { addLog } from '../rooms';
import {
  canPlaceRoad,
  canPlaceSettlement,
  getBankRemaining,
  getPlayerVP,
  getTotalResources,
  getTradeRatios
} from '../rules';
import type { Player, Resources, Room, Trade } from '../types';
import { getPips } from '../util';

export function getBotProducedResources(room: Room, botId: string): Resources {
  const prod: Resources = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0, gold: 0 };
  for (const v of room.board.vertices) {
    if (v.building && v.building.owner === botId) {
      const mult = v.building.type === 'city' ? 2 : 1;
      for (const hId of v.hexIds) {
        const h = room.board.hexes[hId];
        if (h && !h.fog && prod[h.type] !== undefined) {
          prod[h.type] += getPips(h.number) * mult;
        }
      }
    }
  }
  return prod;
}

export function scoreVertexForHardBot(room: Room, bot: Player, vertexId: number): number {
  const v = room.board.vertices[vertexId];
  if (!v) return -999;

  const existingProd = getBotProducedResources(room, bot.id);
  let score = 0;
  const typesAtVertex = new Set<string>();
  const numbersAtVertex = new Set<number>();

  for (const hId of v.hexIds) {
    const h = room.board.hexes[hId];
    if (!h || h.type === 'water') continue;
    if (h.fog) {
      score += 5.0; // Unexplored fog tile bonus
      continue;
    }
    if (h.type === 'desert') continue;

    const pips = getPips(h.number);
    score += pips * 3.0;

    if (h.type === 'gold') {
      score += 6.5; // High priority for Colonist Gold tiles
    } else if (RESOURCES.includes(h.type)) {
      typesAtVertex.add(h.type);
      // Strongly reward resources the bot doesn't produce yet
      if (existingProd[h.type] === 0) score += 5.5;
      if (h.type === 'wheat' || h.type === 'ore') score += 1.5;
    }

    if (h.number) {
      if (numbersAtVertex.has(h.number)) score -= 1.5; // Diversify numbers
      numbersAtVertex.add(h.number);
    }
  }

  // Resource diversity bonus
  score += typesAtVertex.size * 3.5;

  // Synergy bonus: Wood+Brick or Wheat+Ore
  const hasWood = existingProd.wood > 0 || typesAtVertex.has('wood');
  const hasBrick = existingProd.brick > 0 || typesAtVertex.has('brick');
  const hasWheat = existingProd.wheat > 0 || typesAtVertex.has('wheat');
  const hasOre = existingProd.ore > 0 || typesAtVertex.has('ore');
  if (hasWood && hasBrick) score += 4.0;
  if (hasWheat && hasOre) score += 5.0;

  // Port synergy
  if (v.port === '3:1') score += 4.5;
  else if (v.port && (existingProd[v.port] >= 4 || typesAtVertex.has(v.port))) score += 6.5;

  return score;
}

export function chooseBestRoadForHardBot(room: Room, bot: Player, mustConnectVertexId: number | null = null) {
  const validEdges = room.board.edges.filter(e => canPlaceRoad(room, bot.id, e.id, mustConnectVertexId));
  if (validEdges.length === 0) return null;

  let bestEdge = validEdges[0];
  let bestScore = -9999;

  for (const e of validEdges) {
    let score = 0;
    for (const endVId of [e.v1, e.v2]) {
      const endV = room.board.vertices[endVId];
      if (!endV) continue;

      for (const hId of endV.hexIds) {
        if (room.board.hexes[hId]?.fog) score += 14;
      }

      // Direct buildable settlement spot at endpoint
      if (canPlaceSettlement(room, bot.id, endVId, true)) {
        score += 40 + scoreVertexForHardBot(room, bot, endVId);
      }

      // Check 1 step further for high-value settlement spots
      for (const nextVId of endV.adjacentVertices) {
        if (canPlaceSettlement(room, bot.id, nextVId, true)) {
          score += 18 + scoreVertexForHardBot(room, bot, nextVId) * 0.6;
        }
      }
    }
    score += Math.random() * 1.5;
    if (score > bestScore) {
      bestScore = score;
      bestEdge = e;
    }
  }
  return bestEdge;
}

// Determines what the Hard Bot is currently trying to build, what it needs, and what it refuses to trade away
export function analyzeBotStrategy(room: Room, bot: Player) {
  const res = { ...bot.resources };
  const hasUpgradeableSettlement = bot.citiesLeft > 0 &&
    room.board.vertices.some(v => v.building && v.building.owner === bot.id && v.building.type === 'settlement');
  const hasOpenSettleSpot = bot.settlementsLeft > 0 &&
    room.board.vertices.some(v => canPlaceSettlement(room, bot.id, v.id, false));

  const plans: any[] = [];

  if (hasUpgradeableSettlement) {
    const missing: string[] = [];
    for (let i = res.wheat; i < 2; i++) missing.push('wheat');
    for (let i = res.ore; i < 3; i++) missing.push('ore');
    plans.push({
      type: 'city',
      priority: 100 - missing.length * 18,
      cost: { wood: 0, brick: 0, sheep: 0, wheat: 2, ore: 3 },
      missing
    });
  }

  if (hasOpenSettleSpot) {
    const missing: string[] = [];
    if (res.wood < 1) missing.push('wood');
    if (res.brick < 1) missing.push('brick');
    if (res.sheep < 1) missing.push('sheep');
    if (res.wheat < 1) missing.push('wheat');
    plans.push({
      type: 'settlement',
      priority: 95 - missing.length * 18,
      cost: { wood: 1, brick: 1, sheep: 1, wheat: 1, ore: 0 },
      missing
    });
  }

  if (room.devDeck.length > 0) {
    const missing: string[] = [];
    if (res.sheep < 1) missing.push('sheep');
    if (res.wheat < 1) missing.push('wheat');
    if (res.ore < 1) missing.push('ore');
    plans.push({
      type: 'dev',
      priority: 72 - missing.length * 16,
      cost: { wood: 0, brick: 0, sheep: 1, wheat: 1, ore: 1 },
      missing
    });
  }

  if (bot.roadsLeft > 0 && !hasOpenSettleSpot) {
    const missing: string[] = [];
    if (res.wood < 1) missing.push('wood');
    if (res.brick < 1) missing.push('brick');
    plans.push({
      type: 'road',
      priority: 65 - missing.length * 16,
      cost: { wood: 1, brick: 1, sheep: 0, wheat: 0, ore: 0 },
      missing
    });
  }

  plans.sort((a, b) => b.priority - a.priority);
  const topPlan = plans[0] || {
    type: 'settlement',
    cost: { wood: 1, brick: 1, sheep: 1, wheat: 1, ore: 0 },
    missing: ['wheat']
  };

  const surplus: Resources = {};
  RESOURCES.forEach(r => {
    const keep = topPlan.cost[r] || 0;
    surplus[r] = Math.max(0, (res[r] || 0) - keep);
  });

  return { topPlan, plans, surplus };
}

export function chooseBestGoldResourceForBot(room: Room, bot: Player): string | null {
  const bank = getBankRemaining(room);
  const avail = RESOURCES.filter(r => bank[r] > 0);
  if (avail.length === 0) return null;

  const { topPlan } = analyzeBotStrategy(room, bot);
  for (const m of topPlan.missing) {
    if (bank[m] > 0) return m;
  }

  // Otherwise pick the rarest resource in hand
  avail.sort((a, b) => (bot.resources[a] || 0) - (bot.resources[b] || 0));
  return avail[0];
}

// Evaluates a player's trade offer from the perspective of an Advanced Hard Bot
export function evaluateTradeForHardBot(room: Room, bot: Player, trade: Trade): string {
  if (!trade || trade.fromId === bot.id) return 'declined';

  // 1. Check if bot actually has all requested resources
  let totalGiveByBot = 0;
  let totalGetByBot = 0;
  for (const r of RESOURCES) {
    const reqAmt = Number(trade.request[r]) || 0;
    const offAmt = Number(trade.offer[r]) || 0;
    if (reqAmt > (bot.resources[r] || 0)) return 'declined';
    totalGiveByBot += reqAmt;
    totalGetByBot += offAmt;
  }
  if (totalGiveByBot === 0 || totalGetByBot === 0) return 'declined';

  // 2. Hard Bot refuses to trade with a player close to winning!
  const proposer = room.players.find(p => p.id === trade.fromId);
  if (proposer) {
    const proposerPublicVp = getPlayerVP(room, proposer, false);
    if (proposerPublicVp >= Math.max(4, room.settings.vpToWin - 2)) {
      return 'declined';
    }
  }

  // 3. Check if trade helps bot's active build plan without sacrificing locked cards
  const { topPlan, surplus } = analyzeBotStrategy(room, bot);

  let helpsMissing = 0;
  let hurtsLocked = false;
  for (const r of RESOURCES) {
    const reqAmt = Number(trade.request[r]) || 0;
    const offAmt = Number(trade.offer[r]) || 0;
    if (offAmt > 0 && topPlan.missing.includes(r)) {
      helpsMissing += offAmt;
    }
    if (reqAmt > surplus[r]) {
      hurtsLocked = true;
    }
  }

  // Accept if it directly gives a needed resource using only surplus cards
  if (helpsMissing > 0 && !hurtsLocked && totalGetByBot >= totalGiveByBot) {
    return 'accepted';
  }

  // Accept favorable 2-for-1 (or better) trades if it doesn't break an immediate 0-missing build
  if (totalGetByBot > totalGiveByBot && topPlan.missing.length > 0 && !hurtsLocked) {
    return 'accepted';
  }

  // Accept even 1-for-1 if the bot has >= 3 of the requested resource and 0 of the offered resource
  if (totalGetByBot === totalGiveByBot) {
    const givesAbundant = RESOURCES.every(r => (trade.request[r] || 0) === 0 || bot.resources[r] >= 3);
    const getsScarce = RESOURCES.some(r => (trade.offer[r] || 0) > 0 && bot.resources[r] === 0);
    if (givesAbundant && getsScarce) return 'accepted';
  }

  return 'declined';
}

export function tryHardBotBankTrade(room: Room, bot: Player): boolean {
  const { topPlan, surplus } = analyzeBotStrategy(room, bot);
  if (topPlan.missing.length === 0) return false;

  const targetRes = topPlan.missing[0];
  const bank = getBankRemaining(room);
  if (bank[targetRes] <= 0) return false;

  const ratios = getTradeRatios(room, bot.id);
  for (const r of RESOURCES) {
    if (r === targetRes) continue;
    const ratio = ratios[r];
    if (surplus[r] >= ratio) {
      bot.resources[r] -= ratio;
      bot.resources[targetRes] += 1;
      addLog(room, `${bot.avatar} ${bot.name} traded ${ratio} ${r} for 1 ${targetRes} with the Bank 🏦`, bot.color);
      return true;
    }
  }
  return false;
}

export function tryHardBotProposeTrade(room: Room, bot: Player): boolean {
  if (bot.proposedTradeThisTurn || room.activeTrade) return false;
  const { topPlan, surplus } = analyzeBotStrategy(room, bot);
  if (topPlan.missing.length !== 1) return false; // Propose trade when 1 card away from a build!

  const wantRes = topPlan.missing[0];
  const offerRes = RESOURCES.find(r => r !== wantRes && surplus[r] >= 1);
  if (!offerRes) return false;

  // Check if any other player actually has at least 1 card
  const anyOtherHasCards = room.players.some(p => p.id !== bot.id && getTotalResources(p) > 0);
  if (!anyOtherHasCards) return false;

  bot.proposedTradeThisTurn = true;
  const offer: Resources = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
  const request: Resources = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
  offer[offerRes] = 1;
  request[wantRes] = 1;

  const responses: Record<string, string> = {};
  room.players.forEach(p => {
    if (p.id !== bot.id) responses[p.id] = 'pending';
  });

  room.activeTrade = {
    id: Date.now(),
    fromId: bot.id,
    fromName: bot.name,
    fromAvatar: bot.avatar,
    fromColor: bot.color,
    offer,
    request,
    responses
  };

  addLog(room, `${bot.avatar} ${bot.name} wants to give 1 ${offerRes} for 1 ${wantRes}`, bot.color);
  return true;
}

export function chooseBestRobberHexForHardBot(room: Room, bot: Player) {
  const candidates = room.board.hexes.filter(h => h.type !== 'water' && !h.fog && h.id !== room.board.robberHexId);
  let bestHex = candidates[0];
  let bestScore = -9999;

  for (const h of candidates) {
    let botHasBuilding = false;
    let oppWeight = 0;
    let maxOppVp = 0;

    for (const vId of h.vertexIds) {
      const b = room.board.vertices[vId]?.building;
      if (!b) continue;
      if (b.owner === bot.id) {
        botHasBuilding = true;
      } else {
        const opp = room.players.find(p => p.id === b.owner);
        const vp = opp ? getPlayerVP(room, opp, false) : 2;
        const mult = b.type === 'city' ? 2 : 1;
        oppWeight += mult * (1 + vp * 0.4);
        if (vp > maxOppVp) maxOppVp = vp;
      }
    }

    if (botHasBuilding) continue; // Never block own hex!

    const pips = getPips(h.number) + (h.type === 'gold' ? 3 : 0);
    const score = oppWeight > 0 ? (pips * 10 * oppWeight) + (maxOppVp * 8) : -pips;
    if (score > bestScore) {
      bestScore = score;
      bestHex = h;
    }
  }

  return bestHex || candidates[0];
}
