import { describe, expect, it } from 'vitest';
import { simulateGame } from '../src/server/bots/sim';

const PRESETS = ['standard', 'goldRush', 'fogIsland'];

describe('bot-vs-bot games', () => {
  for (const preset of PRESETS) {
    for (const players of [2, 4]) {
      it(`${preset}, ${players} bots: plays to a winner with no rejected actions`, () => {
        for (const seed of [1, 2]) {
          const r = simulateGame({ seed, players, preset });
          expect(r.error, `seed ${seed}: ${r.error}`).toBeNull();
          expect(r.finished).toBe(true);
          expect(r.winner).not.toBeNull();
        }
      }, 120_000);
    }
  }

  it('is deterministic for the same seed', () => {
    const a = simulateGame({ seed: 7, players: 3 });
    const b = simulateGame({ seed: 7, players: 3 });
    expect(a.turns).toBe(b.turns);
    expect(a.steps).toBe(b.steps);
    expect(a.winner).toBe(b.winner);
  }, 120_000);

  it('handles a bigger board with more bots and a lower win target', () => {
    const r = simulateGame({ seed: 3, players: 6, rules: { boardRadius: 4, maxPlayers: 6, vpToWin: 8 } });
    expect(r.error).toBeNull();
    expect(r.finished).toBe(true);
  }, 120_000);
});
