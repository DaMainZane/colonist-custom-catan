import { describe, expect, it } from 'vitest';
import { allPacks } from '../src/packs';
import {
  NET,
  NET_BOT_MAX,
  canPlaceNet,
  netBotGoal,
  netSpotsView,
  seaHexIdsAt
} from '../src/packs/tidebound/fishing';
import { chooseBotAction } from '../src/server/bots/brain';
import {
  BOT_GOALS,
  buildTopology,
  createGame,
  defsOf,
  legalActions,
  makeCtx,
  registryFor
} from '../src/shared';

// T7b2: what the client needs for fishing nets. The server lists the vertices a net could go on (`netSpotsView`, sent as `netSpots` to the
// player whose main-phase turn it is), a net never goes on a port vertex (`ratioFor` gives a port to ANY piece on it, so a cheap net there would
// be a port without a settlement), and a bot builds a few nets as a side build (`netBotGoal`).

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

describe('no net on a port vertex', () => {
  it('refuses a port vertex even with a road next to it, and accepts it again without the port', () => {
    const m = makeGame();
    const coast = coastIds(m)[0];
    giveRoadAt(m.g, coast, 'a');
    expect(canPlaceNet(m.ctx, 'a', coast, 'build')).toBe(true);

    m.g.board.vertices[coast].port = '3:1';
    expect(canPlaceNet(m.ctx, 'a', coast, 'build')).toBe(false);
    expect(netSpotsView(m.g, m.reg, player(m.g, 'a'))).not.toContain(coast);

    m.g.board.vertices[coast].port = null;
    expect(canPlaceNet(m.ctx, 'a', coast, 'build')).toBe(true);
  });
});

describe('netSpotsView (the client build spots)', () => {
  it('lists the vertices canPlaceNet accepts for this player: coast next to your own road, never inland', () => {
    const m = makeGame();
    const coast = coastIds(m)[0];
    giveRoadAt(m.g, coast, 'a');
    const spots = netSpotsView(m.g, m.reg, player(m.g, 'a'))!;
    expect(spots).toContain(coast);
    for (const id of spots) expect(canPlaceNet(m.ctx, 'a', id, 'build')).toBe(true);
    for (const id of inlandIds(m)) expect(spots).not.toContain(id);
    // The same set the build action offers once the price is paid.
    const a = player(m.g, 'a');
    a.resources.wood = 2;
    a.resources.sheep = 1;
    const legal = legalActions(m.g, m.reg, 'a').filter(x => x.type === 'build' && x.payload.piece === NET).map(x => x.payload.loc);
    expect([...legal].sort((x, y) => x - y)).toEqual([...spots].sort((x, y) => x - y));
  });

  it('is empty with no road of yours next to the coast (another player\'s road does not count)', () => {
    const m = makeGame();
    expect(netSpotsView(m.g, m.reg, player(m.g, 'a'))).toEqual([]);
    giveRoadAt(m.g, coastIds(m)[0], 'b');
    expect(netSpotsView(m.g, m.reg, player(m.g, 'a'))).toEqual([]);
  });

  it('is undefined when nets are not in the game, off your turn and outside the main phase', () => {
    for (const rules of [{}, { dlc: { tidebound: false } }, fishOff]) {
      const m = makeGame(rules);
      expect(netSpotsView(m.g, m.reg, player(m.g, 'a'))).toBeUndefined();
    }
    const m = makeGame();
    giveRoadAt(m.g, coastIds(m)[0], 'a');
    // It is a's turn: b gets nothing.
    expect(netSpotsView(m.g, m.reg, player(m.g, 'b'))).toBeUndefined();
    m.g.phase = 'roll';
    expect(netSpotsView(m.g, m.reg, player(m.g, 'a'))).toBeUndefined();
    m.g.phase = 'main';
    expect(netSpotsView(m.g, m.reg, player(m.g, 'a'))).toBeDefined();
  });

  it('is empty when the supply of nets is used up', () => {
    const m = makeGame();
    giveRoadAt(m.g, coastIds(m)[0], 'a');
    player(m.g, 'a').pieces[NET] = 0;
    expect(netSpotsView(m.g, m.reg, player(m.g, 'a'))).toEqual([]);
  });
});

