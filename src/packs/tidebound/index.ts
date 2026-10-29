// MODULE: tidebound pack (DLC: 8 addons with links; T1 sea tiles, T2 wide water + sea data, T3 bridges, T4a/T4b rickety bridges, T4c view data) | USED BY: packs/index, server, sims, tests
import type { Pack } from '../../shared';
import { bridgesAddon } from './bridges';
import { fishingAddon } from './fishing';
import { harborAddon } from './harbor';
import { piratesAddon } from './pirates';
import { ricketyBridgesAddon } from './ricketyBridges';
import { risingSeaAddon } from './risingSea';
import { tidesAddon } from './tides';
import { wrecksAddon } from './wrecks';

export {
  BRIDGE,
  BRIDGE_BASE_LIMIT,
  BRIDGE_COST,
  bridgeBotGoal,
  bridgePiece,
  bridgesAddon,
  canPlaceBridge,
  isOceanEdge
} from './bridges';

export {
  RICKETY,
  RICKETY_COST,
  RICKETY_HEALTH,
  RICKETY_UPGRADE_COST,
  RICKETY_UPGRADE_ID,
  UPGRADE_BRIDGE,
  bridgeUpgradeView,
  bridgesOnBoard,
  ricketyBotGoal,
  ricketyBridgesAddon,
  ricketyDurability,
  ricketyPiece,
  ricketyPoolCostMod,
  syncBridgePool,
  upgradeBridgeAction,
  upgradeBridgeCost
} from './ricketyBridges';

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
