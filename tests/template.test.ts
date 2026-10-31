import { describe, expect, it } from 'vitest';
import { allPacks } from '../src/packs';
import { templatePack } from '../src/packs/_template';
import { BEACON, BEACON_COST, BEACON_LIMIT, TIP_BEACON, TIP_COST, beaconSpotsView, beaconsOf } from '../src/packs/_template';
import { auditAddons, buildTopology, createGame, dispatch, legalActions, mergeViewPlayer, registryFor, viewDataEntries } from '../src/shared';

// R5: the template addon is a copyable example, so it must keep working. Nothing here touches the shipped packs.
// Pattern for a real addon's test: `tests/tideboundharbor.test.ts` (makeGame, act) and `tests/addons.test.ts` (off means nothing).

const packs = [...allPacks, templatePack];
const on = { dlc: { template: true } };
const addonOff = { dlc: { template: true }, addons: { 'template.demo': false } };

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

function act(g: any, reg: any, playerId: string, type: string, payload: any = {}) {
  return dispatch(g, reg, { playerId, type, payload });
}

describe('template addon (R5)', () => {
  it('passes the Rule of Two audit, and is not part of the shipped packs', () => {
    expect(auditAddons(packs)).toEqual([]);
    expect(allPacks.some(p => p.id === 'template')).toBe(false);
  });

  it('registers nothing when its DLC or the addon is off', () => {
    for (const rules of [{}, { dlc: { template: false } }, addonOff]) {
      const reg = registryFor(packs, rules);
      expect(reg.pieces.has(BEACON)).toBe(false);
      expect(reg.actions.has(TIP_BEACON)).toBe(false);
      expect(reg.phases.get('main')!.actions).not.toContain(TIP_BEACON);
      expect(reg.rules.pieceLimits?.[BEACON]).toBeUndefined();
    }
  });

  it('registers the piece, the action and the supply when on', () => {
    const { g, reg } = makeGame(on);
    expect(reg.pieces.has(BEACON)).toBe(true);
    expect(reg.actions.has(TIP_BEACON)).toBe(true);
    expect(reg.phases.get('main')!.actions).toContain(TIP_BEACON);
    expect(g.players[0].pieces[BEACON]).toBe(BEACON_LIMIT);
  });

  it('builds a beacon next to your own road, then tips it, with zero g.rng draws', () => {
    const { g, reg } = makeGame(on);
    const p = g.players[0];
    const edge = g.board.edges[0];
    edge.piece = { type: 'road', owner: 'a' };
    const vertexId = edge.v1;

    // Not yet affordable, and not in the legal spots
    p.resources = { wood: 0, brick: 0, ore: 0, wheat: 0, sheep: 0 };
    expect(beaconSpotsView(g, reg, p)).toEqual([]);
    expect(act(g, reg, 'a', 'build', { piece: BEACON, loc: vertexId }).ok).toBe(false);

    p.resources = { ...BEACON_COST, ore: 0, wheat: 1, sheep: 0 };
    expect(beaconSpotsView(g, reg, p)).toContain(vertexId);
    const rngBefore = JSON.stringify(g.rng);
    expect(act(g, reg, 'a', 'build', { piece: BEACON, loc: vertexId }).ok).toBe(true);
    expect(beaconsOf(g, 'a')).toEqual([vertexId]);
    expect(p.pieces[BEACON]).toBe(BEACON_LIMIT - 1);

    expect(legalActions(g, reg, 'a').some(a => a.type === TIP_BEACON)).toBe(true);
    expect(act(g, reg, 'a', TIP_BEACON, { vertexId }).ok).toBe(true);
    expect(p.resources.wheat).toBe(1 - (TIP_COST.wheat || 0));
    expect(JSON.stringify(g.rng)).toBe(rngBefore);
  });

  it('refuses a tip on a vertex that is not your beacon', () => {
    const { g, reg } = makeGame(on);
    g.players[0].resources = { wood: 0, brick: 0, ore: 0, wheat: 2, sheep: 0 };
    const res = act(g, reg, 'a', TIP_BEACON, { vertexId: 0 });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('beacon');
  });

  it('adds its fields to the client state through VIEW_DATA, and nothing with the addon off (R7a.8)', () => {
    const { g, reg } = makeGame(on);
    const alice = g.players[0];
    const edge = g.board.edges[0];
    edge.piece = { type: 'road', owner: 'a' };
    alice.resources = { ...BEACON_COST, ore: 0, wheat: 0, sheep: 0 };

    // Yourself: the supply and the spots. Everyone else: the supply only.
    const mine = mergeViewPlayer(g, reg, alice, { self: true, over: false, spectator: false });
    expect(mine.beaconsLeft).toBe(BEACON_LIMIT);
    expect(mine.beaconSpots).toContain(edge.v1);
    const seen = mergeViewPlayer(g, reg, alice, { self: false, over: false, spectator: false });
    expect(seen.beaconsLeft).toBe(BEACON_LIMIT);
    expect(seen.beaconSpots).toBeUndefined();

    // Off (DLC off, or only this addon off): no entry, no fields.
    for (const rules of [{}, addonOff]) {
      const off = makeGame(rules);
      expect(viewDataEntries(off.reg).some(d => d.id === 'template.demo.view')).toBe(false);
      const view = mergeViewPlayer(off.g, off.reg, off.g.players[0], { self: true, over: false, spectator: false });
      expect(view.beaconsLeft).toBeUndefined();
      expect(view.beaconSpots).toBeUndefined();
    }
  });

  it('sends nothing to the client outside your own main-phase turn', () => {
    const { g, reg } = makeGame(on);
    expect(beaconSpotsView(g, reg, g.players[1])).toBeUndefined();
    const off = makeGame({});
    expect(beaconSpotsView(off.g, off.reg, off.g.players[0])).toBeUndefined();
  });
});
