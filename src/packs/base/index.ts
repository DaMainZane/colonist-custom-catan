// MODULE: base game pack (resources, tiles, pieces, dev cards, awards, ports, presets, phases, actions) | USED BY: server, sims, tests, other packs
import type { Pack } from '../../shared';
import { registerActions } from './actions';
import { registerAwards } from './awards';
import { registerResourcesAndTiles } from './content';
import { registerDevCards } from './devcards';
import { registerHooks } from './hooks';
import { registerPhases } from './phases';
import { registerPieces } from './pieces';
import { registerPortsAndPresets } from './ports';

export const basePack: Pack = {
  id: 'base',
  name: 'Base game',
  rules: {
    vpToWin: 10,
    maxPlayers: 4,
    discardLimit: 7,
    bankPerResource: 19,
    boardRadius: 2,
    bankRatio: 4,
    devCost: { sheep: 1, wheat: 1, ore: 1 },
    tileCounts: { desert: 1 },
    devCounts: { knight: 14, vp: 5, roadBuilding: 2, yearOfPlenty: 2, monopoly: 2 },
    pieceLimits: { road: 15, settlement: 5, city: 4 }
  },
  register(api) {
    registerResourcesAndTiles(api);
    registerPieces(api);
    registerDevCards(api);
    registerAwards(api);
    registerPortsAndPresets(api);
    registerPhases(api);
    registerActions(api);
    registerHooks(api);
  }
};
