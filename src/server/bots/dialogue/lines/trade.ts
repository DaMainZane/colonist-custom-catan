// MODULE: dialogue lines for trading and the bank | DEPENDS ON: server/bots/dialogue/types | USED BY: server/bots/dialogue/lines/index
import type { Line } from '../types';

export const TRADE_LINES: Line[] = [
  // ---- Bot opens an offer ----
  {
    id: 'tradeOffer.main', event: 'tradeOffer', style: ['friendly'],
    text: ["Anyone want to swap? Check my offer!", "Open for trades, folks.", "Offer's up! Who's in?", "Got a trade for you, friends."]
  },
  {
    id: 'tradeOffer.main.portTrader', event: 'tradeOffer', style: ['friendly'], personality: ['portTrader'],
    text: ["Ports love me, but a swap with you is better.", "I could use the bank, but trading is more fun!"]
  },
  {
    id: 'tradeOffer.secondary', event: 'tradeOffer', style: ['neutral'],
    text: ["Offer's up.", "Offer posted.", "Trade open."]
  },
  {
    id: 'tradeOffer.secondary.portTrader', event: 'tradeOffer', style: ['neutral'], personality: ['portTrader'],
    text: ["Trade open. Ports are slower."]
  },
  {
    id: 'tradeOffer.overload', event: 'tradeOffer', style: ['cold'],
    text: ["Take the offer or don't.", "One offer. Take it.", "Offer. Limited time."]
  },

  // ---- Bot declines ({name} = whoever offered) ----
  {
    id: 'tradeDecline.main', event: 'tradeDecline', style: ['friendly'],
    text: [
      "Sorry {name}, can't do that one.",
      "I'd love to, but no.",
      "Hmm, not this time, {name}.",
      "Tempting, but no!",
      "Close, {name}, but no deal."
    ]
  },
  {
    id: 'tradeDecline.secondary', event: 'tradeDecline', style: ['neutral'],
    text: ["No.", "Not worth it.", "Declined.", "{name}, no."]
  },
  {
    id: 'tradeDecline.overload', event: 'tradeDecline', style: ['cold'],
    text: ["Insufficient.", "No.", "Not interested.", "Try again, {name}."]
  },

  // ---- Bot declines the leader ({name}, {vp} describe the leader) ----
  {
    id: 'tradeDeclineLeader.main', event: 'tradeDeclineLeader', style: ['friendly'],
    text: ["You're too close to winning, {name}. No deal!", "Sorry {name}, you're at {vp}. No deal.", "No trades for the leader, {name}!"]
  },
  {
    id: 'tradeDeclineLeader.secondary', event: 'tradeDeclineLeader', style: ['neutral'],
    text: ["{name} is at {vp}. Declined.", "Not with the leader.", "Declined. {vp} VP is too many."]
  },
  {
    id: 'tradeDeclineLeader.overload', event: 'tradeDeclineLeader', style: ['cold'],
    text: ["No trades for the leader.", "{name} leads. No deal.", "The leader trades alone."]
  },

  // ---- Bot accepts ({name} may be missing when the bot confirms a trade) ----
  {
    id: 'tradeAccept.main', event: 'tradeAccept', style: ['friendly'],
    text: ["Deal! Nice doing business.", "Deal, {name}! Pleasure!", "Sold! Nice swap.", "Good trade, pleasure doing business."]
  },
  {
    id: 'tradeAccept.secondary', event: 'tradeAccept', style: ['neutral'],
    text: ["Accepted.", "Deal.", "Fair swap."]
  },
  {
    id: 'tradeAccept.overload', event: 'tradeAccept', style: ['cold'],
    text: ["Acceptable.", "Accepted.", "Deal. For now."]
  },

  // ---- Bot counters ----
  {
    id: 'tradeCounter.main', event: 'tradeCounter', style: ['friendly'],
    text: ["How about this instead?", "Close! What about this, {name}?", "Let's meet in the middle!"]
  },
  {
    id: 'tradeCounter.secondary', event: 'tradeCounter', style: ['neutral'],
    text: ["Counter-offer.", "Countering.", "Counter posted."]
  },
  {
    id: 'tradeCounter.overload', event: 'tradeCounter', style: ['cold'],
    text: ["My terms.", "Counter. Final.", "My terms, {name}."]
  },

  // ---- Nobody answers the bot's offer ----
  {
    id: 'tradeNoTakers.main', event: 'tradeNoTakers', style: ['friendly'],
    text: ["No takers? Rude.", "Nobody? Wow, tough crowd.", "Fine, I'll keep my cards. Sulk."]
  },
  {
    id: 'tradeNoTakers.secondary', event: 'tradeNoTakers', style: ['neutral'],
    text: ["No takers.", "No interest.", "Offer expired."]
  },
  {
    id: 'tradeNoTakers.overload', event: 'tradeNoTakers', style: ['cold'],
    text: ["Your loss.", "No takers. Noted.", "A missed chance."]
  },

  // ---- The bank runs out of a resource (public) ----
  {
    id: 'bankEmpty.main', event: 'bankEmpty', style: ['friendly'],
    text: ["The bank is out of {res}! Now what?", "No more {res} in the bank!", "Bank's dry on {res}. Uh oh."]
  },
  {
    id: 'bankEmpty.secondary', event: 'bankEmpty', style: ['neutral'],
    text: ["Bank is out of {res}.", "No {res} left in the bank.", "{res}: bank empty."]
  },
  {
    id: 'bankEmpty.overload', event: 'bankEmpty', style: ['cold'],
    text: ["The bank has no {res}. Good.", "No {res} left. Adapt.", "The bank is empty of {res}."]
  }
];
