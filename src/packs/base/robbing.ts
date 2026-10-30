// MODULE: robber helpers (victims on a hex, random steal using the seeded RNG, steal-count modifiers, what set the robber off); a steal can also take a held wild token that is `stealable` (fish) | USED BY: actions/robber, devcards, techEffects
import { defsOf, getPlayer, getWildTokens, grantWildToken, rngInt, takeWildToken, WILD_TOKENS } from '../../shared';
import type { Ctx, GameState, Id, Registry, WildTokenDef } from '../../shared';

/** What made the robber move: a played Knight, or a rolled 7. */
export type StealSource = 'knight' | 'seven';

/**
 * Keyed registry of modifiers that change how many cards one steal takes (the base steal takes 1).
 * Register one with `api.define(STEAL_COUNT_MODS, { id, apply })`. A pack that does not register one changes nothing.
 * The steal still stops when the victim runs out of cards.
 */
export const STEAL_COUNT_MODS = 'stealCountMods';

export interface StealCountModifier {
  id: string;
  apply(g: GameState, reg: Registry, thiefId: Id, victimId: Id, source: StealSource, current: number): number;
  replace?: boolean;
}

/** Marks a held wild token in the steal pool (resource ids never start with it). */
const WILD_PREFIX = 'wild:';

/** Remembers that a Knight (not a 7) is moving the robber. Cleared by `clearStealSource` once the robber move and steal are done. */
export function setStealSource(g: GameState, source: StealSource): void {
  g.ext.core = g.ext.core || {};
  g.ext.core.stealSource = source;
}

/** The steal source now: 'knight' only between a played Knight and the end of its robber move; otherwise 'seven'. */
export function stealSourceOf(g: GameState): StealSource {
  return g.ext?.core?.stealSource === 'knight' ? 'knight' : 'seven';
}

export function clearStealSource(g: GameState): void {
  if (g.ext?.core && 'stealSource' in g.ext.core) delete g.ext.core.stealSource;
}

/** How many cards this steal takes: 1, then every registered modifier in registration order (at least 1). */
export function stealCount(g: GameState, reg: Registry, thiefId: Id, victimId: Id, source: StealSource): number {
  let n = 1;
  for (const m of defsOf<StealCountModifier>(reg, STEAL_COUNT_MODS).values()) {
    n = m.apply(g, reg, thiefId, victimId, source, n);
  }
  return Math.max(1, Math.floor(n));
}

/** Other players with a piece on a corner of the hex. */
export function victimsOnHex(g: GameState, hexId: number, thiefId: Id): Id[] {
  const hex = g.board.hexes[hexId];
  const out = new Set<Id>();
  for (const vId of hex?.vertexIds ?? []) {
    const pc = g.board.vertices[vId]?.piece;
    if (pc && pc.owner !== thiefId) out.add(pc.owner);
  }
  return [...out];
}

/**
 * Steals `stealCount` random cards (1 in the base game). Each card is its own seeded draw; with count 1 it is exactly the old single draw.
 * The pool is the victim's resource cards first (in registry order), then held `stealable` wild tokens (fish), so a game with no such token
 * builds the same pool as before and draws the same numbers.
 */
export function stealOne(ctx: Ctx, thiefId: Id, victimId: Id, source: StealSource = stealSourceOf(ctx.g)): void {
  const { g, reg } = ctx;
  const thief = getPlayer(g, thiefId)!;
  const victim = getPlayer(g, victimId)!;
  const count = stealCount(g, reg, thiefId, victimId, source);

  let taken = 0;
  for (let n = 0; n < count; n++) {
    const pool: string[] = [];
    for (const r of reg.resources.keys()) {
      for (let i = 0; i < (victim.resources[r] || 0); i++) pool.push(r);
    }
    for (const wt of defsOf<WildTokenDef>(reg, WILD_TOKENS).values()) {
      if (!wt.stealable) continue;
      for (let i = 0; i < getWildTokens(g, victim.id, wt.id); i++) pool.push(WILD_PREFIX + wt.id);
    }
    if (pool.length === 0) break;
    const stolen = pool[rngInt(g.rng, pool.length)];
    if (stolen.startsWith(WILD_PREFIX)) {
      const tokenId = stolen.slice(WILD_PREFIX.length);
      takeWildToken(g, victim.id, tokenId, 1);
      grantWildToken(ctx, thief.id, tokenId, 1);
      // Not a 'transferred' event: the client has no card art for a token flight yet.
      ctx.emit('wildTokenStolen', { from: victim.id, to: thief.id, tokenId, amount: 1, secret: true });
    } else {
      victim.resources[stolen]--;
      thief.resources[stolen] = (thief.resources[stolen] || 0) + 1;
      ctx.emit('transferred', { from: victim.id, to: thief.id, resource: stolen, amount: 1, kind: 'steal', secret: true });
    }
    taken++;
  }

  if (taken === 0) {
    ctx.log(`${thief.avatar} ${thief.name} robbed ${victim.name}, but they had no cards!`, thief.color);
    return;
  }
  // The log never says which kind of card was taken. With a stealable token in the game every steal reads "card", so a fish does not give itself away.
  const noun = [...defsOf<WildTokenDef>(reg, WILD_TOKENS).values()].some(wt => wt.stealable) ? 'card' : 'resource';
  ctx.log(`${thief.avatar} ${thief.name} stole ${taken} ${noun}${taken === 1 ? '' : 's'} from ${victim.name}`, thief.color);
}
