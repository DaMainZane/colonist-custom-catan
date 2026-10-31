// MODULE: tidebound.pirates addon (T10a: pirate marker, max 2, ocean tiles only, random move each round, event card + passive spawn cadence; T10b: strength grows slowly with the round, `drive_off_pirate` needs played knights and a road/bridge/port touching the tile, loot grows with strength; T10c: a pirate robs 2 cards from every settlement/city in contact; T10d: flee mode (flee chance climbs after every rob, runs at least 2 tiles from the robbed city), avoids tiles within 2 of a city of a player with more knights than its strength; client view and minimal bot goal) | DEPENDS ON: packs/base/constants, packs/tidebound/fishing, packs/tidebound/tech, packs/tidebound/wrecks, shared/index | USED BY: packs/tidebound/index
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
  hasTech,
  hexDistance,
  removeMarker,
  rngInt,
  rngNext,
  VIEW_DATA
} from '../../shared';
import type {
  ActionDef,
  AddonDef,
  BotGoalDef,
  BotGoalItem,
  Ctx,
  EventCardDef,
  GameState,
  Id,
  MarkerEntry,
  PlayerState,
  Registry,
  RngState,
  ViewDataDef
} from '../../shared';
import { CITY, SETTLEMENT } from '../base/constants';
import { seaHexIdsAt } from './fishing';
import { registerTideboundTechs, TECH_PIRATE_HUNTER } from './tech';
import {
  WRECK_MAX_PLAYER_DIST,
  isWreckSeaHex,
  minPlayerDistanceToHex,
  playerTouchesWreck,
  verticesOfHex
} from './wrecks';

export { TECH_PIRATE_HUNTER };

/** Marker kind stored in `g.ext.core.markers` for pirates. Pirates have no countdown: they stay until driven off. */
export const PIRATE_MARKER_KIND = 'pirate';
/** Event card id registered in `EVENT_CARDS` for pirate raids. */
export const PIRATE_EVENT_ID = 'tidebound.pirate_raid';
/** Action type: a player with enough played knights drives a pirate off its tile and takes the loot. */
export const DRIVE_OFF_PIRATE = 'drive_off_pirate';
/** Pirates on the board at once, across the whole table (T10a). */
export const PIRATE_MAX = 2;
/** Passive spawn schedule when the optional Event Deck setting (`rules.eventsOn`) is off: first pirate on this round, then every `PIRATE_CADENCE_ROUNDS`. */
export const PIRATE_FIRST_ROUND = 4;
export const PIRATE_CADENCE_ROUNDS = 4;
/** Strength (= played knights needed) of a new pirate, one more every `PIRATE_GROWTH_ROUNDS` rounds after `PIRATE_FIRST_ROUND`, capped at `PIRATE_MAX_STRENGTH` (T10b). Tune in T14. */
export const PIRATE_BASE_STRENGTH = 1;
export const PIRATE_GROWTH_ROUNDS = 6;
export const PIRATE_MAX_STRENGTH = 5;
/** Loot cards = `PIRATE_LOOT_BASE + strength`, one resource type, paid from the bank (sea wreck pays 3 to 5 before scaling). Loot and knights needed scale by the same step. */
export const PIRATE_LOOT_BASE = 4;
/** Expansion tier 3b tech (`TECH_PIRATE_HUNTER`, T11d): 2 fewer knights needed (never below 1) and +50% loot. */
export const PIRATE_CREW_KNIGHT_DISCOUNT = 2;
export const PIRATE_CREW_LOOT_MULT = 1.5;
/** Cards a pirate takes from each settlement or city in contact with it: 2x the 1 card of a robber steal (T10c). */
export const PIRATE_ROB_CARDS = 2;
/** A pirate will not enter a tile this close (in tiles, counted from the tiles at the city's corner) to a settlement/city of a player with MORE played knights than its strength (T10d). */
export const PIRATE_AVOID_RADIUS = 2;
/** Flee mode runs until the pirate is at least this many tiles from the city it robbed, up to `PIRATE_FLEE_STEPS` tiles per round (T10d). */
export const PIRATE_FLEE_DISTANCE = 2;
export const PIRATE_FLEE_STEPS = 2;
/** Chance to enter flee mode on the round after a rob. Starts at the base, rises by `PIRATE_FLEE_ROB_STEP` after EVERY rob, plus up to `PIRATE_FLEE_CLOSE_STEP` more when the victim's knights are close to the pirate's strength. */
export const PIRATE_FLEE_BASE = 0.1;
export const PIRATE_FLEE_ROB_STEP = 0.3;
export const PIRATE_FLEE_CLOSE_STEP = 0.3;
export const PIRATE_FLEE_MAX = 0.95;

