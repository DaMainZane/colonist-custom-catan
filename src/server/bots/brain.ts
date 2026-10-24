// MODULE: bot brain (pure: game state -> the one action a bot wants to take; no timers, no sockets) | USED BY: bots/scheduler, bots/sim
import { checkAction, computeVP, getPlayer, legalActions, makeCtx } from '../../shared';
import type { Ctx, GameState, Id, PlayerState, Registry, Resources, TradeState } from '../../shared';
import { CITY, ROAD, SETTLEMENT } from '../../packs/base/constants';
import { openTrades, tradeRatios } from '../../packs/base/trading';
import { getPips } from '../util';

export interface BotMove { type: string; payload: any }
export type Rand = () => number;

interface Legal { type: string; payload: any }

interface Plan {
  type: 'city' | 'settlement' | 'dev' | 'road';
  priority: number;
  cost: Resources;
  /** One entry per missing card. */
  missing: string[];
}

// ---- Small helpers ---------------------------------------------------------

const resIds = (reg: Registry): string[] => [...reg.resources.keys()];

/** A numbered land tile without its own resource (gold): the registry says "special", not a hard-coded id. */
function isWildTile(reg: Registry, type: string): boolean {
  const t = reg.tiles.get(type);
  return !!t && t.land && t.numbered && !t.produces;
}

/** Board locations (vertex or edge ids) where this player could place a piece, ignoring cost. */
function placeable(ctx: Ctx, pid: Id, pieceId: string): number[] {
  const def = ctx.reg.pieces.get(pieceId);
  const p = getPlayer(ctx.g, pid);
  if (!def || !p || (p.pieces[pieceId] || 0) <= 0) return [];
  const slots = def.target === 'vertex' ? ctx.g.board.vertices : ctx.g.board.edges;
  return slots.filter(s => def.canPlace(ctx, pid, s.id, 'build')).map(s => s.id);
}

/** Pips per resource from this player's pieces (settlement x1, city x2), revealed tiles only. */
function producedPips(g: GameState, reg: Registry, pid: Id): Record<string, number> {
  const prod: Record<string, number> = Object.fromEntries(resIds(reg).map(r => [r, 0]));
  for (const v of g.board.vertices) {
    if (!v.piece || v.piece.owner !== pid) continue;
    const mult = reg.pieces.get(v.piece.type)?.produces || 0;
    if (!mult) continue;
    for (const hId of v.hexIds) {
      const h = g.board.hexes[hId];
      if (!h || h.ext.hidden) continue;
      const res = reg.tiles.get(h.type)?.produces;
      if (res) prod[res] += getPips(h.number) * mult;
    }
  }
  return prod;
}

function missingFor(p: PlayerState, cost: Resources): string[] {
  const out: string[] = [];
  for (const [r, need] of Object.entries(cost)) {
    for (let i = p.resources[r] || 0; i < need; i++) out.push(r);
  }
  return out;
}

function pickBest<T>(items: T[], score: (item: T) => number): T | null {
  let best: T | null = null;
  let bestScore = -Infinity;
  for (const it of items) {
    const s = score(it);
    if (s > bestScore) { bestScore = s; best = it; }
  }
  return best;
}

// ---- Scoring ----------------------------------------------------------------

export function scoreVertex(g: GameState, reg: Registry, pid: Id, vertexId: number, prod?: Record<string, number>): number {
  const v = g.board.vertices[vertexId];
  if (!v) return -999;
  const existing = prod ?? producedPips(g, reg, pid);
  let score = 0;
  const types = new Set<string>();
  const numbers = new Set<number>();

  for (const hId of v.hexIds) {
    const h = g.board.hexes[hId];
    const tile = h ? reg.tiles.get(h.type) : undefined;
    if (!h || !tile) continue;
    if (h.ext.hidden) { score += 5.0; continue; } // unexplored fog
    if (!tile.land || !tile.numbered) continue;

    score += getPips(h.number) * 3.0;
    if (isWildTile(reg, h.type)) {
      score += 6.5; // gold
    } else if (tile.produces) {
      types.add(tile.produces);
      if ((existing[tile.produces] || 0) === 0) score += 5.5; // a resource I do not make yet
      if (tile.produces === 'wheat' || tile.produces === 'ore') score += 1.5;
    }
    if (h.number) {
      if (numbers.has(h.number)) score -= 1.5;
      numbers.add(h.number);
    }
  }

  score += types.size * 3.5;

  const has = (r: string): boolean => (existing[r] || 0) > 0 || types.has(r);
  if (has('wood') && has('brick')) score += 4.0;
  if (has('wheat') && has('ore')) score += 5.0;

  if (v.port) {
    const port = reg.ports.get(v.port);
    if (port && port.resource === null) score += 4.5;
    else if (port && port.resource && ((existing[port.resource] || 0) >= 4 || types.has(port.resource))) score += 6.5;
  }
  return score;
}

