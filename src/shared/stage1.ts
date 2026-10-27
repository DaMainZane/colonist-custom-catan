// MODULE: Stage 1 General features (Taxes & Catch-up levers, Public Contract Board & Rarity Tiers, Spies & Intel Ladder, Tech Tree with Empire-Size Pricing, Local Nemesis & Round Recap, Proving-Ground Content & Sandbox Economy) | USED BY: packs, server, bots, tests
import { addGarrison, addLedgerEntry, getMarkers, getRelation } from './coreServices';
import type { Ctx } from './ctx';
import { addFateTokens, EVENT_CARDS } from './eventDeck';
import type { EventCardDef } from './eventDeck';
import { appendPublicHistory, detectStreaks, getPublicHistory } from './history';
import { COST_MODS, placedCount } from './pricing';
import type { CostModifier } from './pricing';
import { defsOf } from './registry';
import type { PackApi, PieceDef, Registry } from './registry';
import { createRng, rngInt, rngShuffle } from './rng';
import type { RngState } from './rng';
import { DISCARD_LIMIT_MODS, effectiveDiscardLimit, SEVEN_STEP_ORDER, SEVEN_STEPS } from './sevenResolver';
import type { DiscardLimitModifier, SevenStepDef } from './sevenResolver';
import { bankGive, canAfford, getPlayer, payToBank, publicVP, score } from './state';
import { RATIO_MOD_ORDER, RATIO_MODS } from './tradeRatio';
import type { RatioModifier } from './tradeRatio';
import type { GameState, Id, PlayerState, Resources } from './types';

function sumCards(r: Resources): number {
  return Object.values(r).reduce((a, b) => a + (b || 0), 0);
}

// ============================================================================
// S1.1 Taxes & Catch-up Lever Menu (`score`, `ledger`, `seven-resolver`, `event-deck`)
// ============================================================================

export type CatchUpIntensity = 'off' | 'light' | 'strong';

/**
 * True when `pid` qualifies for Catch-up levers:
 *  - `rules.catchUpMode` is `'light'` or `'strong'`
 *  - Leader's `publicVP` is at least `lastPlaceVP * (1 + gap%)` AND at least 2 public VP ahead of `pid`.
 *  - Reads ONLY `publicVP(g, reg, p)` (or `score` in Sandbox), never hidden dev card VP.
 */
export function isCatchUpEligible(g: GameState, reg: Registry, pid: Id): boolean {
  const mode: CatchUpIntensity = g.rules?.catchUpMode ?? 'off';
  if (mode === 'off' || g.players.length < 2) return false;
  const p = getPlayer(g, pid);
  if (!p) return false;

  const scores = g.players.map(pl => ({ id: pl.id, vp: publicVP(g, reg, pl) }));
  const maxVp = Math.max(...scores.map(s => s.vp));
  const minVp = Math.min(...scores.map(s => s.vp));
  const myVp = scores.find(s => s.id === pid)?.vp ?? 0;

  if (maxVp - myVp < 2) return false;
  if (myVp > minVp && mode === 'light') return false;
  const gapRatio = mode === 'strong' ? 0.25 : 0.5;
  return maxVp >= Math.ceil(Math.max(1, myVp) * (1 + gapRatio));
}

/** Discard limit bonus from the Catch-up lever menu (+2 in `light`, +4 in `strong`). */
export function catchUpDiscardBonus(g: GameState, reg: Registry, p: PlayerState): number {
  if (!isCatchUpEligible(g, reg, p.id)) return 0;
  return g.rules?.catchUpMode === 'strong' ? 4 : 2;
}

export const catchUpDiscardModifier: DiscardLimitModifier = {
  id: 'stage1.catchUpDiscard',
  apply(g, reg, p, currentLimit) {
    return currentLimit + catchUpDiscardBonus(g, reg, p);
  }
};

/**
 * Runs at the start of each round when `rules.taxesOn` or `rules.catchUpMode` is enabled:
 *  - Taxes: the sole or tied leader by `publicVP` (if at least 2 public VP ahead of last place) pays 1 card to the bank.
 *  - Catch-up: trailing players regain 1 Fate token every 4 rounds.
 */
