# Log

## Step 0: Skeleton deploy
- Tagged the old version.
- Chose Render as host.
- Added `/health` route to `server.js`.
- Added `engines.node >=18` to `package.json`.
- Deployed the old game and tested it from phones.

## Step 1: Infrastructure
### Server
- Moved `server.js` to `legacy/server.js` as reference.
- Split the server into TypeScript modules in `src/server/`.
  - `constants.ts`, `util.ts`, `types.ts`
  - `topology.ts`: board geometry and generation
  - `rooms.ts`: room and player creation
  - `rules.ts`: scoring, placement rules, trade ratios, setup flow
  - `actions.ts`: build, roll, robber, trade, end turn
  - `net.ts`: per-player state broadcast
  - `socket.ts`: all socket handlers
  - `bots/strategy.ts` and `bots/scheduler.ts`: bot AI and pacing
  - `main.ts`: Express and Socket.io entry
- Logic copied as-is. No behavior change.
- Types are loose on purpose. Step 2 replaces this code.
- Added `tsconfig.json` (non-strict).
- Added scripts: `dev`, `build`, `start`, `typecheck`, `test`.
- Added 9 vitest tests in `tests/` (topology, util, rules).
- Added `Dockerfile`, `.dockerignore`, `.gitignore`, `render.yaml`.
- Replaced `README.md` with a stub.
- Checked: install, typecheck, tests, build and a dev bot game all pass.

### Client
- Moved the old `index.html` to `legacy/index.html` as reference.
- `public/index.html` is now markup only. It loads `/app.css` and `/app.js`.
- CSS lives in `src/client/styles.css`, copied to `dist/public/app.css` by the build.
- Split the inline script into TypeScript modules in `src/client/`.
  - `constants.ts`, `types.ts`, `store.ts` (shared UI state), `globals.d.ts` (`io`)
  - `socket.ts`, `audio.ts`, `icons.ts`
  - `actions.ts`: lobby and turn actions
  - `render/index.ts`: `renderAll`
  - `render/board.ts`: SVG board, camera, hex/edge/vertex clicks
  - `render/hand.ts`, `render/drawer.ts`, `render/trade.ts`, `render/sidebar.ts`
  - `main.ts`: socket listeners, camera events, window exposure
- esbuild bundles the client to `dist/public/app.js` (IIFE, browser). Config updated.
- Render build command in `render.yaml` is already `npm install --include=dev && npm run build`.
- Logic copied as-is, with these mechanical changes:
  - Inline `onclick` handlers still work because `main.ts` assigns the handlers to `window`.
  - Inline expressions that touched module state became small functions: `onHexEnter`, `adjustDiscard`, `adjustTradeWant`, `adjustTradeGive`.
  - Scalar UI state moved to `store.ts` with setters. Object state is mutated in place.
- Ran `npm install --include=dev`, `typecheck`, `build` and `dev` locally (PowerShell, using `if ($?)` chaining because `&&` is not supported in Windows PowerShell 5). No errors reported.

## Step 1 close-out (2026-10-23)
- Confirmed a full bot game plays in the browser: lobby painting, build, trade, discard, gold, robber, pan/zoom.
- Pushed, and confirmed the Render deploy builds and runs from phones.
- Step 1 is complete. Step 2 (engine and base game) has not been started.

## Environment Import & Setup (2026-10-23)
- Imported repository and configured for Node.js runtime (removed `bun.lock`, verified npm dependencies).
- Updated `src/server/main.ts` to bind explicitly to `0.0.0.0:3000`.
- Added `SIGTERM` process cleanup handler in `esbuild.config.mjs`.
- Added `.env.example`, `metadata.json`, and synced OpenGraph/description meta tags in `public/index.html`.
- Verified build (`npm run build`), unit tests (`vitest run` — 11/11 passing), and dev server health check.
- Paused here as requested; Step 2 has not been started yet.

## Gameplay & UX Updates (2026-10-23)
- **Robber Victim Selection (`ROBBER_STEAL`):** When robbing a hex with 2 or more opposing players, the active player now chooses which opponent to rob via the inline drawer buttons, clicking the opponent's building on the robbed hex, or clicking the highlighted player card in the right sidebar. Preserved `PreRobberPhase` so playing a Knight before rolling returns to `ROLL` phase afterward.
- **Cursor-Centered Zoom & Panning:** Updated wheel zoom (`0.01` to `5.0`) to anchor the world point directly beneath the cursor location, cached board bounds for instant zooming/panning on large maps, and added left-click ocean drag panning alongside right/middle/Alt drag.
- **Max Map Radius 50:** Expanded board radius up to 50 tiles (`1`–`50`) in lobby settings and server validation, and increased Socket.IO `maxHttpBufferSize` to `10MB` for large boards.
- **Colonist-Style Fog Mechanic:** Added Fog tiles (`fog` brush, `fogIsland` preset, and `fogTiles` setting) that hide tile resource types and number tokens (`?` cloud display). When a road is placed touching any fog tile, the tile is revealed (with a pop animation) and immediately grants 1 resource of that tile (or 1 Gold pick for Gold tiles) from the bank.
- **Port Spacing Rule:** Updated `rebuildBoardTopology` and `paintPort` so ports can never spawn or be placed on two adjacent tiles (`hexDistance <= 1`).
- **Lighter Yellow Wheat Color:** Changed Wheat tile, icon, and card colors (`#fff59d` / `#fff9c4`, border `#d4c028`) so Wheat is visually distinct from Gold tiles.
- **Colonist-Style Piece Drop Animations:** Added drop-down bounce and impact ring animations (`piece-drop-anim` and `piece-impact-ring`) when placing roads, settlements, and cities.
