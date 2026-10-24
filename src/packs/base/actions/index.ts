// MODULE: registers every base action | USED BY: packs/base/index
import type { PackApi } from '../../../shared';
import { bankTradeAction } from './bankTrade';
import { buildAction } from './build';
import { buyDevAction, playDevAction } from './devCards';
import { endTurnAction } from './endTurn';
import { discardAction, pickAction } from './owed';
import { moveRobberAction, stealAction } from './robber';
import { rollAction } from './roll';
import { cancelTradeAction, confirmTradeAction, counterTradeAction, proposeTradeAction, respondTradeAction } from './tradeOffers';

export function registerActions(api: PackApi): void {
  for (const def of [
    buildAction, rollAction, buyDevAction, playDevAction, bankTradeAction,
    proposeTradeAction, respondTradeAction, counterTradeAction, confirmTradeAction, cancelTradeAction,
    discardAction, pickAction, moveRobberAction, stealAction, endTurnAction
  ]) {
    api.action(def);
  }
}
