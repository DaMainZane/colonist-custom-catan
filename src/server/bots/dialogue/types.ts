// MODULE: bot dialogue types (events, line data shape, public context) | USED BY: bots/dialogue/*, server/types
import type { ChatStyle, Personality } from '../tiers';

/** Host setting that scales how often bots talk. */
export type BotChatLevel = 'off' | 'quiet' | 'normal' | 'chatty';

export type DialogueEvent =
  // dice and robber
  | 'rollSeven' | 'otherSeven' | 'discard' | 'goodRoll' | 'noProduction'
  | 'robbedOn' | 'robberLeader' | 'robberNumber' | 'steal' | 'robbed'
  // building and cards
  | 'city' | 'settlement' | 'road' | 'devBought' | 'knight' | 'monopoly' | 'yearOfPlenty' | 'roadBuilding'
  // awards and score
  | 'awardWon' | 'awardLost' | 'oneVpLeft' | 'humanClose'
  // trading
  | 'tradeOffer' | 'tradeDecline' | 'tradeDeclineLeader' | 'tradeAccept' | 'tradeCounter' | 'tradeNoTakers' | 'bankEmpty'
  // map and table
  | 'gameStart' | 'largeMap' | 'islands' | 'fogReveal' | 'otherWins' | 'botWins'
  // replies to human chat
  | 'chatHello' | 'chatGg' | 'chatThanks' | 'chatLol' | 'chatName';

export type MapTrait = 'large' | 'islands' | 'fog' | 'gold';

/** Plain-data conditions: a line is only eligible when all of them hold. */
export interface LineWhen {
  /** The speaker leads (strictly more public VP than anyone) or trails the leader by 2 or more. */
  self?: 'leader' | 'trailing';
  /** The speaker is at most this many VP from winning. */
  vpLeftAtMost?: number;
  map?: MapTrait;
  /** The speaker holds more cards than the discard limit (a count everyone can see). */
  overLimit?: boolean;
  /** The other player in the event is the leader, or a newcomer at 3 VP or less. */
  other?: 'leader' | 'newcomer';
}

/** Opener + core + closer, each from its own pool. Empty strings in `close` mean "no closer". */
export interface LineParts {
  open?: string[];
  core: string[];
  close?: string[];
}

export interface Line {
  /** Unique and stable: the repeat memory remembers `id#variantIndex`. */
  id: string;
  event: DialogueEvent;
  /** Omitted = any style. */
  style?: ChatStyle[];
  personality?: Personality[];
  when?: LineWhen;
  /** Variants, each a separate candidate. May use {slots} and {a|b} alternation. */
  text?: string | string[];
  parts?: LineParts;
  weight?: number;
  /** Event can come from hidden information (steals, discards, plans): tests scan these for resource words. */
  risk?: 'private';
}

export interface DialogueFacts {
  selfRank: 'leader' | 'trailing' | 'middle';
  selfVpLeft: number;
  overLimit: boolean;
  otherLeader: boolean;
  otherNewcomer: boolean;
  traits: MapTrait[];
}

/** Everything a line can be filled from. Built from public information only (see context.ts). */
export interface DialogueCtx {
  /** Slot name -> value. A slot with no value is simply absent, and variants that use it are skipped. */
  slots: Record<string, string | number>;
  facts: DialogueFacts;
}
