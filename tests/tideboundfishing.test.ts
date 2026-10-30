import { describe, expect, it } from 'vitest';
import { allPacks } from '../src/packs';
import { stealOne } from '../src/packs/base/robbing';
import { FISH, SPEND_FISH, fishBotGoal } from '../src/packs/tidebound/fishing';
import {
  buildTopology,
  countableCardsForSeven,
  createGame,
  dispatch,
  getWildTokens,
  grantWildToken,
  isWildTokenResource,
  legalActions,
  makeCtx,
  playerView,
  registryFor,
  runBaseSevenDiscard,
  totalCards,
  wildTokensOf
} from '../src/shared';

// T7a: the fish wild token. It lives in `g.ext.core.wildTokens[playerId].fish`, never in a hand or the bank, so it cannot be traded and
// nothing caps it. A held fish counts toward the 7 discard, can be stolen, and is spent as any 1 resource the bank still has.
// Fish is a Tidebound addon: with the DLC (or the addon) off nothing is registered and the spend action does not exist.

const on = { dlc: { tidebound: true } };
const fishOff = { dlc: { tidebound: true }, addons: { 'tidebound.fishing': false } };

function discInits(radius: number): { q: number; r: number; type: string; number: number | null }[] {
  const out: { q: number; r: number; type: string; number: number | null }[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      if (Math.abs(q + r) > radius) continue;
      out.push({ q, r, type: 'wood', number: 6 });
    }
  }
  return out;
}

function makeGame(rules: Record<string, any> = on, seed = 99) {
  const reg = registryFor(allPacks, rules);
  const board = buildTopology(discInits(3), {
    isLand: t => !!reg.tiles.get(t)?.land,
    portBlocked: t => !!reg.tiles.get(t)?.noPort,
    waterEdges: true
  });
  const g = createGame(reg, {
    players: [
      { id: 'a', name: 'Alice' },
      { id: 'b', name: 'Bob' }
    ],
    rules,
    board,
    seed,
    shuffleSeats: false
  });
  g.phase = 'main';
  g.turn = 0;
  return { g, reg, ctx: makeCtx(g, reg) };
}

const player = (g: ReturnType<typeof makeGame>['g'], id: string) => g.players.find(p => p.id === id)!;

describe('registration', () => {
  it('with Tidebound on the fish token and its spend action exist, and the bank has no fish key', () => {
    const { g, reg } = makeGame(on);
    expect(reg.enabled.has('tidebound.fishing')).toBe(true);
    expect(reg.actions.has(SPEND_FISH)).toBe(true);
    expect(isWildTokenResource(reg, FISH)).toBe(true);
    expect('fish' in g.bank).toBe(false);
    expect('fish' in player(g, 'a').resources).toBe(false);
  });

  it('with the DLC off, or only Fishing off, the action does not exist and nothing is stored', () => {
    for (const rules of [{}, { dlc: { tidebound: false } }, fishOff]) {
      const { g, reg } = makeGame(rules);
      expect(reg.enabled.has('tidebound.fishing')).toBe(false);
      expect(reg.actions.has(SPEND_FISH)).toBe(false);
      const res = dispatch(g, reg, { type: SPEND_FISH, playerId: 'a', payload: { resource: 'wood' } });
      expect(res.ok).toBe(false);
      expect(legalActions(g, reg, 'a').some(a => a.type === SPEND_FISH)).toBe(false);
      expect(g.ext.core?.wildTokens).toBeUndefined();
    }
  });
});

describe('spend_fish', () => {
  it('turns one fish into 1 card from the bank', () => {
    const { g, reg, ctx } = makeGame();
    grantWildToken(ctx, 'a', FISH, 2);
    const bankWood = g.bank.wood;
    const res = dispatch(g, reg, { type: SPEND_FISH, playerId: 'a', payload: { resource: 'wood' } });
    expect(res.ok).toBe(true);
    expect(getWildTokens(g, 'a', FISH)).toBe(1);
    expect(player(g, 'a').resources.wood).toBe(1);
    expect(g.bank.wood).toBe(bankWood - 1);
    expect(player(g, 'a').stats.fishSpent).toBe(1);
  });

  it('refuses without a fish, for an unknown or empty resource, and on someone else\'s turn, and keeps the fish when it refuses', () => {
    const { g, reg, ctx } = makeGame();
    expect(dispatch(g, reg, { type: SPEND_FISH, playerId: 'a', payload: { resource: 'wood' } }).ok).toBe(false);

    grantWildToken(ctx, 'a', FISH, 1);
    expect(dispatch(g, reg, { type: SPEND_FISH, playerId: 'a', payload: { resource: 'gold' } }).ok).toBe(false);
    expect(dispatch(g, reg, { type: SPEND_FISH, playerId: 'a', payload: {} }).ok).toBe(false);

    g.bank.ore = 0;
    const empty = dispatch(g, reg, { type: SPEND_FISH, playerId: 'a', payload: { resource: 'ore' } });
    expect(empty.ok).toBe(false);
    expect(empty.error).toContain('out of');
    expect(getWildTokens(g, 'a', FISH)).toBe(1);

    grantWildToken(ctx, 'b', FISH, 1);
    expect(dispatch(g, reg, { type: SPEND_FISH, playerId: 'b', payload: { resource: 'wood' } }).ok).toBe(false);
    expect(getWildTokens(g, 'b', FISH)).toBe(1);
  });

  it('lists one legal spend per resource the bank still has, and none without a fish', () => {
    const { g, reg, ctx } = makeGame();
    expect(legalActions(g, reg, 'a').some(a => a.type === SPEND_FISH)).toBe(false);
    grantWildToken(ctx, 'a', FISH, 1);
    g.bank.ore = 0;
    const spends = legalActions(g, reg, 'a').filter(a => a.type === SPEND_FISH).map(a => a.payload.resource);
    expect(spends.sort()).toEqual(['brick', 'sheep', 'wheat', 'wood']);
  });
});

