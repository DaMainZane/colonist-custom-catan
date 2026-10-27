// MODULE: unit tests for Stage 1 core systems & proving-ground content (S1.1-S1.5)
import { describe, expect, it } from 'vitest';
import { allPacks } from '../src/packs';
import { pieceCost } from '../src/packs/base/building';
import {
  appendPublicHistory,
  awardHatOfShame,
  buildRoundRecap,
  canViewerPeekHand,
  catchUpDiscardBonus,
  checkSandboxTurnLimitWinner,
  computeVP,
  createGame,
  createRegistry,
  drawAndApplyRoundEvent,
  effectiveDiscardLimit,
  ensureContractBoard,
  evaluateContracts,
  evaluateHatUnlocks,
  getContractVP,
  getFateTokens,
  getLedgerEntries,
  getLocalNemesis,
  getPublicHistory,
  isCatchUpEligible,
  makeCtx,
  playSpyAction,
  recordLocalNemesisHit,
  registerStage1Definitions,
  researchTech,
  resolveSeven,
  runBotDrinkingGameCheck,
  runRoundStartTaxesAndCatchUp,
  techCostCards,
  tradeRatiosFor,
  vertexDefense
} from '../src/shared';
import type { Pack } from '../src/shared';

function makeStage1Game(seed = 777, rules: Record<string, any> = {}) {
  const stage1Pack: Pack = {
    id: 'stage1_test',
    name: 'Stage 1 Test Pack',
    deps: ['base'],
    register(api) {
      registerStage1Definitions(api);
    }
  };
  const reg = createRegistry([...allPacks, stage1Pack], rules, 'all');
  const g = createGame(reg, {
    players: [
      { id: 'p1', name: 'Alice', avatar: '1', color: '#e74c3c', isBot: false },
      { id: 'p2', name: 'Bob', avatar: '2', color: '#3498db', isBot: false },
      { id: 'p3', name: 'Bot1', avatar: '3', color: '#2ecc71', isBot: true }
    ],
    seed,
    shuffleSeats: false,
    rules
  });
  g.phase = 'main';
  g.round = 4;
  const ctx = makeCtx(g, reg);
  return { g, reg, ctx };
}