/** Mixed into the world seed to get the pirate RNG stream (wrecks, tides and the event deck use other salts). */
const PIRATE_RNG_SALT = 0x50495254; // 'PIRT'
/** Piece types a pirate robs. A castle (Bulwark) is deliberately not in this list. */
const ROBBABLE_PIECES: string[] = [SETTLEMENT, CITY];
/** Neighbour of a hex across its edge i. Same table as `shared/topology.ts`. */
const EDGE_DIR: [number, number][] = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];

export type PirateMode = 'roam' | 'flee';

export interface PiratePayload {
  strength: number;
  spawnRound: number;
  mode: PirateMode;
  /** Chance to enter flee mode on the next round decision (only used while the pirate sits next to something it robbed). */
  fleeChance: number;
  /** Vertex of the city a fleeing pirate is running from. */
  fleeFrom: number | null;
  /** Last vertex robbed (flee target). */
  lastVertex: number | null;
  /** True when the pirate robbed this stay, so it decides each round between fleeing and robbing again. */
  lastRobbed: boolean;
  /** Rob count over the pirate's life. */
  robs: number;
}

export interface PirateClientItem {
  id: string;
  hexId: number;
  strength: number;
  mode: PirateMode;
}

// ---- T10a: derived RNG stream (zero `g.rng` draws) --------------------------------------------------------------

/** Derives an independent RNG stream from `seed`, so pirates never advance `g.rng`. */
export function derivePirateRng(seed: number): RngState {
  return createRng(((Number(seed) || 1) ^ PIRATE_RNG_SALT) >>> 0);
}

/** Returns (and lazily creates in `g.ext.tidebound.pirates.rng`) the pirate RNG state. */
export function ensurePirateRng(g: GameState): RngState {
  if (!g.ext) g.ext = {};
  if (!g.ext.tidebound) g.ext.tidebound = {};
  const cur = g.ext.tidebound.pirates;
  if (!cur || !cur.rng || typeof cur.rng.s !== 'number') {
    g.ext.tidebound.pirates = { rng: derivePirateRng(g.seed) };
  }
  return g.ext.tidebound.pirates.rng as RngState;
}

// ---- Markers and payloads ---------------------------------------------------------------------------------------

/** All pirates on the board, in the order they arrived. */
export function activePirates(g: GameState): MarkerEntry[] {
  return getMarkers(g, { kind: PIRATE_MARKER_KIND, target: 'hex' });
}

/** The pirate on `hexId`, if any. */
export function pirateAt(g: GameState, hexId: number): MarkerEntry | undefined {
  return activePirates(g).find(m => Number(m.loc) === hexId);
}

function freshPayload(strength: number, round: number): PiratePayload {
  return {
    strength,
    spawnRound: round,
    mode: 'roam',
    fleeChance: PIRATE_FLEE_BASE,
    fleeFrom: null,
    lastVertex: null,
    lastRobbed: false,
    robs: 0
  };
}

/** The pirate's payload with defaults for any key an old or hand-made marker misses. A copy: nothing is written back (use for views and checks). */
function readPayload(m: MarkerEntry, g?: GameState): PiratePayload {
  const base = freshPayload(pirateStrengthAt(g?.round || 0), g?.round || 0);
  return Object.assign(base, m.payload || {}) as PiratePayload;
}

/** The pirate's payload, completed with defaults IN PLACE (the same object every call), so the caller can change it and others see the change. */
function payloadOf(m: MarkerEntry, g?: GameState): PiratePayload {
  if (!m.payload || typeof m.payload !== 'object') m.payload = {};
  const base = freshPayload(pirateStrengthAt(g?.round || 0), g?.round || 0) as unknown as Record<string, any>;
  for (const k of Object.keys(base)) {
    if (m.payload[k] === undefined) m.payload[k] = base[k];
  }
  return m.payload as unknown as PiratePayload;
}

