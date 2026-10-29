import { describe, expect, it } from 'vitest';
import { allPacks } from '../src/packs';
import { SETTLEMENT } from '../src/packs/base/constants';
import { isRoadPiece } from '../src/packs/base/placement';
import {
  BRIDGE,
  BRIDGE_BASE_LIMIT,
  BRIDGE_COST,
  RICKETY,
  RICKETY_COST,
  RICKETY_HEALTH,
  RICKETY_UPGRADE_COST,
  UPGRADE_BRIDGE,
  bridgePiece,
  bridgeUpgradeView,
  bridgesOnBoard,
  ricketyPiece,
  syncBridgePool
} from '../src/packs/tidebound';
import { chooseBotAction } from '../src/server/bots/brain';
import {
  COST_MODS,
  DURABILITY_DEFS,
  buildTopology,
  checkAction,
  createGame,
  damagePiece,
  defsOf,
  dispatch,
  getPieceDurability,
  legalActions,
  makeCtx,
  priceOf,
  registryFor
} from '../src/shared';

// T4a (rickety bridge piece, 1 wood, health 1, shared pool, pooled 2x cost, bot build) and T4b (upgrade to a full bridge, bot upgrade).
// Collapse on a 7 (T4d), Longest Road recalculation (T4e) and the animation (T4f) are not built yet, so nothing here tests them.

const on = { dlc: { tidebound: true } };
const RICH = { wood: 5, brick: 5, sheep: 5, wheat: 5, ore: 5 };

/** Same 7-hex sea world as tidebound.test.ts: two land hexes (wood, brick) with open water between them. */
function makeSeaGame(extraRules: Record<string, any> = {}) {
  const rules = { ...on, ...extraRules };
  const reg = registryFor(allPacks, rules);
  const board = buildTopology(
    [
      { q: 0, r: 0, type: 'water', number: null },
      { q: 1, r: 0, type: 'wood', number: 6 },
      { q: 1, r: -1, type: 'water', number: null },
      { q: 0, r: -1, type: 'water', number: null },
      { q: -1, r: 0, type: 'brick', number: 8 },
      { q: -1, r: 1, type: 'water', number: null },
      { q: 0, r: 1, type: 'water', number: null }
    ],
    {
      isLand: t => !!reg.tiles.get(t)?.land,
      portBlocked: t => !!reg.tiles.get(t)?.noPort,
      waterEdges: true
    }
  );
  const g = createGame(reg, {
    players: [
      { id: 'a', name: 'Alice' },
      { id: 'b', name: 'Bob' }
    ],
    rules,
    board,
    seed: 99,
    shuffleSeats: false
  });
  g.phase = 'main';
  g.turn = 0;
  return { g, reg, ctx: makeCtx(g, reg) };
}

/** Alice (player 'a') has a coastal settlement next to an ocean edge, and `nextOcean` continues from the far end of it. */
function scene(extraRules: Record<string, any> = {}) {
  const { g, reg, ctx } = makeSeaGame(extraRules);
  const oceanEdge = g.board.edges.find(
    e => e.hexIds.length === 0 && (g.board.vertices[e.v1].hexIds.length > 0 || g.board.vertices[e.v2].hexIds.length > 0)
  )!;
  const coastVId = g.board.vertices[oceanEdge.v1].hexIds.length > 0 ? oceanEdge.v1 : oceanEdge.v2;
  const seaVId = oceanEdge.v1 === coastVId ? oceanEdge.v2 : oceanEdge.v1;
  g.board.vertices[coastVId].piece = { type: SETTLEMENT, owner: 'a' };
  const nextOcean = g.board.vertices[seaVId].edgeIds
    .map(id => g.board.edges[id])
    .find(e => e.id !== oceanEdge.id && e.hexIds.length === 0)!;
  g.players[0].resources = { ...RICH };
  return { g, reg, ctx, oceanEdge, nextOcean, coastVId, seaVId };
}

const build = (g: any, reg: any, piece: string, loc: number, pid = 'a') =>
  dispatch(g, reg, { type: 'build', playerId: pid, payload: { piece, loc } });

