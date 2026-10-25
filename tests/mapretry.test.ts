import { describe, expect, it } from 'vitest';
import { boardAttempts, generateMap, validateBoard } from '../src/shared';
import type { Board, Hex } from '../src/shared';
import { defaultSettings, fullRules, registry } from '../src/server/runtime';

// M5, step 1: the board loop. The shape is chosen once; the token layout is redrawn until the checks pass (no errors,
// no low-fairness warning); if none passes, the best attempt is kept and the report says `degraded`. It never throws.

const rules = () => fullRules(defaultSettings());
const make = (picks: string[], radius: number, seed: string, r = rules()) => generateMap(registry, r, { seed, radius, picks });
const seeds = (n: number) => Array.from({ length: n }, (_, i) => `R${i + 1}`);
const sig = (b: Board) => b.hexes.map((h: Hex) => `${h.q},${h.r}:${h.type}:${h.number}:${h.ext.hidden ? 1 : 0}`).join('|');
const lowFairness = (m: ReturnType<typeof make>) => m.report.warnings.some(w => w.code === 'low-fairness');

describe('boardAttempts', () => {
  it('is 12 up to radius 20 and shrinks for big boards', () => {
    expect(boardAttempts(2)).toBe(12);
    expect(boardAttempts(20)).toBe(12);
    expect(boardAttempts(21)).toBeLessThan(12);
    expect(boardAttempts(50)).toBeLessThan(boardAttempts(21));
    expect(boardAttempts(50)).toBeGreaterThanOrEqual(1);
  });
});

describe('the board loop', () => {
  it('reports how many attempts it ran, within the limit', () => {
    for (const radius of [2, 3, 4]) {
      for (const seed of seeds(10)) {
        const m = make([], radius, seed);
        const n = m.report.stats.boardAttempts;
        expect(n, `r${radius} ${seed}`).toBeGreaterThanOrEqual(1);
        expect(n, `r${radius} ${seed}`).toBeLessThanOrEqual(boardAttempts(radius));
      }
    }
  });

  it('a board that passes is not degraded; a degraded one really failed a check', () => {
    for (const radius of [2, 3, 4]) {
      for (const seed of seeds(10)) {
        const m = make([], radius, seed);
        if (m.report.degraded) expect(m.report.errors.length > 0 || lowFairness(m), `r${radius} ${seed}`).toBe(true);
        else {
          expect(m.report.errors, `r${radius} ${seed}`).toEqual([]);
          expect(lowFairness(m), `r${radius} ${seed}`).toBe(false);
        }
      }
    }
  });

  it('is deterministic, attempts and report included', () => {
    for (const picks of [[], ['continent'], ['islands'], ['continent', 'balanced']]) {
      const a = make(picks, 4, 'LOOP');
      const b = make(picks, 4, 'LOOP');
      expect(sig(a.board), picks.join('+')).toBe(sig(b.board));
      expect(a.report, picks.join('+')).toEqual(b.report);
    }
  });

  it('never throws and keeps the land count over shapes, styles and radii', () => {
    const shapes = [...registry.mapShapes.keys()];
    for (const shape of shapes) {
      for (const terrain of ['random', 'realistic']) {
        for (const numbers of ['standard', 'balanced']) {
          for (const radius of [3, 6]) {
            for (const seed of seeds(2)) {
              const picks = [shape, terrain, numbers];
              const label = `${picks.join('+')} r${radius} ${seed}`;
              const m = make(picks, radius, seed);
              expect(m.board.hexes.filter(h => registry.tiles.get(h.type)?.land).length, label).toBe(m.report.stats.land);
              expect(m.report.stats.boardAttempts, label).toBeLessThanOrEqual(boardAttempts(radius));
              if (m.report.degraded) expect(m.report.errors.length > 0 || lowFairness(m), label).toBe(true);
            }
          }
        }
      }
    }
  });
});

describe('when no attempt can pass', () => {
  // Radius 3 with 35 wood and one desert: four resources have no tile at all, which no redraw can fix.
  const wood = () => {
    const r = rules();
    return { ...r, tileCounts: { ...r.tileCounts, desert: 1, wood: 35 } };
  };

  it('runs every attempt, keeps the best one and marks it degraded instead of throwing', () => {
    const m = make([], 3, 'NOWAY', wood());
    expect(m.report.degraded).toBe(true);
    expect(m.report.errors.some(e => e.code === 'resource-missing')).toBe(true);
    expect(m.report.stats.boardAttempts).toBe(boardAttempts(3));
    expect(m.board.hexes.length).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    const a = make([], 3, 'NOWAY', wood());
    const b = make([], 3, 'NOWAY', wood());
    expect(sig(a.board)).toBe(sig(b.board));
    expect(a.report).toEqual(b.report);
  });

  it('a shape error ends the loop at once (more token layouts cannot help)', () => {
    // Radius 1 is 7 land tiles: too few usable spots for the baseline, whatever the tokens.
    const m = make([], 1, 'TINY');
    if (m.report.errors.some(e => e.code === 'too-few-spots')) {
      expect(m.report.degraded).toBe(true);
      expect(m.report.stats.boardAttempts).toBe(1);
    }
  });
});

