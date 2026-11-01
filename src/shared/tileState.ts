// MODULE: S0.7 tile state layer (service 7), durability & repair (service 8), and wild token (service 12) | DEPENDS ON: shared/ctx, shared/registry, shared/state, shared/types | USED BY: packs/tidebound/risingSea, packs/tidebound/tides, shared/eventDeck, shared/index, shared/production, shared/sevenResolver, +1 more
import type { Ctx } from './ctx';
import { defsOf } from './registry';
import type { ActionDef, Registry } from './registry';
import { bankGive, canAfford, getPlayer, payToBank } from './state';
import type { GameState, Hex, Id, Resources } from './types';

// ---- Service 7: Tile State Layer (`tile-state`) -------------------------

export const TILE_STATES = 'tileStates';

export type TileStateId =
  | 'flooded'
  | 'drowned'
  | 'silt'
  | 'ash'
  | 'fertile'
  | 'barren'
  | 'crater'
  | 'plagued'
  | 'oasis'
  | string;

export interface HexTileState {
  id: TileStateId;
  /** Round at which this tile state expires or transitions to `nextState`. */
  until?: number;
  /** Optional wall zone id enclosing this hex. */
  zoneId?: string;
  /** Optional pack/addon payload. */
  data?: Record<string, any>;
}

export interface TileStateDef {
  id: TileStateId;
  name: string;
  blocksProduction?: boolean;
  yieldDelta?: number;
  yieldMultiplier?: number;
  yieldRound?: 'floor' | 'ceil' | 'round';
  blocksRobber?: boolean;
  /** Automatic transition when `until` expires (e.g. `ash` -> `fertile` for 2 rounds, `flooded` -> `silt` for 1 round). */
  nextState?: { id: TileStateId; duration?: number };
  replace?: boolean;
}

const DEFAULT_TILE_STATES: Record<string, TileStateDef> = {
  flooded: { id: 'flooded', name: 'Flooded', yieldMultiplier: 0.5, yieldRound: 'ceil', blocksRobber: true, nextState: { id: 'silt', duration: 1 } },
  drowned: { id: 'drowned', name: 'Drowned', blocksProduction: true, blocksRobber: true },
  silt: { id: 'silt', name: 'Silt', yieldDelta: 1 },
  ash: { id: 'ash', name: 'Volcanic Ash', blocksProduction: true, nextState: { id: 'fertile', duration: 2 } },
  fertile: { id: 'fertile', name: 'Fertile Soil', yieldDelta: 1 },
  barren: { id: 'barren', name: 'Barren', blocksProduction: true },
  crater: { id: 'crater', name: 'Meteor Crater', blocksProduction: true },
  plagued: { id: 'plagued', name: 'Plagued', yieldMultiplier: 0.5 },
  oasis: { id: 'oasis', name: 'Oasis', blocksProduction: false }
};

export function resolveTileStateDef(reg: Registry, stateId: TileStateId): TileStateDef | undefined {
  return defsOf<TileStateDef>(reg, TILE_STATES).get(stateId) ?? DEFAULT_TILE_STATES[stateId];
}

/** Reads the typed `hex.ext.state` on a hex, or null if none is active. */
export function getTileState(hex: Hex | undefined): HexTileState | null {
  if (!hex || !hex.ext || !hex.ext.state || typeof hex.ext.state !== 'object') return null;
  const st = hex.ext.state as HexTileState;
  return typeof st.id === 'string' && st.id ? st : null;
}

/** Sets or clears `hex.ext.state` on a hex. */
export function setTileState(g: GameState, hexId: number, state: HexTileState | null): void {
  const hex = g.board.hexes[hexId];
  if (!hex) return;
  hex.ext = hex.ext || {};
  if (!state) {
    delete hex.ext.state;
  } else {
    hex.ext.state = { ...state };
  }
}

/** True if the robber cannot be placed on this hex due to its tile state (`flooded`, `drowned`, etc.). */
export function isHexRobberBlocked(g: GameState, reg: Registry, hexId: number): boolean {
  const hex = g.board.hexes[hexId];
  const st = getTileState(hex);
  if (!st) return false;
  return !!resolveTileStateDef(reg, st.id)?.blocksRobber;
}

/** Reader used by the production pipeline: adjusts base yield according to the hex's active tile state. */
export function applyTileStateToYield(g: GameState, reg: Registry, hex: Hex, baseAmount: number): number {
  if (baseAmount <= 0) return 0;
  const st = getTileState(hex);
  if (!st) return baseAmount;
  if (st.until !== undefined && g.round > st.until) return baseAmount;
  const def = resolveTileStateDef(reg, st.id);
  if (!def) return baseAmount;
  if (def.blocksProduction) return 0;
  let out = baseAmount;
  if (typeof def.yieldMultiplier === 'number') {
    const raw = out * def.yieldMultiplier;
    const rounded =
      def.yieldRound === 'ceil'
        ? Math.ceil(raw)
        : def.yieldRound === 'round'
          ? Math.round(raw)
          : Math.floor(raw);
    out = Math.max(0, rounded);
  }
  if (typeof def.yieldDelta === 'number') {
    out = Math.max(0, out + def.yieldDelta);
  }
  return out;
}

