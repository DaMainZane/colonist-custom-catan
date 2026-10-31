// MODULE: S0.9 Marker system (10), Ledger (13), Strength & defense model (9), Relations matrix (14) | DEPENDS ON: shared/ctx, shared/registry, shared/state, shared/types | USED BY: shared/index, shared/stage1
import type { Ctx } from './ctx';
import type { Registry } from './registry';
import { getPlayer } from './state';
import type { GameState, Id } from './types';

function ensureCoreExt(g: GameState): Record<string, any> {
  if (!g.ext) g.ext = {};
  if (!g.ext.core) g.ext.core = {};
  return g.ext.core as Record<string, any>;
}

// ============================================================================
// 1. Marker System (Service 10)
// ============================================================================

export type MarkerTarget = 'hex' | 'vertex' | 'edge' | 'player';

export interface MarkerEntry {
  id: string;
  kind: string;
  target: MarkerTarget;
  loc: number | string;
  ownerId: Id | null;
  countdown?: number;
  public?: boolean;
  payload?: Record<string, any>;
}

export function addMarker(
  g: GameState,
  entry: Omit<MarkerEntry, 'id' | 'public'> & { id?: string; public?: boolean }
): MarkerEntry {
  const core = ensureCoreExt(g);
  if (!Array.isArray(core.markers)) core.markers = [];
  const nextSeq = (core.markerSeq = (core.markerSeq || 0) + 1);
  const full: MarkerEntry = {
    id: entry.id ?? `mk_${nextSeq}`,
    kind: entry.kind,
    target: entry.target,
    loc: entry.loc,
    ownerId: entry.ownerId ?? null,
    countdown: entry.countdown,
    public: entry.public ?? true,
    payload: entry.payload
  };
  core.markers.push(full);
  return full;
}

export function getMarkers(
  g: GameState,
  filter?: {
    kind?: string;
    target?: MarkerTarget;
    loc?: number | string;
    ownerId?: Id;
    viewerId?: Id | 'spectator' | 'all';
  }
): MarkerEntry[] {
  const list = (g.ext?.core as any)?.markers as MarkerEntry[] | undefined;
  if (!Array.isArray(list)) return [];
  return list.filter(m => {
    if (filter?.kind !== undefined && m.kind !== filter.kind) return false;
    if (filter?.target !== undefined && m.target !== filter.target) return false;
    if (filter?.loc !== undefined && String(m.loc) !== String(filter.loc)) return false;
    if (filter?.ownerId !== undefined && m.ownerId !== filter.ownerId) return false;
    if (
      filter?.viewerId !== undefined &&
      filter.viewerId !== 'all' &&
      filter.viewerId !== 'spectator'
    ) {
      if (m.public === false && m.ownerId !== filter.viewerId) return false;
    }
    return true;
  });
}

export function removeMarker(g: GameState, id: string): boolean {
  const core = ensureCoreExt(g);
  if (!Array.isArray(core.markers)) return false;
  const before = core.markers.length;
  core.markers = core.markers.filter((m: MarkerEntry) => m.id !== id);
  return core.markers.length < before;
}

/** Decrements timed markers by 1 round, removes those that reach <= 0, and returns the expired markers. */
export function tickMarkers(ctxOrGame: Ctx | GameState): MarkerEntry[] {
  const isCtx = 'g' in ctxOrGame && 'reg' in ctxOrGame;
  const g = isCtx ? (ctxOrGame as Ctx).g : (ctxOrGame as GameState);
  const ctx = isCtx ? (ctxOrGame as Ctx) : null;
  const list = (g.ext?.core as any)?.markers as MarkerEntry[] | undefined;
  if (!Array.isArray(list) || list.length === 0) return [];

  const remaining: MarkerEntry[] = [];
  const expired: MarkerEntry[] = [];
  for (const m of list) {
    if (typeof m.countdown === 'number') {
      m.countdown -= 1;
      if (m.countdown <= 0) {
        expired.push(m);
        if (ctx) {
          ctx.emit('markerExpired', {
            id: m.id,
            kind: m.kind,
            target: m.target,
            loc: m.loc,
            ownerId: m.ownerId,
            payload: m.payload
          });
        }
        continue;
      }
    }
    remaining.push(m);
  }
  (g.ext!.core as any).markers = remaining;
  return expired;
}

