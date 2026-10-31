// MODULE: tidebound.fishing addon (T7a fish wild token: spend action, counts for a 7 discard, can be stolen, never in the bank; T7b1 fishing net piece, coast placement rule, catch on every roll; T7b2 net spots for the client view and the net bot goal; T7c fish icon boosts: a sea tile with boosts left doubles a net's catch chance and loses one boost per catch; T7d tide replenish: tides refill icons slowly, a deeper tide faster; T7e feed the sea: 1 wheat fills a ground next to your net; T11c/d/e tech gates & Net works) | DEPENDS ON: packs/base/constants, packs/base/placement, packs/tidebound/seaData, packs/tidebound/tech, packs/tidebound/tides, shared/index, +1 more | USED BY: packs/tidebound/addons.generated, packs/tidebound/index, packs/tidebound/pirates, packs/tidebound/wrecks
import {
  BOT_GOALS,
  COST_MODS,
  getPlayer,
  getWildTokens,
  grantWildToken,
  hasTech,
  makeCtx,
  placedCount,
  priceOf,
  spendWildToken,
  techGate,
  totalCards,
  VIEW_DATA,
  WILD_TOKENS
} from '../../shared';
import type {
  ActionDef,
  AddonDef,
  BotGoalDef,
  BotGoalItem,
  CostModifier,
  Ctx,
  GameState,
  Hex,
  Id,
  PieceDef,
  PlayerState,
  Registry,
  Resources,
  ViewDataDef,
  WildTokenDef
} from '../../shared';
import { createRng, rngNext } from '../../shared/rng';
import { CITY, SETTLEMENT } from '../base/constants';
import { ownsRoadAt } from '../base/placement';
import { FISH_BOOSTS } from './seaData';
import { registerTideboundTechs, TECH_FISHING_NETS, TECH_HARBOR_MASTER, TECH_NET_WORKS } from './tech';
import { floodDepthAt, tideLevelOf } from './tides';
import type { TideState } from './tides';

export { TECH_FISHING_NETS, TECH_HARBOR_MASTER, TECH_NET_WORKS };

/** Wild token id of the fish (also in the shared `BUILTIN_WILD_IDS`, so `isWildTokenResource` already knows it). */
export const FISH = 'fish';
/** Action type: spend one fish as any 1 resource from the bank. */
export const SPEND_FISH = 'spend_fish';
/** Action type: pay 1 wheat to fill the fish icon of a sea tile next to one of your nets (T7e). */
export const FEED_SEA = 'feed_sea';
/** What feeding the sea costs: one low-value resource, so it is a small paid shortcut and never competes with a city. Tune in T14. */
export const FEED_SEA_COST: Resources = { wheat: 1 };

/**
 * The fish token. It lives in `g.ext.core.wildTokens[playerId].fish`, never in `p.resources` or the bank, so it cannot be traded,
 * is not part of the bank supply (`g.bank` has no fish key, nothing caps it) and never makes a bank-trade or "no one has X" check look at it.
 * It counts toward the 7 discard limit (Seven Resolver reads `countInDiscard`) and the robber can steal it (`stealOne` reads `stealable`).
 */
export const fishToken: WildTokenDef = { id: FISH, name: 'Fish', countInDiscard: true, stealable: true };

/**
 * Spend: one fish becomes 1 card of any resource the bank still has. Payload `{ resource }`. Main phase of your own turn (like a bank trade).
 * The token is only spent when the bank can pay, so a fish is never lost to an empty bank.
 */
export const spendFishAction: ActionDef = {
  type: SPEND_FISH,
  validate(ctx: Ctx, pid: Id, payload: any): string | null {
    const { g, reg } = ctx;
    if (!getPlayer(g, pid)) return 'Unknown player';
    if (getWildTokens(g, pid, FISH) <= 0) return 'You have no fish to spend';
    const r = payload?.resource;
    if (typeof r !== 'string' || !reg.resources.has(r)) return 'Choose a resource';
    if ((g.bank[r] || 0) <= 0) return `Bank is out of ${r.toUpperCase()}!`;
    return null;
  },
  apply(ctx: Ctx, pid: Id, payload: any): void {
    const p = getPlayer(ctx.g, pid)!;
    const got = spendWildToken(ctx, pid, FISH, payload.resource, 1);
    p.stats.fishSpent = (p.stats.fishSpent || 0) + got;
    ctx.emit('fishSpent', { playerId: pid, resource: payload.resource, amount: got });
    ctx.log(`🐟 ${p.avatar} ${p.name} spent a fish for 1 ${payload.resource}`, p.color);
  },
  legal(ctx: Ctx, pid: Id): { resource: string }[] {
    if (getWildTokens(ctx.g, pid, FISH) <= 0) return [];
    return [...ctx.reg.resources.keys()].filter(r => (ctx.g.bank[r] || 0) > 0).map(resource => ({ resource }));
  }
};

