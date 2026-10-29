// MODULE: unit tests for the effects of the 5 root techs (Stockpiling, Road levy, Harbor charters = raise a whole port to 2:1, Plunder, Ground work) and the harbor-only 1:1 floor in the trade ratio service
import { describe, expect, it } from 'vitest';
import { allPacks } from '../src/packs';
import { moveRobberAction } from '../src/packs/base/actions/robber';
import { portLevel, techActionsFor } from '../src/packs/base/techEffects';
import {
  createGame,
  createRegistry,
  dispatch,
  effectiveDiscardLimit,
  COST_MODS,
  explainInvalidBankRatio,
  getPlayerTechs,
  HARBOR_RATIO_MODS,
  isCatchUpEligible,
  legalActions,
  makeCtx,
  priceOf,
  RATIO_MOD_ORDER,
  RATIO_MODS,
  ratioFor,
  registerStage1Definitions
} from '../src/shared';
import type { GameState, Pack } from '../src/shared';
import { chooseBotAction } from '../src/server/bots/brain';

function makeGame(seed = 900, rules: Record<string, any> = { techTreeOn: true }) {
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
      { id: 'p3', name: 'Cara', avatar: '3', color: '#2ecc71', isBot: false }
    ],
    seed,
    shuffleSeats: false,
    rules
  });
  g.phase = 'main';
  g.round = 4;
  return { g, reg, ctx: makeCtx(g, reg) };
}

/** Gives a player a tech without paying (research itself is tested in stage1.test.ts). */
function grant(g: GameState, pid: string, techId: string): void {
  g.ext.core = g.ext.core ?? {};
  g.ext.core.techs = g.ext.core.techs ?? {};
  g.ext.core.techs[pid] = [...(g.ext.core.techs[pid] ?? []), techId];
}

const sum = (r: Record<string, number>): number => Object.values(r).reduce((a, b) => a + b, 0);
const RESOURCES = ['wood', 'brick', 'sheep', 'wheat', 'ore'];

describe('Bulwark: Stockpiling', () => {
  it('raises the discard limit by 2 for the owner only, and stacks with Catch-up', () => {
    const { g, reg } = makeGame(910, { techTreeOn: true, catchUpMode: 'light' });
    expect(effectiveDiscardLimit(g, reg, g.players[0])).toBe(7);
    grant(g, 'p1', 'bulwark.stockpiling');
    expect(effectiveDiscardLimit(g, reg, g.players[0])).toBe(9);
    expect(effectiveDiscardLimit(g, reg, g.players[1])).toBe(7);

    // p2 trails far behind, so Catch-up gives +2 (same board as the S1.1 test)
    g.board.vertices[0].piece = { type: 'city', owner: 'p1' };
    g.board.vertices[1].piece = { type: 'city', owner: 'p1' };
    g.board.vertices[2].piece = { type: 'settlement', owner: 'p1' };
    g.board.vertices[3].piece = { type: 'settlement', owner: 'p2' };
    g.board.vertices[4].piece = { type: 'settlement', owner: 'p3' };
    g.board.vertices[5].piece = { type: 'settlement', owner: 'p3' };
    expect(isCatchUpEligible(g, reg, 'p2')).toBe(true);
    expect(effectiveDiscardLimit(g, reg, g.players[1])).toBe(9);
    grant(g, 'p2', 'bulwark.stockpiling');
    expect(effectiveDiscardLimit(g, reg, g.players[1])).toBe(11);
  });
});

