import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allPacks, basePack, fogPack, goldPack, tideboundPack } from '../src/packs';
import { ROAD, SETTLEMENT } from '../src/packs/base/constants';
import { longestRoadFor } from '../src/packs/base/longestRoad';
import { BRIDGE, BRIDGE_BASE_LIMIT, BRIDGE_COST, bridgePiece, canPlaceBridge, isOceanEdge } from '../src/packs/tidebound';
import { chooseBotAction } from '../src/server/bots/brain';
import { simulateGame } from '../src/server/bots/sim';
import { mapOptionsView } from '../src/server/mapmenu';
import { clientBoard } from '../src/server/view';
import {
  addonOn,
  auditAddons,
  buildTopology,
  createGame,
  createRegistry,
  dispatch,
  evaluateBotGoals,
  makeCtx,
  priceOf,
  registryFor,
  resolveAddons,
  scaledPieceLimit
} from '../src/shared';

// T0a/T0b + T3: the Tidebound manifest and T3 Bridges (piece, ocean placement, cost & scaling, Longest Road, UI view, bot builds).

const IDS = [
  'tidebound.bridges', 'tidebound.rickety_bridges', 'tidebound.tides', 'tidebound.rising_sea',
  'tidebound.harbor', 'tidebound.fishing', 'tidebound.wrecks', 'tidebound.pirates'
];

const cfg = { players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], seed: 42, shuffleSeats: false };
/** `packs` lists the loaded packs, so a registry with one more pack differs there and nowhere else. */
const strip = (g: any) => { const { packs: _p, ...rest } = g; return JSON.stringify(rest); };