/** Advances and expires timed tile states at round start/end, transitioning to `nextState` when configured. */
export function tickTileStates(ctx: Ctx): void {
  const { g, reg } = ctx;
  for (const hex of g.board.hexes) {
    const st = getTileState(hex);
    if (!st || st.until === undefined) continue;
    if (g.round >= st.until) {
      const def = resolveTileStateDef(reg, st.id);
      if (def?.nextState) {
        const nextUntil = def.nextState.duration ? g.round + def.nextState.duration : undefined;
        setTileState(g, hex.id, { id: def.nextState.id, until: nextUntil, zoneId: st.zoneId });
        ctx.emit('tileStateChanged', { hexId: hex.id, from: st.id, to: def.nextState.id });
      } else {
        setTileState(g, hex.id, null);
        ctx.emit('tileStateChanged', { hexId: hex.id, from: st.id, to: null });
      }
    }
  }
}

// ---- Service 8: Durability and Repair (`durability`) --------------------

export const DURABILITY_DEFS = 'durabilityDefs';

export interface DurabilityDef {
  id: string;
  pieceId: string;
  maxDurability: number;
  repairCost: Resources;
  /** True for permanent tiers (e.g. stone wall) that do not decay on a 7. */
  permanent?: boolean;
  replace?: boolean;
}

function durKey(target: 'vertex' | 'edge', loc: number): string {
  return `${target === 'vertex' ? 'v' : 'e'}:${loc}`;
}

function ensureDurabilityMap(g: GameState): Record<string, number> {
  g.ext = g.ext || {};
  g.ext.core = g.ext.core || {};
  g.ext.core.durability = g.ext.core.durability || {};
  return g.ext.core.durability;
}

export function durabilityDefForPiece(reg: Registry, pieceId: string): DurabilityDef | undefined {
  for (const d of defsOf<DurabilityDef>(reg, DURABILITY_DEFS).values()) {
    if (d.pieceId === pieceId || d.id === pieceId) return d;
  }
  return undefined;
}

/** Returns current durability of a placed piece, or its `maxDurability` if untouched, or null if the piece has no durability. */
export function getPieceDurability(
  g: GameState,
  reg: Registry,
  target: 'vertex' | 'edge',
  loc: number
): number | null {
  const slot = target === 'vertex' ? g.board.vertices[loc] : g.board.edges[loc];
  if (!slot?.piece) return null;
  const def = durabilityDefForPiece(reg, slot.piece.type);
  if (!def) return null;
  const map = g.ext?.core?.durability as Record<string, number> | undefined;
  const key = durKey(target, loc);
  const stored = map?.[key];
  return typeof stored === 'number' ? stored : def.maxDurability;
}

export function setPieceDurability(g: GameState, target: 'vertex' | 'edge', loc: number, value: number): void {
  const map = ensureDurabilityMap(g);
  map[durKey(target, loc)] = Math.max(0, Math.floor(value));
}

/** Applies durability damage to a piece. At 0 durability the piece breaks, is removed from the board, and returns to supply. */
export function damagePiece(
  ctx: Ctx,
  target: 'vertex' | 'edge',
  loc: number,
  amount = 1
): { broken: boolean; remaining: number } {
  const { g, reg } = ctx;
  const slot = target === 'vertex' ? g.board.vertices[loc] : g.board.edges[loc];
  if (!slot?.piece) return { broken: false, remaining: 0 };
  const def = durabilityDefForPiece(reg, slot.piece.type);
  if (!def) return { broken: false, remaining: 0 };
  if (def.permanent) return { broken: false, remaining: def.maxDurability };

  const cur = getPieceDurability(g, reg, target, loc) ?? def.maxDurability;
  const next = Math.max(0, cur - Math.max(0, amount));
  if (next <= 0) {
    const owner = getPlayer(g, slot.piece.owner);
    const pieceType = slot.piece.type;
    if (owner) owner.pieces[pieceType] = (owner.pieces[pieceType] || 0) + 1;
    slot.piece = null;
    if (g.ext?.core?.durability) delete g.ext.core.durability[durKey(target, loc)];
    ctx.emit('pieceBroken', { target, loc, piece: pieceType, ownerId: owner?.id ?? null });
    return { broken: true, remaining: 0 };
  }
  setPieceDurability(g, target, loc, next);
  ctx.emit('pieceDamaged', { target, loc, piece: slot.piece.type, ownerId: slot.piece.owner, remaining: next });
  return { broken: false, remaining: next };
}