describe('Guildhall: Road levy', () => {
  it('only past the road cap: 1 less brick or wood, taken from whichever the player holds fewer of', () => {
    const { g, reg } = makeGame(911);
    const road = reg.pieces.get('road')!;
    const [p1, p2] = g.players;
    const placeRoads = (owner: string, n: number) => {
      let left = n;
      for (const e of g.board.edges) {
        if (left === 0) break;
        if (!e.piece) { e.piece = { type: 'road', owner }; left--; }
      }
    };

    grant(g, 'p1', 'guildhall.road_levy');
    placeRoads('p1', 14);
    expect(priceOf(g, reg, p1, road)).toEqual({ wood: 1, brick: 1 }); // below the cap: no discount

    placeRoads('p1', 1); // 15 roads: the next one costs double
    p1.resources = { wood: 1, brick: 5, sheep: 0, wheat: 0, ore: 0 };
    expect(priceOf(g, reg, p1, road)).toEqual({ wood: 1, brick: 2 });
    p1.resources = { wood: 5, brick: 1, sheep: 0, wheat: 0, ore: 0 };
    expect(priceOf(g, reg, p1, road)).toEqual({ wood: 2, brick: 1 });
    p1.resources = { wood: 3, brick: 3, sheep: 0, wheat: 0, ore: 0 };
    expect(priceOf(g, reg, p1, road)).toEqual({ wood: 1, brick: 2 }); // tie: wood

    placeRoads('p2', 15); // another player past the cap, without the tech
    expect(priceOf(g, reg, p2, road)).toEqual({ wood: 2, brick: 2 });
  });
});

