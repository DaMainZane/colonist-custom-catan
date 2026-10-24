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

## Next
- Delete `src/server-legacy/` (and `legacy/` when no longer wanted as reference), then close out Step 2.
- Start Step 3 (identity and persistence) only when John says so.
