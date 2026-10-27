# File Index

What every file does. Paths are relative to the repo root. Most source files start with a `// MODULE: what | USED BY: who` line; where a file has none, its row is worked out from its imports and `change log.md`. Update this file when you add, move or delete a file.

## Root

| File | What it does |
|---|---|
| `package.json` | Scripts (`dev`, `build`, `start`, `typecheck`, `test`); depends on express and socket.io |
| `esbuild.config.mjs` | Bundles `src/server/main.ts` to `dist/main.js` and `src/client/main.ts` to `dist/public/app.js`; copies `public/` and `styles.css`; `--watch` restarts the server |
| `tsconfig.json` | TypeScript settings for `src` and `tests` (`strict` off) |
| `Dockerfile`, `.dockerignore` | Two-stage Node 20 image, runs `dist/main.js` on port 3000 |
| `render.yaml` | Render host (Singapore, free plan, health check `/health`, auto deploy) |
| `.env.example` | Environment variables (`PORT`) |
| `public/index.html` | The single HTML page: name page, setup page, lobby, board, menus |
| `data/bot_training_logs.jsonl` | Bot training data written by `bots/trainingLog.ts` |

## Docs

| File | What it holds |
|---|---|
| `README.md` | Overview, quick start, layout |
| `change log.md` | What changed, pass by pass, plus the Planned list |
| `Backlog Priority.md` | Open tasks ordered easiest to hardest |
| `Ideas.md` | Idea dump |
| `Map Generation Design.md` | Map generator design (recipes, stages, validation) |
| `Bot AI Design.md` | Bot tiers and brain design |
| `Bot Dialogue Design.md` | Bot chat design |
| `Design UI Philosophy.md` | Visual direction and design tokens |

## `src/shared/` (pure engine: no sockets, DOM or timers; runs on server and client)

| File | What it does |
|---|---|
| `index.ts` | Public entry that re-exports the engine |
| `types.ts` | Core types: game state, board, players, rules |
| `registry.ts` | Registry, pack loader, definition types (`PieceDef`, `ActionDef`, `PhaseDef`, hooks); `createRegistry`, `mergeRules` |
| `ctx.ts` | Action context: state, registry, event and log emitters (`makeCtx`) |
| `engine.ts` | `createGame`, `dispatch`, `checkAction`, `legalActions`, `activeActors`, `updateAwards`, `checkWinner` |
| `state.ts` | Helpers: players, bank (`bankGive`, `payToBank`), `canAfford`, production, `computeVP`, phase stack (`setPhase`, `pushPhase`, `popPhase`), `startTurn` |
| `views.ts` | `playerView`: per-player view that hides other hands, hidden tiles and dev cards |
| `rng.ts` | Seeded RNG (mulberry32): `createRng`, `rngInt`, `rngPick`, `rngShuffle` |
| `palette.ts` | Player colors and avatars |
| `noise.ts` | Seeded value noise (`createNoise`, `cellPoint`) |
| `topology.ts` | Hex-grid topology: vertices, edges, ports (`buildTopology`, `hexDistance`, `portCap`) |
| `mapgen.ts` | Board generator: shape, terrain, numbers, extras, ports (`generateMap`), plus the old `generateBoard` |
| `maprecipe.ts` | Map recipe (seed, radius, picks, params), share code, per-stage RNG, `GEN_VERSION` |
| `mapoptions.ts` | Map option types (shape ops, terrain and number styles, perks, quick starts), flags, pick resolution |
| `mapshape.ts` | Shape stage: land field, cleanup, exact land count, blob growth, retry loop |
| `mapcells.ts` | Per-cell height, moisture, coast distance and landmass; neighbour lists |
| `mapterrain.ts` | Terrain placement algorithms (swap energy for spread and clustered, habitat fit for realistic) |
| `mapmix.ts` | `island_mix` fix-up: every landmass of 4+ tiles gets at least two resource types |
| `mapcheck.ts` | Board checks: landmasses, lakes, usable spots, fairness, `MapReport` |
| `numbers.ts` | Number tokens: real-game pool scaled to any board, red numbers never touch |

## `src/packs/` (game content registered as packs; load order: base, gold, fog)

