// MODULE: tidebound.rickety_bridges addon (T4a rickety bridge piece: 1 wood, health 1, shared pool and shared 2x cost with bridges, bot goal; T4b upgrade to a full bridge; T4d collapse on a 7 in Seven Resolver; T4e Longest Road recalc) | USED BY: packs/tidebound, tests
import {
  aboveBaseLimit,
  BOT_GOALS,
  canAfford,
  COST_MODS,
  damagePiece,
  doubledCost,
  DURABILITY_DEFS,
  getPlayer,
  payToBank,
  placedCount,
  priceOf,
  priceOfUpgrade,
  SEVEN_STEP_ORDER,
  SEVEN_STEPS,
  totalCards,
  updateAwards
} from '../../shared';
import type {
  ActionDef,
  AddonDef,
  BotGoalDef,
  BotGoalItem,
  CostModifier,
  Ctx,
  DurabilityDef,
  GameState,
  Id,
  PieceDef,
  PlayerState,
  Registry,
  Resources,
  SevenStepDef
} from '../../shared';
import { BRIDGE, BRIDGE_BASE_LIMIT, bridgeBotGoal, bridgePiece, canPlaceBridge } from './bridges';

export const RICKETY = 'rickety_bridge';
export const RICKETY_COST: Resources = { wood: 1 };
/** Health of a rickety bridge. One hit (rolling a 7, T4d) breaks it. */
export const RICKETY_HEALTH = 1;
/** Price of turning a rickety bridge into a full bridge. Together with the 1 wood it adds up to the full bridge price. */
export const RICKETY_UPGRADE_COST: Resources = { brick: 1, ore: 1 };
/** Id that cost modifiers see for the upgrade (see `priceOfUpgrade`). */
export const RICKETY_UPGRADE_ID = 'upgrade_rickety_bridge';
/** Action type of the upgrade. */
export const UPGRADE_BRIDGE = 'upgrade_bridge';
/** Seven Resolver step id for collapsing rickety bridges on a 7 (T4d). */
export const RICKETY_SEVEN_STEP_ID = 'tidebound.rickety_collapse';

// ---- Shared pool ---------------------------------------------------------------------------------------

/** Bridges plus rickety bridges this player has on the board. They share one pool, one cap and one 2x-cost threshold. */
export function bridgesOnBoard(g: GameState, pid: Id): number {
  return placedCount(g, pid, BRIDGE) + placedCount(g, pid, RICKETY);
}

/**
 * Keeps the two supplies equal to the shared pool: cap (`rules.pieceLimits.bridge`, already scaled by radius and VP) minus what is on the board.
 * The engine reads one counter per piece id (`p.pieces[id]`), so the pool is kept as two mirrored counters and this puts both right.
 * It is cheap and safe to call at any time. T4d MUST call it after `damagePiece` breaks a rickety bridge, because that hands the piece
 * back to the rickety counter only.
 */
export function syncBridgePool(g: GameState, pid: Id): void {
  const p = getPlayer(g, pid);
  if (!p) return;
  const cap = g.rules.pieceLimits?.[BRIDGE] ?? BRIDGE_BASE_LIMIT;
  const left = Math.max(0, cap - bridgesOnBoard(g, pid));
  p.pieces[BRIDGE] = left;
  p.pieces[RICKETY] = left;
}

// ---- T4a: the piece ------------------------------------------------------------------------------------

export const ricketyPiece: PieceDef = {
  id: RICKETY,
  name: 'Rickety bridge',
  target: 'edge',
  cost: RICKETY_COST,
  vp: 0,
  produces: 0,
  baseLimit: BRIDGE_BASE_LIMIT,
  // Counts for Longest Road and connects like a bridge. Collapse on a 7 and the Longest Road recalculation come in T4d and T4e.
  roadLike: true,
  scaleWithRadius: true,
  icon: '🪵',
  // Same rule as a bridge: ocean edges only, joined to your own building or road-like piece.
  canPlace: canPlaceBridge
};

/** Health 1. Nothing breaks it yet (T4d). `repairCost` is a placeholder: at full health 1 a repair is never legal. */
export const ricketyDurability: DurabilityDef = {
  id: 'tidebound.rickety',
  pieceId: RICKETY,
  maxDurability: RICKETY_HEALTH,
  repairCost: { wood: 1 }
};

/**
 * One 2x threshold for the whole pool: with 10 bridges and rickety bridges together on the board, the next of either costs double.
 * `priceOf` already doubles a piece when ITS OWN count has reached the base limit, so this only adds the doubling for the case where the
 * own count is below it but the pool is not (5 bridges + 5 rickety). Everything else, the upgrade price included, passes through.
 */
