# Handoff - T14 Sim Matrix (Tidebound balance gate)

Written 2026-11-01. Read this first for T14. Then `CLAUDE.md`, then `Development Plan.md` section 3 (T14 row and "Split step"). Do not read whole folders.

## Where things stand

- T0 to T13 of Tidebound are done, and typecheck and tests were clean when the T13 bot-brain cleanup finished (the user ran them, 2026-11-01).
- `src/server/bots/brain.ts` is generic. Tidebound bot logic lives in `BotGoalDef` hooks (`tidebound/tech.ts`, `pirates.ts`, `bridgeCore.ts`). Do not put Tidebound names back in the brain.
- The sim matrix already exists for the base game (S0.16, Service 20). It has no Tidebound rows yet. T14 adds them.

## T14 steps (from `Development Plan.md`)

| ID | Step | Size |
|---|---|---|
| T14a | Sim matrix runner: Tidebound on/off x tech tree on/off at 25+ VP | M |
| T14b | Check Grand Causeway swing | S |
| T14c | Tune tier prices | S |

## What exists (read these, nothing else, to start)

- `src/server/bots/sim.ts`: `simulateGame(opts)` plays one bot-only game and returns `{ finished, winner, winnerTier, turns, steps, error, decisionMs, game }`. `runSimMatrix(opts)` runs scenarios x combos x tier lineups x seeds and returns cells plus `botTestedByCombo`. Combo spec fields: `id`, `dlc`, `addons`, `eventsOn`, `techTreeOn`, `scenarioIds`. Scenario spec: `id`, `picks`, `mapParams`, `preset`, `rules`.
- `tests/simmatrix.test.ts`: the current matrix test (base game only, 3 players, 2 seeds).
- What a game currently fails on, and nothing more: a rejected action, a stall, no winner within `maxSteps` / `maxTurns`, or bank + hands not equal to the starting bank per resource (`checkInvariants`).

## T14a: what to build

1. Add Tidebound combos (new rows, do not change the existing base rows):
   - `tb_on_tree_off`, `tb_on_tree_on`: Tidebound DLC on with every addon, `techTreeOn` false and true.
   - Add the same two with `eventsOn: true`, because the storm and pirate cards only come from the event deck when it is on (otherwise the passive cadence spawns them).
   - Optional isolation rows, one addon each (`tidebound.tides`, `rising_sea`, `pirates`, `wrecks`, `fishing`, `harbor`, `bridges`, `rickety_bridges`), so a failure names its addon. Keep these to a few seeds.
2. Set `rules.vpToWin` to 25 or more on the "25+ VP" rows. Also keep one 10 VP row: that is the default game.
3. Scenarios must use a Tidebound map: the `wide_water` perk (and the `crossing` capability it comes with, for island shapes). **Verify the exact pick string** for the perk (the existing picks look like `perks.ports`; check how `wide_water` is named in the map menu) before writing the scenario. A scenario without the perk plays Tidebound on a base map, which hides most of the content.
4. Extend the checks. Today only bank conservation is checked. Add a `checkTideboundInvariants(g)` called after every step when Tidebound is on, returning the first problem or null. Candidates (each should be a real rule, check the file named before trusting it):
   - never more than `PIRATE_MAX` (2) pirate markers (`tidebound/pirates.ts`)
   - no production from a `flooded` or `drowned` tile, and a robber never placed on one (`tidebound/tides.ts`, `risingSea.ts`)
   - no player above the supply for any piece with a `baseLimit` (net, bridge, rickety bridge, harbor limit 1, or 2 with `harbor_empire`); bridges and rickety bridges share one pool (`syncBridgePool`)
   - fish wild tokens never negative, and never in the bank or a hand's resource map
   - a `wreck` marker's countdown is never below 0 after the round step
   - `portUpgrades` level at most 2, and only on a vertex that has a port and a city or (with `fishing_nets`) a settlement
   - drowned tiles stay drowned
   Keep it cheap: it runs after every step of every game. Do not draw from `g.rng` or any derived stream in a check.
5. Report more than pass/fail, so T14b and T14c have data. Per cell: win rate per tier, average turns, `maxDecisionMs` (Tidebound boards are bigger, watch it), and per-game counts that the next two steps need (below).
6. A real run is slow. Keep `tests/simmatrix.test.ts` small enough for `npm test` (few seeds, 3 players). Put the large run (many seeds, 25+ VP) behind a separate script or test that is skipped by default, for example `npm run sim:tidebound`, and say in the final message how long it took.

## T14b: Grand Causeway swing

Question: does `tidebound.grand_causeway` (Longest Road worth 16 VP instead of 2, while the road includes a bridge) decide too many games? Measure, over many seeds with the tree on:
- how often a game's winner held `grand_causeway` and Longest Road with a bridge at the end
- the win rate of players who researched it against those who did not (same tier, rotated seats)
- how often it flipped the lead (winner would not have won without the +14)
- average turn at which it was researched