| File | What it does |
|---|---|
| `index.ts` | `allPacks`: the pack list |
| `base/index.ts` | Base game pack: registers everything below |
| `base/constants.ts` | Piece and port ids shared inside the base pack |
| `base/content.ts` | Resources and tiles (wood, brick, sheep, wheat, ore, desert, water) |
| `base/pieces.ts` | Road, settlement, city |
| `base/placement.ts` | Placement rules (geometry and ownership) |
| `base/building.ts` | Build validation and piece placement (cost, supply, upgrade, `onBuild`) |
| `base/setup.ts` | Setup flow: snake order, second-round resources, hand-off to turn 1 |
| `base/phases.ts` | Phases: setup, roll, main, discard, robber, robber steal, pick, game over |
| `base/picks.ts` | Pending picks (gold, Year of Plenty); enters and leaves the pick phase |
| `base/hooks.ts` | Game start state, per-action stats, pick settling, trade pruning |
| `base/awards.ts` | Longest Road and Largest Army |
| `base/longestRoad.ts` | Longest road metric (DFS, blocked by opponent pieces) |
| `base/devcards.ts` | Knight, victory point, road building, year of plenty, monopoly |
| `base/robbing.ts` | Robber victims on a hex, seeded random steal |
| `base/trading.ts` | Bank ratios from ports, resource parsing, multi-offer stack, trade execution |
| `base/ports.ts` | Ports and the old map presets (standard, blank, archipelago) |
| `base/actions/index.ts` | Registers every base action |
| `base/actions/build.ts` | `build` |
| `base/actions/roll.ts` | `roll` (dice, production, seven leads to discard and robber) |
| `base/actions/devCards.ts` | `buy_dev`, `play_dev` |
| `base/actions/bankTrade.ts` | `bank_trade` |
| `base/actions/tradeOffers.ts` | `propose_trade`, `respond_trade`, `counter_trade`, `confirm_trade`, `cancel_trade` |
| `base/actions/owed.ts` | `discard`, `pick` |
| `base/actions/robber.ts` | `move_robber`, `steal` |
| `base/actions/endTurn.ts` | `end_turn` |
| `base/map/index.ts` | Hexagon shape, random terrain, standard numbers, Standard and Blank quick starts |
| `base/map/shapes.ts` | Continent, ring, islands, archipelago, continents; lake, river, satellites, ragged |
| `base/map/terrain.ts` | Spread, clustered, realistic terrain styles |
| `base/map/numbers.ts` | Balanced number style |
| `gold/index.ts` | Gold tile (pick a resource on production), Gold Rush preset |
| `fog/index.ts` | Hidden tiles, revealed by building next to them, Fog Island preset |

## `src/server/` (thin adapter over the engine, plus bots)

| File | What it does |
|---|---|
| `main.ts` | Entry: Express and Socket.io, `/health`, bot training log endpoints |
| `socket.ts` | Socket handlers for lobby editing, spectating and game actions (all game actions go through engine `dispatch`) |
| `game.ts` | Game runner: start, rematch, run one action, turn engine events into client effects |
| `rooms.ts` | Room registry, lobby roster, spectators, status, reconnect (`rebindPlayerId`) |
| `lobby.ts` | Lobby board tools: generate from a recipe, quick starts, settings merge, painting terrain, numbers, robber, ports |
| `runtime.ts` | The one registry for the process, settings to rules mapping, defaults |
| `net.ts` | Broadcast: sends each human and spectator their own view, clears one-shot effects, wakes the bots |
| `view.ts` | Builds the `gameState` shape the client renders (with spectator card reveal) |
| `turnClock.ts` | Per-turn clock for humans (base time plus increment per action) |
| `presets.ts` | Custom map presets as plain JSON: save, validate, rebuild |
| `mapmenu.ts` | Map options and quick starts as JSON for the lobby dropdown |
| `types.ts` | Server room types: settings, room, spectators, client-facing effects |
| `util.ts` | `clamp`, `getPips` |

### `src/server/bots/`

