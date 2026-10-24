# Log

## Step 0: Skeleton deploy (done)
- Tagged old version. Host: Render. Added `/health`. Deployed, tested on phones.

## Step 1: Infrastructure (done, 2026-10-23)
- `server.js` and `index.html` split into TypeScript modules: `src/server/` and `src/client/`. Originals kept in `legacy/`.
- esbuild bundles both: `dist/main.js` and `dist/public/app.js` (+ `app.css`).
- Scripts: `dev`, `build`, `start`, `typecheck`, `test` (vitest).
- Added `Dockerfile`, `.dockerignore`, `.gitignore`, `render.yaml`, stub README.
- Render build: `npm install --include=dev && npm run build`.
- Bot game verified in browser, deployed, tested from phones.

## Setup tweaks (2026-10-23)
- Server binds `0.0.0.0:3000`. SIGTERM cleanup in `esbuild.config.mjs`.
- Added `.env.example`, `metadata.json`, OpenGraph tags. 11 tests pass.

## Gameplay and UX added (2026-10-23, legacy-style code, to port in Step 2)
- Robber victim choice (`ROBBER_STEAL`), keeps `PreRobberPhase`.
- Cursor-centered zoom, left-drag pan. Map radius up to 50.
- Fog tiles: reveal on adjacent road, grant 1 resource or gold pick.
- Port spacing rule (no ports on adjacent tiles).
- Wheat color lightened.
- Animations: piece drops, flying cards, robber move, steals, trades, dev cards, discards.
- Rolled-hex highlight, overlapping card stacks, discard drawer, victory overlay with stats and rematch.
- Synthesized sound effects in `audio.ts`.
- Game speed setting (0.5x to 8x).

## Step 2: Engine and base game (in progress, 2026-10-24)
Testing between sub-steps skipped on purpose. Run `npm run typecheck` before 2f.
- 2a done: `src/shared/` core (RNG, palette, types, ctx, registry).
- 2b done: topology and map generation as pure registry-driven functions (`topology.ts`, `mapgen.ts`).
- 2c done: engine helpers, `dispatch` pipeline, `legalActions`, per-player views. Fixed a duplicate `startTurn` export.
- 2d done: `src/packs/base/` (roads, settlements, cities, 5 dev cards, Longest Road, Largest Army, ports, phases, 14 actions). Added optional `DevCardDef.legal`.
  - The `pick` phase and action live in base (Year of Plenty needs them). Gold and fog only add the tile and `pending.pick`.
  - Robber steal choice (`robber_steal`) is in base, moved up from 2e. The engine has no bot special-casing, bots choose via `legal`.
  - Setup picks (gold in the second round) now happen before the road, not after. Same outcome.
  - `propose_trade` has no `legal`, so bots will not propose trades until 2g decides.
- 2e done: `src/packs/gold/index.ts`, `src/packs/fog/index.ts`, `allPacks` in `src/packs/index.ts` (base, gold, fog).
  - Gold: tile `gold` (numbered, no `produces`). `onProduce` adds `pending.pick` and emits `goldEarned`; base `settlePicks` opens the `pick` phase. Rule `tileCounts.gold: 2` (merged into base counts). Preset `goldRush` (max(5, total/3) gold).
  - Fog: `afterMapGenerated` hides N numbered land tiles (`ext.hidden`, `ext.maskAs = 'fog'`), N = preset `extra.fogCount` or `rules.fogTiles` (default 0). Preset `fogIsland` (max(4, 42%)). Registered tile `fog` is only the masked look in `views.ts`.
  - Fog reveal: `onBuild` for pieces listed in `rules.fogRevealBy` (default `['road']`, edge pieces only). Reveals hidden tiles on the edge and around both endpoints, then pays one production through `produceFromHex` (a card for resource tiles, a pick for gold). Setup roads reveal too.
  - Real type and number stay in the hex while hidden (legacy re-rolled them on reveal). Hidden tiles are skipped by production, setup production and the robber already.
  - Not yet done for gold/fog: client icons, lobby settings mapping (`goldTiles`, `fogTiles`, presets) in 2f.