export function runRoundStartTaxesAndCatchUp(ctx: Ctx): void {
  const { g, reg } = ctx;
  if (g.players.length < 2) return;

  if (g.rules?.taxesOn) {
    const scores = g.players.map(p => ({ p, vp: publicVP(g, reg, p) }));
    const maxVp = Math.max(...scores.map(s => s.vp));
    const minVp = Math.min(...scores.map(s => s.vp));
    if (maxVp - minVp >= 2) {
      for (const { p, vp } of scores) {
        if (vp !== maxVp) continue;
        const piles = [...reg.resources.keys()].sort((a, b) => (p.resources[b] || 0) - (p.resources[a] || 0));
        const payRes = piles.find(r => (p.resources[r] || 0) > 0);
        if (!payRes) continue;
        payToBank(ctx, p, { [payRes]: 1 });
        p.stats.taxesPaid = (p.stats.taxesPaid || 0) + 1;
        addLedgerEntry(g, {
          kind: 'tax',
          fromId: p.id,
          toId: 'bank',
          amount: 1,
          resource: payRes,
          dueRound: g.round || 1,
          settled: true
        });
        appendPublicHistory(g, {
          type: 'taxPaid',
          actorId: p.id,
          targetId: null,
          summary: `${p.name} paid 1 tax card to the bank`,
          data: { playerId: p.id, amount: 1 }
        });
        ctx.log(`🏛️ ${p.avatar} ${p.name} paid 1 card in Leader Tax`, p.color);
      }
    }
  }

  if ((g.rules?.catchUpMode === 'light' || g.rules?.catchUpMode === 'strong') && (g.round || 0) > 0 && (g.round || 0) % 4 === 0) {
    for (const p of g.players) {
      if (isCatchUpEligible(g, reg, p.id)) {
        addFateTokens(g, reg, p.id, 1);
      }
    }
  }
}

// ============================================================================
// S1.2 Public Contract Board & Rarity Tiers (`score`, `ledger`, `history`)
// ============================================================================

export const CONTRACT_CONDITIONS = 'contractConditions';

export interface ContractConditionDef {
  id: string;
  name: string;
  description: string;
  tier: 1 | 2 | 3;
  vp: 1 | 2 | 3;
  /** Optional DLC pack id; only drawn when that DLC is enabled. */
  dlc?: string;
  check(g: GameState, reg: Registry, pid: Id): boolean;
  replace?: boolean;
}

export interface OpenContract {
  id: string;
  conditionId: string;
  name: string;
  description: string;
  tier: 1 | 2 | 3;
  vp: 1 | 2 | 3;
  unlocksMonument: boolean;
}

export interface ContractBoardState {
  rng: RngState;
  open: OpenContract[];
  claimedByPlayer: Record<Id, string[]>;
  vpByPlayer: Record<Id, number>;
  monumentRights: Record<Id, number>;
  pool: string[];
}

export const BASE_CONTRACT_CONDITIONS: ContractConditionDef[] = [
  {
    id: 'base.ports_2',
    name: 'Coastal Trader',
    description: 'Own buildings on at least 2 ports.',
    tier: 1,
    vp: 1,
    check(g, _reg, pid) {
      let ports = 0;
      for (const v of g.board.vertices) {
        if (v.piece?.owner === pid && v.port) ports++;
      }
      return ports >= 2;
    }
  },
  {
    id: 'base.roads_6',
    name: 'King’s Highway',
    description: 'Have at least 6 roads on the board.',
    tier: 1,
    vp: 1,
    check(g, _reg, pid) {
      return placedCount(g, pid, 'road') >= 6;
    }
  },
  {
    id: 'base.settlements_3',
    name: 'Homesteader',
    description: 'Have at least 3 settlements or cities on the board.',
    tier: 1,
    vp: 1,
    check(g, _reg, pid) {
      return placedCount(g, pid, 'settlement') + placedCount(g, pid, 'city') >= 3;
    }
  },
  {
    id: 'base.cities_2',
    name: 'Twin Cities',
    description: 'Have at least 2 cities on the board.',
    tier: 2,
    vp: 2,
    check(g, _reg, pid) {
      return placedCount(g, pid, 'city') >= 2;
    }
  },
  {
    id: 'base.ports_3',
    name: 'Merchant Fleet',
    description: 'Own buildings on at least 3 ports.',
    tier: 2,
    vp: 2,
    check(g, _reg, pid) {
      let ports = 0;
      for (const v of g.board.vertices) {
        if (v.piece?.owner === pid && v.port) ports++;
      }
      return ports >= 3;
    }
  },
  {
    id: 'base.metropolis',
    name: 'Grand Metropolis',
    description: 'Have at least 3 cities and 8 roads on the board (unlocks a Monument).',
    tier: 3,
    vp: 3,
    check(g, _reg, pid) {
      return placedCount(g, pid, 'city') >= 3 && placedCount(g, pid, 'road') >= 8;
    }
  }
];