describe('Stage 1 — Core Addon Systems & Proving-Ground Content', () => {
  describe('S1.1 Taxes & Catch-Up Lever Menu', () => {
    it('collects Leader Tax using publicVP only and grants Catch-Up discard bonus & Fate token replenishment', () => {
      const { g, reg, ctx } = makeStage1Game(101, {
        taxesOn: true,
        catchUpMode: 'light',
        fateTokens: 3
      });

      g.board.vertices[0].piece = { type: 'city', owner: 'p1' };
      g.board.vertices[1].piece = { type: 'city', owner: 'p1' };
      g.board.vertices[2].piece = { type: 'settlement', owner: 'p1' };
      g.players[0].resources.wood = 5;

      g.board.vertices[3].piece = { type: 'settlement', owner: 'p2' };
      g.players[1].devCards = ['vp', 'vp'];

      g.board.vertices[4].piece = { type: 'settlement', owner: 'p3' };
      g.board.vertices[5].piece = { type: 'settlement', owner: 'p3' };

      expect(isCatchUpEligible(g, reg, 'p2')).toBe(true);
      expect(isCatchUpEligible(g, reg, 'p1')).toBe(false);
      expect(catchUpDiscardBonus(g, reg, g.players[1])).toBe(2);
      expect(effectiveDiscardLimit(g, reg, g.players[1])).toBe(9);

      getFateTokens(g, reg, 'p2');
      g.ext.core.eventDeck.fateTokens.p2 = 1;

      runRoundStartTaxesAndCatchUp(ctx);
      expect(g.players[0].resources.wood).toBe(4);
      expect(g.players[0].stats.taxesPaid).toBe(1);
      expect(getLedgerEntries(g, { kind: 'tax' })).toHaveLength(1);
      expect(getFateTokens(g, reg, 'p2')).toBe(2);
    });
  });

  describe('S1.2 Public Contract Board & Rarity Tiers', () => {
    it('draws deterministic public contracts and awards VP in instant, cycle, and sandbox modes', () => {
      const { g, reg, ctx } = makeStage1Game(202, { contractMode: 'instant' });

      const board = ensureContractBoard(g, reg);
      expect(board.open.length).toBe(4);

      board.pool = [];
      board.open = [{

        id: 'base.cities_2',
        conditionId: 'base.cities_2',
        name: 'Twin Cities',
        description: 'Have at least 2 cities on the board.',
        tier: 2,
        vp: 2,
        unlocksMonument: false
      }];

      g.board.vertices[0].piece = { type: 'city', owner: 'p1' };
      g.board.vertices[1].piece = { type: 'city', owner: 'p1' };

      const claimed = evaluateContracts(ctx, 'instant');
      expect(claimed).toContain('base.cities_2');
      expect(getContractVP(g, 'p1')).toBe(2);
      expect(computeVP(g, reg, g.players[0], false)).toBe(4 + 2);

      board.open = [{
        id: 'base.settlements_3',
        conditionId: 'base.settlements_3',
        name: 'Homesteader',
        description: 'Have at least 3 settlements or cities on the board.',
        tier: 3,
        vp: 3,
        unlocksMonument: true
      }];
      g.board.vertices[2].piece = { type: 'settlement', owner: 'p1' };
      g.board.vertices[3].piece = { type: 'settlement', owner: 'p2' };
      g.board.vertices[4].piece = { type: 'settlement', owner: 'p2' };
      g.board.vertices[5].piece = { type: 'settlement', owner: 'p2' };

      evaluateContracts(ctx, 'cycle');
      expect(getContractVP(g, 'p1')).toBe(4);
      expect(getContractVP(g, 'p2')).toBe(1);
    });
  });

  describe('S1.3 Spies & Intel Ladder', () => {
    it('allows hand peek for 1 round and nullifies 1 held Knight dev card', () => {
      const { g, ctx } = makeStage1Game(303);
      g.players[1].devCards = ['knight'];

      const res = playSpyAction(ctx, 'p1', 'p2');
      expect(res.ok).toBe(true);
      expect(res.nullifiedKnight).toBe(true);
      expect(canViewerPeekHand(g, 'p1', 'p2')).toBe(true);
      expect(canViewerPeekHand(g, 'p3', 'p2')).toBe(false);
      expect(g.players[1].pending.nullifiedKnights).toBe(1);
    });
  });

  describe('S1.4 Tech Tree with Empire-Size Pricing, Local Nemesis & Round Recap', () => {
    it('scales tech cost by empire size, applies Road Engineering, Harbor Charters, Literacy discount, and Fortified Towns', () => {
      const { g, reg, ctx } = makeStage1Game(404);
      g.board.vertices[0].piece = { type: 'settlement', owner: 'p1' };
      g.board.vertices[0].port = '3:1';
      g.board.vertices[1].piece = { type: 'settlement', owner: 'p1' };

      expect(techCostCards(g, reg, 'p1', 1)).toBe(2);
      g.players[0].resources = { wood: 10, brick: 10, sheep: 10, wheat: 10, ore: 10 };

      const r1 = researchTech(ctx, 'p1', 'base.road_engineering');
      expect(r1.ok).toBe(true);

      for (let i = 0; i < 15; i++) {
        g.board.edges[i].piece = { type: 'road', owner: 'p1' };
      }
      const roadDef = reg.pieces.get('road')!;
      const overLimitRoadCost = pieceCost(g, g.players[0], roadDef, reg);
      expect(overLimitRoadCost).toEqual({ wood: 1, brick: 2 });

      expect(techCostCards(g, reg, 'p1', 2)).toBe(3);
      const r2 = researchTech(ctx, 'p1', 'base.literacy');
      expect(r2.ok).toBe(true);

      expect(techCostCards(g, reg, 'p1', 2)).toBe(2);
      const r3 = researchTech(ctx, 'p1', 'base.harbor_charters');
      expect(r3.ok).toBe(true);

      const ratios = tradeRatiosFor(g, reg, 'p1');
      expect(ratios.brick).toBe(2);

      const r4 = researchTech(ctx, 'p1', 'base.fortified_towns');
      expect(r4.ok).toBe(true);
      expect(vertexDefense(g, reg, 0).garrison).toBe(1);
    });

    it('tracks Local Nemesis hits and builds a Round-End Recap', () => {
      const { g } = makeStage1Game(405);
      recordLocalNemesisHit(g, 'p1', 'p2', 'robbed');
      const rec = recordLocalNemesisHit(g, 'p1', 'p2', 'robbed');
      expect(rec.robbedMe).toBe(2);
      expect(rec.grudgeScore).toBe(30);
      expect(rec.isNemesis).toBe(true);
      expect(getLocalNemesis(g, 'p1', 'p2').isNemesis).toBe(true);

      appendPublicHistory(g, {
        type: 'eventDrawn',
        actorId: null,
        targetId: null,
        summary: 'Event: Harvest Festival',
        data: {}
      });
      const recap = buildRoundRecap(g, g.round);
      expect(recap.round).toBe(g.round);
      expect(recap.events).toContain('Event: Harvest Festival');
    });
  });

  describe('S1.5 Proving-Ground Content & Sandbox Economy', () => {
    it('triggers Karaoke 7 on a 7 roll, runs Bot Drinking Game with pity card, and unlocks Hats & Hat of Shame', () => {
      const { g, ctx } = makeStage1Game(505, {
        botChat: 'normal',
        pityCardOn: true
      });
      g.players[0].resources.wood = 2;

      const steps = resolveSeven(ctx);
      expect(steps).toContain('rowdy.karaoke7');
      expect(getPublicHistory(g, { type: 'karaokeLost' })).toHaveLength(1);

      for (let i = 0; i < 3; i++) {
        appendPublicHistory(g, {
          type: 'steal',
          actorId: 'p1',
          targetId: 'p2',
          summary: 'Stole 1 card',
          data: {}
        });
      }
      const drinkRes = runBotDrinkingGameCheck(ctx);
      expect(drinkRes.sipsTriggered).toBe(true);
      expect(drinkRes.pityRecipientId).toBe('p2');

      g.awards.longestRoad = 'p1';
      g.awards.largestArmy = 'p1';
      g.players[0].stats.trades = 5;
      g.players[1].stats.resRobbed = 6;
      const unlocked = evaluateHatUnlocks(g, 'p1');
      expect(unlocked).toContain('captain');
      expect(unlocked).toContain('conqueror');
      expect(unlocked).toContain('top_hat');
      expect(awardHatOfShame(g)).toBe('p2');

      g.board.vertices[0].piece = { type: 'settlement', owner: 'p1' };
      g.ext.core.eventDeck = {
        rng: { s: 123 },
        deck: ['rowdy.hat_day'],
        discard: [],
        activeEventId: null,
        fateTokens: { p1: 2, p2: 2, p3: 2 },
        pendingVeto: null
      };
      drawAndApplyRoundEvent(ctx);
      expect(g.ext.core.activeHats[0]).toBeDefined();
    });

    it('resolves Sandbox Economy winner by highest total resources produced at round limit', () => {
      const { g, reg } = makeStage1Game(606, {
        scoreMode: 'produced',
        maxRounds: 5
      });
      g.players[1].stats.resProduced = 24;
      g.players[0].stats.resProduced = 12;

      g.round = 4;
      expect(checkSandboxTurnLimitWinner(g, reg)).toBeNull();

      g.round = 5;
      const win = checkSandboxTurnLimitWinner(g, reg);
      expect(win?.id).toBe('p2');
      expect(win?.vp).toBe(24);
      expect(g.phase).toBe('gameover');
    });
  });
});
