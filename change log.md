# Change Log

## 2026-10-27 (Pass 34: Stage 0 start: DLC/addon layer, keyed registries, golden baseline test)
### Added
- **DLC and addon layer** (`src/shared/addons.ts`, new; S0.1, service 1): `AddonDef` (id, deps, links, rules, `register`), `AddonInfo`/`DlcInfo` for the lobby, `LINK_KINDS`, the 20 `GENERAL_SERVICE_IDS`, `resolveAddons(packs, rules)` (DLC master switch `rules.dlc[packId]`, per-addon `rules.addons[id] === false`, blocked-by-dependency list), `addonOn(reg, id)`, `registryFor(packs, rules, overrides)`, and `auditAddons(packs)` (Rule of Two: 2+ distinct links, one to a General service; no unknown targets or kinds, no self links; DLC must list `base`; cross-DLC dependency needs `allowCrossDlcDep`).
- **Keyed registries**: `api.define(kind, def)` and `defsOf(reg, kind)`. Kinds are separate namespaces, duplicate ids throw unless `replace: true`. New kinds (events, techs, contract conditions, stats...) need no edit to `registry.ts`.
- **Golden baseline** (`tests/golden.test.ts`, S0.0): five seeded bot-vs-bot games hashed (final state, log, turns, steps) against `tests/golden.snapshot.json`. First run records the snapshot; `UPDATE_GOLDEN=1` re-records on purpose.
- `tests/addons.test.ts`: manifest, enabled sets, master switch, bad-manifest errors, keyed registries, "DLC off changes nothing", and the audit.
### Changed
- `src/shared/registry.ts`: `Pack.addons`; `Registry.addons`, `dlcs`, `enabled`, `defs`; `createRegistry(packs, overrides, enabled)` takes a set of addon ids or `'all'` (default none, so plain calls build the base game). Addon content, hooks and rules register only for enabled addons. Load-time errors for wrong id prefix, duplicate addon, dependency not declared earlier, enabled addon whose dependency is off, unknown id in the enabled set.
- `src/shared/index.ts` exports `addons`.
- `INDEX.md` lists the new source and test files and `Development Plan.md`.
### Added (S0.2 round clock, service 2)
- `g.round` (0 in setup; round 1 starts with the first normal turn; a new round each time seat 0 comes up). Robber, discard and pick sub-phases never start a round.
- Hooks `onRoundStart` (g.round already the new round) and `onRoundEnd` (g.round still the finished round, fires when the last seat ends its turn, not after a winning turn), events `roundStarted` / `roundEnded`, helper `everyNRounds(n, fn, offset)`, `endRoundIfLastSeat(ctx)` called by `end_turn`. Code: `types.ts`, `registry.ts`, `engine.ts` (`round: 0`), `state.ts` (`startTurn`), `packs/base/actions/endTurn.ts`.
- `tests/rounds.test.ts`. `tests/golden.test.ts` leaves `round` and `ext.core` out of the state hash so additive services do not break the baseline.
### Not done yet (S0.1)
- `rulesFromSettings` / `Settings` still wired per field; the `dlc` / `addons` block comes with the setup page work (S0.12).
### Not verified
- Written without a shell. Still to run: `npm run typecheck`, `npm test`, then `npx vitest run tests/golden.test.ts` to record the snapshot and commit it. For a true pre-change baseline, `git stash` first, record, `git stash pop`, run again.

## 2026-10-26 (Pass 33: world setup page between the name page and the board)
### Added
- **Setup page** (`public/index.html` `#setupScreen`, `src/client/render/setup.ts`, `styles.css`): host only. Three boxes: bots and bot chat (with a player strip: avatar click, bot tier tag click), a tiles-only map preview, and map presets, map menu (seed) and all rules (game, timers, special tiles, bank and dev cards, pieces). Buttons: Continue to board, Start now. Controls keep their ids and handlers, so settings sync, presets and the seed work unchanged.
- **Waiting screen**: everyone but the host sees "Host is creating world" over the board while the page is open. A new player who tries to join (or rejoin without a seat) gets the same message as a toast and stays on the name page. Players who already have a seat can still reclaim it.
- Server: `room.setup` (true on create), socket `setSetup`, `setup` in the client state. Rematch leaves it off, so Play again still goes straight to the board; the board dock has a **World setup** button to go back.
### Changed
- The board dock is the map painter only (plus World setup and Start). The Rules and cards tab and the bot controls moved to the setup page. Mouse-wheel editing of number fields and sliders works on the setup page too.
- Tests: `tests/setuppage.test.ts`.
### Not verified
- Written without a shell: run typecheck and test, then check: create game (setup page), add bots, change a preset and the seed (preview updates), Continue to board, World setup (back), second browser join during setup (toast) and after Continue (joins).