export function allContractConditions(g: GameState, reg: Registry): Map<string, ContractConditionDef> {
  const map = new Map<string, ContractConditionDef>();
  for (const c of BASE_CONTRACT_CONDITIONS) map.set(c.id, c);
  for (const [id, c] of defsOf<ContractConditionDef>(reg, CONTRACT_CONDITIONS).entries()) {
    if (c.dlc && !g.rules?.dlc?.[c.dlc]) continue;
    map.set(id, c);
  }
  return map;
}

function toOpenContract(def: ContractConditionDef): OpenContract {
  return {
    id: def.id,
    conditionId: def.id,
    name: def.name,
    description: def.description,
    tier: def.tier,
    vp: def.vp,
    unlocksMonument: def.tier === 3
  };
}

/** Initializes or returns the shared public Contract Board (`players.length + 1` open contracts, seeded from its own RNG stream). */
export function ensureContractBoard(g: GameState, reg: Registry): ContractBoardState {
  g.ext = g.ext || {};
  g.ext.core = g.ext.core || {};
  if (!g.ext.core.contracts) {
    const rng = createRng(((Number(g.seed) || 1) ^ 0x85ebca6b) >>> 0);
    const defs = allContractConditions(g, reg);
    const pool = rngShuffle(rng, [...defs.keys()]);
    const targetOpen = Math.max(2, g.players.length + 1);
    const open: OpenContract[] = [];
    while (open.length < targetOpen && pool.length > 0) {
      const id = pool.shift()!;
      const def = defs.get(id);
      if (def) open.push(toOpenContract(def));
    }
    g.ext.core.contracts = {
      rng,
      open,
      claimedByPlayer: {},
      vpByPlayer: {},
      monumentRights: {},
      pool
    } satisfies ContractBoardState;
  }
  return g.ext.core.contracts as ContractBoardState;
}

/** Public VP earned from claimed contracts by `pid`. */
export function getContractVP(g: GameState, pid: Id): number {
  return g.ext?.core?.contracts?.vpByPlayer?.[pid] ?? 0;
}

function awardContractReward(ctx: Ctx, pid: Id, contract: OpenContract, vpShare: number): void {
  const { g, reg } = ctx;
  const st = ensureContractBoard(g, reg);
  const p = getPlayer(g, pid);
  if (!p || vpShare <= 0) return;

  st.claimedByPlayer[pid] = st.claimedByPlayer[pid] || [];
  if (!st.claimedByPlayer[pid].includes(contract.id)) {
    st.claimedByPlayer[pid].push(contract.id);
  }
  p.stats.contractsClaimed = (p.stats.contractsClaimed || 0) + 1;

  if ((g.rules?.scoreMode ?? 'vp') === 'produced') {
    // Sandbox economy: contracts pay resources instead of VP!
    const resKeys = [...reg.resources.keys()];
    for (let i = 0; i < vpShare && resKeys.length > 0; i++) {
      const r = resKeys[i % resKeys.length];
      bankGive(ctx, pid, r, 1);
    }
  } else {
    st.vpByPlayer[pid] = (st.vpByPlayer[pid] || 0) + vpShare;
  }

  if (contract.unlocksMonument) {
    st.monumentRights[pid] = (st.monumentRights[pid] || 0) + 1;
  }

  ctx.emit('contractClaimed', {
    playerId: pid,
    contractId: contract.id,
    name: contract.name,
    tier: contract.tier,
    vp: vpShare,
    summary: `${p.name} claimed contract "${contract.name}" (+${vpShare} VP)`
  });
  appendPublicHistory(g, {
    type: 'contractClaimed',
    actorId: pid,
    targetId: null,
    summary: `${p.name} claimed contract "${contract.name}" (+${vpShare} VP)`,
    data: { contractId: contract.id, tier: contract.tier, vp: vpShare }
  });
}

