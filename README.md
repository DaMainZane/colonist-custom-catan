# HexSettlers Online

Modular Catan-style game for private groups (max 8 players), playable in phone and PC browsers. Work in progress: see `Roadmap.md` and `Development Plan.md`.

## Quick start

```
npm install
npm run dev      # watch + restart on http://localhost:3000
npm run build    # production bundle in dist/
npm start        # run dist/main.js
npm test         # vitest
npm run typecheck
```

## Layout

- `src/server/` TypeScript server (bundled by esbuild to `dist/main.js`). Thin adapter over the engine, plus bots (`bots/`). The old rules code is in `src/server-legacy/` until it is deleted.
- `src/shared/` pure engine, no sockets/DOM/timers. Runs on server and client.
- `src/packs/` game content registered as packs (base game now, gold and fog next).
- `src/client/` browser client.
- `public/` static client assets (copied to `dist/public`)
- `tests/` unit tests
- `legacy/` original single-file server, kept as reference

## Engine design (Step 2)

- Content is data: resources, tiles, pieces, dev cards, awards, ports, phases and actions are registered definitions in packs.
- The engine is pure: seeded RNG, state is plain JSON, every change goes through `dispatch`.
- Server and client are thin adapters over the engine.
- Effects (sounds, animations, log) listen to engine events.
- Every file starts with `// MODULE: what | USED BY: who`.

## Modules

Status: 2a-2g written. Typecheck is clean and all 25 tests pass, including bot-vs-bot sims on the standard, goldRush and fogIsland presets. Live bot games work in the browser. `src/server-legacy/` is kept only until it is deleted.

### `src/shared/` (2a-2c)

| File | What |
|---|---|
| `rng.ts` | seeded RNG (mulberry32), state is plain JSON |
| `types.ts` | game state, board, players, rules |
| `palette.ts` | player colors and avatars |
| `ctx.ts` | action context: state + registry + event/log emitters |
| `registry.ts` | registry, pack loader, definition types (`PieceDef`, `ActionDef`, `PhaseDef`...) |
| `topology.ts` | pure hex-grid topology (vertices, edges, ports, robber start) |
| `mapgen.ts` | board generator driven by the registry (tile counts, numbers, presets, ports) |
| `state.ts` | helpers: players, bank, costs, phase stack, production, VP, `startTurn` |
| `engine.ts` | `createGame`, `dispatch`, `legalActions`, `activeActors`, awards, win check |
| `views.ts` | per-player filtered view (hides hands, hidden tiles, dev cards) |
| `index.ts` | public entry |

### `src/packs/base/` (2d)

| File | What |
|---|---|
| `index.ts` | the base pack: default rules + registration order |
| `constants.ts` | piece/port ids, setup piece per phase |
| `content.ts` | resources and tiles (wood, brick, sheep, wheat, ore, desert, water) |
| `ports.ts` | ports (3:1 x4, 2:1 per resource) and presets (standard, blank, archipelago) |
| `pieces.ts` | road, settlement, city |
| `placement.ts` | placement rules for those pieces |
| `building.ts` | build validation and `placePiece` (cost, supply, upgrade, `onBuild` hook) |
| `setup.ts` | setup snake order, second-round production, hand-off to turn 1 |
| `longestRoad.ts` | longest road metric |
| `awards.ts` | Longest Road (min 5), Largest Army (min 3), 2 VP each |
| `devcards.ts` | knight, victory point, road building, year of plenty, monopoly |
| `phases.ts` | setup, roll, main, discard, robber, robber_steal, pick, gameover |
| `picks.ts` | pending picks: enters/leaves the `pick` phase after every action |
| `robbing.ts` | robber victims and seeded random steal |
| `trading.ts` | bank ratios from ports, resource parsing, player trade execution |
| `hooks.ts` | game start state, per-action stats tracking (`recordActionStats`), trade pruning, `settlePicks` after every action |
| `actions/` | one file per action group: `build`, `roll`, `devCards` (buy/play), `bankTrade`, `tradeOffers` (propose/respond/counter/confirm/cancel), `owed` (discard/pick), `robber` (move/steal), `endTurn` |

Action types: `build {piece, loc}`, `roll`, `buy_dev`, `play_dev {card, ...}`, `bank_trade {give, get}`, `propose_trade {offer, request}`, `respond_trade {decision, tradeId?}`, `counter_trade {offer, request, tradeId?}` (a responder edits an offer and sends it back to the proposer at the top of the stack), `confirm_trade {partnerId?, tradeId?}`, `cancel_trade {tradeId?}`, `discard {cards}`, `pick {resource}`, `move_robber {hexId}`, `steal {victimId}`, `end_turn`.

### `src/client/` (lobby, trade, and post-game UI)

