// Golden baseline: seeded bot-vs-bot games are played to the end and fingerprinted. Every Stage 0 refactor
// (Development Plan.md) must leave these fingerprints unchanged: "the base game plays unchanged".
//
//   npx vitest run tests/golden.test.ts        compare against tests/golden/*.json (a missing file is written on first run)
//   npx vitest run tests/golden.test.ts -u     accept new fingerprints (only when a behavior change is intended)
//
// Three hashes per game, so a failure says what moved:
//   state  gameplay state: board pieces, hands, bank, deck, dice, turn, phase, RNG state, base-pack ext
//   stats  per-player stat counters (event bookkeeping)
//   log    the text log (cosmetic wording)
// state differing means behavior changed (or a stray RNG draw). stats or log alone means bookkeeping or wording changed.
// Not hashed on purpose: rules, version, packs, ext of other packs, hex pixel coordinates. New services may add those.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { simulateGame } from '../src/server/bots/sim';
import type { SimOptions } from '../src/server/bots/sim';
import { registry } from '../src/server/runtime';
import { computeVP } from '../src/shared';
import type { GameState } from '../src/shared';

interface Scenario { name: string; opts: SimOptions }

const SCENARIOS: Scenario[] = [
  { name: 'standard-4p-s1', opts: { seed: 1, players: 4, preset: 'standard' } },
  { name: 'standard-4p-s2', opts: { seed: 2, players: 4, preset: 'standard' } },
  { name: 'standard-2p-s3', opts: { seed: 3, players: 2, preset: 'standard' } },
  { name: 'goldRush-4p-s1', opts: { seed: 1, players: 4, preset: 'goldRush' } },
  { name: 'fogIsland-3p-s2', opts: { seed: 2, players: 3, preset: 'fogIsland' } },
  { name: 'tiers-mixed-3p-s11', opts: { seed: 11, players: 3, preset: 'standard', tiers: ['main', 'secondary', 'overload'] } },
  { name: 'big-6p-radius4-vp8-s3', opts: { seed: 3, players: 6, rules: { boardRadius: 4, maxPlayers: 6, vpToWin: 8 } } },
  { name: 'vp15-piece-scaling-4p-s4', opts: { seed: 4, players: 4, rules: { vpToWin: 15 } } },
  { name: 'discard4-sevens-4p-s8', opts: { seed: 8, players: 4, rules: { discardLimit: 4 } } },
  { name: 'map-ring-fog-4p-s5', opts: { seed: 5, players: 4, picks: ['ring', 'fog'] } },
  { name: 'map-continents-4p-s6', opts: { seed: 6, players: 4, picks: ['continents'] } }
];

/** JSON with sorted object keys, so key order never changes a hash. */
function canon(v: any): string {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  const keys = Object.keys(v).filter(k => v[k] !== undefined).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
}

function sha(v: any): string {
  return createHash('sha256').update(canon(v)).digest('hex').slice(0, 16);
}

function stateProjection(g: GameState) {
  return {
    seed: g.seed,
    rng: g.rng,
    phase: g.phase,
    phaseStack: g.phaseStack,
    turn: g.turn,
    turnCount: g.turnCount,
    setup: g.setup,
    dice: g.dice,
    diceStats: g.diceStats,
    awards: g.awards,
    winner: g.winner,
    bank: g.bank,
    deck: g.deck,
    trades: g.trades,
    extBase: g.ext?.base ?? null,
    players: g.players.map(p => ({
      id: p.id,
      resources: p.resources,
      devCards: p.devCards,
      newDevCards: p.newDevCards,
      pieces: p.pieces,
      pending: p.pending,
      flags: p.flags
    })),
    board: {
      robberHexId: g.board.robberHexId,
      hexes: g.board.hexes.map(h => ({ id: h.id, type: h.type, number: h.number, ext: h.ext })),
      vertices: g.board.vertices.map(v => ({ id: v.id, port: v.port, piece: v.piece })),
      edges: g.board.edges.map(e => ({ id: e.id, port: e.port, piece: e.piece }))
    }
  };
}

function fingerprint(sc: Scenario) {
  const r = simulateGame(sc.opts);
  const g = r.game;
  return {
    game: g,
    result: { error: r.error, finished: r.finished, winner: r.winner, turns: r.turns, steps: r.steps },
    fingerprint: {
      state: sha(stateProjection(g)),
      stats: sha(g.players.map(p => ({ id: p.id, stats: p.stats }))),
      log: sha(g.log)
    }
  };
}

describe('golden baseline (bot-vs-bot, seeded)', () => {
  it('same options give the same fingerprint twice in one process', () => {
    const a = fingerprint(SCENARIOS[0]);
    const b = fingerprint(SCENARIOS[0]);
    expect(b).toEqual(a);
  }, 120_000);

  for (const sc of SCENARIOS) {
    it(sc.name, async () => {
      const fp = fingerprint(sc);
      expect(fp.result.error, `${sc.name}: ${fp.result.error}`).toBeNull();
      expect(fp.result.finished).toBe(true);

      // Readable summary next to the hashes, so a diff shows who won and how long it took.
      const g = fp.game;
      const summary = {
        scenario: sc.name,
        options: sc.opts,
        result: fp.result,
        finalVP: Object.fromEntries(g.players.map(p => [p.id, computeVP(g, registry, p, true)])),
        diceStats: g.diceStats,
        fingerprint: fp.fingerprint
      };
      await expect(JSON.stringify(summary, null, 2) + '\n').toMatchFileSnapshot(`./golden/${sc.name}.json`);
    }, 240_000);
  }
});