describe('T4a/T4b registration', () => {
  it('with Tidebound on: piece, health 1, shared cost modifier, upgrade action in the main phase, equal supply limits', () => {
    const reg = registryFor(allPacks, on);
    expect(reg.pieces.get(RICKETY)).toBe(ricketyPiece);
    expect(reg.rules.pieceLimits[RICKETY]).toBe(BRIDGE_BASE_LIMIT);
    expect(reg.rules.pieceLimits[RICKETY]).toBe(reg.rules.pieceLimits[BRIDGE]);
    expect(defsOf<any>(reg, DURABILITY_DEFS).get('tidebound.rickety')).toMatchObject({ pieceId: RICKETY, maxDurability: RICKETY_HEALTH });
    expect(RICKETY_HEALTH).toBe(1);
    expect(defsOf(reg, COST_MODS).has('tidebound.rickety_pool')).toBe(true);
    expect(reg.actions.has(UPGRADE_BRIDGE)).toBe(true);
    expect(reg.phases.get('main')!.actions).toContain(UPGRADE_BRIDGE);
    expect(reg.phases.get('roll')!.actions).not.toContain(UPGRADE_BRIDGE);
  });

  it('with Tidebound off nothing of it is registered', () => {
    const reg = registryFor(allPacks, {});
    expect(reg.pieces.has(RICKETY)).toBe(false);
    expect(reg.actions.has(UPGRADE_BRIDGE)).toBe(false);
    expect(reg.phases.get('main')!.actions).not.toContain(UPGRADE_BRIDGE);
    expect(defsOf(reg, COST_MODS).has('tidebound.rickety_pool')).toBe(false);
  });

  it('with rickety bridges switched off, bridges behave as in T3 (one supply, nothing mirrored)', () => {
    const { g, reg, oceanEdge } = scene({ addons: { 'tidebound.rickety_bridges': false } });
    expect(reg.pieces.has(RICKETY)).toBe(false);
    expect(reg.phases.get('main')!.actions).not.toContain(UPGRADE_BRIDGE);
    expect(build(g, reg, BRIDGE, oceanEdge.id).ok).toBe(true);
    expect(g.players[0].pieces[BRIDGE]).toBe(BRIDGE_BASE_LIMIT - 1);
    expect(g.players[0].pieces[RICKETY]).toBeUndefined();
  });
});

