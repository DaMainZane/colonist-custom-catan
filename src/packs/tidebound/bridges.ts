// MODULE: tidebound.bridges addon (wide-water map perk + T3 Bridge piece, ocean placement rule, 2x cost past 10 or 14 with Rickety bridges tech, Longest Road, bot goal, T11f demolish_bridge action & Grand Causeway 16 VP hook) | USED BY: packs/tidebound, tests
import {
  addWaterTopology,
  bankGive,
  BOT_GOALS,
  COST_MODS,
  doubledCost,
  getPlayer,
  hasTech,
  priceOf,
  updateAwards
} from '../../shared';
import type {
  ActionDef,
  AddonDef,
  BotGoalDef,
  BotGoalItem,
  Ctx,
  GameState,
  Id,
  PieceDef,
  Registry,
  Resources
} from '../../shared';
import { SETTLEMENT } from '../base/constants';
import { ownsRoadAt } from '../base/placement';
import {
  bridgesOnBoard,
  effectiveBridgeBaseLimit,
  RICKETY,
  RICKETY_COST,
  ricketyPoolCostMod,
  syncBridgePool
} from './ricketyBridges';
import { applyElevation, placeFish } from './seaData';
import { grandCausewayVpHook, registerTideboundTechs, TECH_SALVAGE_CREW } from './tech';

export const BRIDGE = 'bridge';
export const BRIDGE_BASE_LIMIT = 10;
export const BRIDGE_COST: Resources = { wood: 1, brick: 1, ore: 1 };
/** Action type: remove one of your own bridges or rickety bridges for `floor(paid / 2)` cards back from the bank (T11f, unlocked by Salvage crew). */
export const DEMOLISH_BRIDGE = 'demolish_bridge';

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

// ---- T11f: demolish_bridge action (unlocked by Salvage crew) ---------------------------------------------------

/**
 * Paid resource bundle for `pid`'s `pieceType` (`bridge` or `rickety_bridge`) given the current bridge count on the board.
 * When `bridgesOnBoard(g, pid) > effectiveBridgeBaseLimit(g, pid)`, the latest bridge was built above the 1x cap at 2x cost.
 */
export function bridgePaidResources(g: GameState, reg: Registry, pid: Id, pieceType: string): Resources {
  const def = reg.pieces.get(pieceType);
  const baseCost = def?.cost ?? (pieceType === RICKETY ? RICKETY_COST : BRIDGE_COST);
  const limit = effectiveBridgeBaseLimit(g, pid, def?.baseLimit ?? BRIDGE_BASE_LIMIT);
  return bridgesOnBoard(g, pid) > limit ? doubledCost(baseCost) : { ...baseCost };
}

/**
 * Computes the refund (`floor(paid / 2)` cards from the bank) when `pid` demolishes a `bridge` or `rickety_bridge`.
 * Prefers refunding the resources in the bridge's cost (`wood`, `brick`, `ore` for a bridge; `wood` for a rickety bridge)
 * while the bank has them in stock, falling back to any other stocked bank resource if a pile is empty.
 */
export function bridgeDemolishRefund(
  g: GameState,
  reg: Registry,
  pid: Id,
  pieceType: string
): { paidCards: number; refundCards: number; resources: Resources } {
  const paid = bridgePaidResources(g, reg, pid, pieceType);
  const paidCards = Object.values(paid).reduce((a, b) => a + (Number(b) || 0), 0);
  const refundCards = Math.floor(paidCards / 2);
  const resources: Resources = {};
  if (refundCards <= 0) return { paidCards, refundCards: 0, resources };

  const preferredOrder = Object.keys(paid).filter(r => (paid[r] || 0) > 0);
  const fallbackOrder = [...reg.resources.keys()].filter(r => !preferredOrder.includes(r));
  const order = [...preferredOrder, ...fallbackOrder];

  const simBank: Record<string, number> = { ...g.bank };
  let rem = refundCards;
  // First pass: take up to `paid[r]` from the preferred resources in round-robin order
  let progress = true;
  while (rem > 0 && progress) {
    progress = false;
    for (const r of preferredOrder) {
      if (rem <= 0) break;
      if ((simBank[r] || 0) > 0 && (resources[r] || 0) < (paid[r] || 0)) {
        resources[r] = (resources[r] || 0) + 1;
        simBank[r] -= 1;
        rem -= 1;
        progress = true;
      }
    }
  }
  // Second pass: if a preferred bank pile was empty, fill any remaining refund cards from other stocked piles
  progress = true;
  while (rem > 0 && progress) {
    progress = false;
    for (const r of order) {
      if (rem <= 0) break;
      if ((simBank[r] || 0) > 0) {
        resources[r] = (resources[r] || 0) + 1;
        simBank[r] -= 1;
        rem -= 1;
        progress = true;
      }
    }
  }

  return { paidCards, refundCards, resources };
}

