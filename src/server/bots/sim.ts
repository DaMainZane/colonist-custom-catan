// MODULE: bot-vs-bot simulator (runs whole games without sockets or timers, checks invariants, tier ladder and map matrix) | USED BY: tests/sim.test.ts, tests/bots.test.ts
import { createGame, dispatch, generateMap, mergeRules } from '../../shared';
import type { GameState } from '../../shared';
import { registry } from '../runtime';
import { chooseBotAction, noteBotEvents } from './brain';
import { TIER_IDS, normalizeTier, tierFromDifficulty, tierLabel } from './tiers';
import type { TierId } from './tiers';
import { captureTrainingSnapshot, commitTrainingStep, finalizeTrainingLog, initGameTrainingLog } from './trainingLog';
import type { GameTrainingTrajectory } from './trainingLog';

export interface SimOptions {
  seed: number;
  players?: number;
  preset?: string;
  /** Map menu picks (shape, terrain and number styles, perks). When set, the board comes from `generateMap` instead of the legacy preset. */
  picks?: string[];
  /** Map params for `picks` (land, islands.count, ...). */
  mapParams?: Record<string, number>;
  /** Rule overrides handed to createGame (merged over the registry defaults). */
  rules?: Record<string, any>;
  maxSteps?: number;
  maxTurns?: number;
  /** Tier per seat, repeated if shorter than the table. Default: every bot is Secondary (the old Hard bot). */
  tiers?: (TierId | string)[];
  /** Record a full AI training trajectory (state features, legal counts, actions, outcome rewards) for this simulated game. */
  recordTrainingLog?: boolean;
}

export interface SimResult {
  finished: boolean;
  winner: string | null;
  winnerTier: TierId | null;
  turns: number;
  steps: number;
  /** First problem found (rejected action, stall, broken invariant), or null. */
  error: string | null;
  /** Time spent choosing actions (ms): total, the slowest single decision, and how many were made. */
  decisionMs: { total: number; max: number; count: number };
  game: GameState;
  trainingLog?: GameTrainingTrajectory;
}

/** Small seeded PRNG so a (seed, options) pair always plays out the same way. */
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cards are never created or destroyed: bank + hands = the starting bank, per resource. */
export function checkInvariants(g: GameState): string | null {
  for (const r of Object.keys(g.bank)) {
    const total = g.bank[r] + g.players.reduce((s, p) => s + (p.resources[r] || 0), 0);
    if (total !== g.rules.bankPerResource) return `${r} not conserved: ${total} (expected ${g.rules.bankPerResource})`;
    if (g.bank[r] < 0 || g.players.some(p => (p.resources[r] || 0) < 0)) return `${r} went negative`;
  }
  return null;
}

