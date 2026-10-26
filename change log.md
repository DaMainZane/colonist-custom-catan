# Change Log

## 2026-10-26 08:30:12 (Pass 25: Bank trade ratio advice, board-scaled bank and dev deck, turn clock bar, human discard clock; untested)
### Added
- **Bank Trade Ratio Advice + "Fix amounts"** (`src/client/render/drawer.ts`, `src/client/main.ts`, `src/client/styles.css`) — `2026-10-26 08:30:12`:
  - `bankTradeAdvice()` explains why the give/get cards are not a legal bank trade using the player's own rates (4:1 bank, 3:1 port, 2:1 port), names the better port rate when one applies, and `fixBankTrade()` (the "Fix amounts" button) rounds give piles to legal sizes and matches a single give pile to what was asked for. The disabled Bank button now carries the reason as its title. New `.trade-hint.warn` style.
- **Turn Clock Countdown Bar** (`src/client/render/turnclock.ts`, `src/client/styles.css`) — `2026-10-26 08:30:12`:
  - A draining bar (`.turn-clock-bar`) next to the clock text in the turn pill, red in the last 10 seconds. The bar length is the base time or the first time left seen for that turn (it only grows when actions add time). The turn timer itself already existed (lobby > Rules and cards > Timers, 0 = off).
- **Shape Fallback Tag** (`src/client/mapmenu.ts`) — `2026-10-26 08:30:12`:
  - A red "shape not applied" tag in the map report when the generator reports `shape-fallback` (plain hexagon used). Diagnostic only; the cause of the bug is not found yet.

### Changed
- **Bank and Dev Deck Scale With the Board** (`src/server/runtime.ts`, `src/server/game.ts`) — `2026-10-26 08:30:12`:
  - New `scaledSupply(players, landHexes)`; `settingsForPlayers` takes the land tile count. Only when the host left bank and dev numbers at the standard values: bank = max(table floor, 0.8 x land tiles), dev deck = max(table floor, 1.2 x land tiles), victory point cards stay at 5 until the deck is large. The standard 19-tile board is unchanged.
- **Discard Clock for Humans** (`src/server/turnClock.ts`, `src/server/bots/scheduler.ts`) — `2026-10-26 08:30:12`:
  - While a human owes a discard after a 7, that human is on the clock even when a bot plays the turn. On expiry every human who still owes is discarded with the bot brain. After the discard phase the turn owner starts a fresh full clock.

## 2026-10-26 08:21:00 (Pass 24: Seed hide toggle, bigger pieces, scrolling lobby dock, more built-in presets)
### Added
- **Seed Hide/Show Toggle** (`src/client/mapmenu.ts`, `src/client/main.ts`) — `2026-10-26 08:21:00`:
  - Hide/Show button on the lobby seed line. Personal setting kept in `localStorage` (`hexsettlers.seedHidden`); a hidden seed shows as dots and the seed edit box starts empty. Copy still works while hidden.
- **11 More Built-in Preset Chips** (`src/packs/base/map/index.ts`, `src/packs/gold/index.ts`, `src/packs/fog/index.ts`, `tests/mapmenu.test.ts`, `tests/mapsettings.test.ts`) — `2026-10-26 08:21:00`:
  - Beginner, Realistic continent, Balanced continent, Island hopper, Ring lagoon, Lakeland, Chaos (base); Mountain gold, Gold islands (gold); Fog ring, Fog continents (fog). Recipes only (picks), so no rule presets. The two tests that assert the preset list were updated.

### Changed
- **Bigger Settlements and Cities** (`src/client/render/board.ts`) — `2026-10-26 08:21:00`:
  - `BUILDING_BASE_SCALE` 1.5 (was 1.22) and a 2.8 cap (was 2.35) for the zoom-adaptive scale.
- **Lobby Dock Scrolls Instead of Growing** (`src/client/styles.css`) — `2026-10-26 08:21:00`:
  - `#lobbyToolbar` is capped at `calc(100vh - 24px)` with its own scroll; `.right-sidebar` clips to the screen, the player list scrolls and the bank bar keeps its size so log and chat stay visible.

### Fixed
- **Typecheck Error After Pass 23** (`src/client/render/board.ts`) — `2026-10-26 08:21:00`:
  - Removed a leftover `syncBoardBuildPopup()` call in `syncInFlightUiImmediate()`.

## 2026-10-26 08:09:10 (Pass 23: Revert on-board road/settlement/city click recipe popups; restore direct click-to-build/upgrade while keeping action-bar hover recipes)
### Changed
- **Reverted On-Board Settlement, City & Road Click Build + Recipe Popup** (`public/index.html`, `src/client/store.ts`, `src/client/render/board.ts`, `src/client/main.ts`, `src/client/styles.css`) — `2026-10-26 08:09:10`:
  - Removed `#boardBuildPopup`, `.vertex-select-glow`, `selectedBoardVertexId`, and `selectedBoardEdgeId` so clicking a buildable settlement spot, road spot, or your own upgradable settlement on the board builds/upgrades immediately with no middle confirmation popup.
  - Kept the hover resource recipe strips (`#recipePopupDev`, `#recipePopupRoad`, `#recipePopupSettle`, `#recipePopupCity`) on the bottom-right action buttons below the dice (`Dev`, `Road`, `Settle`, `City`) as well as the `Road Length: <N>` hover tooltip on placed roads.

## 2026-10-26 06:36:12 (Pass 22: Big-map & zoom-out performance optimization, bot roll/card animation pacing fix & mouse-wheel scrolling on Rules/Cards numbers)
### Optimized
- **Zoom-Out & Large-Map Rendering / Panning Performance** (`src/client/render/board.ts`, `src/client/main.ts`, `src/client/styles.css`) — `2026-10-26 06:36:12`:
  - Split `#boardSvg` into persistent `<g>` layers (`#boardTerrainLayer`, `#boardHexDynamicLayer`, `#boardPortsLayer`, `#roadHighlightLayer`, `#roadRimsLayer`, `#roadBodiesLayer`, `#roadHitsLayer`, `#roadSpotsLayer`, `#boardVerticesLayer`) with dirty-key caching (`lastTerrainKey`, `lastPortsKey`, `lastPlacedRoadsKey`) and precomputed hex geometry (`ensureHexGeomCache`) so gameplay ticks never re-parse static hex tiles, terrain icons, tokens, or port bridges.
  - Combined all shallow-water bank polygons into a single `<path>` and all sand beach polygons into a single `<path>` (reducing `2 × N` heavy `<polygon>` nodes to 2 `<path>` nodes on large maps).
  - Removed expensive SVG `filter: drop-shadow(...)` blurs from `.port-ring`, `.spot-pulse`, `.road-spot-dot`, `.target-ring.upgrade`, and `.vertex-select-glow` in favor of crisp vector strokes, and disabled endless CSS pulse animations on large maps (`hexes > 30`).
  - Coalesced camera pan/zoom updates into `requestAnimationFrame`, cached `getBoundingClientRect()` on drag start, added `.is-panning` on `#boardSvg` during drag to skip browser SVG pointer hit-testing and pause animations while moving around, and cached `analyzeRoadConnection()` in `roadAnalysisCache` (bounded at 4,000 DFS steps).

