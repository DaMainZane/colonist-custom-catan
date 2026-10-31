// MODULE: S0.10 public history ring buffer, change log, and stats registry (service 15: `history`) | DEPENDS ON: shared/ctx, shared/registry, shared/types | USED BY: shared/eventDeck, shared/index, shared/stage1
import type { Ctx, GameEvent } from './ctx';
import { defsOf } from './registry';
import type { GameState, Id } from './types';

export const STAT_HANDLERS = 'statHandlers';
export const MAX_PUBLIC_HISTORY = 64;

export interface StatHandlerDef {
  id: string;
  handle(ctx: Ctx, actionType: string): void;
  replace?: boolean;
}

export interface PublicHistoryEntry {
  seq: number;
  round: number;
  turnCount: number;
  type: string;
  actorId: Id | null;
  targetId: Id | null;
  summary: string;
  data: Record<string, any>;
}

const PRIVATE_KEYS = new Set(['resources', 'devCards', 'newDevCards', 'hand', 'secret']);

function ensureHistoryStore(g: GameState): { seq: number; entries: PublicHistoryEntry[] } {
  g.ext = g.ext || {};
  g.ext.core = g.ext.core || {};
  if (!g.ext.core.history) {
    g.ext.core.history = { seq: 0, entries: [] };
  }
  return g.ext.core.history;
}

/** Sanitizes an event payload so only public information enters the history ring buffer. */
export function sanitizePublicEventData(type: string, raw: Record<string, any> | undefined): Record<string, any> {
  if (!raw || typeof raw !== 'object') return {};
  const isSecret = raw.secret === true;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (PRIVATE_KEYS.has(k)) continue;
    // On a secret transfer (such as robber steal), never record which resource was stolen.
    if (isSecret && k === 'resource') continue;
    // Never record dev card identity when bought (devBought is secret; devPlayed is public).
    if (type === 'devBought' && k === 'card') continue;
    out[k] = v;
  }
  return out;
}

/** Converts an emitted engine event into a public history ring-buffer entry (or null for internal/noisy events). */
function toPublicEntry(g: GameState, seq: number, ev: GameEvent): PublicHistoryEntry | null {
  const d = ev.data || {};
  const round = g.round || 0;
  const turnCount = g.turnCount || 0;
  const data = sanitizePublicEventData(ev.type, d);

  switch (ev.type) {
    case 'rolled':
      return {
        seq,
        round,
        turnCount,
        type: 'rolled',
        actorId: d.playerId ?? null,
        targetId: null,
        summary: `Rolled ${d.sum}`,
        data
      };
    case 'produced':
      return {
        seq,
        round,
        turnCount,
        type: 'produced',
        actorId: d.playerId ?? null,
        targetId: d.taxedFrom ?? null,
        summary: `Produced ${d.amount} ${d.resource}`,
        data
      };
    case 'transferred':
      if (d.kind === 'steal') {
        return {
          seq,
          round,
          turnCount,
          type: 'steal',
          actorId: d.to ?? null,
          targetId: d.from ?? null,
          summary: `${d.to} stole ${d.amount || 1} card from ${d.from}`,
          data
        };
      }
      if (d.kind === 'monopoly' || d.kind === 'playerTrade' || d.kind === 'bankTrade' || d.kind === 'discard') {
        return {
          seq,
          round,
          turnCount,
          type: d.kind,
          actorId: d.from && d.from !== 'bank' ? d.from : d.to ?? null,
          targetId: d.to && d.to !== 'bank' ? d.to : null,
          summary: `${d.kind}: ${d.amount}`,
          data
        };
      }
      return null;
    case 'built':
      return {
        seq,
        round,
        turnCount,
        type: 'built',
        actorId: d.playerId ?? null,
        targetId: null,
        summary: `Built ${d.piece}`,
        data
      };
    case 'robberMoved':
      return {
        seq,
        round,
        turnCount,
        type: 'robberMoved',
        actorId: d.playerId ?? null,
        targetId: null,
        summary: `Moved robber to hex ${d.hexId}`,
        data
      };
    case 'devBought':
    case 'devPlayed':
    case 'awardChanged':
    case 'treatyBroken':
    case 'eventDrawn':
    case 'contractClaimed':
    case 'markerExpired':
    case 'pieceBroken':
    case 'karaokeLost': {
      let defaultSummary: string = ev.type;
      if (ev.type === 'pieceBroken' && d.piece) {
        defaultSummary = `Collapsed ${d.piece}`;
      } else if (ev.type === 'awardChanged' && d.award) {
        defaultSummary = d.playerId ? `Claimed ${d.award} (${d.value ?? ''})` : `Lost ${d.award}`;
      }
      return {
        seq,
        round,
        turnCount,
        type: ev.type,
        actorId: d.playerId ?? d.breakerId ?? d.holderId ?? d.ownerId ?? null,
        targetId: d.victimId ?? d.previousHolderId ?? null,
        summary: d.summary || defaultSummary,
        data
      };
    }
    default:
      return null;
  }
}

