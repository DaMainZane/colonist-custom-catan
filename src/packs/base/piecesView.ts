// MODULE: generic per-player piece and action view data (R8.6: pieces[id] = { left, cost, spots } for every PieceDef and ActionDef with a visual) | DEPENDS ON: packs/base/building, shared/index | USED BY: packs/base/index
import { currentPlayer, getPlayer, makeCtx, VIEW_DATA } from '../../shared';
import type { Ctx, GameState, Id, PackApi, PlayerState, Registry, Resources, ViewDataDef, ViewWho } from '../../shared';
import { pieceCost, validateBuild } from './building';

/** Per-player data for one manifest piece or action (R8.6, matches `PiecePlayerData` in `shared/visual.ts`). */
export interface PiecePlayerData {
  left: number | null;
  cost: Resources;
  spots: number[] | null;
}

/**
 * Same phase and actor gate that `checkAction` / `dispatch` in `shared/engine.ts` uses before calling `def.validate`:
 * the game is not over, the player exists, the current phase lists `actionType`, and `def.actor ?? phase.actor`
 * (or `currentPlayer(g)?.id === pid` by default) allows `pid` to act right now.
 */
function canActInPhase(g: GameState, reg: Registry, pid: Id, actionType: string): boolean {
  if (g.phase === 'gameover') return false;
  if (!getPlayer(g, pid)) return false;
  const phase = reg.phases.get(g.phase);
  const def = reg.actions.get(actionType);
  if (!phase || !def || !phase.actions.includes(actionType)) return false;
  const rule = def.actor ?? phase.actor;
  return rule ? !!rule(g, pid) : currentPlayer(g)?.id === pid;
}

/**
 * Computes `PlayerView.pieces` for one player `p` and viewer `who`.
 * Returns `undefined` when the registry has no piece or action with a `visual` (base game).
 * When at least one piece or action in `reg` has a `visual`, returns a map containing only the defs
 * currently available to `p` (`available(g, p.id) !== false`), with no `undefined` values inside any present key.
 */
export function piecesForPlayer(
  g: GameState,
  reg: Registry,
  p: PlayerState,
  who: ViewWho
): Record<string, PiecePlayerData> | undefined {
  let hasAnyVisual = false;
  for (const def of reg.pieces.values()) {
    if ((def as any).visual) {
      hasAnyVisual = true;
      break;
    }
  }
  if (!hasAnyVisual) {
    for (const def of reg.actions.values()) {
      if ((def as any).visual) {
        hasAnyVisual = true;
        break;
      }
    }
  }
  if (!hasAnyVisual) return undefined;

  const ctx: Ctx = makeCtx(g, reg);
  const out: Record<string, PiecePlayerData> = {};
  const canBuildNow = who.self && !who.over && canActInPhase(g, reg, p.id, 'build');

  for (const [id, def] of reg.pieces.entries()) {
    if (!(def as any).visual) continue;
    if (def.available && !def.available(g, p.id)) continue;

    const left: number | null = p.pieces[id] ?? null;
    const cost: Resources = pieceCost(g, p, def, reg);
    let spots: number[] | null = null;
    if (canBuildNow) {
      const count = def.target === 'vertex' ? g.board.vertices.length : g.board.edges.length;
      spots = [];
      for (let loc = 0; loc < count; loc++) {
        if (validateBuild(ctx, p.id, { piece: id, loc }) === null) spots.push(loc);
      }
    }
    out[id] = { left, cost, spots };
  }

  for (const [type, def] of reg.actions.entries()) {
    const visual = (def as any).visual;
    if (!visual) continue;
    const availableFn = (def as any).available as ((g: GameState, pid: Id) => boolean) | undefined;
    if (availableFn && !availableFn(g, p.id)) continue;

    const priceFn = (def as any).price as ((g: GameState, reg: Registry, pid: Id) => Resources) | undefined;
    const cost: Resources = priceFn ? priceFn(g, reg, p.id) : {};
    let spots: number[] | null = null;
    if (who.self && !who.over && canActInPhase(g, reg, p.id, type)) {
      const spotKey: string | undefined = visual.spotKey;
      const raw = def.legal ? def.legal(ctx, p.id) : [];
      const seen = new Set<number>();
      for (const payload of raw) {
        if (def.validate(ctx, p.id, payload ?? {}) !== null) continue;
        const loc = spotKey ? payload?.[spotKey] : undefined;
        if (typeof loc === 'number' && Number.isFinite(loc)) seen.add(loc);
      }
      spots = [...seen].sort((a, b) => a - b);
    }
    out[type] = { left: null, cost, spots };
  }

  return out;
}

/**
 * Always-on `VIEW_DATA` entry (`base.pieces_view`) registered in `basePack.register`.
 * Must be one entry across the whole registry because `mergeViewPlayer` keeps only the first entry per top-level key.
 */
export const piecesViewData: ViewDataDef = {
  id: 'base.pieces_view',
  player: (g, reg, p, who) => ({
    pieces: piecesForPlayer(g, reg, p, who)
  })
};

export function registerPiecesView(api: PackApi): void {
  api.define(VIEW_DATA, piecesViewData);
}
