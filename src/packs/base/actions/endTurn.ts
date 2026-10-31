// MODULE: action "end_turn" (new dev cards become playable, next player rolls) | DEPENDS ON: shared/index | USED BY: packs/base/actions/index
import { checkWinner, currentPlayer, endRoundIfLastSeat, startTurn } from '../../../shared';
import type { ActionDef } from '../../../shared';

export const endTurnAction: ActionDef = {
  type: 'end_turn',
  validate: () => null,
  apply(ctx) {
    const { g } = ctx;
    const p = currentPlayer(g);
    p.devCards.push(...p.newDevCards);
    p.newDevCards = [];
    p.pending.freeRoads = 0;
    g.trade = null;
    g.trades = [];
    g.turnCount++;
    for (const hook of ctx.reg.hooks.onTurnEnd) hook(ctx);

    // Win check before the turn passes, so the winner is still the current player.
    if (checkWinner(ctx)) return;

    endRoundIfLastSeat(ctx);
    g.turn = (g.turn + 1) % g.players.length;
    startTurn(ctx);
  },
  legal: () => [{}]
};
