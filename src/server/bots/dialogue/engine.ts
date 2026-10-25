// MODULE: dialogue engine (filter, weighted pick, repeat memory, slot fill, alternation, rate limit, chat post) | USED BY: bots/dialogue/index, tests
import type { Room } from '../../types';
import { personalityOf, tierFromDifficulty, tierProfile } from '../tiers';
import type { ChatStyle, Personality } from '../tiers';
import { CHAT_MULT, EVENT_META } from './events';
import { ALL_LINES } from './lines';
import type { DialogueCtx, DialogueEvent, DialogueFacts, Line, LineWhen } from './types';

/** Minimum time between two ordinary bot lines in one room. Major events bypass it. */
export const ROOM_GAP_MS = 2200;
/** Minimum time between two ordinary lines from the same bot. */
export const BOT_COOLDOWN_MS = 7000;
/** Minimum time between two replies to human chat. */
export const REPLY_GAP_MS = 12000;
/** Repeat memory: a bot will not reuse its last 8 variants, the room will not reuse the last 12. */
export const BOT_MEMORY = 8;
export const ROOM_MEMORY = 12;
/** Same cap the server puts on human chat. */
export const MAX_CHARS = 120;

// ---- Text: slots and alternation ---------------------------------------------------

const SLOT_RE = /\{([A-Za-z]+)\}/g;
const ALT_RE = /\{([^{}|]*(?:\|[^{}|]*)+)\}/g;

/** Names of the {slots} in a text (alternations like {a|b} are not slots). */
export function slotsIn(text: string): string[] {
  return [...text.matchAll(SLOT_RE)].map(m => m[1]);
}

/** `{Oh|Ah|Well}, a seven.` -> one option per use. */
export function expandAlternation(text: string, rand: () => number): string {
  return text.replace(ALT_RE, (_m: string, body: string) => {
    const options = body.split('|');
    return options[Math.floor(rand() * options.length)];
  });
}

/** Fills {slots}. Returns null when a slot has no value, so the variant is dropped instead of printing `{name}`. */
export function fillSlots(text: string, slots: Record<string, string | number>): string | null {
  let missing = false;
  const out = text.replace(SLOT_RE, (_m: string, name: string) => {
    const value = slots[name];
    if (value === undefined) { missing = true; return ''; }
    return String(value);
  });
  return missing ? null : out;
}

const tidy = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Every raw string a line can say (variants and all parts). Used by the tests. */
export function allTexts(line: Line): string[] {
  const out: string[] = [];
  if (line.text !== undefined) out.push(...(Array.isArray(line.text) ? line.text : [line.text]));
  if (line.parts) out.push(...(line.parts.open ?? []), ...line.parts.core, ...(line.parts.close ?? []));
  return out;
}

/** How many distinct lines this entry can produce (composed lines count their combinations). */
export function variantCount(line: Line): number {
  let n = line.text === undefined ? 0 : Array.isArray(line.text) ? line.text.length : 1;
  if (line.parts) {
    n += (line.parts.open?.length || 1) * line.parts.core.length * (line.parts.close?.length || 1);
  }
  return n;
}

// ---- Picking ---------------------------------------------------------------------------

export function whenHolds(when: LineWhen | undefined, f: DialogueFacts): boolean {
  if (!when) return true;
  if (when.self && f.selfRank !== when.self) return false;
  if (when.vpLeftAtMost !== undefined && f.selfVpLeft > when.vpLeftAtMost) return false;
  if (when.map && !f.traits.includes(when.map)) return false;
  if (when.overLimit !== undefined && f.overLimit !== when.overLimit) return false;
  if (when.other === 'leader' && !f.otherLeader) return false;
  if (when.other === 'newcomer' && !f.otherNewcomer) return false;
  return true;
}

interface Candidate {
  /** `lineId#index` for a text variant, `lineId` for a composed line. This is what the repeat memory stores. */
  vid: string;
  weight: number;
  render: (rand: () => number) => string;
}

function candidatesOf(line: Line, slots: Record<string, string | number>): Candidate[] {
  const out: Candidate[] = [];
  let weight = line.weight ?? 1;
  if (line.personality) weight *= 2.5;
  if (line.when) weight *= line.when.map ? 3 : 2;

  const texts = line.text === undefined ? [] : Array.isArray(line.text) ? line.text : [line.text];
  texts.forEach((raw, i) => {
    const filled = fillSlots(raw, slots);
    if (filled !== null) out.push({ vid: `${line.id}#${i}`, weight, render: rand => expandAlternation(filled, rand) });
  });

  if (line.parts) {
    const usable = (list?: string[]): string[] =>
      (list ?? []).map(s => fillSlots(s, slots)).filter((s): s is string => s !== null);
    const core = usable(line.parts.core);
    if (core.length > 0) {
      const open = usable(line.parts.open);
      const close = usable(line.parts.close);
      out.push({
        vid: line.id,
        weight: weight * 2,
        render: rand => [open, core, close]
          .map(pool => (pool.length > 0 ? expandAlternation(pool[Math.floor(rand() * pool.length)], rand) : ''))
          .filter(Boolean)
          .join(' ')
      });
    }
  }
  return out;
}

function weightedChoice<T extends { weight: number }>(items: T[], rand: () => number): T {
  const total = items.reduce((sum, it) => sum + it.weight, 0);
  let r = rand() * total;
  for (const it of items) {
    r -= it.weight;
    if (r < 0) return it;
  }
  return items[items.length - 1];
}