/**
 * Evaluates open contracts in `'instant'` mode (first achiever takes all VP) or `'cycle'` mode
 * (everyone who achieved it this cycle splits the VP 1 point at a time in turn order).
 */
export function evaluateContracts(ctx: Ctx, mode: 'instant' | 'cycle' = ctx.g.rules?.contractMode ?? 'instant'): string[] {
  const { g, reg } = ctx;
  const st = ensureContractBoard(g, reg);
  const defs = allContractConditions(g, reg);
  const claimedIds: string[] = [];

  for (let i = st.open.length - 1; i >= 0; i--) {
    const openContract = st.open[i];
    const def = defs.get(openContract.conditionId);
    if (!def) continue;

    // Order players starting from seat 0 (or current turn in instant mode)
    const achievers = g.players.filter(p => def.check(g, reg, p.id));
    if (achievers.length === 0) continue;

    if (mode === 'instant') {
      const current = g.players[g.turn];
      const winner = achievers.find(p => p.id === current?.id) ?? achievers[0];
      awardContractReward(ctx, winner.id, openContract, openContract.vp);
    } else {
      // Cycle mode: split VP one point at a time in turn order (`3 VP among 4 players leaves the 4th with 0`)
      const shares = new Map<Id, number>();
      for (let pt = 0; pt < openContract.vp; pt++) {
        const recipient = achievers[pt % achievers.length];
        shares.set(recipient.id, (shares.get(recipient.id) || 0) + 1);
      }
      for (const [pid, share] of shares.entries()) {
        awardContractReward(ctx, pid, openContract, share);
      }
    }

    claimedIds.push(openContract.id);
    st.open.splice(i, 1);
    if (st.pool.length > 0) {
      const nextId = st.pool.shift()!;
      const nextDef = defs.get(nextId);
      if (nextDef) st.open.push(toOpenContract(nextDef));
    }
  }

  return claimedIds;
}

// ============================================================================
// S1.3 Spies Dev Card & Intel Ladder (`relations`, `history`)
// ============================================================================

export interface IntelPeek {
  viewerId: Id;
  targetId: Id;
  tier: 'spy' | 'capital_vision' | 'cloak';
  untilRound: number;
}

/**
 * Plays the Spies dev card (or Spy action) against `targetId`:
 *  - Reveals `targetId`'s hand to `pid` for 1 round (`canViewerPeekHand`).
 *  - If `targetId` holds a `knight` dev card, nullifies 1 knight (`pending.nullifiedKnights += 1`) so their next
 *    played knight counts toward Largest Army without moving the robber or stealing.
 */
export function playSpyAction(
  ctx: Ctx,
  pid: Id,
  targetId: Id
): { ok: boolean; nullifiedKnight: boolean; error?: string } {
  const { g } = ctx;
  const actor = getPlayer(g, pid);
  const target = getPlayer(g, targetId);
  if (!actor || !target || pid === targetId) {
    return { ok: false, nullifiedKnight: false, error: 'Invalid spy target' };
  }

  g.ext = g.ext || {};
  g.ext.core = g.ext.core || {};
  const intel: IntelPeek[] = (g.ext.core.intel = g.ext.core.intel || []);
  intel.push({
    viewerId: pid,
    targetId,
    tier: 'spy',
    untilRound: (g.round || 1) + 1
  });

  const hasKnight = target.devCards.includes('knight') || target.newDevCards.includes('knight');
  if (hasKnight) {
    target.pending.nullifiedKnights = (target.pending.nullifiedKnights || 0) + 1;
  }

  actor.stats.spiesPlayed = (actor.stats.spiesPlayed || 0) + 1;
  ctx.emit('spyPlayed', { playerId: pid, targetId, nullifiedKnight: hasKnight });
  ctx.log(`🕵️ ${actor.avatar} ${actor.name} deployed a Spy!`, actor.color);
  return { ok: true, nullifiedKnight: hasKnight };
}

