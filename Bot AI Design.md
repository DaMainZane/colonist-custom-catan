# Bot AI Design

Design notes for bot difficulty tiers, map-aware play and the bot addon system. Written during Step 2f/2g. Nothing here is implemented yet except where marked.

## 1. Goals

- Three difficulty tiers named **Main / Secondary / Overload** (GTFO-style), scaling up from a "normal-ish" Main.
- **Main sits a little below the current "ADVANCED HARD" bot.** Hard becomes the baseline: Main = Hard with deliberate flaws, Secondary = Hard plus upgrades, Overload = Secondary plus information and coordination edges.
- Bots must hold up across map variation: big boards (radius up to ~20), weird shapes and islands, fog, gold.
- New game elements (packs) must be able to extend or override bot behavior through addon files, without addons needing to know about each other.

## 2. Difficulty tiers

All numbers are starting guesses. The bot-vs-bot sims tune them.

### Skill and planning

| Variable | What it does | Main | Secondary | Overload |
|---|---|---|---|---|
| `placementNoise` | Random jitter added to spot scores | 3.0 | 1.0 | 0 |
| `blunderChance` | Picks the 2nd or 3rd best option instead of the best | 12% | 4% | 0% |
| `lookahead` | Turns planned ahead | 0 (greedy) | 1 (next build) | 3 |
| `setupPlanning` | Opening placement | Spot score only | 2nd settlement fills gaps and ports | Plans both settlements together, with a port plan |
| `roadPlanning` | Where roads go | Nearest decent spot | Best spot within 2 roads | Also cuts off contested spots |
| `spendDiscipline` | Cards held before a 7 can hit | Hoards up to the discard limit | Spends at limit minus 1 | Spends at limit minus 2, weighs 7 odds |

### Table play

| Variable | What it does | Main | Secondary | Overload |
|---|---|---|---|---|
| `robberTarget` | Where the robber goes | Biggest opposing production | Leader and VP weighted | Also hits the resource it needs, and times the move |
| `leaderCutoff` | Refuses trades with anyone at or above this VP | win-2 | win-3 | win-4 |
| `tradeProposals` | Offers per turn | 1, when 1 card short | Up to 2, with counter-offers | Up to 3, with sweeteners, aimed at the least threatening player |
| `devTiming` | Dev card use | Plays immediately | Knights timed for Largest Army, VP cards held | Also Monopoly on the likeliest resource, Year of Plenty to finish a build |
| `awardChase` | Longest Road / Largest Army | Opportunistic | Chases when 1-2 steps away | Chases both and breaks opponents' roads |
| `blocking` | Takes spots opponents need | Never | Obvious cases only | Blocks the leader's best expansion |
| `mercy` | Won't rob or block weak players | On (<= 2 VP) | Off | Off |

### Information and edges

| Variable | What it does | Main | Secondary | Overload |
|---|---|---|---|---|
| `info` | What it can see | Public only | Public plus card counting | Reads hands, fog tiles, dev deck (labeled cheat) |
| `grudges` | Remembers who robbed it | No | Mild | Strong, revenge weighted |
| `coordination` | Bots act as a team | No | No | Overload bots all pressure the human leader |
| `bonuses` | Production or starting edges | None | None | Off by default, optional toggle |

### Feel

| Variable | What it does | Main | Secondary | Overload |
|---|---|---|---|---|
| `thinkDelay` | Speed multiplier | 1.2x | 1.0x | 0.8x |
| Chat style | Table talk | Friendly | Neutral | Cold or taunting |
| Badge | Shown next to the name | Main | Secondary | Overload |

**Tuning targets (mixed four-seat tables):** Secondary wins about 1.3x as often as Main, Overload about 1.3x as often as Secondary. Calibrated per map class (section 4), not only on the standard board.

### Extra ideas to make tiers feel different

