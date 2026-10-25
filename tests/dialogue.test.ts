import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../src/shared';
import { CITY, SETTLEMENT } from '../src/packs/base/constants';
import { emitBotDialogue, emitGameStartDialogue, reactToChat } from '../src/server/bots/dialogue';
import { buildCtx, publicStanding } from '../src/server/bots/dialogue/context';
import {
  BOT_COOLDOWN_MS, MAX_CHARS, ROOM_GAP_MS, allTexts, memoryOf, pickLine, slotsIn, speak, variantCount
} from '../src/server/bots/dialogue/engine';
import {
  ALL_EVENTS, EVENT_META, FREQUENT_EVENTS, PRIVATE_EVENTS, allowedSlots, normalizeBotChat
} from '../src/server/bots/dialogue/events';
import { ALL_LINES, SILENT } from '../src/server/bots/dialogue/lines';
import type { DialogueCtx, DialogueEvent, DialogueFacts, Line } from '../src/server/bots/dialogue/types';
import { createRoom, rooms } from '../src/server/rooms';
import { mergeSettings } from '../src/server/lobby';
import { registry } from '../src/server/runtime';
import type { ChatStyle } from '../src/server/bots/tiers';
import type { Room } from '../src/server/types';

afterEach(() => vi.restoreAllMocks());

// ---- helpers --------------------------------------------------------------------------

const STYLES: ChatStyle[] = ['friendly', 'neutral', 'cold'];
const RESOURCE_WORDS = /\b(wood|brick|sheep|wool|wheat|grain|ore|lumber|clay|stone)\b/i;

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FACTS: DialogueFacts = {
  selfRank: 'middle', selfVpLeft: 5, overLimit: false, otherLeader: false, otherNewcomer: false, traits: []
};
const FULL: DialogueCtx = {
  slots: {
    me: 'Bo', win: 10, limit: 7, turn: 5, vp: 4, vpLeft: 6, leader: 'Ann', name: 'Ann', n: 3, sum: 8, number: 6,
    res: 'wheat', award: 'Longest Road'
  },
  facts: FACTS
};
const BARE: DialogueCtx = { slots: { me: 'Bo', win: 10, limit: 7 }, facts: FACTS };

const linesFor = (event: DialogueEvent, style: ChatStyle): Line[] =>
  ALL_LINES.filter(l => l.event === event && (!l.style || l.style.includes(style)));
/** Lines that always apply (no condition, no personality): the pool a bot can always draw from. */
const baseline = (event: DialogueEvent, style: ChatStyle): Line[] =>
  linesFor(event, style).filter(l => !l.when && !l.personality);

const SLOT_WIDTH: Record<string, number> = {
  me: 16, name: 16, leader: 16, award: 12, res: 6, number: 2, sum: 2, n: 2, vp: 2, vpLeft: 2, win: 2, limit: 2, turn: 3
};
/** Longest possible rendering of one text: longest alternative, widest value for every slot. */
function longest(text: string): number {
  const alt = text.replace(/\{([^{}|]*(?:\|[^{}|]*)+)\}/g, (_m, body: string) => body.split('|').sort((a, b) => b.length - a.length)[0]);
  return alt.replace(/\{([A-Za-z]+)\}/g, (_m, name: string) => 'x'.repeat(SLOT_WIDTH[name] ?? 6)).length;
}

const ev = (type: string, data: Record<string, any> = {}): any => ({ type, data });

const bot = { id: 'b', name: 'Bo', avatar: '🤖', color: '#fff', difficulty: 'Main' };

function lobbyRoom(botChat: any = 'normal', gameSpeed = 1): Room {
  return {
    code: 'T', hostId: 'a', settings: { botChat, gameSpeed, vpToWin: 10, cardDiscardLimit: 7 },
    lobbyPlayers: [], chats: [], game: null
  } as unknown as Room;
}