describe('T4a rickety bridge', () => {
  it('costs 1 wood, uses the bridge placement rule, and has health 1', () => {
    const { g, reg, ctx, oceanEdge, nextOcean } = scene();
    const p = g.players[0];
    expect(RICKETY_COST).toEqual({ wood: 1 });
    expect(priceOf(g, reg, p, ricketyPiece)).toEqual({ wood: 1 });

    const before = { ...p.resources };
    const res = build(g, reg, RICKETY, oceanEdge.id);
    expect(res.ok).toBe(true);
    expect(g.board.edges[oceanEdge.id].piece).toEqual({ type: RICKETY, owner: 'a' });
    expect(p.resources.wood).toBe(before.wood - 1);
    expect(p.resources.brick).toBe(before.brick);
    expect(p.resources.ore).toBe(before.ore);
    expect(getPieceDurability(g, reg, 'edge', oceanEdge.id)).toBe(1);

    // Ocean edges only, like a bridge.
    const landEdge = g.board.edges.find(e => e.hexIds.length > 0)!;
    expect(checkAction(g, reg, { type: 'build', playerId: 'a', payload: { piece: RICKETY, loc: landEdge.id } })).toMatch(/Cannot place/);
    // And it connects: the next ocean edge is legal from the end of a rickety bridge.
    expect(checkAction(g, reg, { type: 'build', playerId: 'a', payload: { piece: RICKETY, loc: nextOcean.id } })).toBeNull();

    // It is road-like: Longest Road and connectivity treat it as a road.
    expect(isRoadPiece(ctx, RICKETY)).toBe(true);
  });

  it('shares one pool with bridges: building either lowers both supplies, other players are untouched', () => {
    const { g, reg, oceanEdge, nextOcean } = scene();
    expect(g.players[0].pieces[BRIDGE]).toBe(10);
    expect(g.players[0].pieces[RICKETY]).toBe(10);

    expect(build(g, reg, RICKETY, oceanEdge.id).ok).toBe(true);
    expect(g.players[0].pieces[BRIDGE]).toBe(9);
    expect(g.players[0].pieces[RICKETY]).toBe(9);

    expect(build(g, reg, BRIDGE, nextOcean.id).ok).toBe(true);
    expect(g.players[0].pieces[BRIDGE]).toBe(8);
    expect(g.players[0].pieces[RICKETY]).toBe(8);
    expect(bridgesOnBoard(g, 'a')).toBe(2);

    expect(g.players[1].pieces[BRIDGE]).toBe(10);
    expect(g.players[1].pieces[RICKETY]).toBe(10);
  });

  it('when the pool is used up neither kind can be built', () => {
    const { g, reg, oceanEdge, nextOcean } = scene();
    const fillers = g.board.edges.filter(e => e.id !== oceanEdge.id && e.id !== nextOcean.id).slice(0, 9);
    expect(fillers.length).toBe(9);
    fillers.forEach((e, i) => { e.piece = { type: i % 2 ? BRIDGE : RICKETY, owner: 'a' }; });
    syncBridgePool(g, 'a');
    expect(g.players[0].pieces[BRIDGE]).toBe(1);
    expect(g.players[0].pieces[RICKETY]).toBe(1);

    expect(build(g, reg, BRIDGE, oceanEdge.id).ok).toBe(true); // the last one in the pool
    expect(g.players[0].pieces[BRIDGE]).toBe(0);
    expect(g.players[0].pieces[RICKETY]).toBe(0);
    expect(checkAction(g, reg, { type: 'build', playerId: 'a', payload: { piece: RICKETY, loc: nextOcean.id } })).toMatch(/No Rickety bridge pieces left/);
    expect(checkAction(g, reg, { type: 'build', playerId: 'a', payload: { piece: BRIDGE, loc: nextOcean.id } })).toMatch(/No Bridge pieces left/);
  });

  it('the pool scales with radius like bridges do (both supplies start at the scaled cap)', () => {
    const { g } = makeSeaGame({ boardRadius: 4, vpToWin: 10 });
    expect(g.rules.pieceLimits[BRIDGE]).toBe(18);
    expect(g.rules.pieceLimits[RICKETY]).toBe(18);
    expect(g.players[0].pieces[RICKETY]).toBe(18);
    expect(g.players[0].pieces[BRIDGE]).toBe(18);
  });

  it('2x cost starts when bridges and rickety bridges TOGETHER reach the base limit', () => {
    const { g, reg } = scene();
    const p = g.players[0];
    const edges = g.board.edges;
    for (let i = 0; i < 5; i++) edges[i].piece = { type: BRIDGE, owner: 'a' };
    for (let i = 5; i < 10; i++) edges[i].piece = { type: RICKETY, owner: 'a' };
    // 5 + 5 = 10 in the pool, though neither kind is at 10 on its own.
    expect(priceOf(g, reg, p, bridgePiece)).toEqual({ wood: 2, brick: 2, ore: 2 });
    expect(priceOf(g, reg, p, ricketyPiece)).toEqual({ wood: 2 });

    edges[9].piece = null; // 9 in the pool
    expect(priceOf(g, reg, p, bridgePiece)).toEqual({ wood: 1, brick: 1, ore: 1 });
    expect(priceOf(g, reg, p, ricketyPiece)).toEqual({ wood: 1 });
  });

  it('2x cost is not doubled twice when one kind alone is already at the limit', () => {
    const { g, reg } = scene();
    for (let i = 0; i < 10; i++) g.board.edges[i].piece = { type: RICKETY, owner: 'a' };
    expect(priceOf(g, reg, g.players[0], ricketyPiece)).toEqual({ wood: 2 });
    expect(priceOf(g, reg, g.players[0], bridgePiece)).toEqual({ wood: 2, brick: 2, ore: 2 });
  });

  it('health 1: one point of damage breaks it and returns it to the pool once the pool is synced', () => {
    const { g, reg, ctx, oceanEdge } = scene();
    expect(build(g, reg, RICKETY, oceanEdge.id).ok).toBe(true);
    const out = damagePiece(ctx, 'edge', oceanEdge.id, 1);
    expect(out.broken).toBe(true);
    expect(g.board.edges[oceanEdge.id].piece).toBeNull();
    // damagePiece hands the piece back to the rickety counter only, so T4d must sync the pool after a collapse.
    expect(g.players[0].pieces[RICKETY]).toBe(10);
    expect(g.players[0].pieces[BRIDGE]).toBe(9);
    syncBridgePool(g, 'a');
    expect(g.players[0].pieces[RICKETY]).toBe(10);
    expect(g.players[0].pieces[BRIDGE]).toBe(10);
  });

  it('a bot that cannot pay for a full bridge builds a rickety one on the same spot', () => {
    const { g, reg, coastVId } = scene();
    const bot = g.players[0];
    bot.isBot = true;
    bot.difficulty = 'main';
    bot.resources = { wood: 1, brick: 0, sheep: 0, wheat: 0, ore: 0 };
    // Block the land edges from the settlement so the sea is the way out (as in the T3e test).
    for (const eid of g.board.vertices[coastVId].edgeIds) {
      const e = g.board.edges[eid];
      if (e.hexIds.length > 0) e.piece = { type: 'road', owner: 'b' };
    }
    const act = chooseBotAction(g, reg, 'a');
    expect(act).not.toBeNull();
    expect(act?.type).toBe('build');
    expect(act?.payload?.piece).toBe(RICKETY);
    expect(dispatch(g, reg, { type: act!.type, playerId: 'a', payload: act!.payload }).ok).toBe(true);
  });
});