export const ricketyPoolCostMod: CostModifier = {
  id: 'tidebound.rickety_pool',
  apply(g: GameState, p: PlayerState, def: PieceDef, cost: Resources): Resources {
    if (def.id !== BRIDGE && def.id !== RICKETY) return cost;
    if (aboveBaseLimit(g, p, def)) return cost;
    return bridgesOnBoard(g, p.id) >= (def.baseLimit ?? BRIDGE_BASE_LIMIT) ? doubledCost(cost) : cost;
  }
};

// ---- T4b: upgrade to a full bridge ----------------------------------------------------------------------

/** What this player pays to upgrade one rickety bridge: 1 brick + 1 ore, doubled once the pool is at the base limit, then the cost modifiers. */
export function upgradeBridgeCost(g: GameState, reg: Registry, p: PlayerState): Resources {
  const base = bridgesOnBoard(g, p.id) >= BRIDGE_BASE_LIMIT ? doubledCost(RICKETY_UPGRADE_COST) : RICKETY_UPGRADE_COST;
  return priceOfUpgrade(g, reg, p, RICKETY_UPGRADE_ID, base);
}

/**
 * What the client needs to draw the upgrade button (T4c): this player's upgrade price, or `undefined` when rickety bridges are not in the game
 * (DLC or addon off), so a game without them sends nothing new.
 */
export function bridgeUpgradeView(g: GameState, reg: Registry, p: PlayerState): Resources | undefined {
  return reg.pieces.has(RICKETY) ? upgradeBridgeCost(g, reg, p) : undefined;
}

/**
 * Upgrade: a rickety bridge you own becomes a full bridge in place. Payload `{ edgeId }`.
 * The pool does not change (the edge keeps holding one piece), so neither does the supply; the piece stays road-like, so Longest Road is untouched.
 */
export const upgradeBridgeAction: ActionDef = {
  type: UPGRADE_BRIDGE,
  validate(ctx: Ctx, pid: Id, payload: any): string | null {
    const { g, reg } = ctx;
    const p = getPlayer(g, pid);
    if (!p) return 'Unknown player';
    const e = Number.isInteger(payload?.edgeId) ? g.board.edges[payload.edgeId] : undefined;
    if (!e) return 'Choose a rickety bridge';
    if (!e.piece || e.piece.owner !== pid || e.piece.type !== RICKETY) return 'Only your own rickety bridge can be upgraded';
    if (!canAfford(p, upgradeBridgeCost(g, reg, p))) return 'Not enough resources to upgrade a bridge';
    return null;
  },
  apply(ctx: Ctx, pid: Id, payload: any): void {
    const { g, reg } = ctx;
    const p = getPlayer(g, pid)!;
    // Price first: the cost reads the board, which is about to change.
    payToBank(ctx, p, upgradeBridgeCost(g, reg, p));
    g.board.edges[payload.edgeId].piece = { type: BRIDGE, owner: pid };
    syncBridgePool(g, pid);
    p.stats.bridgesUpgraded = (p.stats.bridgesUpgraded || 0) + 1;
    ctx.emit('bridgeUpgraded', { playerId: pid, edgeId: payload.edgeId, from: RICKETY, to: BRIDGE });
    ctx.log(`🌉 ${p.avatar} ${p.name} upgraded a rickety bridge to a full bridge`, p.color);
  },
  legal(ctx: Ctx, pid: Id): { edgeId: number }[] {
    const out: { edgeId: number }[] = [];
    for (const e of ctx.g.board.edges) {
      if (e.piece?.owner === pid && e.piece.type === RICKETY) out.push({ edgeId: e.id });
    }
    return out;
  }
};

// ---- Minimal bot support (T4a build, T4b upgrade) -------------------------------------------------------------

/**
 * Build: when a bot has a bridge spot in mind (the bridge goal's best edge) but cannot pay for a full bridge, it offers the cheap
 * version of the same edge a little below the bridge's priority. Upgrade: a bot upgrades when the hand still holds 3+ cards afterwards.
 * Tuning (Main builds blindly, Secondary prices the expected lifetime) is T13.
 */