- **Overload lockdown:** when a human reaches about 70% of `vpToWin`, every Overload bot switches mode: refuses their trades, aims the robber at them, blocks their next spots (the GTFO alarm idea).
- **Bank denial:** with small custom banks, higher tiers drain the last cards of a resource an opponent needs. Matters most with gold picks and Year of Plenty.
- **Fog behavior:** Main avoids fog, Secondary explores it when it has nowhere else to expand, Overload treats the reveal bonus as expected value.
- **Visible tells:** Main occasionally makes a visible "mistake" (a pointless bank trade). Overload never wastes a move and shows a small threat marker when one build from a win.
- **Endgame math:** Secondary and up count hidden VP cards and know when they can win this turn. Main only notices when it is obvious.
- **Hot-number superstition (Main only):** overvalues numbers that just came up. A harmless human flaw.
- **Personality layer:** builder, road-hog, port-trader or dev rusher, applied on top of any tier.
- **Adaptive pressure:** Main eases off when far ahead, Overload presses harder when behind.

### Open question

Should the host pick the tier **per bot** when adding it (one table can mix Main, Secondary and Overload), or one tier for all bots in the room? Recommendation: per bot. It costs a small change to the `addBot` socket payload and the lobby UI.

## 3. How the first design changes for map variation

The first tier table assumed a roughly standard board. These are the places it breaks and the fix for each.

| Concern | Why it breaks | Fix |
|---|---|---|
| **Speed on huge boards** | Radius 20 is about 1,260 hexes and 7,500 vertices. Enumerating every legal build and scoring every spot each step is slow, and so are the sims. | Only consider spots next to my own network plus the top few by a cheap pre-score. Cache vertex scores per turn. Give each decision a time budget and fall back to greedy. Lookahead shrinks as the board grows. |
| **Fixed distances** | "Within 2 roads" and "lookahead 3" mean different things on small and huge boards. | Express horizons relative to road supply and board size. |
| **Fixed VP thresholds** | `leaderCutoff` of win-2 makes no sense when `vpToWin` ranges 3 to 50. | Use fractions of `vpToWin` (about 80% for the cutoff, 70% for lockdown) with a minimum gap. |
| **Hand limits** | `spendDiscipline` uses "limit minus 1", but the discard limit ranges 3 to 50. | Fraction of the limit, with a floor. |
| **Islands and odd shapes** | No ships. A player on a small landmass runs out of room, and blocking is meaningless across water. | Compute landmasses once. Setup values room to grow (Main ignores this, a natural flaw). When land-locked, switch to cities, dev cards and trading. Drop blocking when no frontier is shared. |
| **Fog** | A flat +5 fog bonus is wrong whether fog is 5% or 70% of the board. | Estimate each hidden tile from the public pool (tile counts minus what is visible). Value it as that expected tile plus the one-production reveal bonus. Main avoids fog. Overload peeks. |
| **Gold** | A flat +6.5 per gold tile makes every spot look great on Gold Rush (about a third of the map). | Scale gold's value by how rare it is and by how much the bot is missing a resource. |
| **Ports** | Port count grows with board size. | Value a port by distance to it and by how well it matches the bot's main resource. |
| **Tuning targets** | Win-rate targets only make sense on one map class. | Calibrate per map class. |

### MapProfile

At game start the bot builds a small `MapProfile` once: landmass components, fog share, gold share, average pips, port count, board size. Every tier reads it, so scoring adjusts to the map instead of using hard-coded numbers.

### Sim matrix

Run a grid and report completion, time per decision and the tier win-rate ladder for each cell:

- radius 1, 2, 3, 6, 12, 20
- standard, archipelago, Gold Rush, Fog Island, a hand-painted odd shape
- 2, 4 and 8 players

### Engine risk to check

`longestRoadFor` is a depth-first search that can blow up on large branching road networks (up to 50 roads on a big board). The sim matrix will show whether it needs a cap.

### Unreachable land

