import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { simulateGame } from '../src/server/bots/sim';
import type { SimOptions } from '../src/server/bots/sim';

/**
 * S0.0 golden baseline. Seeded bot-vs-bot games are hashed (final state, log, counts) and compared with
 * tests/golden.snapshot.json. Every Stage 0 refactor must keep this green: it is what "the base game plays unchanged" means.
 *
 *  - First run (no snapshot file): records the snapshot and passes. Commit the file.
 *  - After an intended behavior change: run with UPDATE_GOLDEN=1 to re-record, and say why in the commit.
 */
const CASES: Record<string, SimOptions> = {
  'standard-4p-s11': { seed: 11, players: 4, preset: 'standard' },
  'standard-2p-s12': { seed: 12, players: 2, preset: 'standard' },
  'goldRush-3p-s21': { seed: 21, players: 3, preset: 'goldRush' },
  'fogIsland-3p-s31': { seed: 31, players: 3, preset: 'fogIsland' },
  'big-6p-s41': { seed: 41, players: 6, rules: { boardRadius: 4, maxPlayers: 6, vpToWin: 8 } }
};

const FILE = join(__dirname, 'golden.snapshot.json');
const sha = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);

/** Fields that later services add to the state. They are left out of the hash so a new service does not break the baseline; what they change in play still does.
 *  `packs` is the list of loaded pack ids: a new DLC pack (even with the DLC off) changes it, but not how the game plays (log, steps and turns stay hashed).
 *  `version` is the state schema marker (2 since T1a, when port upgrades got a `level`): a bump says the saved shape changed, not that play did. */
const ADDED_FIELDS = ['round', 'packs', 'version'];
function stateHash(g: any): string {
  const copy: any = { ...g };
  for (const k of ADDED_FIELDS) delete copy[k];
  if (copy.ext) { copy.ext = { ...copy.ext }; delete copy.ext.core; }
  return sha(copy);
}

function fingerprint(opts: SimOptions) {
  const r = simulateGame(opts);
  return {
    finished: r.finished,
    error: r.error,
    winner: r.winner,
    turns: r.turns,
    steps: r.steps,
    state: stateHash(r.game),
    log: sha(r.game.log)
  };
}

describe('golden baseline (seeded bot-vs-bot)', () => {
  const update = process.env.UPDATE_GOLDEN === '1';
  const stored: Record<string, ReturnType<typeof fingerprint>> = existsSync(FILE) && !update ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
  const recorded: Record<string, ReturnType<typeof fingerprint>> = {};

  for (const [name, opts] of Object.entries(CASES)) {
    it(name, () => {
      const fp = fingerprint(opts);
      expect(fp.error, `${name}: ${fp.error}`).toBeNull();
      expect(fp.finished).toBe(true);
      recorded[name] = fp;
      if (stored[name]) expect(fp).toEqual(stored[name]);
    }, 120_000);
  }

  it('writes the snapshot when it is missing or being updated', () => {
    const missing = Object.keys(CASES).filter(n => !stored[n]);
    if (missing.length === 0) return;
    writeFileSync(FILE, JSON.stringify({ ...stored, ...recorded }, null, 2) + '\n');
    console.warn(`golden: recorded ${missing.join(', ')} in tests/golden.snapshot.json. Commit it.`);
  });
});
