// MODULE: build validation and piece placement (cost, supply, upgrade, onBuild hooks) | USED BY: actions/build, setup
import { canAfford, getPlayer, payToBank } from '../../shared';
import type { Ctx, GameState, Id, PieceDef, PlayerState, Resources } from '../../shared';
import { CITY, ROAD, SETTLEMENT, SETUP_PIECE } from './constants';

export type BuildMode = 'setup' | 'build';

/** Base piece limits at the standard 10 VP setting. Pieces built beyond these limits cost double. */
export const BASE_PIECE_LIMITS: Record<string, number> = {
  [ROAD]: 15,
  [SETTLEMENT]: 5,
  [CITY]: 4
};

/** Returns true if the player has already placed at least the base limit of this piece type on the board. */
export function isAboveBaseLimit(g: GameState, p: PlayerState, pieceId: string): boolean {
  const baseLimit = BASE_PIECE_LIMITS[pieceId];
  if (!baseLimit) return false;
  const maxLimit = g.rules.pieceLimits?.[pieceId] ?? baseLimit;
  const left = p.pieces[pieceId] ?? 0;
  const activeOnBoard = maxLimit - left;
  return activeOnBoard >= baseLimit;
}

/** Effective resource cost for a piece: normal cost up to the base limit, double cost above the base limit. */
export function pieceCost(g: GameState, p: PlayerState, def: PieceDef): Resources {
  if (!isAboveBaseLimit(g, p, def.id)) return def.cost;
  const doubled: Resources = {};
  for (const [r, n] of Object.entries(def.cost)) {
    if (n) doubled[r] = n * 2;
  }
  return doubled;
}

/** setup phases place free pieces, the main phase places paid ones, anything else cannot build. */
export function buildMode(g: GameState): BuildMode | null {
  if (SETUP_PIECE[g.phase]) return 'setup';
  return g.phase === 'main' ? 'build' : null;
}

/** Road Building gives free roads (pending.freeRoads). */
export function isFree(p: PlayerState, def: PieceDef): boolean {
  return def.id === ROAD && (p.pending.freeRoads || 0) > 0;
}

export function validateBuild(ctx: Ctx, pid: Id, payload: any): string | null {
  const { g, reg } = ctx;
  const def = reg.pieces.get(payload?.piece);
  if (!def) return 'Unknown piece';
  const loc = payload.loc;
  if (!Number.isInteger(loc)) return 'Invalid location';
  const mode = buildMode(g);
  if (!mode) return 'Cannot build right now';
  if (mode === 'setup' && SETUP_PIECE[g.phase] !== def.id) return `Place a ${SETUP_PIECE[g.phase]} now`;

  const slots = def.target === 'vertex' ? g.board.vertices : g.board.edges;
  if (!slots[loc]) return 'Invalid location';

  const p = getPlayer(g, pid)!;
  if ((p.pieces[def.id] || 0) <= 0) return `No ${def.name} pieces left`;
  if (!def.canPlace(ctx, pid, loc, mode)) return `Cannot place a ${def.name} there`;
  const cost = pieceCost(g, p, def);
  if (mode === 'build' && !isFree(p, def) && !canAfford(p, cost)) return 'Not enough resources';
  return null;
}

export function placePiece(ctx: Ctx, pid: Id, def: PieceDef, loc: number, mode: BuildMode): void {
  const { g } = ctx;
  const p = getPlayer(g, pid)!;
  const overBase = mode === 'build' && !isFree(p, def) && isAboveBaseLimit(g, p, def.id);
  const cost = pieceCost(g, p, def);

  if (mode === 'build') {
    if (isFree(p, def)) p.pending.freeRoads--;
    else payToBank(ctx, p, cost);
  }

  const slot = def.target === 'vertex' ? g.board.vertices[loc] : g.board.edges[loc];
  if (def.upgradeFrom && slot.piece && slot.piece.type === def.upgradeFrom) {
    p.pieces[def.upgradeFrom] = (p.pieces[def.upgradeFrom] || 0) + 1;
  }
  slot.piece = { type: def.id, owner: pid };
  p.pieces[def.id]--;

  ctx.log(`${p.avatar} ${p.name} ${def.upgradeFrom ? 'upgraded to a' : 'placed a'} ${def.name}${overBase ? ' (2× cost)' : ''}`, p.color);
  ctx.emit('built', { playerId: pid, piece: def.id, target: def.target, loc, upgrade: !!def.upgradeFrom, doubleCost: overBase });
  for (const hook of ctx.reg.hooks.onBuild) hook(ctx, def, pid, loc);
}
