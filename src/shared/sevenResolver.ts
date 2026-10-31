// MODULE: S0.8 Seven Resolver (service 17: ordered pipeline for discard, karaoke, robber, volcano, decay with max DLC side-effects cap) | DEPENDS ON: shared/ctx, shared/registry, shared/state, shared/tileState, shared/types | USED BY: shared/index, shared/stage1
import type { Ctx } from './ctx';
import { defsOf } from './registry';
import type { Registry } from './registry';
import { pushPhase, setPhase, totalCards } from './state';
import { getWildTokens, WILD_TOKENS } from './tileState';
import type { WildTokenDef } from './tileState';
import type { GameState, PlayerState } from './types';

export const SEVEN_STEPS = 'sevenSteps';
export const DISCARD_LIMIT_MODS = 'discardLimitMods';
export const DEFAULT_MAX_SEVEN_SIDE_EFFECTS = 2;

export const SEVEN_STEP_ORDER = {
  discard: 10,
  karaoke: 20,
  robber: 30,
  volcano: 40,
  decay: 50
} as const;

export interface DiscardLimitModifier {
  id: string;
  apply(g: GameState, reg: Registry, p: PlayerState, currentLimit: number): number;
  replace?: boolean;
}

export interface SevenStepDef {
  id: string;
  /** Execution order in the Seven Resolver pipeline (discard=10, karaoke=20, robber=30, volcano=40, decay=50). */
  order: number;
  /** True for DLC side effects subject to the `maxSevenSideEffects` cap (default 2 per 7). Base discard & robber are false. */
  isDlcSideEffect?: boolean;
  /** Higher priority wins when more than `maxSevenSideEffects` DLC steps want to fire on the same 7. */
  priority?: number;
  /** Optional predicate; if false, this step does not count toward the side-effect cap on this 7. */
  canFire?(ctx: Ctx): boolean;
  /** Runs the step. Return false if the step ended up doing nothing. */
  run(ctx: Ctx): boolean | void;
  replace?: boolean;
}

/** Effective safe hand limit for a player on a 7 (base `g.rules.discardLimit` plus any registered modifiers like Storehouse, Granary, or Catch-up). */
export function effectiveDiscardLimit(g: GameState, reg: Registry, p: PlayerState): number {
  let limit = Number(g.rules?.discardLimit ?? 7);
  for (const mod of defsOf<DiscardLimitModifier>(reg, DISCARD_LIMIT_MODS).values()) {
    limit = mod.apply(g, reg, p, limit);
  }
  return Math.max(0, Math.floor(limit));
}

/** Total cards a player holds for 7-discard checking (hand resources + any wild tokens flagged `countInDiscard`). */
export function countableCardsForSeven(g: GameState, reg: Registry, p: PlayerState): number {
  let total = totalCards(p);
  for (const wt of defsOf<WildTokenDef>(reg, WILD_TOKENS).values()) {
    if (wt.countInDiscard) total += getWildTokens(g, p.id, wt.id);
  }
  return total;
}

/** Built-in base robber step: pushes 'main' onto phaseStack and enters 'robber' phase. */
export function runBaseSevenRobber(ctx: Ctx): void {
  ctx.g.phaseStack.push('main');
  setPhase(ctx, 'robber');
}

/** Built-in base discard step: checks each player against `effectiveDiscardLimit` and pushes 'discard' phase if anyone must discard. */
export function runBaseSevenDiscard(ctx: Ctx): boolean {
  const { g, reg } = ctx;
  let anyDiscard = false;
  for (const p of g.players) {
    const total = countableCardsForSeven(g, reg, p);
    const limit = effectiveDiscardLimit(g, reg, p);
    if (total > limit) {
      p.pending.discard = Math.floor(total / 2);
      anyDiscard = true;
    }
  }
  if (anyDiscard) pushPhase(ctx, 'discard');
  return anyDiscard;
}

/**
 * Runs the ordered S0.8 Seven Resolver pipeline:
 *  - Base steps (`discard` and `robber`) always run.
 *  - Up to `g.rules.maxSevenSideEffects ?? 2` eligible DLC side-effect steps (`karaoke`, `volcano`, `decay`, etc.) are chosen by highest `priority`,
 *    then executed in ascending `order`.
 *  - Returns the list of step ids that executed.
 */
export function resolveSeven(ctx: Ctx): string[] {
  const { g, reg } = ctx;
  const registered = [...defsOf<SevenStepDef>(reg, SEVEN_STEPS).values()];

  // Fast path when no custom steps are registered: run standard robber + discard setup
  if (registered.length === 0) {
    runBaseSevenRobber(ctx);
    runBaseSevenDiscard(ctx);
    return ['base.robber', 'base.discard'];
  }

  const maxSideEffects = Math.max(
    0,
    Number.isFinite(Number(g.rules?.maxSevenSideEffects))
      ? Number(g.rules.maxSevenSideEffects)
      : DEFAULT_MAX_SEVEN_SIDE_EFFECTS
  );

  const hasCustomDiscard = registered.some(s => s.id === 'base.discard' || s.order === SEVEN_STEP_ORDER.discard && !s.isDlcSideEffect);
  const hasCustomRobber = registered.some(s => s.id === 'base.robber' || s.order === SEVEN_STEP_ORDER.robber && !s.isDlcSideEffect);

  const baseSteps: SevenStepDef[] = [
    ...(hasCustomRobber
      ? []
      : [{ id: 'base.robber', order: SEVEN_STEP_ORDER.robber, isDlcSideEffect: false, run: runBaseSevenRobber }]),
    ...(hasCustomDiscard
      ? []
      : [{ id: 'base.discard', order: SEVEN_STEP_ORDER.discard, isDlcSideEffect: false, run: runBaseSevenDiscard }]),
    ...registered.filter(s => !s.isDlcSideEffect)
  ];

  const dlcCandidates = registered
    .filter(s => !!s.isDlcSideEffect && (!s.canFire || s.canFire(ctx)))
    .sort((a, b) => {
      const pa = a.priority ?? (100 - a.order);
      const pb = b.priority ?? (100 - b.order);
      if (pb !== pa) return pb - pa;
      return a.order - b.order;
    });

  const chosenDlc = dlcCandidates.slice(0, maxSideEffects);

  // Note: In Catan's phase stack, `robber` is set as the base phase (returning to `main`), and `discard` is pushed on top of `robber`
  // so players discard first and then resolve the robber. Still, logical pipeline order is discard(10) -> karaoke(20) -> robber(30) -> volcano(40) -> decay(50).
  const allSteps = [...baseSteps, ...chosenDlc].sort((a, b) => a.order - b.order);

  // Ensure base robber phase is initialized before discard pushes onto phaseStack
  const robberStep = allSteps.find(s => s.id === 'base.robber');
  const discardStep = allSteps.find(s => s.id === 'base.discard');
  const executed: string[] = [];

  if (robberStep && discardStep) {
    robberStep.run(ctx);
    for (const step of allSteps) {
      if (step.id === 'base.robber') {
        executed.push(step.id);
        continue;
      }
      const res = step.run(ctx);
      if (res !== false) executed.push(step.id);
    }
  } else {
    for (const step of allSteps) {
      const res = step.run(ctx);
      if (res !== false) executed.push(step.id);
    }
  }

  if (chosenDlc.length > 0) {
    ctx.emit('sevenResolved', { steps: executed, dlcSideEffects: chosenDlc.map(s => s.id) });
  }
  return executed;
}
