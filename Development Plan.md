# Development Plan

Drafted 2026-10-27 after reading `Ideas.md` (build order, Integration Layer) and the engine source (`shared/registry.ts`, `types.ts`, `state.ts`, `ctx.ts`, `engine.ts`; `packs/base/building.ts`, `trading.ts`, `hooks.ts`, `actions/roll.ts`; `packs/fog/index.ts`; `server/runtime.ts`).

**Not read yet** (check before the steps that touch them): `base/picks.ts`, `base/actions/endTurn.ts`, `base/phases.ts`, `server/bots/brain.ts`, `server/bots/sim.ts`, `server/view.ts`, `client/render/*`, `Bot AI Design.md`.

Scope: Stage 0 (shared services) is planned in detail. Stages 1 to 9 follow `Ideas.md` > Suggested order of build and get re-planned at each gate.

---

## 1. Where the code is today

The engine is already a pack system, so Stage 0 is mostly **refactoring hardcoded base logic into hookable services**, not greenfield.

**Already there**
- `Pack { id, deps, rules, register(api) }` with `createRegistry`, duplicate detection, `replace: true`, rule deep-merge in load order. Packs: `base`, `gold`, `fog`.
- 9 hooks: `onGameStart`, `onTurnStart`, `onTurnEnd`, `onRoll`, `onBuild`, `afterAction`, `vp`, `afterMapGenerated`, `onView`.
- `ctx.emit` events and `g.ext` (pack-namespaced state), `hex.ext` (per-tile state), `g.version` for migration.
- Seeded RNG in `g.rng`. Vitest suite (18 files) and a bot-vs-bot simulator.
- `computeVP(g, reg, p, includeHidden)` already gives a public vs hidden split.

**Hardcoded today (what each service has to extract)**

| Service | Today | Change |
|---|---|---|
| Production pipeline | `roll.ts`: `matchingHexes` then `produce` then `produceFromHex`; only hook is `tile.onProduce` | Ordered stages that packs can add to |
| Seven Resolver | `roll.ts` `handleSeven`: robber phase plus discard push, hardcoded | Ordered step list with a cap setting |
| Piece cost and limit | `building.ts`: `BASE_PIECE_LIMITS` covers road/settlement/city only; doubling in `pieceCost` | `baseLimit` on `PieceDef` plus cost modifiers |
| Trade ratio | `trading.ts` `tradeRatios`: min of `bankRatio` and owned ports | One function with modifiers and a 2:1 floor |
| Score | `state.ts` `computeVP`; `checkWinner` reads hidden VP | `score()` with a mode (vp or produced), `publicVP()` as the vp-mode form |
| Stats | `hooks.ts` `recordActionStats`: one big switch | Per-pack event-to-stat handlers (stats registry) |
| History | `g.log` is 80 text lines; `ctx.events` are thrown away each action | Public history ring buffer |
| Round clock | none; only `onTurnStart` / `onTurnEnd` | `onRoundStart` / `onRoundEnd`, `g.round` |
| Tile state | `hex.ext` free-form, only `hidden` used | Typed state with timers, read by production |
| Settings to rules | `runtime.ts` `rulesFromSettings` is hand-written per field | Generic DLC/addon toggle path |
| DLC level | A pack has no addons, no `links` | `addons` plus `links` on `Pack` |
| Registries | Fixed maps in `Registry` | Generic keyed registries (events, techs, contract conditions, stats, dialogue, placements, tile states, bot goals) |

**Housekeeping found**
- `INDEX.md` lists `Backlog Priority.md`, but it is not in the project folder.
- `tsconfig` has `strict` off. Fine for now, but new service code should avoid relying on that.
- `render.yaml` is on Render's **free plan**. As far as I know free instances have no persistent disk, so `data/bots` and `data/players` would reset. Verify before building service 19 (see Risks).

---

## 2. Working rules (apply to every step)

