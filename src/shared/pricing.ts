// MODULE: piece cost and limit service (placed counts, base limit with doubled cost above it, registered cost modifiers) | USED BY: packs/base/building, DLC packs, bots
import { defsOf } from './registry';
import type { PieceDef, Registry } from './registry';
import type { GameState, Id, PlayerState, Resources } from './types';

/**
 * Piece cost rules:
 *  1. A piece with `baseLimit` costs double once the player has that many of it on the board.
 *  2. Then every registered cost modifier runs, in registration order, and may change the cost (discounts, taxes, war weariness...).
 * Register a modifier with `api.define(COST_MODS, { id, apply })`. A pack that does not register one changes nothing.
 */
export const COST_MODS = 'pieceCostMods';

export interface CostModifier {
  id: string;
  apply(g: GameState, p: PlayerState, def: PieceDef, cost: Resources): Resources;
  replace?: boolean;
}

/** How many of this piece the player has on the board (vertices and edges). */
export function placedCount(g: GameState, pid: Id, pieceId: string): number {
  let n = 0;
  for (const v of g.board.vertices) if (v.piece?.owner === pid && v.piece.type === pieceId) n++;
  for (const e of g.board.edges) if (e.piece?.owner === pid && e.piece.type === pieceId) n++;
  return n;
}

/** True once the player has placed at least `def.baseLimit` of this piece. Pieces without a base limit are never above it. */
export function aboveBaseLimit(g: GameState, p: PlayerState, def: PieceDef): boolean {
  if (!def.baseLimit) return false;
  return placedCount(g, p.id, def.id) >= def.baseLimit;
}

export function doubledCost(cost: Resources): Resources {
  const out: Resources = {};
  for (const [r, n] of Object.entries(cost)) if (n) out[r] = n * 2;
  return out;
}

/** What this player pays for this piece right now: base cost, doubled above the base limit, then the registered modifiers. */
export function priceOf(g: GameState, reg: Registry, p: PlayerState, def: PieceDef): Resources {
  let cost = aboveBaseLimit(g, p, def) ? doubledCost(def.cost) : def.cost;
  for (const m of defsOf<CostModifier>(reg, COST_MODS).values()) cost = m.apply(g, p, def, cost);
  return cost;
}