| File | What |
|---|---|
| `avatars.ts` | flat pictogram faces keyed by the shared avatar id (`AVATAR_CHOICES` mirrors `shared/palette.ts`), falls back to the name initial |
| `cursors.ts` | lobby-only shared cursors and Shift laser trail on a canvas over the board; positions travel in board coordinates via the `cursor` socket event |
| `render/trade.ts` | stacked multi-offer trade UI (newest on top, per-offer countdown bar, collapsible header, aligned responder boxes) and counter-offer editor |
| `render/index.ts` | top-level render coordinator and 6-tab post-game victory screen (`Overview`, `Dice Stats`, `Res Card Stats`, `Dev Card Stats`, `Activity Stats`, `Resource Stats`) with leader highlights |
| `ui.ts` | theme switcher, toast banner, and full-screen canvas victory confetti animation (`triggerVictoryConfetti`) |
| `presets.ts` | custom map presets: list kept in the host's `localStorage`, preset row in the lobby dock (save, load, delete with confirmation). Built-in presets stay fixed chips in `index.html` |

Lobby rules: only the host edits (map painting, presets, settings, bots, start, game speed). Everyone picks their own avatar (click it in the player list; each avatar is used once per lobby, the host can change the bots').

Custom presets: `src/server/presets.ts` turns the lobby map (tiles, numbers, fog, ports, robber) and the rule settings (not seats or game speed) into JSON on `savePreset`, and validates and rebuilds it on `applyCustomPreset`. The server stores nothing. Saving under an existing name replaces that preset, which is how one is edited. `mergeSettings` in `src/server/lobby.ts` is the one place settings are clamped.

### `src/server/bots/` (default bot)

| File | What |
|---|---|
| `tiers.ts` | Main / Secondary / Overload as plain data (`TierProfile`), personalities, `spendThreshold`, tier parsing. A new tier is a new row |
| `mapProfile.ts` | `MapProfile`: landmasses, gold share, average pips, port count; built once per board, refreshed when fog is revealed |
| `brain.ts` | `chooseBotAction`: pure, reads the tier, the map profile and grudges (`noteBotEvents`). Always falls back to a legal action |
| `scheduler.ts` | real-time delays (tier think delay), trade timeouts, turn-expiry hand-off |
| `sim.ts` | bot-vs-bot games with a tier per seat, decision timing, `runLadder` (win rate per tier) |
| `dialogue.ts` | bot chat, style follows the tier |

The host picks a tier per bot (dropdown next to the Bot button, or click the `Bot · Tier` tag in the lobby). Details and status in [`Bot AI Design.md`](Bot%20AI%20Design.md). The addon system is not built yet.

### `src/packs/gold/` and `src/packs/fog/` (2e)

| File | What |
|---|---|
| `gold/index.ts` | `gold` tile: production adds `pending.pick` instead of cards. Rule `tileCounts.gold` (default 2). Preset `goldRush` |
| `fog/index.ts` | hides tiles after map generation (`ext.hidden`), reveals them when a road is built next to them (rule `fogRevealBy`) and pays one production. Rule `fogTiles` (default 0). Preset `fogIsland` |

`src/packs/index.ts` exports `allPacks` (base, gold, fog in load order).

### Map generation (M1 to M4)

Design and status in [`Map Generation Design.md`](Map%20Generation%20Design.md). A map is a recipe (seed, radius, picks, params); `generateMap(reg, rules, recipe)` runs shape, terrain, numbers, extras, ports and check, each stage on its own RNG stream.

| File | What |
|---|---|
| `shared/noise.ts` | seeded lattice value noise, `cellPoint` |
| `shared/maprecipe.ts` | `GEN_VERSION`, `MapRecipe`, `stageRng`, share code encode and decode |
| `shared/mapoptions.ts` | option types (shape ops, terrain and number styles, perks, quick starts), `GenFlags`, pick resolution (slots, conflicts, defaults), params |
| `shared/mapshape.ts` | land field, exact land count, cleanup, multi-landmass blobs, `runShape` |
| `shared/mapcells.ts` | per-cell height, moisture, coast distance, landmass for the styles |
| `shared/mapterrain.ts` | `swapPlace` (spread, clustered) and `habitatPlace` (realistic) |
| `shared/numbers.ts` | token pool, `assignNumbers` / `settleNumbers` with rule flags, `dealByRichness`, `dealBalanced` |
| `shared/mapcheck.ts` | landmass detection, `validateBoard` and `MapReport` |
| `packs/base/map/` | `shapes.ts` (hexagon, continent, ring, islands, archipelago, continents, lake, river, satellites, ragged), `terrain.ts` (spread, clustered, realistic), `numbers.ts` (feast_famine, balanced), `index.ts` (random, standard, quick starts) |

A tile gets a `habitat` (`TileDef.habitat`) to be placed by `realistic`; a pack adds a tile or a style with no change to the generator.

## Design

The new UI direction is documented in [`Design UI Philosophy.md`](Design%20UI%20Philosophy.md): a Lichess-style shell where the board is the hero, flat Mini Metro-style resource pictograms (recognizable shapes, not abstract ones) with prominent pieces, and a muted Dorfromantik-style color palette, all driven by CSS design tokens. It is built in Step 4 (UI and phone).

Full README (architecture, modding, hosting) comes later in the plan.