/** True if `viewerId` has an active spy peek on `targetId` for the current round. */
export function canViewerPeekHand(g: GameState, viewerId: Id, targetId: Id): boolean {
  if (viewerId === targetId) return true;
  const intel: IntelPeek[] = g.ext?.core?.intel ?? [];
  const curRound = g.round || 0;
  return intel.some(i => i.viewerId === viewerId && i.targetId === targetId && i.untilRound >= curRound);
}

// ============================================================================
// S1.4 Tech Tree with Empire-Size Pricing, Local Nemesis & Round-End Recap
// ============================================================================

export const TECH_DEFS = 'techDefs';

export interface TechDef {
  id: string;
  name: string;
  branch: string;
  tier: 1 | 2 | 3;
  prereq?: string;
  dlc?: string;
  description: string;
  onUnlock?(ctx: Ctx, pid: Id): void;
  replace?: boolean;
}

export const BASE_TECH_DEFS: TechDef[] = [
  {
    id: 'base.road_engineering',
    name: 'Road Engineering',
    branch: 'base',
    tier: 1,
    description: 'Roads built above the base limit cost 1 less wood.'
  },
  {
    id: 'base.harbor_charters',
    name: 'Harbor Charters',
    branch: 'base',
    tier: 2,
    prereq: 'base.road_engineering',
    description: 'Your 3:1 ports trade at 2:1.'
  },
  {
    id: 'base.literacy',
    name: 'Philosophy & Literacy',
    branch: 'base',
    tier: 2,
    prereq: 'base.road_engineering',
    description: 'Cuts the card cost of all future technologies by a third.'
  },
  {
    id: 'base.fortified_towns',
    name: 'Fortified Towns',
    branch: 'base',
    tier: 3,
    prereq: 'base.harbor_charters',
    description: 'Grants +1 garrison strength on each of your settlements and cities.',
    onUnlock(ctx, pid) {
      for (const v of ctx.g.board.vertices) {
        if (v.piece?.owner === pid) addGarrison(ctx.g, pid, 'vertex', v.id, 1);
      }
    }
  }
];

export function allTechDefs(g: GameState, reg: Registry): Map<string, TechDef> {
  const map = new Map<string, TechDef>();
  for (const t of BASE_TECH_DEFS) map.set(t.id, t);
  for (const [id, t] of defsOf<TechDef>(reg, TECH_DEFS).entries()) {
    if (t.dlc && !g.rules?.dlc?.[t.dlc]) continue;
    map.set(id, t);
  }
  return map;
}

export function getPlayerTechs(g: GameState, pid: Id): string[] {
  return g.ext?.core?.techs?.[pid] ?? [];
}

export function hasTech(g: GameState, pid: Id, techId: string): boolean {
  return getPlayerTechs(g, pid).includes(techId);
}

/**
 * Polytopia-inspired tech cost by empire size:
 *  - Base cards needed = `tier + Math.ceil(buildingCount / 2)`.
 *  - If the player owns `base.literacy`, cost is reduced by ~1/3 (`Math.max(1, Math.floor(cost * 2 / 3))`).
 *  - If the player has 0 techs and qualifies for Catch-up (`isCatchUpEligible`), cost is reduced by 1 (min 1).
 */
export function techCostCards(g: GameState, reg: Registry, pid: Id, tier: 1 | 2 | 3): number {
  const buildings =
    placedCount(g, pid, 'settlement') + placedCount(g, pid, 'city') + placedCount(g, pid, 'castle');
  let cost = tier + Math.ceil(buildings / 2);
  if (hasTech(g, pid, 'base.literacy')) {
    cost = Math.max(1, Math.floor((cost * 2) / 3));
  }
  if (getPlayerTechs(g, pid).length === 0 && isCatchUpEligible(g, reg, pid)) {
    cost = Math.max(1, cost - 1);
  }
  return cost;
}

/** Default resource breakdown (wheat + ore) for a tech of `tier` costing `totalCards` cards. */
export function defaultTechPayment(totalCards: number): Resources {
  const ore = Math.floor(totalCards / 2);
  const wheat = totalCards - ore;
  const out: Resources = {};
  if (wheat > 0) out.wheat = wheat;
  if (ore > 0) out.ore = ore;
  return out;
}

