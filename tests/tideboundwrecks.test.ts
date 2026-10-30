import { describe, expect, it } from 'vitest';
import { wreckMarkup } from '../src/client/icons';
import { allPacks } from '../src/packs';
import { GENERIC_PORT, ROAD, SETTLEMENT } from '../src/packs/base/constants';
import {
  BRIDGE,
  FISH,
  RICKETY,
  STORM_CADENCE_ROUNDS,
  STORM_EVENT_ID,
  STORM_FIRST_ROUND,
  TECH_SALVAGE_CREW,
  WRECK_COUNTDOWN_ROUNDS,
  WRECK_MAX_PLAYER_DIST,
  WRECK_SEA_CHANCE,
  WRECK_SEA_MAX_CARDS,
  WRECK_SEA_MIN_CARDS,
  WRECK_SHORE_MAX_CARDS,
  WRECK_SHORE_MIN_CARDS,
  activeWrecks,
  claimWreck,
  computeWreckLootCount,
  deriveWreckRng,
  edgesOfHex,
  isWreckSeaHex,
  isWreckShoreHex,
  minPlayerDistanceToHex,
  pickWreckHex,
  playerHexDistance,
  playerTouchesWreck,
  shoreSeaDirection,
  spawnStormWreck,
  spawnWreckAt,
  stormEventCard,
  verticesOfHex,
  wreckBotGoal,
  wreckCandidates,
  wreckClientView,
  wreckTimeMultiplier
} from '../src/packs/tidebound';
import {
  allEventCards,
  buildTopology,
  createGame,
  dispatch,
  getWildTokens,
  hexDistance,
  makeCtx,
  registryFor,
  tickMarkers
} from '../src/shared';

const on = { dlc: { tidebound: true } };
const wrecksOff = { dlc: { tidebound: true }, addons: { 'tidebound.wrecks': false } };
const dlcOff = { dlc: { tidebound: false } };

/** Builds a disc of radius `outerRadius` where inner radius `<= landRadius` is wood land and the outer rings are water. */
function islandInits(landRadius = 2, outerRadius = 5): { q: number; r: number; type: string; number: number | null }[] {
  const out: { q: number; r: number; type: string; number: number | null }[] = [];
  for (let q = -outerRadius; q <= outerRadius; q++) {
    for (let r = -outerRadius; r <= outerRadius; r++) {
      if (Math.abs(q + r) > outerRadius) continue;
      const dist = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
      const isLand = dist <= landRadius;
      out.push({
        q,
        r,
        type: isLand ? 'wood' : 'water',
        number: isLand ? 6 : null
      });
    }
  }
  return out;
}