### Fixed
- **Premature Bot Actions During Roll & Card Delivery Animations** (`src/server/types.ts`, `src/server/game.ts`, `src/server/net.ts`, `src/server/bots/scheduler.ts`, `src/client/render/board.ts`) — `2026-10-26 06:36:12`:
  - Added `animDelayMs` on `room.fx` and `animatingUntil` on `Room` (`1550ms` for resource-producing rolls, `1150ms` for setup production and card transfers/steals/monopoly/year-of-plenty/dev buys, `750ms` for robber movement, `700ms` for non-producing/7 rolls).
  - Updated `scheduleBots()` to clear any pending timer and wait for `Math.max(0, room.animatingUntil - Date.now()) + thinkMs` before bots trade, rob, discard, or make moves, and added `peekNextBotDelay()` so bot board searches only run once when the timer fires.
  - Updated client `triggerFlyingResourceAnimations()` and `triggerCardTransferAnimations()` to launch producing hexes in parallel (`180ms` roll lead-in + `30ms` per-hex stagger + `110ms` stack stagger, `780ms` flight) and coalesced `syncInFlightUi()` via `requestAnimationFrame` so cards always land in hands before the next bot action starts.

### Added
- **Mouse Wheel Scroll on Numbers in Rules & Cards Menu** (`src/client/main.ts`, `src/client/actions.ts`, `src/client/render/index.ts`, `src/client/styles.css`) — `2026-10-26 06:36:12`:
  - Hovering over any number input (or its `.field` row) in the Rules and Cards menu (`#lobbyTabCards` / `#lobbyToolbar`) and scrolling the mouse wheel up or down increments or decrements the value by `step` (`5 × step` when holding `Shift`), clamped to `[min, max]`, with debounced settings sync (`schedulePushSettings`) and without zooming the background board.

## 2026-10-26 00:28:34 (Pass 21: Zoom-adaptive settlement & city scaling)
### Added
- **Zoom-Adaptive Settlement & City Scaling** (`src/client/render/board.ts`, `src/client/icons.ts`, `src/client/styles.css`) — `2026-10-26 00:28:34`:
  - Settlements and cities now scale up dynamically via `--building-scale` (`.building-zoom-scale`) as the camera zooms out or when viewing larger boards (from `1.22x` at standard zoom up to `2.35x` when zoomed out), with a thicker `3.8` light rim so all players' buildings remain clearly visible at any zoom level.

## 2026-10-26 00:22:38 (Pass 20: On-board road click build + recipe popup)
### Added
- **On-Board Road Click Build + Recipe Popup** (`src/client/store.ts`, `src/client/render/board.ts`, `src/client/main.ts`) — `2026-10-26 00:22:38`:
  - Clicking a buildable road edge on the hex board highlights the road midpoint with a glowing white circle (`.vertex-select-glow`) and opens `#boardBuildPopup` directly above the road midpoint showing the square Road build button (with remaining road count badge) and the `[wood][brick]` recipe strip (or no cost strip when using free roads from Road Building).

## 2026-10-26 00:12:56 (Pass 19: Road length hover tooltip, action bar hover recipes & on-board vertex build popup)
### Added
- **Road Length Speech-Bubble Tooltip on Hover** (`src/client/render/board.ts`, `src/client/styles.css`) — `2026-10-26 00:12:56`:
  - Hovering any road on the board now shows a centered dark speech-bubble tooltip with a downward pointer arrow (`Road Length: <N>`) directly above the hovered road, along with the connected road network halo.
- **On-Board Settlement & City Click Build + Recipe Popup** (`public/index.html`, `src/client/store.ts`, `src/client/render/board.ts`, `src/client/render/hand.ts`, `src/client/main.ts`, `src/client/styles.css`) — `2026-10-26 00:12:56`:
  - Clicking your own settlement or a road-connected empty settlement vertex on the hex board highlights the vertex with a glowing white circle (`.vertex-select-glow`) and opens a floating `#boardBuildPopup` directly above the vertex.
  - Displays the square Settlement or City build button (with remaining piece badge) and the horizontal resource card recipe strip (`[wood][brick][sheep][wheat]` for Settlement, `[wheat][wheat][ore][ore][ore]` for City) where cards currently held in hand are lit (`has-res`) and missing cards are dimmed (`lacks-res`).
- **Action Bar Hover Recipe Popups (Dev, Road, Settlement, City)** (`public/index.html`, `src/client/render/hand.ts`, `src/client/styles.css`) — `2026-10-26 00:12:56`:
  - Hovering `#btnBuyDev` (`[sheep][wheat][ore]`), `#btnBuildRoad` (`[wood][brick]`), `#btnBuildSettle` (`[wood][brick][sheep][wheat]`), or `#btnBuildCity` (`[wheat][wheat][ore][ore][ore]`) in the bottom action bar displays its resource card recipe strip directly above the button (even when the button is disabled), highlighting owned vs. missing cards in real time.

## 2026-10-25 23:59:10 (Pass 18: Resource & dev card hand arrival timing fix)
### Fixed
- **Resource & Dev Card Hand Arrival Timing** (`src/client/store.ts`, `src/client/render/board.ts`, `src/client/render/hand.ts`, `src/client/render/sidebar.ts`, `src/client/main.ts`) — `2026-10-25 23:59:10`:
  - Newly produced or transferred cards are no longer shown immediately in `#myHandPanel` (or the sidebar player card counts) while their flying card animation is still in mid-air.
  - Added `inFlightHandResources`, `inFlightPlayerResCount`, `inFlightPlayerDevCount`, and `inFlightMyDevCards` tracking in `store.ts`: each flying card holds back its card count until the exact moment its flight transition finishes (`flightMs`), then releases it and re-renders the hand and sidebar as the flying card lands.

## 2026-10-25 22:08:47 (Pass 17: Required player nickname input, your-turn chime, unified victory icons, 0.5x game speed lock & victory screen optimization)
### Added
- **Your Turn Sound Effect** (`src/client/audio.ts`, `src/client/main.ts`) — `2026-10-25 20:40:06`:
  - Added `playYourTurnSound()` (warm two-note rising notification chime) that plays whenever an active game turn transitions from another player (or lobby) to the local player.
- **Unified 24×24 Pictogram Icons for Victory Screen** (`src/client/icons.ts`, `src/client/render/index.ts`, `src/client/styles.css`) — `2026-10-25 20:40:06`:
  - Added flat `UI_ICONS` (`star`, `robber`, `gift`, `crown`, `tree`, `bricks`, `wool`, `grain`, `rock`) so every column header across all 5 matrix tabs (`Overview`, `Res Card Stats`, `Dev Card Stats`, `Activity Stats`, `Resource Stats`) renders a uniform `20×20` `uiIcon(...)` inside an identical `34×34` `.vic-head-badge` container (with `.vic-head-badge.primary` accent styling on primary total columns).

### Changed
- **Required Player Nickname Input** (`public/index.html`, `src/client/actions.ts`, `src/server/socket.ts`) — `2026-10-25 22:08:47`:
  - Removed the pre-filled `AvocadoMan` default value from `#playerNameInput` and added client + server validation requiring players to type a nickname before creating or joining a game.