describe('net bot goal', () => {
  /** A hand big enough for the price (2 wood + 1 sheep) plus 2 spare cards. */
  function richBot(m: M) {
    const a = player(m.g, 'a');
    a.resources.wood = 3;
    a.resources.sheep = 2;
    return a;
  }

  it('is registered with Fishing on and not with the DLC or Fishing off', () => {
    expect(defsOf(makeGame(on).reg, BOT_GOALS).has(netBotGoal.id)).toBe(true);
    for (const rules of [{}, { dlc: { tidebound: false } }, fishOff]) {
      expect(defsOf(makeGame(rules).reg, BOT_GOALS).has(netBotGoal.id)).toBe(false);
    }
  });

  it('offers a net build at a legal vertex when the hand has the price and 2 cards to spare', () => {
    const m = makeGame();
    const coast = coastIds(m)[0];
    giveRoadAt(m.g, coast, 'a');
    richBot(m);
    const goals = netBotGoal.goals!(m.ctx, 'a');
    expect(goals).toHaveLength(1);
    const act = goals[0].action!;
    expect(act.type).toBe('build');
    expect(act.payload.piece).toBe(NET);
    expect(canPlaceNet(m.ctx, 'a', act.payload.loc, 'build')).toBe(true);
    expect(goals[0].cost).toEqual({ wood: 2, sheep: 1 });
  });

  it('offers nothing with just the price, without a spot, without supply or at the bot limit', () => {
    const m = makeGame();
    const coast = coastIds(m)[0];
    const a = richBot(m);
    expect(netBotGoal.goals!(m.ctx, 'a')).toEqual([]); // no road yet, so no spot

    giveRoadAt(m.g, coast, 'a');
    a.resources.wood = 2;
    a.resources.sheep = 1;
    expect(netBotGoal.goals!(m.ctx, 'a')).toEqual([]); // price only, nothing spare
    richBot(m);
    expect(netBotGoal.goals!(m.ctx, 'a')).toHaveLength(1);

    a.pieces[NET] = 0;
    expect(netBotGoal.goals!(m.ctx, 'a')).toEqual([]);
    a.pieces[NET] = 4;

    const others = coastIds(m).filter(id => id !== coast).slice(0, NET_BOT_MAX);
    expect(others).toHaveLength(NET_BOT_MAX);
    for (const id of others) m.g.board.vertices[id].piece = { type: NET, owner: 'a' };
    expect(netBotGoal.goals!(m.ctx, 'a')).toEqual([]);
  });

  it('prefers a vertex next to a sea tile with a fish icon', () => {
    const m = makeGame();
    const ids = coastIds(m);
    const first = ids[0];
    const v0 = m.g.board.vertices[first];
    const far = ids.reduce((best, id) => {
      const v = m.g.board.vertices[id];
      const d = Math.hypot(v.x - v0.x, v.y - v0.y);
      return d > best.d ? { id, d } : best;
    }, { id: first, d: -1 }).id;
    giveRoadAt(m.g, first, 'a');
    giveRoadAt(m.g, far, 'a');
    const near = new Set(seaHexIdsAt(m.g, m.reg, first));
    const fishHex = seaHexIdsAt(m.g, m.reg, far).find(id => !near.has(id));
    expect(fishHex).toBeDefined();
    m.g.board.hexes[fishHex!].ext.fish = 4;
    richBot(m);

    const loc = netBotGoal.goals!(m.ctx, 'a')[0].action!.payload.loc;
    expect(seaHexIdsAt(m.g, m.reg, loc)).toContain(fishHex);
  });

  it('the brain really builds the net (nothing better to do, a few cards to spare)', () => {
    const m = makeGame();
    giveRoadAt(m.g, coastIds(m)[0], 'a');
    richBot(m);
    const move = chooseBotAction(m.g, m.reg, 'a', () => 0.5);
    expect(move).not.toBeNull();
    expect(move!.type).toBe('build');
    expect(move!.payload.piece).toBe(NET);
    expect(canPlaceNet(m.ctx, 'a', move!.payload.loc, 'build')).toBe(true);
  });
});
