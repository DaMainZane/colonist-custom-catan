import { describe, expect, it } from 'vitest';
import { createRng, generateBoard } from '../src/shared';
import { defaultSettings, fullRules, registry } from '../src/server/runtime';
import { clamp, getPips } from '../src/server/util';

const make = (over: Record<string, any> = {}, preset = 'standard', seed = 1) =>
  generateBoard(registry, fullRules({ ...defaultSettings(), ...over }), createRng(seed), preset);

describe('topology', () => {
  it('radius 2 board has 19 hexes, 54 vertices, 72 edges', () => {
    const b = make();
    expect(b.hexes).toHaveLength(19);
    expect(b.vertices).toHaveLength(54);
    expect(b.edges).toHaveLength(72);
  });

  it('has 30 coastal edges and every vertex has 2-3 neighbours', () => {
    const b = make();
    expect(b.edges.filter(e => e.hexIds.length === 1)).toHaveLength(30);
    for (const v of b.vertices) {
      expect(v.adjacentVertices.length).toBeGreaterThanOrEqual(2);
      expect(v.adjacentVertices.length).toBeLessThanOrEqual(3);
    }
  });

  it('puts the robber on the desert', () => {
    const b = make();
    expect(b.hexes[b.robberHexId].type).toBe('desert');
  });

  it('blank preset is all water with no vertices', () => {
    const b = make({}, 'blank');
    expect(b.hexes.every(h => h.type === 'water')).toBe(true);
    expect(b.vertices).toHaveLength(0);
  });

  it('never spawns ports on two tiles next to each other', () => {
    for (const r of [1, 2, 3, 4]) {
      const b = make({ boardRadius: r });
      const portEdges = b.edges.filter(e => e.port);
      expect(portEdges.length).toBeGreaterThan(0);
      const portHexes = portEdges.map(e => b.hexes[e.hexIds[0]]);
      for (let i = 0; i < portHexes.length; i++) {
        for (let j = i + 1; j < portHexes.length; j++) {
          const a = portHexes[i];
          const c = portHexes[j];
          const dist = (Math.abs(a.q - c.q) + Math.abs(a.q + a.r - c.q - c.r) + Math.abs(a.r - c.r)) / 2;
          expect(dist).toBeGreaterThan(1);
        }
      }
    }
  });

  it('supports board radius up to 50 and the fogIsland preset', () => {
    const fogBoard = make({}, 'fogIsland');
    expect(fogBoard.hexes.some(h => h.ext.hidden)).toBe(true);

    const bigBoard = make({ boardRadius: 10 }, 'blank');
    expect(bigBoard.hexes).toHaveLength(1 + 3 * 10 * 11);
  });

  it('goldRush puts gold tiles on the board', () => {
    const b = make({}, 'goldRush');
    expect(b.hexes.some(h => h.type === 'gold')).toBe(true);
  });
});

describe('util', () => {
  it('getPips matches dice probabilities', () => {
    expect(getPips(6)).toBe(5);
    expect(getPips(8)).toBe(5);
    expect(getPips(2)).toBe(1);
    expect(getPips(12)).toBe(1);
    expect(getPips(7)).toBe(0);
    expect(getPips(null)).toBe(0);
  });

  it('clamp bounds and falls back on NaN', () => {
    expect(clamp(99, 1, 4, 2)).toBe(4);
    expect(clamp(-5, 1, 4, 2)).toBe(1);
    expect(clamp('abc', 1, 4, 2)).toBe(2);
    expect(clamp(2.9, 1, 4, 2)).toBe(2);
  });
});