- **Game Speed Locked at `0.5x` & Speed UI Removed** (`src/server/runtime.ts`, `src/server/lobby.ts`, `src/server/socket.ts`, `src/client/store.ts`, `src/client/actions.ts`, `src/client/main.ts`, `src/client/render/index.ts`, `public/index.html`) — `2026-10-25 20:40:06`:
  - Default server and client `gameSpeed` is now locked at `0.5` (`0.5x`).
  - Removed the navbar speed badge (`#navSpeedBadge`), settings menu speed slider & preset buttons, lobby toolbar speed selector (`#setGameSpeedHeader`), rules & cards speed selector (`#setGameSpeed`), and the `setGameSpeed` socket handler.
- **Victory Screen & Confetti Performance Optimization** (`src/client/styles.css`, `src/client/render/index.ts`, `src/client/ui.ts`) — `2026-10-25 20:40:06`:
  - Replaced `backdrop-filter: blur(4px)` on `#victoryOverlay` with a solid `#14181c` backdrop + `contain: layout paint`, eliminating full-viewport GPU blur recomputation over the SVG board.
  - Added `#gameViewport.victory-modal-open #boardSvg * { animation-play-state: paused !important; }` to pause underlying SVG animations while the victory modal is open.
  - Memoized `renderVictoryScreen()` (`lastVicRenderKey`) and skipped redundant `renderBoard()` rebuilds while `#victoryOverlay` covers the viewport.
  - Streamlined `triggerVictoryConfetti()` to a 1x resolution cap (`<= 1280px`), 80 lightweight rectangle particles using direct `ctx.setTransform` + `fillRect`, and a 2.8s duration.

## 2026-10-25 20:40:06 (Pass 16: Map Generation finishing pass)
### Changed
- `GEN_VERSION` is 2. John confirmed saved seeds do not need to replay across updates (presets keep the snapshot, and "same style, new seed" rolls a fresh one anyway). The recipe's `g` now tells an old seed apart from a current one, and the lobby shows the `older generator` tag for it. The version covers three changes that alter what a seed gives: the board loop redrawing tokens (Pass 14), the ring band below, and the `island_mix` perk existing.
- `tests/mapbudget.test.ts`: limits are no longer ten times the targets. After reading the printed table (r8 and below: medians 4 to 24 ms; r20: medians 51 to 117 ms, hexagon slowest) they are median under 60 ms for radius 8 and below and under 300 ms for radius 20, board attempts at most 3.
- Ring (`packs/base/map/shapes.ts`): from radius 4 up, the two rings next to the lagoon are always land when the land budget allows (the lagoon shrinks if it must), so the band is at least 2 tiles thick all the way round. Below radius 4, or when the land share is too low, the old band is kept.

### Added
- `thin-neck` warning (`mapcheck.ts`, `countPinches`, option `checkNecks`, switched on for the ring from radius 4): counts land tiles squeezed between water on two sides (their land neighbours form two or more arcs). It is a local test on purpose: a closed ring has no cut tile, so "removing one tile splits the land" never fires on a ring. A warning, not an error, so a ring is never refused for it.
- `island_mix` perk ("Mixed islands", `shared/mapmix.ts`, flag `GenFlags.islandMix`): after the terrain style has placed the tiles, every landmass of 4 or more tiles that has fewer than two resource types swaps one tile with another landmass (random choice from the stream `seed:islandmix:<terrain attempt>`). The tile counts never change, a donor island of 4 or more tiles must still keep two resource types, and desert does not count as a resource. Three passes at most; an island that cannot be fixed (no other island has a resource to spare) keeps its `one-resource-island` warning. It appears in the menu's Perks column with no client change.
- Menu: a Settings block under the two columns with one slider for every param of the active options except `land` (islands count, continents count, gap and stretch, lake share and count, river length, satellites, ragged amount, ring lagoon, gold and fog share if a pack declares them). Drawn from `mapOptions`, so a pack's new param appears without a client change. `mapParamInput` and `mapParamChange` in `client/mapmenu.ts`, registered on `window` in `main.ts`, CSS `.map-params` at the end of `styles.css`.
- `tests/mapmix.test.ts`: `mixIslands` on hand-made cells (fixes a one-resource island, keeps counts, deterministic, refuses to strip a donor, leaves islets and single landmasses alone), the perk over many seeds (land and counts unchanged, never more lonely islands), the unfixable all-wood map, `countPinches` and the ring band on hand boards, generated rings from radius 4 to 8.

### Notes
- Written without a shell again: run `npm run typecheck; npm test`. Two existing tests were updated for this pass: the share code in `mapgen.test.ts` now uses `GEN_VERSION` instead of a literal `g=1`, and the perk list in `mapsettings.test.ts` includes `island_mix`.
- Not checked in a browser: the whole map menu (Pass 15) and the new Settings block. Look at the open and close, the picks, the sliders (live number while dragging, one request on release), the seed row, presets, and the layout on a phone.
- Still not built: the design's shape-stage `portPolicy` per shape beyond what ports per landmass already does, and a UI to hide the seed from non-hosts (parked in the design, section 5.8).

## 2026-10-25 20:40:06 (Pass 15: Map Generation M6, lobby map menu)
### Added (server)
- `src/server/mapmenu.ts`: `mapOptionsView()` turns the registry's shapes, terrain styles, number styles and perks (id, label, description, stage, phase, slot, default, conflicts, requires and whether they are met, `secret`, params) and the quick starts into plain JSON. `socket.ts` sends it once per connection as the `mapOptions` event, so a pack that registers an option shows up in the menu with no client change.
- Presets v2 (`src/server/presets.ts`): `CustomPreset.v` is 1 or 2; a v2 preset also holds `recipe` (null for a hand-painted map, Blank, or when saved without a recipe) and `genVersion`. `serializePreset(board, settings, name, meta?)` keeps the recipe only when the map is not `edited`. `loadPreset` returns `recipe` (cleaned by `makeRecipe`; a non-recipe becomes null). v1 presets load unchanged.
- `applyLoadedPreset(room, loaded)`: the snapshot is the map, exactly as saved. With a recipe, the seed, picks, params and radius come back into the settings (through `mergeSettings`, so unknown ids and wild numbers are dropped or clamped) and `room.mapMeta` is rebuilt with a fresh `validateBoard` report, so the seed line stays meaningful. Without one, `mapMeta` is cleared as before.
- `presetStyle(raw)` and `applyRecipeStyle(room, style)` (`lobby.ts`), and the `applyPresetStyle` event: a v2 preset's radius, picks and params with a fresh seed ("same style, new map").