function scoreRoad(ctx: Ctx, pid: Id, edgeId: number, prod: Record<string, number>, rand: Rand): number {
  const { g } = ctx;
  const e = g.board.edges[edgeId];
  const settlement = ctx.reg.pieces.get(SETTLEMENT);
  const spot = (vId: number): boolean => !!settlement && settlement.canPlace(ctx, pid, vId, 'setup');
  let score = 0;
  for (const endId of [e.v1, e.v2]) {
    const end = g.board.vertices[endId];
    if (!end) continue;
    for (const hId of end.hexIds) if (g.board.hexes[hId]?.ext.hidden) score += 14;
    if (spot(endId)) score += 40 + scoreVertex(g, ctx.reg, pid, endId, prod);
    for (const next of end.adjacentVertices) {
      if (spot(next)) score += 18 + scoreVertex(g, ctx.reg, pid, next, prod) * 0.6;
    }
  }
  return score + rand() * 1.5;
}

/** Null means "my own hex, never block it". */
function scoreRobberHex(g: GameState, reg: Registry, pid: Id, hexId: number): number | null {
  const h = g.board.hexes[hexId];
  let mine = false;
  let oppWeight = 0;
  let maxOppVp = 0;
  for (const vId of h.vertexIds) {
    const piece = g.board.vertices[vId]?.piece;
    if (!piece) continue;
    if (piece.owner === pid) { mine = true; continue; }
    const opp = getPlayer(g, piece.owner);
    const vp = opp ? computeVP(g, reg, opp, false) : 2;
    const mult = reg.pieces.get(piece.type)?.produces || 1;
    oppWeight += mult * (1 + vp * 0.4);
    if (vp > maxOppVp) maxOppVp = vp;
  }
  if (mine) return null;
  const pips = getPips(h.number) + (isWildTile(reg, h.type) ? 3 : 0);
  return oppWeight > 0 ? pips * 10 * oppWeight + maxOppVp * 8 : -pips;
}

// ---- Strategy -----------------------------------------------------------------

/** What the bot is saving up for, what it lacks, and which cards it can spend freely. */
export function analyze(g: GameState, reg: Registry, p: PlayerState): { topPlan: Plan; surplus: Record<string, number> } {
  const ctx = makeCtx(g, reg);
  const cost = (id: string): Resources => reg.pieces.get(id)?.cost ?? {};
  const plans: Plan[] = [];

  const canUpgrade = placeable(ctx, p.id, CITY).length > 0;
  const canSettle = placeable(ctx, p.id, SETTLEMENT).length > 0;

  if (canUpgrade) {
    const missing = missingFor(p, cost(CITY));
    plans.push({ type: 'city', priority: 100 - missing.length * 18, cost: cost(CITY), missing });
  }
  if (canSettle) {
    const missing = missingFor(p, cost(SETTLEMENT));
    plans.push({ type: 'settlement', priority: 95 - missing.length * 18, cost: cost(SETTLEMENT), missing });
  }
  if (g.deck.length > 0) {
    const missing = missingFor(p, g.rules.devCost);
    plans.push({ type: 'dev', priority: 72 - missing.length * 16, cost: g.rules.devCost, missing });
  }
  if ((p.pieces[ROAD] || 0) > 0 && !canSettle) {
    const missing = missingFor(p, cost(ROAD));
    plans.push({ type: 'road', priority: 65 - missing.length * 16, cost: cost(ROAD), missing });
  }

  plans.sort((a, b) => b.priority - a.priority);
  const topPlan: Plan = plans[0] ?? {
    type: 'settlement', priority: 0, cost: cost(SETTLEMENT), missing: ['wheat']
  };

  const surplus: Record<string, number> = {};
  for (const r of resIds(reg)) surplus[r] = Math.max(0, (p.resources[r] || 0) - (topPlan.cost[r] || 0));
  return { topPlan, surplus };
}

