// MODULE: tidebound pack (DLC: 8 addons with links; T1 sea tiles, T2 wide water + sea data, T3 bridges, T4 rickety bridges, T5a tides schedule, T5b spring tide, T5c tide level, T5d elevation, T5e idle ports, T6 tide view for the client, T7a fish token, T7b1 fishing nets, T7b2 net spots + net bot goal, T7c fish icon boosts, T7d tide replenish, T7e feed the sea, T8a harbor 1:1 upgrade, T8b 4 trades/turn + invalid-ratio prompt) | USED BY: packs/index, server, sims, tests
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
  HARBOR_BOT_SPARE,
  HARBOR_COST,
  HARBOR_LEVEL,
  HARBOR_LIMIT,
  HARBOR_MAX_TRADES,
  HARBOR_UPGRADE_ID,
  TECH_HARBOR_EMPIRE,
  UPGRADE_HARBOR,
  canUpgradeHarbor,
  harborAddon,
  harborBotGoal,
  harborCandidateVertices,
  harborClientView,
  harborCount,
  harborCovers,
  harborIdleExemption,
  harborLimitFor,
  harborRatioMod,
  harborSpotsView,
  harborTradesLeft,
  harborTradesLeftAt,
  harborTradesLeftForResource,
  harborTradesUsedAt,
  harborUpgradeCost,
  harborsOf,
  isHarbor,
  resetHarborTrades,
  upgradeHarborAction
} from './harbor';
export type { HarborTurnTrades } from './harbor';

export {
  FEED_BOT_SPARE,
  FEED_SEA,
  FEED_SEA_COST,
  FISH,
  FISH_ICON_MULTIPLIER,
  FISH_REPLENISH_CHANCE,
  NET,
  NET_BASE_LIMIT,
  NET_BOOSTED_CHANCE,
  NET_BOT_MAX,
  NET_CATCH_CHANCE,
  NET_COST,
  SPEND_FISH,
  canPlaceNet,
  feedSeaAction,
  feedSpotsView,
  feedableHexIds,
  fishBotGoal,
  fishClientView,
  fishLeft,
  fishToken,
  fishingAddon,
  isSeaHex,
  netBotGoal,
  netCatchOnRoll,
  netPiece,
  netSeaHexIds,
  netSpotsView,
  replenishFish,
  seaHexIdsAt,
  spendFishAction,
  tideReachOnSea
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

export {
  SALVAGE_CREW_LOOT_MULT,
  STORM_CADENCE_ROUNDS,
  STORM_EVENT_ID,
  STORM_FIRST_ROUND,
  TECH_SALVAGE_CREW,
  WRECK_COUNTDOWN_ROUNDS,
  WRECK_MARKER_KIND,
  WRECK_MAX_PLAYER_DIST,
  WRECK_MAX_TIME_BOOST,
  WRECK_SCALE_TURNS,
  WRECK_SEA_CHANCE,
  WRECK_SEA_DEV_CHANCE,
  WRECK_SEA_DEV_TECH_CHANCE,
  WRECK_SEA_FISH_CHANCE,
  WRECK_SEA_MAX_CARDS,
  WRECK_SEA_MIN_CARDS,
  WRECK_SHORE_MAX_CARDS,
  WRECK_SHORE_MIN_CARDS,
  activeWrecks,
  claimWreck,
  computeWreckLootCount,
  deriveWreckRng,
  edgesOfHex,
  ensureWreckRng,
  isWreckSeaHex,
  isWreckShoreHex,
  minPlayerDistanceToHex,
  pickWreckHex,
  playerHexDistance,
  playerTouchesWreck,
  shoreSeaDirection,
  spawnStormWreck,
  spawnWreckAt,
  stormEventCard,
  touchingPlayersOfWreck,
  verticesOfHex,
  wreckBotGoal,
  wreckCandidates,
  wreckClientView,
  wreckTimeMultiplier,
  wrecksAddon
} from './wrecks';
export type { WreckBonus, WreckClaimResult, WreckClientItem, WreckPayload, WreckSite } from './wrecks';

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