1. **Golden baseline first.** Before any refactor, record seeded bot-vs-bot games (final state hash plus log hash) as a test. Every Stage 0 step must keep it green. This is what "base game plays unchanged" means in practice.
2. **Refactor, then add.** A step first moves existing behavior behind the new service with zero behavior change (golden green), and only then lets something new register into it.
3. **DLC off means zero effect.** A disabled addon must not draw from `g.rng`, add state, or change legal actions. Give each addon its own derived RNG stream so enabling one does not shift the base game's seeds.
4. **Done criteria per step:** `npm run typecheck`, `npm test`, golden test, sim ladder unchanged, `MODULE:` header on new files, `INDEX.md` and `change log.md` updated, `g.version` bumped if state shape changed.
5. **Registration only.** New content goes in through `api.*`, never by editing `engine.ts` or base files again once a service exists.
6. **One service per commit** so a bad one can be reverted alone.

---

## 3. Stage 0: Foundations

### Slice A: engine plumbing (behavior-neutral)

**S0.0 Golden baseline**
- Add `tests/golden.test.ts`: N fixed seeds across standard, goldRush, fogIsland and one big map, bot-vs-bot to the end, hash final state and log.
- Needs `bots/sim.ts` API (not read yet).
- Done: green on the current code, committed before anything else.

**S0.1 DLC and addon layer, generic registries** (service 1)
- `Pack` gains `addons?: AddonDef[]` (`id`, `name`, `deps`, `links: {target, kind}[]`). DLC = one pack with `deps: ['base']`.
- `Registry` gains `registries: Map<kind, Map<id, def>>` and `api.register(kind, def)` so new kinds need no edits to `registry.ts`.
- Enabled set: `rules.dlc[packId]` and `rules.addons[addonId]`, helper `isOn(g, id)`. DLC master switch turns all its addons on or off.
- Settings: replace per-field wiring with a `dlc` / `addons` block in `Settings` and `rulesFromSettings`.
- Link audit test (Rule of Two): every addon has 2+ links, at least one to a General service.
- Done: existing packs still load, a dummy test DLC with two addons toggles correctly, audit test fails when links are missing.

**S0.2 Round clock** (service 2)
- Add hooks `onRoundStart` and `onRoundEnd`, `g.round`, and a helper `everyNRounds(n, fn)`.
- Need to read `endTurn.ts` first to define a round during setup (suggest: setup is round 0, round 1 starts at the first normal turn).
- Real-time mode later swaps the trigger, not the subscribers.

**S0.3 score() and publicVP()** (service 3)
- `score(g, reg, p)` reads `rules.scoreMode` (`vp` default, `produced` for Sandbox). `publicVP()` = vp-mode with `includeHidden: false`.
- Route `checkWinner` through it. Grep bots and view code for direct `computeVP` use (leaderCutoff, lockdown) and move them to `publicVP()`.
- Done: golden green; Taxes and Catch-up will read only `publicVP()`.

**S0.4 Piece cost and limit service** (service 4)
- `PieceDef.baseLimit` replaces `BASE_PIECE_LIMITS`. Cost goes through a modifier list (base: the existing "double above base").
- Keep the `vpToWin` scaling in `createGame` and `scaledPieces` behavior identical.
- Done: bridges, castles, gates and nets can later declare a `baseLimit` and inherit the rule.

**S0.5 Trade ratio function** (service 5)
- `ratioFor(g, reg, pid, resource)` with an ordered modifier chain (ports, harbor, market, tech, war weariness) and a hard 2:1 floor, gem ports flagged exempt. `tradeRatios` becomes a thin wrapper. The invalid-ratio prompt reads the same function.

**S0.6 Production pipeline** (service 6)
- Split `roll.ts` into stages: roll, number shift, tile state check, base yield, piece multiplier, wild token conversion, tax, bank-short handling, discard check.
- `api.productionStep(order, fn)`. Base registers today's behavior as stages. Keep `tile.onProduce` working.
- Needs `picks.ts` read (gold pick flow is the seed of the wild token).

**S0.7 Tile state layer, durability and repair, wild token** (services 7, 8, 12)
- Typed `hex.ext.state = { id, until? }` plus a reader used by the production pipeline.
- One durability value and one repair action shared by walls, bridges, nets, gates.
- Wild token: generalize the gold pick so fish and oasis spend through it; exclude it from the bank cap and the "no one has x-resource" trade check.

