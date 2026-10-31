// MODULE: template lantern addon (R9 proof piece: a one-file vertex piece with a visual, a score and a bot goal; needs no edit outside this file and its test) | DEPENDS ON: packs/base/placement, shared/index | USED BY: packs/_template/addons.generated
//
// R9 PROOF. Everything a new piece needs is in this file:
//   - `lanternPiece`: the rules (`canPlace`, price, supply, score) and the look (`visual`: button, hints, shape).
//   - `lanternBotGoal`: how bots use it.
//   - `lanternAddon`: registers both, plus the supply (`rules.pieceLimits`).
// No `server/`, `client/`, `public/` or `shared/` edit, and no VIEW_DATA entry: `base.pieces_view` sends `pieces[id] = { left, cost, spots }` for any piece that has a
// `visual`, the build button, spot markers and placed shape come from the manifest, and the `place` socket event builds any registered piece.
// Delete this file and run `npm run addons` to take the piece out again.
import { BOT_GOALS, getPlayer, placedCount, priceOf, totalCards } from '../../shared';
import type { AddonDef, BotGoalDef, BotGoalItem, Ctx, Id, PieceDef, Resources } from '../../shared';
import { ownsRoadAt } from '../base/placement';

/** Piece id. Also the key of `rules.pieceLimits` and of `p.pieces` (the supply left). */
export const LANTERN = 'template_lantern';
/** Base price. It overlaps no other price (a road is wood + brick, a development card is sheep + wheat + ore), so a hand of exactly this can only buy a lantern. */
export const LANTERN_COST: Resources = { ore: 2, wheat: 1 };
/** Supply per player. */
export const LANTERN_LIMIT = 3;

/** Placement rule only (geometry and ownership); the base `build` action checks the price and the supply. An empty land corner next to a road, bridge or other edge piece you own. */
export function canPlaceLantern(ctx: Ctx, pid: Id, vertexId: number, mode: 'setup' | 'build'): boolean {
  if (mode !== 'build') return false;
  const v = ctx.g.board.vertices[vertexId];
  if (!v || v.piece || v.hexIds.length === 0) return false;
  return v.edgeIds.some(edgeId => ownsRoadAt(ctx, pid, edgeId));
}

export const lanternPiece: PieceDef = {
  id: LANTERN,
  name: 'Lantern',
  target: 'vertex',
  cost: LANTERN_COST,
  vp: 1,
  produces: 0,
  icon: '🏮',
  canPlace: canPlaceLantern,
  visual: {
    slot: 'vertex',
    button: {
      label: 'Lantern',
      // Inner shapes of a 24x24 box, drawn with `currentColor` (the client wraps them in an <svg>).
      icon: '<path d="M9 3h6"/><path d="M10 3v2M14 3v2"/><rect x="7" y="5" width="10" height="13" rx="3"/><path d="M12 9v5"/><path d="M9 21h6"/>',
      order: 60
    },
    hints: {
      noSupply: 'No lanterns left',
      cannotAfford: 'A lantern costs 2 ore and 1 wheat',
      noSpots: 'Build a lantern on a free corner next to one of your roads'
    },
    // Drawn around (0,0) inside a +-12 box. `{color}` is the owner's colour, `{dark}` a darker shade of it.
    shape:
      '<path d="M-5 10 L-6 -3 L6 -3 L5 10 Z" fill="{color}" stroke="{dark}" stroke-width="1.2"/>'
      + '<path d="M-7 -3 L0 -11 L7 -3 Z" fill="{dark}"/>'
      + '<circle cx="0" cy="2" r="2.2" fill="#ffd45e"/>'
  }
};

/** Lanterns a bot keeps on the board (all of its supply). */
export const LANTERN_BOT_MAX = LANTERN_LIMIT;

/**
 * A bot builds a lantern on the free corner next to its own edge pieces that touches the most land tiles (lowest id on a tie). The goal names the price, so
 * a missing card feeds the bot's trade logic like any other build goal. `goalClass: 'generic'` makes it active for every bot tier.
 */
export const lanternBotGoal: BotGoalDef = {
  id: 'template.lantern',
  goalClass: 'generic',
  goals(ctx: Ctx, pid: Id): BotGoalItem[] {
    const { g, reg } = ctx;
    const p = getPlayer(g, pid);
    if (!p || (p.pieces[LANTERN] ?? 0) <= 0) return [];
    if (placedCount(g, pid, LANTERN) >= LANTERN_BOT_MAX) return [];
    const cost = priceOf(g, reg, p, lanternPiece);
    const price = Object.values(cost).reduce((a, n) => a + (n || 0), 0);
    if (totalCards(p) < price) return [];

    const corners = new Set<number>();
    for (const e of g.board.edges) {
      if (e.piece?.owner !== pid) continue;
      corners.add(e.v1);
      corners.add(e.v2);
    }
    let bestLoc = -1;
    let bestLand = -1;
    for (const vId of [...corners].sort((a, b) => a - b)) {
      if (!canPlaceLantern(ctx, pid, vId, 'build')) continue;
      const land = g.board.vertices[vId].hexIds.length;
      if (land > bestLand) {
        bestLand = land;
        bestLoc = vId;
      }
    }
    if (bestLoc < 0) return [];
    return [{
      id: `lantern:${bestLoc}`,
      priority: 50 + bestLand,
      cost,
      action: { type: 'build', payload: { piece: LANTERN, loc: bestLoc } },
      needsTags: ['vp']
    }];
  }
};

export const lanternAddon: AddonDef = {
  id: 'template.lantern',
  name: 'Lantern',
  description: 'Proof piece for the modular rework: a one-file vertex piece with a button, spots, a shape, a score and a bot goal. Copy it, never ship it.',
  // Rule of Two: at least 2 distinct links, at least one to a General service (`GENERAL_SERVICE_IDS` in shared/addons.ts).
  links: [
    { target: 'piece-cost', kind: 'mechanic' },
    { target: 'score', kind: 'mechanic' },
    { target: 'bot-goals', kind: 'bot' }
  ],
  // The supply: `pieceLimits` is what gives each player this many lanterns at game start.
  rules: { pieceLimits: { [LANTERN]: LANTERN_LIMIT } },
  register(api) {
    api.piece(lanternPiece);
    api.define(BOT_GOALS, lanternBotGoal);
  }
};
