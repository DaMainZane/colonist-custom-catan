// MODULE: tests for Clankerton's Stage 0 services (S0.5 trade-ratio, S0.6 production, S0.7 tile-state/durability/wild-token, S0.8 seven-resolver, S0.9 marker/ledger/strength/relations, S0.10 history/stats, S0.11 event-deck)
import { describe, expect, it } from 'vitest';
import { allPacks } from '../src/packs';
import { proposeTradeAction } from '../src/packs/base/actions/tradeOffers';
import {
  addGarrison,
  addLedgerEntry,
  addMarker,
  addOpinion,
  appendPublicHistory,
  breakTreaty,
  clearExpiredMercenaries,
  compareStrength,
  createGame,
  createRegistry,
  damagePiece,
  detectStreaks,
  DISCARD_LIMIT_MODS,
  drawAndApplyRoundEvent,
  dueLedgerEntries,
  DURABILITY_DEFS,
  effectiveDiscardLimit,
  ensureEventDeck,
  EVENT_CARDS,
  explainInvalidBankRatio,
  getFateTokens,
  getLedgerEntries,
  getMarkers,
  getOpinionScore,
  getPieceDurability,
  getPublicHistory,
  getRelation,
  getTileState,
  getWildTokens,
  grantWildPick,
  grantWildToken,
  hireMercenary,
  isHexRobberBlocked,
  isWildTokenResource,
  makeCtx,
  matchingHexesForRoll,
  MAX_PUBLIC_HISTORY,
  peekNextEvent,
  PRODUCTION_STAGE_ORDER,
  ratioFor,
  RATIO_MOD_ORDER,
  RATIO_MODS,
  repairPiece,
  resolveSeven,
  runProductionPipeline,
  runStatHandlers,
  setPhase,
  setRelation,
  setTileState,
  settleLedgerEntry,
  setWallTier,
  SEVEN_STEP_ORDER,
  SEVEN_STEPS,
  spendWildToken,
  STAT_HANDLERS,
  tickMarkers,
  tickTileStates,
  tradeRatiosFor,
  upholdPreviewEvent,
  vertexDefense,
  vetoPreviewEvent,
  WILD_TOKENS
} from '../src/shared';
import type { Pack } from '../src/shared';

function setupTestGame(extraPacks: Pack[] = [], ruleOverrides: Record<string, any> = {}) {
  const reg = createRegistry([...allPacks, ...extraPacks], ruleOverrides, 'all');
  const g = createGame(reg, {
    players: [
      { id: 'p1', name: 'Alice', avatar: '1', color: '#e03131', isBot: false },
      { id: 'p2', name: 'Bob', avatar: '2', color: '#1971c2', isBot: false },
      { id: 'p3', name: 'Cara', avatar: '3', color: '#2f9e44', isBot: false }
    ],
    seed: 101,
    shuffleSeats: false,
    rules: ruleOverrides
  });
  g.phase = 'main';
  g.round = 1;
  const ctx = makeCtx(g, reg);
  return { reg, g, ctx };
}

describe('S0.5 Trade ratio function (service 5: trade-ratio)', () => {
  it('computes 4:1 base, 3:1 generic port, 2:1 specialized port, ordered modifiers, 2:1 floor, and gem port floor exemption', () => {
    const testPack: Pack = {
      id: 'ratio_test',
      name: 'Ratio Test',
      deps: ['base'],
      register(api) {
        api.port({ id: 'emerald_port', name: 'Emerald 1:1', ratio: 1, resource: 'ore', exemptFloor: true });
        api.define(RATIO_MODS, {
          id: 'ratio_test.harbor',
          order: RATIO_MOD_ORDER.harbor,
          apply(_g, _reg, pid, res, cur) {
            return pid === 'p1' && res === 'wood' ? cur - 2 : cur;
          }
        });
        api.define(RATIO_MODS, {
          id: 'ratio_test.weariness',
          order: RATIO_MOD_ORDER.warWeariness,
          apply(_g, _reg, pid, res, cur) {
            return pid === 'p2' && res === 'brick' ? cur + 1 : cur;
          }
        });
      }
    };

    const { reg, g } = setupTestGame([testPack]);

    // p1 gets a settlement on a wood vertex; modifier tries to drop 4 -> 2 (and even if port is 2:1, floor is 2:1)
    g.board.vertices[0].piece = { type: 'settlement', owner: 'p1' };
    g.board.vertices[0].port = 'wood';
    expect(ratioFor(g, reg, 'p1', 'wood')).toBe(2); // clamped to 2:1 floor

    // Gem port with exemptFloor: true allows 1:1
    g.board.vertices[1].piece = { type: 'city', owner: 'p1' };
    g.board.vertices[1].port = 'emerald_port';
    expect(ratioFor(g, reg, 'p1', 'ore')).toBe(1);

    // p2 has a 3:1 port but war weariness (+1) worsens brick back to 4:1
    g.board.vertices[2].piece = { type: 'settlement', owner: 'p2' };
    g.board.vertices[2].port = '3:1';
    expect(ratioFor(g, reg, 'p2', 'sheep')).toBe(3);
    expect(ratioFor(g, reg, 'p2', 'brick')).toBe(4);

    const allP1 = tradeRatiosFor(g, reg, 'p1');
    expect(allP1.wood).toBe(2);
    expect(allP1.ore).toBe(1);

    const invalid = explainInvalidBankRatio(g, reg, 'p2', { sheep: 2 }, { wheat: 1 });
    expect(invalid.ok).toBe(false);
    expect(invalid.reason).toContain('3:1 for SHEEP');
  });
});

