// MODULE: registers every base action | DEPENDS ON: packs/base/actions/bankTrade, packs/base/actions/build, packs/base/actions/devCards, packs/base/actions/endTurn, packs/base/actions/owed, packs/base/actions/research, +5 more | USED BY: packs/base/index
import type { PackApi } from '../../../shared';
import { bankTradeAction } from './bankTrade';
import { buildAction } from './build';
import { buyDevAction, playDevAction } from './devCards';
import { endTurnAction } from './endTurn';
import { discardAction, pickAction } from './owed';
import { researchTechAction } from './research';
import { moveRobberAction, stealAction } from './robber';
import { rollAction } from './roll';
import { convertTileAction, upgradePortAction } from './techActions';
import { cancelTradeAction, confirmTradeAction, counterTradeAction, proposeTradeAction, respondTradeAction } from './tradeOffers';

export function registerActions(api: PackApi): void {
  for (const def of [
    buildAction, rollAction, buyDevAction, playDevAction, bankTradeAction,
    proposeTradeAction, respondTradeAction, counterTradeAction, confirmTradeAction, cancelTradeAction,
    discardAction, pickAction, moveRobberAction, stealAction, endTurnAction, researchTechAction,
    upgradePortAction, convertTileAction
  ]) {
    api.action(def);
  }
}
