// MODULE: bot goal registry (Service 18 — S0.14; lets addons publish bot goals, vertex/edge deltas, action scores, and threat deltas) | DEPENDS ON: shared/ctx, shared/registry, shared/types | USED BY: shared/index
import { defsOf } from './registry';
import type { Registry } from './registry';
import type { Ctx } from './ctx';
import type { Id, Resources } from './types';

/** Registry table name for addon-contributed bot goal definitions. */
export const BOT_GOALS = 'botGoals';

export type BotGoalTier = 'main' | 'secondary' | 'overload';

/**
 * Tier gating for bot goals:
 * - `'generic'`: active for all tiers (`main`, `secondary`, `overload`) — generic fallback rules.
 * - `'basic'`: active for `secondary` and `overload` — authored addon goals & placement bonuses.
 * - `'advanced'`: active for `overload` only — full counter-play, combos, and threat targeting.
 */
export type BotGoalClass = 'generic' | 'basic' | 'advanced';

export interface BotGoalItem {
  id: string;
  /** Priority on the same scale as base plans (e.g. 50–110 before missing-card penalty). */
  priority: number;
  /** Resource cost required to execute this goal; missing cards automatically feed trade, discard, and gold/pick logic. */
  cost: Resources;
  /** Optional direct action to execute when the goal is affordable and legal in `main` phase. */
  action?: { type: string; payload: any };
  /** Optional semantic tags (`'sea'`, `'defense'`, `'vp'`, `'economy'`, etc.). */
  needsTags?: string[];
}

export interface BotGoalDef {
  id: string;
  /** Defaults to `'basic'` (visible to `secondary` and `overload`). Set `'generic'` to include `main`, or `'advanced'` for `overload` only. */
  goalClass?: BotGoalClass;
  /** Returns active resource/build goals for player `pid`. */
  goals?: (ctx: Ctx, pid: Id) => BotGoalItem[];
  /** Bonus or penalty added to `vertexScore` when evaluating a settlement/city/vertex placement. */
  vertexDelta?: (ctx: Ctx, pid: Id, vertexId: number) => number;
  /** Bonus or penalty added to `roadScore` when evaluating an edge placement. */
  edgeDelta?: (ctx: Ctx, pid: Id, edgeId: number) => number;
  /** Score for a custom legal action in `main` phase (positive means worth taking). */
  actionScore?: (ctx: Ctx, pid: Id, action: { type: string; payload: any }) => number;
  /** Threat weight delta added to `targetPid` when `pid` evaluates robber placement or trade blocking. */
  threatDelta?: (ctx: Ctx, pid: Id, targetPid: Id) => number;
}

export function hasBotGoals(reg: Registry): boolean {
  return defsOf<BotGoalDef>(reg, BOT_GOALS).size > 0;
}

export function isGoalDefActiveForTier(def: BotGoalDef, tierId: BotGoalTier): boolean {
  const cls = def.goalClass ?? 'basic';
  if (tierId === 'overload') return true;
  if (tierId === 'secondary') return cls === 'generic' || cls === 'basic';
  return cls === 'generic';
}

export function activeBotGoalDefs(reg: Registry, tierId: BotGoalTier): BotGoalDef[] {
  const map = defsOf<BotGoalDef>(reg, BOT_GOALS);
  if (map.size === 0) return [];
  const out: BotGoalDef[] = [];
  for (const def of map.values()) {
    if (isGoalDefActiveForTier(def, tierId)) out.push(def);
  }
  return out;
}

export function evaluateBotGoals(ctx: Ctx, pid: Id, tierId: BotGoalTier): BotGoalItem[] {
  const defs = activeBotGoalDefs(ctx.reg, tierId);
  if (defs.length === 0) return [];
  const out: BotGoalItem[] = [];
  for (const def of defs) {
    if (!def.goals) continue;
    const items = def.goals(ctx, pid);
    if (Array.isArray(items)) {
      for (const it of items) {
        if (it && it.priority > 0) out.push(it);
      }
    }
  }
  return out;
}

export function botGoalVertexDelta(ctx: Ctx, pid: Id, vertexId: number, tierId: BotGoalTier): number {
  const defs = activeBotGoalDefs(ctx.reg, tierId);
  if (defs.length === 0) return 0;
  let delta = 0;
  for (const def of defs) {
    if (def.vertexDelta) delta += def.vertexDelta(ctx, pid, vertexId);
  }
  return delta;
}

export function botGoalEdgeDelta(ctx: Ctx, pid: Id, edgeId: number, tierId: BotGoalTier): number {
  const defs = activeBotGoalDefs(ctx.reg, tierId);
  if (defs.length === 0) return 0;
  let delta = 0;
  for (const def of defs) {
    if (def.edgeDelta) delta += def.edgeDelta(ctx, pid, edgeId);
  }
  return delta;
}

export function botGoalActionScore(
  ctx: Ctx,
  pid: Id,
  action: { type: string; payload: any },
  tierId: BotGoalTier
): number {
  const defs = activeBotGoalDefs(ctx.reg, tierId);
  if (defs.length === 0) return 0;
  let total = 0;
  for (const def of defs) {
    if (def.actionScore) total += def.actionScore(ctx, pid, action);
  }
  return total;
}

export function botGoalThreatDelta(ctx: Ctx, pid: Id, targetPid: Id, tierId: BotGoalTier): number {
  const defs = activeBotGoalDefs(ctx.reg, tierId);
  if (defs.length === 0) return 0;
  let delta = 0;
  for (const def of defs) {
    if (def.threatDelta) delta += def.threatDelta(ctx, pid, targetPid);
  }
  return delta;
}
