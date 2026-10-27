// MODULE: actions "propose_trade", "respond_trade", "counter_trade", "confirm_trade", "cancel_trade" (player-to-player trading) | USED BY: packs/base/actions/index
import { currentPlayer, getPlayer, isWildTokenResource } from '../../../shared';
import type { ActionDef, GameState, Id, Resources, TradeState } from '../../../shared';
import { executeTrade, holds, openTrades, parseResources, pushTrade, removeTrade, sumResources, syncPrimaryTrade, tradeBlocker } from '../trading';

const describe = (r: Resources): string => Object.entries(r).map(([k, n]) => `${n} ${k}`).join(', ');

/** Finds the trade a responder is acting on (by explicit `tradeId`, or the first pending/open trade for `pid`). */
function findResponderTrade(g: GameState, pid: Id, tradeId?: number): TradeState | undefined {
  const list = openTrades(g);
  if (tradeId !== undefined && tradeId !== null) {
    const t = list.find(tr => tr.id === Number(tradeId));
    return t && t.fromId !== pid && t.responses[pid] !== undefined ? t : undefined;
  }
  return (
    list.find(tr => tr.fromId !== pid && tr.responses[pid] === 'pending') ??
    list.find(tr => tr.fromId !== pid && tr.responses[pid] !== undefined)
  );
}

/** Finds the trade a proposer is confirming or cancelling. */
function findProposerTrade(g: GameState, pid: Id, tradeId?: number, partnerId?: Id): TradeState | undefined {
  const list = openTrades(g);
  if (tradeId !== undefined && tradeId !== null) {
    const t = list.find(tr => tr.id === Number(tradeId));
    return t && t.fromId === pid ? t : undefined;
  }
  if (partnerId) {
    const withPartner = list.find(tr => tr.fromId === pid && tr.responses[partnerId] === 'accepted');
    if (withPartner) return withPartner;
  }
  return list.find(tr => tr.fromId === pid && Object.values(tr.responses).includes('accepted')) ?? list.find(tr => tr.fromId === pid);
}

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
    // Nobody to trade with: the server sees every hand, so this is exact (a client-side guess went stale). Bots and wild tokens skip the check.
    if (!p.isBot) {
      for (const r of Object.keys(request)) {
        if (!(request[r] > 0) || isWildTokenResource(ctx.reg, r)) continue;
        const anyone = ctx.g.players.some(o => o.id !== pid && (o.resources[r] || 0) > 0);
        if (!anyone) return `No one has any ${ctx.reg.resources.get(r)?.name ?? r} to trade.`;
      }
    }
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
    const trade: TradeState = { id: g.ext.base.tradeSeq, fromId: pid, offer, request, responses };
    pushTrade(g, trade);
    p.flags.proposedTrade = true;
    ctx.emit('tradeProposed', { tradeId: trade.id, playerId: pid, offer, request });
    ctx.log(`${p.avatar} ${p.name} wants to give [${describe(offer)}] for [${describe(request)}]`, p.color);
  }
};

const isResponder = (g: GameState, pid: Id): boolean =>
  openTrades(g).some(t => t.fromId !== pid && t.responses[pid] !== undefined);

export const respondTradeAction: ActionDef = {
  type: 'respond_trade',
  actor: isResponder,
  validate(ctx, pid, payload) {
    const { g } = ctx;
    const trade = findResponderTrade(g, pid, payload?.tradeId);
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
    const trade = findResponderTrade(g, pid, payload?.tradeId)!;
    trade.responses[pid] = payload.decision;
    ctx.emit('tradeResponse', { tradeId: trade.id, playerId: pid, decision: payload.decision });

    const proposer = getPlayer(g, trade.fromId)!;
    // When a bot's offer is declined by everyone, close it immediately so the bot's turn continues.
    // Human offers stay visible in the stack with [X] badges until the offer timer expires or the proposer closes it.
    if (
      proposer.isBot &&
      payload.decision === 'declined' &&
      Object.values(trade.responses).every(r => r === 'declined')
    ) {
      removeTrade(g, trade.id);
      ctx.emit('tradeCancelled', { tradeId: trade.id });
      return;
    }

    // A bot proposer cannot click "confirm", so the first acceptance completes the trade.
    if (payload.decision === 'accepted' && proposer.isBot) {
      executeTrade(ctx, proposer, getPlayer(g, pid)!, trade);
    }
  },
  legal(ctx, pid) {
    const t = findResponderTrade(ctx.g, pid);
    if (!t || t.responses[pid] !== 'pending') return [];
    return [{ tradeId: t.id, decision: 'accepted' }, { tradeId: t.id, decision: 'declined' }];
  }
};

/**
 * A responder edits an open offer and sends it back. The countered offer is replaced by a new one at the top of the stack
 * from the countering player to the original proposer only (who can accept, decline or counter again).
 * Payload is from the counterer's side: `offer` = what they give, `request` = what they want.
 */