## 2026-10-26 (Pass 32: fixed-size player list that follows the turn, hexagon-only port layout)
### Changed
- **Sidebar** (`src/client/render/sidebar.ts`, `src/client/styles.css`): log, chat and bank keep a fixed size for 1 to 8 players. The player list always shows 4 rows (`--p-row-h`) with a thin scrollbar on its right edge when there are more. On every turn change the current player's row scrolls into view by the smallest move (player 5 = one row down, back to player 1 = up to the top). The list keeps its scroll position across re-renders, wheel/touch/drag stops the auto-scroll, and the robber victim row is scrolled into view when the steal choice opens.
- **Animations keep working with a scrolled list**: `visibleRect()` clamps a player row that is scrolled out of view to the nearest edge of the visible list, so production, steal, trade and dev-card flights land on the list edge instead of over the chat or off screen (used in `triggerCardTransferAnimations` and `triggerFlyingResourceAnimations`). Rolled-tile dim, in-flight card counts, rob highlight, turn marker, tier tags and avatar picking are unchanged.
- **Ports** (`src/shared/topology.ts`, `src/shared/mapgen.ts`): the real-board layout (`portLayout: 'hexagon'`: a harbor on every second sea tile of the frame, on the edge away from the corner tile, 3 x (R + 1) ports) applies only to the plain full hexagon. Every other shape keeps the general coast placement. `tests/ports.test.ts` checks gaps 2-2-3 on the standard board, corner harbors with gaps of 2 on both sides, and 3 (R + 1) ports on radius 3 and 4.
### Not verified
- Written without a shell: run `npm run typecheck` and `npm test`, restart `npm run dev`, hard refresh, then roll a few seeds on radius 2, 3 and 4 and compare with the reference images.

## 2026-10-26 10:14:20 ICT (UTC+7) (Pass 30: Road zoom-out scaling, session reconnect, bot setup optimization, AI training data log, VP-scaled pieces with 2× cost above base limit)
### Added
- **Road Zoom-Out Scaling** (`src/client/render/board.ts`, `src/client/styles.css`) — `2026-10-26 10:14:20 ICT`:
  - Added dynamic `--road-scale` CSS custom property calculation in `updateCameraViewBox()` (`ROAD_BASE_SCALE = 1.15`, up to `2.45×` when zoomed out or on large maps) alongside `--building-scale`.
  - Placed road rims (`.road-rim-line`), road bodies (`.road-body-line`), hover hit targets (`.road-hit`), road network glow halos (`.road-glow-net line`, `.road-glow-best line`), and buildable road spots (`.road-spot-line`, `.road-spot-dot`) all scale smoothly when zooming out without rebuilding SVG DOM.
- **Disconnect / Logout Reconnect System** (`src/server/types.ts`, `src/server/rooms.ts`, `src/server/socket.ts`, `src/client/actions.ts`, `src/client/main.ts`, `public/index.html`) — `2026-10-26 10:14:20 ICT`:
  - Added persistent `catan_client_id`, `catan_player_name`, and `catan_last_room` in `localStorage`.
  - Added `rebindPlayerId()` in `src/server/rooms.ts` and `tryReclaimSeat()` / `reconnectRoom` in `src/server/socket.ts` so a player who refreshes, closes the tab, or temporarily disconnects reclaims their seat (converting a takeover bot back into the human player and restoring their name, avatar, pieces, trades, and host status).
  - Rooms with all humans temporarily disconnected stay alive for a 10-minute grace period (`ROOM_DISCONNECT_TTL_MS`) instead of being deleted immediately, and `#authScreen` shows a **Rejoin game** button plus automatic socket reconnect on reload.
- **Optimized Bot Initial Placement Strategy** (`src/server/bots/mapProfile.ts`, `src/server/bots/brain.ts`) — `2026-10-26 10:14:20 ICT`:
  - Added board-wide resource pip scarcity analysis (`resourcePips`, `scarcityBonus`) to `MapProfile`.
  - Upgraded `vertexScore` with resource scarcity weighting, 3-hex intersection volume and number-diversity bonuses, wheat anchor evaluation, 4/5-resource coverage bonuses, and 2nd-settlement starting hand tempo bonuses (immediate Turn 1 road from wood+brick, immediate Dev card from wheat+ore+sheep, or 3/4 of a settlement).
  - Upgraded `planOpening` with snake-draft turn-order lookahead (`picksBetween` opponent picks before the 2nd settlement) and enabled it for `setupPlanning >= 1` (`Secondary` and `Overload`).
  - Upgraded `roadScore` during `setup_road` so setup roads evaluate 2-step and 3-step open settlement vertices reachable from the road's outer endpoint (`step1`), coastal ports, and penalize dead-end roads.
