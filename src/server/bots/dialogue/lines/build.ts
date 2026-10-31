// MODULE: dialogue lines for building and development cards | DEPENDS ON: server/bots/dialogue/types | USED BY: server/bots/dialogue/lines/index
// Dev card purchases are risk 'private' (the card type is never named). Monopoly may name the resource: it is public.
import type { Line } from '../types';

export const BUILD_LINES: Line[] = [
  // ---- City ----
  {
    id: 'city.main', event: 'city', style: ['friendly'],
    text: [
      "City time! Double the fun.",
      "Look at me go!",
      "Another metropolis online!",
      "Double production starts now.",
      "City upgrade! Fancy."
    ]
  },
  {
    id: 'city.main.builder', event: 'city', style: ['friendly'], personality: ['builder'],
    text: ["Builders gonna build!", "I really do love a good city."]
  },
  {
    id: 'city.secondary', event: 'city', style: ['neutral'],
    text: ["City built.", "Upgraded.", "City.", "Production doubled."]
  },
  {
    id: 'city.overload', event: 'city', style: ['cold'],
    text: ["Production doubles. Yours will not.", "Expansion continues.", "Upgraded. Efficient.", "City. Next."]
  },

  // ---- Settlement (after the opening placements) ----
  {
    id: 'settlement.main', event: 'settlement', style: ['friendly'],
    text: ["New settlement! Hello, neighbors.", "A new home!", "Settled in!", "New spot, new luck."]
  },
  {
    id: 'settlement.main.builder', event: 'settlement', style: ['friendly'], personality: ['builder'],
    text: ["Another one for the collection!", "Home sweet home, again."]
  },
  {
    id: 'settlement.secondary', event: 'settlement', style: ['neutral'],
    text: ["Settled.", "Settlement.", "Another settlement."]
  },
  {
    id: 'settlement.overload', event: 'settlement', style: ['cold'],
    text: ["Claimed.", "Taken.", "That spot is mine."]
  },

  // ---- Road (low chance) ----
  {
    id: 'road.main', event: 'road', style: ['friendly'],
    text: ["Paving the way!", "Roads, roads, roads.", "Ooh, a fresh road."]
  },
  {
    id: 'road.main.roadHog', event: 'road', style: ['friendly'], personality: ['roadHog'],
    text: ["Nobody builds roads like me!", "More road! There is always room for more road."]
  },
  {
    id: 'road.secondary', event: 'road', style: ['neutral'],
    text: ["Road.", "Road laid.", "Another road."]
  },
  {
    id: 'road.overload', event: 'road', style: ['cold'],
    text: ["That path is mine now.", "Roads belong to me.", "The way is mine."]
  },
  {
    id: 'road.overload.roadHog', event: 'road', style: ['cold'], personality: ['roadHog'],
    text: ["Every road leads through me."]
  },

  // ---- Development card bought (the type is never named) ----
  {
    id: 'devBought.main', event: 'devBought', style: ['friendly'], risk: 'private',
    text: [
      "Let's see what the deck gives me...",
      "A mystery card! Exciting.",
      "Ooh, a new card.",
      "What did I get? Time will tell!"
    ]
  },
  {
    id: 'devBought.main.devRusher', event: 'devBought', style: ['friendly'], personality: ['devRusher'], risk: 'private',
    text: ["More cards, please!", "I just cannot resist that deck."]
  },
  {
    id: 'devBought.secondary', event: 'devBought', style: ['neutral'], risk: 'private',
    text: ["Development card.", "Card drawn.", "Dev card."]
  },
  {
    id: 'devBought.overload', event: 'devBought', style: ['cold'], risk: 'private',
    text: ["Card drawn.", "Another card.", "The deck pays me."]
  },
  {
    id: 'devBought.overload.devRusher', event: 'devBought', style: ['cold'], personality: ['devRusher'], risk: 'private',
    text: ["The deck is mine."]
  },

  // ---- Knight played ({n} = knights played so far, which is public) ----
  {
    id: 'knight.main', event: 'knight', style: ['friendly'],
    text: [
      "Knight reporting for duty! Robber, off you go.",
      "Marching the army out!",
      "Get off my tile, robber.",
      "Another Knight for the collection.",
      "Knight number {n}!"
    ]
  },
  {
    id: 'knight.secondary', event: 'knight', style: ['neutral'],
    text: ["Knight played.", "Robber moves.", "Knight."]
  },
  {
    id: 'knight.overload', event: 'knight', style: ['cold'],
    text: ["The robber moves where I say.", "Knight. Obey.", "The army answers me."]
  },

  // ---- Monopoly (the resource is public: everyone sees what moved) ----
  {
    id: 'monopoly.main', event: 'monopoly', style: ['friendly'],
    text: [
      "Monopoly on {res}! Hand it over, friends.",
      "All your {res} belong to me now!",
      "Monopoly! {res}, please!",
      "Hand it ALL over! Monopoly time!"
    ]
  },
  {
    id: 'monopoly.secondary', event: 'monopoly', style: ['neutral'],
    text: ["Monopoly: {res}.", "Collecting {res}.", "Monopoly."]
  },
  {
    id: 'monopoly.overload', event: 'monopoly', style: ['cold'],
    text: ["All the {res} was already mine.", "Hand over the {res}.", "Hand it over."]
  },

  // ---- Year of Plenty ----
  {
    id: 'yearOfPlenty.main', event: 'yearOfPlenty', style: ['friendly'],
    text: ["Free cards from the bank. Don't mind if I do!", "Year of Plenty! Thank you, bank!", "The bank is generous today."]
  },
  {
    id: 'yearOfPlenty.secondary', event: 'yearOfPlenty', style: ['neutral'],
    text: ["Year of Plenty.", "Two from the bank.", "Plenty."]
  },
  {
    id: 'yearOfPlenty.overload', event: 'yearOfPlenty', style: ['cold'],
    text: ["The bank's loss.", "Free of charge.", "The bank pays."]
  },

  // ---- Road Building ----
  {
    id: 'roadBuilding.main', event: 'roadBuilding', style: ['friendly'],
    text: ["Two roads on the house!", "Free roads! Don't mind if I do.", "Road Building! Look at that."]
  },
  {
    id: 'roadBuilding.secondary', event: 'roadBuilding', style: ['neutral'],
    text: ["Two roads.", "Road Building.", "Free roads."]
  },
  {
    id: 'roadBuilding.overload', event: 'roadBuilding', style: ['cold'],
    text: ["Expansion, free of charge.", "Two roads.", "Free roads. Efficient."]
  }
];
