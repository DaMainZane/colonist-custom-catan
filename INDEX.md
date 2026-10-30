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
| `data/bots/_schema.md` | S0.15 cross-game bot memory & player profile JSON schema, caps, and Render portable code spec |

## Docs

| File                       | What it holds                                      |
| -------------------------- | -------------------------------------------------- |
| `README.md`                | Overview, quick start, layout                      |
| `change log.md`            | What changed, pass by pass                         |
| `Backlog Priority.md`      | Open tasks ordered easiest to hardest              |
| `Ideas.md`                 | Idea dump                                          |
| `Development Plan.md`      | Stage 0 build plan (services, order, decisions)    |
| `Map Generation Design.md` | Map generator design (recipes, stages, validation) |
| `Bot AI Design.md`         | Bot tiers and brain design                         |
| `Bot Dialogue Design.md`   | Bot chat design                                    |
| `Design UI Philosophy.md`  | Visual direction and design tokens                 |
| `Tech Tree Design.md`      | Locked spec for the 5 root techs, per-player building-value cost formula, and per-tech hooks |
| `Handoff - Tech Tree Roots.md` | Handoff guide and step-by-step work order for implementing the 5 tech tree roots |

## `src/shared/` (pure engine: no sockets, DOM or timers; runs on server and client)

| File | What it does |
|---|---|
| `index.ts` | Public entry that re-exports the engine |
| `types.ts` | Core types: game state, board, players, rules |
| `registry.ts` | Registry, pack loader, definition types (`PieceDef`, `ActionDef`, `PhaseDef`, hooks); `createRegistry` (optional enabled-addon set), `mergeRules`, keyed registries (`api.define`, `defsOf`), `api.phaseAction` (an addon adds its action to a phase that already exists) |
| `addons.ts` | DLC and addon manifest: `AddonDef`, General service ids, `resolveAddons`, `registryFor`, `addonOn`, `auditAddons` (Rule of Two) |
| `pricing.ts` | Piece cost and limit service: `priceOf`, `priceOfUpgrade`, `placedCount`, `aboveBaseLimit`, `scaledPieceLimit`, cost modifiers (`COST_MODS`) |
| `tradeRatio.ts` | S0.5 Trade ratio service: `ratioFor`, `ratioWithoutHarbor`, `tradeRatiosFor`, `recordBankTrade`, `explainInvalidBankRatio`, `RATIO_MODS`, 2:1 floor, gem port exemption, harbor-only 1:1 pass (`HARBOR_RATIO_MODS`, `HARBOR_MIN_RATIO`, per-turn trade validation/recording hooks and harbor explanations), idle ports (`PORT_IDLE_CHECKS`, `isPortIdle` with `exempt` hook so harbors keep trading while flooded) |
| `production.ts` | S0.6 Production pipeline: ordered stages (`PRODUCTION_STEPS`), `effectiveHexNumber`, `matchingHexesForRoll`, `runProductionPipeline` |
| `tileState.ts` | S0.7 Tile state (`TILE_STATES`, `getTileState`, `setTileState`, `tickTileStates`), durability & repair (`DURABILITY_DEFS`, `damagePiece`, `repairPiece`), wild tokens (`WILD_TOKENS`, `grantWildPick`, `grantWildToken`, `spendWildToken`, `takeWildToken`, `wildTokensOf`, `countableWildTokens`, `stealableWildTokens`, `visibleWildCards`) |
| `sevenResolver.ts` | S0.8 Seven Resolver: ordered step pipeline (`SEVEN_STEPS`), `DISCARD_LIMIT_MODS`, `effectiveDiscardLimit`, `countableCardsForSeven` (hand plus held tokens that count for a discard), `resolveSeven` with side-effect cap |
| `coreServices.ts` | S0.9 Marker system (`addMarker`, `tickMarkers`), Ledger (`addLedgerEntry`, `settleLedgerEntry`), Strength & defense (`vertexDefense`, `playerTotalStrength`), Relations matrix (`getRelation`, `addOpinion`, `breakTreaty`) |
| `history.ts` | S0.10 Public history ring buffer (`appendPublicHistory`, `getPublicHistory`, `detectStreaks`) and stats registry (`STAT_HANDLERS`, `runStatHandlers`) |
| `eventDeck.ts` | S0.11 Seeded event deck (`EVENT_CARDS`, `ensureEventDeck`, `peekNextEvent`, `vetoPreviewEvent`, `upholdPreviewEvent`, `drawAndApplyRoundEvent`) |
| `stage1.ts` | Stage 1 core systems & proving-ground content: S1.1 Taxes & Catch-up levers, S1.2 Public Contract Board & rarity tiers, S1.3 Spies & intel ladder, S1.4 Tech tree (`techResearchCheck`, `researchTech`, `techPanelFor`, cost formula) & Local Nemesis & Round recap, S1.5 Karaoke 7, Bot Drinking Game, Hats, Sandbox Economy |
| `botGoals.ts` | S0.14 Bot goal registry (`BOT_GOALS`, tier-gated `evaluateBotGoals`, `botGoalVertexDelta`, `botGoalEdgeDelta`, `botGoalActionScore`, `botGoalThreatDelta`) |
| `ctx.ts` | Action context: state, registry, event and log emitters (`makeCtx`) |
| `engine.ts` | `createGame`, `dispatch`, `checkAction`, `legalActions`, `activeActors`, `updateAwards`, `checkWinner` |
| `state.ts` | Helpers: players, bank (`bankGive`, `payToBank`), `canAfford`, production, `computeVP`, phase stack (`setPhase`, `pushPhase`, `popPhase`), round clock (`endRoundIfLastSeat`, `everyNRounds`), `score`, `publicVP`, `startTurn` |
| `views.ts` | `playerView`: per-player view that hides other hands, hidden tiles, dev cards and other players' held wild tokens (fish) until game over |
| `rng.ts` | Seeded RNG (mulberry32): `createRng`, `rngInt`, `rngPick`, `rngShuffle` |
| `palette.ts` | Player colors and avatars |
| `noise.ts` | Seeded value noise (`createNoise`, `cellPoint`) |
| `topology.ts` | Hex-grid topology: vertices, edges, ports, and optional water-edge topology for crossing packs (`buildTopology`, `addWaterTopology`, `hexDistance`, `portCap`) |
| `mapgen.ts` | Board generator: shape, terrain, numbers, extras, ports (`generateMap`), plus the old `generateBoard` |
| `maprecipe.ts` | Map recipe (seed, radius, picks, params), share code, per-stage RNG, `GEN_VERSION` |
| `mapoptions.ts` | Map option types (shape ops, terrain and number styles, perks, quick starts), flags, pick resolution; `PerkDef.afterGenerated(inits, ctx, cells)` gets the land cells with their ranked height |
| `mapshape.ts` | Shape stage: land field, cleanup, exact land count, blob growth, retry loop; wide-water helpers (`seaExtra`, `seaGrow`, `canvasRadiusFor`, `gapRoom`, `wideGap`, `centersTooClose`; `LandField.baseRadius`) that do nothing without the Tidebound perk |
| `mapcells.ts` | Per-cell height, moisture, coast distance and landmass; neighbour lists |
| `mapterrain.ts` | Terrain placement algorithms (swap energy for spread and clustered, habitat fit for realistic) |
| `mapmix.ts` | `island_mix` fix-up: every landmass of 4+ tiles gets at least two resource types |
| `mapcheck.ts` | Board checks: landmasses, lakes, usable spots, fairness, `MapReport` |
| `numbers.ts` | Number tokens: real-game pool scaled to any board, red numbers never touch (random swaps, then a deterministic sweep for any red pair left) |

