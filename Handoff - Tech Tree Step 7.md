# Handoff: tech tree step 7 (sim matrix, tree on and off)

Written 2026-10-28. This is a small, well-bounded task. Read this file fully before touching anything. The spec is `Tech Tree Design.md` and the earlier handoff is `Handoff - Tech Tree Roots.md` (steps 1 to 6 are done; this is the last step).

## Project
Custom online multiplayer Catan: TypeScript, Node/Express/socket.io, Vitest, esbuild.
Path: `C:\Users\John\Documents\Obsidian\Obsidian Vault\Coding Project\colonist-custom-catan`
The folder is inside an Obsidian vault and the Obsidian Git plugin commits automatically.
The user is on Windows and PowerShell. Casual, wants direct answers, gets overwhelmed by dense output. Use short steps and plain words, and ask one thing at a time.

## State right now
- Steps 1 to 6 are written. The 5 root techs (Bulwark Stockpiling, Guildhall Road levy, Tidebound Harbor charters, Warlords Plunder, Wild Earth Ground work) have effects, actions, a tech panel and tests.
- `rules.techTreeOn` is off by default. It comes from the lobby setting `techTreeOn` through `rulesFromSettings` in `src/server/runtime.ts`, and it only appears in the rules when on.
- **Bots never research and never use the techs.** So a game with the tree on plays almost exactly like one with it off.
- Step 5 and step 6 code was written without running it. **Before you start, ask the user to run `npm run typecheck` and `npm test` and confirm both pass.** If they fail, stop. That is not your task. Ask the user to paste only the failure lines and tell them to take it back to the agent that wrote steps 5 and 6.

## The task
Add "tech tree on / off" as one more dimension of the sim matrix, so the matrix proves that turning the tree on breaks nothing (no crash, no invariant failure, no stuck game).

What the matrix can NOT do here: tune prices or check balance. Bots do not research, so there is nothing to tune. Do not try to add that.

## Files you may touch
- `src/server/bots/sim.ts` (`runSimMatrix` and its settings)
- `tests/simmatrix.test.ts`
- `INDEX.md`, `change log.md`, `Ideas.md`

## Files you must NOT touch
Anything under `src/packs/`, `src/shared/`, `src/client/`, and `src/server/` other than `bots/sim.ts`. In particular do not edit the tech code (`techEffects.ts`, `techRoots.ts`, `actions/techActions.ts`, `actions/research.ts`, `stage1.ts`, `robbing.ts`). If a test fails because of tech code, stop and report. Do not change tech code to make a test pass.

## Steps
1. **Read first, change nothing.** Read `src/server/bots/sim.ts` and `tests/simmatrix.test.ts`. Work out how a matrix row sets its rules and how many games it runs now. Tell the user in 3 lines: how settings reach `createGame`, the current game count, and where `techTreeOn` would plug in. Wait for a thumbs up.
2. **Add the dimension.** Add `techTreeOn` (false and true) to the matrix, passed the same way other rules are passed. Keep the extra games small: do not double the whole matrix. Run tree-on on a reduced set (for example the standard map and one or two DLC combinations) and keep tree-off exactly as it is today.
3. **Check the tree-off rows are unchanged.** Tree-off games must produce the same results as before. The golden test (`tests/golden.test.ts`) must stay green.
4. **Make sure the tree-on rows run the invariant checks** the other rows run.
5. **Run** `npm run typecheck` and `npm test`. Ask the user to run them (you may not have a shell) and paste only failure lines.
6. **Docs.** Add `## 2026-10-28 (Pass 52: Tech tree step 7, sim matrix with the tree on and off)` at the top of `change log.md` (just under `# Change Log`), update the `sim.ts` and `simmatrix.test.ts` rows in `INDEX.md` if what they cover changed, and add one line to `Ideas.md`: "Bots that research and use the root techs (needed before the tree can be balanced)".

## Rules
- A disabled feature has zero effect: no `g.rng` draws, no state, no new legal actions. Do not break this.
- Keep a `MODULE:` header on any new file (you should not need a new file).
- Several agents have edited the same services. If anything outside the files above looks like it needs a change, stop and ask the user.
- **Git:** do not pull unless the tree is clean. Check for leftover `<<<<<<<` markers before committing any merge. Keep Obsidian Git auto-backup off while resolving conflicts.

## Done means
- Tree on and off both appear in the matrix, and `npm run typecheck` and `npm test` pass (the user confirms).
- The extra test time is small. Tell the user roughly how many games you added.
- The three docs are updated.
- Report in 3 to 5 lines: what you changed, the game count before and after, and the note that this only proves tree-on does not break anything.

## Tool notes
- The Filesystem tools can read, write and edit files but cannot search inside files. For a content search, give the user a command, and tell them to `cd` into the project folder first:
  `cd "C:\Users\John\Documents\Obsidian\Obsidian Vault\Coding Project\colonist-custom-catan"`
  `Get-ChildItem src,tests -Recurse -Filter *.ts | Select-String -Pattern "<pattern>" | Select-Object -First 15`
- `edit_file` matches whole lines, so pass full lines as `oldText`.
- The user pastes test output, so ask for failure lines only, not the whole log.
