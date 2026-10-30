// MODULE: tidebound pack (DLC: 8 addons with links; T1 sea tiles, T2 wide water + sea data, T3 bridges, T4 rickety bridges, T5a tides schedule, T5b spring tide, T5c tide level, T5d elevation, T5e idle ports, T6 tide view for the client, T7a fish token) | USED BY: packs/index, server, sims, tests
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
  FISH,
  SPEND_FISH,
  fishBotGoal,
  fishToken,
  fishingAddon,
  spendFishAction
} from './fishing';

export {
  RICKETY,
  RICKETY_COST,
  RICKETY_HEALTH,
  RICKETY_SEVEN_STEP_ID,
  RICKETY_UPGRADE_COST,
  RICKETY_UPGRADE_ID,
  UPGRADE_BRIDGE,
  bridgeUpgradeView,
  bridgesOnBoard,
  ricketyBotGoal,
  ricketyBridgesAddon,
  ricketyCollapseStep,
  ricketyDurability,
  ricketyPiece,
  ricketyPoolCostMod,
  syncBridgePool,
  upgradeBridgeAction,
  upgradeBridgeCost
} from './ricketyBridges';

export {
  FLOODED,
  TIDE_DEFAULT_LEVEL,
  TIDE_FIRST_ROUND,
  TIDE_LEVELS,
  TIDE_LEVEL_MAX,
  TIDE_LEVEL_MIN,
  TIDE_PERIOD,
  TIDE_CLUSTER_SIZE,
  TIDE_SPRING_EVERY,
  applyTides,
  buildTideClusters,
  coastHexIds,
  deriveTideRng,
  ensureTides,
  floodDepthAt,
  floodPlan,
  hexElevation,
  isFloodedAt,
  isPortFlooded,
  isSpringTide,
  tideClientView,
  tideLevelDef,
  tideLevelOf,
  tideStrengthAt,
  tideWarning,
  tidesAddon
} from './tides';
export type { TideClientView, TideCluster, TideLevelDef, TideState, TideWarning } from './tides';

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
