// MODULE: bot-vs-bot simulator (runs whole games without sockets or timers, checks invariants) | USED BY: tests/sim.test.ts
import { createGame, dispatch } from '../../shared';
import type { GameState } from '../../shared';
import { registry } from '../runtime';
import { chooseBotAction } from './brain';

export interface SimOptions {
  seed: number;
  players?: number;
  preset?: string;
  /** Rule overrides handed to createGame (merged over the registry defaults). */
  rules?: Record<string, any>;
  maxSteps?: number;
  maxTurns?: number;
}

export interface SimResult {
  finished: boolean;
  winner: string | null;
  turns: number;
  steps: number;
  /** First problem found (rejected action, stall, broken invariant), or null. */
  error: string | null;
  game: GameState;
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

  const g = createGame(registry, {
    players: Array.from({ length: n }, (_, i) => ({ id: `bot${i + 1}`, name: `Bot ${i + 1}`, isBot: true })),
    rules: opts.rules,
    seed: opts.seed,
    preset: opts.preset
  });

  let steps = 0;
  const result = (error: string | null): SimResult => ({
    finished: g.phase === 'gameover',
    winner: g.winner ? g.winner.id : null,
    turns: g.turnCount,
    steps,
    error,
    game: g
  });

  while (g.phase !== 'gameover') {
    if (steps >= maxSteps) return result(`no winner after ${steps} steps`);
    if (g.turnCount > maxTurns) return result(`no winner after ${g.turnCount} turns`);

    // Same priority as the live scheduler: whoever's turn it is, then anyone else who owes something.
    const order = [g.players[g.turn], ...g.players.filter((_, i) => i !== g.turn)];
    let acted = false;
    for (const p of order) {
      const move = chooseBotAction(g, registry, p.id, rand);
      if (!move) continue;
      const res = dispatch(g, registry, { type: move.type, playerId: p.id, payload: move.payload });
      if (!res.ok) return result(`${p.id} ${move.type} rejected in phase ${g.phase}: ${res.error}`);
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
