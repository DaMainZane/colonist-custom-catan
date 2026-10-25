# Bot Dialogue Design

Brainstorm for bot table talk. **Scope for now: general lines only.** Nothing here remembers past events or past games. A nemesis system (needs accounts, or a local match-to-match version) comes later, and this doc gets a second pass then. Status: implemented (see `change log.md`, Pass 7). Not yet run: typecheck and tests. The "human's turn timer is low" line is the one planned trigger not built.

## 1. What is wrong today

`src/server/bots/dialogue.ts` has 10 events and 3 to 4 fixed lines each (Main) or 2 to 3 (Secondary, Overload). Problems:

- **Leaks.** "My brick!" names the stolen card to the whole table. Chat is public, so a line may only say what everyone can already see.
- **Hard-coded numbers.** "Nobody is safe with 8+ cards" ignores the discard limit setting.
- **No variables.** A line never knows the dice sum, VP, the leader, the turn or the map.
- **Few triggers.** Nothing for trades declined, fog, a bank running dry, the start of the game, or a human close to winning.
- **Repeats.** Random pick with no memory, so the same line comes up twice in a row.

## 2. Leak rules (the most important part)

Chat reaches every player, so a line is built from **public information only**, even for Overload, which reads hands.

| Public (may be used) | Private (never used) |
|---|---|
| dice result, which tiles produced, robber position | the card a bot stole or lost |
| pieces on the board, bank counts | what is in any hand, including the bot's own |
| card counts per player, VP shown to others | which dev card a bot bought or holds, hidden VP cards |
| awards, knights played, longest road length | what the bot is saving for or lacks |
| an open trade offer and the resources in it | anything the brain knows only through `info: full` |
| the resource named by Monopoly, amounts that moved in it | whether a bot "knows" a fog tile before it is revealed |

Enforced in code, not by care:

1. Lines are filled from a `DialogueCtx` object built from the public view. Hidden fields are not on it, so a template cannot reference them.
2. Steal lines never get a resource slot.
3. A test scans every line of every private-risk event for resource words (wood, brick, sheep, wheat, ore, lumber, grain, and so on) and fails the build if one appears.
4. Overload never hints that it knows something ("as suspected", "I knew it").

## 3. Variables (current state only)

| Slot | Meaning | Example use |
|---|---|---|
| `{me}` | this bot's name | rare, for taunts |
| `{name}` | the other player in the event | "GG {name}." |
| `{leader}` | whoever leads right now | robber goes to the leader |
| `{vp}`, `{vpLeft}` | VP of the subject, and VP to go | "{name} is at {vp}." |
| `{win}` | VP to win | "First to {win}." |
| `{limit}` | discard limit setting | "Over {limit}? Discard." |
| `{n}` | a count (cards discarded, knights, road length) | "Losing {n} cards." |
| `{sum}` | dice sum | "A {sum}!" |
| `{number}` | number token of a tile | "Blocking your {number}." |
| `{res}` | a resource, **only for public events** (offer, Monopoly, bank empty, fog reveal) | "Monopoly on {res}." |
| `{turn}` | turn number | "Turn {turn} and still no city." |
| `{award}` | Longest Road or Largest Army | "The {award} is mine." |

Conditions (a line is only eligible when its conditions hold): bot is leader or trailing by 2 or more, bot is within 2 VP of winning, bot is over or under the discard limit, the other player is the leader or a newcomer at 3 VP or less, map traits (large radius, islands, fog, gold, small bank), game speed, tier, personality.

## 4. Voices

| Tier | Voice | Habits |
|---|---|---|
| Main | friendly, chatty, human | exclamation marks, small self-own, openly pleased or annoyed, vague about plans |
| Secondary | neutral, dry | short, often one word, factual, occasional understatement |
| Overload | cold, clipped | taunts the move and never the person, never explains, never telegraphs |

Personality overlay (builder, road hog, port trader, dev rusher): adds extra lines on build, trade and dev-card events and raises their weight, so two Main bots do not sound identical. Taunts target moves, not people: no slurs, no insults about anything outside the game.

## 5. Events and sample lines

Samples show voice and slots, not the final count. Targets are at the end of this section.

### Dice and robber