export function researchTech(
  ctx: Ctx,
  pid: Id,
  techId: string,
  payment?: Resources
): { ok: boolean; costCards?: number; error?: string } {
  const { g, reg } = ctx;
  const p = getPlayer(g, pid);
  if (!p) return { ok: false, error: 'Unknown player' };
  const defs = allTechDefs(g, reg);
  const def = defs.get(techId);
  if (!def) return { ok: false, error: 'Unknown technology' };
  const owned = getPlayerTechs(g, pid);
  if (owned.includes(techId)) return { ok: false, error: 'Technology already researched' };
  if (def.prereq && !owned.includes(def.prereq)) {
    return { ok: false, error: `Requires ${ defs.get(def.prereq)?.name ?? def.prereq } first` };
  }

  const needed = techCostCards(g, reg, pid, def.tier);
  const pay = payment ?? defaultTechPayment(needed);
  if (sumCards(pay) !== needed) {
    return { ok: false, error: `Tech requires ${needed} resource card(s)` };
  }
  if (!canAfford(p, pay)) {
    return { ok: false, error: 'Not enough resources to research this technology' };
  }

  payToBank(ctx, p, pay);
  g.ext = g.ext || {};
  g.ext.core = g.ext.core || {};
  g.ext.core.techs = g.ext.core.techs || {};
  g.ext.core.techs[pid] = [...owned, techId];
  p.stats.techsResearched = (p.stats.techsResearched || 0) + 1;

  if (def.onUnlock) def.onUnlock(ctx, pid);
  ctx.emit('techResearched', { playerId: pid, techId, name: def.name, tier: def.tier, costCards: needed });
  ctx.log(`🔬 ${p.avatar} ${p.name} researched ${def.name}!`, p.color);
  return { ok: true, costCards: needed };
}

export const techRoadCostModifier: CostModifier = {
  id: 'stage1.techRoadEngineering',
  apply(g, p, def: PieceDef, cost) {
    if (def.id !== 'road' || !hasTech(g, p.id, 'base.road_engineering')) return cost;
    if ((cost.wood || 0) <= 1) return cost;
    return { ...cost, wood: cost.wood - 1 };
  }
};

export const techHarborCharterRatioModifier: RatioModifier = {
  id: 'stage1.techHarborCharters',
  order: RATIO_MOD_ORDER.tech,
  apply(g, reg, pid, _resource, current) {
    if (!hasTech(g, pid, 'base.harbor_charters')) return current;
    const ownsThreeToOne = g.board.vertices.some(
      v => v.piece?.owner === pid && v.port && reg.ports.get(v.port)?.ratio === 3
    );
    return ownsThreeToOne ? Math.min(current, 2) : current;
  }
};

// ---- Local Nemesis Ledger & Round-End Recap -----------------------------

export interface LocalNemesisRecord {
  targetId: Id;
  robbedMe: number;
  betrayedMe: number;
  grudgeScore: number;
  isNemesis: boolean;
}

export function recordLocalNemesisHit(
  g: GameState,
  victimId: Id,
  aggressorId: Id,
  kind: 'robbed' | 'betrayed'
): LocalNemesisRecord {
  g.ext = g.ext || {};
  g.ext.core = g.ext.core || {};
  g.ext.core.nemesis = g.ext.core.nemesis || {};
  const key = `${victimId}->${aggressorId}`;
  const rec: LocalNemesisRecord = g.ext.core.nemesis[key] ?? {
    targetId: aggressorId,
    robbedMe: 0,
    betrayedMe: 0,
    grudgeScore: 0,
    isNemesis: false
  };
  if (kind === 'robbed') {
    rec.robbedMe += 1;
    rec.grudgeScore += 15;
  } else {
    rec.betrayedMe += 1;
    rec.grudgeScore += 40;
  }
  rec.isNemesis = rec.grudgeScore >= 30;
  g.ext.core.nemesis[key] = rec;
  return rec;
}

export function getLocalNemesis(g: GameState, victimId: Id, aggressorId: Id): LocalNemesisRecord {
  return (
    g.ext?.core?.nemesis?.[`${victimId}->${aggressorId}`] ?? {
      targetId: aggressorId,
      robbedMe: 0,
      betrayedMe: 0,
      grudgeScore: 0,
      isNemesis: false
    }
  );
}

export interface RoundRecapData {
  round: number;
  events: string[];
  contracts: string[];
  relations: string[];
  markers: string[];
}