describe('Tidebound: Harbor charters', () => {
  it('raises a city on a 3:1 port to 2:1 for every resource, and spends 2 wood, 1 brick, 1 ore', () => {
    const { g, reg, ctx } = makeGame(912);
    const action = reg.actions.get('upgrade_port')!;
    expect(reg.phases.get('main')!.actions).toContain('upgrade_port');
    const v = g.board.vertices[0];
    v.port = '3:1';
    v.piece = { type: 'city', owner: 'p1' };
    g.players[0].resources = { wood: 2, brick: 1, sheep: 0, wheat: 0, ore: 1 };

    expect(action.validate(ctx, 'p1', { vertexId: 0 })).toMatch(/research harbor charters/i);
    grant(g, 'p1', 'tidebound.harbor_charters');
    for (const r of RESOURCES) expect(ratioFor(g, reg, 'p1', r)).toBe(3);
    expect(action.validate(ctx, 'p1', { vertexId: 0 })).toBeNull();

    action.apply(ctx, 'p1', { vertexId: 0 });
    expect(g.ext.core.portUpgrades[0]).toEqual({ level: 1, by: 'p1' });
    expect(portLevel(g, 0)).toBe(1);
    for (const r of RESOURCES) expect(ratioFor(g, reg, 'p1', r)).toBe(2); // the whole port, no resource choice
    for (const r of RESOURCES) expect(ratioFor(g, reg, 'p2', r)).toBe(4); // only the owner
    expect(g.players[0].resources).toEqual({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });
    expect(action.validate(ctx, 'p1', { vertexId: 0 })).toMatch(/already upgraded/i);
  });

  it('the upgrade price goes through the cost service, so a cost modifier changes what is charged and shown', () => {
    const taxPack: Pack = {
      id: 'upgrade_tax_probe',
      name: 'Upgrade tax probe',
      deps: ['base'],
      register(api) {
        api.define(COST_MODS, {
          id: 'probe.upgradeTax',
          apply: (_g: GameState, _p: any, def: any, cost: Record<string, number>) => (def.id === 'upgrade_port' ? { ...cost, sheep: 1 } : cost)
        });
      }
    };
    const reg = createRegistry([...allPacks, taxPack], { techTreeOn: true }, 'all');
    const g = createGame(reg, {
      players: [
        { id: 'p1', name: 'Alice', avatar: '1', color: '#e74c3c', isBot: false },
        { id: 'p2', name: 'Bob', avatar: '2', color: '#3498db', isBot: false }
      ],
      seed: 924,
      shuffleSeats: false,
      rules: { techTreeOn: true }
    });
    g.phase = 'main';
    const ctx = makeCtx(g, reg);
    const action = reg.actions.get('upgrade_port')!;
    grant(g, 'p1', 'tidebound.harbor_charters');
    g.board.vertices[0].port = '3:1';
    g.board.vertices[0].piece = { type: 'city', owner: 'p1' };

    g.players[0].resources = { wood: 2, brick: 1, sheep: 0, wheat: 0, ore: 1 };
    expect(action.validate(ctx, 'p1', { vertexId: 0 })).toMatch(/not enough/i); // the tax needs 1 sheep too
    expect(techActionsFor(g, reg, 'p1').harbor!.cost).toEqual({ wood: 2, brick: 1, ore: 1, sheep: 1 });
    expect(techActionsFor(g, reg, 'p1').harbor!.affordable).toBe(false);

    g.players[0].resources = { wood: 2, brick: 1, sheep: 1, wheat: 0, ore: 1 };
    expect(action.validate(ctx, 'p1', { vertexId: 0 })).toBeNull();
    action.apply(ctx, 'p1', { vertexId: 0 });
    expect(g.players[0].resources).toEqual({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });
  });

  it('never raises a ratio: a better specialised 2:1 port keeps its own price, and the 2:1 floor holds', () => {
    const { g, reg, ctx } = makeGame(923);
    const action = reg.actions.get('upgrade_port')!;
    grant(g, 'p1', 'tidebound.harbor_charters');
    g.board.vertices[0].port = '3:1';
    g.board.vertices[0].piece = { type: 'city', owner: 'p1' };
    g.board.vertices[1].port = 'wheat';
    g.board.vertices[1].piece = { type: 'settlement', owner: 'p1' };
    g.players[0].resources = { wood: 2, brick: 1, sheep: 0, wheat: 0, ore: 1 };
    expect(ratioFor(g, reg, 'p1', 'wheat')).toBe(2);
    expect(ratioFor(g, reg, 'p1', 'sheep')).toBe(3);
    action.apply(ctx, 'p1', { vertexId: 0 });
    for (const r of RESOURCES) expect(ratioFor(g, reg, 'p1', r)).toBe(2); // wheat stays 2, never 1
  });

  it('refuses a settlement, another player\'s city, a non-3:1 port, bad input and a player who cannot pay', () => {
    const { g, reg, ctx } = makeGame(916);
    const action = reg.actions.get('upgrade_port')!;
    grant(g, 'p1', 'tidebound.harbor_charters');
    g.players[0].resources = { wood: 5, brick: 5, sheep: 5, wheat: 5, ore: 5 };

    g.board.vertices[0].port = '3:1';
    g.board.vertices[0].piece = { type: 'settlement', owner: 'p1' };
    expect(action.validate(ctx, 'p1', { vertexId: 0 })).toMatch(/own city/i);

    g.board.vertices[0].piece = { type: 'city', owner: 'p2' };
    expect(action.validate(ctx, 'p1', { vertexId: 0 })).toMatch(/own city/i);

    g.board.vertices[0].piece = { type: 'city', owner: 'p1' };
    g.board.vertices[0].port = 'wood';
    expect(action.validate(ctx, 'p1', { vertexId: 0 })).toMatch(/3:1/);

    g.board.vertices[0].port = '3:1';
    expect(action.validate(ctx, 'p1', { vertexId: 'x' })).toMatch(/choose a harbor city/i);
    expect(action.validate(ctx, 'p1', {})).toMatch(/choose a harbor city/i);

    g.players[0].resources = { wood: 1, brick: 1, sheep: 0, wheat: 0, ore: 0 };
    expect(action.validate(ctx, 'p1', { vertexId: 0 })).toMatch(/not enough/i);

    g.players[0].resources = { wood: 5, brick: 5, sheep: 5, wheat: 5, ore: 5 };
    expect(action.validate(ctx, 'p1', { vertexId: 0 })).toBeNull();
    const legal = legalActions(g, reg, 'p1').filter(a => a.type === 'upgrade_port');
    expect(legal.map(a => a.payload)).toEqual([{ vertexId: 0 }]); // one entry per port city, no resource in the payload
  });
});