| Event | Main | Secondary | Overload |
|---|---|---|---|
| Bot rolls a 7 | "Seven! Sorry, sorry. Robber time." / "Oops, a seven. Hide your cards!" | "Seven. Discard if over {limit}." / "Robber moves." | "Seven. Count your cards." / "Some of you are about to lose half a hand." |
| Someone else rolls a 7 (bot over the limit) | "Noooo, not a seven!" / "Please be gentle." | "Seven. Discarding." | "Seven. Irrelevant to me." |
| Bot discards | "Ouch, losing {n} cards." | "Discarding {n}." | "Discarding {n}. Acceptable." |
| 6 or 8 rolled and the bot produced | "A {sum}! Finally some action." / "Yes! Production!" | "Good roll." | (silent) |
| Bot produced nothing on a 6 or 8 | "Nothing for me. Classic." | "No production." | (silent) |
| Robber moved onto the bot | "Hey! Not my tile!" / "Why me? Go rob the leader!" | "Noted." | "A mistake." |
| Robber placed by the bot on the leader | "Sorry {name}, you're in the lead." | "Robber to {name}. They lead." | "{name} leads. The robber agrees." |
| Robber placed on a number | "Blocking your {number}, {name}!" | "Robber on the {number}." | "Your {number} is mine now." |
| Bot steals (no card named) | "Thanks for the card!" / "Ooh, what did I get?" | "One card. Thanks." | "Yours now." / "Predictable." |
| Bot is robbed (no card named) | "Hey! That was mine!" / "Not me again!" | "That was a choice." | "You will regret it." |

### Building and cards

| Event | Main | Secondary | Overload |
|---|---|---|---|
| City | "City time! Double the fun." / "Look at me go!" | "City built." / "Upgraded." | "Production doubles. Yours will not." |
| Settlement | "New settlement! Hello, neighbors." | "Settled." | "Claimed." |
| Road (low chance) | "Paving the way!" | "Road." | "That path is mine now." |
| Dev card bought (type never named) | "Let's see what the deck gives me..." | "Development card." | "Card drawn." |
| Knight played | "Knight reporting for duty! Robber, off you go." | "Knight played." | "The robber moves where I say." |
| Monopoly (resource is public) | "Monopoly on {res}! Hand it over, friends." | "Monopoly: {res}." | "All the {res} was already mine." |
| Year of Plenty | "Free cards from the bank. Don't mind if I do!" | "Year of Plenty." | "The bank's loss." |
| Road Building | "Two roads on the house!" | "Two roads." | "Expansion, free of charge." |

### Awards and score

| Event | Main | Secondary | Overload |
|---|---|---|---|
| Bot takes Longest Road or Largest Army | "The {award} is mine! Catch me if you can." | "{award}." | "The {award} is mine. Try to take it." |
| Bot loses an award | "Hey, that was mine!" | "Noted. I'll take it back." | "Temporary." |
| Bot is one VP from winning | "One more point... nobody look at me." | "Close." | (silent, never telegraphs) |
| A human reaches about 70% of the win target | "{name} is getting close. Should we do something?" | "{name} at {vp}. Watch them." | "{name} at {vp}. No more trades with them." |

### Trading

| Event | Main | Secondary | Overload |
|---|---|---|---|
| Bot opens an offer | "Anyone want to swap? Check my offer!" / "Open for trades, folks." | "Offer's up." | "Take the offer or don't." |
| Bot declines | "Sorry {name}, can't do that one." / "I'd love to, but no." | "No." / "Not worth it." | "Insufficient." |
| Bot declines the leader | "You're too close to winning, {name}. No deal!" | "{name} is at {vp}. Declined." | "No trades for the leader." |
| Bot accepts | "Deal! Nice doing business." | "Accepted." | "Acceptable." |
| Bot counters | "How about this instead?" | "Counter-offer." | "My terms." |
| Nobody answers the bot's offer | "No takers? Rude." | "No takers." | "Your loss." |
| Main's visible mistake (pointless bank swap) | "Hmm, that swap was probably silly. Oh well." | n/a | n/a |
| Bank runs out of a resource (public) | "The bank is out of {res}! Now what?" | "Bank is out of {res}." | "The bank has no {res}. Good." |

### Map and table

| Event | Main | Secondary | Overload |
|---|---|---|---|
| Game starts | "Good luck everyone! May the dice be kind." | "Good luck." | "Begin." |
| Large map | "Wow, this map is huge!" | "Large board." | "More ground to take." |
| Islands | "So much water. Where do I put my roads?" | "Limited land." | "Land is the resource." |
| Fog tile revealed | "Ooh, the fog is lifting!" | "Tile revealed." | "Revealed." |
| Human's turn timer is low (rare) | "No rush... okay, a little rush." | "Clock's running." | "Time." |
| Someone else wins | "GG {name}! That was fun." | "GG {name}." | "Well played, {name}. Briefly." |
| Bot wins | "GG! That went better than I planned." | "Game over." | "As calculated." |

### Chat reactions (optional module)

Short replies to words in human chat: greetings ("hi", "hello"), "gg", "thanks", "lol", mentions of the bot's name. Lowest priority, heavily rate limited, and never answers anything about the game state.

## 6. How a line is built

### Variation inside one line

Three tools, so one event does not mean one sentence:

1. **Variants.** Each line id holds several full texts, each a separate candidate.
2. **Alternation in a text.** `{Oh|Ah|Well}, a seven.` picks one option per use.
3. **Composed lines** for the busiest events (7 rolled, trade declined, city built): opener + core + closer, each from its own pool, tagged so they fit together. Example for "bot rolls a 7":
   - openers: "Seven!", "Aaand a seven.", "Well, well, a seven."
   - cores: "Robber time.", "The robber is on the move.", "Time to move that robber."
   - closers: "Check your hands.", "Over {limit}? Discard.", (none)
   - 3 x 3 x 3 = 27 combinations from 9 short strings.

### Data shape

```ts
interface Line {
  id: string;
  event: DialogueEvent;
  style?: ('friendly' | 'neutral' | 'cold')[];   // omitted = any
  personality?: Personality[];
  when?: { self?: 'leader' | 'trailing'; vpLeftAtMost?: number; map?: 'large' | 'islands' | 'fog' | 'gold'; overLimit?: boolean };
  text: string | string[];                          // variants, each may use {slots} and {a|b} alternation
  weight?: number;
  risk?: 'private';                                 // tested for resource words
}
```

Conditions are plain data (no functions), so lines are easy to read, edit and test.

### Picking

1. Filter lines by event, style, personality and conditions.
2. Weighted random pick. Personality lines get a boost.
3. Skip anything used by this bot in the last 8 lines, or by the room in the last 12. If everything is blocked, take the oldest.
4. Fill slots from `DialogueCtx`. If a slot has no value, drop that variant instead of printing `{name}`.
5. Rate limit (below), then post.

### Chattiness and spam control

- Lobby setting **Bot chat: Off / Quiet / Normal / Chatty** (default Normal), host only. Scales every event's chance (0, 0.4, 1, 1.6).
- Per-event chance (7 rolled about 55%, road about 8%, city about 50%) and per-bot cooldown.
- Room minimum gap (today 2.2 s). Major events (win, awards, Monopoly) bypass it.
- At high game speed the chance is divided by max(1, speed / 2), so an 8x game does not flood the chat.
- Lines are at most 120 characters, the same cap the server puts on human chat.

## 7. Files

```
src/server/bots/dialogue/
  index.ts       emitBotDialogue(room, actorId, actionType, events)  (same signature, game.ts unchanged)
  context.ts     builds DialogueCtx from public data only
  engine.ts      filter, weighted pick, repeat memory, slot fill, rate limit
  lines/         data: roll.ts, robber.ts, build.ts, trade.ts, awards.ts, table.ts
tests/dialogue.test.ts
```

`src/server/bots/dialogue.ts` becomes a re-export or is removed.

### Hooks that exist now

`game.ts` calls `emitBotDialogue` after every successful action with the engine events. Events already used: `rolled`, `transferred`, `devPlayed`, `awardChanged`, `built`, `gameOver`.

### Hooks to confirm or add during implementation

- Trade responses (declined, accepted, expired). Check whether the engine emits an event, else derive from state.
- Game start and first turn (`turnStarted`).
- Bank reaching zero (derive from state after a transfer).
- Fog reveal event.
- Human turn timer low (`turnClock.ts`).
- Chat reactions (a hook in the `sendChat` handler).
- Robber placed on a number: the `robberMoved` event plus the hex number.

## 8. Tests

- Every `{slot}` in a line is one the event provides.
- No unfilled `{...}` in any output across many seeded runs.
- No resource words in any `risk: 'private'` line (steals, discards, hand-size remarks, bot plans).
- Every event has at least the minimum number of variants per style.
- No duplicate texts, no line over 120 characters.
- The repeat memory never returns the same line twice within its window when alternatives exist.
- Chat setting Off produces no bot chat.

## 9. Size target

| Group | Events | Variants per event per tier | Approx. total |
|---|---|---|---|
| Frequent (7, trade decline, city, steal, robbed) | 8 | 8 to 12 (composed lines count their combinations) | ~250 |
| Common (build, dev, awards, trade accept, counter, offer) | 14 | 5 to 6 | ~230 |
| Rare (map, fog, bank, timer, game start and end) | 10 | 3 to 4 | ~100 |
| Chat reactions | 6 | 3 | ~50 |

Roughly 600 lines to write, most of it short. Overload gets fewer lines than Main on purpose: it says less.

## 10. Decisions

| Question | Default |
|---|---|
| Name players in lines? | Yes, for current-state facts only ("{name} is at {vp}", "{leader} leads"). Nothing about what they did earlier. |
| May Main hint at plans in vague terms ("one more point")? | Yes for Main and Secondary. Overload never telegraphs. |
| Chat reactions to human chat? | Include, off in Quiet mode. |
| Languages | English only for now. Lines are data, so a locale file could be added later. |

## 11. Not in this round (needs memory or accounts)

- Callbacks to earlier events this game ("you robbed me twice", comeback commentary, streaks).
- Nemesis and rivalry lines, match-to-match or account-based.
- Lines that depend on who a bot played before.
- Anything that needs per-player history.

The schema leaves room: a line could carry a `needs: 'history'` tag that the selector skips until a history source exists.
