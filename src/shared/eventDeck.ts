// MODULE: S0.11 seeded event deck (service 16: `event-deck`, base + DLC cards, top-card preview, fate token veto/uphold, derived RNG stream) | DEPENDS ON: shared/ctx, shared/history, shared/registry, shared/rng, shared/state, shared/tileState, +1 more | USED BY: shared/index, shared/stage1
import type { Ctx } from './ctx';
import { appendPublicHistory } from './history';
import { defsOf } from './registry';
import type { Registry } from './registry';
import { createRng, rngShuffle } from './rng';
import type { RngState } from './rng';
import { bankGive, getPlayer } from './state';
import { setTileState } from './tileState';
import type { GameState, Id } from './types';

export const EVENT_CARDS = 'eventCards';

export interface EventCardDef {
  id: string;
  title: string;
  description: string;
  /** Optional pack/DLC id; only included when that pack/addon is enabled or for base events. */
  pack?: string;
  /** Number of copies in the deck (default 1). */
  copies?: number;
  /** Runs when the event is drawn and resolved at round start. */
  apply(ctx: Ctx): void;
  replace?: boolean;
}

export interface EventDeckState {
  rng: RngState;
  deck: string[];
  discard: string[];
  activeEventId: string | null;
  fateTokens: Record<Id, number>;
  /** Pending veto state for the current preview card (`deck[0]`). */
  pendingVeto: {
    cardId: string;
    vetoedBy: Id;
    upheldBy: Id | null;
  } | null;
}

/** Built-in base event cards available in any game with `eventsOn`. */
export const BASE_EVENT_CARDS: EventCardDef[] = [
  {
    id: 'base.festival',
    title: 'Harvest Festival',
    description: 'Every player receives 1 resource of their smallest pile from the bank.',
    copies: 2,
    apply(ctx) {
      const resources = [...ctx.reg.resources.keys()];
      if (resources.length === 0) return;
      for (const p of ctx.g.players) {
        const sorted = [...resources].sort((a, b) => (p.resources[a] || 0) - (p.resources[b] || 0));
        for (const r of sorted) {
          if ((ctx.g.bank[r] || 0) > 0) {
            bankGive(ctx, p.id, r, 1);
            break;
          }
        }
      }
    }
  },
  {
    id: 'base.drought',
    title: 'Summer Drought',
    description: 'The highest-numbered wheat field is parched (barren) for 1 round.',
    copies: 1,
    apply(ctx) {
      const wheats = ctx.g.board.hexes
        .filter(h => h.type === 'wheat' && !h.ext.hidden && h.number !== null)
        .sort((a, b) => (b.number || 0) - (a.number || 0));
      if (wheats[0]) {
        setTileState(ctx.g, wheats[0].id, { id: 'barren', until: (ctx.g.round || 1) + 1 });
      }
    }
  },
  {
    id: 'base.bountiful_hills',
    title: 'Bountiful Hills',
    description: 'The lowest-numbered brick hill becomes fertile (+1 yield) for 1 round.',
    copies: 1,
    apply(ctx) {
      const bricks = ctx.g.board.hexes
        .filter(h => h.type === 'brick' && !h.ext.hidden && h.number !== null)
        .sort((a, b) => (a.number || 99) - (b.number || 99));
      if (bricks[0]) {
        setTileState(ctx.g, bricks[0].id, { id: 'fertile', until: (ctx.g.round || 1) + 1 });
      }
    }
  },
  {
    id: 'base.calm_seas',
    title: 'Calm Seas',
    description: 'Maritime winds favour traders: each port owner gains 1 sheep or wood from the bank.',
    copies: 1,
    apply(ctx) {
      const portOwners = new Set<Id>();
      for (const v of ctx.g.board.vertices) {
        if (v.piece && v.port) portOwners.add(v.piece.owner);
      }
      for (const pid of portOwners) {
        if ((ctx.g.bank.wood || 0) > 0) bankGive(ctx, pid, 'wood', 1);
        else if ((ctx.g.bank.sheep || 0) > 0) bankGive(ctx, pid, 'sheep', 1);
      }
    }
  }
];

