// MODULE: tidebound.fishing addon (T7a fish wild token: spend action, counts for a 7 discard, can be stolen, never in the bank; T7b to T7e nets, icon boosts, tide replenish, feed the sea come later) | USED BY: packs/tidebound, tests
import { BOT_GOALS, getPlayer, getWildTokens, priceOf, spendWildToken, WILD_TOKENS } from '../../shared';
import type { ActionDef, AddonDef, BotGoalDef, Ctx, Id, PlayerState, Resources, WildTokenDef } from '../../shared';
import { CITY, SETTLEMENT } from '../base/constants';

/** Wild token id of the fish (also in the shared `BUILTIN_WILD_IDS`, so `isWildTokenResource` already knows it). */
export const FISH = 'fish';
/** Action type: spend one fish as any 1 resource from the bank. */
export const SPEND_FISH = 'spend_fish';

/**
 * The fish token. It lives in `g.ext.core.wildTokens[playerId].fish`, never in `p.resources` or the bank, so it cannot be traded,
 * is not part of the bank supply (`g.bank` has no fish key, nothing caps it) and never makes a bank-trade or "no one has X" check look at it.
 * It counts toward the 7 discard limit (Seven Resolver reads `countInDiscard`) and the robber can steal it (`stealOne` reads `stealable`).
 */
export const fishToken: WildTokenDef = { id: FISH, name: 'Fish', countInDiscard: true, stealable: true };

/**
 * Spend: one fish becomes 1 card of any resource the bank still has. Payload `{ resource }`. Main phase of your own turn (like a bank trade).
 * The token is only spent when the bank can pay, so a fish is never lost to an empty bank.
 */
export const spendFishAction: ActionDef = {
  type: SPEND_FISH,
  validate(ctx: Ctx, pid: Id, payload: any): string | null {
    const { g, reg } = ctx;
    if (!getPlayer(g, pid)) return 'Unknown player';
    if (getWildTokens(g, pid, FISH) <= 0) return 'You have no fish to spend';
    const r = payload?.resource;
    if (typeof r !== 'string' || !reg.resources.has(r)) return 'Choose a resource';
    if ((g.bank[r] || 0) <= 0) return `Bank is out of ${r.toUpperCase()}!`;
    return null;
  },
  apply(ctx: Ctx, pid: Id, payload: any): void {
    const p = getPlayer(ctx.g, pid)!;
    const got = spendWildToken(ctx, pid, FISH, payload.resource, 1);
    p.stats.fishSpent = (p.stats.fishSpent || 0) + got;
    ctx.emit('fishSpent', { playerId: pid, resource: payload.resource, amount: got });
    ctx.log(`🐟 ${p.avatar} ${p.name} spent a fish for 1 ${payload.resource}`, p.color);
  },
  legal(ctx: Ctx, pid: Id): { resource: string }[] {
    if (getWildTokens(ctx.g, pid, FISH) <= 0) return [];
    return [...ctx.reg.resources.keys()].filter(r => (ctx.g.bank[r] || 0) > 0).map(resource => ({ resource }));
  }
};

// ---- Minimal bot support (T7a) -------------------------------------------------------------------------------------------

/** The one resource this hand lacks for `cost`, if it lacks exactly one card in total; otherwise null. */
function oneCardShort(p: PlayerState, cost: Resources): string | null {
  let short = 0;
  let which: string | null = null;
  for (const [r, n] of Object.entries(cost)) {
    const lack = n - (p.resources[r] || 0);
    if (lack > 0) {
      short += lack;
      which = r;
    }
  }
  return short === 1 ? which : null;
}

/**
 * A bot spends a fish only when that one card finishes its next city, settlement or development card, so fish are kept for the build
 * and never spent for nothing. Holding fish is not punished (they count toward the discard limit like any card). Tuning is T13.
 */
export const fishBotGoal: BotGoalDef = {
  id: 'tidebound.fishing',
  goalClass: 'generic',
  actionScore(ctx: Ctx, pid: Id, action: { type: string; payload: any }): number {
    if (action.type !== SPEND_FISH) return 0;
    const { g, reg } = ctx;
    const p = getPlayer(g, pid);
    const r = action.payload?.resource;
    if (!p || typeof r !== 'string') return 0;
    const city = reg.pieces.get(CITY);
    const settlement = reg.pieces.get(SETTLEMENT);
    const hasSettlement = g.board.vertices.some(v => v.piece?.owner === pid && v.piece.type === SETTLEMENT);
    if (city && hasSettlement && (p.pieces[CITY] || 0) > 0 && oneCardShort(p, priceOf(g, reg, p, city)) === r) return 40;
    if (settlement && (p.pieces[SETTLEMENT] || 0) > 0 && oneCardShort(p, priceOf(g, reg, p, settlement)) === r) return 35;
    if (g.deck.length > 0 && oneCardShort(p, g.rules.devCost) === r) return 25;
    return 0;
  }
};

export const fishingAddon: AddonDef = {
  id: 'tidebound.fishing',
  name: 'Fishing',
  description: 'Nets on the coast catch fish, a token that counts as any one resource. Fish icons on the sea boost the catch.',
  links: [
    { target: 'wild-token', kind: 'mechanic' },
    { target: 'marker', kind: 'mechanic' },
    { target: 'piece-cost', kind: 'mechanic' },
    { target: 'seven-resolver', kind: 'mechanic' },
    { target: 'bot-goals', kind: 'bot' },
    { target: 'tidebound.tides', kind: 'content' }
  ],
  register(api) {
    // T7a: the token and its spend action. Nets, icon boosts, tide replenish and feed-the-sea add to this in T7b to T7e.
    api.define(WILD_TOKENS, fishToken);
    api.action(spendFishAction);
    api.phaseAction('main', SPEND_FISH);
    api.define(BOT_GOALS, fishBotGoal);
  }
};
