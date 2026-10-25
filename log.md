# Log

## Done
- **Step 0 (skeleton deploy):** old version tagged, Render host, `/health`, tested on phones.
- **Step 1 (infrastructure, 10-23):** `server.js` and `index.html` split into TypeScript (`src/server/`, `src/client/`, originals in `legacy/`). esbuild bundles to `dist/main.js` and `dist/public/app.js` + `app.css`. Scripts: `dev`, `build`, `start`, `typecheck`, `test`. Dockerfile, `render.yaml`, `.env.example`, stub README. Binds `0.0.0.0:3000`.
- **Pre-engine gameplay (10-23, legacy-style code):** robber victim choice, cursor zoom and pan, radius up to 50, fog tiles, port spacing, animations, sounds, game speed 0.5x to 8x, victory overlay.
- **Step 2 (engine and base game, 10-24):** `src/shared/` (RNG, registry, topology, mapgen, dispatch, `legalActions`), `src/packs/base|gold|fog`, server adapter (`runtime`, `lobby`, `rooms`, `game`, `view`, `net`, `socket`), bots (`brain.ts`, `scheduler.ts`, `sim.ts`). `view.ts` keeps the legacy `gameState` shape for the client.
  - Verified: typecheck clean (fix: `error?`/`events?` on both `DispatchResult` branches, because `strict: false` does not narrow the union), 25 tests pass, live bot games incl. gold and fog presets.
  - Gold is 0 by default now; Gold Rush preset adds it.
- **Design direction (10-24):** `Design UI Philosophy.md`. Lichess shell + Mini Metro pictograms + Dorfromantik colors. Design-token CSS layer in `styles.css`. Full rebuild is Step 4.

## Backlog passes (10-24, tracked in `Dashboard.md`)
- **Pass 1:** removed number dots, 3:1 port readable in dark mode, quick card fade, dark toggle on landing page, no gold in normal games.
- **Pass 2:** one "Join game" button (newest open lobby, no code shown), trade closes when all decline, trade popup order get/give, own VP shown as `8(9)` (`publicVp` in `view.ts` and client `PlayerView`), stable player list scroll, rolled tiles darken ~2 s, striped robber targets, glowing build spots, sand rim, bank-empty toast. Typecheck error (`publicVp` type) fixed.
- **Pass 3:** drag-to-pan on tiles, sand under all land tiles, darker tile trim (`--trim-*`), rebuilt port markup aligned to the hex edge, roads merge into one line with hover longest-stretch tooltip, award banner and fanfare for Longest Road and Largest Army, bot chat lines (`src/server/bots/dialogue.ts`).
- **Pass 4 (items 1 to 5):**
  - Port piers: full hex-side length, thicker (6.5 body, 11 rim), tapered to the badge, anchored on the drawn tile edge (`portMarkup` in `render/board.ts`).
  - Counter trade: new engine action `counter_trade {offer, request}` (`tradeOffers.ts`, registered in `actions/index.ts`, added to the `main` phase). A responder's counter replaces the open trade with one from the counterer to the original proposer only. Client: swap button and editor in the trade popup (`render/trade.ts`, draft state in `store.ts`), socket event `counterTrade`. Bots never propose counters (no `legal`), but answer them.
  - Avatars: pictogram faces in `src/client/avatars.ts`, keyed by the shared emoji ids. Shown in player list, turn pill, trade popup, robber picker, victory screen. Click your avatar in the lobby to cycle (`setAvatar` event, unique per lobby, host can change bots'). Bots now get animals (`engine.ts` no longer forces the robot), `freeAvatar` in `rooms.ts`.
  - Host-only editing: lobby edits were already host-only on the server; `setGameSpeed` now host-only too. Client guards with a toast (`requireHost` in `actions.ts`). Lobby cursors and Shift laser trail in `src/client/cursors.ts` (`cursor` event, relayed volatile, lobby only).
  - Multiple trade offer stack & timers: engine holds `g.trades: TradeState[]` (newest first, up to 5 open offers, auto-pruned when a proposer spends offered cards) while keeping `g.trade` synced to `g.trades[0]`. Server tracks per-offer expiration timers (`ensureTradeTimers` in `bots/scheduler.ts`, 20s for human offers, speed-scaled for bot offers) and exposes `activeTrades` in `view.ts`. Client (`render/trade.ts`, `styles.css`) renders the Colonist-style top-right stack in our matte token palette: opponent avatar header with collapse/expand chevron, newest offer animated on top pushing older offers down, directional `↓` / `↑` rows, aligned per-player response boxes (clickable checkmark in player color to confirm, muted `✕` for declined, pulsing pending box), counter-offer editor per card, and a smooth bottom countdown bar.
  - README module table updated; `npm run typecheck` and `npm test` verified (26 passing tests).

- **Pass 5 (10-25):**
  - Dash filter on a 7: robber targets no longer show stripes on every tile. Only the tile under the cursor takes a dark slate cast (`.hex-target:hover`, token `--target-dark`, `render/board.ts` + `styles.css`). Touch screens (no hover) get a faint outline on every target.
  - Multiple trade popups and Colonist-style counter trade confirmed as done by Pass 4 (stack, 20s timers, counter editor); the two backlog items were archived. Human offer time limit is `HUMAN_TRADE_WAIT` in `bots/scheduler.ts`.
  - Custom presets: `src/server/presets.ts` (`serializePreset`, `loadPreset`, validated, capped), `mergeSettings` moved into `lobby.ts` (shared by `updateSettings` and presets), socket events `savePreset` / `presetSaved` / `applyCustomPreset`. Client: `src/client/presets.ts` (list in the host's `localStorage`, key `hexsettlers.customPresets.v1`, max 30), preset row in the lobby dock (`#presetRow`). Built-in presets are fixed chips; saved ones have an x with an inline delete confirmation. Saving under an existing name replaces it (that is how a preset is edited). A preset carries map, ports, robber, fog and rules except seats and game speed.
  - Counter editor rework (Colonist style): click your hand cards to add to "You give" (`onClickHandResource` routes to `adjustCounter` while a counter is open, hand view subtracts `counterGive`), click a card in the offer rows to remove one of that type, "Ask for" strip adds to "You get". Labels "You get" / "You give" no longer wrap. Pill-shaped time bar on top of every offer card (`.trade-timebar`, width set by `paintTimerBars` in `render/trade.ts`).
  - Not yet run after these edits: `npm run typecheck` and `npm test`.

## Remaining
- Bot difficulty tiers (Main, Secondary, Overload) and bot addon system: design in `Bot AI Design.md`
- More built-in presets (brainstorm)
- Big-map optimization
- New map generation types (islands, archipelago, lake, realistic)
- Continent map shapes (heat map)
- Setting and navigation UI rework
- Board UI rework (split by use case)

## Next
- Delete `src/server-legacy/` (and `legacy/` when not needed), then close Step 2.
- Step 3 (identity and persistence) only when John says so.
