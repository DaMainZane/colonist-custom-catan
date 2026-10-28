// MODULE: trade helpers (bank ratios from ratioFor service, resource parsing, multi-offer stack, player trade execution) | USED BY: actions/bankTrade, actions/tradeOffers, hooks
import { getPlayer, ratioFor, tradeRatiosFor } from '../../shared';
import type { Ctx, GameState, Id, PlayerState, Registry, Resources, TradeState } from '../../shared';

export const MAX_OPEN_TRADES = 5;
export { ratioFor };

/** All currently open trade offers (newest first). */
export function openTrades(g: GameState): TradeState[] {
  if (!Array.isArray(g.trades)) {
    g.trades = g.trade ? [g.trade] : [];
  }
  return g.trades;
}

/** Keeps `g.trade` pointing at the newest open offer (`g.trades[0] ?? null`). */
export function syncPrimaryTrade(g: GameState): void {
  const list = openTrades(g);
  g.trade = list[0] ?? null;
}

function sameResources(a: Resources, b: Resources): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if ((a[k] || 0) !== (b[k] || 0)) return false;
  }
  return true;
}

/** Pushes a new offer to the top of the stack (newest first), replacing any identical open offer by the same player. */
export function pushTrade(g: GameState, trade: TradeState): void {
  const list = openTrades(g).filter(
    t => t.id !== trade.id && !(t.fromId === trade.fromId && sameResources(t.offer, trade.offer) && sameResources(t.request, trade.request))
  );
  list.unshift(trade);
  if (list.length > MAX_OPEN_TRADES) list.length = MAX_OPEN_TRADES;
  g.trades = list;
  syncPrimaryTrade(g);
}

/** Removes one trade offer by id (or the top offer if omitted). */
export function removeTrade(g: GameState, tradeId?: number): TradeState | null {
  const list = openTrades(g);
  if (list.length === 0) {
    g.trade = null;
    return null;
  }
  const idx = tradeId !== undefined ? list.findIndex(t => t.id === Number(tradeId)) : 0;
  if (idx < 0) return null;
  const [removed] = list.splice(idx, 1);
  syncPrimaryTrade(g);
  return removed ?? null;
}

/** Drops any open trade offers whose proposer no longer holds the offered cards, and auto-declines pending human responders who lack the requested cards. */
export function pruneInvalidTrades(g: GameState): void {
  if (!Array.isArray(g.trades)) {
    if (g.trade) {
      const proposer = getPlayer(g, g.trade.fromId);
      if (!proposer || !holds(proposer, g.trade.offer)) g.trade = null;
    }
    g.trades = g.trade ? [g.trade] : [];
  } else {
    g.trades = g.trades.filter(t => {
      const proposer = getPlayer(g, t.fromId);
      return !!proposer && holds(proposer, t.offer);
    });
  }
  for (const t of g.trades) {
    for (const [pid, resp] of Object.entries(t.responses)) {
      if (resp !== 'pending') continue;
      const rp = getPlayer(g, pid);
      if (rp && !rp.isBot && !holds(rp, t.request)) {
        t.responses[pid] = 'declined';
      }
    }
  }
  syncPrimaryTrade(g);
}

/** Bank ratio per resource for a player: thin wrapper around the shared S0.5 `ratioFor` / `tradeRatiosFor` service. */
export function tradeRatios(g: GameState, reg: Registry, pid: Id): Record<string, number> {
  return tradeRatiosFor(g, reg, pid);
}

/** Keeps only registered resources with positive whole amounts. Returns null if the input is malformed. */
export function parseResources(reg: Registry, raw: any): Resources | null {
  if (raw === null || typeof raw !== 'object') return null;
  const out: Resources = {};
  for (const [k, v] of Object.entries(raw)) {
    const n = Number(v) || 0;
    if (n === 0) continue;
    if (!reg.resources.has(k) || !Number.isInteger(n) || n < 0) return null;
    out[k] = n;
  }
  return out;
}

export function sumResources(r: Resources): number {
  return Object.values(r).reduce((a, b) => a + b, 0);
}

export function holds(p: PlayerState, r: Resources): boolean {
  return Object.entries(r).every(([k, n]) => (p.resources[k] || 0) >= n);
}

/** Why a proposed swap cannot happen right now, or null if both sides can pay. */
export function tradeBlocker(trade: TradeState, proposer: PlayerState, partner: PlayerState): string | null {
  if (!proposer || !partner || proposer.id === partner.id) return 'Invalid trade partner';
  if (!holds(proposer, trade.offer)) return 'The proposer no longer has the offered cards';
  if (!holds(partner, trade.request)) return 'You do not have the required resources for this trade!';
  return null;
}

export function executeTrade(ctx: Ctx, proposer: PlayerState, partner: PlayerState, trade: TradeState): void {
  const { g } = ctx;
  for (const r of Object.keys(g.bank)) {
    const give = trade.offer[r] || 0;
    const get = trade.request[r] || 0;
    if (!give && !get) continue;
    proposer.resources[r] = (proposer.resources[r] || 0) - give + get;
    partner.resources[r] = (partner.resources[r] || 0) - get + give;
    if (give > 0) ctx.emit('transferred', { from: proposer.id, to: partner.id, resource: r, amount: give, kind: 'playerTrade' });
    if (get > 0) ctx.emit('transferred', { from: partner.id, to: proposer.id, resource: r, amount: get, kind: 'playerTrade' });
  }
  proposer.stats.trades = (proposer.stats.trades || 0) + 1;
  partner.stats.trades = (partner.stats.trades || 0) + 1;
  removeTrade(g, trade.id);
  pruneInvalidTrades(g);
  ctx.log(`🤝 ${proposer.name} traded with ${partner.name}!`, proposer.color);
}