// ---- Minimal bot support (T7a) -------------------------------------------------------------------------------------------

/** The one resource this hand lacks for `cost`, if it lacks exactly one card in total; otherwise null. */
function oneCardShort(p: PlayerState, cost: Resources): string | null {
  let short = 0;
  let which: string | null = null;
  for (const [r, n] of Object.entries(cost)) {
    const lack = n - (p.resources[r] || 0);
    if (lack > 0) {
      short += lack;
      which = r;
    }
  }
  return short === 1 ? which : null;
}

/** Cards a bot must still hold after paying for a feed, so feeding the sea never eats the cards a build is waiting for. Tuning is T13. */
export const FEED_BOT_SPARE = 4;

/**
 * Score for a `feed_sea` action. The brain takes the best positive custom action before it trades or buys, so this stays at 0 unless the feed
 * is clearly cheap for the bot: the ground is empty (a used-up icon, 12) or has no icon yet (10), the bot holds at least one more of the
 * price than it pays, and the hand keeps `FEED_BOT_SPARE` cards after paying. A ground that still has boosts is never fed (it would waste the price).
 */
function feedSeaScore(ctx: Ctx, pid: Id, hexId: unknown): number {
  const { g } = ctx;
  if (!techGate(g, pid, TECH_HARBOR_MASTER)) return 0;
  const p = getPlayer(g, pid);
  const hex = typeof hexId === 'number' ? g.board.hexes[hexId] : undefined;
  if (!p || !hex) return 0;
  const left = fishLeft(hex);
  if (left !== null && left > 0) return 0;
  if (!Object.entries(FEED_SEA_COST).every(([r, n]) => (p.resources[r] || 0) >= n + 1)) return 0;
  const price = Object.values(FEED_SEA_COST).reduce((a, n) => a + (n || 0), 0);
  if (totalCards(p) < price + FEED_BOT_SPARE) return 0;
  return left === 0 ? 12 : 10;
}

/**
 * A bot spends a fish only when that one card finishes its next city, settlement or development card, so fish are kept for the build
 * and never spent for nothing. Holding fish is not punished (they count toward the discard limit like any card). T7e: it also feeds an empty
 * fishing ground next to its nets when it has cards to spare (`feedSeaScore`). Tuning is T13.
 */
export const fishBotGoal: BotGoalDef = {
  id: 'tidebound.fishing',
  goalClass: 'generic',
  actionScore(ctx: Ctx, pid: Id, action: { type: string; payload: any }): number {
    if (action.type === FEED_SEA) return feedSeaScore(ctx, pid, action.payload?.hexId);
    if (action.type !== SPEND_FISH) return 0;
    const { g, reg } = ctx;
    const p = getPlayer(g, pid);
    const r = action.payload?.resource;
    if (!p || typeof r !== 'string') return 0;
    const city = reg.pieces.get(CITY);
    const settlement = reg.pieces.get(SETTLEMENT);
    const hasSettlement = g.board.vertices.some(v => v.piece?.owner === pid && v.piece.type === SETTLEMENT);
    if (city && hasSettlement && (p.pieces[CITY] || 0) > 0 && oneCardShort(p, priceOf(g, reg, p, city)) === r) return 40;
    if (settlement && (p.pieces[SETTLEMENT] || 0) > 0 && oneCardShort(p, priceOf(g, reg, p, settlement)) === r) return 35;
    if (g.deck.length > 0 && oneCardShort(p, g.rules.devCost) === r) return 25;
    return 0;
  }
};

// ---- T7b1 & T11d: fishing nets & Net works -------------------------------------------------------------------------------

// A net is a vertex piece on a coast vertex (one that touches land and at least one sea tile), joined to your own road or bridge like a settlement.
// It makes no number and takes no tile: on every roll each net has a small chance to catch one fish for its owner. Nets ignore Tides (nothing
// here reads the tile state), so a net keeps fishing under a flood. Like any vertex piece it takes the corner and blocks the distance rule for
// settlements next to it. T7c: a sea tile at the net that still has fish boosts doubles that chance (see `netCatchOnRoll`).