/** Strength of a pirate in `round`: starts at `PIRATE_BASE_STRENGTH`, +1 every `PIRATE_GROWTH_ROUNDS` rounds after `PIRATE_FIRST_ROUND`, capped. */
export function pirateStrengthAt(round: number): number {
  const r = Math.max(0, Math.floor(Number(round) || 0));
  const growth = Math.floor(Math.max(0, r - PIRATE_FIRST_ROUND) / PIRATE_GROWTH_ROUNDS);
  return Math.min(PIRATE_MAX_STRENGTH, PIRATE_BASE_STRENGTH + growth);
}

/** Knights `pid` has played (the same number Largest Army counts). Public, so bots can read it too. */
export function pirateKnights(g: GameState, pid: Id): number {
  return Math.max(0, Math.floor(Number(getPlayer(g, pid)?.stats?.knightsPlayed) || 0));
}

/** Played knights `pid` needs to drive off a pirate of `strength`: the strength itself, 2 fewer with Pirate hunter (never below 1). */
export function pirateKnightsNeeded(g: GameState, pid: Id, strength: number): number {
  const s = Math.max(1, Math.floor(Number(strength) || 1));
  return hasTech(g, pid, TECH_PIRATE_HUNTER) ? Math.max(1, s - PIRATE_CREW_KNIGHT_DISCOUNT) : s;
}

/** Cards a pirate of `strength` pays out: `PIRATE_LOOT_BASE + strength`, +50% with Pirate hunter. */
export function pirateLootCards(strength: number, hasCrew = false): number {
  const s = Math.max(1, Math.floor(Number(strength) || 1));
  const base = PIRATE_LOOT_BASE + s;
  return Math.max(1, Math.round(base * (hasCrew ? PIRATE_CREW_LOOT_MULT : 1)));
}

// ---- Geometry ---------------------------------------------------------------------------------------------------

const axialIndexCache = new WeakMap<GameState['board'], Map<string, number>>();

function hexIdAtAxial(g: GameState, q: number, r: number): number | undefined {
  let index = axialIndexCache.get(g.board);
  if (!index || index.size !== g.board.hexes.length) {
    index = new Map();
    for (const h of g.board.hexes) index.set(`${h.q},${h.r}`, h.id);
    axialIndexCache.set(g.board, index);
  }
  return index.get(`${q},${r}`);
}

/** Sea tiles (ids, ascending) next to `hexId`. Hidden (fog) tiles never count. */
export function seaNeighborIds(g: GameState, reg: Registry, hexId: number): number[] {
  const h = g.board.hexes[hexId];
  if (!h) return [];
  const out: number[] = [];
  for (const [dq, dr] of EDGE_DIR) {
    const id = hexIdAtAxial(g, h.q + dq, h.r + dr);
    if (id !== undefined && isWreckSeaHex(reg, g.board.hexes[id])) out.push(id);
  }
  return out.sort((a, b) => a - b);
}

/** The settlements and cities touching the corners of `hexId`: what a pirate on that tile robs. Ascending vertex ids. */
export function pirateContactVertices(g: GameState, reg: Registry, hexId: number): number[] {
  return verticesOfHex(g, reg, hexId)
    .filter(vId => {
      const pc = g.board.vertices[vId]?.piece;
      return !!pc && ROBBABLE_PIECES.includes(pc.type);
    })
    .sort((a, b) => a - b);
}

/** Every tile that touches vertex `vId` (land tiles plus the sea tiles at its corner). */
function cornerHexIds(g: GameState, reg: Registry, vId: number): number[] {
  const v = g.board.vertices[vId];
  if (!v) return [];
  return [...new Set<number>([...v.hexIds, ...seaHexIdsAt(g, reg, vId)])];
}

/**
 * Distance in tiles from `hexId` to the nearest tile that touches vertex `vId`. 0 = the hex touches that corner (contact).
 * `Infinity` when either id is unknown.
 */
export function hexVertexDistance(g: GameState, reg: Registry, hexId: number, vId: number): number {
  const h = g.board.hexes[hexId];
  if (!h || !g.board.vertices[vId]) return Infinity;
  if (verticesOfHex(g, reg, hexId).includes(vId)) return 0;
  let best = Infinity;
  for (const cId of cornerHexIds(g, reg, vId)) {
    const c = g.board.hexes[cId];
    if (c) best = Math.min(best, hexDistance(h, c));
  }
  return best;
}

