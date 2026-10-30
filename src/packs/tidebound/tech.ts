// MODULE: Tidebound tech tree nodes (T11a-T11f: 8 extension nodes across Expansion & Industrial paths, techGate re-export, Grand Causeway 16 VP hook, Harbor Empire ceil(V/2) bank card grant) | USED BY: packs/tidebound/*, server/view, server/bots, client/render/techpanel, tests
import {
  bankGive,
  createRng,
  getPlayer,
  hasTech,
  rngInt,
  TECH_DEFS,
  techBuildingValue,
  techGate
} from '../../shared';
import type {
  Ctx,
  Edge,
  GameState,
  Id,
  PackApi,
  PlayerState,
  Registry,
  RngState,
  TechDef
} from '../../shared';
import { TECH_HARBOR_CHARTERS } from '../base/techEffects';
import { BRIDGE, BRIDGE_BASE_LIMIT } from './bridges';
import { RICKETY, RICKETY_TECH_CAP_BONUS, syncBridgePool } from './ricketyBridges';

export { TECH_HARBOR_CHARTERS, techGate };

// ---- Tech IDs (Tech Tree Design.md §8) -------------------------------------------------------------------------

/** Tier 2 — Expansion path (`offset = 3`, cost 6 at V = 2): unlocks rickety bridges and raises normal bridge cap by +4 before 2x price. */
export const TECH_RICKETY_BRIDGES = 'tidebound.rickety_bridges';
/** Tier 2 — Industrial path (`offset = 3`, cost 6 at V = 2): unlocks fishing nets and allows upgrading a 3:1 port with a settlement to 2:1. */
export const TECH_FISHING_NETS = 'tidebound.fishing_nets';
/** Tier 3a — Expansion path (`offset = 5`, cost 9 at V = 2): +25% wreck loot, higher sea-wreck dev card chance, and unlocks `demolish_bridge`. */
export const TECH_SALVAGE_CREW = 'tidebound.salvage_crew';
/** Tier 3a — Industrial path (`offset = 5`, cost 9 at V = 2): net cost -1 wood, base catch chance 1 in 4 (boosted 1 in 2), 1 in 3 chance to save a fish boost. */
export const TECH_NET_WORKS = 'tidebound.net_works';
/** Tier 3b — Expansion path (`offset = 7`, cost 11 at V = 2): 2 fewer knights needed to beat pirates (min 1) and +50% pirate loot. */
export const TECH_PIRATE_HUNTER = 'tidebound.pirate_hunter';
/** Tier 3b — Industrial path (`offset = 7`, cost 11 at V = 2): unlocks Harbors (`upgrade_harbor`, 1:1 trade up to 4/turn) and Feed the Sea (`feed_sea`). */
export const TECH_HARBOR_MASTER = 'tidebound.harbor_master';
/** Tier 4 — Expansion path (`offset = 10`, cost 15 at V = 2): Longest Road is worth 16 VP instead of 2 (+14 VP) when the road includes a bridge or rickety bridge. */
export const TECH_GRAND_CAUSEWAY = 'tidebound.grand_causeway';
/** Tier 4 — Industrial path (`offset = 10`, cost 15 at V = 2): +1 harbor limit (2 total) and grants `ceil(V / 2)` random cards from the bank on unlock. */
export const TECH_HARBOR_EMPIRE = 'tidebound.harbor_empire';

/** Total VP that Longest Road is worth with Grand Causeway when the road includes a bridge (`2` base + `14` bonus = `16`). */
export const GRAND_CAUSEWAY_VP = 16;
/** Extra VP added on top of the base 2 VP Longest Road award when Grand Causeway is active. */
export const GRAND_CAUSEWAY_BONUS_VP = GRAND_CAUSEWAY_VP - 2;

/** Salt mixed into the world seed for Harbor Empire's one-time random bank grant (zero `g.rng` draws). */
export const HARBOR_EMPIRE_RNG_SALT = 0x48454d50; // 'HEMP'