function makeGame(rules: Record<string, any> = on, seed = 209, landRadius = 2, outerRadius = 5) {
  const reg = registryFor(allPacks, rules);
  const board = buildTopology(islandInits(landRadius, outerRadius), {
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

function act(g: any, reg: any, playerId: string, type: string, payload: any = {}) {
  return dispatch(g, reg, { playerId, type, payload });
}

describe('Tidebound T9a: Storm event and wreck marker', () => {
  it('registers nothing when Tidebound DLC or tidebound.wrecks addon is off', () => {
    for (const rules of [dlcOff, wrecksOff]) {
      const { g, reg, ctx } = makeGame(rules);
      expect(allEventCards(reg).has(STORM_EVENT_ID)).toBe(false);
      expect(spawnStormWreck(ctx)).toBeNull();
      expect(wreckClientView(g, reg)).toBeNull();
    }
  });

  it('registers tidebound.storm in EVENT_CARDS, spawns a timed wreck marker without touching g.rng, and ticks down over 4 rounds', () => {
    const { g, reg, ctx } = makeGame(on);
    expect(allEventCards(reg).has(STORM_EVENT_ID)).toBe(true);
    expect(stormEventCard.copies).toBe(2);

    const rngBefore = JSON.stringify(g.rng);
    const marker = spawnStormWreck(ctx);
    expect(marker).not.toBeNull();
    expect(JSON.stringify(g.rng)).toBe(rngBefore);

    expect(activeWrecks(g)).toHaveLength(1);
    expect(marker!.kind).toBe('wreck');
    expect(marker!.countdown).toBe(WRECK_COUNTDOWN_ROUNDS);
    expect(WRECK_COUNTDOWN_ROUNDS).toBe(4);

    // Tick 3 rounds: marker still alive with countdown = 1
    for (let i = 0; i < 3; i++) {
      expect(tickMarkers(ctx)).toEqual([]);
    }
    expect(activeWrecks(g)[0].countdown).toBe(1);

    // 4th round end: marker expires and is removed
    const expired = tickMarkers(ctx);
    expect(expired).toHaveLength(1);
    expect(activeWrecks(g)).toHaveLength(0);
  });

  it('spawns a passive storm wreck on round multiples of STORM_CADENCE_ROUNDS when eventsOn is false', () => {
    const { g, reg, ctx } = makeGame(on);
    const rngBefore = JSON.stringify(g.rng);
    expect(STORM_FIRST_ROUND).toBe(3);
    expect(STORM_CADENCE_ROUNDS).toBe(3);

    g.round = 2;
    for (const h of reg.hooks.onRoundStart) h(ctx);
    expect(activeWrecks(g)).toHaveLength(0);

    g.round = 3;
    for (const h of reg.hooks.onRoundStart) h(ctx);
    expect(activeWrecks(g)).toHaveLength(1);
    expect(JSON.stringify(g.rng)).toBe(rngBefore);
  });
});

describe('Tidebound T9b: Sea/shore 65/35 placement, fair spawn within 4 tiles of a player', () => {
  it('picks sea wrecks ~65% of the time and shore wrecks ~35% of the time from the derived RNG stream', () => {
    const { g, reg } = makeGame(on, 301);
    expect(WRECK_SEA_CHANCE).toBe(0.65);
    const rng = deriveWreckRng(777);
    let sea = 0;
    let shore = 0;
    const trials = 400;
    for (let i = 0; i < trials; i++) {
      const picked = pickWreckHex(g, reg, undefined, rng);
      expect(picked).not.toBeNull();
      if (picked!.site === 'sea') {
        sea++;
        expect(isWreckSeaHex(reg, g.board.hexes[picked!.hexId])).toBe(true);
      } else {
        shore++;
        expect(isWreckShoreHex(g, reg, g.board.hexes[picked!.hexId])).toBe(true);
      }
    }
    const seaShare = sea / trials;
    expect(seaShare).toBeGreaterThan(0.57);
    expect(seaShare).toBeLessThan(0.73);
    expect(shore).toBe(trials - sea);
  });

  it('never spawns a wreck more than 4 hexes away from every player, and prefers fair equidistant tiles', () => {
    const { g, reg } = makeGame(on, 404, 2, 7);
    // Place Alice at (-2, 0) and Bob at (2, 0)
    const hexA = g.board.hexes.find(h => h.q === -2 && h.r === 0)!;
    const hexB = g.board.hexes.find(h => h.q === 2 && h.r === 0)!;
    g.board.vertices[hexA.vertexIds[0]].piece = { type: SETTLEMENT, owner: 'a' };
    g.board.vertices[hexB.vertexIds[0]].piece = { type: SETTLEMENT, owner: 'b' };

    for (const site of ['sea', 'shore'] as const) {
      const cands = wreckCandidates(g, reg, site);
      expect(cands.length).toBeGreaterThan(0);
      for (const hId of cands) {
        const minDist = minPlayerDistanceToHex(g, reg, hId);
        expect(minDist).toBeLessThanOrEqual(WRECK_MAX_PLAYER_DIST);
      }
    }

    // Far outer ring hexes (distance 7 from origin -> distance >= 5 from both players) are excluded
    const farHex = g.board.hexes.find(
      h => hexDistance(h, hexA) > WRECK_MAX_PLAYER_DIST && hexDistance(h, hexB) > WRECK_MAX_PLAYER_DIST
    )!;
    expect(farHex).toBeDefined();
    expect(wreckCandidates(g, reg, 'sea')).not.toContain(farHex.id);

    // Picked wreck is reachable within 4 tiles by both players and has a balanced distance spread
    const picked = pickWreckHex(g, reg, 'sea');
    expect(picked).not.toBeNull();
    const dA = playerHexDistance(g, reg, 'a', picked!.hexId);
    const dB = playerHexDistance(g, reg, 'b', picked!.hexId);
    expect(dA).toBeLessThanOrEqual(WRECK_MAX_PLAYER_DIST);
    expect(dB).toBeLessThanOrEqual(WRECK_MAX_PLAYER_DIST);
    expect(Math.abs(dA - dB)).toBeLessThanOrEqual(1);
  });
});

describe('Tidebound T9c: First connecting road, bridge, or port claims the wreck', () => {
  it('claims a shore wreck as soon as a player builds a connecting road to its tile', () => {
    const { g, reg, ctx } = makeGame(on, 501);
    const shoreIds = wreckCandidates(g, reg, 'shore');
    const shoreHexId = shoreIds[0];
    const shoreEdges = edgesOfHex(g, reg, shoreHexId);
    const roadEdge = g.board.edges[shoreEdges[0]];

    // Place Alice's settlement one vertex away from `roadEdge.v1` so she does not touch the wreck yet,
    // then build `bridgeEdge` (connecting `startVert` to `roadEdge.v1`) to reach the shore wreck.
    const startVert = g.board.vertices[roadEdge.v1].adjacentVertices.find(
      vId => !verticesOfHex(g, reg, shoreHexId).includes(vId)
    )!;
    const connectingEdge = g.board.edges.find(
      e => (e.v1 === startVert && e.v2 === roadEdge.v1) || (e.v2 === startVert && e.v1 === roadEdge.v1)
    )!;
    g.board.vertices[startVert].piece = { type: SETTLEMENT, owner: 'a' };

    spawnWreckAt(ctx, shoreHexId, { site: 'shore', resource: 'wheat', baseCards: 2, bonus: null });
    expect(activeWrecks(g)).toHaveLength(1);
    expect(playerTouchesWreck(g, reg, 'a', shoreHexId)).toBe(false);

    const p = g.players[0];
    p.resources = { wood: 1, brick: 1, sheep: 0, wheat: 0, ore: 0 };
    const buildRes = act(g, reg, 'a', 'build', { piece: ROAD, loc: connectingEdge.id });
    expect(buildRes.ok).toBe(true);

    // Wreck is claimed! Paying 1 wood + 1 brick (2 cards) triggers the floor rule (2 + 1 = 3 wheat)
    expect(activeWrecks(g)).toHaveLength(0);
    expect(p.resources.wheat).toBe(3);
  });

  it('claims a sea wreck when a player builds a connecting bridge or rickety bridge', () => {
    const { g, reg, ctx } = makeGame(on, 502);
    // Find an ocean edge (`e.hexIds.length === 0`) that touches a coastal vertex and a sea hex
    const oceanEdge = g.board.edges.find(
      e => e.hexIds.length === 0 && (g.board.vertices[e.v1].hexIds.length > 0 || g.board.vertices[e.v2].hexIds.length > 0)
    )!;
    const coastVid = g.board.vertices[oceanEdge.v1].hexIds.length > 0 ? oceanEdge.v1 : oceanEdge.v2;
    const farVid = oceanEdge.v1 === coastVid ? oceanEdge.v2 : oceanEdge.v1;

    // Find a sea hex that touches `farVid` but NOT `coastVid`
    const seaHex = g.board.hexes.find(
      h =>
        isWreckSeaHex(reg, h) &&
        verticesOfHex(g, reg, h.id).includes(farVid) &&
        !verticesOfHex(g, reg, h.id).includes(coastVid)
    )!;

    g.board.vertices[coastVid].piece = { type: SETTLEMENT, owner: 'a' };
    spawnWreckAt(ctx, seaHex.id, { site: 'sea', resource: 'ore', baseCards: 4, bonus: null });
    expect(activeWrecks(g)).toHaveLength(1);
    expect(playerTouchesWreck(g, reg, 'a', seaHex.id)).toBe(false);

    // Build a rickety bridge (1 wood) across `oceanEdge` to reach `farVid` on `seaHex`
    const p = g.players[0];
    p.resources = { wood: 1, brick: 0, sheep: 0, wheat: 0, ore: 0 };
    const buildRes = act(g, reg, 'a', 'build', { piece: RICKETY, loc: oceanEdge.id });
    expect(buildRes.ok).toBe(true);
    expect(activeWrecks(g)).toHaveLength(0);
    expect(p.resources.ore).toBe(4);
  });

  it('claims a wreck when a player builds on a port touching it, or immediately on spawn if already connected', () => {
    const { g, reg, ctx } = makeGame(on, 503);
    const shoreHexId = wreckCandidates(g, reg, 'shore')[0];
    const vIds = verticesOfHex(g, reg, shoreHexId);
    const portVid = vIds[0];
    g.board.vertices[portVid].port = GENERIC_PORT;
    g.board.vertices[portVid].piece = { type: SETTLEMENT, owner: 'b' };

    const bBefore = g.players[1].resources.sheep || 0;
    const marker = spawnWreckAt(ctx, shoreHexId, { site: 'shore', resource: 'sheep', baseCards: 2, bonus: null });
    expect(marker).not.toBeNull();
    // Paid out immediately at spawn because Bob already holds a port on `shoreHexId`!
    expect(activeWrecks(g)).toHaveLength(0);
    expect(g.players[1].resources.sheep).toBe(bBefore + 2);
  });
});

describe('Tidebound T9d: Loot with floor rule and slow scaling', () => {
  it('scales sea (3-5) and shore (1-2) loot with time up to +40% at 50 turns, +25% with Salvage crew, and enforces the 2x-cost floor rule', () => {
    expect([WRECK_SEA_MIN_CARDS, WRECK_SEA_MAX_CARDS]).toEqual([3, 5]);
    expect([WRECK_SHORE_MIN_CARDS, WRECK_SHORE_MAX_CARDS]).toEqual([1, 2]);

    // Slow time scaling: 1.0 at turn 0, 1.2 at turn 25, 1.4 at turn 50+
    expect(wreckTimeMultiplier(0)).toBeCloseTo(1.0, 5);
    expect(wreckTimeMultiplier(25)).toBeCloseTo(1.2, 5);
    expect(wreckTimeMultiplier(50)).toBeCloseTo(1.4, 5);
    expect(wreckTimeMultiplier(100)).toBeCloseTo(1.4, 5);

    // 5-card sea wreck at turn 50 -> 7 cards; with Salvage crew (+25%) -> 9 cards
    expect(computeWreckLootCount({ baseCards: 5, turnCount: 50 })).toBe(7);
    expect(computeWreckLootCount({ baseCards: 5, turnCount: 50, hasSalvageCrew: true })).toBe(9);

    // Floor rule: a doubled-cost bridge (6 cards) claiming a 3-card wreck always yields 6 + 1 = 7 cards
    expect(computeWreckLootCount({ baseCards: 3, turnCount: 0, builtCostCards: 6 })).toBe(7);
    // Normal bridge (3 cards) claiming a 1-card shore wreck yields 3 + 1 = 4 cards
    expect(computeWreckLootCount({ baseCards: 1, turnCount: 0, builtCostCards: 3 })).toBe(4);
  });

  it('enforces the 2x-cost floor rule when claiming a wreck with an over-cap bridge, and handles a low bank', () => {
    const { g, reg, ctx } = makeGame(on, 601);
    const p = g.players[0];

    // Pick `targetEdge` and `seaHex` first, then place 10 bridges on ocean edges away from `seaHex`
    // so the 11th bridge built on `targetEdge` costs 2x (6 cards: 2 wood, 2 brick, 2 ore) and claims `seaHex`.
    const oceanEdges = g.board.edges.filter(e => e.hexIds.length === 0);
    const targetEdge = oceanEdges.find(
      e => g.board.vertices[e.v1].hexIds.length > 0 || g.board.vertices[e.v2].hexIds.length > 0
    )!;
    const coastVid = g.board.vertices[targetEdge.v1].hexIds.length > 0 ? targetEdge.v1 : targetEdge.v2;
    const farVid = targetEdge.v1 === coastVid ? targetEdge.v2 : targetEdge.v1;
    const seaHex = g.board.hexes.find(
      h =>
        isWreckSeaHex(reg, h) &&
        verticesOfHex(g, reg, h.id).includes(farVid) &&
        !verticesOfHex(g, reg, h.id).includes(coastVid)
    )!;
    const seaHexVerts = new Set(verticesOfHex(g, reg, seaHex.id));
    const otherOceanEdges = oceanEdges.filter(
      e => e.id !== targetEdge.id && !seaHexVerts.has(e.v1) && !seaHexVerts.has(e.v2)
    );
    for (let i = 0; i < 10; i++) {
      otherOceanEdges[i].piece = { type: BRIDGE, owner: 'a' };
    }

    g.board.vertices[coastVid].piece = { type: SETTLEMENT, owner: 'a' };
    spawnWreckAt(ctx, seaHex.id, { site: 'sea', resource: 'wheat', baseCards: 3, bonus: 'fish' });
    expect(activeWrecks(g)).toHaveLength(1);

    // Give Alice exact 2x bridge cost (2 wood, 2 brick, 2 ore = 6 cards)
    p.resources = { wood: 2, brick: 2, ore: 2, wheat: 0, sheep: 0 };
    const buildRes = act(g, reg, 'a', 'build', { piece: BRIDGE, loc: targetEdge.id });
    expect(buildRes.ok).toBe(true);

    // 6 cards paid -> floor rule gives 6 + 1 = 7 wheat + 1 bonus fish token!
    expect(p.resources.wheat).toBe(7);
    expect(getWildTokens(g, 'a', FISH)).toBe(1);

    // Bank-short check: if the bank only has 2 brick left when a 5-card wreck is claimed, it pays the remaining 2 brick
    g.bank.brick = 2;
    const untouchedHexId = wreckCandidates(g, reg, 'sea').find(hId => !playerTouchesWreck(g, reg, 'a', hId))!;
    const devBefore = p.newDevCards.length;
    const m2 = spawnWreckAt(ctx, untouchedHexId, { site: 'sea', resource: 'brick', baseCards: 5, bonus: 'dev' })!;
    const claimed = claimWreck(ctx, m2, 'a', { builtCostCards: 0 });
    expect(claimed?.wantedCards).toBe(5);
    expect(claimed?.amount).toBe(2);
    expect(p.resources.brick).toBe(2);
    expect(p.newDevCards.length).toBe(devBefore + 1);
  });
});

describe('Tidebound T9e: Client view, two spawn animations, and bot salvage goal', () => {
  it('exposes public wreckClientView with shoreDir toward the ocean, renders distinct sea/shore SVG markup, and scores bot salvage goals', () => {
    const { g, reg, ctx } = makeGame(on, 701);
    const seaHexId = wreckCandidates(g, reg, 'sea')[0];
    const shoreHexId = wreckCandidates(g, reg, 'shore')[0];

    spawnWreckAt(ctx, seaHexId, { site: 'sea', resource: 'ore', baseCards: 4 });
    spawnWreckAt(ctx, shoreHexId, { site: 'shore', resource: 'wood', baseCards: 2 });

    const view = wreckClientView(g, reg);
    expect(view).toHaveLength(2);
    const seaItem = view!.find(w => w.hexId === seaHexId)!;
    const shoreItem = view!.find(w => w.hexId === shoreHexId)!;
    expect(seaItem.site).toBe('sea');
    expect(seaItem.shoreDir).toBeNull();
    expect(shoreItem.site).toBe('shore');
    expect(shoreItem.shoreDir).toEqual(shoreSeaDirection(g, reg, shoreHexId));
    expect(shoreItem.shoreDir).not.toBeNull();
    // Secret resource and card count are never leaked in the public client view
    expect(seaItem).not.toHaveProperty('resource');
    expect(seaItem).not.toHaveProperty('baseCards');

    // Distinct sea vs shore SVG markup
    const seaSvg = wreckMarkup('sea', 4);
    const shoreSvg = wreckMarkup('shore', 4);
    expect(seaSvg).toContain('wreck-sea');
    expect(shoreSvg).toContain('wreck-shore');
    expect(seaSvg).not.toBe(shoreSvg);

    // Bot salvage goal: place a settlement + road for Alice next to `shoreHexId` so one road claims it
    const shoreEdges = edgesOfHex(g, reg, shoreHexId);
    const targetEdge = g.board.edges[shoreEdges[0]];
    g.board.vertices[targetEdge.v1].piece = { type: SETTLEMENT, owner: 'a' };
    g.players[0].resources = { wood: 2, brick: 2, sheep: 0, wheat: 0, ore: 0 };

    expect(wreckBotGoal.edgeDelta!(ctx, 'a', targetEdge.id)).toBeGreaterThan(0);
    const goals = wreckBotGoal.goals!(ctx, 'a');
    expect(goals.length).toBeGreaterThan(0);
    expect(goals[0].id).toBe('tidebound.wrecks.salvage');
  });
});
