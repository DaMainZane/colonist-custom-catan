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
- **Shape bug (Dashboard line 102)**: root cause unknown. It is the `shape-fallback` path in `shared/mapgen.ts` -> `runShape` (`shared/mapshape.ts`, not read yet). Likely candidates: carve ops (`river`, `lake` in `packs/base/map/shapes.ts`) or islands on the default radius 2 board (19 tiles). Ask John for the picks, radius and the tag tooltip text, or write a vitest that loops `generateMap` over radius 2..6 for islands+river and logs how often `shape.fallback` is true.
- Remaining Tier 3 and 4 items are in `Backlog Priority.md` (settings/navigation UI rework, reconnect after logout, bot training data log, port spawn rework, bot initial placement, big-map optimization, full board UI rework).
- Victory screen optimization was already touched in Pass 17 (see `change log.md`); ask John what is still wrong before redoing it.
- `change log.md` has entries for Step 1 (Pass 24) and Step 2 (Pass 25). Add a Pass 26 entry for anything new, newest on top, same format.