### Added (client)
- `src/client/mapmenu.ts`, drawn into the new Map row of the lobby dock (`#mapRecipe`):
  - A header line summarizing the active options ("Continent + Lake · Realistic · Fog") that opens the menu, and a Reroll button (host).
  - The menu has two columns: Shape (slot members as radios, add-ons such as Lake, River, Satellites and Ragged coast as checkboxes, then the land slider) and Terrain, Numbers and Perks. Ticking sends only the new `mapPicks`; the server resolves slots and conflicts (the later pick wins). A slot's default is "nothing picked". Picking another base shape drops the stored land value so the new shape's own default applies.
  - Seed line: the seed (click to copy), Copy code (the `hx1;...` share code), and for the host Edit (type a seed or paste a share code, Enter applies, Esc cancels), Lock (keep the seed on rematch) and Save as preset. Non-hosts see the seed read-only, Fog included (design 5.8).
  - Report line from `mapMeta.report`: landmasses, spots, ports, fairness, plus tags for `edited by hand`, `older generator`, `best of N tries` (degraded), `small for N players` (2 spots per player against the biggest landmass), and error and note counts with the messages in the tooltip.
  - A painted map is not replaced by accident: the first click on Reroll, a pick, the land slider or a seed change only warns, the second goes through (4 seconds).
- The built-in preset chips are drawn from `mapOptions.quickStarts` (a fallback list shows until it arrives), so a pack's quick start appears without touching `index.html`. The Archipelago chip now reads "Archipelago" (the registered label).
- A saved preset with a recipe gets a second small button, "same style, new seed".
- `tests/mapmenu.test.ts`: the option list, the lobby view's `mapMeta`, presets v2 (save, load, v1 compatibility, hostile recipes, new seed).

### Notes
- Written without a shell: run `npm run typecheck; npm test`, then open the lobby and look at the menu (spacing and the dock height on a phone are guesses).
- Not done: UI for params other than land (island count, lake share, fog share and so on are in the schema and the share code, as planned), greying options by `requires` is drawn but no v1 option uses it, and the menu does not mark which slot members a pick will replace beyond the tooltip.
- `GEN_VERSION` is still 1 (see Pass 14).

## 2026-10-25 20:40:06 (Pass 14: Map Generation M5, validation)
### Added (step 1: the board loop)
- `generateMap` runs stages 5 to 8 as an attempt and repeats it, up to `boardAttempts(radius)` times (12 up to radius 20, 4 up to 30, 2 above). The shape is chosen once and never changes. A pass is no errors and no `low-fairness` warning. If no attempt passes, the best one is kept (errors count most, then low fairness, then touching reds; ties keep the earlier attempt) and the report gets `degraded: true`. It never throws.
- `report.stats.boardAttempts` (optional) is the number of attempts run; `stats.attempts` is still the shape stage's count.
- Attempt 0 uses the same RNG streams and noise names as before, so a board that passes first time is unchanged. Later attempts draw the number stage from `seed:numbers:<attempt>`.
- An error that another token layout cannot fix (`land-count`, `landmass-too-small`, `too-few-spots`, `no-land`) ends the loop at once: more attempts would only cost time. `resource-missing` is a terrain problem, so the next attempt also redraws the terrain (terrain attempt 1, 2, ...).
- `tests/mapretry.test.ts`: attempt counts, degraded only when a check really failed, determinism, no crash over the shape x style x radius matrix, the no-pass case (35 wood), and that the land set and tile counts survive a retry.

### Added (step 2: flags and per-shape checks)
- `GenFlags` gained `balanceCheck` (default true) and `thinLand` (default 0.25). `balanced` and `feast_famine` set `balanceCheck: false` (the weak-resource warning has nothing to say there); `ragged` raises `thinLand` to 0.4 (a long broken coast is the point).
- `requireConnected` is read now: `hexagon`, `continent` and `ring` declare it, `validateBoard` turns split land into a `not-connected` error when it is set. It is switched off while `satellites` is picked (islets are separate by design). The check is order independent because only some shapes ever set it. `not-connected` is a shape error, so it ends the board loop at once.
- New warning `one-resource-island`: on split land, a landmass of 4 or more tiles whose tiles all give the same resource (terrain is dealt over the whole map, so a small island can end up with one).
- `ValidateOptions` gained `requireConnected` and `thinLand`.
- Not built from design section 6.8: the ring band thickness check (the generic thin-land warning covers a 1-wide band) and the "island of 4 or more tiles gets at least 2 resource types" option (only the warning exists).

### Added (step 3: bots on every shape)
- `simulateGame` takes `picks` (and `mapParams`): the board then comes from `generateMap` with the sim seed, like the lobby, instead of the legacy preset. `tests/mapsims.test.ts` plays 12 recipes (every shape, lake, river, satellites with ragged, realistic, balanced, feast or famine, gold, fog, clustered) with 3 bots on radius 4 and checks for no rejected action, no stall, no broken invariant. Whole-land recipes must finish; split-land ones may end with "no winner after N turns", since nobody can cross water before ships exist.

### Added (step 4: budget)
- `tests/mapbudget.test.ts` times `generateMap` (median of several seeds) for five recipes at radius 4, 8 and 20 and prints a table. The asserts are ten times looser than the targets (radius 8 within about 20 ms, radius 20 within about 100 ms): read the printed numbers, then tighten the limits. Above radius 20 the board loop runs fewer attempts (`boardAttempts`).

### Notes
- Deviation from design section 11: the loop redraws only the tokens (and the terrain on `resource-missing`), not terrain, extras and ports on every attempt. Fairness is a token property, and redrawing the terrain would break the stage independence of section 5.1 (a number style would change the tiles). Extras (fog) and ports keep their attempt-0 streams.
- `GEN_VERSION` is not bumped. A board that failed the fairness check before now gets a redrawn token layout, so for those recipes the output differs from Pass 13. Bump it if saved seeds from before this pass must stay replayable.
- Written without a shell: run `npm run typecheck; npm test`. A recipe that never passes builds up to 12 boards, which the budget test shows.
- Not done: switching the start check from `players x 8` vertices to `spots` (design says wait until tests show they agree), and the lobby display of the report (M6; `mapMeta` already carries the report, `degraded` included).

## 2026-10-25 20:40:06 (Pass 13: Map Generation M4, terrain and numbers)
### Added (step 1: cell info, spread and clustered)
- `CellInfo` is now `{ q, r, h, m, coastDist, landmass }`. `src/shared/mapcells.ts`: `buildCellInfo` (land cells in canvas order; `h` and `m` rank-normalized over the land cells; `coastDist` 0 on every land cell with fewer than 6 land neighbours; landmass index in discovery order), `cellNeighbours`, `rankNormalize`. `generateMap` builds it once and hands it to the terrain and number styles.
- `runShape` returns `h` (the height field by canvas index), or `null` when the shape never drew one (hexagon, islands, archipelago, continents, the fallback). Then the cell info uses the terrain stage's own noise for height.
- `src/shared/mapterrain.ts`: `swapPlace`, the swap-energy placement behind `spread` and `clustered`. Start from a shuffle, swap two cells, keep the swap when the same-type pair count moves the right way (or stays equal), keep a worse one with a chance that cools to 0 by the last sweep. Only swaps, so counts are preserved. Half of the proposals are local (a 2-step walk), so patches can move. `exp` is avoided: the chance of losing `d` pairs is `warmth` multiplied `d` times.
- Terrain styles `spread` (param `spread.strength`, sweeps, default 8) and `clustered` (`clustered.strength`, default 12) in `src/packs/base/map/terrain.ts`. Strength 0 is the plain random board.
- `tests/maptiles.test.ts`.

