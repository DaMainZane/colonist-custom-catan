// MODULE: action "build" (any registered piece, setup or paid, free roads) | USED BY: packs/base/actions/index
import { canAfford, getPlayer } from '../../../shared';
import type { ActionDef } from '../../../shared';
import { buildMode, isFree, pieceCost, placePiece, validateBuild } from '../building';
import { SETUP_PIECE } from '../constants';
import { afterSetupPiece } from '../setup';

export const buildAction: ActionDef = {
  type: 'build',
  validate: validateBuild,
  apply(ctx, pid, payload) {
    const def = ctx.reg.pieces.get(payload.piece)!;
    const mode = buildMode(ctx.g)!;
    placePiece(ctx, pid, def, payload.loc, mode);
    if (mode === 'setup') afterSetupPiece(ctx, pid, def, payload.loc);
  },
  legal(ctx, pid) {
    const { g, reg } = ctx;
    const mode = buildMode(g);
    const out: any[] = [];
    if (!mode) return out;
    const p = getPlayer(g, pid)!;
    for (const def of reg.pieces.values()) {
      if (mode === 'setup' && SETUP_PIECE[g.phase] !== def.id) continue;
      if (mode === 'build' && !isFree(p, def) && !canAfford(p, pieceCost(g, p, def))) continue;
      if ((p.pieces[def.id] || 0) <= 0) continue;
      const count = def.target === 'vertex' ? g.board.vertices.length : g.board.edges.length;
      for (let loc = 0; loc < count; loc++) out.push({ piece: def.id, loc });
    }
    return out;
  }
};