// ---- T11f: Grand Causeway (16 VP Longest Road when road includes a bridge) -------------------------------------

/**
 * True when `pid`'s longest road-like path on the board (`maxLen > 0`, using the same opponent-piece blocking rules as `longestRoadFor`)
 * includes at least one `bridge` or `rickety_bridge` edge.
 * If `pid` has multiple tied longest paths of length `maxLen`, returns `true` when any of those longest paths contains a bridge.
 */
export function longestRoadHasBridge(g: GameState, reg: Registry, pid: Id): boolean {
  const { board } = g;
  const mine = (e: Edge | undefined): boolean =>
    !!e && !!e.piece && e.piece.owner === pid && !!reg.pieces.get(e.piece.type)?.roadLike;
  const isBridgeEdge = (e: Edge | undefined): boolean =>
    !!e?.piece && (e.piece.type === BRIDGE || e.piece.type === RICKETY);

  const roads = board.edges.filter(e => mine(e));
  if (roads.length === 0) return false;

  let maxLen = 0;
  let maxHasBridge = false;
  const used = new Set<number>();

  function dfs(vertexId: number, len: number, hasBr: boolean): void {
    if (len > maxLen) {
      maxLen = len;
      maxHasBridge = hasBr;
    } else if (len === maxLen && hasBr) {
      maxHasBridge = true;
    }
    const v = board.vertices[vertexId];
    if (!v) return;
    if (len > 0 && v.piece && v.piece.owner !== pid) return;
    for (const edgeId of v.edgeIds) {
      if (used.has(edgeId)) continue;
      const edge = board.edges[edgeId];
      if (!mine(edge)) continue;
      used.add(edgeId);
      dfs(edge.v1 === vertexId ? edge.v2 : edge.v1, len + 1, hasBr || isBridgeEdge(edge));
      used.delete(edgeId);
    }
  }

  const endpoints = new Set<number>();
  for (const e of roads) {
    endpoints.add(e.v1);
    endpoints.add(e.v2);
  }
  for (const vId of endpoints) dfs(vId, 0, false);
  return maxLen > 0 && maxHasBridge;
}

/**
 * Extra VP (+14, bringing Longest Road from 2 VP to 16 VP) for `pid` when:
 *  1. `pid` has researched `tidebound.grand_causeway`,
 *  2. `pid` currently holds the Longest Road award (`g.awards.longestRoad?.owner === pid`), and
 *  3. `pid`'s longest road includes at least one bridge or rickety bridge (`longestRoadHasBridge`).
 * Losing Longest Road (or losing the bridge so the road no longer qualifies) immediately drops this bonus back to 0.
 */
export function grandCausewayBonusVp(g: GameState, reg: Registry, pid: Id): number {
  if (!hasTech(g, pid, TECH_GRAND_CAUSEWAY)) return 0;
  const lr = g.awards?.longestRoad as any;
  const lrOwner = typeof lr === 'string' ? lr : lr?.owner;
  if (lrOwner !== pid) return 0;
  if (!longestRoadHasBridge(g, reg, pid)) return 0;
  return GRAND_CAUSEWAY_BONUS_VP;
}

/** `api.hook('vp', ...)` handler for Grand Causeway. */
export function grandCausewayVpHook(g: GameState, reg: Registry, p: PlayerState, _includeHidden?: boolean): number {
  return grandCausewayBonusVp(g, reg, p.id);
}

// ---- T11f: Harbor Empire unlock grant (`ceil(V / 2)` random cards from the bank, zero `g.rng` draws) -----------