describe('S0.6 Production pipeline & S0.7 Tile state, durability, wild token', () => {
  it('runs ordered production stages: number shift, tile state (flooded, fertile, plagued, oasis), piece multiplier, and zone tax', () => {
    const prodPack: Pack = {
      id: 'prod_test',
      name: 'Prod Test',
      deps: ['base'],
      register(api) {
        // Stage 40: piece multiplier (+1 on castles/cities for p1)
        api.productionStep(PRODUCTION_STAGE_ORDER.pieceMultiplier, (_ctx, item) => {
          if (item.pieceType === 'city' && item.ownerId === 'p1') {
            item.amount += 1;
          }
        });
        // Stage 60: tax 1 card to p2 when hex 0 produces for p1
        api.productionStep(PRODUCTION_STAGE_ORDER.tax, (_ctx, item) => {
          if (item.hex.id === 0 && item.ownerId === 'p1' && item.amount >= 2) {
            item.taxRecipientId = 'p2';
            item.taxAmount = 1;
          }
        });
      }
    };

    const { g, ctx } = setupTestGame([prodPack]);
    const hex0 = g.board.hexes[0];
    hex0.type = 'wheat';
    hex0.number = 6;
    g.board.robberHexId = 1;
    const v0 = hex0.vertexIds[0];
    g.board.vertices[v0].piece = { type: 'city', owner: 'p1' };

    // 1. Fertile tile state adds +1 yield: base city (2) + fertile (+1) + multiplier (+1) = 4, taxed 1 to p2 -> p1 gets 3, p2 gets 1
    setTileState(g, hex0.id, { id: 'fertile', until: 2 });
    const startP1Wheat = g.players[0].resources.wheat || 0;
    const startP2Wheat = g.players[1].resources.wheat || 0;
    runProductionPipeline(ctx, [hex0], 6);
    expect(g.players[0].resources.wheat).toBe(startP1Wheat + 3);
    expect(g.players[1].resources.wheat).toBe(startP2Wheat + 1);

    // 2. Flooded tile state halves base yield rounded up (city 2 -> 1, plus stage 40 +1 = 2, taxed 1 to p2 -> p1 gets +1, p2 gets +1) and blocks robber placement
    setTileState(g, hex0.id, { id: 'flooded', until: 1 });
    expect(isHexRobberBlocked(g, ctx.reg, hex0.id)).toBe(true);
    runProductionPipeline(ctx, [hex0], 6);
    expect(g.players[0].resources.wheat).toBe(startP1Wheat + 4);
    expect(g.players[1].resources.wheat).toBe(startP2Wheat + 2);

    // 3. tickTileStates transitions `flooded` (until: 1) -> `silt` (+1 yield) at round 1
    g.round = 1;
    tickTileStates(ctx);
    expect(getTileState(hex0)?.id).toBe('silt');

    // 4. Number shift (`hex.ext.numberShift`) shifts matching roll number
    hex0.ext.numberShift = 2; // 6 + 2 = 8
    expect(matchingHexesForRoll(ctx, 8).map(h => h.id)).toContain(hex0.id);
  });

  it('manages piece durability, breaking at 0, repair action, and wild tokens excluded from trade checks', () => {
    const durPack: Pack = {
      id: 'dur_test',
      name: 'Durability & Wild Test',
      deps: ['base'],
      register(api) {
        api.define(DURABILITY_DEFS, {
          id: 'road_dur',
          pieceId: 'road',
          maxDurability: 2,
          repairCost: { wood: 1 }
        });
        api.define(WILD_TOKENS, {
          id: 'test_fish',
          name: 'Test Fish',
          countInDiscard: true,
          stealable: true
        });
      }
    };

    const { reg, g, ctx } = setupTestGame([durPack]);
    g.board.edges[0].piece = { type: 'road', owner: 'p1' };
    g.players[0].pieces.road = 14;
    expect(getPieceDurability(g, reg, 'edge', 0)).toBe(2);

    // Damage by 1 -> durability 1
    const dmg1 = damagePiece(ctx, 'edge', 0, 1);
    expect(dmg1).toEqual({ broken: false, remaining: 1 });
    expect(getPieceDurability(g, reg, 'edge', 0)).toBe(1);

    // Repair costs 1 wood and restores durability to 2
    g.players[0].resources.wood = 2;
    expect(repairPiece(ctx, 'p1', 'edge', 0)).toBeNull();
    expect(getPieceDurability(g, reg, 'edge', 0)).toBe(2);
    expect(g.players[0].resources.wood).toBe(1);

    // Damage by 2 -> breaks piece and returns road to supply
    const dmg2 = damagePiece(ctx, 'edge', 0, 2);
    expect(dmg2).toEqual({ broken: true, remaining: 0 });
    expect(g.board.edges[0].piece).toBeNull();
    expect(g.players[0].pieces.road).toBe(15);

    // Wild tokens: grant, spend, and verify isWildTokenResource
    expect(isWildTokenResource(reg, 'test_fish')).toBe(true);
    grantWildToken(ctx, 'p1', 'test_fish', 2);
    expect(getWildTokens(g, 'p1', 'test_fish')).toBe(2);
    spendWildToken(ctx, 'p1', 'test_fish', 'ore', 1);
    expect(getWildTokens(g, 'p1', 'test_fish')).toBe(1);
    expect(g.players[0].resources.ore).toBe(1);

    grantWildPick(ctx, 'p2', 1, 'oasis', 0);
    expect(g.players[1].pending.pick).toBe(1);

    // Proposing a player trade when nobody has wheat fails, but wild token resources are ignored
    g.players[0].resources.wood = 1;
    g.players[1].resources.wheat = 0;
    g.players[2].resources.wheat = 0;
    expect(proposeTradeAction.validate(ctx, 'p1', { offer: { wood: 1 }, request: { wheat: 1 } })).toContain('No one has any');
  });
});