export interface PickQuery {
  event: DialogueEvent;
  style: ChatStyle;
  personality: Personality;
  ctx: DialogueCtx;
  /** This bot's recent variant ids, oldest first. */
  botRecent: string[];
  /** The room's recent variant ids, oldest first. */
  roomRecent: string[];
  rand: () => number;
}

/**
 * 1. filter by event, style, personality and conditions
 * 2. drop variants whose slots have no value
 * 3. skip anything this bot or the room used recently (if everything is blocked, take the oldest)
 * 4. weighted random pick, personality and conditional lines weigh more
 */
export function pickLine(lines: Line[], q: PickQuery): { vid: string; text: string } | null {
  const cands: Candidate[] = [];
  for (const line of lines) {
    if (line.event !== q.event) continue;
    if (line.style && !line.style.includes(q.style)) continue;
    if (line.personality && !line.personality.includes(q.personality)) continue;
    if (!whenHolds(line.when, q.ctx.facts)) continue;
    cands.push(...candidatesOf(line, q.ctx.slots));
  }
  if (cands.length === 0) return null;

  const free = cands.filter(c => !q.botRecent.includes(c.vid) && !q.roomRecent.includes(c.vid));
  let chosen: Candidate;
  if (free.length > 0) {
    chosen = weightedChoice(free, q.rand);
  } else {
    // Everything was used lately: take the one this bot used longest ago (never used by this bot = oldest).
    const age = (c: Candidate): number => q.botRecent.lastIndexOf(c.vid);
    const oldest = Math.min(...cands.map(age));
    chosen = weightedChoice(cands.filter(c => age(c) === oldest), q.rand);
  }
  const text = tidy(chosen.render(q.rand));
  return text ? { vid: chosen.vid, text } : null;
}

// ---- Room memory ---------------------------------------------------------------------------

export interface RoomMemory {
  botRecent: Map<string, string[]>;
  roomRecent: string[];
  lastChatAt: number;
  lastByBot: Map<string, number>;
  lastReplyAt: number;
  /** award id -> holder id, as of the end of the previous action. */
  awards: Record<string, string | null>;
  /** trade id -> proposer id (the engine's trade events only carry the id). */
  trades: Map<number, string>;
  /** One-shot announcements already made this game (`one:botId`, `close:humanId`, `bank:res`). */
  announced: Set<string>;
}

const MEMORY = new WeakMap<object, RoomMemory>();

function freshMemory(): RoomMemory {
  return {
    botRecent: new Map(),
    roomRecent: [],
    lastChatAt: Number.NEGATIVE_INFINITY,
    lastByBot: new Map(),
    lastReplyAt: Number.NEGATIVE_INFINITY,
    awards: {},
    trades: new Map(),
    announced: new Set()
  };
}

export function memoryOf(room: Room): RoomMemory {
  let mem = MEMORY.get(room);
  if (!mem) { mem = freshMemory(); MEMORY.set(room, mem); }
  return mem;
}

/** A new game (or rematch) starts with a clean memory. */
export function resetMemory(room: Room): void {
  MEMORY.set(room, freshMemory());
}

function remember(list: string[], vid: string, max: number): void {
  list.push(vid);
  while (list.length > max) list.shift();
}

// ---- Speaking ---------------------------------------------------------------------------

export interface Speaker { id: string; name: string; avatar: string; color: string; difficulty: string | null }

export interface SpeakOpts {
  rand?: () => number;
  now?: () => number;
  /** A reply to human chat: also respects the reply gap. */
  reply?: boolean;
}

/**
 * Tries to post one line for `event` as `speaker`. Returns true if something was posted.
 * `build` runs only after the chance roll and the rate limits pass, so a quiet game costs almost nothing.
 */
export function speak(room: Room, speaker: Speaker, event: DialogueEvent, build: () => DialogueCtx, opts: SpeakOpts = {}): boolean {
  const rand = opts.rand ?? Math.random;
  const now = (opts.now ?? Date.now)();

  const mult = CHAT_MULT[room.settings?.botChat ?? 'normal'] ?? 1;
  if (mult <= 0) return false;
  const meta = EVENT_META[event];
  const speedDiv = meta.major ? 1 : Math.max(1, (Number(room.settings?.gameSpeed) || 1) / 2);
  if (rand() >= Math.min(1, (meta.chance * mult) / speedDiv)) return false;

  const mem = memoryOf(room);
  if (!meta.major) {
    if (now - mem.lastChatAt < ROOM_GAP_MS) return false;
    if (now - (mem.lastByBot.get(speaker.id) ?? Number.NEGATIVE_INFINITY) < BOT_COOLDOWN_MS) return false;
  }
  if (opts.reply && now - mem.lastReplyAt < REPLY_GAP_MS) return false;

  const style = tierProfile(tierFromDifficulty(speaker.difficulty)).chat;
  let botRecent = mem.botRecent.get(speaker.id);
  if (!botRecent) { botRecent = []; mem.botRecent.set(speaker.id, botRecent); }

  const picked = pickLine(ALL_LINES, {
    event,
    style,
    personality: personalityOf(speaker.id),
    ctx: build(),
    botRecent,
    roomRecent: mem.roomRecent,
    rand
  });
  if (!picked) return false;

  room.chats.push({ sender: speaker.name, avatar: speaker.avatar, color: speaker.color, text: picked.text.slice(0, MAX_CHARS) });
  while (room.chats.length > 60) room.chats.shift();

  mem.lastChatAt = now;
  mem.lastByBot.set(speaker.id, now);
  if (opts.reply) mem.lastReplyAt = now;
  remember(botRecent, picked.vid, BOT_MEMORY);
  remember(mem.roomRecent, picked.vid, ROOM_MEMORY);
  return true;
}