/** Validates a repair on a damaged vertex/edge piece. Returns null if legal, or an error string. */
export function validateRepairPiece(
  ctx: Ctx,
  pid: Id,
  target: 'vertex' | 'edge',
  loc: number
): string | null {
  const { g, reg } = ctx;
  const slot = target === 'vertex' ? g.board.vertices[loc] : g.board.edges[loc];
  if (!slot?.piece) return 'No piece at that location';
  if (slot.piece.owner !== pid) return 'You can only repair your own pieces';
  const def = durabilityDefForPiece(reg, slot.piece.type);
  if (!def) return 'That piece does not use durability';
  const cur = getPieceDurability(g, reg, target, loc) ?? def.maxDurability;
  if (cur >= def.maxDurability) return 'Piece is already at full durability';
  const p = getPlayer(g, pid);
  if (!p || !canAfford(p, def.repairCost)) return 'Not enough resources to repair';
  return null;
}

/** Executes a repair on a damaged piece, restoring it to `maxDurability`. */
export function repairPiece(
  ctx: Ctx,
  pid: Id,
  target: 'vertex' | 'edge',
  loc: number
): string | null {
  const err = validateRepairPiece(ctx, pid, target, loc);
  if (err) return err;
  const { g, reg } = ctx;
  const p = getPlayer(g, pid)!;
  const slot = (target === 'vertex' ? g.board.vertices[loc] : g.board.edges[loc])!;
  const def = durabilityDefForPiece(reg, slot.piece!.type)!;
  payToBank(ctx, p, def.repairCost);
  setPieceDurability(g, target, loc, def.maxDurability);
  p.stats.repairs = (p.stats.repairs || 0) + 1;
  ctx.emit('pieceRepaired', { playerId: pid, target, loc, piece: slot.piece!.type, durability: def.maxDurability });
  ctx.log(`🔨 ${p.avatar} ${p.name} repaired ${slot.piece!.type}`, p.color);
  return null;
}

/** Shared repair action definition (`repair_piece`) usable by walls, rickety bridges, nets, and gates. */
export const repairPieceAction: ActionDef = {
  type: 'repair_piece',
  validate(ctx, pid, payload) {
    const target = payload?.target === 'vertex' ? 'vertex' : payload?.target === 'edge' ? 'edge' : null;
    if (!target || !Number.isInteger(payload?.loc)) return 'Invalid repair target';
    return validateRepairPiece(ctx, pid, target, payload.loc);
  },
  apply(ctx, pid, payload) {
    repairPiece(ctx, pid, payload.target, payload.loc);
  },
  legal(ctx, pid) {
    const { g, reg } = ctx;
    const p = getPlayer(g, pid);
    if (!p) return [];
    const out: { target: 'vertex' | 'edge'; loc: number }[] = [];
    for (const v of g.board.vertices) {
      if (v.piece?.owner === pid && validateRepairPiece(ctx, pid, 'vertex', v.id) === null) {
        out.push({ target: 'vertex', loc: v.id });
      }
    }
    for (const e of g.board.edges) {
      if (e.piece?.owner === pid && validateRepairPiece(ctx, pid, 'edge', e.id) === null) {
        out.push({ target: 'edge', loc: e.id });
      }
    }
    return out;
  }
};

// ---- Service 12: Wild Token (`wild-token`) ------------------------------

export const WILD_TOKENS = 'wildTokens';

export interface WildTokenDef {
  id: string;
  name: string;
  /** Whether held tokens of this kind count toward hand discard limit on a 7 (e.g. fish = true). */
  countInDiscard?: boolean;
  /** Whether held tokens of this kind can be stolen by the robber (e.g. fish = true). */
  stealable?: boolean;
  replace?: boolean;
}

const BUILTIN_WILD_IDS = new Set(['gold', 'fish', 'oasis', 'wild']);

/** True if `resId` is a wild token (excluded from bank supply caps and the "no one has X to trade" check). */
export function isWildTokenResource(reg: Registry, resId: string): boolean {
  if (BUILTIN_WILD_IDS.has(resId) && !reg.resources.has(resId)) return true;
  return defsOf<WildTokenDef>(reg, WILD_TOKENS).has(resId);
}

/** Grants immediate wild resource pick(s) (generalizing the Gold pick flow: sets `p.pending.pick`). */
export function grantWildPick(ctx: Ctx, pid: Id, amount = 1, source = 'gold', hexId?: number): void {
  const p = getPlayer(ctx.g, pid);
  if (!p || amount <= 0) return;
  p.pending.pick = (p.pending.pick || 0) + amount;
  if (source === 'gold') {
    ctx.emit('goldEarned', { hexId: hexId ?? -1, playerId: pid, amount });
    ctx.log(`${p.avatar} ${p.name} earned ${amount} Gold pick(s)!`, p.color);
  } else {
    ctx.emit('wildPickEarned', { source, hexId: hexId ?? -1, playerId: pid, amount });
    ctx.log(`${p.avatar} ${p.name} earned ${amount} ${source} wild pick(s)!`, p.color);
  }
}