### Added (step 2: number flags and `balanced`)
- `assignNumbers(cells, pool, rng, opts)` takes `{ hotTouch, equalTouch, group }`. Defaults give the same tokens and RNG order as before. The swap loop is now `settleNumbers`, also exported. With `group`, a token only trades places with a tile of its own group.
- `standard` and the fallback in `generateMap` pass the effective flags, so a pick with `ruleOverrides: { hotTouch: 'allow' }` really turns the 6/8 rule off. `requireConnected` is still read by nothing (a structural check, M5).
- `dealBalanced`: best tokens first, each to the resource group with the lowest running pip total that still has a free tile, then shuffled inside the group; `settleNumbers` fixes touching reds inside groups only, so totals hold (best effort for 6/8). Gold is its own group. Registered as `balanced` in `src/packs/base/map/numbers.ts`.
- Number styles now receive `type` on each cell (`CellInfo.type`, optional, set only for the number stage).

### Added (step 3: `feast_famine`)
- `dealByRichness` in `numbers.ts`: a low-frequency noise field over the numbered tiles is rank-normalized to 0..1, jittered by `mix`, and the pool (sorted by pips) is dealt by rank, best pips to the richest tiles. No settle pass. Registered as `feast_famine` with `ruleOverrides: { hotTouch: 'allow' }` and param `feast_famine.mix` (percent, default 25) in `src/packs/base/map/numbers.ts`.

### Added (step 4: `realistic`)
- `Habitat { h?, m?, weight? }` and an optional `TileDef.habitat` in `registry.ts`. Targets are on the 0..1 rank scale of `CellInfo.h` and `m`; leave one out for "any". Values follow design section 7: ore `h 0.9`, brick `h 0.65 m 0.35`, wood `h 0.5 m 0.8`, sheep `h 0.35 m 0.5`, wheat `h 0.25 m 0.3` (base pack, `content.ts`), desert `m 0` with weight 3 (driest cells), gold `h 0.85` with weight 2 (gold pack, next to the ore).
- `habitatPlace` in `mapterrain.ts`: tile types with a habitat fill first, strictest first (`weight` high to low, then fewer tiles, then id); each takes the free cells with the smallest misfit `|h - target| + |m - target|`. Types without a habitat fill the leftovers in random order. Then `sweeps` rounds of swaps that only keep a swap when the total weighted misfit drops. Only swaps, so counts are preserved. A size mismatch falls back to a plain shuffle.
- Terrain style `realistic` (param `realistic.sweeps`, default 3) in `packs/base/map/terrain.ts`. It reads each tile's habitat from the registry, so a pack's own tile is placed sensibly with no change here.
- `habitatPlace` is exported from `shared/index.ts` (the pack imports it from there).
- `tests/maptiles.test.ts`: habitat on every shipped tile, `habitatPlace` on synthetic cells (high ground high, dry tile on the driest cells, zero sweeps, size mismatch). The "every terrain style keeps the counts and the land" tests pick `realistic` up from the registry.

### Notes
- Written without a shell: run `npm run typecheck; npm test`. Design section 7 says `s < 0` spreads and `s > 0` clusters but also says to keep a swap when `E` drops; those two disagree. The code uses `E = -like x pairs` (`like = 1` clusters), so the behaviour matches the names.
- M4 is complete. `GEN_VERSION` is untouched. The habitat values, the sweep default and the feast or famine noise frequency are starting guesses: judge them on the gallery script (`tools/mapgallery.ts`, still to do) before trusting them.
- Next is M5 (checks, two-level retry, `spots`, report to the lobby, budget measurement, `requireConnected`).