/** Derives an independent RNG stream from `g.seed` so the event deck never shifts `g.rng`. */
export function deriveEventRng(seed: number): RngState {
  return createRng(((Number(seed) || 1) ^ 0x9e3779b9) >>> 0);
}

/** All event card definitions active for this registry (base cards + registered `EVENT_CARDS`). */
export function allEventCards(reg: Registry): Map<string, EventCardDef> {
  const map = new Map<string, EventCardDef>();
  for (const c of BASE_EVENT_CARDS) map.set(c.id, c);
  for (const [id, c] of defsOf<EventCardDef>(reg, EVENT_CARDS).entries()) {
    map.set(id, c);
  }
  return map;
}

function buildShuffledDeckIds(reg: Registry, rng: RngState): string[] {
  const cards = allEventCards(reg);
  const ids: string[] = [];
  for (const c of cards.values()) {
    const count = Math.max(1, c.copies ?? 1);
    for (let i = 0; i < count; i++) ids.push(c.id);
  }
  return rngShuffle(rng, ids);
}

/** Initializes or returns the seeded event deck state in `g.ext.core.eventDeck`. Never touches `g.rng`. */
export function ensureEventDeck(g: GameState, reg: Registry): EventDeckState {
  g.ext = g.ext || {};
  g.ext.core = g.ext.core || {};
  if (!g.ext.core.eventDeck) {
    const rng = deriveEventRng(g.seed);
    const deck = buildShuffledDeckIds(reg, rng);
    const startTokens = Math.max(0, Number(g.rules?.fateTokens ?? 2));
    const fateTokens: Record<Id, number> = {};
    for (const p of g.players) fateTokens[p.id] = startTokens;
    g.ext.core.eventDeck = {
      rng,
      deck,
      discard: [],
      activeEventId: null,
      fateTokens,
      pendingVeto: null
    } satisfies EventDeckState;
  }
  const st = g.ext.core.eventDeck as EventDeckState;
  if (st.deck.length === 0) {
    st.deck = buildShuffledDeckIds(reg, st.rng);
    st.discard = [];
  }
  return st;
}

/** Returns the top card of the event deck (the 1-round-ahead preview), without mutating the deck. */
export function peekNextEvent(g: GameState, reg: Registry): EventCardDef | null {
  const st = ensureEventDeck(g, reg);
  const topId = st.deck[0];
  if (!topId) return null;
  return allEventCards(reg).get(topId) ?? null;
}

export function getFateTokens(g: GameState, reg: Registry, pid: Id): number {
  const st = ensureEventDeck(g, reg);
  return st.fateTokens[pid] ?? 0;
}

export function addFateTokens(g: GameState, reg: Registry, pid: Id, delta: number): number {
  const st = ensureEventDeck(g, reg);
  const maxCap = Math.max(2, Number(g.rules?.fateTokens ?? 2));
  const next = Math.max(0, Math.min(maxCap, (st.fateTokens[pid] ?? 0) + delta));
  st.fateTokens[pid] = next;
  return next;
}

/**
 * Player spends 1 Fate token to veto the previewed top card (`deck[0]`).
 * Records `pendingVeto`; if no other player upholds it before resolution (or when resolved immediately with `resolveNow = true`),
 * the vetoed card moves to the bottom of the deck and the new top card becomes the preview.
 */