/** Builds the Round-End Recap card summary from the public history ring buffer and active markers. */
export function buildRoundRecap(g: GameState, round = g.round || 1): RoundRecapData {
  const entries = getPublicHistory(g, { round });
  const events = entries.filter(e => e.type === 'eventDrawn').map(e => e.summary);
  const contracts = entries.filter(e => e.type === 'contractClaimed').map(e => e.summary);
  const relations = entries.filter(e => e.type === 'treatyBroken').map(e => e.summary);
  const markers = getMarkers(g).map(m => `${m.kind}@${m.target}:${m.loc}`);
  return { round, events, contracts, relations, markers };
}

// ============================================================================
// S1.5 Proving-Ground Content & Sandbox Economy
// (`Karaoke 7`, `Bot drinking game`, `Hat day`, `Sandbox economy`)
// ============================================================================

/**
 * Karaoke 7 step inside the Seven Resolver (`order: 20, isDlcSideEffect: true`):
 *  - Skipped in `quiet`/`off` chat or `realTime` mode.
 *  - Deterministically picks the slowest responder using a derived RNG stream so `g.rng` is untouched;
 *    that player loses 1 card to the bank and records `karaokeLost` in the public history buffer.
 */
export const karaokeSevenStep: SevenStepDef = {
  id: 'rowdy.karaoke7',
  order: SEVEN_STEP_ORDER.karaoke,
  isDlcSideEffect: true,
  priority: 70,
  canFire(ctx) {
    const chat = ctx.g.rules?.botChat ?? 'normal';
    if (chat === 'off' || chat === 'quiet' || ctx.g.rules?.realTime) return false;
    return ctx.g.players.some(p => sumCards(p.resources) > 0);
  },
  run(ctx) {
    const { g, reg } = ctx;
    const candidates = g.players.filter(p => sumCards(p.resources) > 0);
    if (candidates.length === 0) return false;
    const rng = createRng(((Number(g.seed) || 1) ^ ((g.turnCount || 1) * 0x45d9f3b)) >>> 0);
    const loser = candidates[rngInt(rng, candidates.length)];
    const resKeys = [...reg.resources.keys()].filter(r => (loser.resources[r] || 0) > 0);
    if (resKeys.length === 0) return false;
    const lostRes = resKeys[rngInt(rng, resKeys.length)];
    payToBank(ctx, loser, { [lostRes]: 1 });
    loser.stats.karaokeLosses = (loser.stats.karaokeLosses || 0) + 1;
    ctx.emit('karaokeLost', {
      playerId: loser.id,
      summary: `${loser.name} was last in Karaoke 7 and dropped 1 card!`
    });
    appendPublicHistory(g, {
      type: 'karaokeLost',
      actorId: loser.id,
      targetId: null,
      summary: `${loser.name} was last in Karaoke 7 and dropped 1 card!`,
      data: { playerId: loser.id }
    });
    ctx.log(`🎤 ${loser.avatar} ${loser.name} was slowest in Karaoke 7 and lost 1 card!`, loser.color);
    return true;
  }
};

/**
 * Bot Drinking Game check: reads `detectStreaks(g)` from the public history buffer,
 * increments cosmetic `sips`, and when `g.rules.pityCardOn` is enabled, grants 1 pity card
 * from the bank to a player hammered >= 3 times in the last 6 turns.
 */
export function runBotDrinkingGameCheck(ctx: Ctx): { sipsTriggered: boolean; pityRecipientId: Id | null } {
  const { g, reg } = ctx;
  const report = detectStreaks(g, 6);
  let sipsTriggered = false;
  let pityRecipientId: Id | null = null;

  if (report.rollStreak) {
    sipsTriggered = true;
    for (const p of g.players) {
      p.stats.sips = (p.stats.sips || 0) + 1;
    }
  }

  if (report.hammeredVictim) {
    sipsTriggered = true;
    const victim = getPlayer(g, report.hammeredVictim.victimId);
    if (victim) {
      victim.stats.sips = (victim.stats.sips || 0) + 1;
      if (g.rules?.pityCardOn && report.hammeredVictim.hits >= 3) {
        const avail = [...reg.resources.keys()].find(r => (g.bank[r] || 0) > 0);
        if (avail) {
          bankGive(ctx, victim.id, avail, 1);
          pityRecipientId = victim.id;
        }
      }
    }
  }

  return { sipsTriggered, pityRecipientId };
}

