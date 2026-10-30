import { describe, expect, it } from 'vitest';
import { allPacks } from '../src/packs';
import {
  NET,
  NET_BASE_LIMIT,
  NET_CATCH_CHANCE,
  NET_COST,
  FISH,
  canPlaceNet,
  netCatchOnRoll,
  netPiece,
  seaHexIdsAt
} from '../src/packs/tidebound/fishing';
import {
  buildTopology,
  createGame,
  dispatch,
  getWildTokens,
  legalActions,
  makeCtx,
  priceOf,
  registryFor
} from '../src/shared';
import { setTileState } from '../src/shared/tileState';

// T7b1: fishing nets. A net is a vertex piece on a coast vertex (touches land and at least one sea tile) next to your own road or bridge.
// On every roll each net has a 1 in 6 chance to catch one fish for its owner. The draw is a hash of the world seed, the roll count and the
// vertex, so it never touches `g.rng`, and nothing reads the tile state, so a net keeps fishing under a flood.

const on = { dlc: { tidebound: true } };
const fishOff = { dlc: { tidebound: true }, addons: { 'tidebound.fishing': false } };

/** A small island (land within `landRadius` of the centre) inside a ring of sea out to radius 3. */
function islandInits(landRadius: number): { q: number; r: number; type: string; number: number | null }[] {
  const out: { q: number; r: number; type: string; number: number | null }[] = [];
  for (let q = -3; q <= 3; q++) {
    for (let r = -3; r <= 3; r++) {
      if (Math.abs(q + r) > 3) continue;
      const dist = (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
      const land = dist <= landRadius;
      out.push({ q, r, type: land ? 'wood' : 'water', number: land ? 6 : null });
    }
  }
  return out;
}

function makeGame(rules: Record<string, any> = on, seed = 99, landRadius = 1) {
  const reg = registryFor(allPacks, rules);
  const board = buildTopology(islandInits(landRadius), {
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

type M = ReturnType<typeof makeGame>;

const player = (g: M['g'], id: string) => g.players.find(p => p.id === id)!;

/** Ids of the vertices that touch land and sea, ascending. */
const coastIds = (m: M): number[] => m.g.board.vertices.filter(v => v.hexIds.length > 0 && seaHexIdsAt(m.g, m.reg, v.id).length > 0).map(v => v.id);
/** Ids of the vertices with only land around them. */
const inlandIds = (m: M): number[] => m.g.board.vertices.filter(v => v.hexIds.length === 3 && seaHexIdsAt(m.g, m.reg, v.id).length === 0).map(v => v.id);

/** Puts a road of `owner` on a land edge at this vertex. */
function giveRoadAt(g: M['g'], vertexId: number, owner: string): number {
  const v = g.board.vertices[vertexId];
  const edgeId = v.edgeIds.find(e => g.board.edges[e].hexIds.length > 0)!;
  g.board.edges[edgeId].piece = { type: 'road', owner };
  return edgeId;
}

/** Runs the catch for `n` rolls the way the roll action does (it adds one to `diceStats` first). Returns one 0/1 per roll for `owner`'s fish. */
function rollMany(m: M, n: number, owner = 'a'): string {
  let pattern = '';
  for (let i = 0; i < n; i++) {
    const before = getWildTokens(m.g, owner, FISH);
    m.g.diceStats[8] = (m.g.diceStats[8] || 0) + 1;
    netCatchOnRoll(m.ctx, 8);
    pattern += getWildTokens(m.g, owner, FISH) > before ? '1' : '0';
  }
  return pattern;
}

describe('registration', () => {
  it('with Tidebound on the net piece, its supply and the catch hook exist', () => {
    const { g, reg } = makeGame(on);
    expect(reg.pieces.has(NET)).toBe(true);
    expect(reg.hooks.onRoll).toContain(netCatchOnRoll);
    expect(g.rules.pieceLimits[NET]).toBe(NET_BASE_LIMIT);
    expect(player(g, 'a').pieces[NET]).toBe(NET_BASE_LIMIT);
  });

  it('with the DLC off, or only Fishing off, there is no net, no hook and no way to build one', () => {
    for (const rules of [{}, { dlc: { tidebound: false } }, fishOff]) {
      const { g, reg } = makeGame(rules);
      expect(reg.pieces.has(NET)).toBe(false);
      expect(reg.hooks.onRoll).not.toContain(netCatchOnRoll);
      expect(NET in player(g, 'a').pieces).toBe(false);
      player(g, 'a').resources.wood = 5;
      player(g, 'a').resources.sheep = 5;
      expect(dispatch(g, reg, { type: 'build', playerId: 'a', payload: { piece: NET, loc: 0 } }).ok).toBe(false);
    }
  });
});

describe('sea tiles at a vertex', () => {
  it('finds the two sea tiles at each corner of a lone island, by geometry', () => {
    const { g, reg } = makeGame(on, 99, 0);
    const centre = g.board.hexes.find(h => h.q === 0 && h.r === 0)!;
    expect(centre.vertexIds).toHaveLength(6);
    for (const vId of centre.vertexIds) {
      const v = g.board.vertices[vId];
      const sea = seaHexIdsAt(g, reg, vId);
      expect(sea).toHaveLength(2);
      for (const id of sea) {
        const h = g.board.hexes[id];
        expect(reg.tiles.get(h.type)?.land).toBe(false);
        // The sea tile really has this corner.
        expect(h.corners.some(c => Math.hypot(c.x - v.x, c.y - v.y) < 8)).toBe(true);
      }
    }
  });

  it('has none inland or in open water, and a river channel is not a fishing ground', () => {
    const m = makeGame();
    expect(inlandIds(m).length).toBeGreaterThan(0);
    for (const id of inlandIds(m)) expect(seaHexIdsAt(m.g, m.reg, id)).toEqual([]);

    const openWater = m.g.board.vertices.find(v => v.hexIds.length === 0);
    expect(openWater).toBeDefined();
    expect(seaHexIdsAt(m.g, m.reg, openWater!.id)).toEqual([]);

    const coast = coastIds(m)[0];
    const sea = seaHexIdsAt(m.g, m.reg, coast);
    expect(sea.length).toBeGreaterThan(0);
    for (const id of sea) m.g.board.hexes[id].ext.river = true;
    expect(seaHexIdsAt(m.g, m.reg, coast)).toEqual([]);
  });
});

describe('placement', () => {
  it('needs an empty coast vertex next to your own road, in the build phase', () => {
    const m = makeGame();
    const coast = coastIds(m)[0];
    expect(canPlaceNet(m.ctx, 'a', coast, 'build')).toBe(false);

    giveRoadAt(m.g, coast, 'a');
    expect(canPlaceNet(m.ctx, 'a', coast, 'build')).toBe(true);
    expect(canPlaceNet(m.ctx, 'b', coast, 'build')).toBe(false);
    expect(canPlaceNet(m.ctx, 'a', coast, 'setup')).toBe(false);

    m.g.board.vertices[coast].piece = { type: 'settlement', owner: 'b' };
    expect(canPlaceNet(m.ctx, 'a', coast, 'build')).toBe(false);
  });

  it('joins through a bridge as well as a road', () => {
    const m = makeGame();
    const coast = coastIds(m).find(id => m.g.board.vertices[id].edgeIds.some(e => m.g.board.edges[e].hexIds.length === 0));
    expect(coast).toBeDefined();
    const waterEdge = m.g.board.vertices[coast!].edgeIds.find(e => m.g.board.edges[e].hexIds.length === 0)!;
    expect(canPlaceNet(m.ctx, 'a', coast!, 'build')).toBe(false);
    m.g.board.edges[waterEdge].piece = { type: 'bridge', owner: 'a' };
    expect(canPlaceNet(m.ctx, 'a', coast!, 'build')).toBe(true);
  });

  it('refuses an inland vertex and open water even with a road next to it', () => {
    const m = makeGame();
    const inland = inlandIds(m)[0];
    giveRoadAt(m.g, inland, 'a');
    expect(canPlaceNet(m.ctx, 'a', inland, 'build')).toBe(false);

    const open = m.g.board.vertices.find(v => v.hexIds.length === 0 && v.edgeIds.length > 0)!;
    m.g.board.edges[open.edgeIds[0]].piece = { type: 'bridge', owner: 'a' };
    expect(canPlaceNet(m.ctx, 'a', open.id, 'build')).toBe(false);
  });
});

describe('build', () => {
  function ready() {
    const m = makeGame();
    const coast = coastIds(m)[0];
    giveRoadAt(m.g, coast, 'a');
    const a = player(m.g, 'a');
    a.resources.wood = 2;
    a.resources.sheep = 1;
    return { ...m, coast, a };
  }
  const build = (m: ReturnType<typeof ready>, loc: number, pid = 'a') => dispatch(m.g, m.reg, { type: 'build', playerId: pid, payload: { piece: NET, loc } });

  it('places a net, takes the price into the bank and one piece from the supply', () => {
    const m = ready();
    const bankWood = m.g.bank.wood;
    expect(build(m, m.coast).ok).toBe(true);
    expect(m.g.board.vertices[m.coast].piece).toEqual({ type: NET, owner: 'a' });
    expect(m.a.resources.wood).toBe(0);
    expect(m.a.resources.sheep).toBe(0);
    expect(m.g.bank.wood).toBe(bankWood + 2);
    expect(m.a.pieces[NET]).toBe(NET_BASE_LIMIT - 1);
  });

  it('refuses without the price, without supply and off the coast, and a refusal changes nothing', () => {
    const m = ready();
    m.a.resources.sheep = 0;
    expect(build(m, m.coast).ok).toBe(false);
    m.a.resources.sheep = 1;

    m.a.pieces[NET] = 0;
    const none = build(m, m.coast);
    expect(none.ok).toBe(false);
    expect(none.error).toContain('left');
    m.a.pieces[NET] = 1;

    const inland = inlandIds(m)[0];
    giveRoadAt(m.g, inland, 'a');
    expect(build(m, inland).ok).toBe(false);
    expect(m.g.board.vertices[inland].piece).toBeNull();
    expect(m.a.resources.wood).toBe(2);

    expect(build(m, m.coast).ok).toBe(true);
  });

  it('is in the legal build list at the net spot and not at an inland vertex', () => {
    const m = ready();
    const locs = legalActions(m.g, m.reg, 'a').filter(x => x.type === 'build' && x.payload.piece === NET).map(x => x.payload.loc);
    expect(locs).toContain(m.coast);
    for (const id of inlandIds(m)) expect(locs).not.toContain(id);
  });

  it('costs double once the base limit of nets is on the board', () => {
    const m = makeGame();
    const a = player(m.g, 'a');
    expect(priceOf(m.g, m.reg, a, netPiece)).toEqual(NET_COST);
    const spots = coastIds(m).slice(0, NET_BASE_LIMIT);
    expect(spots).toHaveLength(NET_BASE_LIMIT);
    for (const id of spots) m.g.board.vertices[id].piece = { type: NET, owner: 'a' };
    expect(priceOf(m.g, m.reg, a, netPiece)).toEqual({ wood: 4, sheep: 2 });
  });
});

describe('the catch', () => {
  it('each net catches about 1 roll in 6 for its owner', () => {
    expect(NET_CATCH_CHANCE).toBeCloseTo(1 / 6);
    const m = makeGame();
    for (const id of coastIds(m).slice(0, 3)) m.g.board.vertices[id].piece = { type: NET, owner: 'a' };
    rollMany(m, 1200);
    const caught = getWildTokens(m.g, 'a', FISH);
    // 3 nets x 1200 rolls x 1/6 = 600, standard deviation about 22.
    expect(caught).toBeGreaterThan(480);
    expect(caught).toBeLessThan(720);
    expect(player(m.g, 'a').stats.fishCaught).toBe(caught);
    expect(getWildTokens(m.g, 'b', FISH)).toBe(0);
  });

  it('gives each owner their own catches', () => {
    const m = makeGame();
    const spots = coastIds(m);
    for (const id of spots.slice(0, 2)) m.g.board.vertices[id].piece = { type: NET, owner: 'a' };
    for (const id of spots.slice(5, 7)) m.g.board.vertices[id].piece = { type: NET, owner: 'b' };
    rollMany(m, 1200);
    // 2 nets x 1200 rolls x 1/6 = 400 each, standard deviation about 18.
    for (const id of ['a', 'b']) {
      expect(getWildTokens(m.g, id, FISH)).toBeGreaterThan(300);
      expect(getWildTokens(m.g, id, FISH)).toBeLessThan(500);
      expect(player(m.g, id).stats.fishCaught).toBe(getWildTokens(m.g, id, FISH));
    }
  });

  it('a net that touches no sea catches nothing', () => {
    const m = makeGame();
    m.g.board.vertices[inlandIds(m)[0]].piece = { type: NET, owner: 'a' };
    rollMany(m, 600);
    expect(getWildTokens(m.g, 'a', FISH)).toBe(0);
  });

  function run(seed: number, flooded: boolean) {
    const m = makeGame(on, seed);
    for (const id of coastIds(m).slice(0, 2)) m.g.board.vertices[id].piece = { type: NET, owner: 'a' };
    if (flooded) for (const h of m.g.board.hexes) if (m.reg.tiles.get(h.type)?.land) setTileState(m.g, h.id, { id: 'flooded' });
    const rngBefore = m.g.rng.s;
    const pattern = rollMany(m, 600);
    return { pattern, fish: getWildTokens(m.g, 'a', FISH), rngUntouched: m.g.rng.s === rngBefore };
  }

  it('is seeded: the same seed gives the same catches, another seed gives other ones, and `g.rng` is never drawn from', () => {
    const one = run(7, false);
    expect(run(7, false)).toEqual(one);
    expect(one.rngUntouched).toBe(true);
    expect(run(8, false).pattern).not.toBe(one.pattern);
  });

  it('keeps fishing while the land around it is flooded', () => {
    expect(run(7, true).pattern).toBe(run(7, false).pattern);
  });

  it('a real roll draws the same dice and the same `g.rng` numbers with nets on the board', () => {
    let checked = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const bare = makeGame(on, seed);
      const netted = makeGame(on, seed);
      for (const id of coastIds(netted).slice(0, 4)) netted.g.board.vertices[id].piece = { type: NET, owner: 'a' };
      for (const m of [bare, netted]) {
        m.g.phase = 'roll';
        m.g.turn = 0;
        expect(dispatch(m.g, m.reg, { type: 'roll', playerId: 'a' }).ok).toBe(true);
      }
      expect(netted.g.dice).toEqual(bare.g.dice);
      // A 7 can change the discard flow (a fish counts as a card), so only the other rolls compare the generator.
      if (bare.g.dice[0] + bare.g.dice[1] === 7) continue;
      expect(netted.g.rng.s).toBe(bare.g.rng.s);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
