// MODULE: piece cost and limit service (placed counts, base limit with doubled cost above it, registered cost modifiers) | DEPENDS ON: shared/registry, shared/types | USED BY: shared/engine, shared/index, shared/stage1
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

/**
 * What this player pays for an upgrade that is not a piece (port upgrade, later harbors and the like): the base cost run through the same
 * registered cost modifiers as a piece, so discounts and taxes apply to every resource price the same way.
 * `upgradeId` is the id modifiers see as `def.id` (use a unique one such as 'upgrade_port'); there is no base limit, so no doubling.
 */
export function priceOfUpgrade(g: GameState, reg: Registry, p: PlayerState, upgradeId: string, baseCost: Resources): Resources {
  const def: PieceDef = { id: upgradeId, name: upgradeId, target: 'vertex', cost: baseCost, vp: 0, produces: 0, canPlace: () => false };
  let cost = baseCost;
  for (const m of defsOf<CostModifier>(reg, COST_MODS).values()) cost = m.apply(g, p, def, cost);
  return cost;
}

/** What this player pays for this piece right now: base cost, doubled above the base limit, then the registered modifiers. */
export function priceOf(g: GameState, reg: Registry, p: PlayerState, def: PieceDef): Resources {
  let cost = aboveBaseLimit(g, p, def) ? doubledCost(def.cost) : def.cost;
  for (const m of defsOf<CostModifier>(reg, COST_MODS).values()) cost = m.apply(g, p, def, cost);
  return cost;
}

/**
 * Supply cap for a piece whose limit scales with both `vpToWin` (above 10) and `boardRadius` (above standard radius 2, 19 tiles),
 * using the same `vpMult * sqrt(cells / 19)` curve as `scaledPieces`. Reads the land radius (`rules.boardRadius`), never a grown sea canvas.
 */
export function scaledPieceLimit(base: number, vpToWin = 10, boardRadius = 2): number {
  const vpMult = Math.max(1, (Number(vpToWin) || 10) / 10);
  const r = Math.max(1, Number(boardRadius) || 2);
  const h = 3 * r * (r + 1) + 1;
  const mapMult = h <= 19 ? 1 : Math.sqrt(h / 19);
  return Math.ceil(base * vpMult * mapMult);
}