export function evaluateTrade(g: GameState, reg: Registry, p: PlayerState, trade: TradeState): 'accepted' | 'declined' {
  if (trade.fromId === p.id) return 'declined';
  const ids = resIds(reg);

  let gives = 0; // what I would hand over
  let gets = 0;  // what I would receive
  for (const r of ids) {
    const req = trade.request[r] || 0;
    const off = trade.offer[r] || 0;
    if (req > (p.resources[r] || 0)) return 'declined';
    gives += req;
    gets += off;
  }
  if (gives === 0 || gets === 0) return 'declined';

  // No help for a player close to winning.
  const proposer = getPlayer(g, trade.fromId);
  if (proposer && computeVP(g, reg, proposer, false) >= Math.max(4, g.rules.vpToWin - 2)) return 'declined';

  const { topPlan, surplus } = analyze(g, reg, p);
  let helpsMissing = 0;
  let hurtsLocked = false;
  for (const r of ids) {
    const req = trade.request[r] || 0;
    const off = trade.offer[r] || 0;
    if (off > 0 && topPlan.missing.includes(r)) helpsMissing += off;
    if (req > surplus[r]) hurtsLocked = true;
  }

  if (helpsMissing > 0 && !hurtsLocked && gets >= gives) return 'accepted';
  if (gets > gives && topPlan.missing.length > 0 && !hurtsLocked) return 'accepted';
  if (gets === gives) {
    const givesAbundant = ids.every(r => (trade.request[r] || 0) === 0 || (p.resources[r] || 0) >= 3);
    const getsScarce = ids.some(r => (trade.offer[r] || 0) > 0 && (p.resources[r] || 0) === 0);
    if (givesAbundant && getsScarce) return 'accepted';
  }
  return 'declined';
}

/** Cards to discard: spare cards first, then from the biggest piles. */
function chooseDiscard(g: GameState, reg: Registry, p: PlayerState): Resources {
  const ids = resIds(reg);
  const have: Record<string, number> = { ...p.resources };
  const { surplus } = analyze(g, reg, p);
  const cards: Resources = {};
  for (let need = p.pending.discard || 0; need > 0; need--) {
    let pick = ids.find(r => surplus[r] > 0 && have[r] > 0);
    if (pick) surplus[pick]--;
    else {
      const avail = ids.filter(r => have[r] > 0).sort((a, b) => have[b] - have[a]);
      if (avail.length === 0) break;
      pick = avail[0];
    }
    have[pick]--;
    cards[pick] = (cards[pick] || 0) + 1;
  }
  return cards;
}

/** Bank swap that moves a missing card closer, paid from spare cards. */
function bankTradeMove(g: GameState, reg: Registry, p: PlayerState, plan: Plan, surplus: Record<string, number>): BotMove | null {
  if (plan.missing.length === 0) return null;
  const target = plan.missing[0];
  if ((g.bank[target] || 0) < 1) return null;
  const ratios = tradeRatios(g, reg, p.id);
  const give = pickBest(
    resIds(reg).filter(r => r !== target && surplus[r] >= ratios[r]),
    r => surplus[r] - ratios[r]
  );
  if (!give) return null;
  return { type: 'bank_trade', payload: { give: { [give]: ratios[give] }, get: { [target]: 1 } } };
}

/** One-for-one offer to the table when exactly one card short of the plan. */
function proposeTradeMove(g: GameState, reg: Registry, p: PlayerState, plan: Plan, surplus: Record<string, number>): BotMove | null {
  if (p.flags.proposedTrade || g.trade || plan.missing.length !== 1) return null;
  const want = plan.missing[0];
  const offer = resIds(reg).find(r => r !== want && surplus[r] >= 1);
  if (!offer) return null;
  const someoneHasCards = g.players.some(o => o.id !== p.id && Object.values(o.resources).some(n => n > 0));
  if (!someoneHasCards) return null;
  return { type: 'propose_trade', payload: { offer: { [offer]: 1 }, request: { [want]: 1 } } };
}