/** Piece id of the fishing net. */
export const NET = 'net';
/** Base price: 2 wood + 1 sheep, so a net does not compete with a settlement for brick, ore or wheat. Net works (T11d) takes 1 wood off. */
export const NET_COST: Resources = { wood: 2, sheep: 1 };
/** Nets one player may have on the board before the next costs double. Scaled by land radius and VP like bridges. */
export const NET_BASE_LIMIT = 4;
/** Chance one net catches a fish on one roll (1 in 6, a trickle). A fish icon with boosts left doubles it (T7c); Net works (T11d) raises the base to 1 in 4. */
export const NET_CATCH_CHANCE = 1 / 6;
/** Base catch chance of a net when its owner has researched `tidebound.net_works` (1 in 4). */
export const NET_WORKS_CATCH_CHANCE = 1 / 4;
/** A fish icon at a net doubles the catch chance while it has boosts left (T7c). */
export const FISH_ICON_MULTIPLIER = 2;
/** The catch chance of a net with at least one boosted sea tile (1 in 3). */
export const NET_BOOSTED_CHANCE = NET_CATCH_CHANCE * FISH_ICON_MULTIPLIER;
/** Boosted catch chance of a net when its owner has researched `tidebound.net_works` (1 in 2). */
export const NET_WORKS_BOOSTED_CHANCE = NET_WORKS_CATCH_CHANCE * FISH_ICON_MULTIPLIER;
/** Chance that a boosted catch does NOT consume a fish boost when the owner has researched `tidebound.net_works` (1 in 3). */
export const NET_WORKS_SAVE_BOOST_CHANCE = 1 / 3;
/** Mixed into the world seed to get the net draws (the tide stream and the event deck use other salts). */
const NET_SEED_SALT = 0x6e657473;
/** Mixed into the world seed to get the Net works boost-save draws (T11d). */
const NET_BOOST_SAVE_SALT = 0x6e777376;
/** Mixed into the world seed to get the tide replenish draws (T7d). */
const FISH_REPLENISH_SALT = 0x66697368;

/**
 * `COST_MODS` entry for `tidebound.net_works` (T11d):
 * Reduces the wood cost of building a `net` by 1 (so 2 wood + 1 sheep becomes 1 wood + 1 sheep at 1x, or 3 wood + 2 sheep at 2x).
 */
export const netWorksCostMod: CostModifier = {
  id: 'tidebound.net_works',
  replace: true,
  apply(g: GameState, p: PlayerState, def: PieceDef, cost: Resources): Resources {
    if (def.id !== NET || !hasTech(g, p.id, TECH_NET_WORKS)) return cost;
    return { ...cost, wood: Math.max(0, (cost.wood || 0) - 1) };
  }
};

/** Neighbour of a hex across its edge i (the edge between corner i and corner i + 1). Same table as `shared/topology.ts`. */
const EDGE_DIR: [number, number][] = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];

const hexIndexCache = new WeakMap<GameState['board'], Map<string, number>>();

/** Id of the hex at axial (q, r), or undefined off the board. The lookup is built once per board object. */
function hexIdAt(board: GameState['board'], q: number, r: number): number | undefined {
  let index = hexIndexCache.get(board);
  if (!index || index.size !== board.hexes.length) {
    index = new Map();
    for (const h of board.hexes) index.set(`${h.q},${h.r}`, h.id);
    hexIndexCache.set(board, index);
  }
  return index.get(`${q},${r}`);
}

/** Is this tile a fishing ground? The same test as the fish icons (T2c): not land, no `noPort` flag, not a river channel (lakes count). */
export function isSeaHex(reg: Registry, hex: Hex | undefined): boolean {
  if (!hex) return false;
  const def = reg.tiles.get(hex.type);
  return !!def && !def.land && !def.noPort && !hex.ext?.river;
}

/**
 * The sea tiles (ids, ascending) that touch this vertex. `v.hexIds` holds land tiles only, so the sea side is found from the land tile's own
 * corner: the two neighbours across the edges that meet at that corner. Needs no water topology, so it works with Bridges off.
 * Empty for a vertex with no land (open water) and for a vertex inland.
 */