## `src/packs/` (game content registered as packs; load order: base, gold, fog, tidebound)

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
| `base/robbing.ts` | Robber victims on a hex, seeded random steal (the pool also holds the victim's `stealable` wild tokens, fish), steal-count modifiers (`STEAL_COUNT_MODS`, `stealCount`) and the knight/7 steal source |
| `base/trading.ts` | Bank ratios from ports, resource parsing, multi-offer stack, trade execution |
| `base/ports.ts` | Ports and the old map presets (standard, blank, archipelago) |
| `base/actions/index.ts` | Registers every base action |
| `base/actions/build.ts` | `build` |
| `base/actions/roll.ts` | `roll` (seeded or fair-dice curve-guided 2d6 rolls, production, seven leads to discard and robber) |
| `base/actions/devCards.ts` | `buy_dev`, `play_dev` (only Knight playable before rolling in `roll` phase) |
| `base/actions/bankTrade.ts` | `bank_trade` |
| `base/actions/tradeOffers.ts` | `propose_trade`, `respond_trade`, `counter_trade`, `confirm_trade`, `cancel_trade` |
| `base/actions/owed.ts` | `discard` (resources, plus optional `wild` tokens that count toward the hand), `pick` |
| `base/actions/robber.ts` | `move_robber`, `steal` |
| `base/actions/endTurn.ts` | `end_turn` |
| `base/actions/research.ts` | `research_tech` (rules in `shared/stage1.ts`; no legal actions while `rules.techTreeOn` is off) |
| `base/techRoots.ts` | The 5 root techs (one per DLC branch) and `registerTechRoots` |
| `base/techEffects.ts` | Effects of the 5 root techs: Stockpiling, Road levy, Harbor charters (raises a whole port 3:1 to 2:1, port level per vertex in `portUpgrades`), Plunder modifiers; Ground work helpers; `techActionsFor` for the panel |
| `base/actions/techActions.ts` | `upgrade_port` (Harbor charters, payload `{ vertexId }`, no resource choice) and `convert_tile` (Ground work) |
| `base/map/index.ts` | Hexagon shape, random terrain, standard numbers, Standard and Blank quick starts |
| `base/map/shapes.ts` | Continent, ring, islands, archipelago, continents; lake, river, satellites, ragged |
| `base/map/terrain.ts` | Spread, clustered, realistic terrain styles |
| `base/map/numbers.ts` | Balanced number style |
| `gold/index.ts` | Gold tile (pick a resource on production), Gold Rush preset |
| `fog/index.ts` | Hidden tiles, revealed by building next to them, Fog Island preset |
| `tidebound/index.ts` | Tidebound DLC pack: lists the 8 addons in dependency order and re-exports the Bridge, Rickety bridge, Tides, Fishing, and Harbor helpers |
| `tidebound/bridges.ts` | `tidebound.bridges` addon: registers the `wide_water` map perk (T2a–T2c), the `crossing` capability, the `bridge` piece (`BRIDGE`, `canPlaceBridge`, `isOceanEdge`, cost road + 1 ore, base limit 10 scaled by radius/VP, 2x cost past 10, counts toward Longest Road), and `bridgeBotGoal` (T3a–T3e) |
| `tidebound/seaData.ts` | T2b2 and T2c map data for the wide-water perk: `elevationOf`, `applyElevation` (`ext.elevation` 1 to 3 on land by ranked height), `placeFish` (`ext.fish` on seeded sea tiles, shore sea more than open sea). No RNG draws |
| `tidebound/ricketyBridges.ts` | `tidebound.rickety_bridges` addon (T4a–T4e): `rickety_bridge` piece (`RICKETY`, 1 wood, health 1 through a `DURABILITY_DEFS` entry, road-like, same placement rule as a bridge), one shared pool with bridges (`syncBridgePool` keeps both supplies equal; `ricketyPoolCostMod` makes 10 bridges and rickety bridges together the 2x threshold), the `upgrade_bridge` action (`{ edgeId }`, 1 brick + 1 ore, doubled at the pool limit), `ricketyCollapseStep` (`SEVEN_STEPS`, breaks all rickety bridges on a 7, syncs the pool, and recalculates Longest Road), `ricketyBotGoal` (builds rickety when a full bridge is unaffordable, upgrades with spare cards), and `bridgeUpgradeView` |
| `tidebound/tides.ts` | `tidebound.tides` addon (T5a to T5e and the data for T6; T5e: `isPortFlooded` registered as a `PORT_IDLE_CHECKS` check; T6: `floodPlan`, `tideWarning` (one turn ahead, last seat's turn), `tideClientView` = overlays + tide facts + elevation for the client): uses the base `flooded` tile state (blocks production and robber placement), coast clusters (`coastHexIds`, `buildTideClusters`: coast land cut into stretches of about 6 tiles, each with its `inner` second ring, a phase 0 or 1 dealt half and half), the tide level (`TIDE_LEVELS`, five slider positions Very low to Very high, each with period, duration, spring cadence, reach and strength; `tideLevelOf` reads `rules.tideLevel`, Medium is the default), the schedule (`isFloodedAt`: dry before round 2, then `duration` rounds of every `period`, phases half a period apart; `isSpringTide`; `floodDepthAt`: 0 dry, 1 coast, 2 coast and inland, a spring tide reaches every cluster), elevation resistance (`hexElevation`, `tideStrengthAt`: a tile floods when the tide strength is at least its `ext.elevation`), `ensureTides` (data in `g.ext.tidebound.tides`, built at game start) and `applyTides` (round start: sets and clears the state, emits `tileStateChanged` and `tideChanged` with `held` tiles). Uses a derived RNG stream (`deriveTideRng`), never `g.rng` |
| `tidebound/fishing.ts` | `tidebound.fishing` addon (T7a, T7b1): the fish wild token (`FISH`, `fishToken`: counts for a 7 discard, stealable, never in a hand or the bank; data in `g.ext.core.wildTokens`), the `spend_fish` action (`SPEND_FISH`, `{ resource }`, main phase, one fish = 1 card the bank still has) and `fishBotGoal` (spends a fish only for the one card that finishes a city, settlement or dev card). T7b1 nets: the `net` piece (`NET`, a vertex piece, placeholder price `NET_COST` 2 wood + 1 sheep, base limit `NET_BASE_LIMIT` 4 scaled by radius and VP, 2x past it), `canPlaceNet` (build phase, empty coast vertex = land and at least one sea tile, next to your own road or bridge), `seaHexIdsAt` and `isSeaHex` (the sea tiles at a vertex, found from the land tile's corner, no water topology needed) and `netCatchOnRoll` (an `onRoll` hook: every net, on every roll, 1 in 6 (`NET_CATCH_CHANCE`) to give its owner a fish; the draw is a hash of seed, roll count and vertex, so no `g.rng` draw and no stored state; ignores the tile state, so a flooded net still fishes). Icon boosts, tide replenish and feed-the-sea are T7c to T7e. T7b2: `netSpotsView` (the vertices you could put a net on, sent to the client as `netSpots` on your main-phase turn), `canPlaceNet` refuses a port vertex (`ratioFor` would give a net a port), and `netBotGoal` (`NET_BOT_MAX` 3: a side build with the price plus 2 spare cards, prefers sea tiles with a fish icon). T7c: `fishLeft` (boosts left on a fishing ground, `ext.fish` 0 to 4) and the boost in `netCatchOnRoll` (a sea tile at the net with boosts left doubles the chance to `NET_BOOSTED_CHANCE` 1 in 3, and each boosted catch uses up one boost of the richest such tile; the icon stays at 0). T7d: `tideReachOnSea` (the sea around the coast tiles of each flooding cluster, depth 1 or 2) and `replenishFish` (an `onRoundStart` hook: a tile with an icon and room regains one boost with chance `FISH_REPLENISH_CHANCE` by depth, hash draw, no `g.rng`). T7e: the `feed_sea` action (`FEED_SEA`, `{ hexId }`, main phase, 1 wheat (`FEED_SEA_COST`) sets an open sea tile next to one of your nets to full), `feedableHexIds`, `netSeaHexIds`, the feed bot score in `fishBotGoal`, and the client data `fishClientView` (public `fishIcons`) and `feedSpotsView` |
| `tidebound/harbor.ts` | `tidebound.harbor` addon (T8a, T8b): `upgrade_harbor` action (`UPGRADE_HARBOR`, `{ vertexId }`, main phase, upgrades a player's own `city` on a port to `HARBOR_LEVEL = 2` for `HARBOR_COST` = 2 wood + 1 brick + 1 ore via `priceOfUpgrade`), limit `HARBOR_LIMIT = 1` per player (or 2 with `tidebound.harbor_empire`), flood exemption (`harborIdleExemption` in `PORT_IDLE_CHECKS` + `isPortFlooded`), `harborRatioMod` in `HARBOR_RATIO_MODS` (1:1 up to `HARBOR_MAX_TRADES = 4` trades per turn per harbor, then falls back to 2:1 for the rest of the turn, resetting on `onTurnStart`), invalid-ratio harbor explanations, `harborBotGoal`, `harborSpotsView`, and `harborClientView` |
| `tidebound/wrecks.ts` | `tidebound.wrecks` addon (T9a–T9e): `stormEventCard` (`tidebound.storm`, 2 copies in `EVENT_CARDS`, plus passive storm cadence every 3 rounds when `eventsOn` is off), derived RNG stream (`deriveWreckRng` / `ensureWreckRng`, zero `g.rng` draws), timed `wreck` marker (`WRECK_COUNTDOWN_ROUNDS = 4`), 65/35 sea/shore placement (`WRECK_SEA_CHANCE = 0.65`) and fair equidistant spawn within `WRECK_MAX_PLAYER_DIST = 4` hexes of a player (`pickWreckHex`, `wreckCandidates`), claiming on first connecting road/bridge/rickety bridge/port (`playerTouchesWreck`, `claimWreck`, `spawnWreckAt`), loot with slow time scaling (`wreckTimeMultiplier` up to +40% at 50 turns), `tidebound.salvage_crew` (+25% loot and higher dev drop odds), and the 2x-cost floor rule (`computeWreckLootCount`), `wreckBotGoal`, and `wreckClientView` (`shoreDir` toward the sea) |
| `tidebound/pirates.ts` | `tidebound.pirates` addon (T10a to T10d): `tidebound.pirate_raid` event card plus a passive spawn (round 4, then every 4th, when `eventsOn` is off), public `pirate` markers (max `PIRATE_MAX` 2, ocean only, within 4 tiles of a player, derived RNG `derivePirateRng`, zero `g.rng` draws), `pirateRoundStep` (an `onRoundStart` hook: strength follows the round via `pirateStrengthAt`, flee, or one random step, then rob), `drive_off_pirate` (`DRIVE_OFF_PIRATE`, `{ hexId }`: needs played knights equal to the strength (`pirateKnightsNeeded`) and a road, bridge or port touching the tile, pays `pirateLootCards` from the bank), rob 2 cards from every settlement and city in contact (`PIRATE_ROB_CARDS`, `transferred` kind `pirate`), flee mode (`PIRATE_FLEE_*`: chance rises after every rob, runs 2 tiles from the robbed city) and the avoid rule (`guardedVertices`, `isGuardedHex`: keeps `PIRATE_AVOID_RADIUS` 2 tiles clear of players with more knights than its strength), `pirateClientView`, `pirateDriveView`, `pirateBotGoal` |
| `tidebound/risingSea.ts` | Addon stub (id, name, description, deps, `links`); the content is added by T12 |

## `src/server/` (thin adapter over the engine, plus bots)

| File | What it does |
|---|---|
| `main.ts` | Entry: Express and Socket.io, `/health`, bot training log endpoints, `/api/memory/export` and `/api/memory/import` |
| `socket.ts` | Socket handlers for lobby editing, spectating, scenario presets and game actions (all game actions go through engine `dispatch`; `upgradeBridge` runs `upgrade_bridge`, `spendFish` runs `spend_fish`, `feedSea` runs `feed_sea`, `discardCards` passes `wild` for fish, `clickVertex` with `piece: 'net'` builds a net) |
| `game.ts` | Game runner: start, rematch, run one action, turn engine events into client effects |
| `rooms.ts` | Room registry, lobby roster, spectators, status, reconnect (`rebindPlayerId`) |
| `lobby.ts` | Lobby board tools: generate from a recipe, quick starts, settings merge (`dlc`, `addons`, `eventsOn`, `fateTokens`), painting terrain, numbers, robber, ports; map, picks and quick starts come from the room's DLC-aware registry (`mapRegistryFor`) |
| `runtime.ts` | Shared base registry, dynamic `gameRegistry(rules)`, the room map registry (`mapRegistryKey`, `mapRegistryFor`: plain while no addon is on, cached per addon set), settings to rules mapping, defaults |
| `net.ts` | Broadcast: sends each human and spectator their own view, clears one-shot effects, wakes the bots; in the lobby sends a socket the room's map option list when its addon set changes |
| `view.ts` | Builds the `gameState` shape the client renders (with spectator card reveal, per-player `pieceCosts`, your own `bridgeUpgradeCost` when rickety bridges are in the game, `wildTokens` per player with the same visibility as the hand, your own `netSpots` and `netsLeft` when nets are in the game, your own `feedSpots` and `feedCost` when feeding the sea is in the game, the public `fishIcons`, and `hexOverlays` + `tide` when Tides is on) |
| `turnClock.ts` | Per-turn clock for humans (base time plus increment per action) |
| `presets.ts` | Custom map presets as plain JSON: save, validate, rebuild |
| `mapmenu.ts` | Map options, quick starts, scenario presets, DLCs and addons as JSON for the lobby and setup page; `mapOptionsForSettings` gives the list for one room's addon set (cached) |
| `persistence.ts` | S0.15 Cross-game bot memory & player profile store (`data/bots/*.json`, caps, public-only event filter, schema migration, Render `CTMEM1.` export/import) |
| `types.ts` | Server room types: settings, room, spectators, client-facing effects |
| `util.ts` | `clamp`, `getPips` |

### `src/server/bots/`

| File | What it does |
|---|---|
| `brain.ts` | Pure bot decision: game state to one action; reads tier, map profile, grudges, `BOT_GOALS`, and tech tree research/actions when `techTreeOn` is on |
| `tiers.ts` | Tier profiles (Main, Secondary, Overload), personalities, hash helper |
| `mapProfile.ts` | Landmasses, fog and gold share, average pips, port count, resource scarcity |
| `scheduler.ts` | Waits a game-speed delay, then lets one bot act after each broadcast |
| `sim.ts` | Bot-vs-bot simulator with invariant checks, `runLadder`, and S0.16 `runSimMatrix` (with `techTreeOn` on/off and scenario subset support) |
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
| `actions.ts` | Client-to-server actions (lobby, spectate, DLC/addon toggles, Tides level, scenario presets, settings, game, rejoin, AI log download) |
| `socket.ts` | Creates the socket.io connection |
| `store.ts` | Shared mutable UI state (includes the fish picked for a discard) |
| `types.ts` | Loose client-side view types |
| `globals.d.ts` | Declares the global `io` from the socket.io script tag |
| `constants.ts` | Resource and dev card metadata (names, token colors) |
| `icons.ts` | Flat resource pictograms (and the fish token), dev card glyphs, UI icons, piece shapes, the fishing ground fish with boost pips (`fishGroundMarkup`), and shipwreck markers (`wreckMarkup`) |
| `avatars.ts` | Pictogram avatar faces keyed by the shared avatar id |
| `audio.ts` | Sound effects and the sound toggle |
| `ui.ts` | Theme switch, toast, victory confetti |
| `util.ts` | HTML escaping, initials |
| `mapmenu.ts` | Lobby map menu drawn from the server's option list |
| `presets.ts` | Custom map presets saved in this browser, preset row in the lobby dock |
| `cursors.ts` | Lobby cursors and Shift laser trail |
| `styles.css` | All styling and design tokens (copied to `dist/public/app.css`) |
| `render/index.ts` | Render coordinator and the 6-tab post-game victory screen |
| `render/board.ts` | Board SVG renderer, camera, board input and board animations; the overlay layer (tide tint, warning, or the elevation heat map) is rewritten only when its markup changes; rickety bridges drawn dashed with two planks, collapse animation (`.bridge-collapse-anim`, `.bridge-collapse-ring`) when a rickety bridge breaks on a 7, upgrade marker on your own rickety bridges you can pay for, `clickEdge` opens the bridge picker when rickety bridges are in the game; nets drawn with `netMarkup`, and in net mode only the server's `netSpots` are drawn (dashed diamonds); fishing grounds (`fishIcons`) drawn on their own layer (`boardFishLayer`, rewritten only when its markup changes), and in feed mode (`setBuildMode('feed')`) a clickable ring on each tile in the server's `feedSpots` (`clickFeedSpot`); shipwrecks (`wrecks`) drawn on `boardWrecksLayer` with distinct ocean whirlpool (`.wreck-spawn-sea-anim`) and shore surf-wash (`.wreck-spawn-shore-anim`) spawn animations; pirates (`pirates`, T10) drawn on `boardPiratesLayer` through `renderPiratesMarkup`, with a click on the ones in your `pirateDrives`; the `pirate` transfer kind counts as a robbery for the card animation |
| `render/pirates.ts` | Tidebound T10: pirate ship markup with a strength badge (`pirateMarkup`), the pirates layer markup (`renderPiratesMarkup`: a pulsing ring and a click on the pirates you can drive off), `clickPirate` (sends `drivePirate`); adds its own styles once |
| `render/hand.ts` | Player hand (resources, fish tokens, dev cards, spectator hand inspector) and click handlers (`onClickHandWild`: pick a fish for a discard or open the spend sheet) |
| `render/drawer.ts` | Bottom-left sheet: bank trade, discard (cards and fish), gold, monopoly, spend a fish, robber victim picker |
| `render/trade.ts` | Stacked trade offers, timers, responses, counter-offer editor |
| `render/sidebar.ts` | Right sidebar: log, chat, bank, player rows, spectator strip |
| `render/setup.ts` | World setup page (host only): screen switching, tile preview, scenario presets, DLC/addon toggles (server list first, built-in fallback catalog; the Tidebound ids in it must match the pack, see `tidebound.test.ts`), the Tides level slider under the Tides row, active summary strip, player/spectator strip |
| `render/overlay.ts` | S0.13 Overlay and popup kit: 7 colorblind-safe SVG hex overlays (flood and flood-warn colors come from `--flood-*` tokens, so both themes work), the elevation heat map markup (`renderElevationMarkup`), timer-bar popup stack, event title cards, round-end recap card |
| `render/turnclock.ts` | Turn clock readout and countdown bar |
| `render/techpanel.ts` | Tech panel: radial hub-and-spoke tree (one spoke per branch, one ring per tier, built from the server's `techTree` rows), costs as mini resource cards (`costStripHtml`, also used by the bridge picker), description on hover, Harbor charters (one Raise to 2:1 button per port city) and Ground work controls, and the Tech button in the action bar; draws its own DOM and styles |
| `render/bridgepicker.ts` | Tidebound T4c: one popup that sits over an ocean edge. On an empty edge (rickety bridges in the game) it is the type picker (Bridge or Rickety bridge, prices as mini cards, disabled with a reason); on your own rickety bridge it is the upgrade button. Draws its own DOM and styles; `renderBridgePicker` keeps it in step with each state or closes it |

## `tests/` (node:test / tsx)

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
| `addons.test.ts` | DLC and addon manifest, enabled sets, keyed registries, Rule of Two audit |
| `tidebound.test.ts` | Tidebound manifest (T0) and Bridges (T3a–T3e): 8 addons and links, lobby card data, DLC off changes nothing, bridge piece & ocean-only placement rule, cost & radius/VP scaling, 2x cost past 10, Longest Road across roads + bridges, `clientBoard` `pieceType`, and bot bridge building |
| `tideboundmap.test.ts` | T2a to T2c wide-water perk: registered only with the DLC, perk off = same map, canvas grows and land stays, island and continent gaps, wider river, warnings, helpers; `ext.elevation` and `ext.fish` data (counts, rarity, no draws, nothing without the pick) |
| `tideboundrickety.test.ts` | T4a to T4e rickety bridges: registration (on, off, rickety off), 1 wood cost and bridge placement rule, health 1, shared pool and supply mirror, pooled 2x cost, pool sync after a break, upgrade action (cost, refusals, double cost, legal list), bot build and bot upgrade, `bridgeUpgradeView` data, T4d collapse on a 7 in the Seven Resolver (`resolveSeven` and `roll` action, zero RNG draws, shared pool sync), and T4e Longest Road recalculation through the S0.10 change log (`pieceBroken` and `awardChanged` on loss, transfer, and ties) |
| `tideboundlobby.test.ts` | T2a2 lobby sees DLC map perks: room registry, per-room menu list, settings merge and share code follow the DLC toggles, lobby map, option list sent per socket |
| `tideboundtides.test.ts` | T5a to T5e and T6 tides (idle ports; `floodPlan`, the warning window, `tideClientView`, elevation data): registration (DLC off or Tides off = nothing, base flooded def), clusters (cover the coast once, second ring, connected, seeded, both phases, fog tiles left out), the formula, spring tide (two rings, all phases, keeps other tile states, old saves), `applyTides` (floods and dries, events), the round clock, no production while flooded, robber stays, no `g.rng` draws, JSON save and load; the tide level (five positions, clamping, schedule per level, spring cadence, reach, more flooding at higher levels, lobby setting and rule mapping); elevation resistance (elevation 1 to 3 against normal and spring tides, held tiles, draining, inland ring, production, no RNG) |
| `tideboundfishing.test.ts` | T7a fish token: registration (DLC off or Fishing off = no action, no state), `spend_fish` (bank, hand, refusals that keep the fish, legal list), a 7 counts fish and a discard can give fish up, the robber steals a fish, DLC-off steal pool unchanged, other players' fish hidden in `playerView` but counted in hand size, bot score |
| `tideboundnets.test.ts` | T7b1 fishing nets: registration (DLC off or Fishing off = no piece, no hook, no build), sea tiles at a vertex (by geometry on a lone island, none inland or in open water, river excluded), placement (own road or bridge, empty coast vertex, build phase only, inland and open water refused), build (price into the bank, supply, refusals change nothing, legal list, 2x at the base limit), the catch (about 1 in 6 per net, per owner, none without sea, seeded, same under a flood, a real roll draws the same dice and `g.rng` with nets on the board) |
| `tideboundnetsclient.test.ts` | T7b2 nets for the client: no net on a port vertex (and allowed again without the port), `netSpotsView` (same set as `canPlaceNet` and the legal build list, empty without your own road, `undefined` when nets are off, off your turn or outside main, empty with no supply), the net bot goal (registered only with Fishing on, price + 2 spare cards, nothing without a spot, supply or below the limit, prefers a fish icon, the brain builds it) |
| `tideboundfishgrounds.test.ts` | T7c to T7e fishing grounds: boosts (reading, doubled chance, earlier first catch on the same seed, one boost per catch and the icon stays at 0, richest tile first), tide replenish (reach by depth, slow, faster on a spring tide, none when dry, no growth past 4, seeded, no `g.rng` draw), feed the sea (registration, 1 wheat to the bank, fills no icon, empty and half-full grounds, every refusal changes nothing, main phase only, legal list), `fishClientView`, `feedSpotsView` and the feed bot score |
| `tideboundharbor.test.ts` | T8a and T8b harbors: DLC/addon off = nothing registered, `upgrade_harbor` (requires own city on a port and `HARBOR_COST`, sets `level: 2`, 1:1 on generic or resource port, zero `g.rng` draws), `HARBOR_LIMIT = 1` per player (2 with `tidebound.harbor_empire`), works while flooded (`PORT_IDLE_CHECKS` exemption and `isPortFlooded`), `harborSpotsView`/`harborClientView`/`harborBotGoal`, `HARBOR_MAX_TRADES = 4` per turn per harbor with 2:1 fallback and turn reset, and `explainInvalidBankRatio` harbor explanations |
| `tideboundwrecks.test.ts` | T9a to T9e shipwrecks: DLC/addon off = nothing registered, `tidebound.storm` event card and passive storm cadence with zero `g.rng` draws, 4-round wreck marker countdown, 65/35 sea/shore distribution and fair equidistant spawn within 4 hexes of a player, claiming on first connecting road/bridge/rickety bridge/port and immediate spawn claim, slow time scaling (+40% at 50 turns), Salvage crew (+25%), 2x-cost floor rule, bank-short handling, fish/dev bonus drops, `wreckClientView` (`shoreDir`), `wreckMarkup` sea/shore spawn animations, and `wreckBotGoal` |
| `tideboundpirates.test.ts` | T10a to T10d pirates: DLC/addon off = nothing registered, raid event card, ocean-only spawn within 4 tiles with zero `g.rng` draws, max 2 and no shared tile, passive schedule (round 4, every 4th, none with the Event Deck on), one random step a round, strength growth and cap, loot sizes, knights needed and the touching-piece rule, `drive_off_pirate` (loot paid from the bank, pirate removed, refusals), rob 2 cards (settlement, city, empty hand, every player in contact, cards conserved), flee chance rising and closeness bonus, fleeing away without robbing, keeping 2 tiles clear of stronger players, public view, bot goal |
| `golden.test.ts` | Golden baseline: seeded bot games hashed against `golden.snapshot.json` |
| `rounds.test.ts` | Round clock: `g.round`, round hooks, `everyNRounds` |
| `score.test.ts` | `score()`, `publicVP()`, score modes, `checkWinner` |
| `pricing.test.ts` | Piece cost and limit service, cost modifiers |
| `botgoals.test.ts` | S0.14 Bot goal registry: tier gating (`main`/`secondary`/`overload`), missing-card integration, custom action execution |
| `persistence.test.ts` | S0.15 Persistence: save/load round-trip, hard caps, public-only event filter, schema migration, Render `CTMEM1.` export/import |
| `simmatrix.test.ts` | S0.16 Sim matrix: scenarios × DLC/addon combos × tech tree on/off × bot tiers, invariant checks, `botTested` badge flag |
| `clankerton_s0.test.ts` | S0.5–S0.11 shared engine services: trade ratios, production pipeline, tile state/durability/wild tokens, Seven Resolver, markers/ledger/strength/relations, history/stats, seeded event deck |
| `stage1.test.ts` | Stage 1 core systems & proving-ground content (S1.1–S1.5): Taxes & Catch-up, Public Contract Board, Spies, Tech Tree & Local Nemesis & Round Recap, Karaoke 7, Bot Drinking Game, Hats, Sandbox Economy |
| `techroots.test.ts` | Effects of the 5 root techs, the two tech actions, the port level (T1a), the harbor-only 1:1 floor (T1c), bot tech tree research/action decisions, and the tree-off no-effect check |
| `golden.snapshot.json` | Recorded hashes for the golden test (created on its first run) |

