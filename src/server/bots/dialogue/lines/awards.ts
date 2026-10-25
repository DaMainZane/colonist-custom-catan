// MODULE: dialogue lines for awards and the score race | USED BY: bots/dialogue/lines/index
// Overload never telegraphs, so it has no "one point from winning" line. oneVpLeft is risk 'private' (it talks about plans).
import type { Line } from '../types';

export const AWARD_LINES: Line[] = [
  // ---- Bot takes Longest Road or Largest Army ----
  {
    id: 'awardWon.main', event: 'awardWon', style: ['friendly'],
    text: ["The {award} is mine! Catch me if you can.", "{award} secured! Bow before me.", "{award}! Look at me go."]
  },
  {
    id: 'awardWon.secondary', event: 'awardWon', style: ['neutral'],
    text: ["{award}.", "{award} taken.", "{award} secured."]
  },
  {
    id: 'awardWon.overload', event: 'awardWon', style: ['cold'],
    text: ["The {award} is mine. Try to take it.", "{award}. Come and get it.", "The {award} answers to me."]
  },

  // ---- Bot loses an award ({name} = the new holder) ----
  {
    id: 'awardLost.main', event: 'awardLost', style: ['friendly'],
    text: ["Hey, that was mine!", "My {award}! Rude.", "Aw, there goes my {award}."]
  },
  {
    id: 'awardLost.secondary', event: 'awardLost', style: ['neutral'],
    text: ["Noted. I'll take it back.", "Lost the {award}.", "The {award} will return."]
  },
  {
    id: 'awardLost.overload', event: 'awardLost', style: ['cold'],
    text: ["Temporary.", "Borrowed, not lost.", "{name} holds the {award}. For now."]
  },

  // ---- Bot is one VP from winning (vague on purpose) ----
  {
    id: 'oneVpLeft.main', event: 'oneVpLeft', style: ['friendly'], risk: 'private',
    text: ["One more point... nobody look at me.", "Just one more point. Hmm.", "Almost there... shh."]
  },
  {
    id: 'oneVpLeft.secondary', event: 'oneVpLeft', style: ['neutral'], risk: 'private',
    text: ["Close.", "Getting close.", "Almost there."]
  },

  // ---- A human reaches about 70% of the win target ({name}, {vp}, {vpLeft} describe the human) ----
  {
    id: 'humanClose.main', event: 'humanClose', style: ['friendly'],
    text: ["{name} is getting close. Should we do something?", "{name} is at {vp} already! Watch them.", "Careful, {name} is at {vp}. Let's not help."]
  },
  {
    id: 'humanClose.secondary', event: 'humanClose', style: ['neutral'],
    text: ["{name} at {vp}. Watch them.", "{name} is close. {vpLeft} to go.", "{name} at {vp}."]
  },
  {
    id: 'humanClose.overload', event: 'humanClose', style: ['cold'],
    text: ["{name} at {vp}. No more trades with them.", "{name} is close. That ends here.", "{name}: {vp}. Not further."]
  }
];
