# Change Log

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
- Bot difficulty tiers (Main, Secondary, Overload) and bot addon system: `Bot AI Design.md`.
- More built-in presets, big-map optimization, new map generation types (islands, archipelago, lake, realistic), continent map shapes, settings and navigation UI rework, board UI rework.
