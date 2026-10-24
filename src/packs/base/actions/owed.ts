// MODULE: actions "discard" and "pick" (resources owed after a seven / gold / Year of Plenty) | USED BY: packs/base/actions/index
import { bankGive, getPlayer, payToBank, popPhase } from '../../../shared';
import type { ActionDef } from '../../../shared';
import { parseResources, sumResources } from '../trading';

export const discardAction: ActionDef = {
  type: 'discard',
  validate(ctx, pid, payload) {
    const p = getPlayer(ctx.g, pid)!;
    const need = p.pending.discard || 0;
    if (need <= 0) return 'Nothing to discard';
    const cards = parseResources(ctx.reg, payload?.cards);
    if (!cards) return 'Invalid discard';
    for (const [r, n] of Object.entries(cards)) {
      if (n > (p.resources[r] || 0)) return 'Invalid discard';
    }
    if (sumResources(cards) !== need) return `Discard exactly ${need} cards`;
    return null;
  },
  apply(ctx, pid, payload) {
    const p = getPlayer(ctx.g, pid)!;
    const cards = parseResources(ctx.reg, payload.cards)!;
    const count = sumResources(cards);
    payToBank(ctx, p, cards);
    for (const [resource, amount] of Object.entries(cards)) {
      ctx.emit('transferred', { from: pid, to: 'bank', resource, amount, kind: 'discard' });
    }
    p.pending.discard = 0;
    ctx.emit('discarded', { playerId: pid, count });
    ctx.log(`${p.avatar} ${p.name} discarded ${count} cards`, p.color);
    if (ctx.g.players.every(x => !(x.pending.discard || 0))) popPhase(ctx);
  },
  /** One deterministic candidate: discard from the biggest piles first. */
  legal(ctx, pid) {
    const p = getPlayer(ctx.g, pid)!;
    let need = p.pending.discard || 0;
    const piles = [...ctx.reg.resources.keys()].sort((a, b) => (p.resources[b] || 0) - (p.resources[a] || 0));
    const cards: Record<string, number> = {};
    for (const r of piles) {
      const take = Math.min(need, p.resources[r] || 0);
      if (take > 0) cards[r] = take;
      need -= take;
      if (need <= 0) break;
    }
    return [{ cards }];
  }
};

export const pickAction: ActionDef = {
  type: 'pick',
  validate(ctx, pid, payload) {
    const p = getPlayer(ctx.g, pid)!;
    if ((p.pending.pick || 0) <= 0) return 'No picks left';
    if (!ctx.reg.resources.has(payload?.resource)) return 'Choose a resource';
    if ((ctx.g.bank[payload.resource] || 0) <= 0) return `Bank is out of ${String(payload.resource).toUpperCase()}!`;
    return null;
  },
  apply(ctx, pid, payload) {
    const p = getPlayer(ctx.g, pid)!;
    const granted = bankGive(ctx, pid, payload.resource, 1);
    p.pending.pick -= 1;
    ctx.emit('picked', { playerId: pid, resource: payload.resource, amount: granted });
    ctx.emit('transferred', { from: 'bank', to: pid, resource: payload.resource, amount: granted, kind: 'pick' });
    ctx.log(`${p.avatar} ${p.name} picked ${payload.resource}`, p.color);
    // Leaving the pick phase when everyone is done is handled by the afterAction hook (settlePicks).
  },
  legal(ctx) {
    return [...ctx.reg.resources.keys()].map(resource => ({ resource }));
  }
};