// ============================================================================
// 2. Ledger Service (Service 13)
// ============================================================================

export type LedgerEntryKind = 'debt' | 'loan' | 'bounty' | 'tribute' | 'treaty' | 'bet' | 'tax' | 'permit' | string;

export interface LedgerEntry {
  id: string;
  kind: LedgerEntryKind;
  fromId: Id | 'bank';
  toId: Id | 'bank';
  amount: number;
  interest?: number;
  resource?: string;
  dueRound?: number;
  public?: boolean;
  settled: boolean;
  meta?: Record<string, any>;
}

export function addLedgerEntry(
  g: GameState,
  entry: Omit<LedgerEntry, 'id' | 'settled'> & { id?: string; settled?: boolean }
): LedgerEntry {
  const core = ensureCoreExt(g);
  if (!Array.isArray(core.ledger)) core.ledger = [];
  const seq = (core.ledgerSeq = (core.ledgerSeq || 0) + 1);
  const full: LedgerEntry = {
    ...entry,
    id: entry.id ?? `ldg_${seq}`,
    public: entry.public ?? true,
    settled: entry.settled ?? false
  };
  core.ledger.push(full);
  return full;
}

export function getLedgerEntries(
  g: GameState,
  filter?: {
    kind?: LedgerEntryKind;
    fromId?: Id | 'bank';
    toId?: Id | 'bank';
    settled?: boolean;
    viewerId?: Id | 'spectator' | 'all';
  }
): LedgerEntry[] {
  const list = (g.ext?.core as any)?.ledger as LedgerEntry[] | undefined;
  if (!Array.isArray(list)) return [];
  return list.filter(e => {
    if (filter?.kind !== undefined && e.kind !== filter.kind) return false;
    if (filter?.fromId !== undefined && e.fromId !== filter.fromId) return false;
    if (filter?.toId !== undefined && e.toId !== filter.toId) return false;
    if (filter?.settled !== undefined && Boolean(e.settled) !== filter.settled) return false;
    if (
      filter?.viewerId !== undefined &&
      filter.viewerId !== 'all' &&
      filter.viewerId !== 'spectator'
    ) {
      if (e.public === false && e.fromId !== filter.viewerId && e.toId !== filter.viewerId) {
        return false;
      }
    }
    return true;
  });
}

export function settleLedgerEntry(g: GameState, id: string): boolean {
  const list = (g.ext?.core as any)?.ledger as LedgerEntry[] | undefined;
  if (!Array.isArray(list)) return false;
  const entry = list.find(e => e.id === id);
  if (!entry || entry.settled) return false;
  entry.settled = true;
  return true;
}

export function dueLedgerEntries(g: GameState, round = g.round || 0): LedgerEntry[] {
  return getLedgerEntries(g, { settled: false }).filter(
    e => e.dueRound !== undefined && e.dueRound <= round
  );
}

// ============================================================================
// 3. Strength & Defense Model (Service 9) — No unit movement
// ============================================================================

export type WallTier = 'wood' | 'stone' | number;

export interface VertexDefenseBreakdown {
  ownerId: Id | null;
  base: number;
  garrison: number;
  mercenaries: number;
  wallBonus: number;
  armyBonus: number;
  total: number;
}

export function basePieceDefense(reg: Registry | undefined, pieceType: string | null | undefined): number {
  if (!pieceType) return 0;
  const def = reg?.pieces.get(pieceType);
  if (def && typeof def.baseDefense === 'number') return def.baseDefense;
  if (pieceType === 'settlement') return 1;
  if (pieceType === 'city') return 2;
  if (pieceType === 'castle' || pieceType === 'keep') return 3;
  return 0;
}

function garrisonKey(target: 'vertex' | 'edge', loc: number): string {
  return `${target === 'vertex' ? 'v' : 'e'}:${loc}`;
}

export function getGarrison(g: GameState, target: 'vertex' | 'edge', loc: number): number {
  return Number((g.ext?.core as any)?.garrisons?.[garrisonKey(target, loc)]) || 0;
}