describe('T4b upgrade to a full bridge', () => {
  function withRickety() {
    const s = scene();
    expect(build(s.g, s.reg, RICKETY, s.oceanEdge.id).ok).toBe(true);
    return s;
  }

  it('turns your rickety bridge into a bridge in place for 1 brick + 1 ore', () => {
    const { g, reg, oceanEdge } = withRickety();
    const p = g.players[0];
    p.resources = { wood: 0, brick: 1, sheep: 0, wheat: 0, ore: 1 };
    const res = dispatch(g, reg, { type: UPGRADE_BRIDGE, playerId: 'a', payload: { edgeId: oceanEdge.id } });
    expect(res.ok).toBe(true);
    expect(g.board.edges[oceanEdge.id].piece).toEqual({ type: BRIDGE, owner: 'a' });
    expect(p.resources.brick).toBe(0);
    expect(p.resources.ore).toBe(0);
    // Same piece count on the board, so the supplies do not move.
    expect(p.pieces[BRIDGE]).toBe(9);
    expect(p.pieces[RICKETY]).toBe(9);
    expect(bridgesOnBoard(g, 'a')).toBe(1);
    expect(p.stats.bridgesUpgraded).toBe(1);
    expect(res.events?.some(ev => ev.type === 'bridgeUpgraded')).toBe(true);
  });

  it('rickety wood + upgrade brick and ore adds up to the full bridge price', () => {
    expect({ ...RICKETY_COST, ...RICKETY_UPGRADE_COST }).toEqual(BRIDGE_COST);
  });

  it('is refused for a bridge, for someone else\'s rickety bridge, with no resources, with a bad payload, and outside your main phase', () => {
    const { g, reg, oceanEdge } = withRickety();
    const p = g.players[0];
    const act = (payload: any) => checkAction(g, reg, { type: UPGRADE_BRIDGE, playerId: 'a', payload });

    p.resources = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
    expect(act({ edgeId: oceanEdge.id })).toMatch(/Not enough resources/);
    p.resources = { ...RICH };
    expect(act({ edgeId: oceanEdge.id })).toBeNull();

    expect(act({})).toMatch(/Choose a rickety bridge/);
    expect(act({ edgeId: 99999 })).toMatch(/Choose a rickety bridge/);
    const landEdge = g.board.edges.find(e => e.hexIds.length > 0)!;
    expect(act({ edgeId: landEdge.id })).toMatch(/Only your own rickety bridge/);

    g.board.edges[oceanEdge.id].piece = { type: BRIDGE, owner: 'a' };
    expect(act({ edgeId: oceanEdge.id })).toMatch(/Only your own rickety bridge/);
    g.board.edges[oceanEdge.id].piece = { type: RICKETY, owner: 'b' };
    expect(act({ edgeId: oceanEdge.id })).toMatch(/Only your own rickety bridge/);

    g.board.edges[oceanEdge.id].piece = { type: RICKETY, owner: 'a' };
    g.phase = 'roll';
    expect(act({ edgeId: oceanEdge.id })).toMatch(/not allowed/);
  });

  it('costs double once bridges and rickety bridges together are at the base limit', () => {
    const { g, reg, oceanEdge } = withRickety();
    const p = g.players[0];
    g.board.edges.filter(e => e.id !== oceanEdge.id).slice(0, 9).forEach(e => { e.piece = { type: BRIDGE, owner: 'a' }; });
    expect(bridgesOnBoard(g, 'a')).toBe(10);

    p.resources = { wood: 0, brick: 1, sheep: 0, wheat: 0, ore: 1 };
    expect(checkAction(g, reg, { type: UPGRADE_BRIDGE, playerId: 'a', payload: { edgeId: oceanEdge.id } })).toMatch(/Not enough resources/);
    p.resources = { wood: 0, brick: 2, sheep: 0, wheat: 0, ore: 2 };
    expect(dispatch(g, reg, { type: UPGRADE_BRIDGE, playerId: 'a', payload: { edgeId: oceanEdge.id } }).ok).toBe(true);
    expect(p.resources.brick).toBe(0);
    expect(p.resources.ore).toBe(0);
  });

  it('legal actions list your rickety bridges only when you can pay', () => {
    const { g, reg, oceanEdge } = withRickety();
    const p = g.players[0];
    const upgrades = () => legalActions(g, reg, 'a').filter(a => a.type === UPGRADE_BRIDGE);

    p.resources = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
    expect(upgrades()).toEqual([]);
    p.resources = { wood: 0, brick: 1, sheep: 0, wheat: 0, ore: 1 };
    expect(upgrades()).toEqual([{ type: UPGRADE_BRIDGE, payload: { edgeId: oceanEdge.id } }]);
  });

  it('a bot with spare cards upgrades a rickety bridge', () => {
    const { g, reg, oceanEdge } = scene();
    g.board.edges[oceanEdge.id].piece = { type: RICKETY, owner: 'a' };
    syncBridgePool(g, 'a');
    const bot = g.players[0];
    bot.isBot = true;
    bot.difficulty = 'main';
    bot.resources = { wood: 0, brick: 3, sheep: 0, wheat: 0, ore: 3 };
    const act = chooseBotAction(g, reg, 'a');
    expect(act?.type).toBe(UPGRADE_BRIDGE);
    expect(act?.payload).toEqual({ edgeId: oceanEdge.id });
    expect(dispatch(g, reg, { type: act!.type, playerId: 'a', payload: act!.payload }).ok).toBe(true);
    expect(g.board.edges[oceanEdge.id].piece?.type).toBe(BRIDGE);
  });
});

