// MODULE: trade helpers (bank ratios from ports, resource parsing, player trade execution) | USED BY: actions/bankTrade, actions/tradeOffers
import type { Ctx, GameState, Id, PlayerState, Registry, Resources, TradeState } from '../../shared';

/** Bank ratio per resource for a player: bankRatio, improved by ports on owned pieces. */
export function tradeRatios(g: GameState, reg: Registry, pid: Id): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of reg.resources.keys()) out[r] = g.rules.bankRatio;
  for (const v of g.board.vertices) {
    if (!v.piece || v.piece.owner !== pid || !v.port) continue;
    const port = reg.ports.get(v.port);
    if (!port) continue;
    for (const r of reg.resources.keys()) {
      if (port.resource === null || port.resource === r) out[r] = Math.min(out[r], port.ratio);
    }
  }
  return out;
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
  g.trade = null;
  ctx.log(`🤝 ${proposer.name} traded with ${partner.name}!`, proposer.color);
}