/** Settlements and cities (vertex ids) of players who have MORE played knights than `strength`. A pirate keeps clear of these (T10d). */
export function guardedVertices(g: GameState, strength: number): number[] {
  const out: number[] = [];
  for (const v of g.board.vertices) {
    const pc = v.piece;
    if (!pc || !ROBBABLE_PIECES.includes(pc.type)) continue;
    if (pirateKnights(g, pc.owner) > strength) out.push(v.id);
  }
  return out;
}

/** Is `hexId` within `PIRATE_AVOID_RADIUS` tiles of a guarded city? */
export function isGuardedHex(g: GameState, reg: Registry, hexId: number, guarded: number[]): boolean {
  return guarded.some(vId => hexVertexDistance(g, reg, hexId, vId) <= PIRATE_AVOID_RADIUS);
}

/** Sea tiles a pirate could step to from its tile: next door, free of other pirates, and not near a guarded city. */
function stepOptions(g: GameState, reg: Registry, m: MarkerEntry, strength: number): number[] {
  const taken = new Set<number>(activePirates(g).filter(o => o.id !== m.id).map(o => Number(o.loc)));
  const guarded = guardedVertices(g, strength);
  return seaNeighborIds(g, reg, Number(m.loc)).filter(id => !taken.has(id) && !isGuardedHex(g, reg, id, guarded));
}

// ---- T10a: spawn ------------------------------------------------------------------------------------------------

/** Sea tiles a new pirate may appear on: ocean only, free, within 4 tiles of a player (like wrecks) and not near a guarded city. */
export function pirateSpawnCandidates(g: GameState, reg: Registry): number[] {
  const strength = pirateStrengthAt(g.round || 0);
  const guarded = guardedVertices(g, strength);
  const taken = new Set<number>(activePirates(g).map(m => Number(m.loc)));
  const out: number[] = [];
  for (const h of g.board.hexes) {
    if (taken.has(h.id) || !isWreckSeaHex(reg, h)) continue;
    if (minPlayerDistanceToHex(g, reg, h.id) > WRECK_MAX_PLAYER_DIST) continue;
    if (isGuardedHex(g, reg, h.id, guarded)) continue;
    out.push(h.id);
  }
  return out;
}

/**
 * Spawns a pirate on a random legal sea tile (from the pirate RNG stream), or on `opts.hexId` when it is legal.
 * Returns null when pirates are off, `PIRATE_MAX` are already out, or no tile fits. A new pirate does not rob until the next round starts.
 */
export function spawnPirate(ctx: Ctx, opts?: { hexId?: number }): MarkerEntry | null {
  const { g, reg } = ctx;
  if (!addonOn(reg, 'tidebound.pirates')) return null;
  if (activePirates(g).length >= PIRATE_MAX) return null;

  let hexId: number;
  if (opts?.hexId !== undefined) {
    const h = g.board.hexes[opts.hexId];
    if (!h || !isWreckSeaHex(reg, h) || pirateAt(g, opts.hexId)) return null;
    hexId = opts.hexId;
  } else {
    const cands = pirateSpawnCandidates(g, reg);
    if (cands.length === 0) return null;
    // The RNG state is made only now that a pirate will really appear, so a game with no legal tile stores nothing.
    hexId = cands[rngInt(ensurePirateRng(g), cands.length)];
  }

  const round = g.round || 0;
  const strength = pirateStrengthAt(round);
  const marker = addMarker(g, {
    kind: PIRATE_MARKER_KIND,
    target: 'hex',
    loc: hexId,
    ownerId: null,
    public: true,
    payload: freshPayload(strength, round) as unknown as Record<string, any>
  });
  ctx.emit('pirateSpawned', { id: marker.id, hexId, strength });
  appendPublicHistory(g, {
    type: 'pirateSpawned',
    actorId: null,
    targetId: null,
    summary: `A pirate ship (strength ${strength}) appeared on tile #${hexId}`,
    data: { id: marker.id, hexId, strength }
  });
  ctx.log(`🏴‍☠️ A pirate ship appeared on tile #${hexId} (strength ${strength}, takes ${strength} played knight${strength === 1 ? '' : 's'} to drive off)!`, null);
  return marker;
}