describe('S0.8 Seven Resolver (service 17: seven-resolver)', () => {
  it('caps DLC side effects per 7 by priority (default 2) and runs selected steps in pipeline order', () => {
    const orderLog: string[] = [];
    const sevenPack: Pack = {
      id: 'seven_test',
      name: 'Seven Test',
      deps: ['base'],
      register(api) {
        api.define(DISCARD_LIMIT_MODS, {
          id: 'seven_test.storehouse',
          apply(_g, _reg, p, limit) {
            return p.id === 'p1' ? limit + 3 : limit;
          }
        });
        api.define(SEVEN_STEPS, {
          id: 'dlc.karaoke',
          order: SEVEN_STEP_ORDER.karaoke,
          isDlcSideEffect: true,
          priority: 50,
          run() { orderLog.push('karaoke'); }
        });
        api.define(SEVEN_STEPS, {
          id: 'dlc.volcano',
          order: SEVEN_STEP_ORDER.volcano,
          isDlcSideEffect: true,
          priority: 90,
          run() { orderLog.push('volcano'); }
        });
        api.define(SEVEN_STEPS, {
          id: 'dlc.decay',
          order: SEVEN_STEP_ORDER.decay,
          isDlcSideEffect: true,
          priority: 80,
          run() { orderLog.push('decay'); }
        });
      }
    };

    const { reg, g, ctx } = setupTestGame([sevenPack], { maxSevenSideEffects: 2 });
    // p1 has 9 cards, but storehouse raises p1's limit from 7 to 10 -> no discard!
    g.players[0].resources = { wood: 5, brick: 4, sheep: 0, wheat: 0, ore: 0 };
    // p2 has 8 cards (limit 7) -> must discard 4!
    g.players[1].resources = { wood: 4, brick: 4, sheep: 0, wheat: 0, ore: 0 };

    expect(effectiveDiscardLimit(g, reg, g.players[0])).toBe(10);
    expect(effectiveDiscardLimit(g, reg, g.players[1])).toBe(7);

    const executed = resolveSeven(ctx);
    // Only top 2 priority DLC side effects (volcano=90, decay=80) fire; karaoke(50) is capped out!
    expect(orderLog).toEqual(['volcano', 'decay']);
    expect(executed).toContain('dlc.volcano');
    expect(executed).toContain('dlc.decay');
    expect(executed).not.toContain('dlc.karaoke');
    expect(g.players[0].pending.discard || 0).toBe(0);
    expect(g.players[1].pending.discard).toBe(4);
    expect(g.phase).toBe('discard');
  });
});

