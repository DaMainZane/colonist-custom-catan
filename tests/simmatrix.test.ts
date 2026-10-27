// MODULE: tests for S0.16 Sim matrix (Service 20) | USED BY: npm test
import { describe, expect, it } from 'vitest';
import { runSimMatrix } from '../src/server/bots/sim';

describe('S0.16 Sim matrix (Service 20)', () => {
  it('runs scenarios x DLC/addon combos x bot tiers with 0 errors and marks botTested', () => {
    const res = runSimMatrix({
      seeds: [11, 22],
      players: 3,
      scenarios: [
        { id: 'standard', picks: ['shape.hex', 'terrain.4p', 'numbers.spiral', 'perks.ports'] },
        { id: 'islands', picks: ['shape.islands', 'terrain.gold', 'numbers.even', 'perks.ports'] }
      ],
      dlcCombos: [
        { id: 'base', dlc: {}, addons: {}, eventsOn: false },
        { id: 'events_on', dlc: {}, addons: {}, eventsOn: true }
      ],
      tierLineups: [['main', 'secondary', 'overload']]
    });

    expect(res.totalGames).toBe(8);
    expect(res.totalFinished).toBe(8);
    expect(res.totalErrors).toEqual([]);
    expect(res.cells.length).toBe(4);
    for (const cell of res.cells) {
      expect(cell.botTested).toBe(true);
      expect(cell.finished).toBe(cell.games);
      expect(cell.avgTurns).toBeGreaterThan(0);
    }
    expect(res.botTestedByCombo.base).toBe(true);
    expect(res.botTestedByCombo.events_on).toBe(true);
  });
});
