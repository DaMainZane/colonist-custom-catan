// MODULE: actions "discard" and "pick" (resources owed after a seven / gold / Year of Plenty); a discard may also give up held wild tokens that count toward the hand (fish) | USED BY: packs/base/actions/index
import { bankGive, defsOf, getPlayer, getWildTokens, payToBank, popPhase, takeWildToken, WILD_TOKENS } from '../../../shared';
import type { ActionDef, Ctx, Id, WildTokenDef } from '../../../shared';
import { parseResources, sumResources } from '../trading';

/**
 * `payload.wild` of a discard: `{ tokenId: count }` for held wild tokens flagged `countInDiscard` (Tidebound fish). Returns null if it is malformed
 * or asks for more than the player holds. Absent or empty is fine and means "resources only", exactly as before wild tokens existed.
 */
function parseWildDiscard(ctx: Ctx, pid: Id, raw: any): Record<string, number> | null {
  const out: Record<string, number> = {};
  if (raw === undefined || raw === null) return out;
  if (typeof raw !== 'object') return null;
  const defs = defsOf<WildTokenDef>(ctx.reg, WILD_TOKENS);
  for (const [id, v] of Object.entries(raw)) {
    const n = Number(v) || 0;
    if (n === 0) continue;
    const def = defs.get(id);
    if (!def || !def.countInDiscard || !Number.isInteger(n) || n < 0) return null;
    if (n > getWildTokens(ctx.g, pid, id)) return null;
    out[id] = n;
  }
  return out;
}

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
    const wild = parseWildDiscard(ctx, pid, payload?.wild);
    if (!wild) return 'Invalid discard';
    if (sumResources(cards) + sumResources(wild) !== need) return `Discard exactly ${need} cards`;
    return null;
  },
  apply(ctx, pid, payload) {
    const p = getPlayer(ctx.g, pid)!;
    const cards = parseResources(ctx.reg, payload.cards)!;
    const wild = parseWildDiscard(ctx, pid, payload.wild) ?? {};
    const count = sumResources(cards) + sumResources(wild);
    payToBank(ctx, p, cards);
    for (const [resource, amount] of Object.entries(cards)) {
      ctx.emit('transferred', { from: pid, to: 'bank', resource, amount, kind: 'discard' });
    }
    // Wild tokens (fish) are not bank cards: they simply leave the hand.
    for (const [tokenId, amount] of Object.entries(wild)) {
      takeWildToken(ctx.g, pid, tokenId, amount);
      ctx.emit('wildTokenDiscarded', { playerId: pid, tokenId, amount });
    }
    p.pending.discard = 0;
    ctx.emit('discarded', { playerId: pid, count });
    ctx.log(`${p.avatar} ${p.name} discarded ${count} cards`, p.color);
    if (ctx.g.players.every(x => !(x.pending.discard || 0))) popPhase(ctx);
  },
  /** One deterministic candidate: discard from the biggest piles first, then (only if the hand is mostly tokens) held wild tokens. */
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
    const wild: Record<string, number> = {};
    if (need > 0) {
      for (const def of defsOf<WildTokenDef>(ctx.reg, WILD_TOKENS).values()) {
        if (!def.countInDiscard) continue;
        const take = Math.min(need, getWildTokens(ctx.g, pid, def.id));
        if (take > 0) wild[def.id] = take;
        need -= take;
        if (need <= 0) break;
      }
    }
    return [Object.keys(wild).length > 0 ? { cards, wild } : { cards }];
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
