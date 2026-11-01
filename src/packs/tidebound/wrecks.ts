// MODULE: tidebound.wrecks addon (T9a: storm event & wreck marker; T9b: 65/35 sea/shore placement, fair spawn within 4 tiles of a player; T9c: first connecting road, bridge, or port claims the wreck; T9d: loot with 2x-cost floor rule & slow time scaling; T9e: client view with sea/shore spawn animation data; minimal bot salvage goal) | DEPENDS ON: packs/base/building, packs/base/constants, packs/tidebound/bridges, packs/tidebound/fishing, packs/tidebound/ricketyBridges, packs/tidebound/tech, +1 more | USED BY: packs/tidebound/addons.generated, packs/tidebound/index, packs/tidebound/pirates
import {
  addMarker,
  addonOn,
  appendPublicHistory,
  bankGive,
  BOT_GOALS,
  createRng,
  EVENT_CARDS,
  getMarkers,
  getPlayer,
  grantWildToken,
  hasTech,
  hexDistance,
  priceOf,
  removeMarker,
  rngInt,
  rngNext,
  VIEW_DATA
} from '../../shared';
import type {
  AddonDef,
  BotGoalDef,
  BotGoalItem,
  Ctx,
  EventCardDef,
  GameState,
  Hex,
  Id,
  MarkerEntry,
  PieceDef,
  Registry,
  Resources,
  RngState,
  ViewDataDef
} from '../../shared';
import { CITY, ROAD, SETTLEMENT } from '../base/constants';
import { validateBuild } from '../base/building';
import { BRIDGE } from './bridges';
import { FISH, isSeaHex, seaHexIdsAt } from './fishing';
import { RICKETY } from './ricketyBridges';
import { registerTideboundTechs, TECH_RICKETY_BRIDGES, techGate } from './tech';

/** Marker kind stored in `g.ext.core.markers` for shipwrecks. */
export const WRECK_MARKER_KIND = 'wreck';
/** Event card id registered in `EVENT_CARDS` for sea storms. */
export const STORM_EVENT_ID = 'tidebound.storm';
/** Rounds an unclaimed wreck stays on the board before sinking (`tickMarkers` decrements at round end). */
export const WRECK_COUNTDOWN_ROUNDS = 4;
/** Probability that a storm spawns a sea wreck (65%) vs a shore wreck (35%). */
export const WRECK_SEA_CHANCE = 0.65;
/** Maximum hex distance from at least one player's pieces for a legal wreck spawn (T9b). */
export const WRECK_MAX_PLAYER_DIST = 4;
/** Sea wreck base card range (3 to 5 cards of one resource). */
export const WRECK_SEA_MIN_CARDS = 3;
export const WRECK_SEA_MAX_CARDS = 5;
/** Shore wreck base card range (1 to 2 cards of one resource). */
export const WRECK_SHORE_MIN_CARDS = 1;
export const WRECK_SHORE_MAX_CARDS = 2;
/** Turns over which wreck loot scales up to `WRECK_MAX_TIME_BOOST` (+40% after 50 turns, T9d). */
export const WRECK_SCALE_TURNS = 50;
export const WRECK_MAX_TIME_BOOST = 0.4;
/** Expansion tier 3a tech that boosts wreck loot by +25% and raises sea-wreck dev card drop odds (T11). */
export const TECH_SALVAGE_CREW = 'tidebound.salvage_crew';
export const SALVAGE_CREW_LOOT_MULT = 1.25;
/** Sea wreck bonus drop probabilities (fish token or dev card). */
export const WRECK_SEA_DEV_CHANCE = 0.1;
export const WRECK_SEA_DEV_TECH_CHANCE = 0.25;
export const WRECK_SEA_FISH_CHANCE = 0.15;
/** Passive storm schedule when the optional Event Deck setting (`rules.eventsOn`) is off. */
export const STORM_FIRST_ROUND = 3;
export const STORM_CADENCE_ROUNDS = 3;

const WRECK_RNG_SALT = 0x5752454b; // 'WREK'
const EDGE_DIR: [number, number][] = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];

export type WreckSite = 'sea' | 'shore';
export type WreckBonus = 'fish' | 'dev' | null;

export interface WreckPayload {
  site: WreckSite;
  spawnRound: number;
  spawnTurn: number;
  resource: string;
  baseCards: number;
  bonus: WreckBonus;
  /** For shore wrecks: axial direction `(dq, dr)` toward an adjacent sea tile so the icon beaches on the ocean side. */
  shoreDir: { dq: number; dr: number } | null;
  claimed?: {
    playerId: Id;
    resource: string;
    amount: number;
    bonus: WreckBonus;
  };
}

export interface WreckClaimResult {
  markerId: string;
  hexId: number;
  playerId: Id;
  site: WreckSite;
  resource: string;
  wantedCards: number;
  amount: number;
  bonus: WreckBonus;
  builtCostCards: number;
}

export interface WreckClientItem {
  id: string;
  hexId: number;
  site: WreckSite;
  countdown: number;
  shoreDir: { dq: number; dr: number } | null;
}

// ---- T9a: Derived RNG stream (zero `g.rng` draws) --------------------------------------------------------------

/** Derives an independent RNG stream from `seed` so storms and wrecks never advance `g.rng`. */
export function deriveWreckRng(seed: number): RngState {
  return createRng(((Number(seed) || 1) ^ WRECK_RNG_SALT) >>> 0);
}

