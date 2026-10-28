// MODULE: unit tests for Stage 1 core systems & proving-ground content (S1.1-S1.5)
import { describe, expect, it } from 'vitest';
import { allPacks } from '../src/packs';
import { mergeSettings } from '../src/server/lobby';
import { defaultSettings, rulesFromSettings } from '../src/server/runtime';
import {
  allTechDefs,
  appendPublicHistory,
  awardHatOfShame,
  BASE_TECH_DEFS,
  buildRoundRecap,
  canViewerPeekHand,
  catchUpDiscardBonus,
  checkSandboxTurnLimitWinner,
  computeVP,
  createGame,
  createRegistry,
  defsOf,
  drawAndApplyRoundEvent,
  effectiveDiscardLimit,
  ensureContractBoard,
  evaluateContracts,
  evaluateHatUnlocks,
  getContractVP,
  getFateTokens,
  getLedgerEntries,
  getLocalNemesis,
  getPlayerTechs,
  getPublicHistory,
  hasTech,
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
  techPanelFor,
  techPrereqs,
  TECH_DEFS
} from '../src/shared';
import type { Pack, PackApi } from '../src/shared';

function makeStage1Game(seed = 777, rules: Record<string, any> = {}, extraRegister?: (api: PackApi) => void) {
  const stage1Pack: Pack = {
    id: 'stage1_test',
    name: 'Stage 1 Test Pack',
    deps: ['base'],
    register(api) {
      registerStage1Definitions(api);
      extraRegister?.(api);
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
    it('has no built-in techs; the base pack registers exactly the 5 roots, in build order', () => {
      const { g, reg } = makeStage1Game(403);
      expect(BASE_TECH_DEFS).toEqual([]);
      expect([...allTechDefs(g, reg).keys()]).toEqual([
        'tidebound.harbor_charters',
        'bulwark.stockpiling',
        'warlords.plunder',
        'wildearth.ground_work',
        'guildhall.road_levy'
      ]);
    });

    it('audits every registered tech: unique ids, prereqs exist, tier 1 to 3, roots have no dlc, every dlc is a known pack', () => {
      const { reg } = makeStage1Game(410);
      const defs = [...defsOf<any>(reg, TECH_DEFS).values()];
      const ids = defs.map(d => d.id);
      const packIds = new Set(allPacks.map(p => p.id));
      expect(new Set(ids).size).toBe(ids.length);
      for (const d of defs) {
        expect([1, 2, 3]).toContain(d.tier);
        for (const pre of techPrereqs(d)) expect(ids).toContain(pre);
        if (d.tier === 1) {
          expect(d.dlc).toBeUndefined();
          expect(techPrereqs(d)).toEqual([]);
        }
        if (d.dlc) expect(packIds.has(d.dlc) || reg.dlcs.has(d.dlc)).toBe(true);
      }
      expect(defs.filter(d => d.tier === 1)).toHaveLength(5);
    });

    it('research_tech: the panel shows each root with this player\'s price, the action spends wheat + ore and records the tech', () => {
      const { g, reg, ctx } = makeStage1Game(411, { techTreeOn: true });
      g.board.vertices[0].piece = { type: 'settlement', owner: 'p1' };
      g.board.vertices[1].piece = { type: 'settlement', owner: 'p1' }; // V = 2
      g.players[0].resources = { wood: 0, brick: 0, sheep: 0, wheat: 2, ore: 1 };
      const action = reg.actions.get('research_tech')!;
      expect(reg.phases.get('main')!.actions).toContain('research_tech');

      const rows = techPanelFor(g, reg, 'p1');
      const byId = (id: string) => rows.find(r => r.id === id)!;
      expect(rows).toHaveLength(5);
      expect(byId('bulwark.stockpiling')).toMatchObject({ cost: 2, payment: { wheat: 1, ore: 1 }, owned: false, canResearch: true, reason: null });
      expect(byId('warlords.plunder')).toMatchObject({ cost: 3, canResearch: true }); // offset +1
      expect(byId('wildearth.ground_work')).toMatchObject({ cost: 4, canResearch: false }); // offset +2, needs 2 ore
      expect(byId('wildearth.ground_work').reason).toMatch(/not enough/i);

      expect(action.validate(ctx, 'p1', { techId: 'bulwark.stockpiling' })).toBeNull();
      expect(action.validate(ctx, 'p1', { techId: 'wildearth.ground_work' })).toMatch(/not enough/i);
      expect(action.validate(ctx, 'p1', { techId: 'nope' })).toMatch(/unknown/i);
      expect(action.validate(ctx, 'p1', {})).toMatch(/unknown/i);

      action.apply(ctx, 'p1', { techId: 'bulwark.stockpiling' });
      expect(getPlayerTechs(g, 'p1')).toEqual(['bulwark.stockpiling']);
      expect(g.players[0].resources.wheat).toBe(1);
      expect(g.players[0].resources.ore).toBe(0);
      expect(techPanelFor(g, reg, 'p1').find(r => r.id === 'bulwark.stockpiling')).toMatchObject({ owned: true, canResearch: false, reason: null });
      expect(action.validate(ctx, 'p1', { techId: 'bulwark.stockpiling' })).toMatch(/already/i);
      expect(getPlayerTechs(g, 'p2')).toEqual([]); // techs are per player
    });

    it('research_tech adds no legal actions and no state when the tree is off', () => {
      const off = makeStage1Game(412);
      const action = off.reg.actions.get('research_tech')!;
      expect(action.legal!(off.ctx, 'p1')).toEqual([]);
      expect(action.validate(off.ctx, 'p1', { techId: 'bulwark.stockpiling' })).toMatch(/tech tree is off/i);
      expect(off.g.ext?.core?.techs).toBeUndefined();

      const on = makeStage1Game(413, { techTreeOn: true });
      expect(on.reg.actions.get('research_tech')!.legal!(on.ctx, 'p1')).toHaveLength(5);
    });

    it('researches a tech: pays the formula cost, stores it, runs onUnlock, and checks single and list prereqs', () => {
      let unlocked = 0;
      const { g, reg, ctx } = makeStage1Game(404, { techTreeOn: true }, api => {
        api.define(TECH_DEFS, {
          id: 'test.a', name: 'Test A', branch: 'test', tier: 1, description: 'root',
          onUnlock() { unlocked++; }
        });
        api.define(TECH_DEFS, { id: 'test.b', name: 'Test B', branch: 'test', tier: 2, prereq: 'test.a', description: 'one prereq' });
        api.define(TECH_DEFS, {
          id: 'test.c', name: 'Test C', branch: 'test', tier: 2, prereq: ['test.a', 'test.b'], costOffset: 1, description: 'list prereq'
        });
      });
      g.board.vertices[0].piece = { type: 'settlement', owner: 'p1' };
      g.board.vertices[1].piece = { type: 'settlement', owner: 'p1' };
      g.players[0].resources = { wood: 10, brick: 10, sheep: 10, wheat: 10, ore: 10 };

      expect(techCostCards(g, reg, 'p1', 1)).toBe(2);
      expect(researchTech(ctx, 'p1', 'test.b').ok).toBe(false); // needs test.a
      expect(researchTech(ctx, 'p1', 'test.c').ok).toBe(false); // needs test.a and test.b

      expect(researchTech(ctx, 'p1', 'test.a')).toEqual({ ok: true, costCards: 2 });
      expect(unlocked).toBe(1);
      expect(hasTech(g, 'p1', 'test.a')).toBe(true);
      expect(g.players[0].resources.wheat + g.players[0].resources.ore).toBe(18);

      expect(researchTech(ctx, 'p1', 'test.c').ok).toBe(false); // still needs test.b
      expect(researchTech(ctx, 'p1', 'test.b').costCards).toBe(3); // tier 2 + ceil(2 / 3)
      const c = researchTech(ctx, 'p1', 'test.c');
      expect(c.ok).toBe(true);
      expect(c.costCards).toBe(4); // tier 2 + offset 1 + ceil(2 / 3)
      expect(getPlayerTechs(g, 'p1')).toEqual(['test.a', 'test.b', 'test.c']);
      expect(researchTech(ctx, 'p1', 'test.a').ok).toBe(false); // already researched
    });

    it('refuses research when rules.techTreeOn is off, and changes nothing', () => {
      const { g, ctx } = makeStage1Game(409, {}, api => {
        api.define(TECH_DEFS, { id: 'test.a', name: 'Test A', branch: 'test', tier: 1, description: 'root' });
      });
      g.board.vertices[0].piece = { type: 'settlement', owner: 'p1' };
      g.players[0].resources = { wood: 10, brick: 10, sheep: 10, wheat: 10, ore: 10 };

      expect(g.rules.techTreeOn).toBeUndefined();
      const res = researchTech(ctx, 'p1', 'test.a');
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/tech tree is off/i);
      expect(g.players[0].resources).toEqual({ wood: 10, brick: 10, sheep: 10, wheat: 10, ore: 10 });
      expect(getPlayerTechs(g, 'p1')).toEqual([]);
    });

    it('prices techs per player by building value: max(floor, tier + offset + ceil(V / 3))', () => {
      const { g, reg } = makeStage1Game(407);
      const setBoard = (settlements: number, cities: number, castles: number) => {
        for (let i = 0; i < 12; i++) delete g.board.vertices[i].piece;
        let slot = 0;
        for (let i = 0; i < settlements; i++) g.board.vertices[slot++].piece = { type: 'settlement', owner: 'p1' };
        for (let i = 0; i < cities; i++) g.board.vertices[slot++].piece = { type: 'city', owner: 'p1' };
        for (let i = 0; i < castles; i++) g.board.vertices[slot++].piece = { type: 'castle', owner: 'p1' };
      };
      const costs = () => [0, 1, 2].map(offset => techCostCards(g, reg, 'p1', 1, offset));

      setBoard(0, 0, 0); // V = 0: ceil(0 / 3) = 0, so offsets 0 and 1 both sit on the floor
      expect(costs()).toEqual([2, 2, 3]);
      setBoard(2, 0, 0); // V = 2
      expect(costs()).toEqual([2, 3, 4]);
      setBoard(3, 1, 0); // V = 5
      expect(costs()).toEqual([3, 4, 5]);
      setBoard(3, 3, 0); // V = 9
      expect(costs()).toEqual([4, 5, 6]);
      setBoard(2, 3, 2); // V = 14
      expect(costs()).toEqual([6, 7, 8]);
    });

    it('keeps the Catch-up discount: 1 less for a player with 0 techs, never below the floor', () => {
      const { g, reg } = makeStage1Game(408, { catchUpMode: 'light' });
      g.board.vertices[0].piece = { type: 'city', owner: 'p1' };
      g.board.vertices[1].piece = { type: 'city', owner: 'p1' };
      g.board.vertices[2].piece = { type: 'settlement', owner: 'p1' };
      g.board.vertices[3].piece = { type: 'settlement', owner: 'p2' };
      g.board.vertices[4].piece = { type: 'settlement', owner: 'p3' };
      g.board.vertices[5].piece = { type: 'settlement', owner: 'p3' };

      expect(isCatchUpEligible(g, reg, 'p2')).toBe(true);
      expect(isCatchUpEligible(g, reg, 'p1')).toBe(false);
      expect(techCostCards(g, reg, 'p2', 1)).toBe(2); // 2 before the discount, already at the floor
      expect(techCostCards(g, reg, 'p2', 2)).toBe(2); // 3 before the discount
      expect(techCostCards(g, reg, 'p2', 3)).toBe(3); // 4 before the discount
      expect(techCostCards(g, reg, 'p1', 2)).toBe(4); // V = 5, no discount
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

  describe('rules.techTreeOn lobby setting', () => {
    it('is off by default, merges from the lobby, and only reaches the rules when on', () => {
      const def = defaultSettings();
      expect(def.techTreeOn).toBe(false);
      expect(rulesFromSettings(def).techTreeOn).toBeUndefined();

      const on = mergeSettings({ techTreeOn: true }, def);
      expect(on.techTreeOn).toBe(true);
      expect(rulesFromSettings(on).techTreeOn).toBe(true);

      expect(mergeSettings({}, on).techTreeOn).toBe(true); // missing keeps the old value
      expect(mergeSettings({ techTreeOn: 'yes' }, on).techTreeOn).toBe(true); // not a boolean: ignored
      expect(mergeSettings({ techTreeOn: false }, on).techTreeOn).toBe(false);
    });
  });
});