/** Event card registered in `EVENT_CARDS` for `tidebound.pirates`. */
export const pirateRaidCard: EventCardDef = {
  id: PIRATE_EVENT_ID,
  title: 'Pirate Raid',
  description: 'A pirate ship appears on the ocean (at most 2 at once). It raids coastal settlements and cities until enough knights drive it off.',
  pack: 'tidebound.pirates',
  copies: 1,
  apply(ctx: Ctx) {
    spawnPirate(ctx);
  }
};

// ---- T10c: robbing ----------------------------------------------------------------------------------------------

/** Rob one settlement or city: `PIRATE_ROB_CARDS` random resource cards go back to the bank. Returns the cards taken (0 when the hand was empty). */
function robVertex(ctx: Ctx, m: MarkerEntry, vertexId: number): number {
  const { g, reg } = ctx;
  const pc = g.board.vertices[vertexId]?.piece;
  const victim = pc ? getPlayer(g, pc.owner) : undefined;
  if (!pc || !victim) return 0;
  const pl = payloadOf(m, g);
  const rng = ensurePirateRng(g);

  let taken = 0;
  for (let n = 0; n < PIRATE_ROB_CARDS; n++) {
    const pool: string[] = [];
    for (const r of reg.resources.keys()) {
      for (let i = 0; i < (victim.resources[r] || 0); i++) pool.push(r);
    }
    if (pool.length === 0) break;
    const r = pool[rngInt(rng, pool.length)];
    victim.resources[r] -= 1;
    g.bank[r] = (g.bank[r] || 0) + 1;
    // kind 'pirate' (not 'steal'): the turn history and the bots' grudge notes read 'steal' as a player taking a card, and here the bank gets it.
    ctx.emit('transferred', { from: victim.id, to: 'bank', resource: r, amount: 1, kind: 'pirate', secret: true });
    taken++;
  }

  victim.stats.piratesRobbedCards = (victim.stats.piratesRobbedCards || 0) + taken;
  victim.stats.piratesRobbedTimes = (victim.stats.piratesRobbedTimes || 0) + 1;
  pl.robs += 1;
  pl.lastRobbed = true;
  pl.lastVertex = vertexId;

  // After EVERY rob the chance to run rises sharply, and more when the victim's knights are close to the pirate's strength (T10d).
  const closeness = Math.min(1, pirateKnights(g, victim.id) / Math.max(1, pl.strength));
  pl.fleeChance = Math.min(PIRATE_FLEE_MAX, pl.fleeChance + PIRATE_FLEE_ROB_STEP + PIRATE_FLEE_CLOSE_STEP * closeness);

  const label = pc.type === CITY ? 'city' : 'settlement';
  ctx.emit('pirateRobbed', { id: m.id, hexId: Number(m.loc), vertexId, victimId: victim.id, amount: taken });
  appendPublicHistory(g, {
    type: 'pirateRobbed',
    actorId: null,
    targetId: victim.id,
    summary: taken > 0 ? `Pirates robbed ${victim.name}'s ${label} of ${taken} card${taken === 1 ? '' : 's'}` : `Pirates raided ${victim.name}'s ${label}, but found no cards`,
    data: { id: m.id, hexId: Number(m.loc), vertexId, amount: taken }
  });
  ctx.log(
    taken > 0
      ? `🏴‍☠️ Pirates raided ${victim.avatar} ${victim.name}'s ${label} and took ${taken} card${taken === 1 ? '' : 's'}!`
      : `🏴‍☠️ Pirates raided ${victim.avatar} ${victim.name}'s ${label}, but they had no cards!`,
    victim.color
  );
  return taken;
}

/** Robs every settlement and city in `vertexIds` (ascending). */
function robContact(ctx: Ctx, m: MarkerEntry, vertexIds: number[]): number {
  let total = 0;
  for (const vId of vertexIds) total += robVertex(ctx, m, vId);
  return total;
}

// ---- T10a & T10d: movement and flee mode ------------------------------------------------------------------------

function movePirate(ctx: Ctx, m: MarkerEntry, toHexId: number, fleeing: boolean): void {
  const from = Number(m.loc);
  m.loc = toHexId;
  ctx.emit('pirateMoved', { id: m.id, from, to: toHexId, fleeing });
}