Add the counts to the sim output; do not change game rules in this step. If the swing looks too large, write down the numbers and the options (cost offset, VP value `GRAND_CAUSEWAY_VP`, a cap), and ask the owner before changing anything.

## T14c: tune tier prices

Tech cost uses `costOffset` per node (tier 2 = 3, tier 3a = 5, tier 3b = 7, tier 4 = 10) through `techCostCards` in `shared/stage1.ts`. Piece prices: net (placeholder 2 wood + 1 sheep), bridge (wood + brick + ore), rickety (1 wood), harbor upgrade (2 wood + 1 brick + 1 ore). Use the sim data to see which nodes bots research too early or never, and which pieces they never build. Tune numbers only where the data shows a clear problem, one change at a time, re-run after each. Any price change is a Tidebound behavior change: DLC off must stay identical, so `tests/golden.snapshot.json` must not change.

## T14a-2: run 4 games at once (for the large run only)

The matrix is synchronous and runs one game at a time. Games are independent and seeded, so the large run can be spread over 4 workers. Do this after T14a works single-threaded, and keep the single-threaded path as the default for `npm test`.

- Use Node `worker_threads` (or child processes). Split by game (scenario, combo, lineup, seed), not by cell, so the load stays even. Default 4 workers, overridable (for example `--workers 4`). Do not use more workers than CPU cores.
- A worker needs compiled JavaScript. The project bundles with esbuild (`esbuild.config.mjs`), so add a small worker entry that imports `simulateGame` and is bundled the same way. Check how `package.json` scripts run TypeScript before choosing; do not assume `tsx` or `ts-node` is installed.
- Results must not depend on the worker count. Each game is fully determined by its seed and options, so merge results in the original loop order and compare a 1-worker run with a 4-worker run on a few seeds (same winners, turns and errors).
- Before relying on it, check module-level state that could leak between games in one process: `gameRegistry` in `server/runtime.ts` (cached?), and the `WeakMap` caches (`MEMORY` in `brain.ts`, `axialIndexCache` in `pirates.ts`, any `registryFor` cache). WeakMaps keyed by the game object are safe; a shared mutable registry is not.
- Pass only plain data to a worker (options in, a trimmed result out). `SimResult.game` is the whole game state: drop it or reduce it to the counts T14b needs before sending it back.
- Report failures with the same message format, so a failing seed still becomes a bug report.
- Memory: four Tidebound 25+ VP games at once use more RAM than one. Say in the final message what the run used and how long it took with 1 and with 4 workers.

## Rules that apply (from `CLAUDE.md` and `Development Plan.md`)

- No `g.rng` draws in addon code or in checks. DLC off = zero effect.
- Never regenerate `tests/golden.snapshot.json` or `tests/view.snapshot.json` to make something pass.
- Every `src/**/*.ts` file starts with a `// MODULE:` header. Update `INDEX.md` Root, Docs and `tests/` rows if you add files there, and add a pass to `change log.md`.
- The agent has no shell. Do not claim a command passed; give the exact commands and ask for the output.

Commands for the owner (PowerShell, no `&&`), one block at the end of each step:

```
npm run headers:write; npm run index; npm run typecheck; npm test
```

## Bugs the sim finds

Each failing seed is a ready-made repro. When the sim reports an error, write the report in the shape of `BUGS/Bug Report Template.md`: Repro = scenario id, combo id, seed, player count, tier seating, and rules. The error message from `simulateGame` already names the player, action and phase. Fix with a failing test first, as in `CLAUDE.md`. Do not edit the matrix to hide a failing cell.

## Not verified (check before relying on it)

- Whether `src/server/main.ts` has a CLI that runs the sim (the `sim.ts` header says it is used by `server/main`). If it does, extend that instead of adding a second entry point.
- The exact rule keys and ids: `rules.addons` ids (`tidebound.rising_sea` and the other seven), `tideLevel`, `risingSeaLevel`, and the `wide_water` pick string.
- Whether 25+ VP games with Tidebound finish inside the default `maxTurns` (1000) and `maxSteps` (60000).
- `tests/mapsims.test.ts` and `tests/sim.test.ts` were not read; check they do not conflict with new combos.

## Done when

- Tidebound rows exist in the matrix, the default test stays fast and green, and the large run reports zero errors (or each error is fixed or logged as a bug).
- Tidebound invariants run in every Tidebound game and have at least one test that fails when a rule is broken on purpose.
- T14b has numbers and a written recommendation. T14c changes, if any, are justified by the data and the DLC-off tests and golden snapshot are untouched.
- `change log.md` pass written, and the commands above run clean.