/** Appends a public event directly to the ring buffer (capped at `MAX_PUBLIC_HISTORY`). */
export function appendPublicHistory(
  g: GameState,
  entry: Omit<PublicHistoryEntry, 'seq' | 'round' | 'turnCount'> & { round?: number; turnCount?: number }
): PublicHistoryEntry {
  const store = ensureHistoryStore(g);
  store.seq += 1;
  const full: PublicHistoryEntry = {
    seq: store.seq,
    round: entry.round ?? (g.round || 0),
    turnCount: entry.turnCount ?? (g.turnCount || 0),
    type: entry.type,
    actorId: entry.actorId ?? null,
    targetId: entry.targetId ?? null,
    summary: entry.summary,
    data: sanitizePublicEventData(entry.type, entry.data)
  };
  store.entries.push(full);
  while (store.entries.length > MAX_PUBLIC_HISTORY) {
    store.entries.shift();
  }
  return full;
}

/** Records all public events from `ctx.events` into the ring buffer and runs all registered `STAT_HANDLERS`. */
export function runStatHandlers(ctx: Ctx, actionType: string): void {
  const { g, reg } = ctx;
  const store = ensureHistoryStore(g);

  for (const ev of ctx.events) {
    const entry = toPublicEntry(g, store.seq + 1, ev);
    if (entry) {
      store.seq = entry.seq;
      store.entries.push(entry);
      while (store.entries.length > MAX_PUBLIC_HISTORY) {
        store.entries.shift();
      }
    }
  }

  for (const handler of defsOf<StatHandlerDef>(reg, STAT_HANDLERS).values()) {
    handler.handle(ctx, actionType);
  }
}

/** Queries the public history ring buffer (newest last). */
export function getPublicHistory(
  g: GameState,
  filter?: {
    round?: number;
    type?: string;
    actorId?: Id;
    targetId?: Id;
    limit?: number;
  }
): PublicHistoryEntry[] {
  const entries: PublicHistoryEntry[] = g.ext?.core?.history?.entries ?? [];
  const filtered = entries.filter(e => {
    if (filter?.round !== undefined && e.round !== filter.round) return false;
    if (filter?.type !== undefined && e.type !== filter.type) return false;
    if (filter?.actorId !== undefined && e.actorId !== filter.actorId) return false;
    if (filter?.targetId !== undefined && e.targetId !== filter.targetId) return false;
    return true;
  });
  if (filter?.limit && filter.limit > 0 && filtered.length > filter.limit) {
    return filtered.slice(filtered.length - filter.limit);
  }
  return [...filtered];
}

export interface StreakReport {
  /** e.g. three 6s in a row. */
  rollStreak: { sum: number; count: number } | null;
  /** e.g. a player robbed >= 2 times in the last `windowTurns` turns. */
  hammeredVictim: { victimId: Id; hits: number; windowTurns: number } | null;
}

/** Detects public roll streaks and repeated robber hits for the Bot Drinking Game, Instigation, and Nemesis triggers. */
export function detectStreaks(g: GameState, windowTurns = 4): StreakReport {
  const entries = getPublicHistory(g);
  const rolls = entries.filter(e => e.type === 'rolled');
  let rollStreak: { sum: number; count: number } | null = null;
  if (rolls.length > 0) {
    const lastSum = Number(rolls[rolls.length - 1].data.sum);
    let count = 0;
    for (let i = rolls.length - 1; i >= 0; i--) {
      if (Number(rolls[i].data.sum) === lastSum) count++;
      else break;
    }
    if (count >= 3) rollStreak = { sum: lastSum, count };
  }

  const minTurn = Math.max(0, (g.turnCount || 0) - windowTurns);
  const steals = entries.filter(e => e.type === 'steal' && e.turnCount >= minTurn && e.targetId);
  const hitCounts = new Map<Id, number>();
  for (const s of steals) {
    if (!s.targetId) continue;
    hitCounts.set(s.targetId, (hitCounts.get(s.targetId) || 0) + 1);
  }
  let hammeredVictim: { victimId: Id; hits: number; windowTurns: number } | null = null;
  for (const [victimId, hits] of hitCounts.entries()) {
    if (hits >= 2 && (!hammeredVictim || hits > hammeredVictim.hits)) {
      hammeredVictim = { victimId, hits, windowTurns };
    }
  }

  return { rollStreak, hammeredVictim };
}