/** Derives a deterministic RNG stream for `pid`'s Harbor Empire unlock grant without touching `g.rng`. */
export function deriveHarborEmpireRng(seed: number, pid: Id, turnCount = 0): RngState {
  let h = ((Number(seed) || 1) ^ HARBOR_EMPIRE_RNG_SALT) >>> 0;
  for (let i = 0; i < pid.length; i++) {
    h = Math.imul(h ^ pid.charCodeAt(i), 0x9e3779b1) >>> 0;
  }
  h = Math.imul(h ^ ((Number(turnCount) || 0) + 1), 0x85ebca6b) >>> 0;
  return createRng(h || 1);
}

/** Number of random bank cards Harbor Empire grants on unlock (`ceil(V / 2)`, where `V = techBuildingValue(g, pid)`). */
export function harborEmpireGrantCount(g: GameState, pid: Id): number {
  return Math.ceil(techBuildingValue(g, pid) / 2);
}

/**
 * Grants `ceil(V / 2)` random resource cards from the bank to `pid` when `tidebound.harbor_empire` is unlocked.
 * Uses a derived RNG stream so `g.rng` is never advanced.
 */
export function grantHarborEmpireCards(ctx: Ctx, pid: Id): { wanted: number; granted: number; cards: Record<string, number> } {
  const { g, reg } = ctx;
  const p = getPlayer(g, pid);
  const wanted = harborEmpireGrantCount(g, pid);
  const cards: Record<string, number> = {};
  if (!p || wanted <= 0) return { wanted, granted: 0, cards };

  const rng = deriveHarborEmpireRng(g.seed, pid, g.turnCount || 0);
  let granted = 0;
  for (let i = 0; i < wanted; i++) {
    const stocked = [...reg.resources.keys()].filter(r => (g.bank[r] || 0) > 0);
    if (stocked.length === 0) break;
    const pick = stocked[rngInt(rng, stocked.length)];
    const got = bankGive(ctx, pid, pick, 1);
    if (got > 0) {
      cards[pick] = (cards[pick] || 0) + got;
      granted += got;
    }
  }
  ctx.emit('harborEmpireGranted', { playerId: pid, wanted, amount: granted, cards });
  if (granted > 0) {
    ctx.log(
      `🏛️ ${p.avatar} ${p.name}'s Harbor Empire granted ${granted} card${granted === 1 ? '' : 's'} from the bank!`,
      p.color
    );
  }
  return { wanted, granted, cards };
}

// ---- T11c, T11d, T11e: The 8 Tidebound extension tech nodes ---------------------------------------------------

