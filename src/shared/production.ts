// MODULE: S0.6 production pipeline (service 6: ordered stages for number shift, tile state, base yield, piece multiplier, wild token, tax, bank-short, discard check) | USED BY: packs/base/actions/roll, DLC packs
import type { Ctx } from './ctx';
import { defsOf } from './registry';
import type { GameState, Hex, Id } from './types';
import { bankGive, produceFromHex } from './state';
import { applyTileStateToYield, getTileState, grantWildPick } from './tileState';

export const PRODUCTION_STEPS = 'productionSteps';

export const PRODUCTION_STAGE_ORDER = {
  roll: 0,
  numberShift: 10,
  tileState: 20,
  baseYield: 30,
  pieceMultiplier: 40,
  wildToken: 50,
  tax: 60,
  bankShort: 70,
  discardCheck: 80
} as const;

export interface ProductionItem {
  hex: Hex;
  vertexId: number;
  ownerId: Id;
  pieceType: string;
  /** Current yield amount as it flows through the pipeline stages. */
  amount: number;
  /** Target resource id (null when the tile uses `onProduce` or wild picks). */
  resource: string | null;
  /** Set true by a stage to cancel remaining production for this vertex. */
  blocked?: boolean;
  /** Optional wild token source (e.g. 'oasis', 'gold', 'fish') if converted to a wild pick. */
  wildSource?: string;
  /** Optional tax recipient player id and amount redirected by zone tax. */
  taxRecipientId?: Id;
  taxAmount?: number;
}

export interface ProductionStepDef {
  id: string;
  order: number;
  run(ctx: Ctx, item: ProductionItem, sum?: number): void;
  replace?: boolean;
}

/** Effective roll number of a hex after any active seasonal or event `numberShift` (`hex.ext.numberShift`). */
export function effectiveHexNumber(g: GameState, hex: Hex): number | null {
  if (hex.number === null || hex.number === undefined) return null;
  const shift = Number(hex.ext?.numberShift) || 0;
  if (!shift) return hex.number;
  const shifted = hex.number + shift;
  return Math.max(2, Math.min(12, shifted === 7 ? (shift > 0 ? 8 : 6) : shifted));
}

/** Hexes that match a dice roll `sum` (respecting hidden fog, robber, land flag, and effective shifted number). */
export function matchingHexesForRoll(ctx: Ctx, sum: number): Hex[] {
  const { g, reg } = ctx;
  return g.board.hexes.filter(
    h => !h.ext.hidden && effectiveHexNumber(g, h) === sum && h.id !== g.board.robberHexId && reg.tiles.get(h.type)?.land
  );
}

/**
 * Runs the ordered S0.6 production pipeline for a list of matching hexes on roll `sum`.
 * When no DLC tile states or custom production steps are active, behavior is bit-for-bit identical to base `produceFromHex`.
 */
export function runProductionPipeline(ctx: Ctx, hexes: Hex[], sum?: number): void {
  const { g, reg } = ctx;
  const customSteps = [...defsOf<ProductionStepDef>(reg, PRODUCTION_STEPS).values()].sort(
    (a, b) => a.order - b.order
  );

  for (const hex of hexes) {
    const tile = reg.tiles.get(hex.type);
    if (!tile) continue;
    for (const vId of hex.vertexIds) {
      const piece = g.board.vertices[vId]?.piece;
      if (!piece) continue;
      const baseAmount = reg.pieces.get(piece.type)?.produces || 0;
      if (baseAmount <= 0) continue;

      const hasTileState = !!getTileState(hex);
      if (!hasTileState && customSteps.length === 0) {
        produceFromHex(ctx, hex, piece.owner, baseAmount);
        continue;
      }

      const item: ProductionItem = {
        hex,
        vertexId: vId,
        ownerId: piece.owner,
        pieceType: piece.type,
        amount: baseAmount,
        resource: tile.produces ?? null
      };

      const runRange = (minOrder: number, maxOrder: number) => {
        for (const step of customSteps) {
          if (step.order >= minOrder && step.order < maxOrder && !item.blocked) {
            step.run(ctx, item, sum);
          }
        }
      };

      // Stage 10-20: pre-tile-state steps
      runRange(-Infinity, PRODUCTION_STAGE_ORDER.tileState);

      // Stage 20: tile state check (`flooded`, `drowned`, `ash`, `barren`, `fertile`, `silt`, `plagued`, `oasis`)
      if (!item.blocked && hasTileState) {
        const st = getTileState(hex);
        if (st?.id === 'oasis') {
          item.wildSource = 'oasis';
        }
        item.amount = applyTileStateToYield(g, reg, hex, item.amount);
        if (item.amount <= 0) item.blocked = true;
      }

      // Stage 20-70: base yield, piece multiplier, wild token conversion, tax
      runRange(PRODUCTION_STAGE_ORDER.tileState, PRODUCTION_STAGE_ORDER.bankShort);

      if (item.blocked || item.amount <= 0) continue;

      // Deliver wild picks or tile.onProduce or bank resources (with optional tax split)
      if (item.wildSource) {
        grantWildPick(ctx, item.ownerId, item.amount, item.wildSource, hex.id);
      } else if (tile.onProduce) {
        tile.onProduce(ctx, hex, item.ownerId, item.amount);
      } else if (item.resource) {
        const taxAmt =
          item.taxRecipientId && item.taxRecipientId !== item.ownerId
            ? Math.min(item.amount, Math.max(0, item.taxAmount || 0))
            : 0;
        const ownerAmt = item.amount - taxAmt;
        if (ownerAmt > 0) {
          const granted = bankGive(ctx, item.ownerId, item.resource, ownerAmt);
          if (granted > 0) {
            ctx.emit('produced', { hexId: hex.id, playerId: item.ownerId, resource: item.resource, amount: granted });
          }
        }
        if (taxAmt > 0 && item.taxRecipientId) {
          const taxed = bankGive(ctx, item.taxRecipientId, item.resource, taxAmt);
          if (taxed > 0) {
            ctx.emit('produced', {
              hexId: hex.id,
              playerId: item.taxRecipientId,
              resource: item.resource,
              amount: taxed,
              taxedFrom: item.ownerId
            });
          }
        }
      }

      // Stage 70+: bank-short and post-production discard checks
      runRange(PRODUCTION_STAGE_ORDER.bankShort, Infinity);
    }
  }
}