describe('S0.9 Markers, ledger, strength, and relations (services 9, 10, 13, 14)', () => {
  it('tracks timed world markers, ledger debts/permits, vertex defense & mercenaries, and relations/treaty breaks', () => {
    const { reg, g, ctx } = setupTestGame();

    // 1. Markers
    addMarker(g, { id: 'wreck_1', kind: 'wreck', target: 'hex', loc: 3, ownerId: null, countdown: 2, payload: { cards: 4 } });
    addMarker(g, { id: 'spy_1', kind: 'spy', target: 'vertex', loc: 1, ownerId: 'p1', countdown: 1, public: false });
    expect(getMarkers(g, { viewerId: 'p2' }).map(m => m.id)).toEqual(['wreck_1']);
    expect(getMarkers(g, { viewerId: 'p1' }).map(m => m.id)).toEqual(['wreck_1', 'spy_1']);
    const exp1 = tickMarkers(ctx);
    expect(exp1.map(m => m.id)).toEqual(['spy_1']);
    expect(getMarkers(g)).toHaveLength(1);

    // 2. Ledger
    const debt = addLedgerEntry(g, { kind: 'debt', fromId: 'p1', toId: 'bank', amount: 3, interest: 1, dueRound: 2 });
    expect(dueLedgerEntries(g, 1)).toHaveLength(0);
    expect(dueLedgerEntries(g, 2).map(e => e.id)).toEqual([debt.id]);
    settleLedgerEntry(g, debt.id);
    expect(dueLedgerEntries(g, 2)).toHaveLength(0);
    expect(getLedgerEntries(g, { settled: true })).toHaveLength(1);

    // 3. Strength & Defense
    g.board.vertices[5].piece = { type: 'city', owner: 'p1' }; // base 2
    const edgeId = g.board.vertices[5].edgeIds[0];
    g.board.edges[edgeId].piece = { type: 'wall', owner: 'p1' };
    setWallTier(g, edgeId, 'stone'); // +2 wall bonus
    addGarrison(g, 'p1', 'vertex', 5, 2); // +2 garrison
    hireMercenary(g, 'p1', 1, 1); // +1 merc for round 1
    g.awards.largestArmy = 'p1'; // +1 army bonus
    const def = vertexDefense(g, reg, 5);
    expect(def).toEqual({
      ownerId: 'p1',
      base: 2,
      garrison: 2,
      mercenaries: 1,
      wallBonus: 2,
      armyBonus: 1,
      total: 8
    });
    expect(compareStrength(8, 8, true, false)).toBe('attacker');
    expect(compareStrength(8, 8, false, false)).toBe('defender');
    clearExpiredMercenaries(g);
    expect(vertexDefense(g, reg, 5).mercenaries).toBe(0);

    // 4. Relations & Treaty Break
    expect(getRelation(g, 'p1', 'p2')).toBe('neutral');
    setRelation(g, 'p1', 'p2', 'alliance', 1);
    expect(getRelation(g, 'p2', 'p1')).toBe('alliance');
    addOpinion(g, 'p2', 'p1', 'diplomatic');
    expect(getOpinionScore(g, 'p2', 'p1').tier).toBe('decent');
    breakTreaty(ctx, 'p1', 'p2');
    expect(getRelation(g, 'p1', 'p2')).toBe('war');
    expect(g.players[0].flags.treatyBroken).toBe(true);
    expect(getOpinionScore(g, 'p2', 'p1').tags).toContain('oathbreaker');
    expect(getOpinionScore(g, 'p2', 'p1').tier).toBe('horrible');
  });
});

