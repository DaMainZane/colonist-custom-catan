// MODULE: tests for S0.14 Bot goal registry (Service 18) | USED BY: npm test
import { describe, expect, it } from 'vitest';
import {
  BOT_GOALS,
  botGoalActionScore,
  botGoalEdgeDelta,
  botGoalEdgeReach,
  botGoalMainPortUpgrades,
  botGoalPortUpgradeOnSettlement,
  botGoalTechValue,
  botGoalThreatDelta,
  botGoalVertexDelta,
  botGoalWantsKnight,
  createGame,
  createRegistry,
  evaluateBotGoals,
  makeCtx
} from '../src/shared';
import type { BotGoalDef, Pack } from '../src/shared';
import { basePack } from '../src/packs/base';
import { chooseBotAction } from '../src/server/bots/brain';
import { defaultSettings, rulesFromSettings } from '../src/server/runtime';

function makeTestPack(goalDef: BotGoalDef): Pack {
  return {
    id: 'test_goals',
    name: 'Test Goals Pack',
    register(api) {
      api.define(BOT_GOALS, goalDef);
      api.action({
        type: 'custom_ritual',
        validate: () => null,
        legal: () => [{ target: 'altar' }],
        apply: () => {}
      });
    }
  };
}

describe('S0.14 Bot goal registry (Service 18)', () => {
  it('tier gating: main reads generic, secondary reads basic, overload reads advanced', () => {
    const genericDef: BotGoalDef = {
      id: 'gen_goal',
      goalClass: 'generic',
      goals: () => [{ id: 'g_gen', priority: 80, cost: { wood: 1 } }],
      vertexDelta: () => 2,
      edgeDelta: () => 1,
      actionScore: () => 5,
      threatDelta: () => 1
    };
    const basicDef: BotGoalDef = {
      id: 'basic_goal',
      goalClass: 'basic',
      goals: () => [{ id: 'g_basic', priority: 90, cost: { ore: 2 } }],
      vertexDelta: () => 5,
      edgeDelta: () => 3,
      actionScore: () => 10,
      threatDelta: () => 2
    };
    const advDef: BotGoalDef = {
      id: 'adv_goal',
      goalClass: 'advanced',
      goals: () => [{ id: 'g_adv', priority: 105, cost: { wheat: 2 } }],
      vertexDelta: () => 9,
      edgeDelta: () => 7,
      actionScore: () => 20,
      threatDelta: () => 4
    };

    const addonPack: Pack = {
      id: 'tier_pack',
      name: 'Tier Pack',
      register(reg) {
        reg.define(BOT_GOALS, genericDef);
        reg.define(BOT_GOALS, basicDef);
        reg.define(BOT_GOALS, advDef);
      }
    };

    const reg = createRegistry([basePack, addonPack]);
    const rules = rulesFromSettings(defaultSettings());
    const g = createGame(reg, {
      players: [
        { id: 'b1', name: 'Bot1', isBot: true, difficulty: 'Main' },
        { id: 'b2', name: 'Bot2', isBot: true, difficulty: 'Secondary' }
      ],
      rules,
      seed: 101
    });
    const ctx = makeCtx(g, reg);

    // Main sees only generic
    expect(evaluateBotGoals(ctx, 'b1', 'main').map(x => x.id)).toEqual(['g_gen']);
    expect(botGoalVertexDelta(ctx, 'b1', 0, 'main')).toBe(2);
    expect(botGoalEdgeDelta(ctx, 'b1', 0, 'main')).toBe(1);
    expect(botGoalActionScore(ctx, 'b1', { type: 'x', payload: {} }, 'main')).toBe(5);
    expect(botGoalThreatDelta(ctx, 'b1', 'b2', 'main')).toBe(1);

    // Secondary sees generic + basic
    expect(evaluateBotGoals(ctx, 'b1', 'secondary').map(x => x.id)).toEqual(['g_gen', 'g_basic']);
    expect(botGoalVertexDelta(ctx, 'b1', 0, 'secondary')).toBe(7);
    expect(botGoalEdgeDelta(ctx, 'b1', 0, 'secondary')).toBe(4);
    expect(botGoalActionScore(ctx, 'b1', { type: 'x', payload: {} }, 'secondary')).toBe(15);
    expect(botGoalThreatDelta(ctx, 'b1', 'b2', 'secondary')).toBe(3);

    // Overload sees generic + basic + advanced
    expect(evaluateBotGoals(ctx, 'b1', 'overload').map(x => x.id)).toEqual(['g_gen', 'g_basic', 'g_adv']);
    expect(botGoalVertexDelta(ctx, 'b1', 0, 'overload')).toBe(16);
    expect(botGoalEdgeDelta(ctx, 'b1', 0, 'overload')).toBe(11);
    expect(botGoalActionScore(ctx, 'b1', { type: 'x', payload: {} }, 'overload')).toBe(35);
    expect(botGoalThreatDelta(ctx, 'b1', 'b2', 'overload')).toBe(7);
  });

  it('tier-free hooks (techValue, wantsKnight, port upgrade policy, edge reach) read every def, even an advanced one, so Main sees them too', () => {
    const hooksDef: BotGoalDef = {
      id: 'adv_hooks',
      goalClass: 'advanced',
      techValue: (_ctx, _pid, techId) => (techId === 'x.tech' ? 7 : undefined),
      wantsKnight: () => true,
      mainPortUpgrades: true,
      portUpgradeOnSettlement: () => true,
      edgeReach: () => ({ steps: 2, crosses: edgeId => edgeId === 3 })
    };
    const pack: Pack = {
      id: 'hooks_pack',
      name: 'Hooks Pack',
      register(api) {
        api.define(BOT_GOALS, hooksDef);
      }
    };
    const reg = createRegistry([basePack, pack]);
    const g = createGame(reg, {
      players: [
        { id: 'b1', name: 'Bot1', isBot: true, difficulty: 'Main' },
        { id: 'b2', name: 'Bot2', isBot: true, difficulty: 'Main' }
      ],
      rules: rulesFromSettings(defaultSettings()),
      seed: 303
    });
    const ctx = makeCtx(g, reg);
    const info = { tierId: 'main' as const, personality: 'builder' };

    expect(botGoalTechValue(ctx, 'b1', 'x.tech', info)).toBe(7);
    expect(botGoalTechValue(ctx, 'b1', 'other.tech', info)).toBeUndefined();
    expect(botGoalWantsKnight(ctx, 'b1')).toBe(true);
    expect(botGoalMainPortUpgrades(reg)).toBe(true);
    expect(botGoalPortUpgradeOnSettlement(ctx, 'b1')).toBe(true);
    const reach = botGoalEdgeReach(ctx, 'b1');
    expect(reach.steps).toBe(2);
    expect(reach.crosses(3)).toBe(true);
    expect(reach.crosses(4)).toBe(false);

    // A registry with no such hooks answers "nothing".
    const plain = createRegistry([basePack]);
    const plainCtx = makeCtx(createGame(plain, { players: [{ id: 'b1', name: 'Bot1', isBot: true, difficulty: 'Main' }, { id: 'b2', name: 'Bot2', isBot: true, difficulty: 'Main' }], rules: rulesFromSettings(defaultSettings()), seed: 304 }), plain);
    expect(botGoalTechValue(plainCtx, 'b1', 'x.tech', info)).toBeUndefined();
    expect(botGoalWantsKnight(plainCtx, 'b1')).toBe(false);
    expect(botGoalMainPortUpgrades(plain)).toBe(false);
    expect(botGoalPortUpgradeOnSettlement(plainCtx, 'b1')).toBe(false);
    expect(botGoalEdgeReach(plainCtx, 'b1')).toMatchObject({ steps: 0 });
  });

  it('brain integration: missing resources from BOT_GOALS feed gold pick and ready goals execute custom action', () => {
    const pack = makeTestPack({
      id: 'altar_goal',
      goalClass: 'basic',
      goals: () => [
        {
          id: 'build_altar',
          priority: 120,
          cost: { ore: 1 },
          action: { type: 'custom_ritual', payload: { target: 'altar' } },
          needsTags: ['vp']
        }
      ]
    });

    const reg = createRegistry([basePack, pack]);
    reg.phases.get('main')!.actions.push('custom_ritual');
    const rules = rulesFromSettings(defaultSettings());
    const g = createGame(reg, {
      players: [
        { id: 'b1', name: 'Bot1', isBot: true, difficulty: 'Secondary' },
        { id: 'b2', name: 'Bot2', isBot: true, difficulty: 'Secondary' }
      ],
      rules,
      seed: 202
    });

    // 1. In 'pick' phase (gold tile pick), bot lacks 'ore' for its 120-priority goal -> picks 'ore'
    g.phase = 'pick';
    g.turn = 0;
    g.players[0].pending.pick = 1;
    g.players[0].resources = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };

    const pickMove = chooseBotAction(g, reg, 'b1', () => 0.5);
    expect(pickMove).toEqual({ type: 'pick', payload: { resource: 'ore' } });

    // 2. In 'main' phase when 'ore' is now in hand, bot executes the ready goal action 'custom_ritual'
    g.phase = 'main';
    g.players[0].pending.pick = 0;
    g.players[0].resources.ore = 1;

    const mainMove = chooseBotAction(g, reg, 'b1', () => 0.5);
    expect(mainMove).toEqual({ type: 'custom_ritual', payload: { target: 'altar' } });
  });
});
