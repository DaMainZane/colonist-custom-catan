# Handoff (written 2026-10-26, end of Step 2 session)

Project: HexSettlers Online (colonist-custom-catan). Backlog order: `Backlog Priority.md`. Dashboard list: `Obsidian Vault/Dashboard.md` > Catan Project.

## Ground rules learned
- The agent that wrote this had only file read/write tools on John's machine (Filesystem + seekstone). **It could not run npm, typecheck or tests.** John runs `npm run typecheck` and `npm test` himself and pastes the output. Never tick a Dashboard box before John says it was tested. Use `seekstone update_task` (guard with `expectText`; retry once on an EPERM error).
- Code layout is in `README.md`. Client is `src/client` (inline `onclick` handlers must be exported and added to the `Object.assign(window, ...)` list in `src/client/main.ts`). Pure engine is `src/shared`, content packs are `src/packs`, server is `src/server`.
- Keep the "// MODULE:" header comment on top of every file.

## Done and tested by John (Step 1, ticked on the Dashboard)
Seed show toggle, bigger settlements/cities (`BUILDING_BASE_SCALE` in `render/board.ts`), scrolling lobby dock + sidebar clip (`styles.css`), built-in preset chips (base, gold and fog packs; tests updated), randomize first placer (already worked: `shuffleSeats: true`). Also removed a stray `syncBoardBuildPopup()` call left by Pass 23.

## Done in Step 2 but NOT yet run or tested (do not tick yet)
1. **Invalid trade ratio prompt** (`render/drawer.ts`): `bankTradeAdvice()` explains why a bank trade is not legal using the player's own port rates; "Fix amounts" button (`fixBankTrade`, registered in `main.ts`); disabled Bank button now has a title with the reason; `.trade-hint.warn` in CSS.
2. **Dev card / bank auto-scale** (`server/runtime.ts` `scaledSupply`, `settingsForPlayers(s, players, landHexes)`, called from `server/game.ts`): only when the host left bank + dev numbers at the standard values. Land tiles x0.8 for the bank, x1.2 for the dev deck, never below the player-count floor. No UI shows this; consider logging it in the lobby/game log. No test added yet: add one in `tests/rules.test.ts` (standard 19 land tiles must stay 14/5/2/2/2 and bank 19).
3. **Turn timer visualizer** (`render/turnclock.ts`, CSS `.turn-clock-bar`): a draining bar next to the clock text in the turn pill. The turn timer itself already existed (lobby > Rules and cards > Timers > "Turn time", default 0 = off, so John saw none). Consider defaulting it on or adding a lobby toggle.
4. **Auto-discard on timer** (`server/turnClock.ts` `clockOwner`, `server/bots/scheduler.ts` `handleTurnExpiry`): a human who owes a discard now has their own clock even when a bot plays the turn; on expiry every human who still owes is discarded by the bot brain. Known side effect: after the discard phase the turn owner gets a fresh full clock. The pending-discard field is `p.pending.discard`.
5. **Shape fallback is now visible** (`client/mapmenu.ts`): a red "shape not applied" tag appears when the generator reports `shape-fallback`. This is a diagnostic only, NOT the fix.

## Next steps
- Ask John to run typecheck + tests, then to play-test items 1 to 4 (set Turn time to e.g. 30 s, roll a 7 with a human holding 8+ cards, try bank trades with and without ports).
- **Shape bug (Dashboard line 102)**: a fix was written in Pass 26 (see "Pass 26" below), NOT run. Old notes, kept for context: root cause was unknown. It is the `shape-fallback` path in `shared/mapgen.ts` -> `runShape` (`shared/mapshape.ts`, not read yet). Likely candidates: carve ops (`river`, `lake` in `packs/base/map/shapes.ts`) or islands on the default radius 2 board (19 tiles). Ask John for the picks, radius and the tag tooltip text, or write a vitest that loops `generateMap` over radius 2..6 for islands+river and logs how often `shape.fallback` is true.
- Remaining Tier 3 and 4 items are in `Backlog Priority.md` (settings/navigation UI rework, reconnect after logout, bot training data log, port spawn rework, bot initial placement, big-map optimization, full board UI rework).
- Victory screen optimization was already touched in Pass 17 (see `change log.md`); ask John what is still wrong before redoing it.
- `change log.md` has entries for Step 1 (Pass 24) and Step 2 (Pass 25). Add a Pass 26 entry for anything new, newest on top, same format.


