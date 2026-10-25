// MODULE: dialogue event table (chance, major flag, allowed slots, private-risk set, chat levels) | USED BY: bots/dialogue/*, server/lobby, tests
import type { BotChatLevel, DialogueEvent } from './types';

export const ALL_EVENTS: DialogueEvent[] = [
  'rollSeven', 'otherSeven', 'discard', 'goodRoll', 'noProduction',
  'robbedOn', 'robberLeader', 'robberNumber', 'steal', 'robbed',
  'city', 'settlement', 'road', 'devBought', 'knight', 'monopoly', 'yearOfPlenty', 'roadBuilding',
  'awardWon', 'awardLost', 'oneVpLeft', 'humanClose',
  'tradeOffer', 'tradeDecline', 'tradeDeclineLeader', 'tradeAccept', 'tradeCounter', 'tradeNoTakers', 'bankEmpty',
  'gameStart', 'largeMap', 'islands', 'fogReveal', 'otherWins', 'botWins',
  'chatHello', 'chatGg', 'chatThanks', 'chatLol', 'chatName'
];

export interface EventMeta {
  /** Base chance that a bot says something when the event happens (before the chat level and game speed). */
  chance: number;
  /** Major events bypass the room gap and the per-bot cooldown, and ignore game speed. */
  major?: boolean;
}

export const EVENT_META: Record<DialogueEvent, EventMeta> = {
  rollSeven: { chance: 0.55 },
  otherSeven: { chance: 0.3 },
  discard: { chance: 0.5 },
  goodRoll: { chance: 0.2 },
  noProduction: { chance: 0.2 },
  robbedOn: { chance: 0.5 },
  robberLeader: { chance: 0.5 },
  robberNumber: { chance: 0.35 },
  steal: { chance: 0.5 },
  robbed: { chance: 0.65 },
  city: { chance: 0.5 },
  settlement: { chance: 0.35 },
  road: { chance: 0.08 },
  devBought: { chance: 0.3 },
  knight: { chance: 0.45 },
  monopoly: { chance: 1, major: true },
  yearOfPlenty: { chance: 0.5 },
  roadBuilding: { chance: 0.5 },
  awardWon: { chance: 1, major: true },
  awardLost: { chance: 0.6 },
  oneVpLeft: { chance: 0.7 },
  humanClose: { chance: 0.8 },
  tradeOffer: { chance: 0.3 },
  tradeDecline: { chance: 0.35 },
  tradeDeclineLeader: { chance: 0.6 },
  tradeAccept: { chance: 0.45 },
  tradeCounter: { chance: 0.4 },
  tradeNoTakers: { chance: 0.4 },
  bankEmpty: { chance: 0.8 },
  gameStart: { chance: 1, major: true },
  largeMap: { chance: 1, major: true },
  islands: { chance: 1, major: true },
  fogReveal: { chance: 0.35 },
  otherWins: { chance: 0.8, major: true },
  botWins: { chance: 1, major: true },
  chatHello: { chance: 0.45 },
  chatGg: { chance: 0.45 },
  chatThanks: { chance: 0.45 },
  chatLol: { chance: 0.3 },
  chatName: { chance: 0.7 }
};

/** Slots every event may use. Any of them can still be absent (no leader yet), which skips that variant. */
export const BASE_SLOTS = ['me', 'win', 'limit', 'turn', 'vp', 'vpLeft', 'leader'];

/** Extra slots per event. `res` appears only where the resource is public. */
const EXTRA_SLOTS: Partial<Record<DialogueEvent, string[]>> = {
  discard: ['n'],
  goodRoll: ['sum'],
  noProduction: ['sum'],
  robbedOn: ['name'],
  robberLeader: ['name'],
  robberNumber: ['name', 'number'],
  steal: ['name'],
  robbed: ['name'],
  knight: ['n'],
  monopoly: ['res', 'n'],
  awardWon: ['award'],
  awardLost: ['award', 'name'],
  humanClose: ['name'],
  tradeDecline: ['name'],
  tradeDeclineLeader: ['name'],
  tradeAccept: ['name'],
  tradeCounter: ['name'],
  bankEmpty: ['res'],
  fogReveal: ['number', 'name'],
  otherWins: ['name']
};

export function allowedSlots(event: DialogueEvent): string[] {
  return [...BASE_SLOTS, ...(EXTRA_SLOTS[event] ?? [])];
}

/** Events that can be triggered by hidden information. Their lines are tested for resource words. */
export const PRIVATE_EVENTS: DialogueEvent[] = ['discard', 'steal', 'robbed', 'devBought', 'oneVpLeft'];

/** The busiest events: Main needs a bigger pool here. */
export const FREQUENT_EVENTS: DialogueEvent[] = ['rollSeven', 'tradeDecline', 'city', 'steal', 'robbed'];

export const BOT_CHAT_LEVELS: BotChatLevel[] = ['off', 'quiet', 'normal', 'chatty'];

/** Multiplier on every event's chance. Quiet and Off also turn the chat reactions off (see index.ts). */
export const CHAT_MULT: Record<BotChatLevel, number> = { off: 0, quiet: 0.4, normal: 1, chatty: 1.6 };

/** Parses the host's choice. Anything else keeps the old value. */
export function normalizeBotChat(input: unknown, fallback: BotChatLevel | undefined): BotChatLevel | undefined {
  const s = String(input ?? '').trim().toLowerCase();
  return (BOT_CHAT_LEVELS as string[]).includes(s) ? (s as BotChatLevel) : fallback;
}
