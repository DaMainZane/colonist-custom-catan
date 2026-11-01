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

/** What the bot brain tells a `techValue` hook about the bot asking (the hook already has the game through `ctx`). */
export interface BotTechInfo {
  tierId: BotGoalTier;
  /** The bot's personality id (`roadHog`, `portTrader`, ...). A plain string so shared does not depend on the server's tier list. */
  personality: string;
}

/** Extra edge pieces a bot may lay besides roads (bridges), as the reach check sees them. */
export interface BotEdgeReach {
  /** How many of these pieces the bot can still place (adds to its road count). */
  steps: number;
  /** True for an empty edge these pieces can cross but roads cannot. */
  crosses: (edgeId: number) => boolean;
}

export interface BotGoalDef {
  id: string;
  /** Several addons of one pack may register the same shared def; `replace: true` makes the repeat harmless (same as the other registries). */
  replace?: boolean;
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

  // ---- Tier-free hooks: read from every registered def, whatever its `goalClass`, because they describe content, not a tier's taste. ----

  /** How much the bot wants to research `techId` (same scale as the base tech values). Return `undefined` for techs this def does not know; the first number wins. */
  techValue?: (ctx: Ctx, pid: Id, techId: string, info: BotTechInfo) => number | undefined;
  /** True when content on the board is reason enough for `pid` to play a knight now (an active pirate, say). */
  wantsKnight?: (ctx: Ctx, pid: Id) => boolean;
  /** True when Main-tier bots should also upgrade ports (base: Secondary and Overload only). */
  mainPortUpgrades?: boolean;
  /** True when `pid` may raise a port that carries a settlement, not only a city (a tech unlocks it). */
  portUpgradeOnSettlement?: (ctx: Ctx, pid: Id) => boolean;
  /** Edge pieces besides roads that `pid` can still lay, for the "boxed in?" check (`null` when none). */
  edgeReach?: (ctx: Ctx, pid: Id) => BotEdgeReach | null;
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

// ---- Tier-free hooks (every registered def counts, so Main sees them too) ----------------------------------------------

function allBotGoalDefs(reg: Registry): BotGoalDef[] {
  return [...defsOf<BotGoalDef>(reg, BOT_GOALS).values()];
}

/** Research value from the first def that knows `techId`, or `undefined` when none does (the brain then uses its own base values). */
export function botGoalTechValue(ctx: Ctx, pid: Id, techId: string, info: BotTechInfo): number | undefined {
  for (const def of allBotGoalDefs(ctx.reg)) {
    const v = def.techValue?.(ctx, pid, techId, info);
    if (typeof v === 'number') return v;
  }
  return undefined;
}

/** Does any registered content give `pid` a reason to play a knight now? */
export function botGoalWantsKnight(ctx: Ctx, pid: Id): boolean {
  return allBotGoalDefs(ctx.reg).some(def => def.wantsKnight?.(ctx, pid) === true);
}

/** Should Main-tier bots upgrade ports in this game? */
export function botGoalMainPortUpgrades(reg: Registry): boolean {
  return allBotGoalDefs(reg).some(def => def.mainPortUpgrades === true);
}

/** May `pid` raise a port that carries a settlement (not only a city)? */
export function botGoalPortUpgradeOnSettlement(ctx: Ctx, pid: Id): boolean {
  return allBotGoalDefs(ctx.reg).some(def => def.portUpgradeOnSettlement?.(ctx, pid) === true);
}

/** Combined reach of all extra edge pieces: how many `pid` can still lay, and which empty edges they can cross that roads cannot. */
export function botGoalEdgeReach(ctx: Ctx, pid: Id): BotEdgeReach {
  const parts: BotEdgeReach[] = [];
  for (const def of allBotGoalDefs(ctx.reg)) {
    const r = def.edgeReach?.(ctx, pid);
    if (r && r.steps > 0) parts.push(r);
  }
  return {
    steps: parts.reduce((s, r) => s + r.steps, 0),
    crosses: (edgeId: number) => parts.some(r => r.crosses(edgeId))
  };
}