// ---- The decision ---------------------------------------------------------------

/**
 * The one action this bot wants to take right now, or null if it has to wait (not its turn,
 * waiting for trade answers, nothing legal). Always returns something the engine accepts.
 */
export function chooseBotAction(g: GameState, reg: Registry, pid: Id, rand: Rand = Math.random): BotMove | null {
  if (g.phase === 'gameover') return null;
  const p = getPlayer(g, pid);
  if (!p) return null;
  const legal = legalActions(g, reg, pid);
  if (legal.length === 0) return null;

  const move = decide(g, reg, p, legal, rand);
  if (!move) return null;
  if (!checkAction(g, reg, { type: move.type, playerId: pid, payload: move.payload })) return move;

  // The heuristic produced something the engine refuses: fall back to something that is allowed.
  return fallback(g, p, legal);
}

function fallback(g: GameState, p: PlayerState, legal: Legal[]): BotMove | null {
  const isMyTurn = g.players[g.turn]?.id === p.id;
  const end = legal.find(a => a.type === 'end_turn');
  if (isMyTurn && end) return end;
  const first = legal[0];
  return first ? { type: first.type, payload: first.payload } : null;
}

function decide(g: GameState, reg: Registry, p: PlayerState, legal: Legal[], rand: Rand): BotMove | null {
  const ctx = makeCtx(g, reg);
  const of = (type: string): Legal[] => legal.filter(a => a.type === type);
  const myTurn = g.players[g.turn]?.id === p.id;

  // Answer any trade offer made to me.
  const pendingTrade = openTrades(g).find(t => t.fromId !== p.id && t.responses[p.id] === 'pending');
  if (pendingTrade) {
    const decision = evaluateTrade(g, reg, p, pendingTrade);
    return { type: 'respond_trade', payload: { tradeId: pendingTrade.id, decision } };
  }

  switch (g.phase) {
    case 'setup_settlement': {
      const prod = producedPips(g, reg, p.id);
      const spot = pickBest(of('build'), a => scoreVertex(g, reg, p.id, a.payload.loc, prod));
      return spot ? { type: 'build', payload: spot.payload } : null;
    }

    case 'setup_road': {
      const prod = producedPips(g, reg, p.id);
      const edge = pickBest(of('build'), a => scoreRoad(ctx, p.id, a.payload.loc, prod, rand));
      return edge ? { type: 'build', payload: edge.payload } : null;
    }

    case 'roll': {
      if (!p.flags.playedDev && p.devCards.includes('knight')) {
        const hex = g.board.hexes[g.board.robberHexId];
        const blockingMe = hex?.vertexIds.some(vId => g.board.vertices[vId]?.piece?.owner === p.id);
        const knight = of('play_dev').find(a => a.payload.card === 'knight');
        if (blockingMe && knight) return { type: 'play_dev', payload: knight.payload };
      }
      return of('roll').length ? { type: 'roll', payload: {} } : null;
    }

    case 'discard': {
      if (!of('discard').length) return null;
      return { type: 'discard', payload: { cards: chooseDiscard(g, reg, p) } };
    }

    case 'pick': {
      const options = of('pick').map(a => a.payload.resource as string);
      if (options.length === 0) return null;
      const { topPlan } = analyze(g, reg, p);
      const wanted = topPlan.missing.find(r => options.includes(r));
      const resource = wanted ?? [...options].sort((a, b) => (p.resources[a] || 0) - (p.resources[b] || 0))[0];
      return { type: 'pick', payload: { resource } };
    }

    case 'robber': {
      const hexes = of('move_robber');
      if (hexes.length === 0) return null;
      let best: Legal | null = null;
      let bestScore = -Infinity;
      for (const a of hexes) {
        const s = scoreRobberHex(g, reg, p.id, a.payload.hexId);
        if (s !== null && s > bestScore) { bestScore = s; best = a; }
      }
      const choice = best ?? hexes[0];
      return { type: 'move_robber', payload: choice.payload };
    }

    case 'robber_steal': {
      const victims = of('steal'); // the engine sorts these: players with cards first, then by VP
      return victims.length ? { type: 'steal', payload: victims[0].payload } : null;
    }

    case 'main':
      return myTurn ? mainPhase(g, reg, ctx, p, legal, rand) : null;

    default:
      return null;
  }
}

