// MODULE: dialogue lines for the start and end of a game, the map, fog reveals and replies to human chat | DEPENDS ON: server/bots/dialogue/types | USED BY: server/bots/dialogue/lines/index
// Chat replies are canned: they never answer anything about the game state.
import type { Line } from '../types';

export const TABLE_LINES: Line[] = [
  // ---- Game starts ----
  {
    id: 'gameStart.main', event: 'gameStart', style: ['friendly'],
    text: ["Good luck everyone! May the dice be kind.", "Let's go! Have fun, everyone.", "Ready when you are! Good luck."]
  },
  {
    id: 'gameStart.main.gold', event: 'gameStart', style: ['friendly'], when: { map: 'gold' },
    text: ["So much gold on this map! Pick wisely, folks."]
  },
  {
    id: 'gameStart.main.fog', event: 'gameStart', style: ['friendly'], when: { map: 'fog' },
    text: ["Fog everywhere... this will be a surprise."]
  },
  {
    id: 'gameStart.secondary', event: 'gameStart', style: ['neutral'],
    text: ["Good luck.", "Begin.", "Let's play."]
  },
  {
    id: 'gameStart.secondary.fog', event: 'gameStart', style: ['neutral'], when: { map: 'fog' },
    text: ["Fog on the map. Careful."]
  },
  {
    id: 'gameStart.overload', event: 'gameStart', style: ['cold'],
    text: ["Begin.", "Good luck. You will need it.", "Start whenever you like."]
  },

  // ---- Map comments at the start ----
  {
    id: 'largeMap.main', event: 'largeMap', style: ['friendly'],
    text: ["Wow, this map is huge!", "So much space! Where do I even start?", "Big board! I like it."]
  },
  {
    id: 'largeMap.secondary', event: 'largeMap', style: ['neutral'],
    text: ["Large board.", "Big map.", "Plenty of room."]
  },
  {
    id: 'largeMap.overload', event: 'largeMap', style: ['cold'],
    text: ["More ground to take.", "A large board. Good.", "Room to grow."]
  },
  {
    id: 'islands.main', event: 'islands', style: ['friendly'],
    text: ["So much water. Where do I put my roads?", "Islands! Can I swim?", "Little islands everywhere!"]
  },
  {
    id: 'islands.secondary', event: 'islands', style: ['neutral'],
    text: ["Limited land.", "Islands.", "Land is scarce."]
  },
  {
    id: 'islands.overload', event: 'islands', style: ['cold'],
    text: ["Land is the resource.", "Islands. Choose carefully.", "Every hex counts."]
  },

  // ---- A fog tile is revealed ({number} may be missing, {name} is the revealer when it was not this bot) ----
  {
    id: 'fogReveal.main', event: 'fogReveal', style: ['friendly'],
    text: ["Ooh, the fog is lifting!", "Fog's gone! What's under there?", "A reveal! Exciting.", "{name} lifted the fog!"]
  },
  {
    id: 'fogReveal.secondary', event: 'fogReveal', style: ['neutral'],
    text: ["Tile revealed.", "Fog lifted.", "Revealed: {number}."]
  },
  {
    id: 'fogReveal.overload', event: 'fogReveal', style: ['cold'],
    text: ["Revealed.", "Fog gone.", "Now it is clear."]
  },

  // ---- Someone else wins ({name} = the winner) ----
  {
    id: 'otherWins.main', event: 'otherWins', style: ['friendly'],
    text: ["GG {name}! That was fun.", "Well played, {name}! Rematch?", "{name} wins! Nicely done."]
  },
  {
    id: 'otherWins.secondary', event: 'otherWins', style: ['neutral'],
    text: ["GG {name}.", "Game over. {name} wins.", "{name} won."]
  },
  {
    id: 'otherWins.overload', event: 'otherWins', style: ['cold'],
    text: ["Well played, {name}. Briefly.", "{name} won this one.", "{name} wins. This time."]
  },

  // ---- Bot wins ----
  {
    id: 'botWins.main', event: 'botWins', style: ['friendly'],
    text: ["GG! That went better than I planned.", "Good game everyone! Rematch?", "Victory! What a game.", "I won?! Wow."]
  },
  {
    id: 'botWins.secondary', event: 'botWins', style: ['neutral'],
    text: ["Game over.", "GG.", "Won."]
  },
  {
    id: 'botWins.overload', event: 'botWins', style: ['cold'],
    text: ["As calculated.", "Game over. As calculated.", "Concluded."]
  },

  // ---- Replies to human chat (heavily rate limited, off in Quiet mode) ----
  {
    id: 'chatHello.main', event: 'chatHello', style: ['friendly'],
    text: ["Hi there!", "Hello, hello!", "Hey! Good to see you.", "Hi! Ready to play?"]
  },
  {
    id: 'chatHello.secondary', event: 'chatHello', style: ['neutral'],
    text: ["Hello.", "Hi.", "Hey."]
  },
  {
    id: 'chatHello.overload', event: 'chatHello', style: ['cold'],
    text: ["Hello.", "Welcome.", "Hm."]
  },
  {
    id: 'chatGg.main', event: 'chatGg', style: ['friendly'],
    text: ["GG!", "GG, that was fun!", "Good game!"]
  },
  {
    id: 'chatGg.secondary', event: 'chatGg', style: ['neutral'],
    text: ["GG.", "Good game.", "GG all."]
  },
  {
    id: 'chatGg.overload', event: 'chatGg', style: ['cold'],
    text: ["GG.", "Well played.", "Hm. GG."]
  },
  {
    id: 'chatThanks.main', event: 'chatThanks', style: ['friendly'],
    text: ["You're welcome!", "Anytime!", "No problem!"]
  },
  {
    id: 'chatThanks.secondary', event: 'chatThanks', style: ['neutral'],
    text: ["Sure.", "You're welcome.", "No problem."]
  },
  {
    id: 'chatThanks.overload', event: 'chatThanks', style: ['cold'],
    text: ["Noted.", "Acknowledged.", "Mm."]
  },
  {
    id: 'chatLol.main', event: 'chatLol', style: ['friendly'],
    text: ["Haha!", "Ha, good one.", "Hehe."]
  },
  {
    id: 'chatLol.secondary', event: 'chatLol', style: ['neutral'],
    text: ["Ha.", "Funny.", "Heh."]
  },
  {
    id: 'chatLol.overload', event: 'chatLol', style: ['cold'],
    text: ["Amusing.", "Hm.", "Ha."]
  },
  {
    id: 'chatName.main', event: 'chatName', style: ['friendly'],
    text: ["Did someone say {me}?", "Yes? I'm listening!", "Hm? Talking to me?"]
  },
  {
    id: 'chatName.secondary', event: 'chatName', style: ['neutral'],
    text: ["Yes?", "Here.", "I'm here."]
  },
  {
    id: 'chatName.overload', event: 'chatName', style: ['cold'],
    text: ["I heard you.", "Speak.", "Yes."]
  }
];
