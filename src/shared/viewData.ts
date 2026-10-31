// MODULE: view data registry (VIEW_DATA: a piece or addon adds public fields, tile overlays, per-player fields and VP breakdown bonuses to the state the client gets, from its own file) | DEPENDS ON: shared/registry, shared/types | USED BY: shared/index
import { defsOf } from './registry';
import type { Registry } from './registry';
import type { GameState, Id, PlayerState } from './types';

/**
 * Keyed registry of view data (R7a). A pack registers one entry with `api.define(VIEW_DATA, def)` inside its addon's `register`, so a disabled
 * addon adds nothing (same pattern as `COST_MODS`). `PackApi` does not change. `onView` stays for engine-side hiding (`shared/views.ts`);
 * this registry is for the client state that `server/view.ts` builds.
 *
 * Null versus undefined matters on the wire (JSON drops undefined and keeps null): a public field is `null` when its addon is off, a per-player
 * field is `undefined` when it is off. An entry returns exactly what the old code in `view.ts` put in the field.
 */
export const VIEW_DATA = 'viewData';

/** Who the per-player data is for. `self`: the player being described is the viewer. `over`: the game is over. `spectator`: the viewer has no seat. */
export interface ViewWho {
  self: boolean;
  over: boolean;
  spectator: boolean;
}

/** One tile overlay as the client draws it. `kind` picks the tint and pattern; extra keys are passed through. */
export interface ViewOverlay {
  kind: string;
  [key: string]: any;
}

export interface ViewDataDef {
  id: string;
  /** Higher goes first. Decides which overlay a hex keeps and which entry wins when two set the same field. Default 0; ties go to the lower id. */
  priority?: number;
  /** Public fields merged into the shared state (the same for every viewer). Return `undefined` to add nothing. */
  shared?(g: GameState, reg: Registry): Record<string, any> | undefined;
  /**
   * Tile overlays, hex id -> overlay. Return `undefined` or `null` to take no part (the merged `hexOverlays` stays `null` while no entry takes part);
   * return `{}` to take part with nothing to show (the merged value is then `{}`, as the old Tides code sent when no tile was marked).
   */
  overlays?(g: GameState, reg: Registry): Record<number, ViewOverlay> | null | undefined;
  /** Fields spread into one player's view (`undefined` values are kept so they drop out of the JSON). */
  player?(g: GameState, reg: Registry, p: PlayerState, who: ViewWho): Record<string, any> | undefined;
  /** Extra victory points to show in `stats.vpBreakdown`, keyed by the breakdown key they add to (for example `{ longestRoad: 14 }`). */
  vpBonus?(g: GameState, reg: Registry, pid: Id): Record<string, number> | undefined;
  replace?: boolean;
}

/** The entries in merge order: higher priority first, then ascending id, so the order never depends on registration order. */
export function viewDataEntries(reg: Registry): ViewDataDef[] {
  return [...defsOf<ViewDataDef>(reg, VIEW_DATA).values()].sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** Copies `from` into `into`, leaving keys that are already there (the entry that came first wins). */
function fillMissing(into: Record<string, any>, from: Record<string, any>): void {
  for (const k of Object.keys(from)) if (!(k in into)) into[k] = from[k];
}

/** Every `shared()` merged into one object. Empty when nothing is registered. */
export function mergeViewShared(g: GameState, reg: Registry): Record<string, any> {
  const out: Record<string, any> = {};
  for (const d of viewDataEntries(reg)) {
    const part = d.shared?.(g, reg);
    if (part) fillMissing(out, part);
  }
  return out;
}

/**
 * Every `overlays()` merged: one overlay per hex, the entry that comes first (higher priority, then lower id) keeps it.
 * `null` when no entry takes part, so a game without any overlay source sends `null` as before.
 */
export function mergeViewOverlays(g: GameState, reg: Registry): Record<number, ViewOverlay> | null {
  let out: Record<number, ViewOverlay> | null = null;
  for (const d of viewDataEntries(reg)) {
    const part = d.overlays?.(g, reg);
    if (!part) continue;
    if (!out) out = {};
    for (const key of Object.keys(part)) {
      const hexId = Number(key);
      if (!(hexId in out)) out[hexId] = part[hexId];
    }
  }
  return out;
}

/** Every `player()` merged for one player. Empty when nothing is registered. Keys that are `undefined` are kept. */
export function mergeViewPlayer(g: GameState, reg: Registry, p: PlayerState, who: ViewWho): Record<string, any> {
  const out: Record<string, any> = {};
  for (const d of viewDataEntries(reg)) {
    const part = d.player?.(g, reg, p, who);
    if (part) fillMissing(out, part);
  }
  return out;
}

/** The `vpBonus()` of every entry summed per breakdown key. Empty when nothing is registered. */
export function mergeViewVpBonus(g: GameState, reg: Registry, pid: Id): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of viewDataEntries(reg)) {
    const part = d.vpBonus?.(g, reg, pid);
    if (!part) continue;
    for (const [k, n] of Object.entries(part)) out[k] = (out[k] ?? 0) + (Number(n) || 0);
  }
  return out;
}