function mainPhase(g: GameState, reg: Registry, ctx: Ctx, p: PlayerState, legal: Legal[], rand: Rand): BotMove | null {
  const of = (type: string): Legal[] => legal.filter(a => a.type === type);
  const builds = (piece: string): Legal[] => of('build').filter(a => a.payload.piece === piece);
  const bestVertex = (list: Legal[]): Legal | null => {
    const prod = producedPips(g, reg, p.id);
    return pickBest(list, a => scoreVertex(g, reg, p.id, a.payload.loc, prod));
  };
  const bestRoad = (list: Legal[]): Legal | null => {
    const prod = producedPips(g, reg, p.id);
    return pickBest(list, a => scoreRoad(ctx, p.id, a.payload.loc, prod, rand));
  };

  // My own open offer: wait for answers, then take it down.
  const myTrade = openTrades(g).find(t => t.fromId === p.id);
  if (myTrade) {
    const waiting = Object.values(myTrade.responses).some(r => r === 'pending');
    return waiting ? null : { type: 'cancel_trade', payload: { tradeId: myTrade.id } };
  }

  // 1. Development cards.
  if (!p.flags.playedDev) {
    const plays = of('play_dev');
    const card = (id: string): Legal | undefined => plays.find(a => a.payload.card === id);

    const road = card('roadBuilding');
    if (road && (p.pieces[ROAD] || 0) >= 2 && placeable(ctx, p.id, ROAD).length > 0) {
      return { type: 'play_dev', payload: road.payload };
    }

    const plenty = card('yearOfPlenty');
    if (plenty && resIds(reg).some(r => (g.bank[r] || 0) > 0)) return { type: 'play_dev', payload: plenty.payload };

    const monopolies = plays.filter(a => a.payload.card === 'monopoly');
    if (monopolies.length) {
      const total = (r: string): number => g.players.reduce((s, o) => (o.id === p.id ? s : s + (o.resources[r] || 0)), 0);
      const best = pickBest(monopolies, a => total(a.payload.resource));
      if (best && total(best.payload.resource) >= 2) return { type: 'play_dev', payload: best.payload };
    }

    const knight = card('knight');
    if (knight) return { type: 'play_dev', payload: knight.payload };
  }

  // 2. Free roads from Road Building.
  if ((p.pending.freeRoads || 0) > 0) {
    const road = bestRoad(builds(ROAD));
    if (road) return { type: 'build', payload: road.payload };
  }

  // 3. City, 4. Settlement.
  const city = bestVertex(builds(CITY));
  if (city) return { type: 'build', payload: city.payload };
  const settlement = bestVertex(builds(SETTLEMENT));
  if (settlement) return { type: 'build', payload: settlement.payload };

  // 5. Bank / port swap toward the current plan, 6. offer to the table.
  const { topPlan, surplus } = analyze(g, reg, p);
  const swap = bankTradeMove(g, reg, p, topPlan, surplus);
  if (swap) return swap;
  const offer = proposeTradeMove(g, reg, p, topPlan, surplus);
  if (offer) return offer;

  // 7. Development card.
  if (of('buy_dev').length) return { type: 'buy_dev', payload: {} };

  // 8. Road toward a new settlement spot (or when rich in roads).
  const roads = builds(ROAD);
  if (roads.length) {
    const cost = reg.pieces.get(ROAD)?.cost ?? {};
    const richInRoads = Object.entries(cost).every(([r, n]) => (p.resources[r] || 0) >= n * 2);
    const hasOpenSpot = placeable(ctx, p.id, SETTLEMENT).length > 0;
    if (!hasOpenSpot || richInRoads) {
      const road = bestRoad(roads);
      if (road) return { type: 'build', payload: road.payload };
    }
  }

  // 9. Done.
  return of('end_turn').length ? { type: 'end_turn', payload: {} } : null;
}