No ships exist. For land a player cannot reach by road, the default is that bots play cities, dev cards and trading. Revisit if ships or bridges are added.

## 4. Bot addon system (adapting to new game elements)

### 4.1 New rules mostly cost the bot nothing

The bot picks from `legalActions`, so it never breaks a rule it does not know about. A castle that forbids settlements inside its wall simply removes those spots from the legal list. What the bot lacks is **strategy**, not correctness. So addons are optional upgrades.

Each new element has three levels of bot knowledge:

1. **Unaware:** plays legal moves only.
2. **Generic:** the registry already lists each piece's cost, VP, resource and award metric, so the bot derives goals, resource demand and award chasing automatically.
3. **Authored:** a hand-written addon adds real strategy.

An unwritten addon degrades gracefully. It is also a natural difficulty curve: Main uses only generic knowledge of new elements, Secondary uses authored basics, Overload uses everything.

### 4.2 Channels

Addons contribute to shared channels in the bot core. They never call each other.

| Channel | How contributions combine |
|---|---|
| `score` (spot, edge, action, robber hex) | Sum |
| `needs` (resource demand) | Sum |
| `goals` (things to build or get, with value) | Merged into one ranked list |
| `threats` | Merged |
| `veto` (never do this) | Any addon can veto |
| `override` (replace a named core rule) | Highest priority wins, ties by load order |

Each addon's total contribution is clamped to a budget so late addons cannot drown out the others. Sims run "ablation" (drop one addon, see whether the win rate moves) to find useless or harmful addons.

### 4.3 Cross-addon dependencies are data

In an emerald/diamond case the diamond addon never mentions emerald. If diamond's cost contains emerald, the generic goal planner raises emerald demand on its own. Real synergies use **tags** (emerald and diamond both tag themselves `precious`, one core rule values `precious`). Complexity grows with the number of tags, not the number of addon pairs.

### 4.4 File structure

The bot addon lives next to the game pack it belongs to:

```
src/bots/core/              generic planner, channels, map profile, tiers
src/packs/base/bot.ts       today's Hard-bot logic, moved in as the first addon
src/packs/gold/bot.ts
src/packs/fog/bot.ts
src/packs/castle/index.ts   rules and pieces
src/packs/castle/bot.ts     optional strategy
```

Removing a pack removes its bot knowledge too. Moving base's heuristics into an addon proves the API on something real. The `Pack` type gets one optional field, `bot`, loaded in the same dependency order as everything else (small `api.bot(addon)` addition in `shared/`).

### 4.5 API sketch

```ts
interface BotAddon {
  id: string;
  score?: { vertex?(bc, id): number; edge?(bc, id): number; action?(bc, a): number; robberHex?(bc, id): number };
  needs?(bc): Record<string, number>;
  goals?(bc): Goal[];
  veto?(bc, action): boolean;
  override?: Record<string, { priority: number; fn: Function }>;
}

// castle: only knows about walls
const castleBot: BotAddon = {
  id: 'castle',
  score: { vertex: (bc, v) => bc.isEnclosable(v) ? 3 : 0 },
  veto:  (bc, a) => a.type === 'build' && a.payload.piece === 'wall' && !bc.wallWorthIt(a)
};

// diamond: nothing about emerald
const diamondBot: BotAddon = {
  id: 'diamond',
  score: { vertex: (bc, v) => bc.pipsOf('diamond', v) * 2 }
};
```

Both addons only read the shared context (`bc`), never each other.

### 4.6 Rules that stop it snowballing

- An addon never imports another addon (a test enforces this).
- All cross-effects go through channels and tags.
- Each addon's contribution is capped.
- A `bot-explain` tool prints each channel's contribution to every decision.

## 5. Resolving contradicting strategies

Most apparent contradictions are not real. They are trade-offs that a shared unit of value settles. Only a small set of true conflicts need a referee.

