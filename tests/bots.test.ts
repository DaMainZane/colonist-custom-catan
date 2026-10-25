import { describe, expect, it } from 'vitest';
import { runLadder, simulateGame } from '../src/server/bots/sim';
import {
  DEFAULT_TIER, TAKEOVER_TIER, TIER_IDS, normalizeTier, personalityOf, spendThreshold, tierFromDifficulty, tierLabel, tierProfile
} from '../src/server/bots/tiers';
import { createLobbyPlayer } from '../src/server/rooms';

describe('bot tiers (data)', () => {
  it('has Main, Secondary and Overload, with Main as the default', () => {
    expect(TIER_IDS).toEqual(['main', 'secondary', 'overload']);
    expect(DEFAULT_TIER).toBe('main');
    expect(tierLabel('overload')).toBe('Overload');
  });

  it('scales up: less noise and blunders, more planning, faster thinking', () => {
    const [m, s, o] = TIER_IDS.map(tierProfile);
    expect(m.placementNoise).toBeGreaterThan(s.placementNoise);
    expect(s.placementNoise).toBeGreaterThan(o.placementNoise);
    expect(m.blunderChance).toBeGreaterThan(s.blunderChance);
    expect(s.blunderChance).toBeGreaterThanOrEqual(o.blunderChance);
    expect(m.lookahead).toBeLessThan(s.lookahead);
    expect(s.lookahead).toBeLessThan(o.lookahead);
    expect(m.thinkDelay).toBeGreaterThan(s.thinkDelay);
    expect(s.thinkDelay).toBeGreaterThan(o.thinkDelay);
    // Only Overload reads hidden information or coordinates.
    expect(m.info).toBe('public');
    expect(o.info).toBe('full');
    expect(m.coordination || s.coordination).toBe(false);
    expect(o.coordination).toBe(true);
  });

  it('parses tier names and treats unknown difficulties as the takeover tier', () => {
    expect(normalizeTier('Overload')).toBe('overload');
    expect(normalizeTier(' main ')).toBe('main');
    expect(normalizeTier('ADVANCED HARD')).toBeNull();
    expect(normalizeTier(undefined)).toBeNull();
    expect(tierFromDifficulty('ADVANCED HARD')).toBe(TAKEOVER_TIER);
    expect(tierFromDifficulty(null)).toBe(TAKEOVER_TIER);
    expect(tierFromDifficulty('Main')).toBe('main');
  });

  it('keeps the spend threshold below the discard limit and scales with it', () => {
    for (const id of TIER_IDS) {
      for (const limit of [3, 7, 20, 50]) {
        const t = spendThreshold(tierProfile(id), limit);
        expect(t).toBeGreaterThanOrEqual(2);
        expect(t).toBeLessThanOrEqual(limit);
      }
    }
    // Main hoards up to the limit, Overload spends well before it.
    expect(spendThreshold(tierProfile('main'), 7)).toBe(7);
    expect(spendThreshold(tierProfile('overload'), 7)).toBeLessThan(spendThreshold(tierProfile('secondary'), 7));
    expect(spendThreshold(tierProfile('overload'), 50)).toBeGreaterThan(spendThreshold(tierProfile('overload'), 20));
  });

  it('gives a bot the same personality every time', () => {
    expect(personalityOf('bot_1')).toBe(personalityOf('bot_1'));
  });

  it('puts the chosen tier on a new lobby bot, and nothing on a human', () => {
    expect(createLobbyPlayer('b1', 'Bot', 1, true, 'overload').difficulty).toBe('Overload');
    expect(createLobbyPlayer('b2', 'Bot', 1, true).difficulty).toBe('Main');
    expect(createLobbyPlayer('h1', 'Human', 0, false).difficulty).toBeNull();
  });
});

describe('bot tiers (play)', () => {
  for (const preset of ['standard', 'goldRush', 'fogIsland', 'archipelago']) {
    it(`${preset}: a mixed table of all three tiers plays to a winner with no rejected actions`, () => {
      for (const seed of [1, 2]) {
        const r = simulateGame({ seed, players: 4, preset, tiers: ['main', 'secondary', 'overload', 'main'] });
        expect(r.error, `seed ${seed}: ${r.error}`).toBeNull();
        expect(r.finished).toBe(true);
        expect(r.winnerTier).not.toBeNull();
      }
    }, 180_000);
  }

  it('every tier alone finishes a 3-player game', () => {
    for (const tier of TIER_IDS) {
      const r = simulateGame({ seed: 5, players: 3, tiers: [tier] });
      expect(r.error, `${tier}: ${r.error}`).toBeNull();
      expect(r.finished).toBe(true);
    }
  }, 180_000);

  it('is deterministic for the same seed and tiers', () => {
    const opts = { seed: 11, players: 3, tiers: ['main', 'secondary', 'overload'] };
    const a = simulateGame(opts);
    const b = simulateGame(opts);
    expect(a.turns).toBe(b.turns);
    expect(a.steps).toBe(b.steps);
    expect(a.winner).toBe(b.winner);
  }, 180_000);

  it('handles odd rules: low win target, big discard limit, tiny bank', () => {
    for (const rules of [
      { vpToWin: 5 },
      { discardLimit: 30, vpToWin: 12 },
      { bankPerResource: 6 }
    ]) {
      const r = simulateGame({ seed: 4, players: 4, rules, tiers: ['main', 'secondary', 'overload'] });
      expect(r.error, `${JSON.stringify(rules)}: ${r.error}`).toBeNull();
      expect(r.finished).toBe(true);
    }
  }, 180_000);

  it('stays fast on a big board', () => {
    const r = simulateGame({
      seed: 8, players: 4, rules: { boardRadius: 8, maxPlayers: 4, vpToWin: 8 }, tiers: ['main', 'secondary', 'overload']
    });
    expect(r.error).toBeNull();
    expect(r.finished).toBe(true);
    // Loose ceiling: the point is to catch a decision that scans the whole board every time.
    expect(r.decisionMs.max).toBeLessThan(5000);
  }, 300_000);

  it('runLadder reports a win for some tier in every finished game', () => {
    const res = runLadder({ seeds: [1, 2, 3, 4, 5, 6], players: 3 });
    expect(res.errors).toEqual([]);
    expect(res.finished).toBe(res.games);
    const wins = res.winsByTier.main + res.winsByTier.secondary + res.winsByTier.overload;
    expect(wins).toBe(res.finished);
  }, 300_000);
});