export function simulateGame(opts: SimOptions): SimResult {
  const n = opts.players ?? 4;
  const maxSteps = opts.maxSteps ?? 60000;
  const maxTurns = opts.maxTurns ?? 1000;
  const rand = mulberry32(opts.seed);
  const tiers = opts.tiers && opts.tiers.length > 0 ? opts.tiers : ['secondary'];

  // A recipe-built board (the lobby path), so the bots can be run on every shape. The seed text is derived from the sim seed.
  const mergedRules = mergeRules(registry.rules, opts.rules ?? {});
  const board = opts.picks
    ? generateMap(registry, mergedRules, { seed: `SIM${opts.seed}`, picks: opts.picks, params: opts.mapParams, radius: mergedRules.boardRadius }).board
    : undefined;

  const g = createGame(registry, {
    players: Array.from({ length: n }, (_, i) => ({
      id: `bot${i + 1}`,
      name: `Bot ${i + 1}`,
      isBot: true,
      difficulty: tierLabel(normalizeTier(tiers[i % tiers.length]) ?? 'secondary')
    })),
    rules: opts.rules,
    seed: opts.seed,
    preset: opts.preset,
    board
  });

  const simCode = `SIM_${opts.seed}`;
  const traj = opts.recordTrainingLog ? initGameTrainingLog(g, registry, simCode) : undefined;

  let steps = 0;
  const timing = { total: 0, max: 0, count: 0 };
  const result = (error: string | null): SimResult => {
    if (traj && !traj.outcome) finalizeTrainingLog(g, registry, traj);
    return {
      finished: g.phase === 'gameover',
      winner: g.winner ? g.winner.id : null,
      winnerTier: g.winner ? tierFromDifficulty(g.players.find(p => p.id === g.winner!.id)?.difficulty) : null,
      turns: g.turnCount,
      steps,
      error,
      decisionMs: timing,
      game: g,
      ...(traj ? { trainingLog: traj } : {})
    };
  };

  while (g.phase !== 'gameover') {
    if (steps >= maxSteps) return result(`no winner after ${steps} steps`);
    if (g.turnCount > maxTurns) return result(`no winner after ${g.turnCount} turns`);

    // Same priority as the live scheduler: whoever's turn it is, then anyone else who owes something.
    const order = [g.players[g.turn], ...g.players.filter((_, i) => i !== g.turn)];
    let acted = false;
    for (const p of order) {
      const t0 = performance.now();
      const move = chooseBotAction(g, registry, p.id, rand);
      const ms = performance.now() - t0;
      timing.total += ms;
      timing.count++;
      if (ms > timing.max) timing.max = ms;
      if (!move) continue;
      const snap = traj ? captureTrainingSnapshot(g, registry, p.id) : null;
      const res = dispatch(g, registry, { type: move.type, playerId: p.id, payload: move.payload });
      if (!res.ok) return result(`${p.id} ${move.type} rejected in phase ${g.phase}: ${res.error}`);
      if (traj) commitTrainingStep(g, registry, simCode, snap, move.type, move.payload, res.events);
      noteBotEvents(g, res.events);
      acted = true;
      steps++;
      break;
    }
    if (!acted) return result(`stalled in phase ${g.phase} on turn ${g.turnCount}`);

    const broken = checkInvariants(g);
    if (broken) return result(broken);
  }
  return result(null);
}

// ---- Tier ladder and map matrix ----------------------------------------------------------------------

export interface LadderOptions {
  seeds: number[];
  players?: number;
  preset?: string;
  rules?: Record<string, any>;
  /** Tiers at the table, rotated between seeds so no tier always sits in the same seat. Default: all three. */
  tiers?: TierId[];
  maxTurns?: number;
}

export interface LadderResult {
  games: number;
  finished: number;
  errors: string[];
  winsByTier: Record<TierId, number>;
  /** Wins per game seated at the table, per tier (what the tuning targets compare). */
  winRateByTier: Record<TierId, number>;
  avgTurns: number;
  avgDecisionMs: number;
  maxDecisionMs: number;
}

/** Plays the same table many times with the tiers rotated between seats, and reports who wins. */
export function runLadder(opts: LadderOptions): LadderResult {
  const tiers = opts.tiers && opts.tiers.length > 0 ? opts.tiers : TIER_IDS;
  const players = opts.players ?? Math.max(tiers.length, 3);
  const winsByTier: Record<TierId, number> = { main: 0, secondary: 0, overload: 0 };
  const seated: Record<TierId, number> = { main: 0, secondary: 0, overload: 0 };
  const errors: string[] = [];
  let finished = 0;
  let turns = 0;
  let ms = 0;
  let decisions = 0;
  let maxMs = 0;

  opts.seeds.forEach((seed, k) => {
    const seats = Array.from({ length: players }, (_, i) => tiers[(i + k) % tiers.length]);
    for (const t of seats) seated[t]++;
    const r = simulateGame({ seed, players, preset: opts.preset, rules: opts.rules, tiers: seats, maxTurns: opts.maxTurns });
    turns += r.turns;
    ms += r.decisionMs.total;
    decisions += r.decisionMs.count;
    maxMs = Math.max(maxMs, r.decisionMs.max);
    if (r.error) errors.push(`seed ${seed}: ${r.error}`);
    if (r.finished && r.winnerTier) { finished++; winsByTier[r.winnerTier]++; }
  });

  const winRateByTier = { main: 0, secondary: 0, overload: 0 } as Record<TierId, number>;
  for (const t of TIER_IDS) winRateByTier[t] = seated[t] > 0 ? winsByTier[t] / seated[t] : 0;
  const games = opts.seeds.length;
  return {
    games,
    finished,
    errors,
    winsByTier,
    winRateByTier,
    avgTurns: games > 0 ? turns / games : 0,
    avgDecisionMs: decisions > 0 ? ms / decisions : 0,
    maxDecisionMs: maxMs
  };
}