describe('Tidebound: port upgrade level (T1a)', () => {
  it('a new game is state version 2, and a vertex with no upgrade is level 0', () => {
    const { g } = makeGame(919);
    expect(g.version).toBe(2);
    expect(portLevel(g, 0)).toBe(0);
    expect(portLevel(g, 99999)).toBe(0);
  });

  it('an entry from before the level existed counts as level 1, and an old chosen resource is ignored: the whole port is raised', () => {
    const { g, reg } = makeGame(921);
    const v = g.board.vertices[0];
    v.port = '3:1';
    v.piece = { type: 'city', owner: 'p1' };
    g.ext.core = g.ext.core ?? {};
    g.ext.core.portUpgrades = { 0: { resource: 'wheat', by: 'p1' } };
    expect(portLevel(g, 0)).toBe(1);
    for (const r of RESOURCES) expect(ratioFor(g, reg, 'p1', r)).toBe(2);
  });

  it('the panel list reports the level of an upgraded port', () => {
    const { g, reg } = makeGame(922);
    g.board.vertices[0].port = '3:1';
    g.board.vertices[0].piece = { type: 'city', owner: 'p1' };
    grant(g, 'p1', 'tidebound.harbor_charters');
    g.ext.core.portUpgrades = { 0: { level: 1, by: 'p1' } };
    expect(techActionsFor(g, reg, 'p1').harbor!.ports).toEqual([{ vertexId: 0, level: 1 }]);
  });
});

describe('Trade ratio: harbor-only 1:1 floor (T1c)', () => {
  /**
   * A registry with two probe modifiers. `probe.discount` stands in for Market or War weariness (a big cut in the normal
   * chain, which must stop at 2:1). `probe.harbor` stands in for the Harbor that arrives in T8: it reads
   * `g.ext.probe.harbor[pid][resource]` and may go to 1:1.
   */
  function makeProbeGame(seed: number) {
    const probePack: Pack = {
      id: 'ratio_probe',
      name: 'Ratio probe',
      deps: ['base'],
      register(api) {
        api.define(RATIO_MODS, {
          id: 'probe.discount',
          order: RATIO_MOD_ORDER.market,
          apply: (g: GameState, _reg: any, _pid: string, _resource: string, current: number) => (g.ext?.probe?.discount ? current - 5 : current)
        });
        api.define(HARBOR_RATIO_MODS, {
          id: 'probe.harbor',
          apply: (g: GameState, _reg: any, pid: string, resource: string) => g.ext?.probe?.harbor?.[pid]?.[resource] ?? null
        });
      }
    };
    const reg = createRegistry([...allPacks, probePack], {}, 'all');
    const g = createGame(reg, {
      players: [
        { id: 'p1', name: 'Alice', avatar: '1', color: '#e74c3c', isBot: false },
        { id: 'p2', name: 'Bob', avatar: '2', color: '#3498db', isBot: false }
      ],
      seed,
      shuffleSeats: false,
      rules: {}
    });
    g.phase = 'main';
    g.ext.probe = { discount: false, harbor: {} };
    return { g, reg };
  }

  it('with no harbor answering, 4:1 stays 4:1, and a normal modifier cannot go under 2:1', () => {
    const { g, reg } = makeProbeGame(930);
    for (const r of RESOURCES) expect(ratioFor(g, reg, 'p1', r)).toBe(4);
    g.ext.probe.discount = true; // 4 - 5 = -1 in the chain, held at the 2:1 floor
    for (const r of RESOURCES) expect(ratioFor(g, reg, 'p1', r)).toBe(2);
  });

  it('a harbor reaches 1:1 for its own resource only, and for its owner only', () => {
    const { g, reg } = makeProbeGame(931);
    g.ext.probe.harbor = { p1: { wheat: 1 } };
    expect(ratioFor(g, reg, 'p1', 'wheat')).toBe(1);
    for (const r of RESOURCES.filter(x => x !== 'wheat')) expect(ratioFor(g, reg, 'p1', r)).toBe(4);
    for (const r of RESOURCES) expect(ratioFor(g, reg, 'p2', r)).toBe(4);
  });

  it('other modifiers still stop at 2:1 even when a harbor makes one resource 1:1', () => {
    const { g, reg } = makeProbeGame(932);
    g.ext.probe.discount = true;
    g.ext.probe.harbor = { p1: { wheat: 1 } };
    expect(ratioFor(g, reg, 'p1', 'wheat')).toBe(1);
    for (const r of RESOURCES.filter(x => x !== 'wheat')) expect(ratioFor(g, reg, 'p1', r)).toBe(2);
  });

  it('a harbor can only lower a ratio, and never below 1:1', () => {
    const { g, reg } = makeProbeGame(933);
    g.ext.probe.discount = true;
    g.ext.probe.harbor = { p1: { wheat: 3, ore: 0, wood: -4 } };
    expect(ratioFor(g, reg, 'p1', 'wheat')).toBe(2); // 3 would raise the 2:1, so it is ignored
    expect(ratioFor(g, reg, 'p1', 'ore')).toBe(1); // 0 is held at the 1:1 floor
    expect(ratioFor(g, reg, 'p1', 'wood')).toBe(1);
  });

  it('the bank trade check uses the 1:1 harbor ratio', () => {
    const { g, reg } = makeProbeGame(934);
    g.ext.probe.harbor = { p1: { wheat: 1 } };
    expect(explainInvalidBankRatio(g, reg, 'p1', { wheat: 1 }, { ore: 1 })).toMatchObject({ ok: true, credits: 1, wanted: 1 });
    expect(explainInvalidBankRatio(g, reg, 'p1', { sheep: 1 }, { ore: 1 }).ok).toBe(false); // sheep is still 4:1
  });

  it('a raised port (level 1) alone never goes under 2:1, even with another big cut on top', () => {
    const { g, reg } = makeProbeGame(935);
    g.board.vertices[0].port = '3:1';
    g.board.vertices[0].piece = { type: 'city', owner: 'p1' };
    g.ext.core = g.ext.core ?? {};
    g.ext.core.portUpgrades = { 0: { level: 1, by: 'p1' } };
    for (const r of RESOURCES) expect(ratioFor(g, reg, 'p1', r)).toBe(2);
    g.ext.probe.discount = true; // even with a big cut on top, the raised port stops at 2:1
    for (const r of RESOURCES) expect(ratioFor(g, reg, 'p1', r)).toBe(2);
  });
});