- **AI Bot Training Data Logger & Exporter** (`src/server/bots/trainingLog.ts`, `src/server/game.ts`, `src/server/bots/sim.ts`, `src/server/main.ts`, `src/client/actions.ts`, `public/index.html`) — `2026-10-26 10:14:20 ICT`:
  - Records every human and bot decision step with state features (`vp`, `pipYield`, `portAccess`, `resources`, `resourceTotal`, `devCardCount`, `knightsPlayed`, `longestRoadLength`, `piecesLeft`, `legalActionCount`), chosen action, events, and end-of-game outcome labels (`finalVp`, `wonGame`, RL `reward`).
  - Persists completed game trajectories to `data/bot_training_logs.jsonl` and exposes `GET /api/bot-training-logs` (`.json` or `.jsonl`), `POST /api/bot-training-sim` (headless self-play batch generator), and **AI Log** download buttons in the in-game menu and Victory screen.
- **Scale Settlement, City & Road Limits with VP Setting (2× Cost Above Base Limit)** (`src/packs/base/building.ts`, `src/packs/base/actions/build.ts`, `src/shared/engine.ts`, `src/server/runtime.ts`, `src/server/lobby.ts`, `src/server/bots/brain.ts`, `src/client/render/board.ts`, `src/client/render/hand.ts`, `public/index.html`) — `2026-10-26 10:14:20 ICT`:
  - `maxRoads`, `maxSettlements`, and `maxCities` scale proportionally with `vpToWin` when `vpToWin > 10` (`ceil(base * vpToWin / 10)`).
  - Building any piece above its base limit (`15` roads, `5` settlements, `4` cities on the board) costs **double resources** (`2×`), enforced in the game engine (`pieceCost`), bot planner (`brain.ts`), client board affordability checks, and action-bar hover recipe strips (which display `2×` and the doubled card recipe).

## 2026-10-26 (Pass 29: server-side "no one has X" check, discard clock keeps turn time, port rework; untested)
### Fixed
- **"No one has any X to trade" still fired after Pass 27** (`tradeOffers.ts`, `drawer.ts`): the client guess from `bankSupply - bank - my hand` is gone. `propose_trade` now checks the real hands (human proposers) and answers through the error toast only when nobody else holds the card. If it still shows, hard refresh and restart `npm run dev` (a stale bundle or server gives the same symptom).
### Changed
- **Discard clock returns the turn's time** (`turnClock.ts`): the time left is parked in `room.savedTurnClock` and restored (at least 3 s) when the turn owner is on the clock again. Auto-discard unchanged.
- **Port rework, `GEN_VERSION` now 3** (`topology.ts`, `registry.ts`, `mapgen.ts`, `maprecipe.ts`):
  - Cap per landmass: `portCap(size)` = 0 under 3 tiles, 1 under 6, else `round(size x 0.45)`. Standard board unchanged at 9; bigger hexagons stay near 1 port per 3.3 coast edges.
  - Ports past the ninth keep the 4 generic : 5 resource mix (pool redealt as fresh shuffles).
  - New `TileDef.noPort` for modded terrain (no port on its coast; a non-sea, non-land tile does not count as sea). No shipped tile uses it yet.
### Added
- Tests: server refuses a request nobody holds (`rules.test.ts`); port caps, port mix, `noPort` (`mapshapes.test.ts`). `GEN_VERSION` test in `mapmix.test.ts` now expects 3.
### Checked, not changed
- Invalid bank trade prompt (Pass 25) already names a better port rate and "Fix amounts" rounds the give pile.

## 2026-10-26 (Pass 28: bank / dev deck auto-scale tests; not run)
- `rules.test.ts`: standard board stays 19 bank and 14/5/2/2/2; 5-6 player floor holds; a 61-tile board grows bank and deck; host-changed numbers are left alone.

## 2026-10-26 (Pass 27: "No one has X" used the lobby bank setting)
- Client used `bankResourcePerType` (19) instead of the real, possibly scaled bank, so trades were refused on Scaled Games. Server now sends `bankSupply`. Replaced by the Pass 29 server check.