export const HAT_CATALOG = [
  'crown',
  'captain',
  'plague_doctor',
  'conqueror',
  'top_hat',
  'jester',
  'viking_helm',
  'wizard_cone',
  'hat_of_shame'
] as const;

export const hatDayEventCard: EventCardDef = {
  id: 'rowdy.hat_day',
  title: 'Hat Day',
  description: 'Every settlement and city wears a festive random hat for the round!',
  pack: 'rowdy',
  apply(ctx) {
    const { g } = ctx;
    const rng = createRng(((Number(g.seed) || 1) ^ ((g.round || 1) * 0x27d4eb2d)) >>> 0);
    g.ext = g.ext || {};
    g.ext.core = g.ext.core || {};
    const hats: Record<number, string> = {};
    for (const v of g.board.vertices) {
      if (v.piece) {
        hats[v.id] = HAT_CATALOG[rngInt(rng, HAT_CATALOG.length - 1)];
      }
    }
    g.ext.core.activeHats = hats;
  }
};

/** Evaluates unlockable hats from end-game stats (`longestRoad`, `largestArmy`, `resRobbed`, `trades`, `contractsClaimed`). */
export function evaluateHatUnlocks(g: GameState, pid: Id): string[] {
  const p = getPlayer(g, pid);
  if (!p) return [];
  const unlocked: string[] = [];
  if (g.awards?.longestRoad === pid || (p.stats.longestRoad || 0) >= 8) unlocked.push('captain');
  if (g.awards?.largestArmy === pid || (p.stats.knightsPlayed || 0) >= 3) unlocked.push('conqueror');
  if ((p.stats.resRobbed || 0) >= 3) unlocked.push('plague_doctor');
  if ((p.stats.trades || 0) >= 4) unlocked.push('top_hat');
  if ((p.stats.contractsClaimed || 0) >= 1) unlocked.push('crown');
  return unlocked;
}

/** Awards the Hat of Shame to the player who lost the most cards to the robber (`stats.resRobbed`). */
export function awardHatOfShame(g: GameState): Id | null {
  let worstId: Id | null = null;
  let worstCount = 0;
  for (const p of g.players) {
    const robbed = p.stats.resRobbed || 0;
    if (robbed > worstCount) {
      worstCount = robbed;
      worstId = p.id;
    }
  }
  return worstId;
}

/**
 * Sandbox economy turn/round limit check: when `rules.scoreMode === 'produced'` and `maxRounds` (or `maxTurns`) is reached,
 * crowns the player with the highest `score(g, reg, p)` (total resources produced).
 */
export function checkSandboxTurnLimitWinner(
  g: GameState,
  reg: Registry
): { id: Id; name: string; vp: number; color: string } | null {
  if ((g.rules?.scoreMode ?? 'vp') !== 'produced') return null;
  const maxRounds = Number(g.rules?.maxRounds || 0);
  const maxTurns = Number(g.rules?.maxTurns || 0);
  const hitRoundCap = maxRounds > 0 && (g.round || 0) >= maxRounds;
  const hitTurnCap = maxTurns > 0 && (g.turnCount || 0) >= maxTurns;
  if (!hitRoundCap && !hitTurnCap) return null;

  const ranked = [...g.players].sort((a, b) => score(g, reg, b, true) - score(g, reg, a, true));
  const best = ranked[0];
  if (!best) return null;
  const winScore = score(g, reg, best, true);
  g.winner = { id: best.id, name: best.name, vp: winScore, color: best.color };
  g.phase = 'gameover';
  return g.winner;
}

/** Registers Stage 1 general modifiers/cards into a pack API when requested. */
export function registerStage1Definitions(api: PackApi): void {
  api.define(DISCARD_LIMIT_MODS, catchUpDiscardModifier);
  api.define(COST_MODS, techRoadCostModifier);
  api.define(RATIO_MODS, techHarborCharterRatioModifier);
  api.define(EVENT_CARDS, hatDayEventCard);
  api.define(SEVEN_STEPS, karaokeSevenStep);
}
