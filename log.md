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
- Passes 2 and 3 still need `npm run typecheck`, `npm test` and one live game.

## Remaining
- Counter trade in the trade popup
- Multiple trade popups (time limit, newest on top)
- Host-only editing, others suggest with cursor and laser drag
- Bot difficulty tiers (Main, Secondary, Overload)
- Big-map optimization
- New map generation types (islands, archipelago, lake, realistic)
- Continent map shapes (heat map)
- Custom presets (built-in ones unremovable, delete confirmation)
- Setting and navigation UI rework
- Board UI rework (split by use case)

## Next
- Delete `src/server-legacy/` (and `legacy/` when not needed), then close Step 2.
- Step 3 (identity and persistence) only when John says so.
