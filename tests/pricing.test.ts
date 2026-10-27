import { describe, expect, it } from 'vitest';
import { allPacks } from '../src/packs';
import { BASE_PIECE_LIMITS, pieceCost } from '../src/packs/base/building';
import { COST_MODS, createGame, createRegistry, doubledCost, placedCount, priceOf, registryFor } from '../src/shared';
import type { CostModifier, GameState, Pack, Registry } from '../src/shared';

function newGame(reg: Registry, rules: Record<string, any> = {}): GameState {
  return createGame(reg, { players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], seed: 5, shuffleSeats: false, rules });
}

function placeRoads(g: GameState, owner: string, n: number): void {
  let left = n;
  for (const e of g.board.edges) {
    if (left === 0) break;
    if (!e.piece) { e.piece = { type: 'road', owner }; left--; }
  }
}

const discountPack = (): Pack => ({
  id: 'disc', name: 'Discount', deps: ['base'],
  addons: [{
    id: 'disc.cheapRoads',
    name: 'Cheap roads',
    links: [{ target: 'piece-cost', kind: 'mechanic' }, { target: 'overlay', kind: 'ui' }],
    register(api) {
      const mod: CostModifier = {
        id: 'disc.roads',
        apply: (_g, _p, def, cost) => (def.id === 'road' ? { ...cost, brick: Math.max(0, (cost.brick || 0) - 1) } : cost)
      };
      api.define(COST_MODS, mod);
    }
  }],
  register() {}
});

describe('piece cost and limit service', () => {
  const reg = createRegistry(allPacks);

  it('the base pieces declare their base limits', () => {
    for (const [id, limit] of Object.entries(BASE_PIECE_LIMITS)) expect(reg.pieces.get(id)?.baseLimit).toBe(limit);
  });

  it('costs the normal price below the base limit and double at it', () => {
    const g = newGame(reg);
    const road = reg.pieces.get('road')!;
    const a = g.players[0];
    placeRoads(g, 'a', 14);
    expect(placedCount(g, 'a', 'road')).toBe(14);
    expect(priceOf(g, reg, a, road)).toEqual(road.cost);
    placeRoads(g, 'a', 1);
    expect(priceOf(g, reg, a, road)).toEqual(doubledCost(road.cost));
    expect(doubledCost(road.cost)).toEqual({ wood: 2, brick: 2 });
  });

  it('another player is not affected by my count', () => {
    const g = newGame(reg);
    const road = reg.pieces.get('road')!;
    placeRoads(g, 'a', 15);
    expect(priceOf(g, reg, g.players[1], road)).toEqual(road.cost);
  });

  it('the base pieceCost wrapper gives the same answer with and without a registry', () => {
    const g = newGame(reg);
    const road = reg.pieces.get('road')!;
    placeRoads(g, 'a', 15);
    expect(pieceCost(g, g.players[0], road)).toEqual(pieceCost(g, g.players[0], road, reg));
  });

  it('a registered modifier runs after the doubling, only while its addon is on', () => {
    const packs = [...allPacks, discountPack()];
    const on = { dlc: { disc: true } };
    const regOn = registryFor(packs, on);
    const regOff = registryFor(packs, {});
    const road = regOn.pieces.get('road')!;

    const gOn = newGame(regOn, on);
    expect(priceOf(gOn, regOn, gOn.players[0], road)).toEqual({ wood: 1, brick: 0 });
    placeRoads(gOn, 'a', 15);
    expect(priceOf(gOn, regOn, gOn.players[0], road)).toEqual({ wood: 2, brick: 1 });

    const gOff = newGame(regOff);
    expect(priceOf(gOff, regOff, gOff.players[0], road)).toEqual(road.cost);
  });
});