describe('Warlords: Plunder', () => {
  /** p1 moves the robber onto a hex where p2 has one settlement and `victimCards` wood. */
  function robberMove(owned: boolean, viaKnight: boolean, victimCards: number) {
    const { g, reg, ctx } = makeGame(913);
    if (owned) grant(g, 'p1', 'warlords.plunder');
    const hex = g.board.hexes.find(h => h.id !== g.board.robberHexId)!;
    g.board.vertices[hex.vertexIds[0]].piece = { type: 'settlement', owner: 'p2' };
    g.players[1].resources = { wood: victimCards, brick: 0, sheep: 0, wheat: 0, ore: 0 };
    if (viaKnight) {
      reg.devcards.get('knight')!.play!(ctx, 'p1', {});
    } else {
      g.phaseStack.push('main'); // what a rolled 7 does
      g.phase = 'robber';
    }
    moveRobberAction.apply(ctx, 'p1', { hexId: hex.id });
    return { g, taken: victimCards - sum(g.players[1].resources), gained: sum(g.players[0].resources) };
  }

  it('a played Knight steals 1 extra card, and the victim hand caps it', () => {
    expect(robberMove(true, true, 5).taken).toBe(2);
    expect(robberMove(true, true, 5).gained).toBe(2);
    expect(robberMove(true, true, 1).taken).toBe(1); // a victim with 1 card loses 1
    expect(robberMove(true, true, 0).taken).toBe(0);
  });

  it('a rolled 7 and a player without the tech steal 1 card', () => {
    expect(robberMove(true, false, 5).taken).toBe(1);
    expect(robberMove(false, true, 5).taken).toBe(1);
    expect(robberMove(false, false, 5).taken).toBe(1);
  });

  it('leaves no knight marker behind and returns to the main phase', () => {
    const { g } = robberMove(true, true, 5);
    expect(g.ext.core?.stealSource).toBeUndefined();
    expect(g.phase).toBe('main');
  });
});