export function seaHexIdsAt(g: GameState, reg: Registry, vertexId: number): number[] {
  const v = g.board.vertices[vertexId];
  if (!v) return [];
  const out = new Set<number>();
  for (const landId of v.hexIds) {
    const land = g.board.hexes[landId];
    const corner = land ? land.vertexIds.indexOf(vertexId) : -1;
    if (!land || corner < 0) continue;
    for (const k of [corner, (corner + 5) % 6]) {
      const id = hexIdAt(g.board, land.q + EDGE_DIR[k][0], land.r + EDGE_DIR[k][1]);
      if (id !== undefined && isSeaHex(reg, g.board.hexes[id])) out.add(id);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Placement: build phase only, gated by `techGate(ctx.g, pid, TECH_FISHING_NETS)`, an empty coast vertex (touches land and at least one sea tile)
 * next to a road, bridge or rickety bridge you own. There is no distance rule between nets and other pieces. Never on a port vertex (T7b2):
 * `ratioFor` gives a port to ANY piece of yours on its vertex, so a 3-card net there would be a port without a settlement.
 */
export function canPlaceNet(ctx: Ctx, pid: Id, vertexId: number, mode: 'setup' | 'build'): boolean {
  if (mode !== 'build') return false;
  if (!techGate(ctx.g, pid, TECH_FISHING_NETS)) return false;
  const v = ctx.g.board.vertices[vertexId];
  if (!v || v.piece || v.port || v.hexIds.length === 0) return false;
  if (!v.edgeIds.some(eId => ownsRoadAt(ctx, pid, eId))) return false;
  return seaHexIdsAt(ctx.g, ctx.reg, vertexId).length > 0;
}

export const netPiece: PieceDef = {
  id: NET,
  name: 'Fishing net',
  target: 'vertex',
  cost: NET_COST,
  vp: 0,
  produces: 0,
  baseLimit: NET_BASE_LIMIT,
  scaleWithRadius: true,
  icon: '🎣',
  // R7a.5 (group 11): shows in the client's `pieceCosts` only once the Fishing nets tech is unlocked (was a hard-coded line in `server/view.ts`).
  available: (g: GameState, pid: Id) => techGate(g, pid, TECH_FISHING_NETS),
  canPlace: canPlaceNet
};

/**
 * One uniform number in [0, 1) for two numbers `a` and `b`: a pure hash of the world seed, a salt and the pair. No `g.rng` draw, nothing stored,
 * so the same seed always gives the same number and a game with nets never moves a die roll.
 */
function hashDraw(seed: number, salt: number, a: number, b: number): number {
  let h = ((Number(seed) || 1) ^ salt) >>> 0;
  h = Math.imul(h ^ (a + 1), 0x9e3779b1) >>> 0;
  h = Math.imul(h ^ (b + 1), 0x85ebca6b) >>> 0;
  const r = createRng(h);
  rngNext(r);
  return rngNext(r);
}

/** The draw of this net on this roll. */
function netDraw(seed: number, roll: number, vertexId: number): number {
  return hashDraw(seed, NET_SEED_SALT, roll, vertexId);
}

/** Rolls made so far. The roll action adds one to `diceStats` before the onRoll hooks run, so every roll gets its own number. */
function rollsSoFar(g: GameState): number {
  let n = 0;
  for (const c of Object.values(g.diceStats ?? {})) n += Number(c) || 0;
  return n;
}

// ---- T7c: fish icon boosts ------------------------------------------------------------------------------------------------

/**
 * Boosts left on a fishing ground (a sea tile with `ext.fish`): a whole number from 0 to FISH_BOOSTS, or null when the tile has no icon at all.
 * 0 is a used-up icon. It stays on the tile (the icon never goes away), and only tides (T7d) and feeding the sea (T7e) bring boosts back.
 */
export function fishLeft(hex: Hex | undefined): number | null {
  const raw = hex?.ext?.fish;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return Math.min(FISH_BOOSTS, Math.max(0, Math.round(raw)));
}

/** The sea tile at a net with the most boosts left (more than 0), lowest id on a tie; null when none of its tiles has a boost left. `seaIds` is ascending. */
function richestGround(g: GameState, seaIds: number[]): number | null {
  let best: number | null = null;
  let bestLeft = 0;
  for (const id of seaIds) {
    const left = fishLeft(g.board.hexes[id]) ?? 0;
    if (left > bestLeft) {
      best = id;
      bestLeft = left;
    }
  }
  return best;
}

/**
 * onRoll: every net rolls once, whatever the dice say (a 7 too: a fish caught before a 7 counts toward that 7's discard like any card).
 * A hit gives its owner one fish. A net that no longer touches a sea tile catches nothing. Draws nothing from `g.rng`.
 *
 * T7c: when at least one sea tile at the net still has a fish boost, the chance is doubled (1 in 3), and every fish caught that way uses up one
 * boost of the richest such tile (ties go to the lowest tile id), so a full icon is good for 4 fish.
 * T11d (`tidebound.net_works`): base catch chance rises to 1 in 4 (boosted 1 in 2), and a boosted catch has a 1 in 3 chance to NOT consume a boost.
 */
export function netCatchOnRoll(ctx: Ctx, _sum: number): void {
  const { g, reg } = ctx;
  const roll = rollsSoFar(g);
  for (const v of g.board.vertices) {
    if (v.piece?.type !== NET) continue;
    const sea = seaHexIdsAt(g, reg, v.id);
    if (sea.length === 0) continue;
    const owner = getPlayer(g, v.piece.owner);
    if (!owner) continue;
    const hasNetWorks = hasTech(g, owner.id, TECH_NET_WORKS);
    const baseChance = hasNetWorks ? NET_WORKS_CATCH_CHANCE : NET_CATCH_CHANCE;
    const boostedChance = hasNetWorks ? NET_WORKS_BOOSTED_CHANCE : NET_BOOSTED_CHANCE;
    const ground = richestGround(g, sea);
    const chance = ground === null ? baseChance : boostedChance;
    if (netDraw(g.seed, roll, v.id) >= chance) continue;
    grantWildToken(ctx, owner.id, FISH, 1);
    owner.stats.fishCaught = (owner.stats.fishCaught || 0) + 1;
    let left: number | null = null;
    let savedBoost = false;
    if (ground !== null) {
      const hex = g.board.hexes[ground];
      const curLeft = fishLeft(hex) ?? 0;
      if (hasNetWorks && hashDraw(g.seed, NET_BOOST_SAVE_SALT, roll, v.id) < NET_WORKS_SAVE_BOOST_CHANCE) {
        left = curLeft;
        savedBoost = true;
      } else {
        left = Math.max(0, curLeft - 1);
        hex.ext.fish = left;
      }
    }
    ctx.emit('fishCaught', {
      playerId: owner.id,
      vertexId: v.id,
      amount: 1,
      ...(ground !== null ? { hexId: ground, left, savedBoost } : {})
    });
    const rest =
      ground === null
        ? ''
        : savedBoost
          ? ` (Net works saved the boost — ${left} left)`
          : left === 0
            ? ' (that fishing ground is used up)'
            : ` (${left} ${left === 1 ? 'boost' : 'boosts'} left on that ground)`;
    ctx.log(`🎣 ${owner.avatar} ${owner.name}'s net caught a fish${rest}`, owner.color);
  }
}

// ---- T7d: tide replenish --------------------------------------------------------------------------------------------------

/**
 * Chance, per round, that a fishing ground with room regains one boost, by how deep the tide reaches the coast beside it: index 0 dry, 1 the coast
 * ring (a normal tide), 2 the deeper reading (a spring tide, or a Very high tide). Slow on purpose: at Medium a ground beside a flooding coast
 * regains about one boost every 10 rounds, and a spring tide more than doubles that. Starting guesses: tune in T14.
 */
export const FISH_REPLENISH_CHANCE: readonly number[] = [0, 0.2, 0.45];

/**
 * The sea tiles (id -> 1 or 2) the tide reaches in `round`: the sea around the coast tiles of every cluster whose schedule floods it
 * (`floodDepthAt`). The deeper reading wins when a tile touches two clusters. Empty when Tides is not in the game. Pure: reads the clusters, the
 * round and the tide level, so it is the same for the same seed. It looks at the schedule, not at which coast tiles actually flood (elevation
 * can hold a tile dry): the sea does not care how high the land is.
 */
export function tideReachOnSea(g: GameState, reg: Registry, round: number): Map<number, 1 | 2> {
  const out = new Map<number, 1 | 2>();
  const st = g.ext?.tidebound?.tides as TideState | undefined;
  if (!st) return out;
  const level = tideLevelOf(g);
  for (const c of st.clusters) {
    const depth = floodDepthAt(c, round, level);
    if (depth === 0) continue;
    for (const landId of c.hexIds) {
      const land = g.board.hexes[landId];
      if (!land) continue;
      for (const [dq, dr] of EDGE_DIR) {
        const id = hexIdAt(g.board, land.q + dq, land.r + dr);
        if (id === undefined || !isSeaHex(reg, g.board.hexes[id])) continue;
        if (depth > (out.get(id) ?? 0)) out.set(id, depth);
      }
    }
  }
  return out;
}

/**
 * onRoundStart: every fishing ground the tide reaches this round, that has an icon and room (fewer than FISH_BOOSTS), regains one boost with
 * the chance of `FISH_REPLENISH_CHANCE` for its depth. A ground whose icon ran out (0) is refilled the same way: the icon never goes away.
 * A tile with no icon never gets one from the tide (feeding the sea does that). Draws are a hash of seed, round and tile, so nothing comes from
 * `g.rng` and nothing is stored. Does nothing with Tides off. Returns the tile ids that grew.
 */
export function replenishFish(ctx: Ctx): number[] {
  const { g, reg } = ctx;
  if (!reg.enabled.has('tidebound.tides') || !g.ext?.tidebound?.tides) return [];
  const round = g.round || 0;
  const reach = tideReachOnSea(g, reg, round);
  const grown: number[] = [];
  for (const id of [...reach.keys()].sort((a, b) => a - b)) {
    const hex = g.board.hexes[id];
    const left = fishLeft(hex);
    if (left === null || left >= FISH_BOOSTS) continue;
    if (hashDraw(g.seed, FISH_REPLENISH_SALT, round, id) >= FISH_REPLENISH_CHANCE[reach.get(id)!]) continue;
    hex.ext.fish = left + 1;
    grown.push(id);
  }
  if (grown.length > 0) {
    ctx.emit('fishReplenished', { round, hexIds: grown });
    const n = grown.length;
    ctx.log(`🐟 The tide brings fish back to ${n} fishing ${n === 1 ? 'ground' : 'grounds'}`, null);
  }
  return grown;
}

// ---- T7e & T11e: feed the sea (gated by Harbor master when Tech Tree is on) ----------------------------------------------

/** Can this player pay the price of feeding the sea? (Only resources the registry knows can pay.) */
function canAffordFeed(p: PlayerState, reg: Registry): boolean {
  return Object.entries(FEED_SEA_COST).every(([r, n]) => reg.resources.has(r) && (p.resources[r] || 0) >= n);
}

/** The visible sea tiles (ids, ascending) next to at least one net of this player: where feeding the sea is allowed. */
export function netSeaHexIds(g: GameState, reg: Registry, pid: Id): number[] {
  const out = new Set<number>();
  for (const v of g.board.vertices) {
    if (v.piece?.type !== NET || v.piece.owner !== pid) continue;
    for (const id of seaHexIdsAt(g, reg, v.id)) {
      if (!g.board.hexes[id]?.ext?.hidden) out.add(id);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** The tiles this player could feed right now: next to one of their nets and not full (no icon yet counts as empty). The price is not checked. */
export function feedableHexIds(g: GameState, reg: Registry, pid: Id): number[] {
  return netSeaHexIds(g, reg, pid).filter(id => (fishLeft(g.board.hexes[id]) ?? -1) < FISH_BOOSTS);
}

/**
 * Feed the sea. Payload `{ hexId }`. Main phase of your own turn (`api.phaseAction`). Pays `FEED_SEA_COST` (1 wheat) into the bank and sets the
 * sea tile to FISH_BOOSTS: a tile with no icon gets one, an empty one is refilled at once, a half-full one is topped up. A full tile is refused
 * (nothing to buy). The tile must be open sea next to one of YOUR nets, so a net is what makes a ground yours to feed. Gated by
 * `techGate(g, pid, TECH_HARBOR_MASTER)` when the Tech Tree is on (T11e). No RNG.
 */
export const feedSeaAction: ActionDef = {
  type: FEED_SEA,
  validate(ctx: Ctx, pid: Id, payload: any): string | null {
    const { g, reg } = ctx;
    const p = getPlayer(g, pid);
    if (!p) return 'Unknown player';
    if (!techGate(g, pid, TECH_HARBOR_MASTER)) return 'Research Harbor master first';
    const id = payload?.hexId;
    if (!Number.isInteger(id)) return 'Choose a sea tile to feed';
    const hex = g.board.hexes[id];
    if (!hex || hex.ext?.hidden || !isSeaHex(reg, hex)) return 'Only open sea can be fed';
    if (!netSeaHexIds(g, reg, pid).includes(id)) return 'Feed a sea tile next to one of your nets';
    if ((fishLeft(hex) ?? -1) >= FISH_BOOSTS) return 'That fishing ground is already full';
    for (const [r, n] of Object.entries(FEED_SEA_COST)) {
      if (!reg.resources.has(r)) return `Feeding the sea needs ${r}`;
      if ((p.resources[r] || 0) < n) return `Not enough ${r.toUpperCase()}!`;
    }
    return null;
  },
  apply(ctx: Ctx, pid: Id, payload: any): void {
    const { g } = ctx;
    const p = getPlayer(g, pid)!;
    const hex = g.board.hexes[payload.hexId];
    const before = fishLeft(hex);
    for (const [r, n] of Object.entries(FEED_SEA_COST)) {
      p.resources[r] -= n;
      g.bank[r] = (g.bank[r] || 0) + n;
    }
    if (!hex.ext) hex.ext = {};
    hex.ext.fish = FISH_BOOSTS;
    p.stats.seaFed = (p.stats.seaFed || 0) + 1;
    ctx.emit('seaFed', { playerId: pid, hexId: hex.id, before, left: FISH_BOOSTS });
    ctx.log(`🌊 ${p.avatar} ${p.name} fed the sea: ${before === null ? 'a new fishing ground' : 'a fishing ground is full again'}`, p.color);
  },
  legal(ctx: Ctx, pid: Id): { hexId: number }[] {
    if (!techGate(ctx.g, pid, TECH_HARBOR_MASTER)) return [];
    const p = getPlayer(ctx.g, pid);
    if (!p || !canAffordFeed(p, ctx.reg)) return [];
    return feedableHexIds(ctx.g, ctx.reg, pid).map(hexId => ({ hexId }));
  }
};

// ---- What the client needs (icons on the sea, the feed spots) --------------------------------------------------------------

/**
 * The fish icons for the `gameState` the client draws: sea tile id -> boosts left (0 for a used-up icon, which is still drawn, faded). Public
 * information (everyone sees the sea). Hidden (fog) tiles are left out. Null when Fishing is not in the game or no tile has an icon, so a
 * game without them sends nothing new.
 */
export function fishClientView(g: GameState, reg: Registry): Record<number, number> | null {
  if (!reg.enabled.has('tidebound.fishing')) return null;
  const out: Record<number, number> = {};
  let any = false;
  for (const hex of g.board.hexes) {
    if (hex.ext?.hidden || !isSeaHex(reg, hex)) continue;
    const left = fishLeft(hex);
    if (left === null) continue;
    out[hex.id] = left;
    any = true;
  }
  return any ? out : null;
}

/**
 * VIEW_DATA entry (R7a.5, group 1): the public `fishIcons` field of the client state. Registered inside the fishing addon, so it exists only while
 * Fishing is on. While it is off the pack's always-on `tidebound.view_defaults` entry supplies `fishIcons: null` (a public field is null when off).
 */
export const fishViewData: ViewDataDef = {
  id: 'tidebound.fishing.view',
  shared: (g: GameState, reg: Registry) => ({ fishIcons: fishClientView(g, reg) })
};

/**
 * The sea tiles this player could feed right now: what the client draws as clickable grounds in feed mode. `undefined` when feeding the sea is not
 * in the game, locked behind `tidebound.harbor_master`, or it is not this player's turn in the main phase; `[]` when they cannot pay or have no net
 * with a ground that has room.
 */
export function feedSpotsView(g: GameState, reg: Registry, p: PlayerState): number[] | undefined {
  if (!reg.actions.has(FEED_SEA)) return undefined;
  if (!techGate(g, p.id, TECH_HARBOR_MASTER)) return undefined;
  if (g.phase !== 'main' || g.players[g.turn]?.id !== p.id) return undefined;
  if (!canAffordFeed(p, reg)) return [];
  return feedableHexIds(g, reg, p.id);
}

// ---- T7b2: net spots for the client, and the net bot goal ---------------------------------------------------------------------

/**
 * The vertices where this player could put a net right now: what the client draws as build spots. `undefined` when nets are not in the game,
 * locked behind `tidebound.fishing_nets`, or it is not this player's turn in the main phase, so a game without them (and every other viewer) gets
 * nothing new.
 */
export function netSpotsView(g: GameState, reg: Registry, p: PlayerState): number[] | undefined {
  if (!reg.pieces.has(NET)) return undefined;
  if (!techGate(g, p.id, TECH_FISHING_NETS)) return undefined;
  if (g.phase !== 'main' || g.players[g.turn]?.id !== p.id) return undefined;
  if ((p.pieces[NET] ?? 0) <= 0) return [];
  const ctx = makeCtx(g, reg);
  const out: number[] = [];
  for (const v of g.board.vertices) {
    if (canPlaceNet(ctx, p.id, v.id, 'build')) out.push(v.id);
  }
  return out;
}

/**
 * VIEW_DATA entry (R7a.5, group 6): the player's net fields. `netsLeft` (supply left) is sent for every viewer once nets are in the game and unlocked;
 * `netSpots` (where a net could go) is for yourself only. Both are `undefined` otherwise, so a game without nets sends nothing new.
 * The gate is the same expression `server/view.ts` used (`netTechOk`).
 */
export const netViewData: ViewDataDef = {
  id: 'tidebound.fishing.nets_view',
  player: (g, reg, p, who) => {
    const netTechOk = reg.pieces.has(NET) && techGate(g, p.id, TECH_FISHING_NETS);
    return {
      netsLeft: netTechOk ? p.pieces[NET] : undefined,
      netSpots: who.self ? netSpotsView(g, reg, p) : undefined
    };
  }
};

/**
 * VIEW_DATA entry (R7a.5, group 7): the player's feed-the-sea fields, for yourself only. `feedCost` is the price, `feedSpots` the sea tiles you could feed.
 * `undefined` unless the action is in the game and unlocked. The gate is the same expression `server/view.ts` used (`feedTechOk`).
 */
export const feedViewData: ViewDataDef = {
  id: 'tidebound.fishing.feed_view',
  player: (g, reg, p, who) => {
    const feedTechOk = reg.actions.has(FEED_SEA) && techGate(g, p.id, TECH_HARBOR_MASTER);
    return {
      feedCost: who.self && feedTechOk ? FEED_SEA_COST : undefined,
      feedSpots: who.self ? feedSpotsView(g, reg, p) : undefined
    };
  }
};

/** Nets a bot keeps on the board. Below the base limit (4), so a bot never pays double for one. Tuning is T13. */
export const NET_BOT_MAX = 3;

/**
 * A bot builds a net as a side build: at most `NET_BOT_MAX` of them, and only with 2 or more cards to spare after paying, so a net never eats
 * the cards a city or settlement is waiting for. It prefers a vertex with more sea around it and sea tiles that hold fish (T2c icons), and
 * steps away from a spot where it could still settle. Only vertices next to its own roads and bridges are looked at (the placement rule needs one).
 */
export const netBotGoal: BotGoalDef = {
  id: 'tidebound.nets',
  goalClass: 'generic',
  goals(ctx: Ctx, pid: Id): BotGoalItem[] {
    const { g, reg } = ctx;
    if (!techGate(g, pid, TECH_FISHING_NETS)) return [];
    const p = getPlayer(g, pid);
    if (!p || (p.pieces[NET] ?? 0) <= 0) return [];
    if (placedCount(g, pid, NET) >= NET_BOT_MAX) return [];
    const cost = priceOf(g, reg, p, netPiece);
    const price = Object.values(cost).reduce((a, n) => a + (n || 0), 0);
    if (totalCards(p) < price + 2) return [];

    const candidates = new Set<number>();
    for (const e of g.board.edges) {
      if (e.piece?.owner !== pid) continue;
      candidates.add(e.v1);
      candidates.add(e.v2);
    }
    const settle = reg.pieces.get(SETTLEMENT);
    let bestLoc = -1;
    let bestScore = -Infinity;
    for (const vId of candidates) {
      if (!canPlaceNet(ctx, pid, vId, 'build')) continue;
      const sea = seaHexIdsAt(g, reg, vId);
      let s = sea.length * 2;
      for (const id of sea) if ((g.board.hexes[id]?.ext?.fish ?? 0) > 0) s += 6;
      if (settle && settle.canPlace(ctx, pid, vId, 'setup')) s -= 8;
      if (s > bestScore) {
        bestScore = s;
        bestLoc = vId;
      }
    }
    if (bestLoc < 0) return [];
    return [{
      id: `net:${bestLoc}`,
      priority: Math.max(42, Math.min(58, 46 + bestScore)),
      cost,
      action: { type: 'build', payload: { piece: NET, loc: bestLoc } },
      needsTags: ['sea']
    }];
  }
};

export const fishingAddon: AddonDef = {
  id: 'tidebound.fishing',
  name: 'Fishing',
  description: 'Nets on the coast catch fish, a token that counts as any one resource. Fish icons on the sea boost the catch, tides refill them and wheat feeds the sea.',
  links: [
    { target: 'wild-token', kind: 'mechanic' },
    { target: 'marker', kind: 'mechanic' },
    { target: 'piece-cost', kind: 'mechanic' },
    { target: 'seven-resolver', kind: 'mechanic' },
    { target: 'bot-goals', kind: 'bot' },
    { target: 'tidebound.tides', kind: 'content' }
  ],
  // Same supply rule as bridges: the base limit scales with land radius and VP (`PieceDef.scaleWithRadius`).
  rules: { pieceLimits: { [NET]: NET_BASE_LIMIT } },
  register(api) {
    registerTideboundTechs(api);
    // T7a: the token and its spend action.
    api.define(WILD_TOKENS, fishToken);
    api.action(spendFishAction);
    api.phaseAction('main', SPEND_FISH);
    api.define(BOT_GOALS, fishBotGoal);
    // R7a.5: the public fish icons for the client state.
    api.define(VIEW_DATA, fishViewData);
    // T7b1 & T11d: the net piece, Net works cost modifier, and catch on every roll.
    api.piece(netPiece);
    api.define(VIEW_DATA, netViewData);
    api.define(COST_MODS, netWorksCostMod);
    api.hook('onRoll', netCatchOnRoll);
    api.define(BOT_GOALS, netBotGoal);
    // T7d: tides refill fish icons at round start (a no-op while Tides is off). T7e: feed the sea.
    api.hook('onRoundStart', (ctx: Ctx) => {
      replenishFish(ctx);
    });
    api.action(feedSeaAction);
    api.phaseAction('main', FEED_SEA);
    api.define(VIEW_DATA, feedViewData);
  }
};