describe('what a retry keeps', () => {
  it('the land set and the tile counts are the same whatever the number style needs', () => {
    const landKeys = (b: Board) => b.hexes.filter(h => registry.tiles.get(h.type)?.land).map(h => `${h.q},${h.r}`).join('|');
    const types = (b: Board) => b.hexes.map(h => h.type).join('|');
    for (const picks of [[], ['continent'], ['islands'], ['continent', 'lake']]) {
      for (const seed of seeds(5)) {
        const plain = make(picks, 5, seed);
        for (const style of ['feast_famine', 'balanced']) {
          const styled = make([...picks, style], 5, seed);
          const label = `${style} ${picks.join('+')} ${seed}`;
          expect(landKeys(styled.board), label).toBe(landKeys(plain.board));
          expect(types(styled.board), label).toBe(types(plain.board));
        }
      }
    }
  });
});

describe('rule flags in the check', () => {
  it('shapes that must stay whole say so, styles that unbalance on purpose switch the balance warning off', () => {
    for (const id of ['hexagon', 'continent', 'ring']) expect(registry.mapShapes.get(id)?.ruleOverrides?.requireConnected, id).toBe(true);
    for (const id of ['islands', 'archipelago', 'continents', 'satellites']) expect(registry.mapShapes.get(id)?.ruleOverrides?.requireConnected, id).toBeUndefined();
    expect(registry.mapShapes.get('ragged')?.ruleOverrides?.thinLand).toBeGreaterThan(0.25);
    for (const id of ['balanced', 'feast_famine']) expect(registry.mapNumberings.get(id)?.ruleOverrides?.balanceCheck, id).toBe(false);
    expect(registry.mapNumberings.get('standard')?.ruleOverrides?.balanceCheck).toBeUndefined();
  });

  it('connected shapes come out in one piece, with no not-connected error', () => {
    for (const shape of ['hexagon', 'continent', 'ring']) {
      for (const radius of [3, 4, 6]) {
        for (const seed of seeds(5)) {
          const m = make([shape], radius, seed);
          const label = `${shape} r${radius} ${seed}`;
          expect(m.report.stats.landmasses.length, label).toBe(1);
          expect(m.report.errors.some(e => e.code === 'not-connected'), label).toBe(false);
        }
      }
    }
  });

  it('satellites sit on a continent without tripping the connected check', () => {
    let split = 0;
    for (const seed of seeds(10)) {
      const m = make(['continent', 'satellites'], 6, seed);
      expect(m.report.errors.some(e => e.code === 'not-connected'), seed).toBe(false);
      if (m.report.stats.landmasses.length > 1) split++;
    }
    expect(split).toBeGreaterThan(0);
  });

  it('validateBoard reports split land as an error only when asked to', () => {
    for (const seed of seeds(5)) {
      const m = make(['islands'], 6, seed);
      const asked = validateBoard(m.board, registry, { requireConnected: true });
      const plain = validateBoard(m.board, registry);
      expect(asked.errors.some(e => e.code === 'not-connected'), seed).toBe(m.report.stats.landmasses.length > 1);
      expect(plain.errors.some(e => e.code === 'not-connected'), seed).toBe(false);
    }
  });

  it('warns about an island with a single resource', () => {
    const r = rules();
    // The count is clamped to the land, so every tile but the desert is wood and an island without the desert is all wood.
    const onlyWood = { ...r, tileCounts: { ...r.tileCounts, desert: 1, wood: 200 } };
    let checked = 0;
    for (const seed of seeds(5)) {
      const m = make(['islands'], 5, seed, onlyWood);
      if (m.report.stats.landmasses.length < 2) continue;
      checked++;
      expect(m.report.warnings.some(w => w.code === 'one-resource-island'), seed).toBe(true);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('the weak-resource warning is off for balanced and feast or famine', () => {
    for (const style of ['balanced', 'feast_famine']) {
      for (const seed of seeds(10)) {
        const m = make(['continent', style], 5, seed);
        expect(m.report.warnings.some(w => w.code === 'weak-resource'), `${style} ${seed}`).toBe(false);
      }
    }
  });
});