describe('S0.10 History ring buffer & stats registry + S0.11 Seeded event deck', () => {
  it('sanitizes secret events, caps ring buffer at MAX_PUBLIC_HISTORY, detects streaks, and runs custom STAT_HANDLERS', () => {
    let customStatCount = 0;
    const histPack: Pack = {
      id: 'hist_test',
      name: 'Hist Test',
      deps: ['base'],
      register(api) {
        api.define(STAT_HANDLERS, {
          id: 'hist_test.counter',
          handle(ctx) {
            if (ctx.events.some(e => e.type === 'rolled')) customStatCount++;
          }
        });
      }
    };

    const { g, ctx } = setupTestGame([histPack]);

    // Emit 3 sixes in a row and 2 secret steals against p2
    for (let i = 0; i < 3; i++) {
      ctx.events.length = 0;
      ctx.emit('rolled', { playerId: 'p1', dice: [3, 3], sum: 6, hexIds: [] });
      runStatHandlers(ctx, 'roll');
    }
    expect(customStatCount).toBe(3);

    for (let i = 0; i < 2; i++) {
      ctx.events.length = 0;
      ctx.emit('transferred', { from: 'p2', to: 'p1', resource: 'ore', amount: 1, kind: 'steal', secret: true });
      runStatHandlers(ctx, 'steal');
    }

    const steals = getPublicHistory(g, { type: 'steal' });
    expect(steals).toHaveLength(2);
    // Secret steal never leaks the stolen resource name in public history!
    expect(steals[0].data).not.toHaveProperty('resource');
    expect(steals[0].data).not.toHaveProperty('secret');

    const streaks = detectStreaks(g, 4);
    expect(streaks.rollStreak).toEqual({ sum: 6, count: 3 });
    expect(streaks.hammeredVictim).toEqual({ victimId: 'p2', hits: 2, windowTurns: 4 });

    // Cap enforcement
    for (let i = 0; i < MAX_PUBLIC_HISTORY + 15; i++) {
      appendPublicHistory(g, { type: 'rolled', actorId: 'p1', targetId: null, summary: 'Roll', data: { sum: 8 } });
    }
    expect(getPublicHistory(g)).toHaveLength(MAX_PUBLIC_HISTORY);
  });

  it('maintains a deterministic seeded event deck with 1-round preview, fate token veto/uphold, and zero g.rng drift', () => {
    const evPack: Pack = {
      id: 'ev_test',
      name: 'Event Test',
      deps: ['base'],
      register(api) {
        api.define(EVENT_CARDS, {
          id: 'ev_test.custom',
          title: 'Custom Boon',
          description: 'Gives p1 1 wheat.',
          apply(ctx) {
            ctx.g.players[0].resources.wheat = (ctx.g.players[0].resources.wheat || 0) + 1;
          }
        });
      }
    };

    const { reg, g, ctx } = setupTestGame([evPack], { eventsOn: true, fateTokens: 2 });
    const rngBefore = JSON.stringify(g.rng);

    ensureEventDeck(g, reg);
    const firstPreview = peekNextEvent(g, reg);
    expect(firstPreview).not.toBeNull();
    expect(getFateTokens(g, reg, 'p1')).toBe(2);

    // Veto by p1 pushes the top card to the bottom and changes the preview
    const vetoRes = vetoPreviewEvent(ctx, 'p1');
    expect(vetoRes.ok).toBe(true);
    expect(getFateTokens(g, reg, 'p1')).toBe(1);
    const secondPreview = peekNextEvent(g, reg);
    expect(secondPreview?.id).toBe(vetoRes.nextPreviewId);

    // Uphold by p2 restores the vetoed card back to the top of the deck!
    const upholdRes = upholdPreviewEvent(ctx, 'p2');
    expect(upholdRes.ok).toBe(true);
    expect(getFateTokens(g, reg, 'p2')).toBe(1);
    expect(peekNextEvent(g, reg)?.id).toBe(firstPreview?.id);

    // Drawing the round event applies it and records it in public history without touching g.rng
    const drawn = drawAndApplyRoundEvent(ctx);
    expect(drawn?.id).toBe(firstPreview?.id);
    expect(JSON.stringify(g.rng)).toBe(rngBefore);
    expect(getPublicHistory(g, { type: 'eventDrawn' })).toHaveLength(1);
  });
});