/** Random step to a free, unguarded neighbouring sea tile (the pirate stays put when there is none). */
function moveRoam(ctx: Ctx, m: MarkerEntry, rng: RngState): void {
  const pl = payloadOf(m, ctx.g);
  const opts = stepOptions(ctx.g, ctx.reg, m, pl.strength);
  if (opts.length === 0) return;
  movePirate(ctx, m, opts[rngInt(rng, opts.length)], false);
}

function endFlee(m: MarkerEntry, g: GameState): void {
  const pl = payloadOf(m, g);
  pl.mode = 'roam';
  pl.lastRobbed = false;
  pl.fleeChance = PIRATE_FLEE_BASE;
  pl.fleeFrom = null;
}

/** Up to `PIRATE_FLEE_STEPS` steps, each to the neighbour farthest from the robbed city. Flee ends at `PIRATE_FLEE_DISTANCE` tiles, or when the pirate cannot get any farther. */
function fleeStep(ctx: Ctx, m: MarkerEntry, rng: RngState): void {
  const { g, reg } = ctx;
  const pl = payloadOf(m, g);
  const from = pl.fleeFrom;
  if (from === null || from === undefined) {
    endFlee(m, g);
    return;
  }
  let moved = 0;
  for (let i = 0; i < PIRATE_FLEE_STEPS; i++) {
    const dCur = hexVertexDistance(g, reg, Number(m.loc), from);
    if (dCur >= PIRATE_FLEE_DISTANCE) break;
    const scored = stepOptions(g, reg, m, pl.strength)
      .map(id => ({ id, d: hexVertexDistance(g, reg, id, from) }))
      .filter(o => o.d > dCur);
    if (scored.length === 0) break;
    const best = Math.max(...scored.map(o => o.d));
    const pool = scored.filter(o => o.d === best);
    movePirate(ctx, m, pool[rngInt(rng, pool.length)].id, true);
    moved++;
  }
  const dEnd = hexVertexDistance(g, reg, Number(m.loc), from);
  if (dEnd >= PIRATE_FLEE_DISTANCE || moved === 0) endFlee(m, g);
}

function startFlee(ctx: Ctx, m: MarkerEntry, rng: RngState): void {
  const pl = payloadOf(m, ctx.g);
  pl.mode = 'flee';
  pl.fleeFrom = pl.lastVertex;
  ctx.emit('pirateFleeing', { id: m.id, hexId: Number(m.loc), from: pl.fleeFrom });
  ctx.log('🏴‍☠️ The pirate ship raises its sails and runs for open water!', null);
  fleeStep(ctx, m, rng);
}

/**
 * Round start for every pirate, in the order they arrived:
 *  1. Strength follows the round (`pirateStrengthAt`).
 *  2. Fleeing: run on (no robbing while it runs).
 *  3. Just robbed and still in contact: roll `fleeChance`; on success start fleeing, otherwise stick around and rob again.
 *  4. Otherwise take one random step (never next to a guarded city), then rob whatever it now touches.
 * All draws come from the pirate RNG stream.
 */
export function pirateRoundStep(ctx: Ctx): void {
  const { g, reg } = ctx;
  if (!addonOn(reg, 'tidebound.pirates')) return;
  const pirates = activePirates(g);
  if (pirates.length === 0) return;
  const rng = ensurePirateRng(g);
  const strength = pirateStrengthAt(g.round || 0);

  for (const m of pirates) {
    const pl = payloadOf(m, g);
    pl.strength = strength;

    if (pl.mode === 'flee') {
      fleeStep(ctx, m, rng);
      continue;
    }

    const here = pirateContactVertices(g, reg, Number(m.loc));
    if (pl.lastRobbed && here.length > 0) {
      if (rngNext(rng) < pl.fleeChance) {
        startFlee(ctx, m, rng);
      } else {
        robContact(ctx, m, here);
      }
      continue;
    }

    pl.lastRobbed = false;
    moveRoam(ctx, m, rng);
    const contact = pirateContactVertices(g, reg, Number(m.loc));
    if (contact.length > 0) robContact(ctx, m, contact);
    else pl.fleeChance = PIRATE_FLEE_BASE;
  }
}

