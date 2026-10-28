# Development Plan

Drafted 2026-10-27 after reading `Ideas.md` (build order, Integration Layer) and the engine source. Trimmed 2026-10-28 after Stage 0 and Stage 1 landed (history in `change log.md`).

Scope: Stages 2 to 9 follow `Ideas.md` > Suggested order of build and get re-planned at each gate.

---

## 1. Done

- **Stage 0 (all of S0.0 to S0.16):** golden baseline, DLC/addon layer and keyed registries, round clock, `score()` / `publicVP()`, piece cost service, trade ratio, production pipeline, tile state, durability and repair, wild token, seven resolver, markers / ledger / strength / relations, history and stats registry, event deck, setup page rework, overlay kit, bot goal registry, persistence (export codes), sim matrix.
- **Stage 1:** 9 addons across 6 DLC packs (heartland, tidebound, bulwark, ledger, wayfarers, crimson, whispers, wildlands).
- Stage 0 gate passed 2026-10-28: `npm run typecheck` and `npm test` clean (golden, sim, addon link audit).
- Not in the plan, also done: Turn History tab, Colonist-style trade modal, bot trade pacing, click-to-roll dice.

---

## 2. Working rules (apply to every step)

1. **Golden baseline stays green.** "Base game plays unchanged" means `tests/golden.test.ts` passes.
2. **Refactor, then add.** Move existing behavior behind a service with zero change, then let something new register.
3. **DLC off means zero effect.** A disabled addon must not draw from `g.rng`, add state, or change legal actions. Each addon uses its own derived RNG stream.
4. **Done criteria per step:** `npm run typecheck`, `npm test`, golden test, sim ladder unchanged, `MODULE:` header on new files, `INDEX.md` and `change log.md` updated, `g.version` bumped if state shape changed.
5. **Registration only.** New content goes in through `api.*`, never by editing `engine.ts` or base files again.
6. **One service per commit.**
7. **Git hygiene (new):** pull only with a clean tree, and check for leftover `<<<<<<<` markers before committing a merge. Keep Obsidian Git auto-backup off while resolving conflicts.

---

## 3. Next steps

1. **Stage 1 gate:** the Stage 1 scenario passes sims with the DLCs on and off (sim matrix coverage). Log the result.
2. **Check the loose ends from Stage 0:**
   - Seven Resolver: confirm the default cap on DLC side effects per 7 (the plan assumed 2) and its priority order.
   - Held wild tokens (fish, oasis): confirm a player can actually spend them (action, UI, bot), or note it as a Stage 2+ task.
3. **Decide before Stage 2:** do bridges count toward Longest Road (`tidebound.bridges` already exists, so check what it does now); what happens to the robber on a tile that floods.
4. **Re-plan Stage 2** from `Ideas.md` and start it.

---

## 4. Decisions needed

| When | Decision |
|---|---|
| Before Stage 2 | Bridges and Longest Road; robber on a tile that floods |
| Before Stage 6 | Sheep economy: pays specific things only (assumed in the note) |
| Before Stage 9 | Dominion's five open decisions in `Ideas.md` |

---

## 5. Stages 2 to 9

Follow `Ideas.md` > Suggested order of build. Per DLC stage:
- Layout `src/packs/<dlc>/index.ts` plus `addons/*.ts`, one file per addon.
- Each addon ships: manifest entry with links, registered events/techs/contract conditions/stats where it fits, bot behavior per tier, dialogue lines, a no-unit form, tests, and sim matrix coverage with the DLC on and off.
- Gate: the stage's scenario passes sims, `INDEX.md` and `change log.md` updated, then re-plan the next stage.

---

## 6. Risks

- **Seed drift.** One stray RNG draw in a disabled addon breaks replays and the golden test.
- **Persistence on the free host.** Render's free plan has no persistent disk, so bot and player memory resets on deploy. Mitigation already built: player-held export codes (`CTMEM1.…`).
- **Scope.** `Ideas.md` is about 84 KB. Each gate is a point to cut or reorder.
- **Parallel work.** Several people or AI tools edited the same services (Stage 0 was built twice and collided in a merge). Agree who owns which stage before starting it, and pull often.
- **Stale docs.** `INDEX.md` is out of date; keep it part of done criteria.