## 2026-10-26 (Pass 26: shape add-ons no longer drop to the hexagon; tests pass)
### Fixed
- **River / lake / islets falling back to the hexagon** (`mapshape.ts`, `shapes.ts`):
  - The exact land count check after every carve or scatter rejected attempts that cleanup never repaired; it now applies to the base shape only.
  - Carves run only in the biggest landmass (`biggestLand`), and islands/continents reserve room for it (`bigNeed`) so no island drops under its minimum.
  - A river starts only on a shore tile with a way inland. Islets place what fits instead of failing.
  - River tiles now come out of the land budget, so continents + river fits its water gap.
### Added
- `shape-partial` warning when an op did only part of its work ("river: 2 of 6 tiles fit"); `runShape` looks up to 10 attempts for a clean one.
- "shape not applied" tooltip names the two most common failure reasons.
- Tests in `mapshapes.test.ts`: fallback rate over base x add-on x radius, default radius 2, river on islands/continents, `shape-partial`.

## 2026-10-26 (Pass 25: bank trade advice, board-scaled bank and dev deck, turn clock bar, human discard clock; untested)
### Added
- **Bank trade ratio advice + "Fix amounts"** (`drawer.ts`): explains an illegal give/get using the player's own rate (4:1, 3:1, 2:1), names a better port rate, and rounds the give piles.
- **Turn clock countdown bar** (`turnclock.ts`): draining bar in the turn pill, red in the last 10 s.
- **Shape fallback tag** in the map report when the generator falls back to the hexagon.
### Changed
- **Bank and dev deck scale with the board** (`runtime.ts`, `game.ts`): only when the host left the standard numbers. Bank = max(table floor, 0.8 x land tiles), dev deck = max(table floor, 1.2 x land tiles). The 19-tile board is unchanged.
- **Discard clock for humans** (`turnClock.ts`, `scheduler.ts`): a human who owes a discard after a 7 is on the clock even on a bot's turn; on expiry they are auto-discarded.

## 2026-10-26 (Pass 24: seed toggle, bigger pieces, scrolling lobby dock, more presets)
- Seed hide/show toggle (stored in `localStorage`).
- 11 more built-in preset chips: Beginner, Realistic continent, Balanced continent, Island hopper, Ring lagoon, Lakeland, Chaos; Mountain gold, Gold islands; Fog ring, Fog continents.
- Settlements and cities bigger (`BUILDING_BASE_SCALE` 1.5, cap 2.8).
- Lobby dock scrolls instead of growing, so chat and log stay visible.
- Fixed a leftover `syncBoardBuildPopup()` call after Pass 23.

## 2026-10-26 (Passes 19 to 23: build popups tried, then reverted)
- Added (Pass 19): road length tooltip on hover, hover recipe strips on the action bar buttons (Dev, Road, Settle, City).
- Added then removed (Passes 19, 20, 23): on-board click-to-select popups for roads, settlements and cities. Clicking a build spot builds at once again. Hover recipes and the road tooltip stay.
- Pass 21: settlements and cities scale with zoom and board size.
- Pass 22:
  - **Performance**: board split into persistent SVG layers with dirty-key caching, merged water and sand paths, no SVG blur filters, rAF-coalesced pan/zoom, cached road analysis.
  - **Bot pacing**: bots wait for roll and card animations (`animatingUntil`, `animDelayMs`) before acting.
  - Mouse wheel changes numbers in the Rules and Cards menu (Shift = 5x step).

## 2026-10-25 (Passes 17 and 18)
- Pass 18: cards are held out of the hand and sidebar counts until their flying animation lands.
- Pass 17: "your turn" chime; unified pictogram icons on the victory screen; nickname required before create or join (no default); game speed locked at 0.5x and the speed UI removed; victory screen and confetti made lighter (no backdrop blur, paused board animations, memoized render).