| Kind | Example | How it resolves |
|---|---|---|
| Trade-off in the same decision | Castle prefers an enclosed spot, gold prefers a gold-adjacent spot | Scores are summed in one unit, higher total wins |
| Competing for the same cards | Diamond plan and gold plan both want emerald | Shadow prices |
| Mutually exclusive stance in time | "Fortify now" vs "expand now" | Plan arbiter with commitment |

### One currency: settlement-equivalents

The core gives each addon price anchors such as `bc.settlement()` and `bc.vp(1)`. Addons price their things relative to those ("a wall is worth 0.6 of a settlement here"). Authors never reference other addons, only the anchors. The sims flag any addon whose values are consistently far outside the others.

### Shadow prices

Every resource has a running price equal to how much the bot's current goals want it. Diamond demands emerald, which raises emerald's price. Any other plan that spends emerald then looks more expensive, with no addon aware of the other. Trade, discard and bank logic use the same prices.

### Plan arbiter

Addons propose **goals** (what, cost, value). The core ranks them by value per time-to-afford and picks one active plan. To avoid flip-flopping:

- the current plan gets a commitment bonus,
- switching has a cost,
- plans expire if stuck.

Losing proposals just lose. The addon that made them does not need to know why.

### Vetoes and overrides stay scarce

- **Hard vetoes** are only for safety (for example "never discard your last city card"). Preferences become negative scores.
- **Overrides** exist only in a handful of named slots: `openingPlan`, `robberTarget`, `tradeAcceptance`, `endgame`. Each slot has one owner. If two addons claim the same slot at the same priority, the game refuses to start and says why, like the engine rejecting duplicate ids. Everything else is additive.

### Make contradictions visible

- `bot-explain` shows each addon's contribution to a decision and flags decisions where the top two addons disagree strongly.
- Ablation sims show which addon helps or hurts.
- Maps and presets can carry optional doctrine weights ("fortress map: fortify x1.5") for the rare case where you want to pick a side by hand.

## 6. Build plan

1. **Brain core** (`src/bots/core/`): channels, price anchors, shadow prices, plan arbiter with commitment, conflict report, map profile, tier profile.
2. **Base addon** (`packs/base/bot.ts`): the current Hard logic ported in as the first addon.
3. **Gold and fog addons**, since those packs already exist.
4. **Tiers** as profile presets (section 2).
5. **Scheduler** and **sim** already exist (`bots/scheduler.ts`, `bots/sim.ts`). Extend them for per-bot tier selection and the sim matrix.
6. `api.bot(addon)` added to the pack API in `shared/`.

## 7. Where the code is today

Step 2 is done and verified per `log.md` (typecheck clean, tests pass, live bot games including gold and fog presets). The pieces this design builds on:

| File | What it is now |
|---|---|
| `src/server/bots/brain.ts` | One pure `chooseBotAction(g, reg, pid, rand)`. It holds the current Hard logic: `scoreVertex`, `scoreRoad`, `scoreRobberHex`, `analyze` (plans, missing cards, surplus), `evaluateTrade`, `chooseDiscard`, `bankTradeMove`, `proposeTradeMove`, `mainPhase`. Always falls back to a legal action. Gold is already detected generically (`isWildTile`). |
| `src/server/bots/scheduler.ts` | Real-time delays and trade timeouts (`initBots`). |
| `src/server/bots/sim.ts` | Bot-vs-bot simulation. |
| `src/server/bots/dialogue.ts` | Bot chat lines (the chat style row in section 2 hooks in here). |

So the build plan above is a **refactor of `brain.ts`**, not a new write. Everything in it today becomes the `base` addon plus a generic core. Tiers are not implemented yet (the log's Remaining list has them).

One placement decision to make when starting: `brain.ts` lives under `src/server/bots/`, but addons in `src/packs/*/bot.ts` will import the bot types and the sim uses them too. Moving the core to `src/bots/core/` keeps `packs/` from depending on `server/`.