export const TIDEBOUND_TECH_DEFS: TechDef[] = [
  // Tier 2 (costOffset: 3 -> 6 cards at V = 2, 10 VP)
  {
    id: TECH_RICKETY_BRIDGES,
    name: 'Rickety bridges',
    branch: 'tidebound',
    tier: 2,
    path: 'expansion',
    prereq: TECH_HARBOR_CHARTERS,
    costOffset: 3,
    dlc: 'tidebound',
    description:
      'Unlocks Rickety Bridges (1 wood, 1 health, collapses on a 7; upgradeable to a full bridge) and raises your bridge cap by +4 before bridges cost 2x.',
    onUnlock(ctx, pid) {
      // Immediately update the player's bridge/rickety supply counters to reflect the +4 cap bonus.
      if (ctx.g.rules?.pieceLimits?.[BRIDGE] !== undefined) {
        syncBridgePool(ctx.g, pid);
      } else {
        const p = getPlayer(ctx.g, pid);
        if (p && typeof p.pieces?.[BRIDGE] === 'number') {
          p.pieces[BRIDGE] = (p.pieces[BRIDGE] || 0) + RICKETY_TECH_CAP_BONUS;
        }
      }
      const base = ctx.g.rules?.pieceLimits?.[BRIDGE] ?? BRIDGE_BASE_LIMIT;
      ctx.emit('bridgeCapRaised', { playerId: pid, cap: base + RICKETY_TECH_CAP_BONUS });
    },
    replace: true
  },
  {
    id: TECH_FISHING_NETS,
    name: 'Fishing nets',
    branch: 'tidebound',
    tier: 2,
    path: 'industrial',
    prereq: TECH_HARBOR_CHARTERS,
    costOffset: 3,
    dlc: 'tidebound',
    description:
      'Unlocks Fishing Nets on coastal corners (catch wild fish tokens on dice rolls) and lets your Settlements on 3:1 ports be raised to 2:1.',
    replace: true
  },

  // Tier 3a (costOffset: 5 -> 9 cards at V = 2, 10 VP)
  {
    id: TECH_SALVAGE_CREW,
    name: 'Salvage crew',
    branch: 'tidebound',
    tier: 3,
    path: 'expansion',
    prereq: TECH_RICKETY_BRIDGES,
    costOffset: 5,
    dlc: 'tidebound',
    description:
      '+25% shipwreck salvage loot, higher dev-card chance on sea wrecks, and unlocks Demolish Bridge (remove a bridge for half its cards back).',
    replace: true
  },
  {
    id: TECH_NET_WORKS,
    name: 'Net works',
    branch: 'tidebound',
    tier: 3,
    path: 'industrial',
    prereq: TECH_FISHING_NETS,
    costOffset: 5,
    dlc: 'tidebound',
    description:
      'Fishing Nets cost 1 less wood (1 wood + 1 sheep), base catch chance rises to 1 in 4 (1 in 2 when boosted), and boosted catches have a 1 in 3 chance to save the fish boost.',
    replace: true
  },

  // Tier 3b (costOffset: 7 -> 11 cards at V = 2, 10 VP)
  {
    id: TECH_PIRATE_HUNTER,
    name: 'Pirate hunter',
    branch: 'tidebound',
    tier: 3,
    path: 'expansion',
    prereq: TECH_SALVAGE_CREW,
    costOffset: 7,
    dlc: 'tidebound',
    description:
      'Driving off a pirate requires 2 fewer played knights (minimum 1) and grants +50% pirate loot.',
    replace: true
  },
  {
    id: TECH_HARBOR_MASTER,
    name: 'Harbor master',
    branch: 'tidebound',
    tier: 3,
    path: 'industrial',
    prereq: TECH_NET_WORKS,
    costOffset: 7,
    dlc: 'tidebound',
    description:
      'Unlocks Harbors (upgrade a port city to 1:1 trade for up to 4 trades per turn, works while flooded) and Feed the Sea (1 wheat refills a fishing ground).',
    replace: true
  },

  // Tier 4 (costOffset: 10 -> 15 cards at V = 2, 10 VP)
  {
    id: TECH_GRAND_CAUSEWAY,
    name: 'Grand causeway',
    branch: 'tidebound',
    tier: 4,
    path: 'expansion',
    prereq: TECH_PIRATE_HUNTER,
    costOffset: 10,
    dlc: 'tidebound',
    description:
      'Longest Road is worth 16 VP instead of 2 (+14 VP) while you hold Longest Road and your road includes at least 1 bridge or rickety bridge.',
    replace: true
  },
  {
    id: TECH_HARBOR_EMPIRE,
    name: 'Harbor empire',
    branch: 'tidebound',
    tier: 4,
    path: 'industrial',
    prereq: TECH_HARBOR_MASTER,
    costOffset: 10,
    dlc: 'tidebound',
    description:
      '+1 Harbor limit (2 Harbors total) and immediately grants ceil(V / 2) random resource cards from the bank on unlock.',
    onUnlock(ctx, pid) {
      grantHarborEmpireCards(ctx, pid);
    },
    replace: true
  }
];

/**
 * Registers all 8 Tidebound extension tech nodes in `TECH_DEFS` (`replace: true` makes repeated calls across addons idempotent).
 */
export function registerTideboundTechs(api: PackApi): void {
  for (const def of TIDEBOUND_TECH_DEFS) {
    api.define(TECH_DEFS, def);
  }
}