## 2026-10-25 (Passes 10 to 16: Map Generation M1 to M6)
Design in `Map Generation Design.md`.
- **M1 foundations** (P10): seeded noise, `MapRecipe` and share code (`hx1;g=..;r=..;picks=..;seed=..`), per-stage RNG streams, `validateBoard` -> `MapReport`, `generateMap` for the classic pipeline.
- **M2 registry and settings** (P11): pack API for shapes, terrain, numbers, perks and quick starts; settings `mapSeed`, `mapSeedLocked`, `mapPicks`, `mapParams`; a map-affecting change rebuilds from the recipe and keeps the seed; `mapMeta` goes to the client.
- **M3 shapes and ports** (P12): shape stage decides land (`continent`, `ring`, `islands`, `archipelago`, `continents`; carve ops `lake`, `river`; scatter `satellites`; tweak `ragged`); ports per landmass on open-sea coast; falls back to the hexagon, never throws.
- **M4 terrain and numbers** (P13): `spread`, `clustered`, `realistic` (habitat per tile) terrain; `balanced` and `feast_famine` numbers; flags `hotTouch` and `equalTouch`.
- **M5 validation** (P14): board loop retries stages 5 to 8 (12 attempts up to radius 20) and keeps the best, `degraded` when none pass; new `not-connected` and `one-resource-island` checks; bot sims on every shape; budget test.
- **M6 lobby map menu** (P15): menu drawn from `mapOptions` (a pack's new option appears with no client change); seed line with copy, edit, lock and save; report tags; presets v2 keep the recipe ("same style, new seed"). A painted map needs a second click before a reroll replaces it.
- **Finishing pass** (P16): `GEN_VERSION` 2; ring band at least 2 tiles thick from radius 4 (`thin-neck` warning); `island_mix` perk ("Mixed islands"); per-param sliders in the menu; budget limits tightened (median under 60 ms up to radius 8, under 300 ms at radius 20).
- Not checked in a browser: the map menu and its sliders (open/close, picks, seed row, presets, phone layout). The gallery script `tools/mapgallery.ts` is still to do and is the way to tune the noise numbers.

## 2026-10-25 (Pass 9: victory screen and confetti)
- 6-tab post-game screen: Overview, Dice Stats, Res Card Stats, Dev Card Stats, Activity Stats, Resource Stats (leader highlights, table totals). Stats come from the `recordActionStats` hook, with no RNG use.
- Confetti and fanfare on game over (respects reduced motion).

## 2026-10-25 (Pass 8: 8 players, number tokens, lobby overlap)
- 8-player lobbies (8th color pink). Bank and dev deck grow at game start for 5-8 players if left at standard. Start check for 5+ players needs `players * 8` vertices.
- Number pool follows the real 18 tokens (the standard board no longer gets a 19th); bigger boards use the real shares tilted slightly; no touching 6/8.
- Game menu and lobby dock never open together.

## 2026-10-25 (Pass 7: bot dialogue)
- New dialogue engine (`bots/dialogue/`): 40 events, three voices, data-driven lines, personality overlays, repeat memory, rate limits.
- Leak rules: public information only; steal, discard and dev-card lines never name a resource.
- Host setting Bot chat: Off / Quiet / Normal / Chatty. Canned replies to human chat.
- Not done: "turn timer is low" line; callbacks to earlier events.

## 2026-10-25 (Pass 6: bot tiers)
- Tiers **Main / Secondary / Overload**, chosen per bot (a bot replacing a disconnected human is Secondary). Profiles in `bots/tiers.ts`, map profile in `bots/mapProfile.ts`, `runLadder` in the sim.
- Fixed: offering a trade for a resource nobody holds (client check); end-game dice chart bars squashed to one height.
- Not started: bot addon system (`Bot AI Design.md` sections 4 to 6). Tier numbers are starting guesses.

## 2026-10-25 (Pass 5)
- Turn timer (turn time, per-action increment, trade offer time; humans only) with time shown in the turn pill.
- Custom presets: save, apply, delete (host `localStorage`, max 30).
- Orange tint on robber targets; slate cast on hover. Road hover is a flat dark halo.
- Counter offer editor follows Colonist.
- Fixed: trade time bar vanished on clock skew; the server now sends time left.

## 2026-10-24 (Passes 1 to 4)
- Counter trade, up to 5 stacked offers with timers, pictogram avatars, lobby cursors and Shift laser trail.
- Roads merge into one line with a longest-stretch tooltip; Longest Road / Largest Army banner; bot chat lines; drag-to-pan.
- Single "Join game" button, own VP shown as `8(9)`, glowing build spots, rolled tiles darken, sand under land tiles, thicker port piers.
- No gold in normal games; no number dots; 3:1 port readable in dark mode; host-only game speed.

## 2026-10-24 (Step 2: engine and base game)
- `src/shared/` (RNG, registry, topology, mapgen, dispatch, `legalActions`), packs `base`, `gold`, `fog`, server adapter and bots. `Design UI Philosophy.md` and the design-token CSS layer.

## 2026-10-23 (Step 1: infrastructure)
- `server.js` and `index.html` split into TypeScript (`src/server/`, `src/client/`), originals in `legacy/`; esbuild to `dist/`; scripts, Dockerfile, `render.yaml`, README.

## Step 0
- Skeleton deploy: old version tagged, Render host, `/health`, tested on phones.

