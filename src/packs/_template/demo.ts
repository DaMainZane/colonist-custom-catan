// MODULE: template addon (copy this file to start a new addon: one vertex piece, one action, one tech node, a bot goal stub, a client view function; not part of any shipped pack) | DEPENDS ON: packs/base/techEffects, shared/index | USED BY: packs/_template/index
//
// HOW TO USE THIS FILE (see RECIPES.md for the full steps)
//   1. Copy it to `src/packs/<dlc>/<name>.ts`.
//   2. Rename: the `template` prefix in every id (`template.demo` becomes `<dlc>.<name>`), `BEACON`, `TIP_BEACON`, `TECH_DEMO`, `demo*`.
//   3. Delete the parts you do not need (a piece only, an action only, ...). Every part works on its own.
//   4. Add the addon to the pack's `addons` array in `packs/<dlc>/index.ts`, after its deps, and export what the server or client imports.
//   5. Run `npm run headers:write`, `npm run index`, `npm run typecheck`, `npm test`.
//
// Rules this file follows (EXTENSION POINTS.md has the rest):
//   - Everything is registered inside `register`, so a disabled addon changes nothing.
//   - No `g.rng` draws. If you need randomness, derive a stream (see `deriveTideRng` in `packs/tidebound/tides.ts`).
//   - `legal` must not use the RNG: bots and the fuzz tests call it.
import {
  addonOn,
  BOT_GOALS,
  canAfford,
  getPlayer,
  makeCtx,
  payToBank,
  priceOf,
  TECH_DEFS,
  VIEW_DATA,
  techGate
} from '../../shared';
import type {
  ActionDef,
  AddonDef,
  BotGoalDef,
  Ctx,
  GameState,
  Id,
  PackApi,
  PieceDef,
  PlayerState,
  Registry,
  Resources,
  TechDef,
  ViewDataDef
} from '../../shared';
import { TECH_HARBOR_CHARTERS } from '../base/techEffects';

// ---- Ids and numbers ---------------------------------------------------------------------------------------------

/** Piece id. Also the key of `rules.pieceLimits` and of `p.pieces` (the supply left). */
export const BEACON = 'template_beacon';
/** Base price. Always read the price through `priceOf`, so cost modifiers (`COST_MODS`) apply. */
export const BEACON_COST: Resources = { wood: 1, brick: 1 };
/** Supply per player. */
export const BEACON_LIMIT = 3;
/** Action type. */
export const TIP_BEACON = 'template_tip_beacon';
/** Price of the action. */
export const TIP_COST: Resources = { wheat: 1 };
/** Tech id: `<packId>.<name>`. */
export const TECH_DEMO = 'template.demo_tech';

// ---- Piece (recipe 1) --------------------------------------------------------------------------------------------

/**
 * Placement rule only (geometry and ownership). The base `build` action checks cost and supply. A tech gate belongs here (`techGate` is true when the tech tree is off).
 */
export function canPlaceBeacon(ctx: Ctx, pid: Id, vertexId: number, mode: 'setup' | 'build'): boolean {
  if (mode !== 'build') return false;
  if (!techGate(ctx.g, pid, TECH_DEMO)) return false;
  const v = ctx.g.board.vertices[vertexId];
  if (!v || v.piece) return false;
  return v.edgeIds.some(edgeId => ctx.g.board.edges[edgeId]?.piece?.owner === pid);
}

export const beaconPiece: PieceDef = {
  id: BEACON,
  name: 'Beacon',
  target: 'vertex',
  cost: BEACON_COST,
  vp: 0,
  produces: 0,
  icon: '🔆',
  canPlace: canPlaceBeacon
};

/** Vertex ids of the beacons `pid` has on the board. */
export function beaconsOf(g: GameState, pid: Id): number[] {
  const out: number[] = [];
  for (const v of g.board.vertices) {
    if (v.piece?.owner === pid && v.piece.type === BEACON) out.push(v.id);
  }
  return out;
}

// ---- Action (recipe 2) -------------------------------------------------------------------------------------------

/** Payload `{ vertexId }`: pay `TIP_COST` to one of your beacons. Does nothing else; replace the body with your rule. */
export const tipBeaconAction: ActionDef = {
  type: TIP_BEACON,
  validate(ctx: Ctx, pid: Id, payload: any): string | null {
    const { g, reg } = ctx;
    if (!addonOn(reg, 'template.demo')) return 'The template demo is not in this game';
    const p = getPlayer(g, pid);
    if (!p) return 'Unknown player';
    if (!Number.isInteger(payload?.vertexId) || !beaconsOf(g, pid).includes(payload.vertexId)) return 'Choose one of your beacons';
    if (!canAfford(p, TIP_COST)) return 'Not enough resources';
    return null;
  },
  apply(ctx: Ctx, pid: Id, payload: any): void {
    const p = getPlayer(ctx.g, pid)!;
    payToBank(ctx, p, TIP_COST);
    p.stats.beaconsTipped = (p.stats.beaconsTipped || 0) + 1;
    ctx.emit('beaconTipped', { playerId: pid, vertexId: payload.vertexId });
    ctx.log(`🔆 ${p.avatar} ${p.name} tipped a beacon`, p.color);
  },
  /** Candidate payloads for bots and fuzz tests. The engine filters them through `validate`. */
  legal(ctx: Ctx, pid: Id): { vertexId: number }[] {
    const p = getPlayer(ctx.g, pid);
    if (!p || !canAfford(p, TIP_COST)) return [];
    return beaconsOf(ctx.g, pid).map(vertexId => ({ vertexId }));
  }
};