// T4c is a client popup (type picker, upgrade button). What the server owes it is one number: the player's upgrade price.
describe('T4c view data', () => {
  it('bridgeUpgradeView is this player\'s upgrade price while rickety bridges are in the game', () => {
    const { g, reg } = scene();
    expect(bridgeUpgradeView(g, reg, g.players[0])).toEqual(RICKETY_UPGRADE_COST);
  });

  it('it doubles with the pool, like the action itself', () => {
    const { g, reg } = scene();
    g.board.edges.slice(0, 10).forEach(e => { e.piece = { type: BRIDGE, owner: 'a' }; });
    expect(bridgeUpgradeView(g, reg, g.players[0])).toEqual({ brick: 2, ore: 2 });
    // The other player has nothing on the board, so theirs is the plain price.
    expect(bridgeUpgradeView(g, reg, g.players[1])).toEqual(RICKETY_UPGRADE_COST);
  });

  it('is undefined with the DLC off or with rickety bridges switched off, so those games send nothing new', () => {
    // With the DLC off the registry has no rickety piece, so the view gives nothing (the same game state is enough for that check).
    const { g: g0 } = scene();
    const off = registryFor(allPacks, {});
    expect(bridgeUpgradeView(g0, off, g0.players[0])).toBeUndefined();

    const s = scene({ addons: { 'tidebound.rickety_bridges': false } });
    expect(bridgeUpgradeView(s.g, s.reg, s.g.players[0])).toBeUndefined();
  });

  it('the piece price the client reads for the picker is in priceOf (rickety 1 wood, bridge 1 wood + 1 brick + 1 ore)', () => {
    const { g, reg } = scene();
    expect(priceOf(g, reg, g.players[0], ricketyPiece)).toEqual(RICKETY_COST);
    expect(priceOf(g, reg, g.players[0], bridgePiece)).toEqual(BRIDGE_COST);
  });
});