- 2f done (code written, not compiled yet): server adapter on the engine.
  - `runtime.ts` (one registry, `rulesFromSettings`), `lobby.ts` (board generate/presets/paint on the engine board), `rooms.ts`, `game.ts` (`runAction`, `startGame`, `rematch`, engine events -> client effects), `view.ts` (engine state -> the legacy `gameState` shape), `net.ts`, `socket.ts` (every game action goes through `dispatch`), `main.ts`.
  - The client was not touched: `view.ts` keeps the legacy shape (phase names, `building`/`road` on vertices/edges, `fog` flag, `logs`, `recentTransfers`). Hidden fog tiles are masked per viewer.
  - Settings map: `goldTiles` -> `tileCounts.gold`, `desertTiles` -> `tileCounts.desert`, `fogTiles` -> `fogTiles`, presets `goldRush`/`fogIsland`/`archipelago`/`blank`.
- 2g done (code written, not run yet): bot and sims.
  - `src/server/bots/brain.ts`: pure `chooseBotAction(g, reg, pid, rand)`. Picks from `legalActions`, ported the Hard Bot heuristics (vertex/road/robber scoring, build plan, spare cards, trade evaluation). Checks every choice with `checkAction`, falls back to `end_turn` or the first legal action.
  - `src/server/bots/scheduler.ts`: one pending bot step per room after each broadcast, delays scaled by game speed, 4.5 s wait on a bot's open offer. Hooked in by `initBots()` in `main.ts`.
  - Bot proposer cancels its own offer once nobody is left pending (brain), so no special-casing in the engine.
  - `src/server/bots/sim.ts`: `simulateGame({ seed, players, preset, rules })` with a seeded rand, checks card conservation each step, reports rejected actions and stalls.
  - Tests rewritten for the engine: `tests/rules.test.ts`, `tests/topology.test.ts`; new `tests/sim.test.ts` (3 presets x 2 and 4 bots x 2 seeds, determinism, 6 bots on radius 4).
  - Old server code (`src/server-legacy/`) is still in place. Delete it after typecheck, tests and one live game pass.

### Step 2 verification (2026-10-24)
- `npm run typecheck` found 6 errors, all `res.error` on `DispatchResult`. Cause: `tsconfig` has `strict: false`, so TS does not narrow the `ok: true | false` union. Fixed in `src/shared/engine.ts` by declaring `error` and `events` on both branches (`error?: undefined` / `events?: undefined`). Typecheck is clean.
- `npm test`: 3 files, 25 tests pass (rules 8, topology 9, sim 8). The sim tests (standard, goldRush, fogIsland; 2 and 4 bots; determinism; 6 bots on radius 4) finish with no stalls, rejected actions or card-conservation breaks.
- Live bot games in the browser worked, including the gold and fog presets.

## Design direction (decided 2026-10-24)
- New UI direction written up in `Design UI Philosophy.md`: Lichess shell (board is the hero, UI recedes) + Mini Metro-style flat assets drawn as recognizable pictograms + Dorfromantik colors (muted, warm, matte). Dieter Rams monochrome style rejected.
- Findings on the current client: Colonist-style skin (gradients, 3D buttons, black outlines, illustrated icons, emoji avatars), with hex colors hardcoded across `styles.css`, `constants.ts`, `icons.ts` and `render/board.ts`. A design-token (CSS variable) layer comes first.
- Icons revised after previews: first draft was abstract geometric glyphs, rejected as not recognizable. Approved: flat pictograms (pine tree, brick wall, sheep, wheat stalk, rock, ingots, cactus, cloud), and larger pieces (road bar, house, tower-plus-house city) with a light rim so they stand out on every tile color. Details and palette in `Design UI Philosophy.md`.
- Open: piece rim may change from light to black or gray, to be compared in the next preview.
- Built in Step 4 (UI and phone together). No client code changed yet.

## Backlog pass 1 (2026-10-24, easiest first, not compiled or tested yet)
- Removed probability dots under tile numbers (`tokenMarkup` in `render/board.ts`).
- 3:1 port badge and "any" palette swatches use `--token` so the dark label stays readable in dark mode.
- Flying cards fade in about 90 ms right after landing instead of lingering.
- Dark mode toggle added to the welcome page (`toggleTheme()` was already in the game nav).
- No gold in normal games: gold pack default 0, `defaultSettings().goldTiles` 0, lobby field default 0. Gold Rush preset unchanged.
- Lobby log no longer repeats the room code (the turn pill already shows it).

