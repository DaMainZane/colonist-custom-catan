// MODULE: actions "buy_dev" and "play_dev" (dev cards are looked up in the registry) | DEPENDS ON: shared/index | USED BY: packs/base/actions/index
import { canAfford, getPlayer, payToBank } from '../../../shared';
import type { ActionDef } from '../../../shared';

export const buyDevAction: ActionDef = {
  type: 'buy_dev',
  validate(ctx, pid) {
    const p = getPlayer(ctx.g, pid)!;
    if (ctx.g.deck.length === 0) return 'The development deck is empty';
    if (!canAfford(p, ctx.g.rules.devCost)) return 'Not enough resources';
    return null;
  },
  apply(ctx, pid) {
    const p = getPlayer(ctx.g, pid)!;
    const cost = ctx.g.rules.devCost;
    payToBank(ctx, p, cost);
    p.newDevCards.push(ctx.g.deck.pop()!);
    for (const [resource, amount] of Object.entries(cost)) {
      if (amount) ctx.emit('transferred', { from: pid, to: 'bank', resource, amount, kind: 'buyDev' });
    }
    ctx.emit('devBought', { playerId: pid });
    ctx.log(`${p.avatar} ${p.name} bought a Development Card`, p.color);
  },
  legal: () => [{}]
};

export const playDevAction: ActionDef = {
  type: 'play_dev',
  validate(ctx, pid, payload) {
    const p = getPlayer(ctx.g, pid)!;
    const def = ctx.reg.devcards.get(payload?.card);
    if (!def || !def.playable) return 'That card cannot be played';
    if (ctx.g.phase === 'roll' && payload.card !== 'knight') return 'Only a Knight card can be played before rolling the dice';
    if (p.flags.playedDev) return 'You already played a development card this turn';
    if (!p.devCards.includes(payload.card)) return 'You do not have that card (cards bought this turn must wait)';
    return def.validate ? def.validate(ctx, pid, payload) : null;
  },
  apply(ctx, pid, payload) {
    const p = getPlayer(ctx.g, pid)!;
    const def = ctx.reg.devcards.get(payload.card)!;
    p.devCards.splice(p.devCards.indexOf(payload.card), 1);
    p.flags.playedDev = true;
    ctx.emit('devPlayed', { playerId: pid, card: payload.card });
    if (def.play) def.play(ctx, pid, payload);
  },
  legal(ctx, pid) {
    const p = getPlayer(ctx.g, pid)!;
    const out: any[] = [];
    for (const card of new Set(p.devCards)) {
      if (ctx.g.phase === 'roll' && card !== 'knight') continue;
      const def = ctx.reg.devcards.get(card);
      if (!def || !def.playable) continue;
      for (const extra of def.legal ? def.legal(ctx, pid) : [{}]) out.push({ card, ...extra });
    }
    return out;
  }
};