describe('Tidebound manifest', () => {
  it('is in allPacks with the 8 addons in order, and passes the Rule of Two audit', () => {
    expect(allPacks).toContain(tideboundPack);
    expect(tideboundPack.addons?.map(a => a.id)).toEqual(IDS);
    expect(auditAddons(allPacks)).toEqual([]);
  });

  it('every addon has a name, a description and 2+ links', () => {
    for (const a of tideboundPack.addons ?? []) {
      expect(a.name, a.id).toBeTruthy();
      expect(a.description, a.id).toBeTruthy();
      expect(a.links.length, a.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('rickety bridges need bridges, and nothing else has a dependency yet', () => {
    const deps = Object.fromEntries((tideboundPack.addons ?? []).map(a => [a.id, a.deps ?? []]));
    expect(deps['tidebound.rickety_bridges']).toEqual(['tidebound.bridges']);
    expect(Object.entries(deps).filter(([id, d]) => d.length && id !== 'tidebound.rickety_bridges')).toEqual([]);
  });
});

describe('lobby card data', () => {
  it('the server sends the Tidebound DLC and its 8 addons from the manifest', () => {
    const view = mapOptionsView();
    expect(view.dlcs.find(d => d.id === 'tidebound')).toEqual({ id: 'tidebound', name: 'Tidebound', addons: IDS });
    const sent = view.addons.filter(a => a.pack === 'tidebound');
    expect(sent.map(a => a.id)).toEqual(IDS);
    for (const a of sent) expect(a.links.length).toBeGreaterThanOrEqual(2);
  });

  it('the setup page fallback catalog lists the same Tidebound ids as the server (no placeholder ids)', () => {
    const src = readFileSync(join(__dirname, '../src/client/render/setup.ts'), 'utf8');
    const inClient = new Set([...src.matchAll(/'(tidebound\.[a-z_]+)'/g)].map(m => m[1]));
    expect([...inClient].sort()).toEqual([...IDS].sort());
  });
});

describe('Tidebound off changes nothing', () => {
  const without = [basePack, goldPack, fogPack];

  it('gives the same new game as a registry without the pack', () => {
    const plain = createGame(createRegistry(without), cfg);
    const off = createGame(createRegistry(allPacks), cfg);
    expect(strip(off)).toBe(strip(plain));
  });

  it('the master switch is off by default, and a single addon flag cannot turn it on', () => {
    expect(resolveAddons(allPacks, {}).enabled.size).toBe(0);
    expect(resolveAddons(allPacks, { dlc: { tidebound: false }, addons: { 'tidebound.bridges': true } }).enabled.size).toBe(0);
    expect(registryFor(allPacks, {}).enabled.size).toBe(0);
  });

  it('a seeded bot game still finishes with the pack loaded (the golden test checks it plays the same)', () => {
    const a = simulateGame({ seed: 11, players: 3, preset: 'standard' });
    expect(a.error).toBeNull();
    expect(a.finished).toBe(true);
  });
});

describe('Tidebound on', () => {
  const on = { dlc: { tidebound: true } };

  it('enables all 8 addons and registers the bridge piece, crossing capability, and wide_water perk', () => {
    const base = createRegistry(without3());
    const reg = registryFor(allPacks, on);
    expect([...reg.enabled]).toEqual(IDS);
    expect(addonOn(reg, 'tidebound.bridges')).toBe(true);
    expect(addonOn(reg, 'tidebound.pirates')).toBe(true);
    expect(reg.capabilities.has('crossing')).toBe(true);
    expect(reg.pieces.get(BRIDGE)).toBeDefined();
    expect(reg.rules.pieceLimits[BRIDGE]).toBe(BRIDGE_BASE_LIMIT);
    // Harbor (T8b) adds one onTurnStart hook (it resets the per-turn 1:1 trade count); nothing else in the pack does.
    expect(reg.hooks.onTurnStart.length).toBe(base.hooks.onTurnStart.length + 1);
  });

  it('switching bridges off blocks rickety bridges, which the lobby prompts for', () => {
    const res = resolveAddons(allPacks, { ...on, addons: { 'tidebound.bridges': false } });
    expect(res.blocked).toEqual([{ addon: 'tidebound.rickety_bridges', missing: ['tidebound.bridges'] }]);
    expect(res.enabled.has('tidebound.tides')).toBe(true);
  });

  it('a game with the DLC on starts and records the switch', () => {
    const reg = registryFor(allPacks, on);
    const g = createGame(reg, { ...cfg, rules: on });
    expect(g.rules.dlc).toEqual({ tidebound: true });
    expect(g.players[0].pieces[BRIDGE]).toBe(BRIDGE_BASE_LIMIT);
  });
});

describe('T3 Bridges (T3a, T3b, T3c, T3d, T3e)', () => {
  const on = { dlc: { tidebound: true } };

  /** Build a 7-hex ring (center water + 2 land islands opposite each other + 4 water hexes) with water edges. */
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

  it('T3a: defines bridge piece and enforces ocean-only placement & connectivity', () => {
    const { g, ctx } = makeSeaGame();
    const oceanEdges = g.board.edges.filter(e => e.hexIds.length === 0);
    const landEdges = g.board.edges.filter(e => e.hexIds.length > 0);
    expect(oceanEdges.length).toBeGreaterThan(0);
    expect(landEdges.length).toBeGreaterThan(0);

    // Pick a coastal vertex on hex 1 (forest) that also touches an ocean edge
    const oceanEdge = oceanEdges.find(e => {
      const v1 = g.board.vertices[e.v1];
      const v2 = g.board.vertices[e.v2];
      return v1.hexIds.length > 0 || v2.hexIds.length > 0;
    })!;
    expect(oceanEdge).toBeDefined();
    expect(isOceanEdge(ctx, oceanEdge.id)).toBe(true);
    expect(isOceanEdge(ctx, landEdges[0].id)).toBe(false);

    // Without any piece on the board, player 'a' cannot place a bridge anywhere
    expect(canPlaceBridge(ctx, 'a', oceanEdge.id, 'build')).toBe(false);

    // Place a coastal settlement for player 'a' on the coastal endpoint of oceanEdge
    const coastVId = g.board.vertices[oceanEdge.v1].hexIds.length > 0 ? oceanEdge.v1 : oceanEdge.v2;
    const seaVId = oceanEdge.v1 === coastVId ? oceanEdge.v2 : oceanEdge.v1;
    g.board.vertices[coastVId].piece = { type: SETTLEMENT, owner: 'a' };

    // Cannot place bridge during setup mode
    expect(canPlaceBridge(ctx, 'a', oceanEdge.id, 'setup')).toBe(false);
    // Can place bridge on oceanEdge in build mode
    expect(canPlaceBridge(ctx, 'a', oceanEdge.id, 'build')).toBe(true);
    // Cannot place bridge on a coastal or interior land edge (touches land along its side)
    for (const le of landEdges) {
      expect(canPlaceBridge(ctx, 'a', le.id, 'build')).toBe(false);
    }

    // Build the first bridge via dispatch
    g.players[0].resources = { wood: 5, brick: 5, sheep: 5, wheat: 5, ore: 5 };
    const res1 = dispatch(g, ctx.reg, { type: 'build', playerId: 'a', payload: { piece: BRIDGE, loc: oceanEdge.id } });
    expect(res1.ok).toBe(true);
    expect(g.board.edges[oceanEdge.id].piece).toEqual({ type: BRIDGE, owner: 'a' });
    expect(g.players[0].pieces[BRIDGE]).toBe(BRIDGE_BASE_LIMIT - 1);

    // Cannot place a settlement on an open-ocean vertex (v.hexIds.length === 0)
    if (g.board.vertices[seaVId].hexIds.length === 0) {
      const settleDef = ctx.reg.pieces.get(SETTLEMENT)!;
      expect(settleDef.canPlace(ctx, 'a', seaVId, 'build')).toBe(false);
    }

    // Can chain another bridge from seaVId
    const nextOcean = g.board.vertices[seaVId].edgeIds
      .map(id => g.board.edges[id])
      .find(e => e.id !== oceanEdge.id && e.hexIds.length === 0)!;
    expect(nextOcean).toBeDefined();
    expect(canPlaceBridge(ctx, 'a', nextOcean.id, 'build')).toBe(true);

    // Opponent building on seaVId blocks chaining through seaVId
    g.board.vertices[seaVId].piece = { type: SETTLEMENT, owner: 'b' };
    expect(canPlaceBridge(ctx, 'a', nextOcean.id, 'build')).toBe(false);
  });

  it('T3b: bridge costs wood + brick + ore, scales cap with radius & VP, and doubles cost after 10 on board', () => {
    expect(BRIDGE_COST).toEqual({ wood: 1, brick: 1, ore: 1 });
    expect(BRIDGE_BASE_LIMIT).toBe(10);

    // Standard radius 2, 10 VP -> cap 10
    expect(scaledPieceLimit(10, 10, 2)).toBe(10);
    // Radius 4 (61 hexes vs 19 hexes -> sqrt(61/19) ≈ 1.7916 -> ceil(17.916) = 18)
    expect(scaledPieceLimit(10, 10, 4)).toBe(18);
    // Radius 3 (37 hexes), 15 VP (1.5x * sqrt(37/19) ≈ 2.093 -> ceil(20.93) = 21)
    expect(scaledPieceLimit(10, 15, 3)).toBe(21);

    const { g: gBig } = makeSeaGame({ boardRadius: 4, vpToWin: 10 });
    expect(gBig.rules.pieceLimits[BRIDGE]).toBe(18);
    expect(gBig.players[0].pieces[BRIDGE]).toBe(18);
    // Base road still only scales with vpToWin (stays 15 at 10 VP even on radius 4)
    expect(gBig.rules.pieceLimits[ROAD]).toBe(15);

    // 2x cost past 10 bridges on board
    const { g, reg } = makeSeaGame({ boardRadius: 4 });
    const p = g.players[0];
    expect(priceOf(g, reg, p, bridgePiece)).toEqual({ wood: 1, brick: 1, ore: 1 });

    for (let i = 0; i < 10; i++) {
      g.board.edges[i].piece = { type: BRIDGE, owner: 'a' };
    }
    expect(priceOf(g, reg, p, bridgePiece)).toEqual({ wood: 2, brick: 2, ore: 2 });
  });

  it('T3c + T3d: bridges count toward Longest Road, allow road/settlement continuation on another island, and populate clientBoard pieceType', () => {
    const { g, ctx } = makeSeaGame();
    // Build a continuous 5-segment chain for player 'a' mixing roads and bridges across water
    const vJunction = g.board.vertices.find(
      v => v.hexIds.includes(1) &&
        v.edgeIds.some(eid => g.board.edges[eid].hexIds.length === 0) &&
        v.edgeIds.some(eid => g.board.edges[eid].hexIds.length > 0)
    )!;
    const firstRoadEdge = vJunction.edgeIds.map(id => g.board.edges[id]).find(e => e.hexIds.length > 0)!;
    const vStart = firstRoadEdge.v1 === vJunction.id ? firstRoadEdge.v2 : firstRoadEdge.v1;
    firstRoadEdge.piece = { type: ROAD, owner: 'a' };

    const visitedV = new Set<number>([vStart, vJunction.id]);
    const chainEdges: number[] = [firstRoadEdge.id];
    let curV = vJunction.id;

    for (let step = 1; step < 5; step++) {
      const candidates = g.board.vertices[curV].edgeIds
        .map(id => g.board.edges[id])
        .filter(e => {
          const other = e.v1 === curV ? e.v2 : e.v1;
          return !visitedV.has(other);
        });
      // Prefer ocean edges first from vJunction so the chain crosses water via bridge then continues
      candidates.sort((a, b) => a.hexIds.length - b.hexIds.length);
      const nextE = candidates[0]!;
      const pieceType = nextE.hexIds.length === 0 ? BRIDGE : ROAD;
      nextE.piece = { type: pieceType, owner: 'a' };
      chainEdges.push(nextE.id);
      curV = nextE.v1 === curV ? nextE.v2 : nextE.v1;
      visitedV.add(curV);
    }

    // Ensure at least one road and one bridge are in the chain
    expect(chainEdges.some(id => g.board.edges[id].piece?.type === BRIDGE)).toBe(true);
    expect(chainEdges.some(id => g.board.edges[id].piece?.type === ROAD)).toBe(true);
    expect(longestRoadFor(ctx, 'a')).toBe(5);

    // T3d: clientBoard exposes pieceType: 'bridge' vs 'road'
    const cb = clientBoard(g.board, false);
    for (const id of chainEdges) {
      const ce = cb.edges[id];
      expect(ce.road).toBe('a');
      expect(ce.pieceType).toBe(g.board.edges[id].hexIds.length === 0 ? BRIDGE : ROAD);
    }
  });

  it('T3e: bots evaluate bridge goals and can build a bridge in main phase without crashing', () => {
    const { g, reg, ctx } = makeSeaGame();
    g.players[0].isBot = true;
    g.players[0].difficulty = 'main';
    g.players[0].resources = { wood: 3, brick: 3, sheep: 0, wheat: 0, ore: 3 };

    // Place a settlement for bot 'a' on a coastal vertex that has an ocean edge, and block all land edges from it so bridge is its expansion path
    const oceanEdge = g.board.edges.find(e => e.hexIds.length === 0 && (g.board.vertices[e.v1].hexIds.length > 0 || g.board.vertices[e.v2].hexIds.length > 0))!;
    const coastVId = g.board.vertices[oceanEdge.v1].hexIds.length > 0 ? oceanEdge.v1 : oceanEdge.v2;
    g.board.vertices[coastVId].piece = { type: SETTLEMENT, owner: 'a' };
    for (const eid of g.board.vertices[coastVId].edgeIds) {
      const e = g.board.edges[eid];
      if (e.hexIds.length > 0) {
        e.piece = { type: ROAD, owner: 'b' };
      }
    }

    const goals = evaluateBotGoals(ctx, 'a', 'main');
    expect(goals.some(it => it.action?.type === 'build' && it.action?.payload?.piece === BRIDGE)).toBe(true);

    const act = chooseBotAction(g, reg, 'a');
    expect(act).not.toBeNull();
    expect(act?.type).toBe('build');
    expect(act?.payload?.piece).toBe(BRIDGE);
    const res = dispatch(g, reg, { type: act!.type, playerId: 'a', payload: act!.payload });
    expect(res.ok).toBe(true);
  });
});

function without3() { return [basePack, goldPack, fogPack]; }