## 2026-10-25 20:40:06 (Pass 12: Map Generation M3, shapes and ports per landmass)
### Added
- `src/shared/mapshape.ts`: the land field the shape stage works on (`LandField`: heightfield, `locked`, `keep`, `river` and `sat` flags, one index per canvas cell), `fillHeight` (noise plus pull toward the center minus a soft rim penalty), `takeTop`, the exact count fix `fixCount` (add the best-ranked water cell next to land, or remove the worst-ranked coastal cell whose land neighbours form one unbroken arc, so land never splits), `cleanupField` (largest landmass, spikes, one-cell holes, exact count), `growBlobs` / `pickCenters` / `splitSizes` for multi-landmass shapes, and `runShape` (tweak, base, carve, scatter; up to 40 attempts, each with its own RNG stream and noise; falls back to the plain hexagon and never throws). Only `runShape`, `SHAPE_ATTEMPTS`, `MIN_LAND` and the types are exported from `shared/index.ts`; the generic helper names stay in `mapshape.ts`.
- `src/packs/base/map/shapes.ts`: base shapes `continent`, `ring`, `islands`, `archipelago`, `continents`; carve ops `lake` and `river`; scatter op `satellites`; tweak op `ragged`. `ShapeOpDef` gained `budget` (cells a carve or scatter op will remove or add, so the base builds the right number and the final land count is exact) and a typed `run(field, ctx)`.
- `river` (from John's sketch): starts on a shore tile, each step goes through a random side of the current tile, a branch chance that grows with every step without a split. A step may only enter a tile whose only water neighbour is the channel it comes from and that keeps one arc of land around it, so a river is an inlet that never reaches the sea or a lake a second time and never cuts the land in two. River hexes are water with `ext.river`; they get no ports.
- Params (clamped by the registry as before): `land` (30 to 90, per base shape), `ring.lagoon`, `islands.count`, `archipelago.count`, `continents.count`, `continents.gap`, `continents.stretch`, `lake.share`, `lake.count`, `river.length`, `satellites.count`, `ragged.amount`. Counts of 0 mean automatic.
- `topology.ts`: `portMode: 'coast'` and `portOffset`. Ports per landmass on open-sea coast only (lake, lagoon and river shores excluded): about one port per 3.3 coast edges, split by coast length, at least 1 for a landmass of 6 or more tiles, 0 under 3 tiles, at most 1 under 6 tiles, spaced evenly along each coast, types dealt round-robin over the landmasses. The coast is walked edge by edge (`walkCoast`), not sorted by angle, and a second pass fills any shortfall. Rules: one port per hex and none on a corner next to a port; ports on neighbouring hexes are allowed (the old no-neighbour rule capped the standard board at 6 ports, not 9). `generateMap` uses this for the plain hexagon too (9 ports on the standard board), and `loadPreset` and the lobby painter rebuild with `portMode: 'coast'` so saved and generated ports survive. The classic `'angle'` placement is untouched and still used by `generateBoard` (engine, sims).
- Quick start `archipelago` (picks `['archipelago']`) replaces the old water-chance chip.
- `tests/mapshapes.test.ts`.

### Changed
- `generateMap`: the shape stage decides which canvas cells are land. Terrain, numbers and extras work on the land cells only, every other canvas cell becomes a `water` hex. A recipe without shape picks is the plain hexagon and gives the same board as M2 (no RNG is used for it). Picks that clash with the default hexagon (`ragged`, `satellites`) sit on a `continent`.
- Deviations from the design text: land density is a share of the whole canvas (`round(cells x land%)`) and the rim is a soft penalty instead of a hard margin, so a big density still reaches the edge; the cheap shape check asks that the biggest landmass could hold about 8 spots (estimated vertices of at least 24) instead of an exact spot count (that is M5); a `ring` core band is forced to land so the lagoon stays enclosed.
- `tests/mapsettings.test.ts`: the `archipelago` quick start is expected, and the Archipelago chip now returns a recipe and `mapMeta`.

### Notes
- Written without a shell on the repo, same as Pass 11. Run `npm run typecheck` and `npm test` and look at `tests/mapshapes.test.ts` first. It skips a map that fell back to the hexagon and has one test that bounds the fallback rate at 25% over radii 4 to 8; if it fails, look at which shape fell back before loosening it.
- Every number here (noise frequency and strength, pull 0.9, rim penalty 0.8, compactness bonus in `growBlobs`, ring ridge slope) is a starting guess. The gallery script (`tools/mapgallery.ts`, design section 15) is still to do and is the way to tune them.
- Not done yet: terrain and number styles (M4), `habitat`, the full check list and the report in the lobby (M5), the lobby UI (M6). Per-shape extra checks (ring band thickness, spots per landmass, island terrain mix) are only the cheap versions in `shapeOk`.
- `PresetDef` and the legacy `archipelago` preset stay registered so `generateBoard`, the sims and old tests keep working.

## 2026-10-25 20:40:06 (Pass 11: Map Generation M2, registry and settings)
### Added
- `src/shared/mapoptions.ts`: option types (`ShapeOpDef`, `TerrainDef`, `NumbersDef`, `PerkDef`, `QuickStartDef`, `ParamDef`, `MapCtx`, `GenFlags`) and the pure resolvers: `resolvePicks` (unknown and unmet ids dropped, later pick wins on a shared slot or a declared conflict), `resolveMapOptions` (adds the default of each empty slot), `resolveParams` (clamped to range and step), `effectiveFlags`, `paramOf`, `isKnownMapId`.
- Pack API `mapShape`, `mapTerrain`, `mapNumbers`, `mapPerk`, `quickStart`, `capability`. Registry `mapShapes`, `mapTerrains`, `mapNumberings`, `mapPerks`, `quickStarts`, `capabilities`. Same `put()` duplicate rule (`replace: true` overrides); a pick id can live in only one option kind, because picks are one flat list.
- Base pack `packs/base/map/`: `hexagon` (shape default), `random` terrain, `standard` numbers, quick starts `standard` and `blank`. Gold and Fog packs: perks `gold` and `fog` (fog is `secret`) and quick starts `goldRush` and `fogIsland`.
- Settings `mapSeed`, `mapSeedLocked`, `mapPicks`, `mapParams`, validated in `mergeSettings` (new `mergeSettingsDetailed` also returns the ids a share code carried that this server does not know). A full share code pasted into `mapSeed` applies the whole recipe, radius included.
- `lobby.ts`: `generateLobbyMap`, `refreshMap` (rebuilds the lobby board and stores the seed that was used), `applyMapStart` (preset chips), `recipeKey`. Socket event `regenerate` (new random seed). `room.mapMeta = { recipe, report, edited }`, sent to the client as `mapMeta` (recipe, share code, report) in the lobby; any paint event sets `edited`.
- `tests/mapsettings.test.ts`.

### Changed
- `generateMap` is registry-driven: terrain and number styles come from the registry, perks add tile counts and extras, flags feed the check. A terrain or number style that changes the counts is refused with a warning and the default placement is used. Output for a recipe without picks is the same as M1.
- Count precedence: a nonzero tile count on the Rules tab (`goldTiles`, `fogTiles`) wins over a perk's own count; zero lets the perk decide. Before, a preset's count always won.
- A settings change that touches the map (seed, radius, picks, params, tile counts) rebuilds it from the recipe and KEEPS the seed. Only Regenerate and a rematch with the seed unlocked roll a new one. Quick-start chips roll a new seed. A picked style now survives a radius change (the old "presets are forgotten" problem).
- `newBoard(settings)` follows the settings' recipe; `newBoard(settings, id)` applies a quick start with a fresh seed. `rooms.createRoom` and `game.rematch` build through recipes.
- Removed `SUPPORTED_PICKS` from `mapgen.ts`; unknown picks now come from the registry (`pick-ignored` warning).

### Notes
- `PresetDef` stays (deprecated) because `createGame`, the sims and the topology tests still go through `generateBoard`. The Archipelago chip stays on the old water-chance preset until the M3 `archipelago` shape replaces it; it draws a one-off board without a recipe.
- Not routed yet: `createGame` without a prepared board (sims, tests) still uses `generateBoard`. Real games copy the lobby board, which now comes from recipes. Switching the engine changes every existing sim seed, so do it together with a pass over seed-dependent tests.
- No UI changes. The client keeps working: it ignores `mapMeta`, and `applyMapPreset` and `updateSettings` have the same shape.
- Written without a shell on the repo: run `npm run typecheck` and `npm test` and check the new `tests/mapsettings.test.ts` first.

## 2026-10-25 20:40:06 (Pass 10: Map Generation M1, foundations)
### Added
- `src/shared/noise.ts`: seeded lattice value noise (integer hash, `+ - * /` and `floor` only), `cellPoint`.
- `src/shared/maprecipe.ts`: `GEN_VERSION`, `MapRecipe`, `stageRng(seed, stage, attempt)`, `cleanSeed`, `newSeedText`, share code `encodeRecipe` / `decodeRecipe` (`hx1;g=1;r=4;picks=...;seed=...`).
- `src/shared/mapcheck.ts`: `findLandmasses`, `classifyCells` (ocean vs lake), `validateBoard` -> `MapReport` (spots, fairness, pips per resource, errors and warnings), `estimateVertices`.
- `generateMap(reg, rules, recipe)` in `mapgen.ts` for the classic pipeline (hexagon, random terrain, standard numbers) with one RNG stream per stage. Other picks are reported as `pick-ignored`.
- `tests/mapgen.test.ts` (21 tests).

### Changed
- `bots/mapProfile.ts` uses the shared `findLandmasses`.
- `generateBoard` is unchanged in behavior (same RNG order); only the tile multiset moved into a helper.

### Notes
- Verified in a scratch container with a mini registry: `tsc --noEmit` clean, 21/21 new tests pass. The full suite and `npm run typecheck` on the real repo were not run: please run both.
- Found: today's port rules (one per hex, none on neighbouring hexes) cap the standard board at 6 ports, not 9. The design's 9 needs the M3 port rework.

## 2026-10-25 20:38:55 (Pass 9: Victory screen 6-tab analytics & confetti celebration overlay)
### Added
- **Victory Confetti Animation Overlay & Fanfare** (`src/client/ui.ts`, `src/client/audio.ts`, `src/client/main.ts`, `src/client/styles.css`) — `2026-10-25 20:38:55`:
  - Full-screen non-blocking canvas confetti simulation (`triggerVictoryConfetti` / `clearVictoryConfetti` on `#confettiOverlay`) triggered when a player hits the victory point threshold (`GAMEOVER`).
  - Dual side cannons + overhead burst with 3D tumbling rectangles, hex tiles, and circles colored in the winner's signature color and the warm Dorfromantik palette; respects `prefers-reduced-motion` and cleans up automatically or on returning to the lobby.
  - Synthesized dual-cannon pop and rising chord fanfare (`playVictoryFanfareSound` in `src/client/audio.ts`).
- **6-Tab Post-Game Victory Screen** (`public/index.html`, `src/client/render/index.ts`, `src/client/styles.css`, `src/client/actions.ts`, `src/client/store.ts`) — `2026-10-25 20:38:55`:
  - **Overview** (default tab): Ranked player matrix with Total VP (trophy), Settlements VP, Cities VP, +1 VP Dev Cards, Largest Army VP, and Longest Road VP, with circular leader highlights (`.vic-num.best`) on the highest nonzero value in each category column.
  - **Dice Stats**: 2–12 histogram (hot 6/8 and slate 7 styling), summary strip (total rolls, 7s count & percentage, most frequent roll), and per-player 7s rolled chips.
  - **Res Card Stats**: Per-player resource flow matrix (Total Gained, Dice/Gold Produced, Dev Card Gain, Traded In, Traded Out, Stolen, Robbed, and Discarded on 7s) + Table Total row.
  - **Dev Card Stats**: Per-player Dev Card breakdown (Bought, Played, Knight, +1 VP, Road Building, Year of Plenty, Monopoly) + Table Total row.
  - **Activity Stats**: Per-player activity matrix (Turns, Settlements Built, Cities Built, Roads Built, Best Road Length, Robber Moves, Player Trades, Bank Trades, Offers Proposed) + Table Total row.
  - **Resource Stats**: Per-player resource breakdown using flat resource pictograms (Total, Wood, Brick, Sheep, Wheat, Ore) + Table Total row.
- **Engine & View Stats Tracking** (`src/packs/base/hooks.ts`, `src/server/view.ts`, `src/client/types.ts`) — `2026-10-25 20:38:55`:
  - `recordActionStats` hook in `packs/base/hooks.ts` records per-player production, picks, steals, robberies, discards, player/bank trade flows, dev card usage, builds, robber moves, turns, and per-resource totals from engine events without touching RNG.
  - Verified with `npm run typecheck` and `npm test` (88/88 passing tests across 7 test suites).

## 2026-10-25 20:38:55 (Pass 8: 8 players, number tokens, lobby overlap)
### Added
- `src/shared/numbers.ts`: real 18-token pool, `buildNumberPool(count)` for any board size, `assignNumbers` (no touching 6/8, equal numbers apart as a soft goal). `tests/numbers.test.ts`.
- 8-player lobbies: default seats 8, 8th color is pink (was coral, too close to orange). `settingsForPlayers` (`runtime.ts`) grows bank and dev deck at game start (5-6: 24 per resource, 34 dev; 7-8: 30, 43) only if the host left them at standard. Lobby log hint when 5+ players sit on a map below the recommended radius (`recommendedRadius`: 2 / 3 / 4). Start check for 5+ players needs `players * 8` vertices (4 or fewer unchanged). Sidebar `dense` rows at 6+ players.

### Changed
- `mapgen.ts`: number pool is sized by the numbered tiles, not all hexes. Before, the standard board got a 19th token (an extra 2). 18 tiles = exactly the real pool. Other sizes use the real shares tilted slightly (2/12 x0.65, 3/11 x0.85, 5/9 x1.05, 6/8 x1.1): 2/12 about 3.7%, 3/11 about 9.8%, 6/8 about 12.7% each on big boards (real: 5.6%, 11.1%, 11.1%). Average pips per tile 3.22 to 3.40.
- Game menu and lobby dock never open together. "Back to lobby" (and Play again) closes the menu and folds the dock; the settings button reopens it. "Back to lobby" button hidden while in the lobby (`btnBackToLobby`).

### Notes
- Verified in applet container: `npm run typecheck` is clean, and `npm test` passed 88/88 tests across 7 test suites (including `tests/numbers.test.ts`).

## 2026-10-25 (Pass 7: bot dialogue)
### Added
- New bot dialogue engine in `src/server/bots/dialogue/` (`index.ts`, `engine.ts`, `context.ts`, `events.ts`, `types.ts`) with the line data in `lines/` (`roll`, `robber`, `build`, `awards`, `trade`, `table`). `bots/dialogue.ts` is now a re-export, so `game.ts` and `socket.ts` imports did not change.
- 40 events across Main / Secondary / Overload voices. Lines are plain data with `{slots}`, `{a|b}` alternation, composed opener + core + closer lines (busiest events), plain-data conditions (leader or trailing, VP left, map traits, over the discard limit, other player is leader or newcomer) and personality overlays.
- Leak rules enforced in code: the context is built from public information only (card counts and shown VP, never hands, dev card types or hidden VP). Steal, robbed, discard, dev-buy and one-VP-left lines are `risk: 'private'` and get no resource slot; `{res}` exists only for Monopoly and bank-empty.
- Repeat memory (a bot skips its last 8 variants, the room skips the last 12), per-event chance, room gap, per-bot cooldown, game-speed scaling, 120 character cap.
- Host setting **Bot chat: Off / Quiet / Normal / Chatty** (Rules and cards, Bots). Setting is `botChat`; unset means Normal. Off silences every bot line and the chat replies; Quiet also turns the chat replies off.
- New triggers: game start, large map, islands, fog reveal, bank runs dry, trade declined (leader variant), trade accepted, countered, no takers, one VP from winning (not Overload), human near winning, robber on a number, awards lost, other player wins.
- Replies to human chat (`reactToChat`, called from `sendChat`): hello, gg, thanks, lol, a bot's name. Canned, never about game state, one reply per 12 seconds.
- `tests/dialogue.test.ts`: line data rules, leak rules (resource-word scan, `context.ts` source scan), picker, chat level and rate limits, game hooks, chat replies, `mergeSettings`.

### Changed
- `mergeSettings` keeps `botChat` (`normalizeBotChat`). Client: `setBotChat` select in `public/index.html`, sent by `pushSettings` (`actions.ts`), filled in `renderAll` (`render/index.ts`).

### Notes
- Not run in this session (no shell access to the repo): run `npm run typecheck` and `npm test`. If a hook test fails, check the engine event names and data fields used in `bots/dialogue/index.ts` first.
- Not done: the "human's turn timer is low" line (needs a hook in `turnClock.ts`). Callbacks to earlier events and nemesis lines stay out of scope (`Bot Dialogue Design.md` section 11).

## 2026-10-25 (Pass 6: default bot)
### Added
- Bot difficulty tiers **Main / Secondary / Overload**, chosen per bot. Host picks the tier in the dropdown next to the Bot button and can change it in the lobby by clicking the `Bot · Tier` tag. Socket events `addBot {tier}` and `setBotTier`. A bot that replaces a disconnected human is Secondary (closest to the old Hard bot).
- `src/server/bots/tiers.ts`: tier profiles as plain data (noise, blunders, lookahead, setup and road planning, spend discipline, robber, trade, dev timing, awards, blocking, mercy, information, grudges, coordination, lockdown, fog, think delay, chat style) plus personalities (builder, road hog, port trader, dev rusher).
- `src/server/bots/mapProfile.ts`: landmasses, gold share, average pips, port count, board size, built once per board and refreshed when fog is revealed.
- Brain reads the tier and map profile: room to grow on islands, gold and fog valued from the map instead of flat numbers, cheap pre-scoring so big boards stay fast, boxed-in bots switch to cities, dev cards and trading, grudges from engine events (`noteBotEvents`), Overload lockdown on a human near winning.
- Sim: `tiers` per seat, decision timing, `runLadder` (win rate per tier).
- `tests/bots.test.ts`.

### Changed
- Bot chat style and think delay follow the tier.
- Lobby log tells the host new bots are Main by default.

### Fixed
- Offering a trade for a resource nobody holds (bank plus your own hand already equal the full supply) now shows "No one has any X to trade." instead of sending an offer that closes at once. Client-side check in `proposePlayerTrade` (`render/drawer.ts`).
- End-game dice chart: the tallest bars were squashed to one height (percentage heights overflowed the column). Bars are now pixel-scaled against the highest count, with the count above the bar.

### Notes
- Not run in this session (no shell access to the repo): run `npm run typecheck` and `npm test`, then `runLadder` to tune the tier numbers. All numbers in `Bot AI Design.md` section 2 are starting guesses.
- The bot addon system (`Bot AI Design.md` sections 4 to 6) is not started; it is the next bot step.

## 2026-10-25 (Pass 5)
### Added
- Turn timer, set in the lobby under Rules and cards, Timers: turn time (0 = off), seconds added per completed action, and trade offer time. Humans only; bots are not timed. When the clock runs out the turn is passed, or the pending step is finished for them (roll, robber, discard, gold pick). The time left shows in the turn pill. Server: `src/server/turnClock.ts`, settings `turnTimerSec` / `turnIncrementSec` / `tradeTimerSec`. Client: `render/turnclock.ts`.
- Custom presets: save, apply and delete named lobby presets (map, ports, robber, fog, rules; not seats or game speed). Saving under an existing name replaces it. Stored in the host's `localStorage` (`hexsettlers.customPresets.v1`, max 30). Server: `src/server/presets.ts`, socket events `savePreset` / `presetSaved` / `applyCustomPreset`. Client: `src/client/presets.ts`, `#presetRow`.
- Orange tint on every tile the robber can move to after a 7 (`.hex-tint`).

### Changed
- Road hover highlight: a flat dark halo under the roads (whole network faint, longest stretch stronger), drawn as one shape per group so segments join seamlessly. The white glow and pulse are gone.
- Counter offer editor now follows Colonist: click a hand card to add it to the give row, click a card in a row to remove one, click the "ask for" strip to add to the get row. Same layout as a normal offer (avatar + arrow, cards, check/X), no text labels.
- Robber target hover: dark slate cast on the tile under the cursor, on top of the orange tint.
- `mergeSettings` moved into `lobby.ts` so presets and `updateSettings` share it.

### Removed
- Striped filter on robber targets.
- Touch-screen outline on robber targets (the tint covers it).

### Fixed
- Trade time bar not showing: the client compared the server's timestamp with its own clock, so a clock more than the offer time off emptied the bar. The server now sends the time left and the client counts down from arrival.

### Notes
- The pill-shaped trade time bar was tried and reverted; the thin bottom-edge bar stays.
- `npm run typecheck` and `npm test` (30 passing) were clean before the orange tint change.

## 2026-10-24 (Pass 4)
### Added
- Counter trade: engine action `counter_trade {offer, request}`, editor in the trade popup, socket event `counterTrade`. Bots answer counters but never propose them.
- Trade offer stack: up to 5 open offers, per-offer timers (20 s for humans, `HUMAN_TRADE_WAIT`), `activeTrades` in `view.ts`, Colonist-style top-right stack with response boxes and countdown bar.
- Pictogram avatars (`avatars.ts`), unique per lobby, click to cycle in the lobby. Bots get animals.
- Lobby cursors and Shift laser trail (`cursors.ts`).

### Changed
- Port piers run the full hex side, thicker and tapered (`portMarkup` in `render/board.ts`).
- `setGameSpeed` is host-only, with a client toast.

## 2026-10-24 (Pass 3)
### Added
- Roads merge into one line, with a hover tooltip for the longest stretch.
- Longest Road / Largest Army banner and fanfare.
- Bot chat lines (`bots/dialogue.ts`).
- Drag-to-pan on tiles.

### Changed
- Sand under all land tiles, darker tile trim, port markup aligned to the hex edge.

## 2026-10-24 (Pass 2)
### Added
- Single "Join game" button (newest open lobby).
- Own VP shown as `8(9)` (`publicVp`).
- Rolled tiles darken for about 2 s, glowing build spots, sand rim, bank-empty toast.

### Changed
- Trade popup order is get, then give. Trade closes when all players decline.

### Fixed
- `publicVp` type error.

## 2026-10-24 (Pass 1)
### Changed
- 3:1 port readable in dark mode, quicker card fade, dark toggle on the landing page.
- No gold in normal games (Gold Rush preset adds it).

### Removed
- Number dots on tokens.

## 2026-10-24 (Step 2: engine and base game)
### Added
- `src/shared/` (RNG, registry, topology, mapgen, dispatch, `legalActions`), packs `base`, `gold`, `fog`.
- Server adapter (`runtime`, `lobby`, `rooms`, `game`, `view`, `net`, `socket`) and bots (`brain`, `scheduler`, `sim`). `view.ts` keeps the legacy `gameState` shape for the client.
- `Design UI Philosophy.md` and the design-token CSS layer in `styles.css`.

### Fixed
- `error?` / `events?` added to both `DispatchResult` branches (`strict: false` does not narrow the union).

## 2026-10-23 (Step 1: infrastructure)
### Changed
- `server.js` and `index.html` split into TypeScript (`src/server/`, `src/client/`), originals kept in `legacy/`. esbuild bundles to `dist/`.

### Added
- Scripts `dev`, `build`, `start`, `typecheck`, `test`. Dockerfile, `render.yaml`, `.env.example`, README.
- Before the engine work: robber victim choice, zoom and pan, radius up to 50, fog tiles, animations, sounds, game speed 0.5x to 8x, victory overlay.

## Step 0
### Added
- Skeleton deploy: old version tagged, Render host, `/health`, tested on phones.

## Planned
- Delete `src/server-legacy/` (and `legacy/` when not needed), then close Step 2.
- Step 3 (identity and persistence) only when John says so.
- Bot difficulty tiers (Main, Secondary, Overload): done. Bot addon system (`Bot AI Design.md` sections 4 to 6), sim matrix and tier tuning: later.
- More built-in presets, big-map optimization, new map generation types (islands, archipelago, lake, realistic), continent map shapes, settings and navigation UI rework, board UI rework.
