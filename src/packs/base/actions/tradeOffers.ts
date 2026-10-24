// MODULE: actions "propose_trade", "respond_trade", "confirm_trade", "cancel_trade" (player-to-player trading) | USED BY: packs/base/actions/index
import { getPlayer } from '../../../shared';
import type { ActionDef, GameState, Id, Resources } from '../../../shared';
import { executeTrade, holds, parseResources, sumResources, tradeBlocker } from '../trading';

const describe = (r: Resources): string => Object.entries(r).map(([k, n]) => `${n} ${k}`).join(', ');

export const proposeTradeAction: ActionDef = {
  type: 'propose_trade',
  validate(ctx, pid, payload) {
    const offer = parseResources(ctx.reg, payload?.offer);
    const request = parseResources(ctx.reg, payload?.request);
    if (!offer || !request) return 'Invalid trade';
    if (sumResources(offer) === 0 || sumResources(request) === 0) {
      return 'Select at least 1 card to give and 1 card you want!';
    }
    const p = getPlayer(ctx.g, pid)!;
    if (!holds(p, offer)) return "You don't have enough cards for that offer!";
    return null;
  },
  apply(ctx, pid, payload) {
    const { g, reg } = ctx;
    const p = getPlayer(g, pid)!;
    const offer = parseResources(reg, payload.offer)!;
    const request = parseResources(reg, payload.request)!;
    const responses: Record<Id, 'pending' | 'accepted' | 'declined'> = {};
    for (const other of g.players) if (other.id !== pid) responses[other.id] = 'pending';

    g.ext.base.tradeSeq++;
    g.trade = { id: g.ext.base.tradeSeq, fromId: pid, offer, request, responses };
    p.flags.proposedTrade = true;
    ctx.emit('tradeProposed', { playerId: pid, offer, request });
    ctx.log(`${p.avatar} ${p.name} wants to give [${describe(offer)}] for [${describe(request)}]`, p.color);
  }
};

const isResponder = (g: GameState, pid: Id): boolean =>
  !!g.trade && g.trade.fromId !== pid && g.trade.responses[pid] !== undefined;

export const respondTradeAction: ActionDef = {
  type: 'respond_trade',
  actor: isResponder,
  validate(ctx, pid, payload) {
    const { g } = ctx;
    const trade = g.trade;
    if (!trade) return 'No active trade';
    if (payload?.decision !== 'accepted' && payload?.decision !== 'declined') return 'Invalid response';
    if (payload.decision === 'accepted') {
      const partner = getPlayer(g, pid)!;
      if (!holds(partner, trade.request)) return 'You do not have the required resources for this trade!';
    }
    return null;
  },
  apply(ctx, pid, payload) {
    const { g } = ctx;
    const trade = g.trade!;
    trade.responses[pid] = payload.decision;
    ctx.emit('tradeResponse', { playerId: pid, decision: payload.decision });

    // A bot proposer cannot click "confirm", so the first acceptance completes the trade.
    const proposer = getPlayer(g, trade.fromId)!;
    if (payload.decision === 'accepted' && proposer.isBot) {
      executeTrade(ctx, proposer, getPlayer(g, pid)!, trade);
    }
  },
  legal: () => [{ decision: 'accepted' }, { decision: 'declined' }]
};

export const confirmTradeAction: ActionDef = {
  type: 'confirm_trade',
  validate(ctx, pid, payload) {
    const { g } = ctx;
    const trade = g.trade;
    if (!trade || trade.fromId !== pid) return 'No trade to confirm';
    const partnerId = payload?.partnerId ?? Object.keys(trade.responses).find(id => trade.responses[id] === 'accepted');
    if (!partnerId || trade.responses[partnerId] !== 'accepted') {
      return 'Wait for a player or bot to accept your trade offer!';
    }
    return tradeBlocker(trade, getPlayer(g, pid)!, getPlayer(g, partnerId)!);
  },
  apply(ctx, pid, payload) {
    const { g } = ctx;
    const trade = g.trade!;
    const partnerId = payload?.partnerId ?? Object.keys(trade.responses).find(id => trade.responses[id] === 'accepted')!;
    executeTrade(ctx, getPlayer(g, pid)!, getPlayer(g, partnerId)!, trade);
  },
  legal(ctx) {
    const trade = ctx.g.trade;
    if (!trade) return [];
    return Object.keys(trade.responses).filter(id => trade.responses[id] === 'accepted').map(partnerId => ({ partnerId }));
  }
};

export const cancelTradeAction: ActionDef = {
  type: 'cancel_trade',
  validate(ctx, pid) {
    return ctx.g.trade && ctx.g.trade.fromId === pid ? null : 'No trade to cancel';
  },
  apply(ctx) {
    ctx.g.trade = null;
    ctx.emit('tradeCancelled', {});
  },
  legal: () => [{}]
};
