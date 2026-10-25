# Change Log

## 2026-10-25 (Pass 12: Map Generation M3, shapes and ports per landmass)
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

## 2026-10-25 (Pass 11: Map Generation M2, registry and settings)
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

## 2026-10-25 (Pass 10: Map Generation M1, foundations)
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

## 2026-10-25 (Pass 10b: Your-turn chime, unified victory icons, 0.5x speed lock & victory screen optimization)
### Added
- **Your Turn Sound Effect** (`src/client/audio.ts`, `src/client/main.ts`):
  - Added `playYourTurnSound()` (warm two-note rising notification chime) that plays whenever an active game turn transitions from another player (or lobby) to the local player.
- **Unified 24×24 Pictogram Icons for Victory Screen** (`src/client/icons.ts`, `src/client/render/index.ts`, `src/client/styles.css`):
  - Added flat `UI_ICONS` (`star`, `robber`, `gift`, `crown`, `tree`, `bricks`, `wool`, `grain`, `rock`) so every column header across all 5 matrix tabs (`Overview`, `Res Card Stats`, `Dev Card Stats`, `Activity Stats`, `Resource Stats`) renders a uniform `20×20` `uiIcon(...)` inside an identical `34×34` `.vic-head-badge` container (with `.vic-head-badge.primary` accent styling on primary total columns).

### Changed
- **Game Speed Locked at `0.5x` & Speed UI Removed** (`src/server/runtime.ts`, `src/server/lobby.ts`, `src/server/socket.ts`, `src/client/store.ts`, `src/client/actions.ts`, `src/client/main.ts`, `src/client/render/index.ts`, `public/index.html`):
  - Default server and client `gameSpeed` is now locked at `0.5` (`0.5x`).
  - Removed the navbar speed badge (`#navSpeedBadge`), settings menu speed slider & preset buttons, lobby toolbar speed selector (`#setGameSpeedHeader`), rules & cards speed selector (`#setGameSpeed`), and the `setGameSpeed` socket handler.
- **Victory Screen & Confetti Performance Optimization** (`src/client/styles.css`, `src/client/render/index.ts`, `src/client/ui.ts`):
  - Replaced `backdrop-filter: blur(4px)` on `#victoryOverlay` with a solid `#14181c` backdrop + `contain: layout paint`, eliminating full-viewport GPU blur recomputation over the SVG board.
  - Added `#gameViewport.victory-modal-open #boardSvg * { animation-play-state: paused !important; }` to pause underlying SVG animations while the victory modal is open.
  - Memoized `renderVictoryScreen()` (`lastVicRenderKey`) and skipped redundant `renderBoard()` rebuilds while `#victoryOverlay` covers the viewport.
  - Streamlined `triggerVictoryConfetti()` to a 1x resolution cap (`<= 1280px`), 80 lightweight rectangle particles using direct `ctx.setTransform` + `fillRect`, and a 2.8s duration.

## 2026-10-25 (Pass 9: Victory screen 6-tab analytics & confetti celebration overlay)
### Added
- **Victory Confetti Animation Overlay & Fanfare** (`src/client/ui.ts`, `src/client/audio.ts`, `src/client/main.ts`, `src/client/styles.css`):
  - Full-screen non-blocking canvas confetti simulation (`triggerVictoryConfetti` / `clearVictoryConfetti` on `#confettiOverlay`) triggered when a player hits the victory point threshold (`GAMEOVER`).
  - Dual side cannons + overhead burst with 3D tumbling rectangles, hex tiles, and circles colored in the winner's signature color and the warm Dorfromantik palette; respects `prefers-reduced-motion` and cleans up automatically or on returning to the lobby.
  - Synthesized dual-cannon pop and rising chord fanfare (`playVictoryFanfareSound` in `src/client/audio.ts`).
- **6-Tab Post-Game Victory Screen** (`public/index.html`, `src/client/render/index.ts`, `src/client/styles.css`, `src/client/actions.ts`, `src/client/store.ts`):
  - **Overview** (default tab): Ranked player matrix with Total VP (trophy), Settlements VP, Cities VP, +1 VP Dev Cards, Largest Army VP, and Longest Road VP, with circular leader highlights (`.vic-num.best`) on the highest nonzero value in each category column.
  - **Dice Stats**: 2–12 histogram (hot 6/8 and slate 7 styling), summary strip (total rolls, 7s count & percentage, most frequent roll), and per-player 7s rolled chips.
  - **Res Card Stats**: Per-player resource flow matrix (Total Gained, Dice/Gold Produced, Dev Card Gain, Traded In, Traded Out, Stolen, Robbed, and Discarded on 7s) + Table Total row.
  - **Dev Card Stats**: Per-player Dev Card breakdown (Bought, Played, Knight, +1 VP, Road Building, Year of Plenty, Monopoly) + Table Total row.
  - **Activity Stats**: Per-player activity matrix (Turns, Settlements Built, Cities Built, Roads Built, Best Road Length, Robber Moves, Player Trades, Bank Trades, Offers Proposed) + Table Total row.
  - **Resource Stats**: Per-player resource breakdown using flat resource pictograms (Total, Wood, Brick, Sheep, Wheat, Ore) + Table Total row.
- **Engine & View Stats Tracking** (`src/packs/base/hooks.ts`, `src/server/view.ts`, `src/client/types.ts`):
  - `recordActionStats` hook in `packs/base/hooks.ts` records per-player production, picks, steals, robberies, discards, player/bank trade flows, dev card usage, builds, robber moves, turns, and per-resource totals from engine events without touching RNG.
  - Verified with `npm run typecheck` and `npm test` (88/88 passing tests across 7 test suites).

## 2026-10-25 (Pass 8: 8 players, number tokens, lobby overlap)
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