/** Passive spawn when the Event Deck is off: round `PIRATE_FIRST_ROUND`, then every `PIRATE_CADENCE_ROUNDS`. */
export function passivePirateSpawn(ctx: Ctx): void {
  const { g, reg } = ctx;
  if (!addonOn(reg, 'tidebound.pirates')) return;
  if (g.rules?.eventsOn) return;
  const r = g.round || 0;
  if (r >= PIRATE_FIRST_ROUND && (r - PIRATE_FIRST_ROUND) % PIRATE_CADENCE_ROUNDS === 0) {
    spawnPirate(ctx);
  }
}

// ---- T10b: drive off a pirate -----------------------------------------------------------------------------------

/** Why `pid` cannot drive off the pirate on `hexId` right now, or `null` when they can. */
export function canDrivePirate(g: GameState, reg: Registry, pid: Id, hexId: number): string | null {
  if (!addonOn(reg, 'tidebound.pirates')) return 'Pirates are not in this game';
  if (!getPlayer(g, pid)) return 'Unknown player';
  if (!Number.isInteger(hexId)) return 'Choose a pirate';
  const m = pirateAt(g, hexId);
  if (!m) return 'There is no pirate on that tile';
  const need = pirateKnightsNeeded(g, pid, readPayload(m, g).strength);
  const have = pirateKnights(g, pid);
  if (have < need) return `Driving off this pirate takes ${need} played knight${need === 1 ? '' : 's'} (you have ${have})`;
  if (!playerTouchesWreck(g, reg, pid, hexId)) return "Build a road, bridge or port that touches the pirate's tile first";
  return null;
}

/** Tiles of the pirates `pid` could drive off right now. */
export function drivablePirateHexIds(g: GameState, reg: Registry, pid: Id): number[] {
  return activePirates(g)
    .map(m => Number(m.loc))
    .filter(hexId => canDrivePirate(g, reg, pid, hexId) === null)
    .sort((a, b) => a - b);
}

export const driveOffPirateAction: ActionDef = {
  type: DRIVE_OFF_PIRATE,
  validate(ctx: Ctx, pid: Id, payload: any): string | null {
    return canDrivePirate(ctx.g, ctx.reg, pid, Number(payload?.hexId));
  },
  apply(ctx: Ctx, pid: Id, payload: any): void {
    const { g, reg } = ctx;
    const p = getPlayer(g, pid)!;
    const hexId = Number(payload.hexId);
    const m = pirateAt(g, hexId)!;
    const pl = payloadOf(m, g);
    const rng = ensurePirateRng(g);

    // One resource type (like a wreck), picked from what the bank still has; the bank pays what it can.
    const stocked = [...reg.resources.keys()].filter(r => (g.bank[r] || 0) > 0);
    const kinds = stocked.length > 0 ? stocked : [...reg.resources.keys()];
    const resource = kinds[rngInt(rng, Math.max(1, kinds.length))] || 'wood';
    const wanted = pirateLootCards(pl.strength, hasTech(g, pid, TECH_PIRATE_HUNTER));
    const paid = bankGive(ctx, pid, resource, wanted);

    removeMarker(g, m.id);
    p.stats.piratesDriven = (p.stats.piratesDriven || 0) + 1;
    ctx.emit('pirateDriven', { id: m.id, hexId, playerId: pid, strength: pl.strength, resource, wanted, amount: paid });
    appendPublicHistory(g, {
      type: 'pirateDriven',
      actorId: pid,
      targetId: null,
      summary: `${p.name} drove off a pirate ship (strength ${pl.strength}) and took ${paid} ${resource}`,
      data: { hexId, strength: pl.strength, resource, amount: paid }
    });
    ctx.log(
      `⚔️ ${p.avatar} ${p.name} drove off the pirate ship (strength ${pl.strength}) and took ${paid} ${resource}!`,
      p.color
    );
  },
  legal(ctx: Ctx, pid: Id): { hexId: number }[] {
    return drivablePirateHexIds(ctx.g, ctx.reg, pid).map(hexId => ({ hexId }));
  }
};

// ---- Client views -----------------------------------------------------------------------------------------------

