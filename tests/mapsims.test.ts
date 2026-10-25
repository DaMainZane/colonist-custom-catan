import { describe, expect, it } from 'vitest';
import { simulateGame } from '../src/server/bots/sim';

// M5: bots on every map shape. Same checks as the standard sims (no rejected action, no stall, cards conserved), but on
// boards from the recipe generator. Split land (islands, archipelago, satellites) can leave a game without a winner:
// players cannot cross water before ships exist, so "no winner after N turns" is allowed there. Anything else is a bug.

const MAPS: string[][] = [
  [],
  ['continent'],
  ['ring'],
  ['islands'],
  ['archipelago'],
  ['continents'],
  ['continent', 'lake'],
  ['continent', 'river'],
  ['continent', 'satellites', 'ragged'],
  ['continent', 'realistic', 'balanced'],
  ['islands', 'gold', 'feast_famine'],
  ['continent', 'fog', 'clustered']
];

/** Shapes where every player shares one landmass, so a game must finish. */
const WHOLE = new Set(['', 'continent', 'ring', 'continent+lake', 'continent+river', 'continent+realistic+balanced', 'continent+fog+clustered']);

const rules = { boardRadius: 4, maxPlayers: 6, vpToWin: 7 };

describe('bots on generated maps', () => {
  for (const picks of MAPS) {
    const name = picks.join('+') || 'hexagon';
    it(`${name}: no rejected action, stall or broken invariant`, () => {
      for (const seed of [1, 2]) {
        const r = simulateGame({ seed, players: 3, picks, rules, maxTurns: 300, maxSteps: 25000 });
        const unfinished = r.error !== null && /^no winner after/.test(r.error);
        expect(r.error === null || unfinished, `seed ${seed}: ${r.error}`).toBe(true);
        if (WHOLE.has(picks.join('+'))) expect(r.finished, `seed ${seed}: ${r.error}`).toBe(true);
      }
    }, 120_000);
  }

  it('the map comes from the recipe: the same sim seed plays the same game', () => {
    const a = simulateGame({ seed: 5, players: 3, picks: ['continent', 'lake'], rules, maxTurns: 300 });
    const b = simulateGame({ seed: 5, players: 3, picks: ['continent', 'lake'], rules, maxTurns: 300 });
    expect(a.turns).toBe(b.turns);
    expect(a.steps).toBe(b.steps);
    expect(a.winner).toBe(b.winner);
  }, 120_000);

  it('a bigger table on a bigger map still plays', () => {
    const r = simulateGame({ seed: 3, players: 5, picks: ['continent', 'realistic'], rules: { boardRadius: 5, maxPlayers: 6, vpToWin: 7 }, maxTurns: 300 });
    expect(r.error === null || /^no winner after/.test(r.error ?? ''), String(r.error)).toBe(true);
  }, 120_000);
});