function gameRoom(difficulty = 'Main', botChat: any = 'chatty'): Room {
  const g = createGame(registry, {
    players: [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bo', isBot: true, difficulty }],
    shuffleSeats: false,
    seed: 7
  });
  return {
    code: 'T', hostId: 'a',
    settings: { botChat, gameSpeed: 1, vpToWin: g.rules.vpToWin, cardDiscardLimit: g.rules.discardLimit },
    lobbyPlayers: [], chats: [], game: g
  } as unknown as Room;
}

// ---- line data -----------------------------------------------------------------------------

describe('dialogue line data', () => {
  it('has unique line ids and a known event on every line', () => {
    expect(new Set(ALL_LINES.map(l => l.id)).size).toBe(ALL_LINES.length);
    for (const l of ALL_LINES) {
      expect(ALL_EVENTS, l.id).toContain(l.event);
      expect(l.text !== undefined || l.parts !== undefined, `${l.id} has no text`).toBe(true);
    }
    for (const e of ALL_EVENTS) {
      expect(ALL_LINES.some(l => l.event === e), `no lines for ${e}`).toBe(true);
      expect(EVENT_META[e], e).toBeDefined();
    }
  });

  it('only uses {slots} the event provides', () => {
    for (const l of ALL_LINES) {
      for (const text of allTexts(l)) {
        for (const slot of slotsIn(text)) {
          expect(allowedSlots(l.event), `${l.id}: {${slot}} in "${text}"`).toContain(slot);
        }
      }
    }
  });

  it('keeps every possible line within the chat length cap', () => {
    for (const l of ALL_LINES) {
      if (l.text !== undefined) {
        for (const t of Array.isArray(l.text) ? l.text : [l.text]) {
          expect(longest(t), `${l.id}: "${t}"`).toBeLessThanOrEqual(MAX_CHARS);
        }
      }
      if (l.parts) {
        const top = (list?: string[]) => Math.max(0, ...(list ?? []).map(longest));
        const total = top(l.parts.open) + top(l.parts.core) + top(l.parts.close) + 2;
        expect(total, `${l.id} composed`).toBeLessThanOrEqual(MAX_CHARS);
      }
    }
  });

  it('has no duplicate texts for the same event and style', () => {
    for (const e of ALL_EVENTS) {
      for (const style of STYLES) {
        const seen = new Set<string>();
        for (const l of linesFor(e, style)) {
          if (l.text === undefined) continue;
          for (const t of Array.isArray(l.text) ? l.text : [l.text]) {
            const key = t.toLowerCase().replace(/\s+/g, ' ').trim();
            expect(seen.has(key), `duplicate for ${e}/${style}: "${t}"`).toBe(false);
            seen.add(key);
          }
        }
      }
    }
  });

  it('has enough variants per event and tier, and is silent only where declared', () => {
    for (const e of ALL_EVENTS) {
      for (const style of STYLES) {
        const silent = SILENT[e]?.includes(style) ?? false;
        const count = baseline(e, style).reduce((n, l) => n + variantCount(l), 0);
        if (silent) {
          expect(linesFor(e, style).length, `${e}/${style} should be silent`).toBe(0);
          continue;
        }
        expect(count, `${e}/${style}`).toBeGreaterThanOrEqual(FREQUENT_EVENTS.includes(e) && style === 'friendly' ? 5 : 3);
      }
    }
  });

  it('makes Overload say less than Main', () => {
    const total = (style: ChatStyle) => ALL_LINES.filter(l => !l.style || l.style.includes(style)).reduce((n, l) => n + variantCount(l), 0);
    expect(total('cold')).toBeLessThan(total('friendly'));
    expect(SILENT.oneVpLeft).toContain('cold');
  });
});

describe('dialogue leak rules', () => {
  it('marks exactly the private events as risk private, with no resource words and no {res}', () => {
    for (const l of ALL_LINES) {
      expect(l.risk === 'private', `${l.id}`).toBe(PRIVATE_EVENTS.includes(l.event));
    }
    for (const e of PRIVATE_EVENTS) {
      expect(allowedSlots(e), e).not.toContain('res');
      for (const l of ALL_LINES.filter(x => x.event === e)) {
        for (const text of allTexts(l)) expect(text, `${l.id}: "${text}"`).not.toMatch(RESOURCE_WORDS);
      }
    }
  });

  it('only gives {res} to events where the resource is public', () => {
    const withRes = ALL_EVENTS.filter(e => allowedSlots(e).includes('res')).sort();
    expect(withRes).toEqual(['bankEmpty', 'monopoly']);
  });

  it('never has Overload hint at hidden knowledge', () => {
    for (const l of ALL_LINES.filter(x => x.style?.includes('cold'))) {
      for (const text of allTexts(l)) expect(text, l.id).not.toMatch(/as suspected|i knew|knew it|called it|expected/i);
    }
  });

  it('keeps hidden fields off the context (context.ts source scan)', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/server/bots/dialogue/context.ts', import.meta.url)), 'utf8');
    const code = src.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
    expect(code).not.toMatch(/devCards|newDevCards|\.resources|\.pending/);
  });

  it('never names a resource when a bot steals, is robbed or discards', () => {
    let posted = 0;
    for (const tier of ['Main', 'Secondary', 'Overload']) {
      for (let i = 0; i < 60; i++) {
        const asVictim = gameRoom(tier);
        emitBotDialogue(asVictim, 'a', 'move_robber', [
          ev('transferred', { from: 'b', to: 'a', resource: 'brick', amount: 1, kind: 'steal', secret: true })
        ]);
        const asThief = gameRoom(tier);
        emitBotDialogue(asThief, 'b', 'move_robber', [
          ev('transferred', { from: 'a', to: 'b', resource: 'ore', amount: 1, kind: 'steal', secret: true })
        ]);
        const discarder = gameRoom(tier);
        emitBotDialogue(discarder, 'b', 'discard', [
          ev('transferred', { from: 'b', to: 'bank', resource: 'wheat', amount: 2, kind: 'discard' }),
          ev('discarded', { playerId: 'b', count: 2 })
        ]);
        for (const r of [asVictim, asThief, discarder]) {
          for (const c of r.chats) {
            posted++;
            expect(c.text).not.toMatch(RESOURCE_WORDS);
          }
        }
      }
    }
    expect(posted).toBeGreaterThan(50);
  });
});

