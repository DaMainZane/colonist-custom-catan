// MODULE: tidebound pack (DLC skeleton: 8 addons with links, no content yet) | USED BY: packs/index, server, sims, tests
import type { Pack } from '../../shared';
import { bridgesAddon } from './bridges';
import { fishingAddon } from './fishing';
import { harborAddon } from './harbor';
import { piratesAddon } from './pirates';
import { ricketyBridgesAddon } from './ricketyBridges';
import { risingSeaAddon } from './risingSea';
import { tidesAddon } from './tides';
import { wrecksAddon } from './wrecks';

/**
 * Tidebound: sea, bridges, tides, harbors, fishing, wrecks and pirates.
 * Everything lives in addons (`rules.dlc.tidebound` is the master switch), so with the DLC off nothing here is registered.
 * Addon order matters: a dependency must be declared before the addon that needs it.
 */
export const tideboundPack: Pack = {
  id: 'tidebound',
  name: 'Tidebound',
  deps: ['base'],
  addons: [
    bridgesAddon,
    ricketyBridgesAddon,
    tidesAddon,
    risingSeaAddon,
    harborAddon,
    fishingAddon,
    wrecksAddon,
    piratesAddon
  ],
  register() {}
};