/** Public list of pirates for the board (`null` when Pirates is off or none are out). Nothing here is secret: strength and tile are public. */
export function pirateClientView(g: GameState, reg: Registry): PirateClientItem[] | null {
  if (!addonOn(reg, 'tidebound.pirates')) return null;
  const list = activePirates(g);
  if (list.length === 0) return null;
  return list.map(m => {
    const pl = readPayload(m, g);
    return { id: m.id, hexId: Number(m.loc), strength: pl.strength, mode: pl.mode };
  });
}

/**
 * VIEW_DATA entry (R7a.5, group 4): the public `pirates` field of the client state. Registered inside the pirates addon, so it exists only while
 * Pirates is on. While it is off the pack's always-on `tidebound.view_defaults` entry supplies `pirates: null` (a public field is null when off).
 */
export const pirateViewData: ViewDataDef = {
  id: 'tidebound.pirates.view',
  shared: (g: GameState, reg: Registry) => ({ pirates: pirateClientView(g, reg) })
};

/**
 * Tiles of the pirates `p` can drive off now, for the player's own view. `undefined` when the action is not in the game or it is not
 * `p`'s main-phase turn; `[]` when nothing can be driven off.
 */
export function pirateDriveView(g: GameState, reg: Registry, p: PlayerState): number[] | undefined {
  if (!reg.actions.has(DRIVE_OFF_PIRATE)) return undefined;
  if (g.phase !== 'main' || g.players[g.turn]?.id !== p.id) return undefined;
  return drivablePirateHexIds(g, reg, p.id);
}

/**
 * VIEW_DATA entry (R7a.5, group 9): `pirateDrives`, the tiles of the pirates you could drive off right now (yourself only). `pirateDriveView` returns
 * `undefined` unless the action is in the game and it is your main-phase turn, so the field is absent otherwise, as before.
 */
export const pirateDriveViewData: ViewDataDef = {
  id: 'tidebound.pirates.drive_view',
  player: (g, reg, p, who) => ({ pirateDrives: who.self ? pirateDriveView(g, reg, p) : undefined })
};

// ---- Minimal bot support (`BOT_GOALS`) --------------------------------------------------------------------------

/**
 * A bot drives off a pirate whenever it can (it has the played knights and a piece touching the tile): the loot is bigger than a wreck and costs nothing.
 * Building toward a pirate, playing knights for it and keeping clear of one are part of the T13 tuning pass.
 */
export const pirateBotGoal: BotGoalDef = {
  id: 'tidebound.pirates',
  goalClass: 'generic',
  goals(ctx: Ctx, pid: Id): BotGoalItem[] {
    const { g, reg } = ctx;
    if (!addonOn(reg, 'tidebound.pirates') || g.phase !== 'main') return [];
    const hexId = drivablePirateHexIds(g, reg, pid)[0];
    if (hexId === undefined) return [];
    return [
      {
        id: `tidebound.pirates.drive:${hexId}`,
        priority: 78,
        cost: {},
        action: { type: DRIVE_OFF_PIRATE, payload: { hexId } }
      }
    ];
  },
  actionScore(ctx: Ctx, pid: Id, action: { type: string; payload: any }): number {
    if (action.type !== DRIVE_OFF_PIRATE) return 0;
    return canDrivePirate(ctx.g, ctx.reg, pid, Number(action.payload?.hexId)) === null ? 70 : 0;
  }
};

export const piratesAddon: AddonDef = {
  id: 'tidebound.pirates',
  name: 'Pirates',
  description: 'Up to 2 pirates roam the ocean and rob coastal settlements. Beating one takes knights, and it pays more than a wreck.',
  links: [
    { target: 'strength', kind: 'mechanic' },
    { target: 'marker', kind: 'mechanic' },
    { target: 'bot-goals', kind: 'bot' },
    { target: 'tidebound.wrecks', kind: 'content' }
  ],
  register(api) {
    registerTideboundTechs(api);
    api.define(EVENT_CARDS, pirateRaidCard);
    api.define(BOT_GOALS, pirateBotGoal);
    // R7a.5: the public pirate markers for the client state.
    api.define(VIEW_DATA, pirateViewData);
    api.define(VIEW_DATA, pirateDriveViewData);
    api.action(driveOffPirateAction);
    api.phaseAction('main', DRIVE_OFF_PIRATE);
    api.hook('onRoundStart', (ctx: Ctx) => {
      pirateRoundStep(ctx);
      passivePirateSpawn(ctx);
    });
  }
};
