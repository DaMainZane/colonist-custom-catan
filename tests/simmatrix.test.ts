// MODULE: tests for S0.16 Sim matrix (Service 20) | USED BY: npm test
import { describe, expect, it } from 'vitest';
import { runSimMatrix } from '../src/server/bots/sim';

describe('S0.16 Sim matrix (Service 20)', () => {
  it('runs scenarios x DLC/addon combos x techTreeOn x bot tiers with 0 errors and marks botTested', () => {
    const res = runSimMatrix({
      seeds: [11, 22],
      players: 3,
      scenarios: [
        { id: 'standard', picks: ['shape.hex', 'terrain.4p', 'numbers.spiral', 'perks.ports'] },
        { id: 'islands', picks: ['shape.islands', 'terrain.gold', 'numbers.even', 'perks.ports'] }
      ],
      dlcCombos: [
        { id: 'base', dlc: {}, addons: {}, eventsOn: false, techTreeOn: false },
        { id: 'events_on', dlc: {}, addons: {}, eventsOn: true, techTreeOn: false },
        { id: 'tech_base', dlc: {}, addons: {}, eventsOn: false, techTreeOn: true, scenarioIds: ['standard'] },
        { id: 'tech_events_on', dlc: {}, addons: {}, eventsOn: true, techTreeOn: true, scenarioIds: ['standard'] }
      ],
      tierLineups: [['main', 'secondary', 'overload']]
    });

    expect(res.totalGames).toBe(12);
    expect(res.totalFinished).toBe(12);
    expect(res.totalErrors).toEqual([]);
    expect(res.cells.length).toBe(6);
    for (const cell of res.cells) {
      expect(cell.botTested).toBe(true);
      expect(cell.finished).toBe(cell.games);
      expect(cell.avgTurns).toBeGreaterThan(0);
    }
    expect(res.cells.filter(c => !c.techTreeOn).length).toBe(4);
    expect(res.cells.filter(c => c.techTreeOn).length).toBe(2);
    expect(res.botTestedByCombo.base).toBe(true);
    expect(res.botTestedByCombo.events_on).toBe(true);
    expect(res.botTestedByCombo.tech_base).toBe(true);
    expect(res.botTestedByCombo.tech_events_on).toBe(true);
  });
});
