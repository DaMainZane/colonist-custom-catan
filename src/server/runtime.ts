// MODULE: engine runtime for the server (registry, settings -> rules mapping, defaults) | USED BY: server/*, bots, sim
import { allPacks } from '../packs';
import { createRegistry, mergeRules } from '../shared';
import type { Rules } from '../shared';
import type { Settings } from './types';

/** One registry for the whole process: every shipped pack, in load order. */
export const registry = createRegistry(allPacks);

export function defaultSettings(): Settings {
  return {
    boardRadius: 2,
    goldTiles: 2,
    desertTiles: 1,
    fogTiles: 0,
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
    maxRoads: 15,
    gameSpeed: 1
  };
}

/** Overrides handed to createGame (it merges them over the registry defaults). */
export function rulesFromSettings(s: Settings): Record<string, any> {
  return {
    boardRadius: s.boardRadius,
    vpToWin: s.vpToWin,
    maxPlayers: s.maxPlayers,
    discardLimit: s.cardDiscardLimit,
    bankPerResource: s.bankResourcePerType,
    tileCounts: { desert: s.desertTiles, gold: s.goldTiles },
    fogTiles: s.fogTiles ?? 0,
    devCounts: {
      knight: s.devKnights,
      vp: s.devVp,
      roadBuilding: s.devRoadBuilding,
      yearOfPlenty: s.devYearOfPlenty,
      monopoly: s.devMonopoly
    },
    pieceLimits: { road: s.maxRoads, settlement: s.maxSettlements, city: s.maxCities }
  };
}

/** Full rules (registry defaults + settings), for generating a board outside createGame. */
export function fullRules(s: Settings): Rules {
  return mergeRules(registry.rules, rulesFromSettings(s));
}
