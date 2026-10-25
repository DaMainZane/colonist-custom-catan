import { describe, expect, it } from 'vitest';
import { generateMap } from '../src/shared';
import { defaultSettings, fullRules, registry } from '../src/server/runtime';

// M5: time budget (design section 11): radius 8 or below within about 20 ms, radius 20 within about 100 ms.
// Machines differ, so the asserts are about 2.5 times the slowest median seen (r8 hexagon ~24 ms, r20 hexagon ~117 ms)
// and catch only a real regression. The numbers are printed: read them against the targets.

const rules = (r: number) => ({ ...fullRules(defaultSettings()), boardRadius: r });
const RECIPES: string[][] = [[], ['continent'], ['continent', 'realistic', 'balanced'], ['islands'], ['continents', 'lake']];

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function time(picks: string[], radius: number, runs: number): { median: number; max: number; attempts: number } {
  const ms: number[] = [];
  let attempts = 0;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    const m = generateMap(registry, rules(radius), { seed: `BUDGET${i}`, radius, picks });
    ms.push(performance.now() - t0);
    attempts = Math.max(attempts, m.report.stats.boardAttempts ?? 1);
  }
  return { median: median(ms), max: Math.max(...ms), attempts };
}

describe('generation budget', () => {
  it('radius 8 and below', () => {
    const rows: string[] = [];
    for (const radius of [4, 8]) {
      for (const picks of RECIPES) {
        const t = time(picks, radius, 7);
        rows.push(`r${radius} ${(picks.join('+') || 'hexagon').padEnd(28)} median ${t.median.toFixed(1)} ms, max ${t.max.toFixed(1)} ms, most board attempts ${t.attempts}`);
        expect(t.median, rows[rows.length - 1]).toBeLessThan(60);
        expect(t.attempts, rows[rows.length - 1]).toBeLessThanOrEqual(3);
      }
    }
    console.log(`\nMap generation budget (target: radius 8 within about 20 ms)\n${rows.join('\n')}`);
  }, 120_000);

  it('radius 20', () => {
    const rows: string[] = [];
    for (const picks of RECIPES) {
      const t = time(picks, 20, 3);
      rows.push(`r20 ${(picks.join('+') || 'hexagon').padEnd(28)} median ${t.median.toFixed(1)} ms, max ${t.max.toFixed(1)} ms, most board attempts ${t.attempts}`);
      expect(t.median, rows[rows.length - 1]).toBeLessThan(300);
      expect(t.attempts, rows[rows.length - 1]).toBeLessThanOrEqual(3);
    }
    console.log(`\nMap generation budget (target: radius 20 within about 100 ms)\n${rows.join('\n')}`);
  }, 120_000);
});
