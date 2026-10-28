# Handoff: tech tree root techs

Written 2026-10-28. Read `Tech Tree Design.md` first (it is the spec). This file tells you where things are and what order to work in.

## Project
Custom online multiplayer Catan: TypeScript, Node/Express/socket.io, Vitest, esbuild, deployed on Render's free plan.
Path: `C:\Users\John\Documents\Obsidian\Obsidian Vault\Coding Project\colonist-custom-catan`
The folder sits inside an Obsidian vault and the Obsidian Git plugin commits automatically.
The user is Cat. Windows and PowerShell. Casual, wants direct answers, gets overwhelmed by dense output. Use short steps and plain words, and ask one thing at a time.

## State right now
- Stage 0 (shared services) is done and green. `main` was `4ef7311` plus local commits when this was written.
- **No DLC addon has gameplay code.** `src/packs/index.ts` has only `base`, `gold`, `fog` in `allPacks`. The DLC cards in `src/client/render/setup.ts` and scenarios in `src/server/mapmenu.ts` now list the 6 official packs from `Ideas.md` (5 gameplay: Tidebound, Bulwark, Warlords, Wild Earth, Guildhall; plus Rowdy Tavern which is cosmetic/social). Do not trust "Stage 1 is written" in old notes; it means infrastructure only.
- `src/shared/stage1.ts` has tech logic only: `TECH_DEFS`, `TechDef`, `BASE_TECH_DEFS`, `allTechDefs`, `getPlayerTechs`, `hasTech`, `techCostCards`, `defaultTechPayment`, `researchTech`, plus `techRoadCostModifier` and `techHarborCharterRatioModifier`, registered in `registerStage1Definitions`. Techs are stored in `g.ext.core.techs[pid]`.
- **Not verified:** whether a research action, a tech panel or bot research logic exists. Check this first.

## The task
Build the 5 root techs from `Tech Tree Design.md`, the per-player cost formula, the `rules.techTreeOn` toggle, and a hub-and-spoke tech panel. Roots are base-tier: always researchable, even with their DLC off.

## Order of work (one step at a time, each ends with `npm run typecheck` and `npm test`)
1. **Audit, read-only.** Is there a research action, a UI panel, bot logic? Report in a short list.
2. **Cost formula.** Replace `techCostCards` with the formula and a `TECH_COST` constants object. Add `costOffset?: number` to `TechDef`. Remove the Literacy clause. Keep the Catch-up discount.
3. **Remove the 4 old base techs** (`base.road_engineering`, `base.harbor_charters`, `base.literacy`, `base.fortified_towns`), their two modifiers, and update tests that name them.
4. **`rules.techTreeOn`** (default off) in rules and the lobby. `researchTech` refuses when it is off.
5. **Research action** (server and client) and a minimal tech panel showing the 5 roots, each with that player's cost.
6. **Roots, one per step, easiest first:** Bulwark Stockpiling, Guildhall Road levy, Tidebound Harbor charters, Warlords Plunder, Wild Earth Ground work. Hooks and tests per tech are in the spec, section 4.
7. Sim matrix: tech tree on and off. Update `INDEX.md`, `change log.md`, `Ideas.md`.

## Keep DLC extension easy (build this in, do not bolt it on later)
Nodes beyond a root are added by a DLC pack, not by editing tech code.

- **Shape of a node:** `{ id: '<dlc>.<name>', branch: '<dlc>', dlc: '<dlc>', tier: 2 or 3, prereq: '<root or earlier id>', costOffset, description, onUnlock? }`. Roots have no `dlc` and no `prereq`, and `tier: 1`.
- **Registration:** a DLC adds nodes inside its addon's `register(api)` with `api.define(TECH_DEFS, def)`. A disabled addon never registers, so a disabled DLC adds nothing.
- **UI is generated:** the panel groups `allTechDefs(g, reg)` by `branch` and draws one spoke per branch. Adding a DLC branch must need no panel edit.
- **Effects:** a tech's effect is a modifier on an existing registry (`COST_MODS`, `RATIO_MODS`, `DISCARD_LIMIT_MODS`, a new `STEAL_COUNT_MODS`) that calls `hasTech` first. Never branch on tech ids inside engine code.
- **Prereqs:** change `prereq?: string` to `prereq?: string | string[]` now (cheap), so later techs can need nodes from two branches.
- **Add a tech audit test** over `allTechDefs`: unique ids, prereqs exist, tier is 1 to 3, roots have no `dlc`, every `dlc` is a known pack. This is what lets later agents add nodes safely.
- **One helper:** `defineTech(api, def)` that validates and registers, so DLC code does not touch the registry directly.

## Rules
- The golden test (`tests/golden.test.ts`) stays green. A disabled feature has zero effect: no `g.rng` draws, no state, no new legal actions.
- Register through `api.*`. Refactor first with no behavior change (Warlords Plunder needs a small refactor of `packs/base/robbing.ts`), then add.
- Each step ends with `npm run typecheck` and `npm test`, `MODULE:` headers on new files, and `INDEX.md` and `change log.md` updated.
- **Git:** pull only with a clean tree. Before committing any merge, check for leftover `<<<<<<<` markers. Keep Obsidian Git auto-backup off while resolving conflicts. Several agents have edited the same services, so ask Cat who owns a stage before starting it.

## Other pending decisions (not part of this task)
- Do bridges count toward Longest Road (before Tidebound addon work)? What happens to the robber on a tile that floods?

## Tool notes
- The Filesystem tools can read, write and edit files but cannot search inside files. For a content search, give Cat a command. Tell Cat to `cd` into the project folder first (a PowerShell opened in `C:\WINDOWS\system32` searches the wrong place):
  `cd "C:\Users\John\Documents\Obsidian\Obsidian Vault\Coding Project\colonist-custom-catan"`
  `Get-ChildItem src,tests -Recurse -Filter *.ts | Select-String -Pattern "<pattern>" | Select-Object -First 15`
- `edit_file` matches whole lines, so pass full lines as `oldText`.
- Cat pastes test output, so ask for failure lines only, not the whole log.
