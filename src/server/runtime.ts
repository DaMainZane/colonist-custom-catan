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
    goldTiles: 0,
    desertTiles: 1,
    fogTiles: 0,
    vpToWin: 10,
    maxPlayers: 8,
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
    gameSpeed: 1,
    turnTimerSec: 0,
    turnIncrementSec: 0,
    tradeTimerSec: 20,
    mapSeed: '',
    mapSeedLocked: false,
    mapPicks: [],
    mapParams: {}
  };
}

/** Bank and dev deck sizes of the standard 3-4 player game, the ones the lobby starts with. */
const STANDARD_SUPPLY = { bankResourcePerType: 19, devKnights: 14, devVp: 5, devRoadBuilding: 2, devYearOfPlenty: 2, devMonopoly: 2 };

/** Bigger tables get a bigger bank and dev deck (5-6 follows the real extension: 24 per resource, 34 dev cards). */
function supplyFor(players: number): typeof STANDARD_SUPPLY {
  if (players <= 4) return STANDARD_SUPPLY;
  if (players <= 6) return { bankResourcePerType: 24, devKnights: 20, devVp: 5, devRoadBuilding: 3, devYearOfPlenty: 3, devMonopoly: 3 };
  return { bankResourcePerType: 30, devKnights: 26, devVp: 5, devRoadBuilding: 4, devYearOfPlenty: 4, devMonopoly: 4 };
}

/**
 * Settings for the game about to start. If the host left the bank and dev deck at the standard numbers,
 * they grow with the real player count (not the seat limit). Anything the host changed is kept as is.
 */
export function settingsForPlayers(s: Settings, players: number): Settings {
  const untouched = (Object.keys(STANDARD_SUPPLY) as (keyof typeof STANDARD_SUPPLY)[]).every(k => s[k] === STANDARD_SUPPLY[k]);
  return untouched ? { ...s, ...supplyFor(players) } : s;
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