function ensureWildTokenStore(g: GameState, pid: Id): Record<string, number> {
  g.ext = g.ext || {};
  g.ext.core = g.ext.core || {};
  g.ext.core.wildTokens = g.ext.core.wildTokens || {};
  g.ext.core.wildTokens[pid] = g.ext.core.wildTokens[pid] || {};
  return g.ext.core.wildTokens[pid];
}

/** Gives held wild tokens (such as `fish` or `oasis` tokens) that sit in the player's reserve until spent as any 1 resource. */
export function grantWildToken(ctx: Ctx, pid: Id, tokenId: string, amount = 1): number {
  const p = getPlayer(ctx.g, pid);
  if (!p || amount <= 0) return 0;
  const store = ensureWildTokenStore(ctx.g, pid);
  store[tokenId] = (store[tokenId] || 0) + amount;
  ctx.emit('wildTokenGranted', { playerId: pid, tokenId, amount });
  return amount;
}

/** Returns how many held wild tokens of `tokenId` (or all wild tokens combined if omitted) a player holds. */
export function getWildTokens(g: GameState, pid: Id, tokenId?: string): number {
  const store = g.ext?.core?.wildTokens?.[pid] as Record<string, number> | undefined;
  if (!store) return 0;
  if (tokenId) return store[tokenId] || 0;
  return Object.values(store).reduce((a, b) => a + (b || 0), 0);
}

/** Spends held wild token(s) to receive `targetResource` from the bank (or adds a pending pick if `targetResource` is omitted). */
export function spendWildToken(
  ctx: Ctx,
  pid: Id,
  tokenId: string,
  targetResource?: string,
  amount = 1
): number {
  const have = getWildTokens(ctx.g, pid, tokenId);
  const use = Math.min(have, Math.max(0, amount));
  if (use <= 0) return 0;
  const store = ensureWildTokenStore(ctx.g, pid);
  store[tokenId] -= use;
  if (targetResource && ctx.reg.resources.has(targetResource)) {
    const granted = bankGive(ctx, pid, targetResource, use);
    ctx.emit('wildTokenSpent', { playerId: pid, tokenId, resource: targetResource, amount: granted });
    return granted;
  }
  grantWildPick(ctx, pid, use, tokenId);
  return use;
}

/** Held wild tokens as a plain `{ tokenId: count }` object (zero entries left out). Only ever sent to the owner (or to everyone after the game). */
export function wildTokensOf(g: GameState, pid: Id): Record<string, number> {
  const store = g.ext?.core?.wildTokens?.[pid] as Record<string, number> | undefined;
  const out: Record<string, number> = {};
  if (!store) return out;
  for (const [id, n] of Object.entries(store)) if (n > 0) out[id] = n;
  return out;
}

/** Held tokens that count toward a 7 discard (`countInDiscard`). 0 when no such token is registered for this game. */
export function countableWildTokens(g: GameState, reg: Registry, pid: Id): number {
  let n = 0;
  for (const wt of defsOf<WildTokenDef>(reg, WILD_TOKENS).values()) {
    if (wt.countInDiscard) n += getWildTokens(g, pid, wt.id);
  }
  return n;
}

/** Held tokens the robber can steal (`stealable`). 0 when no such token is registered for this game. */
export function stealableWildTokens(g: GameState, reg: Registry, pid: Id): number {
  let n = 0;
  for (const wt of defsOf<WildTokenDef>(reg, WILD_TOKENS).values()) {
    if (wt.stealable) n += getWildTokens(g, pid, wt.id);
  }
  return n;
}

/** Tokens that make a hand look bigger to the table: they count for a discard or can be stolen. Added to `resourceCount` in the views. */
export function visibleWildCards(g: GameState, reg: Registry, pid: Id): number {
  let n = 0;
  for (const wt of defsOf<WildTokenDef>(reg, WILD_TOKENS).values()) {
    if (wt.countInDiscard || wt.stealable) n += getWildTokens(g, pid, wt.id);
  }
  return n;
}

/** Removes held tokens and gives nothing back (a discard, a theft). The caller says where they went. Returns how many were removed. */
export function takeWildToken(g: GameState, pid: Id, tokenId: string, amount = 1): number {
  const n = Math.min(getWildTokens(g, pid, tokenId), Math.max(0, Math.floor(amount)));
  if (n <= 0) return 0;
  ensureWildTokenStore(g, pid)[tokenId] -= n;
  return n;
}