/** Returns (and lazily initializes in `g.ext.tidebound.wrecks.rng`) the derived wreck RNG state. */
export function ensureWreckRng(g: GameState): RngState {
  if (!g.ext) g.ext = {};
  if (!g.ext.tidebound) g.ext.tidebound = {};
  if (!g.ext.tidebound.wrecks) {
    g.ext.tidebound.wrecks = { rng: deriveWreckRng(g.seed) };
  } else if (!g.ext.tidebound.wrecks.rng || typeof g.ext.tidebound.wrecks.rng.s !== 'number') {
    g.ext.tidebound.wrecks.rng = deriveWreckRng(g.seed);
  }
  return g.ext.tidebound.wrecks.rng as RngState;
}

// ---- T9b & T9c: Geometry, sea/shore classification, player distance & fairness ---------------------------------

function hexByAxial(g: GameState, q: number, r: number): Hex | undefined {
  return g.board.hexes.find(h => h.q === q && h.r === r);
}

/** All currently active (unclaimed) wreck markers on the board. */
export function activeWrecks(g: GameState): MarkerEntry[] {
  return getMarkers(g, { kind: WRECK_MARKER_KIND, target: 'hex' });
}

/** Corner vertex ids of `hexId`. Works on both land and sea tiles, with or without `addWaterTopology`. */
export function verticesOfHex(g: GameState, reg: Registry, hexId: number): number[] {
  const h = g.board.hexes[hexId];
  if (!h) return [];
  if (Array.isArray(h.vertexIds) && h.vertexIds.length > 0) {
    return [...h.vertexIds];
  }
  const out = new Set<number>();
  if (Array.isArray(h.corners) && h.corners.length > 0) {
    for (const c of h.corners) {
      for (const v of g.board.vertices) {
        if (Math.hypot(v.x - c.x, v.y - c.y) < 8.5) out.add(v.id);
      }
    }
  }
  for (const v of g.board.vertices) {
    if (v.hexIds.includes(hexId) || seaHexIdsAt(g, reg, v.id).includes(hexId)) {
      out.add(v.id);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** Border edge ids of `hexId` (land, coastal, or ocean edges whose two endpoints lie on `hexId`). */
export function edgesOfHex(g: GameState, reg: Registry, hexId: number): number[] {
  const vSet = new Set<number>(verticesOfHex(g, reg, hexId));
  const out: number[] = [];
  for (const e of g.board.edges) {
    if (e.hexIds.includes(hexId) || (vSet.has(e.v1) && vSet.has(e.v2))) {
      out.push(e.id);
    }
  }
  return out;
}

/** True when `hex` is an eligible ocean/sea tile for a sea wreck (non-land, non-river, not hidden). */
export function isWreckSeaHex(reg: Registry, hex: Hex | undefined): boolean {
  if (!hex || hex.ext?.hidden) return false;
  return isSeaHex(reg, hex);
}

/** Axial direction `(dq, dr)` from a coastal land tile toward its first adjacent sea tile (or outward from board centre). */
export function shoreSeaDirection(g: GameState, reg: Registry, hexId: number): { dq: number; dr: number } | null {
  const h = g.board.hexes[hexId];
  if (!h) return null;
  for (const [dq, dr] of EDGE_DIR) {
    const nb = hexByAxial(g, h.q + dq, h.r + dr);
    if (nb && isSeaHex(reg, nb)) return { dq, dr };
  }
  // If the land tile sits on the outer edge of a board without a sea frame, point outward along its coastal edge.
  for (const [dq, dr] of EDGE_DIR) {
    const nb = hexByAxial(g, h.q + dq, h.r + dr);
    if (!nb) return { dq, dr };
  }
  return null;
}

/** True when `hex` is a coastal land tile (touches at least one sea tile or outer coastal edge, and is not hidden). */
export function isWreckShoreHex(g: GameState, reg: Registry, hex: Hex | undefined): boolean {
  if (!hex || hex.ext?.hidden) return false;
  const def = reg.tiles.get(hex.type);
  if (!def?.land) return false;
  for (const [dq, dr] of EDGE_DIR) {
    const nb = hexByAxial(g, hex.q + dq, hex.r + dr);
    if (!nb || isSeaHex(reg, nb)) return true;
  }
  return hex.vertexIds.some(vId => (g.board.vertices[vId]?.hexIds.length ?? 0) < 3);
}

/** All hex ids anchored by `pid`'s placed vertices and edges. */
function playerAnchorHexIds(g: GameState, reg: Registry, pid: Id): number[] {
  const anchors = new Set<number>();
  const addVertexHexes = (vId: number) => {
    const v = g.board.vertices[vId];
    if (!v) return;
    for (const hId of v.hexIds) anchors.add(hId);
    for (const sId of seaHexIdsAt(g, reg, vId)) anchors.add(sId);
  };
  for (const v of g.board.vertices) {
    if (v.piece?.owner === pid) addVertexHexes(v.id);
  }
  for (const e of g.board.edges) {
    if (e.piece?.owner === pid) {
      for (const hId of e.hexIds) anchors.add(hId);
      addVertexHexes(e.v1);
      addVertexHexes(e.v2);
    }
  }
  if (anchors.size === 0) {
    // Fallback for ocean-only vertices when `v.hexIds` is empty
    for (const h of g.board.hexes) {
      const vIds = verticesOfHex(g, reg, h.id);
      if (vIds.some(vId => g.board.vertices[vId]?.piece?.owner === pid)) anchors.add(h.id);
      if (vIds.some(vId => g.board.vertices[vId]?.edgeIds.some(eId => g.board.edges[eId]?.piece?.owner === pid))) {
        anchors.add(h.id);
      }
    }
  }
  return [...anchors];
}

/** Minimum hex distance from `pid`'s pieces to `hexId` (`Infinity` if `pid` has no pieces on the board). */
export function playerHexDistance(g: GameState, reg: Registry, pid: Id, hexId: number): number {
  const target = g.board.hexes[hexId];
  if (!target) return Infinity;
  const anchors = playerAnchorHexIds(g, reg, pid);
  if (anchors.length === 0) return Infinity;
  let best = Infinity;
  for (const aId of anchors) {
    const aHex = g.board.hexes[aId];
    if (!aHex) continue;
    const d = hexDistance(target, aHex);
    if (d < best) best = d;
  }
  return best;
}

/** Minimum hex distance from ANY player's pieces to `hexId` (`0` if no player has placed any piece yet). */
export function minPlayerDistanceToHex(g: GameState, reg: Registry, hexId: number): number {
  let anyPiece = false;
  let best = Infinity;
  for (const p of g.players) {
    const d = playerHexDistance(g, reg, p.id, hexId);
    if (Number.isFinite(d)) {
      anyPiece = true;
      if (d < best) best = d;
    }
  }
  return anyPiece ? best : 0;
}

/**
 * True when `pid` connects to the wreck on `hexId` via:
 *  - a road, bridge, or rickety bridge touching a corner vertex or border edge of `hexId`, OR
 *  - a port building (or settlement/city) on a corner vertex of `hexId`.
 */
export function playerTouchesWreck(g: GameState, reg: Registry, pid: Id, hexId: number): boolean {
  const vIds = verticesOfHex(g, reg, hexId);
  if (vIds.length === 0) return false;
  const vSet = new Set<number>(vIds);

  for (const vId of vIds) {
    const v = g.board.vertices[vId];
    if (!v) continue;
    if (v.piece?.owner === pid && (v.port !== null || v.piece.type === SETTLEMENT || v.piece.type === CITY)) {
      return true;
    }
    for (const eId of v.edgeIds) {
      const e = g.board.edges[eId];
      if (e?.piece?.owner === pid) return true;
    }
  }

  for (const e of g.board.edges) {
    if (e.piece?.owner !== pid) continue;
    if (e.hexIds.includes(hexId) || vSet.has(e.v1) || vSet.has(e.v2)) return true;
  }
  return false;
}

/** Players who currently touch `hexId`, ordered from the active turn seat `g.turn` around the table. */
export function touchingPlayersOfWreck(g: GameState, reg: Registry, hexId: number): Id[] {
  const n = g.players.length;
  if (n === 0) return [];
  const start = Math.max(0, g.turn || 0) % n;
  const out: Id[] = [];
  for (let i = 0; i < n; i++) {
    const p = g.players[(start + i) % n];
    if (p && playerTouchesWreck(g, reg, p.id, hexId)) out.push(p.id);
  }
  return out;
}

/**
 * Eligible hex ids for a `site` (`'sea'` or `'shore'`) wreck within `WRECK_MAX_PLAYER_DIST` (4) hexes of at least one player,
 * excluding tiles that already hold an active wreck.
 */
export function wreckCandidates(g: GameState, reg: Registry, site: WreckSite): number[] {
  const occupied = new Set<number>(activeWrecks(g).map(m => Number(m.loc)));
  const out: number[] = [];
  for (const h of g.board.hexes) {
    if (occupied.has(h.id)) continue;
    const matchesSite = site === 'sea' ? isWreckSeaHex(reg, h) : isWreckShoreHex(g, reg, h);
    if (!matchesSite) continue;
    if (minPlayerDistanceToHex(g, reg, h.id) <= WRECK_MAX_PLAYER_DIST) {
      out.push(h.id);
    }
  }
  return out;
}

interface CandidateRank {
  hexId: number;
  touchedCount: number;
  reachablePlayers: number;
  spread: number;
  distFromIdeal: number;
}

function rankCandidatesForFairness(g: GameState, reg: Registry, hexIds: number[]): CandidateRank[] {
  const activePlayerIds = g.players
    .map(p => p.id)
    .filter(pid => playerAnchorHexIds(g, reg, pid).length > 0);

  return hexIds
    .map(hexId => {
      const touchedCount = touchingPlayersOfWreck(g, reg, hexId).length;
      if (activePlayerIds.length === 0) {
        return { hexId, touchedCount, reachablePlayers: 0, spread: 0, distFromIdeal: 0 };
      }
      const dists = activePlayerIds.map(pid => playerHexDistance(g, reg, pid, hexId));
      const minD = Math.min(...dists);
      const maxD = Math.max(...dists);
      const reachablePlayers = dists.filter(d => d <= WRECK_MAX_PLAYER_DIST).length;
      const spread = maxD - minD;
      const distFromIdeal = Math.abs(minD - 2);
      return { hexId, touchedCount, reachablePlayers, spread, distFromIdeal };
    })
    .sort((a, b) => {
      // 1. Prefer unclaimed tiles so the wreck starts a fair build race when open tiles exist
      if ((a.touchedCount > 0) !== (b.touchedCount > 0)) return a.touchedCount - b.touchedCount;
      // 2. Prefer tiles within 4 hexes of more players
      if (b.reachablePlayers !== a.reachablePlayers) return b.reachablePlayers - a.reachablePlayers;
      // 3. Prefer more equidistant tiles (smaller max-min distance spread across players)
      if (a.spread !== b.spread) return a.spread - b.spread;
      // 4. Prefer a racing distance around 2 hexes
      if (a.distFromIdeal !== b.distFromIdeal) return a.distFromIdeal - b.distFromIdeal;
      return a.hexId - b.hexId;
    });
}

/**
 * Picks a fair wreck hex and site (`'sea'` 65% / `'shore'` 35% when `site` is omitted) within 4 tiles of a player.
 * Falls back to the other site type if the preferred one has no valid hexes.
 */
export function pickWreckHex(
  g: GameState,
  reg: Registry,
  site?: WreckSite,
  rng?: RngState,
  opts?: { onlyUntouched?: boolean }
): { hexId: number; site: WreckSite } | null {
  const stream = rng ?? ensureWreckRng(g);
  const preferred: WreckSite = site ?? (rngNext(stream) < WRECK_SEA_CHANCE ? 'sea' : 'shore');
  const order: WreckSite[] = site ? [site] : [preferred, preferred === 'sea' ? 'shore' : 'sea'];

  for (const s of order) {
    let cands = wreckCandidates(g, reg, s);
    if (opts?.onlyUntouched) {
      cands = cands.filter(hId => touchingPlayersOfWreck(g, reg, hId).length === 0);
    }
    if (cands.length === 0) continue;
    const ranked = rankCandidatesForFairness(g, reg, cands);
    const best = ranked[0];
    // Pool candidates in the top fairness band (same touched status, same reachable player count, spread within +1 of best)
    const fairPool = ranked.filter(
      r =>
        (r.touchedCount > 0) === (best.touchedCount > 0) &&
        r.reachablePlayers === best.reachablePlayers &&
        r.spread <= best.spread + 1
    );
    const pickIdx = rngInt(stream, fairPool.length);
    return { hexId: fairPool[pickIdx].hexId, site: s };
  }
  return null;
}

// ---- T9d: Loot calculation (slow time scaling, Salvage crew +25%, and 2x-cost floor rule) ----------------------

/** Time multiplier for wreck loot: scales linearly from `1.0` at turn 0 up to `1.4` (+40%) at turn 50+. */
export function wreckTimeMultiplier(turnCount: number): number {
  const t = Math.max(0, Number(turnCount) || 0);
  const frac = Math.min(1, t / WRECK_SCALE_TURNS);
  return 1 + frac * WRECK_MAX_TIME_BOOST;
}

/**
 * Effective resource card count paid out when a wreck is salvaged:
 * - Scales `baseCards` by `wreckTimeMultiplier(turnCount)` (up to +40% at 50 turns) and `SALVAGE_CREW_LOOT_MULT` (1.25x with `tidebound.salvage_crew`).
 * - Enforces the floor rule: payout is never less than `builtCostCards + 1`, so even a doubled-cost bridge built to claim a wreck nets at least +1 card.
 */
export function computeWreckLootCount(opts: {
  baseCards: number;
  turnCount: number;
  builtCostCards?: number;
  hasSalvageCrew?: boolean;
}): number {
  const base = Math.max(1, Math.round(Number(opts.baseCards) || 1));
  const timeMult = wreckTimeMultiplier(opts.turnCount);
  const techMult = opts.hasSalvageCrew ? SALVAGE_CREW_LOOT_MULT : 1;
  const scaled = Math.round(base * timeMult * techMult);
  const floor = Math.max(1, Math.round(Number(opts.builtCostCards) || 0) + 1);
  return Math.max(scaled, floor);
}

/** Claims a wreck marker for `pid`, paying cards from the bank (whatever the bank has left) plus any sea-wreck bonus. */
export function claimWreck(
  ctx: Ctx,
  markerOrHexId: MarkerEntry | number,
  pid: Id,
  opts?: { builtCostCards?: number }
): WreckClaimResult | null {
  const { g, reg } = ctx;
  const p = getPlayer(g, pid);
  if (!p) return null;

  const marker =
    typeof markerOrHexId === 'number'
      ? activeWrecks(g).find(m => Number(m.loc) === markerOrHexId)
      : markerOrHexId;
  if (!marker) return null;

  const hexId = Number(marker.loc);
  const payload = (marker.payload || {}) as WreckPayload;
  const site: WreckSite = payload.site === 'shore' ? 'shore' : 'sea';
  const resources = [...reg.resources.keys()];
  const resource = payload.resource && reg.resources.has(payload.resource) ? payload.resource : (resources[0] || 'wood');
  const baseCards = payload.baseCards || (site === 'sea' ? WRECK_SEA_MIN_CARDS : WRECK_SHORE_MIN_CARDS);
  const hasSalvage = hasTech(g, pid, TECH_SALVAGE_CREW);
  const builtCostCards = Math.max(0, Math.round(Number(opts?.builtCostCards) || 0));

  const wantedCards = computeWreckLootCount({
    baseCards,
    turnCount: g.turnCount || 0,
    builtCostCards,
    hasSalvageCrew: hasSalvage
  });

  // Pay from the bank; if the bank has fewer cards than `wantedCards`, pay whatever is left in that pile.
  const avail = Math.max(0, g.bank[resource] || 0);
  const paid = Math.min(wantedCards, avail);
  if (paid > 0) {
    bankGive(ctx, pid, resource, paid);
  }

  // Sea wrecks can also grant a bonus fish token or dev card (Salvage crew boosts the dev card chance on sea wrecks).
  let bonusGiven: WreckBonus = null;
  if (site === 'sea') {
    let bonus: WreckBonus = payload.bonus ?? null;
    if (!bonus && hasSalvage && g.deck.length > 0) {
      // Salvage crew gives an extra dev-card roll chance on sea wrecks if none was rolled at spawn
      const rng = ensureWreckRng(g);
      if (rngNext(rng) < WRECK_SEA_DEV_TECH_CHANCE - WRECK_SEA_DEV_CHANCE) {
        bonus = 'dev';
      }
    }
    if (bonus === 'fish' && addonOn(reg, 'tidebound.fishing')) {
      grantWildToken(ctx, pid, FISH, 1);
      bonusGiven = 'fish';
    } else if (bonus === 'dev' && g.deck.length > 0) {
      const card = g.deck.pop()!;
      p.newDevCards.push(card);
      p.stats.devsBought = (p.stats.devsBought || 0) + 1;
      ctx.emit('devBought', { playerId: pid, card, fromWreck: true });
      bonusGiven = 'dev';
    }
  }

  removeMarker(g, marker.id);
  marker.ownerId = pid;
  payload.claimed = { playerId: pid, resource, amount: paid, bonus: bonusGiven };
  marker.payload = payload;
  p.stats.wrecksClaimed = (p.stats.wrecksClaimed || 0) + 1;

  const bonusText =
    bonusGiven === 'fish' ? ' + 1 fish' : bonusGiven === 'dev' ? ' + 1 dev card' : '';
  ctx.emit('wreckClaimed', {
    id: marker.id,
    hexId,
    playerId: pid,
    site,
    resource,
    wantedCards,
    amount: paid,
    bonus: bonusGiven,
    builtCostCards
  });
  appendPublicHistory(g, {
    type: 'wreckClaimed',
    actorId: pid,
    targetId: null,
    summary: `${p.name} salvaged a ${site} wreck (${paid} ${resource}${bonusText})`,
    data: { hexId, site, amount: paid, bonus: bonusGiven }
  });
  ctx.log(
    `⚓ ${p.avatar} ${p.name} salvaged the ${site} shipwreck on tile #${hexId} for ${paid} ${resource}${bonusText}!`,
    p.color
  );

  return {
    markerId: marker.id,
    hexId,
    playerId: pid,
    site,
    resource,
    wantedCards,
    amount: paid,
    bonus: bonusGiven,
    builtCostCards
  };
}

/** Spawns a shipwreck marker on `hexId` (and pays out immediately if a player already connects to `hexId`). */
export function spawnWreckAt(
  ctx: Ctx,
  hexId: number,
  opts?: {
    site?: WreckSite;
    resource?: string;
    baseCards?: number;
    bonus?: WreckBonus;
  }
): MarkerEntry | null {
  const { g, reg } = ctx;
  const hex = g.board.hexes[hexId];
  if (!hex || hex.ext?.hidden) return null;
  if (activeWrecks(g).some(m => Number(m.loc) === hexId)) return null;

  const rng = ensureWreckRng(g);
  const site: WreckSite = opts?.site ?? (isWreckSeaHex(reg, hex) ? 'sea' : 'shore');
  const resources = [...reg.resources.keys()];
  const resource =
    opts?.resource && reg.resources.has(opts.resource)
      ? opts.resource
      : resources[rngInt(rng, Math.max(1, resources.length))] || 'wood';

  const baseCards =
    typeof opts?.baseCards === 'number'
      ? Math.max(1, Math.round(opts.baseCards))
      : site === 'sea'
        ? WRECK_SEA_MIN_CARDS + rngInt(rng, WRECK_SEA_MAX_CARDS - WRECK_SEA_MIN_CARDS + 1)
        : WRECK_SHORE_MIN_CARDS + rngInt(rng, WRECK_SHORE_MAX_CARDS - WRECK_SHORE_MIN_CARDS + 1);

  let bonus: WreckBonus = null;
  if (opts && 'bonus' in opts) {
    bonus = opts.bonus ?? null;
  } else if (site === 'sea') {
    const roll = rngNext(rng);
    if (roll < WRECK_SEA_DEV_CHANCE) bonus = 'dev';
    else if (roll < WRECK_SEA_DEV_CHANCE + WRECK_SEA_FISH_CHANCE && addonOn(reg, 'tidebound.fishing')) bonus = 'fish';
  }

  const shoreDir = site === 'shore' ? shoreSeaDirection(g, reg, hexId) : null;
  const payload: WreckPayload = {
    site,
    spawnRound: g.round || 1,
    spawnTurn: g.turnCount || 1,
    resource,
    baseCards,
    bonus,
    shoreDir
  };

  const marker = addMarker(g, {
    kind: WRECK_MARKER_KIND,
    target: 'hex',
    loc: hexId,
    ownerId: null,
    countdown: WRECK_COUNTDOWN_ROUNDS,
    public: true,
    payload
  });

  ctx.emit('wreckSpawned', {
    id: marker.id,
    hexId,
    site,
    countdown: WRECK_COUNTDOWN_ROUNDS,
    shoreDir
  });
  appendPublicHistory(g, {
    type: 'wreckSpawned',
    actorId: null,
    targetId: null,
    summary: `A ${site} shipwreck appeared on tile #${hexId}`,
    data: { id: marker.id, hexId, site }
  });
  ctx.log(`⛈️ Storm at Sea: a ${site} shipwreck washed up on tile #${hexId}!`, null);

  // If a player already has a road, bridge, or port touching this tile, it pays out at once (T9c).
  const touching = touchingPlayersOfWreck(g, reg, hexId);
  if (touching.length > 0) {
    claimWreck(ctx, marker, touching[0], { builtCostCards: 0 });
  }
  return marker;
}

/** Picks a fair sea/shore (65/35) tile within 4 hexes of a player and spawns a storm wreck there. */
export function spawnStormWreck(ctx: Ctx, opts?: { site?: WreckSite; onlyUntouched?: boolean }): MarkerEntry | null {
  const { g, reg } = ctx;
  if (!addonOn(reg, 'tidebound.wrecks')) return null;
  const picked = pickWreckHex(g, reg, opts?.site, ensureWreckRng(g), { onlyUntouched: opts?.onlyUntouched });
  if (!picked) return null;
  return spawnWreckAt(ctx, picked.hexId, { site: picked.site });
}

/** Event card registered in `EVENT_CARDS` for `tidebound.wrecks`. */
export const stormEventCard: EventCardDef = {
  id: STORM_EVENT_ID,
  title: 'Storm at Sea',
  description: 'A storm leaves a shipwreck at sea or on the shore (storm next round: wrecks likely). First road, bridge, or port to reach it claims the salvage.',
  pack: 'tidebound.wrecks',
  copies: 2,
  apply(ctx: Ctx) {
    spawnStormWreck(ctx);
  }
};

// ---- Hooks: claim on build, passive storm cadence when Event Deck is off ---------------------------------------

function effectiveBuiltCostCards(ctx: Ctx, def: PieceDef, pid: Id, loc: number): number {
  const { g, reg } = ctx;
  const p = getPlayer(g, pid);
  if (!p) return 0;
  // Check if this was a free road from Road Building (the built event has doubleCost: false and we check if cost was paid)
  const slots = def.target === 'vertex' ? g.board.vertices : g.board.edges;
  const slot = slots[loc];
  const savedPiece = slot?.piece ?? null;
  if (slot) {
    slot.piece = def.upgradeFrom ? { type: def.upgradeFrom, owner: pid } : null;
  }
  const cost = priceOf(g, reg, p, def);
  if (slot) {
    slot.piece = savedPiece;
  }
  return Object.values(cost).reduce((sum, n) => sum + (Number(n) || 0), 0);
}

function claimTouchedWrecksOnBuild(ctx: Ctx, def: PieceDef, pid: Id, loc: number): void {
  if (!addonOn(ctx.reg, 'tidebound.wrecks')) return;
  const wrecks = activeWrecks(ctx.g);
  if (wrecks.length === 0) return;
  const builtCostCards = effectiveBuiltCostCards(ctx, def, pid, loc);
  for (const m of wrecks) {
    if (playerTouchesWreck(ctx.g, ctx.reg, pid, Number(m.loc))) {
      claimWreck(ctx, m, pid, { builtCostCards });
    }
  }
}

// ---- T9e: Client view ------------------------------------------------------------------------------------------

/** Public client list of active shipwrecks on the board (`null` when `tidebound.wrecks` is off or no wrecks are active). */
export function wreckClientView(g: GameState, reg: Registry): WreckClientItem[] | null {
  if (!addonOn(reg, 'tidebound.wrecks')) return null;
  const wrecks = activeWrecks(g);
  if (wrecks.length === 0) return null;
  return wrecks.map(m => {
    const payload = (m.payload || {}) as Partial<WreckPayload>;
    const site: WreckSite = payload.site === 'shore' ? 'shore' : 'sea';
    return {
      id: m.id,
      hexId: Number(m.loc),
      site,
      countdown: typeof m.countdown === 'number' ? m.countdown : WRECK_COUNTDOWN_ROUNDS,
      shoreDir: site === 'shore' ? (payload.shoreDir ?? shoreSeaDirection(g, reg, Number(m.loc))) : null
    };
  });
}

/**
 * VIEW_DATA entry (R7a.5, group 3): the public `wrecks` field of the client state. Registered inside the wrecks addon, so it exists only while Wrecks
 * is on. While it is off the pack's always-on `tidebound.view_defaults` entry supplies `wrecks: null` (a public field is null when off).
 */
export const wreckViewData: ViewDataDef = {
  id: 'tidebound.wrecks.view',
  shared: (g: GameState, reg: Registry) => ({ wrecks: wreckClientView(g, reg) })
};

// ---- T13b: Salvage bot goal (`BOT_GOALS`) ---------------------------------------------------------------------

/** Does placing an edge at `edgeId` touch the wreck on `hexId`? */
function edgeTouchesWreck(g: GameState, reg: Registry, edgeId: number, hexId: number): boolean {
  const e = g.board.edges[edgeId];
  if (!e) return false;
  if (e.hexIds.includes(hexId)) return true;
  const vSet = new Set<number>(verticesOfHex(g, reg, hexId));
  return vSet.has(e.v1) || vSet.has(e.v2);
}

/** Does an empty edge at `edgeId` connect in 1 more empty edge to a wreck on `hexId`? */
function edgeStepsTowardWreck(g: GameState, reg: Registry, pid: Id, edgeId: number, hexId: number): boolean {
  const e = g.board.edges[edgeId];
  if (!e || e.piece) return false;
  for (const vId of [e.v1, e.v2]) {
    const v = g.board.vertices[vId];
    if (!v || (v.piece && v.piece.owner !== pid)) continue;
    for (const nextEdgeId of v.edgeIds) {
      if (nextEdgeId === edgeId) continue;
      const nextEdge = g.board.edges[nextEdgeId];
      if (!nextEdge || nextEdge.piece) continue;
      if (edgeTouchesWreck(g, reg, nextEdgeId, hexId)) return true;
    }
  }
  return false;
}

/** Expected salvage card value of a wreck (using public site, turn scaling, Salvage crew, and 2x-cost floor). */
export function expectedWreckLootValue(
  g: GameState,
  pid: Id,
  site: WreckSite,
  builtCostCards = 2
): number {
  const baseMean = site === 'sea' ? 4 : 1.5;
  const mult = wreckTimeMultiplier(g.turnCount || 0) * (hasTech(g, pid, TECH_SALVAGE_CREW) ? SALVAGE_CREW_LOOT_MULT : 1);
  const expectedCards = Math.max(builtCostCards + 1, baseMean * mult);
  const bonusCards = site === 'sea' ? (hasTech(g, pid, TECH_SALVAGE_CREW) ? 0.55 : 0.4) : 0.15;
  return expectedCards + bonusCards;
}

/** True when `edgeId` is a dead-end bridge of `pid` (one endpoint has no other piece or road/bridge of `pid`). */
function isDeadEndBridge(g: GameState, pid: Id, edgeId: number): boolean {
  const e = g.board.edges[edgeId];
  if (!e || e.piece?.owner !== pid) return false;
  for (const vId of [e.v1, e.v2]) {
    const v = g.board.vertices[vId];
    if (!v) continue;
    if (v.piece?.owner === pid) continue;
    const otherOwnEdges = v.edgeIds.filter(id => id !== edgeId && g.board.edges[id]?.piece?.owner === pid);
    if (otherOwnEdges.length === 0) return true;
  }
  return false;
}

/**
 * T13b salvage bot goal:
 * - `vertexDelta`: rewards the corners of a wreck's tile. A settlement or city there claims the wreck like a road does (`playerTouchesWreck`), port or not.
 * - `edgeDelta`: scores 1-step claiming edges and 2-step approach edges weighted by expected loot and countdown urgency.
 * - `goals`: emits salvage build goals (1-step claim even when trading is needed, or 2-step approach when affordable).
 * - `actionScore`: scores `demolish_bridge` (`TECH_SALVAGE_CREW`) only on safe dead-end bridges when cards or cap slots are needed.
 */
export const wreckBotGoal: BotGoalDef = {
  id: 'tidebound.wrecks',
  goalClass: 'generic',
  vertexDelta(ctx: Ctx, pid: Id, vertexId: number): number {
    const { g, reg } = ctx;
    if (!addonOn(reg, 'tidebound.wrecks')) return 0;
    const v = g.board.vertices[vertexId];
    if (!v) return 0;
    const wrecks = activeWrecks(g);
    if (wrecks.length === 0) return 0;

    let bonus = 0;
    for (const m of wrecks) {
      const hexId = Number(m.loc);
      if (!verticesOfHex(g, reg, hexId).includes(vertexId)) continue;
      const site: WreckSite = (m.payload as Partial<WreckPayload> | undefined)?.site === 'shore' ? 'shore' : 'sea';
      bonus += expectedWreckLootValue(g, pid, site, 4) * 1.1;
    }
    return bonus;
  },
  edgeDelta(ctx: Ctx, pid: Id, edgeId: number): number {
    const { g, reg } = ctx;
    if (!addonOn(reg, 'tidebound.wrecks')) return 0;
    const wrecks = activeWrecks(g);
    if (wrecks.length === 0) return 0;
    const e = g.board.edges[edgeId];
    if (!e) return 0;

    let bonus = 0;
    for (const m of wrecks) {
      const hexId = Number(m.loc);
      const site: WreckSite = (m.payload as Partial<WreckPayload> | undefined)?.site === 'shore' ? 'shore' : 'sea';
      const countdown = typeof m.countdown === 'number' ? m.countdown : WRECK_COUNTDOWN_ROUNDS;
      const expected = expectedWreckLootValue(g, pid, site, e.hexIds.length === 0 ? 1 : 2);
      const urgency = countdown <= 2 ? 4 : 0;
      if (edgeTouchesWreck(g, reg, edgeId, hexId)) {
        bonus += Math.round(expected * 5.5) + urgency;
      } else if (countdown >= 2 && edgeStepsTowardWreck(g, reg, pid, edgeId, hexId)) {
        bonus += Math.round(expected * 2.2);
      }
    }
    return bonus;
  },
  goals(ctx: Ctx, pid: Id): BotGoalItem[] {
    const { g, reg } = ctx;
    if (!addonOn(reg, 'tidebound.wrecks') || g.phase !== 'main') return [];
    const wrecks = activeWrecks(g);
    if (wrecks.length === 0) return [];
    const p = getPlayer(g, pid);
    if (!p) return [];

    const edgePieces = [RICKETY, ROAD, BRIDGE].filter(
      id => reg.pieces.has(id) && (p.pieces[id] ?? 0) > 0 && (id !== RICKETY || techGate(g, pid, TECH_RICKETY_BRIDGES))
    );
    if (edgePieces.length === 0) return [];

    const claimCandidates: { item: BotGoalItem; score: number }[] = [];
    const stepCandidates: { item: BotGoalItem; score: number }[] = [];

    for (const m of wrecks) {
      const hexId = Number(m.loc);
      const site: WreckSite = (m.payload as Partial<WreckPayload> | undefined)?.site === 'shore' ? 'shore' : 'sea';
      const countdown = typeof m.countdown === 'number' ? m.countdown : WRECK_COUNTDOWN_ROUNDS;
      const urgency = countdown <= 2 ? 5 : 0;

      for (const pieceId of edgePieces) {
        const def = reg.pieces.get(pieceId)!;
        const cost = priceOf(g, reg, p, def);
        const costCards = Object.values(cost).reduce((s, n) => s + (Number(n) || 0), 0);
        const expected = expectedWreckLootValue(g, pid, site, costCards);
        const netGain = expected - costCards;

        for (const e of g.board.edges) {
          if (e.piece) continue;
          if (!def.canPlace(ctx, pid, e.id, 'build')) continue;

          if (edgeTouchesWreck(g, reg, e.id, hexId)) {
            const canBuildNow = validateBuild(ctx, pid, { piece: pieceId, loc: e.id }) === null;
            const priority = Math.round((site === 'sea' ? 76 : 62) + netGain * 3 + urgency + (canBuildNow ? 6 : 0));
            claimCandidates.push({
              score: priority + (canBuildNow ? 100 : 0),
              item: {
                id: 'tidebound.wrecks.salvage',
                priority,
                cost,
                action: { type: 'build', payload: { piece: pieceId, loc: e.id } },
                needsTags: ['sea', 'economy']
              }
            });
          } else if (countdown >= 2 && edgeStepsTowardWreck(g, reg, pid, e.id, hexId)) {
            const canBuildNow = validateBuild(ctx, pid, { piece: pieceId, loc: e.id }) === null;
            if (!canBuildNow) continue;
            const priority = Math.round((site === 'sea' ? 48 : 38) + netGain * 2);
            stepCandidates.push({
              score: priority,
              item: {
                id: `tidebound.wrecks.approach:${hexId}`,
                priority,
                cost,
                action: { type: 'build', payload: { piece: pieceId, loc: e.id } },
                needsTags: ['sea', 'economy']
              }
            });
          }
        }
      }
    }

    if (claimCandidates.length > 0) {
      claimCandidates.sort((a, b) => b.score - a.score);
      return [claimCandidates[0].item];
    }
    if (stepCandidates.length > 0) {
      stepCandidates.sort((a, b) => b.score - a.score);
      return [stepCandidates[0].item];
    }
    return [];
  },
  actionScore(ctx: Ctx, pid: Id, action: { type: string; payload: any }): number {
    if (action.type !== 'demolish_bridge') return 0;
    const { g, reg } = ctx;
    if (!hasTech(g, pid, TECH_SALVAGE_CREW)) return 0;
    const edgeId = Number(action.payload?.edgeId);
    if (!Number.isInteger(edgeId)) return 0;
    const e = g.board.edges[edgeId];
    if (!e || e.piece?.owner !== pid || (e.piece.type !== BRIDGE && e.piece.type !== RICKETY)) return 0;

    // Never demolish a bridge that is part of a Longest Road contender or touches an active wreck.
    const p = getPlayer(g, pid);
    if (!p) return 0;
    if (g.awards.longestRoad === pid || (p.stats.longestRoad || 0) >= 4) return 0;
    if (!isDeadEndBridge(g, pid, edgeId)) return 0;
    if (activeWrecks(g).some(m => edgeTouchesWreck(g, reg, edgeId, Number(m.loc)))) return 0;

    const hand = Object.values(p.resources).reduce((s, n) => s + (n || 0), 0);
    if (e.piece.type === BRIDGE && hand <= 3) return 22;
    return 0;
  }
};

export const wrecksAddon: AddonDef = {
  id: 'tidebound.wrecks',
  name: 'Shipwreck salvage',
  description: 'A storm leaves a wreck at sea or on the shore. The first road, bridge or port to reach it claims the loot.',
  links: [
    { target: 'marker', kind: 'mechanic' },
    { target: 'event-deck', kind: 'content' },
    { target: 'overlay', kind: 'ui' },
    { target: 'tidebound.bridges', kind: 'mechanic' }
  ],
  register(api) {
    registerTideboundTechs(api);
    api.define(EVENT_CARDS, stormEventCard);
    api.define(BOT_GOALS, wreckBotGoal);
    // R7a.5: the public wreck markers for the client state.
    api.define(VIEW_DATA, wreckViewData);
    api.hook('onBuild', (ctx, def, pid, loc) => {
      claimTouchedWrecksOnBuild(ctx, def, pid, loc);
    });
    api.hook('onRoundStart', ctx => {
      if (!addonOn(ctx.reg, 'tidebound.wrecks')) return;
      if (ctx.g.rules?.eventsOn) return;
      if (!ctx.g.board.hexes.some(h => isWreckSeaHex(ctx.reg, h))) return;
      const r = ctx.g.round || 0;
      if (r >= STORM_FIRST_ROUND && r % STORM_CADENCE_ROUNDS === 0) {
        spawnStormWreck(ctx, { onlyUntouched: true });
      }
    });
  }
};