**S0.8 Seven Resolver** (service 17)
- Extract `handleSeven` into an ordered step list: discard, karaoke, robber move and steal, volcano, decay and collapse.
- Setting: max DLC side effects per 7 (default 2, by priority). Base registers discard and robber only.
- Done: golden green.

### Slice B: state and data services

**S0.9 Marker system** (10), **Ledger** (13), **Strength and defense model** (9), **Relations matrix** (14).
- Each is a small typed structure in `g.ext.core`, with owner, timers and public/private flags decided up front.
- The strength model moves to General (per the audit's placement fixes), with no unit movement.

**S0.10 History ring buffer, change log, stats registry** (15)
- Convert `recordActionStats` into per-pack event-to-stat handlers.
- Ring buffer of public events only, capped, replay-safe.

**S0.11 Seeded event deck** (16)
- Base cards plus registered DLC cards, top card = preview, fate token hook. Uses its own RNG stream.

### Slice C: client, bots and infrastructure

**S0.12 Intermediary page UI rework** (needs `client/render/setup.ts`, `Design UI Philosophy.md`)
- DLC cards generated from the manifest (master switch, addon list, dependency prompts), scenario presets and custom presets in one picker, event and fate token settings, phone friendly, scroll instead of expand.

**S0.13 Overlay and popup kit** (11)
- Tint layer (pattern as well as color), timer-bar popup (reuse trade popup), event title card, round recap card.

**S0.14 Bot goal registry** (18)
- Goal valuation, threat map input, tier gating, dialogue tags. Needs `brain.ts` and `Bot AI Design.md` read.

**S0.15 Persistence** (19)
- `data/bots`, `data/players` with caps and migration. Decide hosting first (see Risks).

**S0.16 Sim matrix** (20)
- Extend `sim.ts` from the map matrix to scenario x DLC pair x bot tier, producing the bot-tested badge.

**Gate:** golden green, sim ladder unchanged, every General service has 2+ consumers (or a test consumer), link audit passing.

---

## 4. Decisions needed

| When | Decision |
|---|---|
| Before S0.1 | One pack per DLC, addons as sub-definitions (recommended, fits the existing system) vs separate addon packs |
| Before S0.2 | What counts as a round during setup and during discard/robber sub-phases |
| Before S0.8 | Default cap on side effects per 7 (note says 2) and the priority order |
| Before S0.15 | Persistence host for bot memory (see Risks) |
| Before Stage 2 | Do bridges count toward Longest Road; robber on a tile that floods |
| Before Stage 6 | Sheep economy: pays specific things only (assumed in the note) |
| Before Stage 9 | Dominion's five open decisions in `Ideas.md` |

---

## 5. Stages 1 to 9

Follow `Ideas.md` > Suggested order of build. Per DLC stage:
- Layout `src/packs/<dlc>/index.ts` plus `addons/*.ts`, one file per addon.
- Each addon ships: manifest entry with links, registered events/techs/contract conditions/stats where it fits, bot behavior per tier, dialogue lines, a no-unit form, tests, and sim matrix coverage with the DLC on and off.
- Gate: the stage's scenario passes sims, `INDEX.md` and `change log.md` updated, then re-plan the next stage.

---

## 6. Risks

- **Seed drift.** One stray RNG draw in a disabled addon breaks replays and the golden test. Rule 3 covers it.
- **Persistence on the free host.** Bot and player memory needs storage that survives deploys. Options: paid persistent disk, an external free store, or accept resets and use a player-held export code. Verify the Render plan's disk behavior first.
- **Scope.** `Ideas.md` is about 84 KB. Only Stage 0 is committed here, and each gate is a point to cut or reorder.
- **Unread code.** The plan assumes `picks.ts`, `endTurn.ts`, `brain.ts` and `sim.ts` fit the service shapes above. Read them at the start of S0.2, S0.6 and S0.14 and adjust.
- **Stale docs.** `INDEX.md` is already out of date; keep it part of done criteria.

---

## 7. Next action

S0.0, the golden baseline test. Nothing else should be touched until it exists.
