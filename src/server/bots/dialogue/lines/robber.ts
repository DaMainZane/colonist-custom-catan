// MODULE: dialogue lines for the robber (moved onto a bot, placed by a bot) and steals | DEPENDS ON: server/bots/dialogue/types | USED BY: server/bots/dialogue/lines/index
// Steal and robbed lines are risk 'private': they never name a card, because chat is public.
import type { Line } from '../types';

export const ROBBER_LINES: Line[] = [
  // ---- Robber moved onto a tile this bot is on ({name} = whoever moved it) ----
  {
    id: 'robbedOn.main', event: 'robbedOn', style: ['friendly'],
    text: ["Hey! Not my tile!", "Why me? Go rob the leader!", "Aw, that is my tile!", "Really? My tile?"]
  },
  {
    id: 'robbedOn.main.leader', event: 'robbedOn', style: ['friendly'], when: { self: 'leader' },
    text: ["Of course the robber comes for the leader.", "Being in front gets you noticed, huh."]
  },
  {
    id: 'robbedOn.secondary', event: 'robbedOn', style: ['neutral'],
    text: ["Noted.", "My tile. Noted.", "Robber on my tile."]
  },
  {
    id: 'robbedOn.overload', event: 'robbedOn', style: ['cold'],
    text: ["A mistake.", "Bold.", "You chose poorly."]
  },

  // ---- Bot puts the robber on the leader ({name} = the leader) ----
  {
    id: 'robberLeader.main', event: 'robberLeader', style: ['friendly'],
    text: ["Sorry {name}, you are in the lead.", "Nothing personal, {name}. You are ahead!", "{name} leads, so... robber time."]
  },
  {
    id: 'robberLeader.secondary', event: 'robberLeader', style: ['neutral'],
    text: ["Robber to {name}. They lead.", "{name} is leading. Robber moves.", "Robber on {name}."]
  },
  {
    id: 'robberLeader.overload', event: 'robberLeader', style: ['cold'],
    text: ["{name} leads. The robber agrees.", "The leader pays.", "{name} first."]
  },

  // ---- Bot puts the robber on a number ----
  {
    id: 'robberNumber.main', event: 'robberNumber', style: ['friendly'],
    text: ["Blocking your {number}, {name}!", "Your {number} takes a break, {name}.", "Sit that {number} out, {name}!"]
  },
  {
    id: 'robberNumber.secondary', event: 'robberNumber', style: ['neutral'],
    text: ["Robber on the {number}.", "Blocking the {number}.", "{number} blocked."]
  },
  {
    id: 'robberNumber.overload', event: 'robberNumber', style: ['cold'],
    text: ["Your {number} is mine now.", "The {number} is closed.", "{number}: shut."]
  },

  // ---- Bot steals (no card named) ----
  {
    id: 'steal.main', event: 'steal', style: ['friendly'], risk: 'private',
    text: [
      "Thanks for the card!",
      "Ooh, what did I get?",
      "Just borrowing this, {name}. Promise.",
      "Thanks, {name}!",
      "A little something for me!"
    ]
  },
  {
    id: 'steal.secondary', event: 'steal', style: ['neutral'], risk: 'private',
    text: ["One card. Thanks.", "Taking one.", "One card from {name}."]
  },
  {
    id: 'steal.overload', event: 'steal', style: ['cold'], risk: 'private',
    text: ["Yours now.", "Predictable.", "You made this easy.", "{name} paid up."]
  },

  // ---- Bot is robbed (no card named) ----
  {
    id: 'robbed.main', event: 'robbed', style: ['friendly'], risk: 'private',
    text: [
      "Hey! That was mine!",
      "Not me again!",
      "Seriously, {name}?!",
      "Rude! Rob the leader, not me!",
      "Hands off, {name}!"
    ]
  },
  {
    id: 'robbed.secondary', event: 'robbed', style: ['neutral'], risk: 'private',
    text: ["That was a choice.", "Noted.", "{name} chose me. Noted.", "That hurt."]
  },
  {
    id: 'robbed.overload', event: 'robbed', style: ['cold'], risk: 'private',
    text: ["You will regret it.", "A mistake, {name}.", "That was a mistake.", "Unwise."]
  }
];
