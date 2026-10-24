// MODULE: base hooks (game start state, pick settling after every action) | USED BY: packs/base/index
import type { PackApi } from '../../shared';
import { settlePicks } from './picks';

export function registerHooks(api: PackApi): void {
  api.hook('onGameStart', ctx => {
    ctx.g.ext.base = { tradeSeq: 0 };
    for (let s = 2; s <= 12; s++) ctx.g.diceStats[s] = 0;
  });

  api.hook('afterAction', ctx => settlePicks(ctx));
}
