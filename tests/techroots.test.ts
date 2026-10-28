// MODULE: unit tests for the effects of the 5 root techs (Stockpiling, Road levy, Harbor charters, Plunder, Ground work)
import { describe, expect, it } from 'vitest';
import { allPacks } from '../src/packs';
import { moveRobberAction } from '../src/packs/base/actions/robber';
import { techActionsFor } from '../src/packs/base/techEffects';
import {
  createGame,
  createRegistry,
  effectiveDiscardLimit,
  getPlayerTechs,
  isCatchUpEligible,
  legalActions,
  makeCtx,
  priceOf,
  ratioFor,
  registerStage1Definitions
} from '../src/shared';
import type { GameState, Pack } from '../src/shared';

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
  it('upgrades a city on a 3:1 port so one chosen resource trades 2:1, and spends 2 wood, 1 brick, 1 ore', () => {
    const { g, reg, ctx } = makeGame(912);
    const action = reg.actions.get('upgrade_port')!;
    expect(reg.phases.get('main')!.actions).toContain('upgrade_port');
    const v = g.board.vertices[0];
    v.port = '3:1';
    v.piece = { type: 'city', owner: 'p1' };
    g.players[0].resources = { wood: 2, brick: 1, sheep: 0, wheat: 0, ore: 1 };

    expect(action.validate(ctx, 'p1', { vertexId: 0, resource: 'wheat' })).toMatch(/research harbor charters/i);
    grant(g, 'p1', 'tidebound.harbor_charters');
    expect(ratioFor(g, reg, 'p1', 'wheat')).toBe(3);
    expect(action.validate(ctx, 'p1', { vertexId: 0, resource: 'wheat' })).toBeNull();

    action.apply(ctx, 'p1', { vertexId: 0, resource: 'wheat' });
    expect(ratioFor(g, reg, 'p1', 'wheat')).toBe(2);
    expect(ratioFor(g, reg, 'p1', 'sheep')).toBe(3); // only the chosen resource
    expect(ratioFor(g, reg, 'p2', 'wheat')).toBe(4); // only the owner
    expect(g.players[0].resources).toEqual({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });
    expect(action.validate(ctx, 'p1', { vertexId: 0, resource: 'sheep' })).toMatch(/already upgraded/i);
  });

  it('refuses a settlement, a non-3:1 port, a resource already at 2:1, bad input and a player who cannot pay', () => {
    const { g, reg, ctx } = makeGame(916);
    const action = reg.actions.get('upgrade_port')!;
    grant(g, 'p1', 'tidebound.harbor_charters');
    g.players[0].resources = { wood: 5, brick: 5, sheep: 5, wheat: 5, ore: 5 };

    g.board.vertices[0].port = '3:1';
    g.board.vertices[0].piece = { type: 'settlement', owner: 'p1' };
    expect(action.validate(ctx, 'p1', { vertexId: 0, resource: 'wheat' })).toMatch(/own city/i);

    g.board.vertices[0].piece = { type: 'city', owner: 'p2' };
    expect(action.validate(ctx, 'p1', { vertexId: 0, resource: 'wheat' })).toMatch(/own city/i);

    g.board.vertices[0].piece = { type: 'city', owner: 'p1' };
    g.board.vertices[0].port = 'wood';
    expect(action.validate(ctx, 'p1', { vertexId: 0, resource: 'wheat' })).toMatch(/3:1/);

    g.board.vertices[0].port = '3:1';
    g.board.vertices[1].port = 'wheat';
    g.board.vertices[1].piece = { type: 'settlement', owner: 'p1' };
    expect(action.validate(ctx, 'p1', { vertexId: 0, resource: 'wheat' })).toMatch(/already trade wheat at 2:1/i);
    expect(action.validate(ctx, 'p1', { vertexId: 0, resource: 'gold' })).toMatch(/choose a resource/i);
    expect(action.validate(ctx, 'p1', { vertexId: 'x', resource: 'sheep' })).toMatch(/choose a harbor city/i);

    g.players[0].resources = { wood: 1, brick: 1, sheep: 0, wheat: 0, ore: 0 };
    expect(action.validate(ctx, 'p1', { vertexId: 0, resource: 'sheep' })).toMatch(/not enough/i);

    g.players[0].resources = { wood: 5, brick: 5, sheep: 5, wheat: 5, ore: 5 };
    expect(action.validate(ctx, 'p1', { vertexId: 0, resource: 'sheep' })).toBeNull();
    const legal = legalActions(g, reg, 'p1').filter(a => a.type === 'upgrade_port');
    expect(legal.map(a => a.payload.resource).sort()).toEqual(['brick', 'ore', 'sheep', 'wood']); // wheat is already 2:1
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
    expect(harbor.ports).toEqual([{ vertexId: 0, resource: null }]);
    expect(harbor.affordable).toBe(false);
    expect(harbor.resources).toEqual(expect.arrayContaining(['wood', 'brick', 'sheep', 'wheat', 'ore']));
  });
});