// ---- Tech node (recipe 4) ----------------------------------------------------------------------------------------

/**
 * `branch` and `path` place the node in the tech panel (look at the nodes in `packs/tidebound/tech.ts`); `prereq` is the node
 * above it; the cost comes from `costOffset` (see `Tech Tree Design.md`). `dlc` is the pack id that owns the node.
 */
export const demoTech: TechDef = {
  id: TECH_DEMO,
  name: 'Template demo tech',
  branch: 'tidebound',
  tier: 2,
  path: 'industrial',
  prereq: TECH_HARBOR_CHARTERS,
  costOffset: 3,
  dlc: 'template',
  description: 'Unlocks beacons.'
};

// ---- Data for the client (recipe 5) ------------------------------------------------------------------------------

/**
 * Vertices `p` can click to build a beacon on their own main-phase turn. Follows `harborSpotsView`: `undefined` when the feature is
 * off, locked or not the viewer's turn (so a game without it sends nothing new), `[]` when nothing is possible right now.
 * `demoViewData` below puts the result on the player view; `server/view.ts` needs no edit.
 */
export function beaconSpotsView(g: GameState, reg: Registry, p: PlayerState): number[] | undefined {
  if (!reg.pieces.has(BEACON)) return undefined;
  if (!techGate(g, p.id, TECH_DEMO)) return undefined;
  if (g.phase !== 'main' || g.players[g.turn]?.id !== p.id) return undefined;
  if ((p.pieces[BEACON] ?? 0) <= 0 || !canAfford(p, priceOf(g, reg, p, beaconPiece))) return [];
  const ctx = makeCtx(g, reg);
  return g.board.vertices.filter(v => canPlaceBeacon(ctx, p.id, v.id, 'build')).map(v => v.id);
}

/**
 * VIEW_DATA entry: the fields this addon adds to the state the client gets (`server/view.ts` merges every registered entry, so it needs no edit).
 * `player` returns fields for one player's view: `beaconsLeft` (the supply) for every viewer once unlocked, `beaconSpots` for yourself only.
 * A per-player field is `undefined` when it does not apply (JSON drops it). `shared` (public fields), `overlays` (tile tints) and `vpBonus`
 * work the same way; see `ViewDataDef` in `shared/viewData.ts`. Registered inside `register`, so a disabled addon adds nothing.
 */
export const demoViewData: ViewDataDef = {
  id: 'template.demo.view',
  player: (g, reg, p, who) => ({
    beaconsLeft: techGate(g, p.id, TECH_DEMO) ? p.pieces[BEACON] : undefined,
    beaconSpots: who.self ? beaconSpotsView(g, reg, p) : undefined
  })
};

// ---- Bot goal (stub) ---------------------------------------------------------------------------------------------

/**
 * `goals` returns the things this bot could work towards, each `{ id, priority, cost, action }` (see `harborBotGoal` in
 * `packs/tidebound/harbor.ts` for a full one). `actionScore` scores an action the brain already picked. Returning `[]` is valid.
 */
export const demoBotGoal: BotGoalDef = {
  id: 'template.demo',
  goalClass: 'generic',
  goals() {
    return [];
  }
};

// ---- The addon ---------------------------------------------------------------------------------------------------

export const demoAddon: AddonDef = {
  id: 'template.demo',
  name: 'Template demo',
  description: 'Example addon: a beacon piece you can tip. Copy it, never ship it.',
  // Rule of Two: at least 2 distinct links, at least one to a General service (`GENERAL_SERVICE_IDS` in shared/addons.ts).
  links: [
    { target: 'piece-cost', kind: 'mechanic' },
    { target: 'overlay', kind: 'ui' },
    { target: 'bot-goals', kind: 'bot' }
  ],
  // Rule defaults, merged only while the addon is on. `pieceLimits` is what gives each player a supply of the piece.
  rules: { pieceLimits: { [BEACON]: BEACON_LIMIT } },
  register(api: PackApi) {
    api.piece(beaconPiece);
    api.action(tipBeaconAction);
    api.phaseAction('main', TIP_BEACON);
    api.define(TECH_DEFS, demoTech);
    api.define(BOT_GOALS, demoBotGoal);
    api.define(VIEW_DATA, demoViewData);
    // Hooks and the other keyed registries (COST_MODS, SEVEN_STEPS, EVENT_CARDS, ...): see EXTENSION POINTS.md.
  }
};