## Backlog pass 2 (2026-10-24, not compiled or tested yet)
- Join: the landing page has one "Join game" button. No code means the newest open lobby (`joinRoom` in `socket.ts`). Invite links (`?room=CODE`) still work through a hidden input. The lobby pill no longer shows the code.
- Trade: when every responder declines, the engine closes the offer (`respond_trade` in `tradeOffers.ts`), so the window disappears.
- Trade popup rows reordered to match the trade sheet (get on top, give below), label and cards forced onto one line.
- VP: players see their own `8(9)` when a hidden VP card counts. Server sends `publicVp` per player (`view.ts`). Other players already only got public VP.
- Player list keeps its scroll position across repaints, rows no longer shrink, stable scrollbar gutter.
- Rolled tiles darken for about 2 s and fade back (timer keyed in `render/board.ts`, `.hex-rolled` in `styles.css`).
- Robber targets: striped fill and pulsing dashed edge (`#targetStripes` pattern).
- Glow and throb on buildable road spots, settlement spots and upgradable settlements.
- Sandy beach rim under coastal tiles (`--sand` token, light and dark).
- Bank trade shows a toast when the bank lacks the wanted resource (`executeBankTrade` in `drawer.ts`).
- Needs a check: `npm run typecheck`, `npm test`, then one live game.

## Backlog pass 3 (2026-10-24, easiest first)
- Fixed map panning when pressing on tiles (`main.ts`, `store.ts`, `render/board.ts`): left-click dragging anywhere on the board (tiles, tokens, pieces, sand, or ocean) now pans the camera smoothly while preserving single-click actions (`hasDraggedMap` threshold). In the lobby, no brush is active by default (and clicking an active brush toggles it off), so dragging on tiles moves the map unless actively painting with a brush.
- Sand border under all land tiles (`render/board.ts`): `--sea-shallow` and `--sand` base layers now render under all land tiles (`h.type !== 'water'`), filling inner inter-tile gaps with sand as well as the coastline.
- Darker trim border on tiles (`styles.css`, `constants.ts`, `render/board.ts`): added `--trim-*` tokens (`--trim-wood`, `--trim-brick`, `--trim-sheep`, `--trim-wheat`, `--trim-ore`, `--trim-desert`, `--trim-gold`, `--trim-fog`) and rendered every land hex with a rounded darker border trim.
- Trading Port UI rework (`portMarkup` in `render/board.ts`, `styles.css`): aligned ports strictly to the coastal hexagon edge using edge tangent `T` and outward normal `N`, with a timber dock apron, cross-planks, thick rimmed piers, mooring posts, and a double-ringed port badge with a `2:1` / `3:1` pill.
- Auto-connecting roads + hover longest-stretch highlight & counter (`render/board.ts`, `styles.css`, `index.html`):
  - Roads owned by the same player now extend to shared vertices (when unblocked by opponent buildings) and render in a unified rim layer + fill layer so connected segments merge into one continuous road.
  - Hovering over any road highlights its connected network and pulses the longest continuous road stretch on the board while showing a floating tooltip with the player's longest stretch and total connected road count.
- Epic animation for getting/taking Longest Road and Largest Army (`triggerAwardAnimation` in `render/board.ts`, `playAwardSound` in `audio.ts`, `main.ts`, `styles.css`): animated centerpiece banner with spinning rays, road/sword emblem, claimed vs. stolen callout, and brass fanfare when Longest Road or Largest Army changes hands.
- Bot trash talk and dialogues (`src/server/bots/dialogue.ts`, `src/server/game.ts`): bots post contextual chat lines on 7-rolls, steals/getting robbed, Knight/Monopoly plays, city upgrades, trade completions, claiming/stealing Longest Road or Largest Army, and winning.

## Remaining backlog (next passes)
- [ ] Counter trade mechanic (inside the trade UI popup from opponent)
- [ ] Allow multiple trade offer UI popups to exist (with time limit, newest offer on top pushing older trades down)
- [ ] Make the host the only one that can edit (others can see and suggest using cursor and laser drag mechanic)
- [ ] Bot difficulty tiers (Main - Secondary - Overload, GTFO-style)
- [ ] Optimization for bigger maps
- [ ] New map generation types (separate islands, archipelago, lake within land, realistic mountain ranges and resource clumps)
- [ ] Map shape (continent shapes using heat map algorithm)
- [ ] Custom presets (create, edit, removable vs. built-in unremovable with delete confirmation prompt)
- [ ] Setting and Navigation UI rework
- [ ] Board UI rework (buttons, chat, resources, split by use case)

## Next
- Delete `src/server-legacy/` (and `legacy/` when no longer wanted as reference), then close out Step 2.
- Start Step 3 (identity and persistence) only when John says so.