export function addGarrison(
  g: GameState,
  _ownerId: Id,
  target: 'vertex' | 'edge',
  loc: number,
  delta: number
): number {
  const core = ensureCoreExt(g);
  if (!core.garrisons) core.garrisons = {};
  const key = garrisonKey(target, loc);
  const next = Math.max(0, (Number(core.garrisons[key]) || 0) + delta);
  core.garrisons[key] = next;
  return next;
}

export function setWallTier(g: GameState, edgeId: number, tier: WallTier): number {
  const core = ensureCoreExt(g);
  if (!core.walls) core.walls = {};
  const bonus = tier === 'stone' ? 2 : tier === 'wood' ? 1 : Math.max(0, Number(tier) || 0);
  core.walls[edgeId] = bonus;
  return bonus;
}

export function getWallBonusForVertex(g: GameState, vid: number): number {
  const v = g.board.vertices[vid];
  if (!v || !v.piece) return 0;
  const walls = (g.ext?.core as any)?.walls as Record<number, number> | undefined;
  let best = 0;
  for (const eid of v.edgeIds || []) {
    const e = g.board.edges[eid];
    if (e?.piece?.owner === v.piece.owner && (e.piece.type === 'wall' || walls?.[eid])) {
      best = Math.max(best, walls?.[eid] ?? 1);
    }
  }
  return best;
}

export function hireMercenary(
  g: GameState,
  pid: Id,
  strength = 1,
  forRound = g.round || 1
): void {
  const core = ensureCoreExt(g);
  if (!core.mercenaries) core.mercenaries = {};
  const cur = core.mercenaries[pid] || { strength: 0, round: forRound };
  cur.strength = (cur.round === forRound ? cur.strength : 0) + Math.max(0, strength);
  cur.round = forRound;
  core.mercenaries[pid] = cur;
}

export function getMercenaryStrength(g: GameState, pid: Id): number {
  const entry = (g.ext?.core as any)?.mercenaries?.[pid] as { strength: number; round: number } | undefined;
  if (!entry) return 0;
  if (entry.round < (g.round || 1)) return 0;
  return entry.strength || 0;
}

export function clearExpiredMercenaries(g: GameState): void {
  const core = (g.ext?.core as any);
  if (!core?.mercenaries) return;
  delete core.mercenaries;
}

export function vertexDefense(g: GameState, reg: Registry, vid: number): VertexDefenseBreakdown {
  const v = g.board.vertices[vid];
  if (!v || !v.piece) {
    return { ownerId: null, base: 0, garrison: 0, mercenaries: 0, wallBonus: 0, armyBonus: 0, total: 0 };
  }
  const ownerId = v.piece.owner;
  const base = basePieceDefense(reg, v.piece.type);
  const garrison = getGarrison(g, 'vertex', vid);
  const mercenaries = getMercenaryStrength(g, ownerId);
  const wallBonus = getWallBonusForVertex(g, vid);
  const armyBonus = g.awards?.largestArmy === ownerId ? 1 : 0;
  const total = base + garrison + mercenaries + wallBonus + armyBonus;
  return { ownerId, base, garrison, mercenaries, wallBonus, armyBonus, total };
}

export function playerTotalStrength(g: GameState, reg: Registry, pid: Id): number {
  const p = getPlayer(g, pid);
  if (!p) return 0;
  let total = (p.stats?.knightsPlayed || 0) + getMercenaryStrength(g, pid);
  if (g.awards?.largestArmy === pid) total += 1;
  for (const v of g.board.vertices) {
    if (v.piece?.owner === pid) {
      total += basePieceDefense(reg, v.piece.type) + getGarrison(g, 'vertex', v.id) + getWallBonusForVertex(g, v.id);
    }
  }
  return total;
}

export function compareStrength(
  attackerStrength: number,
  defenderStrength: number,
  attackerHasSiegeOrTactics = false,
  defenderHasTactics = false
): 'attacker' | 'defender' {
  if (attackerStrength > defenderStrength) return 'attacker';
  if (defenderStrength > attackerStrength) return 'defender';
  if (attackerHasSiegeOrTactics && !defenderHasTactics) return 'attacker';
  return 'defender';
}

// ============================================================================
// 4. Relations Matrix (Service 14)
// ============================================================================