// ---- picking ------------------------------------------------------------------------------------

describe('dialogue picker', () => {
  const q = (over: Partial<Parameters<typeof pickLine>[1]> = {}): Parameters<typeof pickLine>[1] => ({
    event: 'city', style: 'friendly', personality: 'balanced', ctx: FULL, botRecent: [], roomRecent: [], rand: seeded(1), ...over
  });

  it('never prints an unfilled {slot} or {a|b}, with a full or a bare context', () => {
    for (const ctx of [FULL, BARE]) {
      for (const e of ALL_EVENTS) {
        for (const style of STYLES) {
          const rand = seeded(e.length * 31 + style.length);
          for (let i = 0; i < 40; i++) {
            const r = pickLine(ALL_LINES, q({ event: e, style, ctx, rand }));
            if (ctx === FULL && linesFor(e, style).length > 0) expect(r, `${e}/${style}`).not.toBeNull();
            if (r) {
              expect(r.text, `${e}/${style}`).not.toMatch(/[{}|]/);
              expect(r.text.length, `${e}/${style}`).toBeGreaterThan(0);
              expect(r.text.length, `${e}/${style}`).toBeLessThanOrEqual(MAX_CHARS);
            }
          }
        }
      }
    }
  });

  it('drops a variant instead of printing a missing slot', () => {
    const lines: Line[] = [{ id: 't', event: 'city', style: ['friendly'], text: ['Hi {name}', 'Plain'] }];
    for (let i = 0; i < 30; i++) expect(pickLine(lines, q({ ctx: BARE, rand: seeded(i) }))?.text).toBe('Plain');
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) seen.add(pickLine(lines, q({ rand: seeded(i) }))!.text);
    expect([...seen].sort()).toEqual(['Hi Ann', 'Plain']);
  });

  it('picks one option per {a|b} alternation', () => {
    const lines: Line[] = [{ id: 't', event: 'city', style: ['friendly'], text: '{Oh|Ah|Well}, a seven.' }];
    const seen = new Set<string>();
    for (let i = 0; i < 80; i++) {
      const text = pickLine(lines, q({ rand: seeded(i) }))!.text;
      expect(text).toMatch(/^(Oh|Ah|Well), a seven\.$/);
      seen.add(text);
    }
    expect(seen.size).toBe(3);
  });

  it('composes opener + core + closer without stray spaces', () => {
    const lines: Line[] = [{ id: 't', event: 'city', style: ['friendly'], parts: { open: ['A'], core: ['B'], close: ['C', ''] } }];
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) seen.add(pickLine(lines, q({ rand: seeded(i) }))!.text);
    expect([...seen].sort()).toEqual(['A B', 'A B C']);
  });

  it('respects style, personality and conditions', () => {
    const lines: Line[] = [
      { id: 'cold', event: 'city', style: ['cold'], text: 'cold' },
      { id: 'hog', event: 'city', personality: ['roadHog'], text: 'hog' },
      { id: 'lead', event: 'city', when: { self: 'leader' }, text: 'lead' },
      { id: 'near', event: 'city', when: { vpLeftAtMost: 2 }, text: 'near' },
      { id: 'fog', event: 'city', when: { map: 'fog' }, text: 'fog' },
      { id: 'any', event: 'city', text: 'any' }
    ];
    const seen = (ctx: DialogueCtx, personality: any = 'balanced') => {
      const out = new Set<string>();
      for (let i = 0; i < 200; i++) out.add(pickLine(lines, q({ ctx, personality, rand: seeded(i) }))!.text);
      return out;
    };
    expect([...seen(FULL)]).toEqual(['any']);
    expect(seen(FULL, 'roadHog').has('hog')).toBe(true);
    expect(seen({ ...FULL, facts: { ...FACTS, selfRank: 'leader' } }).has('lead')).toBe(true);
    expect(seen({ ...FULL, facts: { ...FACTS, selfVpLeft: 1 } }).has('near')).toBe(true);
    expect(seen({ ...FULL, facts: { ...FACTS, traits: ['fog'] } }).has('fog')).toBe(true);
    expect(seen(FULL).has('cold')).toBe(false);
  });

  it('skips recent variants and takes the only unused one', () => {
    const lines: Line[] = [{ id: 't', event: 'city', style: ['friendly'], text: ['a', 'b', 'c'] }];
    expect(pickLine(lines, q({ botRecent: ['t#0', 't#1'] }))?.text).toBe('c');
    expect(pickLine(lines, q({ roomRecent: ['t#0'], botRecent: ['t#1'] }))?.text).toBe('c');
  });

  it('takes the oldest variant when everything is blocked', () => {
    const lines: Line[] = [{ id: 't', event: 'city', style: ['friendly'], text: ['a', 'b', 'c'] }];
    expect(pickLine(lines, q({ botRecent: ['t#2', 't#0', 't#1'] }))?.text).toBe('c');
  });

  it('never repeats the same line back to back when there is a choice', () => {
    for (const e of ALL_EVENTS) {
      for (const style of STYLES) {
        const rand = seeded(e.length + style.length);
        const botRecent: string[] = [];
        const roomRecent: string[] = [];
        let last = '';
        for (let i = 0; i < 60; i++) {
          const r = pickLine(ALL_LINES, q({ event: e, style, rand, botRecent, roomRecent }));
          if (!r) break;
          const choices = baseline(e, style).reduce((n, l) => n + variantCount(l), 0);
          if (choices >= 2) expect(r.vid, `${e}/${style} step ${i}`).not.toBe(last);
          last = r.vid;
          botRecent.push(r.vid);
          roomRecent.push(r.vid);
          while (botRecent.length > 8) botRecent.shift();
          while (roomRecent.length > 12) roomRecent.shift();
        }
      }
    }
  });
});