/** Validates whether `pid` can demolish the bridge or rickety bridge on `edgeId`. Returns an error string or `null`. */
export function canDemolishBridge(g: GameState, pid: Id, edgeId: number): string | null {
  const p = getPlayer(g, pid);
  if (!p) return 'Unknown player';
  if (!hasTech(g, pid, TECH_SALVAGE_CREW)) return 'Research Salvage crew first';
  const e = Number.isInteger(edgeId) ? g.board.edges[edgeId] : undefined;
  if (!e || !e.piece || e.piece.owner !== pid || (e.piece.type !== BRIDGE && e.piece.type !== RICKETY)) {
    return 'Choose one of your own bridges or rickety bridges';
  }
  return null;
}

/**
 * `demolish_bridge` action (T11f, unlocked by `tidebound.salvage_crew`):
 * Removes one of `pid`'s own bridges or rickety bridges, refunds `floor(paid / 2)` cards from the bank,
 * frees the shared bridge cap slot (`syncBridgePool`), and recalculates Longest Road (`updateAwards`).
 */
export const demolishBridgeAction: ActionDef = {
  type: DEMOLISH_BRIDGE,
  validate(ctx: Ctx, pid: Id, payload: any): string | null {
    return canDemolishBridge(ctx.g, pid, payload?.edgeId);
  },
  apply(ctx: Ctx, pid: Id, payload: any): void {
    const { g, reg } = ctx;
    const p = getPlayer(g, pid)!;
    const edgeId = Number(payload.edgeId);
    const e = g.board.edges[edgeId]!;
    const fromType = e.piece!.type;

    // Compute the refund before removing the piece so `bridgesOnBoard` reflects the count when it stood.
    const { paidCards, refundCards, resources } = bridgeDemolishRefund(g, reg, pid, fromType);

    e.piece = null;
    if (g.ext?.core?.durability) {
      delete g.ext.core.durability[`edge:${edgeId}`];
    }
    syncBridgePool(g, pid);

    let refunded = 0;
    for (const [r, n] of Object.entries(resources)) {
      if (n > 0) refunded += bankGive(ctx, pid, r, n);
    }

    p.stats.bridgesDemolished = (p.stats.bridgesDemolished || 0) + 1;
    updateAwards(ctx);

    ctx.emit('bridgeDemolished', {
      playerId: pid,
      edgeId,
      piece: fromType,
      paidCards,
      refundCards,
      refunded,
      resources
    });
    const label = fromType === RICKETY ? 'rickety bridge' : 'bridge';
    ctx.log(
      `🪓 ${p.avatar} ${p.name} demolished a ${label}${refunded > 0 ? ` and salvaged ${refunded} card${refunded === 1 ? '' : 's'}` : ''}`,
      p.color
    );
  },
  legal(ctx: Ctx, pid: Id): { edgeId: number }[] {
    const { g } = ctx;
    if (!hasTech(g, pid, TECH_SALVAGE_CREW)) return [];
    const out: { edgeId: number }[] = [];
    for (const e of g.board.edges) {
      if (e.piece?.owner === pid && (e.piece.type === BRIDGE || e.piece.type === RICKETY)) {
        out.push({ edgeId: e.id });
      }
    }
    return out;
  }
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
    api.define(COST_MODS, ricketyPoolCostMod);
    api.define(BOT_GOALS, bridgeBotGoal);
    registerTideboundTechs(api);
    api.action(demolishBridgeAction);
    api.phaseAction('main', DEMOLISH_BRIDGE);
    api.hook('vp', grandCausewayVpHook);
    api.hook('onBuild', (ctx: Ctx, def: PieceDef, pid: Id) => {
      if (def.id === BRIDGE || def.id === RICKETY) syncBridgePool(ctx.g, pid);
    });
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