describe('Wild Earth: Ground work', () => {
  const landWithNumber = (g: GameState, reg: any) => g.board.hexes.filter(h => reg.tiles.get(h.type)?.land && h.number !== null);

  it('converts one touching land tile once, keeps its number, and draws nothing from the RNG', () => {
    const { g, reg, ctx } = makeGame(914);
    const action = reg.actions.get('convert_tile')!;
    expect(reg.phases.get('main')!.actions).toContain('convert_tile');
    const land = landWithNumber(g, reg);
    const a = land[0];
    const b = land.find(h => !h.vertexIds.includes(a.vertexIds[0]))!;
    g.board.vertices[a.vertexIds[0]].piece = { type: 'settlement', owner: 'p1' };
    const to = a.type === 'ore' ? 'wood' : 'ore';
    const keptNumber = a.number;

    expect(action.validate(ctx, 'p1', { hexId: a.id, resource: to })).toMatch(/research ground work/i);
    grant(g, 'p1', 'wildearth.ground_work');
    expect(action.validate(ctx, 'p1', { hexId: b.id, resource: to })).toMatch(/touch/i);
    expect(action.validate(ctx, 'p1', { hexId: a.id, resource: 'desert' })).toMatch(/basic resource/i);
    expect(action.validate(ctx, 'p1', { hexId: a.id, resource: 'water' })).toMatch(/basic resource/i);
    expect(action.validate(ctx, 'p1', { hexId: a.id, resource: a.type })).toMatch(/already/i);
    expect(action.validate(ctx, 'p1', { hexId: 9999, resource: to })).toMatch(/choose a tile/i);
    expect(action.validate(ctx, 'p1', { hexId: a.id, resource: to })).toBeNull();

    const panel = techActionsFor(g, reg, 'p1').groundWork!;
    expect(panel.used).toBe(false);
    expect(panel.hexes.map(h => h.hexId)).toContain(a.id);
    expect(panel.hexes.map(h => h.hexId)).not.toContain(b.id);

    const rngBefore = JSON.stringify(g.rng);
    action.apply(ctx, 'p1', { hexId: a.id, resource: to });
    expect(a.type).toBe(to);
    expect(a.number).toBe(keptNumber);
    expect(JSON.stringify(g.rng)).toBe(rngBefore);
    expect(action.validate(ctx, 'p1', { hexId: a.id, resource: a.type === 'wheat' ? 'sheep' : 'wheat' })).toMatch(/already been used/i);
    expect(techActionsFor(g, reg, 'p1').groundWork).toMatchObject({ used: true, hexes: [] });
    expect(action.legal!(ctx, 'p1')).toEqual([]);
  });

  it('rolls a number (never 7) for a desert, and refuses sea and hidden tiles', () => {
    const { g, reg, ctx } = makeGame(917);
    const action = reg.actions.get('convert_tile')!;
    grant(g, 'p1', 'wildearth.ground_work');
    const [d, w, h] = landWithNumber(g, reg);
    d.type = 'desert'; d.number = null;
    w.type = 'water'; w.number = null;
    h.ext = { ...h.ext, hidden: true };
    for (const hex of [d, w, h]) g.board.vertices[hex.vertexIds[0]].piece = { type: 'settlement', owner: 'p1' };

    expect(action.validate(ctx, 'p1', { hexId: w.id, resource: 'ore' })).toMatch(/land/i);
    expect(action.validate(ctx, 'p1', { hexId: h.id, resource: 'ore' })).toMatch(/hidden/i);
    expect(action.validate(ctx, 'p1', { hexId: d.id, resource: 'wheat' })).toBeNull();

    const rngBefore = JSON.stringify(g.rng);
    action.apply(ctx, 'p1', { hexId: d.id, resource: 'wheat' });
    expect(d.type).toBe('wheat');
    expect(d.number).not.toBeNull();
    expect(d.number).not.toBe(7);
    expect(d.number).toBeGreaterThanOrEqual(2);
    expect(d.number).toBeLessThanOrEqual(12);
    expect(JSON.stringify(g.rng)).not.toBe(rngBefore); // the roll is the only draw
  });
});

