# Change Log

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