export type RelationStatus = 'neutral' | 'truce' | 'alliance' | 'pact' | 'rival' | 'feud' | 'embargo' | 'war';

export type OpinionReason =
  | 'diplomatic'
  | 'fair_trade'
  | 'shared_enemy'
  | 'robbed_me'
  | 'blocked_road'
  | 'embargoed'
  | 'treaty_broken'
  | string;

export type OpinionTier = 'horrible' | 'bad' | 'neutral' | 'decent' | 'good';

const OPINION_DELTAS: Record<string, number> = {
  diplomatic: 20,
  fair_trade: 10,
  shared_enemy: 15,
  robbed_me: -15,
  blocked_road: -10,
  embargoed: -20,
  treaty_broken: -60
};

function pairKey(a: Id, b: Id): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function dirKey(from: Id, to: Id): string {
  return `${from}->${to}`;
}

export function getRelation(g: GameState, a: Id, b: Id): RelationStatus {
  if (a === b) return 'alliance';
  const entry = (g.ext?.core as any)?.relations?.[pairKey(a, b)] as
    | { status: RelationStatus; untilRound?: number }
    | undefined;
  if (!entry) return 'neutral';
  if (entry.untilRound !== undefined && (g.round || 0) > entry.untilRound) return 'neutral';
  return entry.status;
}

export function setRelation(
  g: GameState,
  a: Id,
  b: Id,
  status: RelationStatus,
  durationRounds?: number
): RelationStatus {
  const core = ensureCoreExt(g);
  if (!core.relations) core.relations = {};
  const untilRound =
    durationRounds !== undefined ? (g.round || 1) + durationRounds : undefined;
  core.relations[pairKey(a, b)] = { status, untilRound };
  return status;
}

export function addOpinion(
  g: GameState,
  observerId: Id,
  targetId: Id,
  reason: OpinionReason,
  customDelta?: number
): { score: number; tier: OpinionTier; tags: string[] } {
  const core = ensureCoreExt(g);
  if (!core.opinions) core.opinions = {};
  const key = dirKey(observerId, targetId);
  const cur = core.opinions[key] || { score: 0, tags: [] as string[] };
  const delta = customDelta ?? (OPINION_DELTAS[reason] ?? 0);
  cur.score += delta;
  if (reason === 'treaty_broken' && !cur.tags.includes('oathbreaker')) {
    cur.tags.push('oathbreaker');
  }
  core.opinions[key] = cur;
  return getOpinionScore(g, observerId, targetId);
}

export function getOpinionScore(
  g: GameState,
  observerId: Id,
  targetId: Id
): { score: number; tier: OpinionTier; tags: string[] } {
  const cur = (g.ext?.core as any)?.opinions?.[dirKey(observerId, targetId)] as
    | { score: number; tags: string[] }
    | undefined;
  const score = cur?.score ?? 0;
  const tags = [...(cur?.tags ?? [])];
  let tier: OpinionTier = 'neutral';
  if (score <= -40) tier = 'horrible';
  else if (score <= -15) tier = 'bad';
  else if (score >= 35) tier = 'good';
  else if (score >= 15) tier = 'decent';
  return { score, tier, tags };
}

export function breakTreaty(ctxOrGame: Ctx | GameState, breakerId: Id, victimId: Id): void {
  const isCtx = 'g' in ctxOrGame && 'reg' in ctxOrGame;
  const g = isCtx ? (ctxOrGame as Ctx).g : (ctxOrGame as GameState);
  const ctx = isCtx ? (ctxOrGame as Ctx) : null;

  setRelation(g, breakerId, victimId, 'war');
  const breaker = getPlayer(g, breakerId);
  if (breaker) {
    breaker.flags = breaker.flags || {};
    breaker.flags.treatyBroken = true;
    breaker.stats.treatiesBroken = (breaker.stats.treatiesBroken || 0) + 1;
  }
  for (const p of g.players) {
    if (p.id === breakerId) continue;
    addOpinion(g, p.id, breakerId, 'treaty_broken', p.id === victimId ? -60 : -45);
  }
  if (ctx) {
    ctx.emit('treatyBroken', {
      breakerId,
      victimId,
      summary: `${breaker?.name ?? breakerId} broke a treaty with ${victimId}!`
    });
  }
}