// ---- speaking: chat level, chance, rate limit ----------------------------------------------------

describe('dialogue speaking', () => {
  const ctxFor = (room: Room) => () => buildCtx(room, bot);

  it('posts nothing when Bot chat is Off', () => {
    const room = lobbyRoom('off');
    expect(speak(room, bot, 'botWins', ctxFor(room), { rand: () => 0 })).toBe(false);
    expect(room.chats).toHaveLength(0);
  });

  it('scales the chance with the chat level and the game speed', () => {
    // city has a base chance of 0.5: a roll of 0.45 passes Normal (0.5) and Chatty (0.8) but not Quiet (0.2).
    const tryLevel = (level: any, speed = 1) => {
      const room = lobbyRoom(level, speed);
      return speak(room, bot, 'city', ctxFor(room), { rand: () => 0.45 });
    };
    expect(tryLevel('quiet')).toBe(false);
    expect(tryLevel('normal')).toBe(true);
    expect(tryLevel('chatty')).toBe(true);
    // 8x speed divides the chance by 4 (0.125).
    expect(tryLevel('normal', 8)).toBe(false);
    expect(normalizeBotChat('Chatty', 'normal')).toBe('chatty');
    expect(normalizeBotChat('loud', 'quiet')).toBe('quiet');
    expect(normalizeBotChat(undefined, undefined)).toBeUndefined();
  });

  it('keeps a gap between lines, a per-bot cooldown, and lets major events through', () => {
    const room = lobbyRoom();
    const rand = () => 0;
    let t = 1_000_000;
    const now = () => t;
    expect(speak(room, bot, 'city', ctxFor(room), { rand, now })).toBe(true);

    t += ROOM_GAP_MS - 100;
    const other = { ...bot, id: 'c', name: 'Cy' };
    expect(speak(room, other, 'city', ctxFor(room), { rand, now })).toBe(false); // room gap
    expect(speak(room, bot, 'botWins', ctxFor(room), { rand, now })).toBe(true); // major bypasses

    t += ROOM_GAP_MS + 100;
    expect(speak(room, other, 'city', ctxFor(room), { rand, now })).toBe(true); // other bot, gap over
    expect(speak(room, bot, 'city', ctxFor(room), { rand, now })).toBe(false); // same bot, cooldown (and room gap)

    t += BOT_COOLDOWN_MS + 100;
    expect(speak(room, bot, 'city', ctxFor(room), { rand, now })).toBe(true);
    expect(room.chats.length).toBe(4);
    expect(room.chats.every(c => c.text.length <= MAX_CHARS)).toBe(true);
  });
});

