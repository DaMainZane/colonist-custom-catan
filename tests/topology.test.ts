import { describe, expect, it } from 'vitest';
import { generateBoard } from '../src/server/topology';
import type { Settings } from '../src/server/types';
import { clamp, getPips } from '../src/server/util';

const settings: Settings = {
  boardRadius: 2,
  goldTiles: 2,
  desertTiles: 1,
  vpToWin: 10,
  maxPlayers: 4,
  cardDiscardLimit: 7,
  bankResourcePerType: 19,
  devKnights: 14,
  devVp: 5,
  devRoadBuilding: 2,
  devYearOfPlenty: 2,
  devMonopoly: 2,
  maxSettlements: 5,
  maxCities: 4,
  maxRoads: 15
};

describe('topology', () => {
  it('radius 2 board has 19 hexes, 54 vertices, 72 edges', () => {
    const b = generateBoard(settings);
    expect(b.hexes).toHaveLength(19);
    expect(b.vertices).toHaveLength(54);
    expect(b.edges).toHaveLength(72);
  });

  it('has 30 coastal edges and every vertex has 2-3 neighbours', () => {
    const b = generateBoard(settings);
    expect(b.edges.filter(e => e.hexIds.length === 1)).toHaveLength(30);
    for (const v of b.vertices) {
      expect(v.adjacentVertices.length).toBeGreaterThanOrEqual(2);
      expect(v.adjacentVertices.length).toBeLessThanOrEqual(3);
    }
  });

  it('puts the robber on the desert', () => {
    const b = generateBoard(settings);
    expect(b.hexes[b.robberHexId].type).toBe('desert');
  });

  it('blank preset is all water with no vertices', () => {
    const b = generateBoard(settings, 'blank');
    expect(b.hexes.every(h => h.type === 'water')).toBe(true);
    expect(b.vertices).toHaveLength(0);
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