export const counterTradeAction: ActionDef = {
  type: 'counter_trade',
  actor: isResponder,
  validate(ctx, pid, payload) {
    const { g, reg } = ctx;
    const target = findResponderTrade(g, pid, payload?.tradeId);
    if (!target) return 'No active trade';
    const offer = parseResources(reg, payload?.offer);
    const request = parseResources(reg, payload?.request);
    if (!offer || !request) return 'Invalid counter offer';
    if (sumResources(offer) === 0 || sumResources(request) === 0) {
      return 'Select at least 1 card to give and 1 card you want!';
    }
    if (!holds(getPlayer(g, pid)!, offer)) return "You don't have enough cards for that counter offer!";
    return null;
  },
  apply(ctx, pid, payload) {
    const { g, reg } = ctx;
    const p = getPlayer(g, pid)!;
    const previous = findResponderTrade(g, pid, payload?.tradeId)!;
    const original = getPlayer(g, previous.fromId)!;
    const offer = parseResources(reg, payload.offer)!;
    const request = parseResources(reg, payload.request)!;

    g.ext.base.tradeSeq++;
    const counter: TradeState = {
      id: g.ext.base.tradeSeq,
      fromId: pid,
      offer,
      request,
      responses: { [original.id]: 'pending' }
    };
    g.trades = [counter, ...openTrades(g).filter(t => t.id !== previous.id)];
    syncPrimaryTrade(g);
    ctx.emit('tradeCountered', { tradeId: counter.id, replacedTradeId: previous.id, playerId: pid, toId: original.id, offer, request });
    ctx.log(`${p.avatar} ${p.name} counters ${original.name}: [${describe(offer)}] for [${describe(request)}]`, p.color);
  }
};

export const confirmTradeAction: ActionDef = {
  type: 'confirm_trade',
  actor: (g, pid) => openTrades(g).some(t => t.fromId === pid),
  validate(ctx, pid, payload) {
    const { g } = ctx;
    const trade = findProposerTrade(g, pid, payload?.tradeId, payload?.partnerId);
    if (!trade || trade.fromId !== pid) return 'No trade to confirm';
    const partnerId = payload?.partnerId ?? Object.keys(trade.responses).find(id => trade.responses[id] === 'accepted');
    if (!partnerId || trade.responses[partnerId] !== 'accepted') {
      return 'Wait for a player or bot to accept your trade offer!';
    }
    return tradeBlocker(trade, getPlayer(g, pid)!, getPlayer(g, partnerId)!);
  },
  apply(ctx, pid, payload) {
    const { g } = ctx;
    const trade = findProposerTrade(g, pid, payload?.tradeId, payload?.partnerId)!;
    const partnerId = payload?.partnerId ?? Object.keys(trade.responses).find(id => trade.responses[id] === 'accepted')!;
    executeTrade(ctx, getPlayer(g, pid)!, getPlayer(g, partnerId)!, trade);
  },
  legal(ctx, pid) {
    const out: { tradeId: number; partnerId: Id }[] = [];
    for (const trade of openTrades(ctx.g)) {
      if (trade.fromId !== pid) continue;
      for (const partnerId of Object.keys(trade.responses)) {
        if (trade.responses[partnerId] === 'accepted') out.push({ tradeId: trade.id, partnerId });
      }
    }
    return out;
  }
};

export const cancelTradeAction: ActionDef = {
  type: 'cancel_trade',
  actor: (g, pid) => openTrades(g).some(t => t.fromId === pid) || currentPlayer(g)?.id === pid,
  validate(ctx, pid, payload) {
    const { g } = ctx;
    const list = openTrades(g);
    if (list.length === 0) return 'No trade to cancel';
    if (payload?.tradeId !== undefined && payload?.tradeId !== null) {
      const target = list.find(t => t.id === Number(payload.tradeId));
      if (!target) return 'No trade to cancel';
      return target.fromId === pid || currentPlayer(g)?.id === pid ? null : 'No trade to cancel';
    }
    const own = list.find(t => t.fromId === pid);
    return own || currentPlayer(g)?.id === pid ? null : 'No trade to cancel';
  },
  apply(ctx, pid, payload) {
    const { g } = ctx;
    const list = openTrades(g);
    const target =
      (payload?.tradeId !== undefined && payload?.tradeId !== null
        ? list.find(t => t.id === Number(payload.tradeId))
        : list.find(t => t.fromId === pid)) ?? list[0];
    const removed = removeTrade(g, target?.id);
    ctx.emit('tradeCancelled', { tradeId: removed?.id });
  },
  legal(ctx, pid) {
    const own = openTrades(ctx.g).find(t => t.fromId === pid);
    return own ? [{ tradeId: own.id }] : [{}];
  }
};
