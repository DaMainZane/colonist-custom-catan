// MODULE: action "research_tech" (spend wheat + ore on a tech; the rules live in shared/stage1.ts) | USED BY: packs/base/actions/index
import { allTechDefs, researchTech, techResearchCheck } from '../../../shared';
import type { ActionDef } from '../../../shared';

export const researchTechAction: ActionDef = {
  type: 'research_tech',
  validate(ctx, pid, payload) {
    return techResearchCheck(ctx.g, ctx.reg, pid, String(payload?.techId ?? '')).error;
  },
  apply(ctx, pid, payload) {
    researchTech(ctx, pid, String(payload.techId));
  },
  /** Nothing when the tree is off, so a game without it gains no legal actions. The engine filters the rest through validate. */
  legal(ctx) {
    if (!ctx.g.rules?.techTreeOn) return [];
    return [...allTechDefs(ctx.g, ctx.reg).keys()].map(techId => ({ techId }));
  }
};
