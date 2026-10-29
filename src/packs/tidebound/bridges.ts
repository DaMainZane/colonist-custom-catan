// MODULE: tidebound.bridges addon (wide-water map perk + T3 Bridge piece, ocean placement rule, 2x cost past 10, Longest Road, and bot goal) | USED BY: packs/tidebound, tests
import { addWaterTopology, BOT_GOALS, getPlayer, priceOf } from '../../shared';
import type { AddonDef, BotGoalDef, BotGoalItem, Ctx, Id, PieceDef, Resources } from '../../shared';
import { SETTLEMENT } from '../base/constants';
import { ownsRoadAt } from '../base/placement';
import { applyElevation, placeFish } from './seaData';

export const BRIDGE = 'bridge';
export const BRIDGE_BASE_LIMIT = 10;
export const BRIDGE_COST: Resources = { wood: 1, brick: 1, ore: 1 };

/**
 * True when both sides ("lengths") of the edge touch ocean tiles (no adjacent land hex along the edge).
 * Endpoint vertices may sit on a coastal corner (shared by 1 land hex and 2 water hexes) or in open water.
 */
export function isOceanEdge(ctx: Ctx, edgeId: number): boolean {
  const e = ctx.g.board.edges[edgeId];
  return !!e && e.hexIds.length === 0;
}

/**
 * T3a: Bridge placement rule.
 * - Cannot be placed during setup (`mode === 'build'` only).
 * - Both sides of the edge must touch ocean tiles (`isOceanEdge`: `e.hexIds.length === 0`).
 * - Must connect to an endpoint vertex that either has a building owned by `pid`, or is unblocked
 *   (no opponent building) and has at least one road-like edge piece (`road` or `bridge`) owned by `pid`.
 */
export function canPlaceBridge(ctx: Ctx, pid: Id, edgeId: number, mode: 'setup' | 'build'): boolean {
  if (mode !== 'build') return false;
  const e = ctx.g.board.edges[edgeId];
  if (!e || e.piece) return false;
  if (!isOceanEdge(ctx, edgeId)) return false;

  for (const vId of [e.v1, e.v2]) {
    const v = ctx.g.board.vertices[vId];
    if (!v) continue;
    if (v.piece?.owner === pid) return true;
    if (v.piece && v.piece.owner !== pid) continue;
    if (v.edgeIds.some(other => ownsRoadAt(ctx, pid, other))) return true;
  }
  return false;
}

export const bridgePiece: PieceDef = {
  id: BRIDGE,
  name: 'Bridge',
  target: 'edge',
  cost: BRIDGE_COST,
  vp: 0,
  produces: 0,
  baseLimit: BRIDGE_BASE_LIMIT,
  roadLike: true,
  scaleWithRadius: true,
  icon: '🌉',
  canPlace: canPlaceBridge
};

/**
 * T3e: Minimal bot goal for Bridges.
 * Finds legal ocean edges for `pid` and prioritizes bridges that reach or step toward open land settlement spots
 * across water (or extend the player's road/bridge network).
 */
export const bridgeBotGoal: BotGoalDef = {
  id: 'tidebound.bridges',
  goalClass: 'generic',
  goals(ctx: Ctx, pid: Id): BotGoalItem[] {
    const p = getPlayer(ctx.g, pid);
    if (!p || (p.pieces[BRIDGE] ?? 0) <= 0) return [];
    const settleDef = ctx.reg.pieces.get(SETTLEMENT);
    const { vertices, edges } = ctx.g.board;

    let bestEdgeId = -1;
    let bestScore = -1;

    for (const e of edges) {
      if (!canPlaceBridge(ctx, pid, e.id, 'build')) continue;
      let score = 52;
      for (const vId of [e.v1, e.v2]) {
        const v = vertices[vId];
        if (!v) continue;
        // Direct landing on an open coastal settlement spot
        if (settleDef && settleDef.canPlace(ctx, pid, vId, 'setup')) {
          score = Math.max(score, 84);
        } else {
          // One step away from an open coastal settlement spot
          for (const adjV of v.adjacentVertices) {
            if (settleDef && settleDef.canPlace(ctx, pid, adjV, 'setup')) {
              score = Math.max(score, 72);
            }
          }
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestEdgeId = e.id;
      }
    }

    if (bestEdgeId < 0) return [];
    return [{
      id: `bridge:${bestEdgeId}`,
      priority: bestScore,
      cost: priceOf(ctx.g, ctx.reg, p, bridgePiece),
      action: { type: 'build', payload: { piece: BRIDGE, loc: bestEdgeId } },
      needsTags: ['sea']
    }];
  },
  edgeDelta(ctx: Ctx, pid: Id, edgeId: number): number {
    if (!isOceanEdge(ctx, edgeId)) return 0;
    const e = ctx.g.board.edges[edgeId];
    if (!e) return 0;
    const settleDef = ctx.reg.pieces.get(SETTLEMENT);
    for (const vId of [e.v1, e.v2]) {
      if (settleDef && settleDef.canPlace(ctx, pid, vId, 'setup')) return 18;
    }
    return 6;
  }
};

export const bridgesAddon: AddonDef = {
  id: 'tidebound.bridges',
  name: 'Bridges',
  description: 'Roads across the sea. Both ends must touch ocean; they count toward Longest Road.',
  links: [
    { target: 'piece-cost', kind: 'mechanic' },
    { target: 'history', kind: 'mechanic' },
    { target: 'bot-goals', kind: 'bot' }
  ],
  rules: {
    pieceLimits: {
      [BRIDGE]: BRIDGE_BASE_LIMIT
    }
  },
  register(api) {
    // Crossing capability unlocks islands/archipelago map shapes and water edge topology.
    api.capability('crossing');
    api.piece(bridgePiece);
    api.define(BOT_GOALS, bridgeBotGoal);
    // Ensure custom/prepared boards passed into createGame also have water edges populated when Bridges is enabled.
    api.hook('onGameStart', ctx => {
      addWaterTopology(
        ctx.g.board,
        t => !!ctx.reg.tiles.get(t)?.land,
        t => !!ctx.reg.tiles.get(t)?.noPort
      );
    });

    // T2a/T2b/T2b2/T2c, wide water. Data only: nothing runs during a game. The shape stage reads the `water.extra` param (see shared/mapshape.ts and
    // packs/base/map/shapes.ts) and grows the canvas around the normal map, so with this pick off the generator draws exactly what it drew before.
    // The same pick then writes the sea data later chunks read, with no RNG draws (see seaData.ts): `ext.elevation` 1 to 3 on land by ranked height
    // (higher is rarer) and `ext.fish` on seeded sea tiles.
    api.mapPerk({
      id: 'wide_water',
      label: 'Wide water',
      description: 'Seas and rivers several tiles wider. The board grows around the normal map to make room, so the land count stays the same. Land gets an elevation (1 to 3) and some sea tiles hold fish; both are used by later Tidebound features.',
      stage: 'extras',
      // The default hexagon has no sea to widen, so with this pick the map sits on a continent instead (same as the ragged coast).
      conflicts: ['hexagon'],
      params: [{ id: 'water.extra', label: 'Extra water width (tiles)', min: 1, max: 5, step: 1, default: 4 }],
      afterGenerated(inits, ctx, cells) {
        applyElevation(inits, cells);
        placeFish(inits, ctx);
      }
    });
  }
};