// ---- game hooks -----------------------------------------------------------------------------------

describe('dialogue hooks', () => {
  it('has a bot comment on its own seven', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const room = gameRoom();
    emitBotDialogue(room, 'b', 'roll', [ev('rolled', { playerId: 'b', dice: [3, 4], sum: 7, hexIds: [] })]);
    expect(room.chats).toHaveLength(1);
    expect(room.chats[0].sender).toBe('Bo');
  });

  it('lets a bot over the discard limit groan about someone else\'s seven, but only then', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const quiet = gameRoom();
    emitBotDialogue(quiet, 'a', 'roll', [ev('rolled', { playerId: 'a', dice: [3, 4], sum: 7, hexIds: [] })]);
    expect(quiet.chats).toHaveLength(0);

    const heavy = gameRoom();
    heavy.game!.players[1].resources.wheat = heavy.game!.rules.discardLimit + 2;
    emitBotDialogue(heavy, 'a', 'roll', [ev('rolled', { playerId: 'a', dice: [3, 4], sum: 7, hexIds: [] })]);
    expect(heavy.chats).toHaveLength(1);
    expect(heavy.chats[0].sender).toBe('Bo');
  });

  it('has the victim of a steal speak first, and the thief when the victim is human', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const room = gameRoom();
    emitBotDialogue(room, 'a', 'steal', [ev('transferred', { from: 'b', to: 'a', resource: 'brick', amount: 1, kind: 'steal', secret: true })]);
    expect(room.chats).toHaveLength(1);
    expect(room.chats[0].sender).toBe('Bo');

    const thief = gameRoom();
    emitBotDialogue(thief, 'b', 'steal', [ev('transferred', { from: 'a', to: 'b', resource: 'brick', amount: 1, kind: 'steal', secret: true })]);
    expect(thief.chats).toHaveLength(1);
  });

  it('names the monopoly resource when one moved, and still speaks when none did', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const moved = gameRoom();
    emitBotDialogue(moved, 'b', 'play_dev', [
      ev('devPlayed', { playerId: 'b', card: 'monopoly' }),
      ev('transferred', { from: 'a', to: 'b', resource: 'wheat', amount: 3, kind: 'monopoly' })
    ]);
    expect(moved.chats).toHaveLength(1);
    expect(moved.chats[0].text).not.toMatch(/[{}]/);

    const nothing = gameRoom();
    emitBotDialogue(nothing, 'b', 'play_dev', [ev('devPlayed', { playerId: 'b', card: 'monopoly' })]);
    expect(nothing.chats).toHaveLength(1);
    expect(nothing.chats[0].text).not.toMatch(/[{}]/);
  });

  it('announces an award with its real name, and lets the previous holder complain', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const won = gameRoom();
    emitBotDialogue(won, 'b', 'build', [ev('awardChanged', { award: 'longestRoad', playerId: 'b', value: 5 })]);
    expect(won.chats).toHaveLength(1);
    expect(won.chats[0].text).toContain('Longest Road');

    const lost = gameRoom();
    lost.game!.awards.longestRoad = 'b';
    emitBotDialogue(lost, 'b', 'build', []); // remembers who holds it
    lost.game!.awards.longestRoad = 'a';
    emitBotDialogue(lost, 'a', 'build', [ev('awardChanged', { award: 'longestRoad', playerId: 'a', value: 6 })]);
    expect(lost.chats).toHaveLength(1);
    expect(lost.chats[0].sender).toBe('Bo');
  });

  it('declines in the right voice and uses the proposer from the earlier trade event', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const room = gameRoom();
    emitBotDialogue(room, 'a', 'propose_trade', [ev('tradeProposed', { tradeId: 1, playerId: 'a', offer: {}, request: {} })]);
    expect(room.chats).toHaveLength(0);
    emitBotDialogue(room, 'b', 'respond_trade', [ev('tradeResponse', { tradeId: 1, playerId: 'b', decision: 'declined' })]);
    expect(room.chats).toHaveLength(1);
    expect(room.chats[0].sender).toBe('Bo');
    expect(memoryOf(room).trades.get(1)).toBe('a');
  });

  it('warns about a human close to winning, once', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const room = gameRoom();
    const g = room.game!;
    g.rules.vpToWin = 7;
    g.board.vertices[0].piece = { type: SETTLEMENT, owner: 'a' };
    g.board.vertices[5].piece = { type: CITY, owner: 'a' };
    g.awards.longestRoad = 'a';
    expect(publicStanding(g).vps.get('a')).toBe(5);

    emitBotDialogue(room, 'a', 'build', [ev('built', { playerId: 'a', piece: CITY, target: 'vertex', loc: 5, upgrade: true })]);
    expect(room.chats).toHaveLength(1);
    expect(room.chats[0].text).toContain('Ann');
    expect(memoryOf(room).announced.has('close:a')).toBe(true);
  });

  it('says nothing about hidden VP: only shown VP counts', () => {
    const room = gameRoom();
    const g = room.game!;
    g.players[0].devCards.push('vp', 'vp', 'vp');
    expect(publicStanding(g).vps.get('a')).toBe(0);
  });

  it('greets at the start of a game and resets the memory', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const room = gameRoom();
    memoryOf(room).announced.add('close:a');
    emitGameStartDialogue(room);
    expect(room.chats.length).toBeGreaterThanOrEqual(1);
    expect(room.chats[0].sender).toBe('Bo');
    expect(memoryOf(room).announced.size).toBe(0);
  });

  it('stays quiet in a game with no bots', () => {
    const g = createGame(registry, { players: [{ id: 'a', name: 'Ann' }, { id: 'c', name: 'Cy' }], shuffleSeats: false, seed: 3 });
    const room = { ...lobbyRoom('chatty'), game: g } as unknown as Room;
    emitBotDialogue(room, 'a', 'roll', [ev('rolled', { playerId: 'a', dice: [3, 4], sum: 7, hexIds: [] })]);
    emitGameStartDialogue(room);
    expect(room.chats).toHaveLength(0);
  });

  it('stays quiet when Bot chat is Off, in every hook', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const room = gameRoom('Main', 'off');
    emitGameStartDialogue(room);
    emitBotDialogue(room, 'b', 'roll', [ev('rolled', { playerId: 'b', dice: [3, 4], sum: 7, hexIds: [] })]);
    emitBotDialogue(room, 'b', 'build', [ev('awardChanged', { award: 'longestRoad', playerId: 'b', value: 5 })]);
    expect(room.chats).toHaveLength(0);
  });
});