export function vetoPreviewEvent(
  ctx: Ctx,
  pid: Id,
  resolveNow = true
): { ok: boolean; error?: string; vetoedCardId?: string; nextPreviewId?: string | null } {
  const { g, reg } = ctx;
  const st = ensureEventDeck(g, reg);
  const p = getPlayer(g, pid);
  if (!p) return { ok: false, error: 'Unknown player' };
  if ((st.fateTokens[pid] ?? 0) <= 0) return { ok: false, error: 'No Fate tokens left' };
  const topId = st.deck[0];
  if (!topId) return { ok: false, error: 'No previewed event to veto' };
  if (st.pendingVeto && st.pendingVeto.cardId === topId) {
    return { ok: false, error: 'This event already has a pending veto' };
  }

  st.fateTokens[pid] -= 1;
  p.stats.fateSpent = (p.stats.fateSpent || 0) + 1;
  st.pendingVeto = { cardId: topId, vetoedBy: pid, upheldBy: null };

  if (resolveNow) {
    const shifted = st.deck.shift()!;
    st.deck.push(shifted);
    st.pendingVeto = null;
  }

  const card = allEventCards(reg).get(topId);
  ctx.emit('eventVetoed', { playerId: pid, cardId: topId, title: card?.title ?? topId });
  ctx.log(`🔮 ${p.avatar} ${p.name} spent a Fate token to veto "${card?.title ?? topId}"!`, p.color);
  return { ok: true, vetoedCardId: topId, nextPreviewId: st.deck[0] ?? null };
}

/**
 * Another player spends 1 Fate token to uphold a vetoed preview event, locking it back to the top of the deck.
 */
export function upholdPreviewEvent(
  ctx: Ctx,
  pid: Id
): { ok: boolean; error?: string; upheldCardId?: string } {
  const { g, reg } = ctx;
  const st = ensureEventDeck(g, reg);
  const p = getPlayer(g, pid);
  if (!p) return { ok: false, error: 'Unknown player' };
  if ((st.fateTokens[pid] ?? 0) <= 0) return { ok: false, error: 'No Fate tokens left' };

  let targetCardId = st.pendingVeto?.cardId;
  if (st.pendingVeto) {
    if (st.pendingVeto.vetoedBy === pid) return { ok: false, error: 'Cannot uphold your own veto' };
    st.pendingVeto.upheldBy = pid;
    st.pendingVeto = null;
  } else if (st.deck.length > 1) {
    // If veto already pushed the card to the bottom of the deck (`resolveNow = true`), pull it back to the top!
    const bottom = st.deck.pop()!;
    st.deck.unshift(bottom);
    targetCardId = bottom;
  } else {
    return { ok: false, error: 'No vetoed event to uphold' };
  }

  st.fateTokens[pid] -= 1;
  p.stats.fateSpent = (p.stats.fateSpent || 0) + 1;
  const card = targetCardId ? allEventCards(reg).get(targetCardId) : undefined;
  ctx.emit('eventUpheld', { playerId: pid, cardId: targetCardId, title: card?.title ?? targetCardId });
  ctx.log(`⚖️ ${p.avatar} ${p.name} spent a Fate token to uphold "${card?.title ?? targetCardId}"!`, p.color);
  return { ok: true, upheldCardId: targetCardId };
}

/** Draws the top card of the event deck, applies its effect, records it in public history, and ensures the next preview is ready. */
export function drawAndApplyRoundEvent(ctx: Ctx): EventCardDef | null {
  const { g, reg } = ctx;
  const st = ensureEventDeck(g, reg);

  // If a pending veto was not upheld before the round started, push the vetoed card to the bottom first.
  if (st.pendingVeto && !st.pendingVeto.upheldBy && st.deck[0] === st.pendingVeto.cardId) {
    const vetoed = st.deck.shift()!;
    st.deck.push(vetoed);
  }
  st.pendingVeto = null;

  if (st.deck.length === 0) {
    st.deck = buildShuffledDeckIds(reg, st.rng);
    st.discard = [];
  }
  const cardId = st.deck.shift();
  if (!cardId) return null;
  st.discard.push(cardId);
  st.activeEventId = cardId;

  if (st.deck.length === 0) {
    st.deck = buildShuffledDeckIds(reg, st.rng);
    st.discard = [];
  }

  const card = allEventCards(reg).get(cardId);
  if (!card) return null;

  card.apply(ctx);
  ctx.emit('eventDrawn', { cardId: card.id, title: card.title, description: card.description, round: g.round || 1 });
  appendPublicHistory(g, {
    type: 'eventDrawn',
    actorId: null,
    targetId: null,
    summary: `Event: ${card.title}`,
    data: { cardId: card.id, title: card.title }
  });
  ctx.log(`📜 Event — ${card.title}: ${card.description}`, null);
  return card;
}
