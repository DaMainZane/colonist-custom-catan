import { describe, expect, it } from 'vitest';
import { allPacks } from '../src/packs';
import { templatePack } from '../src/packs/_template';
import { LANTERN, LANTERN_COST, LANTERN_LIMIT, lanternAddon } from '../src/packs/_template/lantern';
import { chooseBotAction } from '../src/server/bots/brain';
import {
  auditAddons,
  buildTopology,
  buildVisualManifest,
  createGame,
  dispatch,
  evaluateBotGoals,
  makeCtx,
  mergeViewPlayer,
  registryFor,
  registryVisualProblems,
  score
} from '../src/shared';

// R9 proof: the lantern is one file (`src/packs/_template/lantern.ts`) plus this test. Nothing here imports from server/, client/ or an index file, and the
// shipped packs are untouched. If a line below needs an edit outside the lantern file to pass, that edit is the finding.

const packs = [...allPacks, templatePack];
const on = { dlc: { template: true } };
const lanternOff = { dlc: { template: true }, addons: { 'template.lantern': false } };
const hand = (over: Record<string, number> = {}) => ({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0, ...over });
const SELF = { self: true, over: false, spectator: false };
const OTHER = { self: false, over: false, spectator: false };

function discInits(radius: number): { q: number; r: number; type: string; number: number | null }[] {
  const out: { q: number; r: number; type: string; number: number | null }[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      if (Math.abs(q + r) > radius) continue;
      out.push({ q, r, type: 'wood', number: 6 });
    }
  }
  return out;
}

function makeGame(rules: Record<string, any> = on, seed = 5) {
  const reg = registryFor(packs, rules);
  const board = buildTopology(discInits(2), {
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
  return { g, reg };
}

describe('lantern proof piece (R9)', () => {
  it('is one addon in the template pack, passes the Rule of Two audit, and registers nothing when off', () => {
    expect(templatePack.addons).toContain(lanternAddon);
    expect(auditAddons(packs)).toEqual([]);
    for (const rules of [{}, { dlc: { template: false } }, lanternOff]) {
      const reg = registryFor(packs, rules);
      expect(reg.pieces.has(LANTERN)).toBe(false);
      expect(reg.rules.pieceLimits?.[LANTERN]).toBeUndefined();
      expect(buildVisualManifest(reg).pieces.some(e => e.id === LANTERN)).toBe(false);
    }
  });

  it('puts the lantern in the visual manifest, with safe markup and plain JSON', () => {
    const reg = registryFor(packs, on);
    expect(registryVisualProblems(reg)).toEqual([]);
    const manifest = buildVisualManifest(reg);
    const entry = manifest.pieces.find(e => e.id === LANTERN)!;
    expect(entry).toMatchObject({ kind: 'piece', slot: 'vertex' });
    expect(entry.shape).toContain('{color}');
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
  });

  it('sends pieces[id] to the client through the generic base.pieces_view, with no VIEW_DATA entry of its own', () => {
    const { g, reg } = makeGame(on);
    const alice = g.players[0];
    const edge = g.board.edges[0];
    edge.piece = { type: 'road', owner: 'a' };

    // Broke: the supply and the price are there, no spot is legal.
    alice.resources = hand();
    const broke = mergeViewPlayer(g, reg, alice, SELF);
    expect(broke.pieces[LANTERN]).toMatchObject({ left: LANTERN_LIMIT, cost: LANTERN_COST, spots: [] });

    // Can pay: the corners next to the road light up, in ascending order.
    alice.resources = hand(LANTERN_COST);
    const mine = mergeViewPlayer(g, reg, alice, SELF);
    const spots: number[] = mine.pieces[LANTERN].spots;
    expect(spots).toContain(edge.v1);
    expect(spots).toContain(edge.v2);
    expect([...spots].sort((a, b) => a - b)).toEqual(spots);

    // Another viewer sees the supply, never the spots.
    const seen = mergeViewPlayer(g, reg, alice, OTHER);
    expect(seen.pieces[LANTERN]).toMatchObject({ left: LANTERN_LIMIT, spots: null });

    // Off: the key is not sent at all.
    for (const rules of [{}, lanternOff]) {
      const off = makeGame(rules);
      expect(mergeViewPlayer(off.g, off.reg, off.g.players[0], SELF).pieces).toBeUndefined();
    }
  });

  it('builds with the generic build action, scores 1 VP, and draws nothing from g.rng', () => {
    const { g, reg } = makeGame(on);
    const alice = g.players[0];
    const edge = g.board.edges[0];
    edge.piece = { type: 'road', owner: 'a' };
    const vertexId = edge.v1;

    alice.resources = hand();
    expect(dispatch(g, reg, { playerId: 'a', type: 'build', payload: { piece: LANTERN, loc: vertexId } }).ok).toBe(false);

    alice.resources = hand(LANTERN_COST);
    const before = score(g, reg, alice, true);
    const rngBefore = JSON.stringify(g.rng);
    expect(dispatch(g, reg, { playerId: 'a', type: 'build', payload: { piece: LANTERN, loc: vertexId } }).ok).toBe(true);
    expect(g.board.vertices[vertexId].piece).toEqual({ type: LANTERN, owner: 'a' });
    expect(alice.pieces[LANTERN]).toBe(LANTERN_LIMIT - 1);
    expect(alice.resources.ore).toBe(0);
    expect(score(g, reg, alice, true)).toBe(before + 1);
    expect(JSON.stringify(g.rng)).toBe(rngBefore);

    // The corner is taken now, so it is no longer a spot.
    alice.resources = hand(LANTERN_COST);
    expect(mergeViewPlayer(g, reg, alice, SELF).pieces[LANTERN].spots).not.toContain(vertexId);
  });

  it('is refused away from your own roads', () => {
    const { g, reg } = makeGame(on);
    g.players[0].resources = hand(LANTERN_COST);
    const res = dispatch(g, reg, { playerId: 'a', type: 'build', payload: { piece: LANTERN, loc: 0 } });
    expect(res.ok).toBe(false);
  });

  it('is on a bot goal, and a bot with exactly the price builds it', () => {
    const { g, reg } = makeGame(on);
    const bot = g.players[0];
    bot.isBot = true;
    bot.difficulty = 'main';
    g.board.edges[0].piece = { type: 'road', owner: 'a' };
    bot.resources = hand(LANTERN_COST);

    const goals = evaluateBotGoals(makeCtx(g, reg), 'a', 'main');
    expect(goals.some(it => it.action?.type === 'build' && it.action?.payload?.piece === LANTERN)).toBe(true);

    const act = chooseBotAction(g, reg, 'a');
    expect(act?.type).toBe('build');
    expect(act?.payload?.piece).toBe(LANTERN);
    expect(dispatch(g, reg, { playerId: 'a', type: act!.type, payload: act!.payload }).ok).toBe(true);
  });
});
