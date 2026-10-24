// MODULE: pending picks (gold, Year of Plenty) -> enters/leaves the pick phase, empties picks when the bank is dry | USED BY: hooks
import { popPhase, pushPhase } from '../../shared';
import type { Ctx } from '../../shared';

/**
 * Runs after every action. Anyone with pending.pick > 0 must choose resources before play continues,
 * whatever caused it (gold tile, fog reveal, Year of Plenty). Returns to the phase that was active before.
 */
export function settlePicks(ctx: Ctx): void {
  const { g } = ctx;
  if (g.phase === 'gameover') return;

  const bankEmpty = Object.values(g.bank).every(n => n <= 0);
  if (bankEmpty) for (const p of g.players) p.pending.pick = 0;

  const anyPending = g.players.some(p => (p.pending.pick || 0) > 0);
  if (anyPending && g.phase !== 'pick') pushPhase(ctx, 'pick');
  else if (!anyPending && g.phase === 'pick') popPhase(ctx);
}