describe('dialogue chat replies', () => {
  const human = { id: 'a', name: 'Ann', avatar: '🙂', color: '#111', isBot: false, difficulty: null };
  const breeze = { id: 'b', name: 'Breeze', avatar: '🤖', color: '#222', isBot: true, difficulty: 'Main' };
  const lobbyWith = (botChat: any = 'normal'): Room => {
    const room = lobbyRoom(botChat);
    (room as any).lobbyPlayers = [human, breeze];
    return room;
  };

  it('answers a greeting, a thank you and its own name', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    for (const text of ['hello everyone', 'thanks!', 'gg', 'lol', 'hey Breeze, are you there?']) {
      const room = lobbyWith();
      reactToChat(room, 'a', text);
      expect(room.chats, text).toHaveLength(1);
      expect(room.chats[0].sender).toBe('Breeze');
    }
  });

  it('does not answer game talk, bots, Quiet or Off, and stays rate limited', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const talk = lobbyWith();
    reactToChat(talk, 'a', 'who is winning right now?');
    expect(talk.chats).toHaveLength(0);

    const fromBot = lobbyWith();
    reactToChat(fromBot, 'b', 'hello');
    expect(fromBot.chats).toHaveLength(0);

    for (const level of ['quiet', 'off']) {
      const room = lobbyWith(level);
      reactToChat(room, 'a', 'hello');
      expect(room.chats).toHaveLength(0);
    }

    const spam = lobbyWith();
    reactToChat(spam, 'a', 'hello');
    reactToChat(spam, 'a', 'hello again');
    reactToChat(spam, 'a', 'thanks');
    expect(spam.chats).toHaveLength(1);
  });

  it('works with no bots in the room', () => {
    const room = lobbyRoom();
    (room as any).lobbyPlayers = [human];
    reactToChat(room, 'a', 'hello');
    expect(room.chats).toHaveLength(0);
  });
});

describe('Bot chat setting', () => {
  it('is kept by mergeSettings, defaults to unset, and ignores bad values', () => {
    const room = createRoom('host_socket', 'Host');
    try {
      const base = room.settings;
      expect(base.botChat).toBeUndefined();
      expect(mergeSettings({ botChat: 'quiet' }, base).botChat).toBe('quiet');
      expect(mergeSettings({ botChat: 'LOUD' }, { ...base, botChat: 'chatty' }).botChat).toBe('chatty');
      expect(mergeSettings({}, { ...base, botChat: 'off' }).botChat).toBe('off');
    } finally {
      delete rooms[room.code];
    }
  });
});