export const ricketyBotGoal: BotGoalDef = {
  id: 'tidebound.rickety_bridges',
  goalClass: 'generic',
  goals(ctx: Ctx, pid: Id): BotGoalItem[] {
    const p = getPlayer(ctx.g, pid);
    if (!p || (p.pieces[RICKETY] ?? 0) <= 0) return [];
    if (canAfford(p, priceOf(ctx.g, ctx.reg, p, bridgePiece))) return [];
    const best = bridgeBotGoal.goals ? bridgeBotGoal.goals(ctx, pid)[0] : undefined;
    const loc = best?.action?.payload?.loc;
    if (!best || !Number.isInteger(loc)) return [];
    return [{
      id: `rickety:${loc}`,
      priority: best.priority - 12,
      cost: priceOf(ctx.g, ctx.reg, p, ricketyPiece),
      action: { type: 'build', payload: { piece: RICKETY, loc } },
      needsTags: ['sea']
    }];
  },
  actionScore(ctx: Ctx, pid: Id, action: { type: string; payload: any }): number {
    if (action.type !== UPGRADE_BRIDGE) return 0;
    const p = getPlayer(ctx.g, pid);
    if (!p) return 0;
    const cost = upgradeBridgeCost(ctx.g, ctx.reg, p);
    const paid = Object.values(cost).reduce((a, n) => a + (n || 0), 0);
    return totalCards(p) - paid >= 3 ? 30 : 0;
  }
};

// ---- T4d: collapse on a 7 (Seven Resolver) & T4e: Longest Road recalculation ---------------------------

/**
 * On a 7, every rickety bridge on the board takes 1 damage (`RICKETY_HEALTH = 1`), breaks, and returns to the
 * owner's shared bridge pool (`syncBridgePool`). Then `updateAwards(ctx)` recalculates Longest Road and emits
 * `awardChanged` if the holder lost or handed off the award (recorded in the S0.10 public change log).
 * Draws zero values from `g.rng`.
 */
export const ricketyCollapseStep: SevenStepDef = {
  id: RICKETY_SEVEN_STEP_ID,
  order: SEVEN_STEP_ORDER.decay,
  isDlcSideEffect: true,
  priority: 85,
  canFire(ctx: Ctx): boolean {
    return ctx.g.board.edges.some(e => e.piece?.type === RICKETY);
  },
  run(ctx: Ctx): void {
    const { g } = ctx;
    const owners = new Set<Id>();
    const counts = new Map<Id, number>();
    for (const e of g.board.edges) {
      if (e.piece?.type !== RICKETY) continue;
      const ownerId = e.piece.owner;
      const res = damagePiece(ctx, 'edge', e.id, 1);
      if (res.broken) {
        owners.add(ownerId);
        counts.set(ownerId, (counts.get(ownerId) || 0) + 1);
      }
    }
    for (const ownerId of owners) {
      syncBridgePool(g, ownerId);
      const p = getPlayer(g, ownerId);
      const n = counts.get(ownerId) || 0;
      if (p && n > 0) {
        p.stats.ricketyCollapsed = (p.stats.ricketyCollapsed || 0) + n;
        ctx.log(`💥 ${p.avatar} ${p.name}'s ${n === 1 ? 'rickety bridge' : `${n} rickety bridges`} collapsed on a 7!`, p.color);
      }
    }
    if (owners.size > 0) {
      updateAwards(ctx);
    }
  }
};

export const ricketyBridgesAddon: AddonDef = {
  id: 'tidebound.rickety_bridges',
  name: 'Rickety bridges',
  description: 'A cheap bridge with 1 health that collapses on a 7. Upgrade it to a full bridge later.',
  deps: ['tidebound.bridges'],
  links: [
    { target: 'durability', kind: 'mechanic' },
    { target: 'seven-resolver', kind: 'mechanic' },
    { target: 'piece-cost', kind: 'mechanic' },
    { target: 'overlay', kind: 'ui' },
    { target: 'bot-goals', kind: 'bot' },
    { target: 'tidebound.bridges', kind: 'content' }
  ],
  rules: {
    // Same base as bridges, and `scaleWithRadius` scales it the same way, so the two supplies start equal (see `syncBridgePool`).
    pieceLimits: { [RICKETY]: BRIDGE_BASE_LIMIT }
  },
  register(api) {
    api.piece(ricketyPiece);
    api.define(DURABILITY_DEFS, ricketyDurability);
    api.define(COST_MODS, ricketyPoolCostMod);
    api.define(BOT_GOALS, ricketyBotGoal);
    api.define(SEVEN_STEPS, ricketyCollapseStep);
    api.action(upgradeBridgeAction);
    api.phaseAction('main', UPGRADE_BRIDGE);
    // Shared pool: after either kind is built, put both supplies right.
    api.hook('onBuild', (ctx: Ctx, def: PieceDef, pid: Id) => {
      if (def.id === BRIDGE || def.id === RICKETY) syncBridgePool(ctx.g, pid);
    });
  }
};