## Current state (after Pass 27)

**Updated after Pass 27 (2026-10-26).** Read `Backlog Priority.md` for the order, `change log.md` for details.

### Ground rules (unchanged)
- No shell in the agent session: it cannot run npm. John runs `npm run typecheck; npm test` and pastes the output. Tick a Dashboard box only after John says it was tested (`seekstone update_task`, guard with `expectText`).
- No grep tool either: find code by file name (`search_files`) and read files.
- Client inline `onclick` handlers must be exported and added to `Object.assign(window, ...)` in `src/client/main.ts`. Keep the `// MODULE:` header on every file. Change log: newest on top, one Pass per batch of work.

### Done and tested
- Step 1 items (seed toggle, bigger pieces, scrolling dock, presets, randomize first placer).
- **Pass 26 shape add-on bug** (river/lake/islets fell back to the hexagon): fixed, typecheck + all tests pass, Dashboard ticked.

### Written, NOT yet run or play-tested (do not tick)
1. Pass 25: bank trade ratio advice + "Fix amounts" (`render/drawer.ts`), dev deck / bank auto-scale (`server/runtime.ts` `scaledSupply`; still needs a test in `tests/rules.test.ts`: standard 19 land tiles stays 14/5/2/2/2 and bank 19), turn clock bar (`render/turnclock.ts`), human discard clock (`server/turnClock.ts`, `server/bots/scheduler.ts`). Dashboard lines "auto discard", "invalid trade ratio", "dev card scale", "turn timer visualizer" stay open until John plays them (set Turn time to 30 s, roll a 7 with a human holding 8+ cards, bank trade with and without ports).
2. **Pass 27**: the false "No one has any X to trade" toast. Cause: the client used the lobby bank number (19) instead of the real supply, which Pass 25 scales. Now `bankSupply` comes from `server/view.ts`. John should check a game with a bigger board or 5+ players. Dashboard last line stays open until then.

### Next, easiest to hardest
1. **Scale city, settlement and road with the VP setting (infrastructure above the base limit costs double)**: not started. The wording is ambiguous, so ask John before coding: (a) do `maxSettlements/maxCities/maxRoads` grow with `vpToWin` only when left at 5/4/15, like the bank scaling? (b) by what formula (per extra VP)? (c) is "base limit" 5/4/15, and does "double" mean the whole resource recipe x2 for every piece past the base count? Where to look: `rulesFromSettings` and `settingsForPlayers` in `server/runtime.ts` (limits), the build actions in `packs/base/actions/` (costs), recipe popups in `client/render/` (cost display must show the doubled price).
2. Victory screen optimization: ask what is still wrong (Pass 17 touched it).
3. Tier 3: settings/navigation UI rework, reconnect after logout, bot training data log (settle the JSON-lines schema first).
4. Tier 4: port spawn rework, bot initial placement, big-map optimization (profile first; the budget test shows r20 hexagon ~190 ms median vs a 100 ms target), full board UI rework.



## After Pass 29 (2026-10-26)

- John tested Pass 27: the false "No one has any X" toast STILL appeared. Pass 29 removed the client guess in `proposePlayerTrade` and moved the check to `propose_trade` validate (`tradeOffers.ts`, real hands, humans only). Written, NOT run. If the toast still shows after a hard refresh and a server restart, ask for board size, player count, the resource, and what the player list shows for card counts.
- Pass 29 also: discard clock now gives the turn its remaining time back (`savedTurnClock` in `turnClock.ts`), port rework (`portCap` in `shared/topology.ts`, `TileDef.noPort`, fresh port-pool shuffles in `mapgen.ts`, `GEN_VERSION` 3), tests in `tests/rules.test.ts` and `tests/mapshapes.test.ts`.
- John runs `npm run typecheck; npm test` and pastes the output. Open and unticked on the Dashboard until he plays them: auto discard, invalid trade ratio, dev card scale, turn timer visualizer, both "no one has x-resource" lines, port spawn rework.
- Still asked, not coded: scale city/settlement/road with VP (needs John's answers on formula and "double cost").
