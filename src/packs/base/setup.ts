// MODULE: setup flow (snake order, second-round resources, hand-off to the first turn) | USED BY: actions/build
import { produceFromHex, setPhase, startTurn } from '../../shared';
import type { Ctx, Id, PieceDef } from '../../shared';
import { SETTLEMENT } from './constants';

/** Second-round settlements pay out one production for each adjacent revealed hex. */
function grantSetupProduction(ctx: Ctx, pid: Id, vertexId: number): void {
  const v = ctx.g.board.vertices[vertexId];
  for (const hexId of v.hexIds) {
    const hex = ctx.g.board.hexes[hexId];
    if (!hex || hex.ext.hidden) continue;
    produceFromHex(ctx, hex, pid, 1);
  }
}

export function advanceSetup(ctx: Ctx): void {
  const { g } = ctx;
  g.setup.step++;
  if (g.setup.step >= g.setup.order.length) {
    g.turn = 0;
    g.turnCount = 1;
    ctx.log(`Setup complete! ${g.players[0]?.name}'s turn to roll.`);
    startTurn(ctx);
  } else {
    g.turn = g.setup.order[g.setup.step];
    setPhase(ctx, 'setup_settlement');
  }
}

/** Called after a piece is placed during a setup phase. */
export function afterSetupPiece(ctx: Ctx, pid: Id, def: PieceDef, loc: number): void {
  const { g } = ctx;
  if (def.id === SETTLEMENT) {
    g.setup.lastVertexId = loc;
    if (g.setup.step >= g.players.length) grantSetupProduction(ctx, pid, loc);
    setPhase(ctx, 'setup_road');
  } else {
    g.setup.lastVertexId = null;
    advanceSetup(ctx);
  }
}