describe('root tech effects with the tree off', () => {
  it('add no legal actions, no state, and no change to ratios, prices or limits', () => {
    const { g, reg, ctx } = makeGame(915, {});
    const types = legalActions(g, reg, 'p1').map(a => a.type);
    for (const t of ['research_tech', 'upgrade_port', 'convert_tile']) expect(types).not.toContain(t);
    expect(reg.actions.get('upgrade_port')!.legal!(ctx, 'p1')).toEqual([]);
    expect(reg.actions.get('convert_tile')!.legal!(ctx, 'p1')).toEqual([]);
    expect(g.ext.core?.techs).toBeUndefined();
    expect(g.ext.core?.portUpgrades).toBeUndefined();
    expect(g.ext.core?.groundWork).toBeUndefined();
    expect(getPlayerTechs(g, 'p1')).toEqual([]);
    expect(effectiveDiscardLimit(g, reg, g.players[0])).toBe(7);
    expect(ratioFor(g, reg, 'p1', 'wheat')).toBe(4);
    expect(priceOf(g, reg, g.players[0], reg.pieces.get('road')!)).toEqual({ wood: 1, brick: 1 });
  });

  it('the panel lists are empty until the tech is owned', () => {
    const { g, reg } = makeGame(918);
    expect(techActionsFor(g, reg, 'p1')).toEqual({ harbor: null, groundWork: null });
    g.board.vertices[0].port = '3:1';
    g.board.vertices[0].piece = { type: 'city', owner: 'p1' };
    grant(g, 'p1', 'tidebound.harbor_charters');
    const harbor = techActionsFor(g, reg, 'p1').harbor!;
    expect(harbor.ports).toEqual([{ vertexId: 0, level: 0 }]);
    expect(harbor.affordable).toBe(false);
    expect(harbor).not.toHaveProperty('resources'); // no resource choice any more
  });
});

describe('bot tech tree usage when techTreeOn is enabled', () => {
  it('bots research techs and use convert_tile and upgrade_port when techTreeOn is true', () => {
    const { g, reg } = makeGame(920, { techTreeOn: true });
    const p1 = g.players[0];
    p1.isBot = true;
    p1.difficulty = 'Overload';
    p1.pieces.city = 0;
    p1.pieces.settlement = 0;
    p1.resources = { wood: 3, brick: 3, sheep: 3, wheat: 3, ore: 3 };

    const move1 = chooseBotAction(g, reg, 'p1', () => 0.5);
    expect(move1?.type).toBe('research_tech');
    expect(dispatch(g, reg, { type: move1!.type, playerId: 'p1', payload: move1!.payload }).ok).toBe(true);
    expect(getPlayerTechs(g, 'p1').length).toBe(1);

    // Grant Ground Work and place a settlement on a desert hex: bot converts the desert tile immediately
    grant(g, 'p1', 'wildearth.ground_work');
    const desert = g.board.hexes.find(h => h.type === 'desert') ?? g.board.hexes.find(h => reg.tiles.get(h.type)?.land)!;
    desert.type = 'desert';
    desert.number = null;
    g.board.vertices[desert.vertexIds[0]].piece = { type: 'settlement', owner: 'p1' };
    const move2 = chooseBotAction(g, reg, 'p1', () => 0.5);
    expect(move2?.type).toBe('convert_tile');
    expect(move2?.payload.hexId).toBe(desert.id);
    expect(dispatch(g, reg, { type: move2!.type, playerId: 'p1', payload: move2!.payload }).ok).toBe(true);
    expect(desert.type).not.toBe('desert');

    // Grant Harbor Charters, place a city on a 3:1 port, and give high wood production + upgrade resources
    grant(g, 'p1', 'tidebound.harbor_charters');
    const portVertex = g.board.vertices.find(v => v.port && reg.ports.get(v.port)?.resource === null) ?? g.board.vertices[0];
    portVertex.port = '3:1';
    portVertex.piece = { type: 'city', owner: 'p1' };
    const adjHex = g.board.hexes[portVertex.hexIds.find(id => reg.tiles.get(g.board.hexes[id]?.type)?.land) ?? 0];
    adjHex.type = 'wood';
    adjHex.number = 6;
    p1.resources = { wood: 4, brick: 1, sheep: 1, wheat: 1, ore: 1 };
    const move3 = chooseBotAction(g, reg, 'p1', () => 0.5);
    expect(move3?.type).toBe('upgrade_port');
    expect(move3?.payload).toEqual({ vertexId: portVertex.id });
    expect(dispatch(g, reg, { type: move3!.type, playerId: 'p1', payload: move3!.payload }).ok).toBe(true);
    for (const r of RESOURCES) expect(ratioFor(g, reg, 'p1', r)).toBe(2);
  });
});