| File | What it does |
|---|---|
| `brain.ts` | Pure bot decision: game state to one action; reads tier, map profile and grudges |
| `tiers.ts` | Tier profiles (Main, Secondary, Overload), personalities, hash helper |
| `mapProfile.ts` | Landmasses, fog and gold share, average pips, port count, resource scarcity |
| `scheduler.ts` | Waits a game-speed delay, then lets one bot act after each broadcast |
| `sim.ts` | Bot-vs-bot simulator with invariant checks, `runLadder`, map matrix |
| `trainingLog.ts` | Training data logger: pre-action features, chosen actions, outcome labels |
| `dialogue.ts` | One-line re-export of `dialogue/index.ts` (existing imports use this path) |
| `dialogue/index.ts` | Entry: engine events to chat lines, game start, replies to human chat |
| `dialogue/engine.ts` | Filter, weighted pick, repeat memory, slot fill, rate limit, chat post |
| `dialogue/context.ts` | Builds the public-only context a line is filled from |
| `dialogue/events.ts` | Event table: chance, major flag, allowed slots, private-risk set, chat levels |
| `dialogue/types.ts` | Dialogue types |
| `dialogue/lines/index.ts` | All lines, plus which event and style pairs are silent on purpose |
| `dialogue/lines/awards.ts` | Lines for awards and the score race |
| `dialogue/lines/build.ts` | Lines for building and dev cards |
| `dialogue/lines/robber.ts` | Lines for the robber and steals |
| `dialogue/lines/roll.ts` | Lines for dice results |
| `dialogue/lines/table.ts` | Lines for game start and end, the map, fog reveals, replies to chat |
| `dialogue/lines/trade.ts` | Lines for trading and the bank |

## `src/client/` (browser client)

| File | What it does |
|---|---|
| `main.ts` | Client entry: wires DOM, socket and board input events |
| `actions.ts` | Client-to-server actions (lobby, spectate, settings, game, rejoin, AI log download) |
| `socket.ts` | Creates the socket.io connection |
| `store.ts` | Shared mutable UI state |
| `types.ts` | Loose client-side view types |
| `globals.d.ts` | Declares the global `io` from the socket.io script tag |
| `constants.ts` | Resource and dev card metadata (names, token colors) |
| `icons.ts` | Flat resource pictograms, dev card glyphs, UI icons, piece shapes |
| `avatars.ts` | Pictogram avatar faces keyed by the shared avatar id |
| `audio.ts` | Sound effects and the sound toggle |
| `ui.ts` | Theme switch, toast, victory confetti |
| `util.ts` | HTML escaping, initials |
| `mapmenu.ts` | Lobby map menu drawn from the server's option list |
| `presets.ts` | Custom map presets saved in this browser, preset row in the lobby dock |
| `cursors.ts` | Lobby cursors and Shift laser trail |
| `styles.css` | All styling and design tokens (copied to `dist/public/app.css`) |
| `render/index.ts` | Render coordinator and the 6-tab post-game victory screen |
| `render/board.ts` | Board SVG renderer, camera, board input and board animations |
| `render/hand.ts` | Player hand (resources, dev cards, spectator hand inspector) and click handlers |
| `render/drawer.ts` | Bottom-left sheet: bank trade, discard, gold, monopoly, robber victim picker |
| `render/trade.ts` | Stacked trade offers, timers, responses, counter-offer editor |
| `render/sidebar.ts` | Right sidebar: log, chat, bank, player rows, spectator strip |
| `render/setup.ts` | World setup page (host only): screen switching, tile preview, player/spectator strip |
| `render/turnclock.ts` | Turn clock readout and countdown bar |

## `tests/` (vitest)

| File | What it covers |
|---|---|
| `rules.test.ts` | Engine rules, scaled bank and dev deck |
| `topology.test.ts` | Board topology and standard board |
| `ports.test.ts` | Port layout on hexagons |
| `presets.test.ts` | Custom preset save and load |
| `setuppage.test.ts` | World setup page flag and spectator mode |
| `numbers.test.ts` | Number token pool and placement |
| `bots.test.ts` | Bot tiers and the tier ladder |
| `dialogue.test.ts` | Bot dialogue engine and lines |
| `sim.test.ts` | Bot-vs-bot games on the standard, goldRush and fogIsland presets |
| `mapsims.test.ts` | Bot games on every map shape |
| `mapgen.test.ts` | Recipes, noise, validation, generator |
| `mapshapes.test.ts` | Shape ops, land counts, per-landmass ports |
| `maptiles.test.ts` | Terrain and number styles |
| `mapmix.test.ts` | `island_mix` perk, ring check, `GEN_VERSION` |
| `mapretry.test.ts` | Board retry loop and `degraded` flag |
| `mapsettings.test.ts` | Map settings and option resolution |
| `mapmenu.test.ts` | Map menu data and presets v2 |
| `mapbudget.test.ts` | Generation time budget |