describe('a 7', () => {
  it('counts a held fish toward the discard limit', () => {
    const { g, reg, ctx } = makeGame();
    const a = player(g, 'a');
    a.resources.wood = 5;
    grantWildToken(ctx, 'a', FISH, 2);
    expect(countableCardsForSeven(g, reg, a)).toBe(7);
    runBaseSevenDiscard(ctx);
    expect(a.pending.discard || 0).toBe(0);

    grantWildToken(ctx, 'a', FISH, 1);
    expect(countableCardsForSeven(g, reg, a)).toBe(8);
    expect(runBaseSevenDiscard(ctx)).toBe(true);
    expect(a.pending.discard).toBe(4);
  });

  it('lets a discard give up fish next to cards, and refuses more fish than held or the wrong total', () => {
    const { g, reg, ctx } = makeGame();
    const a = player(g, 'a');
    a.resources.wood = 3;
    grantWildToken(ctx, 'a', FISH, 1);
    a.pending.discard = 2;
    g.phase = 'discard';
    g.phaseStack = ['main'];

    expect(dispatch(g, reg, { type: 'discard', playerId: 'a', payload: { cards: { wood: 1 }, wild: { fish: 2 } } }).ok).toBe(false);
    expect(dispatch(g, reg, { type: 'discard', playerId: 'a', payload: { cards: { wood: 1 } } }).ok).toBe(false);

    const bankWood = g.bank.wood;
    const res = dispatch(g, reg, { type: 'discard', playerId: 'a', payload: { cards: { wood: 1 }, wild: { fish: 1 } } });
    expect(res.ok).toBe(true);
    expect(a.resources.wood).toBe(2);
    expect(getWildTokens(g, 'a', FISH)).toBe(0);
    // Only the card goes back to the bank; the fish just leaves the hand.
    expect(g.bank.wood).toBe(bankWood + 1);
    expect(g.phase).toBe('main');
  });
});

describe('the robber', () => {
  it('can steal a fish, and the thief ends up holding it', () => {
    const { g, ctx } = makeGame();
    const b = player(g, 'b');
    for (const r of Object.keys(b.resources)) b.resources[r] = 0;
    grantWildToken(ctx, 'b', FISH, 1);
    stealOne(ctx, 'a', 'b');
    expect(getWildTokens(g, 'b', FISH)).toBe(0);
    expect(getWildTokens(g, 'a', FISH)).toBe(1);
  });

  it('with no fish in the game a steal builds the same pool as before (resources only)', () => {
    const { g, ctx } = makeGame({});
    const b = player(g, 'b');
    b.resources.wood = 1;
    stealOne(ctx, 'a', 'b');
    expect(player(g, 'a').resources.wood).toBe(1);
    expect(totalCards(b)).toBe(0);
    expect(wildTokensOf(g, 'a')).toEqual({});
  });
});

describe('views', () => {
  it('hides other players\' fish until the game is over, but shows their hand size with the fish in it', () => {
    const { g, reg, ctx } = makeGame();
    player(g, 'b').resources.wood = 2;
    grantWildToken(ctx, 'b', FISH, 1);

    const seenByA = playerView(g, reg, 'a');
    expect(seenByA.ext.core.wildTokens).toEqual({});
    expect(seenByA.players.find((p: any) => p.id === 'b').resourceCount).toBe(3);

    const seenByB = playerView(g, reg, 'b');
    expect(seenByB.ext.core.wildTokens).toEqual({ b: { fish: 1 } });

    g.phase = 'gameover';
    expect(playerView(g, reg, 'a').ext.core.wildTokens).toEqual({ b: { fish: 1 } });
  });
});

describe('bot goal', () => {
  it('spends a fish only for the one card that finishes a build', () => {
    const { g, reg, ctx } = makeGame();
    const a = player(g, 'a');
    for (const r of Object.keys(a.resources)) a.resources[r] = 0;
    a.resources.sheep = 1;
    a.resources.wheat = 1;
    grantWildToken(ctx, 'a', FISH, 1);
    expect(g.deck.length).toBeGreaterThan(0);

    // Sheep + wheat + 1 ore is a development card: ore finishes it, anything else does not.
    expect(fishBotGoal.actionScore!(ctx, 'a', { type: SPEND_FISH, payload: { resource: 'ore' } })).toBeGreaterThan(0);
    expect(fishBotGoal.actionScore!(ctx, 'a', { type: SPEND_FISH, payload: { resource: 'wood' } })).toBe(0);
    expect(fishBotGoal.actionScore!(ctx, 'a', { type: 'end_turn', payload: {} })).toBe(0);
    expect(reg.enabled.has('tidebound.fishing')).toBe(true);
  });
});
