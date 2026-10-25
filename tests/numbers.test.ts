import { describe, expect, it } from 'vitest';
import { REAL_NUMBER_POOL, buildNumberPool, hexDistance } from '../src/shared';
import { newBoard } from '../src/server/lobby';
import { defaultSettings, settingsForPlayers } from '../src/server/runtime';

const sorted = (list: number[]) => [...list].sort((a, b) => a - b);

function numbersOf(board: ReturnType<typeof newBoard>): number[] {
  return board.hexes.filter(h => h.number !== null).map(h => h.number as number);
}

describe('number tokens', () => {
  it('uses exactly the real 18 tokens on the standard board (no extra 2s)', () => {
    for (let i = 0; i < 20; i++) {
      expect(sorted(numbersOf(newBoard(defaultSettings())))).toEqual(sorted(REAL_NUMBER_POOL));
    }
  });

  it('hands out one token per numbered tile at any size', () => {
    for (let n = 0; n <= 300; n++) expect(buildNumberPool(n)).toHaveLength(n);
    expect(sorted(buildNumberPool(18))).toEqual(sorted(REAL_NUMBER_POOL));
  });

  it('keeps 2 and 12 rarer than 3 and 11 on big boards, and never shows a 7', () => {
    for (const n of [36, 60, 90, 216, 1000]) {
      const pool = buildNumberPool(n);
      const count = (x: number) => pool.filter(v => v === x).length;
      expect(pool.includes(7)).toBe(false);
      expect(count(2)).toBeLessThanOrEqual(Math.ceil(n / 18));
      expect(count(12)).toBeLessThanOrEqual(Math.ceil(n / 18));
      expect(count(2)).toBeLessThan(count(3));
      expect(count(12)).toBeLessThan(count(11));
      expect(count(6) + count(8)).toBeGreaterThanOrEqual(Math.floor((n * 4) / 18));
    }
  });

  it('never puts a 6 or 8 next to another 6 or 8', () => {
    for (const preset of ['standard', 'goldRush', 'archipelago']) {
      for (const boardRadius of [2, 3, 4]) {
        for (let i = 0; i < 25; i++) {
          const board = newBoard({ ...defaultSettings(), boardRadius }, preset);
          const hot = board.hexes.filter(h => h.number === 6 || h.number === 8);
          for (const a of hot) {
            for (const b of hot) {
              if (a.id < b.id) expect(hexDistance(a, b), `${preset} r${boardRadius}`).toBeGreaterThan(1);
            }
          }
        }
      }
    }
  });
});

describe('8-player tables', () => {
  it('starts lobbies at 8 seats', () => {
    expect(defaultSettings().maxPlayers).toBe(8);
  });

  it('grows the bank and dev deck with the real player count, unless the host changed them', () => {
    const base = defaultSettings();
    expect(settingsForPlayers(base, 4)).toEqual(base);
    expect(settingsForPlayers(base, 5).bankResourcePerType).toBe(24);
    expect(settingsForPlayers(base, 8).bankResourcePerType).toBe(30);
    const custom = { ...base, bankResourcePerType: 50 };
    expect(settingsForPlayers(custom, 8)).toEqual(custom);
  });
});
