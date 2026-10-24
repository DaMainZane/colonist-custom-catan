// MODULE: engine helpers (players, bank, costs, phases, production, VP, turn start) | USED BY: engine, packs, bots
import type { Ctx } from './ctx';
import type { Registry } from './registry';
import type { GameState, Hex, Id, PlayerState, Resources } from './types';

export function getPlayer(g: GameState, id: Id): PlayerState | undefined {
  return g.players.find(p => p.id === id);
}

export function currentPlayer(g: GameState): PlayerState {
  return g.players[g.turn];
}

export function totalCards(p: PlayerState): number {
  let n = 0;
  for (const k in p.resources) n += p.resources[k] || 0;
  return n;
}

export function canAfford(p: PlayerState, cost: Resources): boolean {
  return Object.entries(cost).every(([r, n]) => (p.resources[r] || 0) >= n);
}

/** Player pays a cost; the cards go back to the bank. */
export function payToBank(ctx: Ctx, p: PlayerState, cost: Resources): void {
  for (const [r, n] of Object.entries(cost)) {
    if (!n) continue;
    p.resources[r] = (p.resources[r] || 0) - n;
    ctx.g.bank[r] = (ctx.g.bank[r] || 0) + n;
  }
}

/** Gives up to n cards from the bank (never more than the bank holds). Returns the amount granted. */
export function bankGive(ctx: Ctx, pid: Id, res: string, n: number): number {
  const p = getPlayer(ctx.g, pid);
  if (!p || n <= 0 || !(res in ctx.g.bank)) return 0;
  const granted = Math.min(n, ctx.g.bank[res]);
  if (granted <= 0) return 0;
  ctx.g.bank[res] -= granted;
  p.resources[res] = (p.resources[res] || 0) + granted;
  p.stats.earned = (p.stats.earned || 0) + granted;
  return granted;
}

/** Unique owners of vertex pieces around a hex. */
export function ownersOnHex(g: GameState, hex: Hex): Id[] {
  const out = new Set<Id>();
  for (const vId of hex.vertexIds) {
    const pc = g.board.vertices[vId].piece;
    if (pc) out.add(pc.owner);
  }
  return [...out];
}

/** Applies a hex's production to one player (tile.onProduce, or its resource if it has one). */
export function produceFromHex(ctx: Ctx, hex: Hex, ownerId: Id, amount: number): void {
  const tile = ctx.reg.tiles.get(hex.type);
  if (!tile) return;
  if (tile.onProduce) {
    tile.onProduce(ctx, hex, ownerId, amount);
    return;
  }
  if (!tile.produces) return;
  const granted = bankGive(ctx, ownerId, tile.produces, amount);
  if (granted > 0) {
    ctx.emit('produced', { hexId: hex.id, playerId: ownerId, resource: tile.produces, amount: granted });
  }
}

export function computeVP(g: GameState, reg: Registry, p: PlayerState, includeHidden: boolean): number {
  let vp = 0;
  for (const v of g.board.vertices) {
    if (v.piece && v.piece.owner === p.id) vp += reg.pieces.get(v.piece.type)?.vp || 0;
  }
  for (const e of g.board.edges) {
    if (e.piece && e.piece.owner === p.id) vp += reg.pieces.get(e.piece.type)?.vp || 0;
  }
  for (const a of reg.awards.values()) {
    if (g.awards[a.id] === p.id) vp += a.vp;
  }
  if (includeHidden) {
    for (const c of [...p.devCards, ...p.newDevCards]) vp += reg.devcards.get(c)?.vp || 0;
  }
  for (const hook of reg.hooks.vp) vp += Number(hook(g, reg, p, includeHidden)) || 0;
  return vp;
}

// ---- Phases -------------------------------------------------------------

function enterPhase(ctx: Ctx, id: string): void {
  const from = ctx.g.phase;
  const old = ctx.reg.phases.get(from);
  if (old?.onExit) old.onExit(ctx);
  const next = ctx.reg.phases.get(id);
  if (!next) throw new Error(`Unknown phase "${id}"`);
  ctx.g.phase = id;
  if (next.onEnter) next.onEnter(ctx);
  ctx.emit('phaseChanged', { from, to: id });
}

/** Replaces the current phase (the return stack is untouched). */
export function setPhase(ctx: Ctx, id: string): void {
  enterPhase(ctx, id);
}

/** Enters a sub-phase and remembers the current one to return to. */
export function pushPhase(ctx: Ctx, id: string): void {
  ctx.g.phaseStack.push(ctx.g.phase);
  enterPhase(ctx, id);
}

/** Returns to the phase that was active before the last pushPhase. */
export function popPhase(ctx: Ctx, fallback = 'main'): void {
  const back = ctx.g.phaseStack.pop() || fallback;
  enterPhase(ctx, back);
}

export function startTurn(ctx: Ctx): void {
  for (const p of ctx.g.players) p.flags = {};
  for (const hook of ctx.reg.hooks.onTurnStart) hook(ctx);
  setPhase(ctx, 'roll');
  ctx.emit('turnStarted', { playerId: currentPlayer(ctx.g).id, turnCount: ctx.g.turnCount });
}
