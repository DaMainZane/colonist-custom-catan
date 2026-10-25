// MODULE: dialogue lines for dice results (sevens, discards, good and dry rolls) | USED BY: bots/dialogue/lines/index
// Styles: friendly = Main, neutral = Secondary, cold = Overload. Lines are plain data, see ../types.ts.
import type { Line } from '../types';

export const ROLL_LINES: Line[] = [
  // ---- Bot rolls a 7 ----
  {
    id: 'rollSeven.main', event: 'rollSeven', style: ['friendly'],
    text: [
      "Seven! Sorry, sorry. Robber time.",
      "Oops, a seven. Hide your cards!",
      "Seven! Who looks the richest right now?",
      "Ooh, a seven. Over {limit}? Discard!",
      "A seven! The robber and I are going for a walk."
    ]
  },
  {
    id: 'rollSeven.main.composed', event: 'rollSeven', style: ['friendly'],
    parts: {
      open: ["Seven!", "Aaand a seven.", "Well, well, a seven.", "Oh, a seven."],
      core: ["Robber time.", "The robber is on the move.", "Time to move that robber.", "Sorry, sorry, robber time."],
      close: ["Check your hands.", "Over {limit}? Discard.", "", "Hide your cards!"]
    }
  },
  {
    id: 'rollSeven.main.leader', event: 'rollSeven', style: ['friendly'], when: { self: 'leader' },
    text: ["Seven! Being in front has its perks.", "A seven from the leader. Sorry, not sorry."]
  },
  {
    id: 'rollSeven.main.trailing', event: 'rollSeven', style: ['friendly'], when: { self: 'trailing' },
    text: ["Seven! About time I got lucky.", "A seven! Maybe the robber helps me catch up."]
  },
  {
    id: 'rollSeven.secondary', event: 'rollSeven', style: ['neutral'],
    text: [
      "Seven. Discard if over {limit}.",
      "Robber moves.",
      "Seven.",
      "Seven. The robber is moving.",
      "Seven. Check your hands."
    ]
  },
  {
    id: 'rollSeven.overload', event: 'rollSeven', style: ['cold'],
    text: [
      "Seven. Count your cards.",
      "Some of you are about to lose half a hand.",
      "Seven. The robber answers to me.",
      "Seven. Over {limit}, you pay."
    ]
  },

  // ---- Someone else rolls a 7 and this bot is over the limit (index.ts only picks a bot that is) ----
  {
    id: 'otherSeven.main', event: 'otherSeven', style: ['friendly'],
    text: ["Noooo, not a seven!", "Please be gentle.", "Not a seven, not now!", "I am over {limit}, why a seven?!"]
  },
  {
    id: 'otherSeven.secondary', event: 'otherSeven', style: ['neutral'],
    text: ["Seven. Discarding.", "Seven. That hurts.", "Seven. Unlucky."]
  },
  {
    id: 'otherSeven.overload', event: 'otherSeven', style: ['cold'],
    text: ["Seven. Irrelevant to me.", "Seven. A small tax.", "Seven. Noted."]
  },

  // ---- Bot discards (only the count, never which cards) ----
  {
    id: 'discard.main', event: 'discard', style: ['friendly'], risk: 'private',
    text: ["Ouch, losing {n} cards.", "There go {n} cards. Sigh.", "Discarding {n}. Rude.", "{n} cards, gone. Sniff."]
  },
  {
    id: 'discard.secondary', event: 'discard', style: ['neutral'], risk: 'private',
    text: ["Discarding {n}.", "Down {n} cards.", "{n} discarded."]
  },
  {
    id: 'discard.overload', event: 'discard', style: ['cold'], risk: 'private',
    text: ["Discarding {n}. Acceptable.", "{n}. A fair price.", "Discarded. Moving on."]
  },

  // ---- A 6 or 8 rolled and this bot produced ----
  {
    id: 'goodRoll.main', event: 'goodRoll', style: ['friendly'],
    text: ["A {sum}! Finally some action.", "Yes! Production!", "{sum}! That is what I wanted!", "Ooh, a good one!"]
  },
  {
    id: 'goodRoll.secondary', event: 'goodRoll', style: ['neutral'],
    text: ["Good roll.", "Production.", "{sum}. Useful."]
  },

  // ---- A 6 or 8 rolled and this bot produced nothing ----
  {
    id: 'noProduction.main', event: 'noProduction', style: ['friendly'],
    text: ["Nothing for me. Classic.", "Not a single card. Rude.", "Nothing on a {sum}? Really?"]
  },
  {
    id: 'noProduction.secondary', event: 'noProduction', style: ['neutral'],
    text: ["No production.", "Nothing.", "Dry roll."]
  }
];
