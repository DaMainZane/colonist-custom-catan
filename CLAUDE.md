# CLAUDE.md

Instructions for Claude Code (and any other agent) working in this repo. Keep this file short; the details live in the files it points to.

## Before you change code

1. Read `ROUTER.md` first. It maps a kind of task to the files to open and one file to copy as a pattern.
2. Then `EXTENSION POINTS.md` (registration calls, hooks, keyed registries) and `RECIPES.md` (step-by-step for a new piece, action, addon, tech node, client overlay).
3. Do not read whole folders or whole large files. Search for a symbol (`grep`, your editor's search) and open only the file that holds it. `INDEX.md` has one line per file.
4. For rework work (R0 to R9) read `Handoff - Modular Rework.md` and `Rework Progress.md`. For Tidebound feature work read `change log.md`; it is newer than `Handoff.md`.

## Rules

- Content is data: add pieces, actions, hooks and rules through `PackApi` inside an addon, registered only while the addon is on. A disabled addon must change nothing. Do not edit `src/shared` to add content.
- Layers (enforced by `tests/architecture.test.ts`): `shared` imports only `shared`; a pack imports `shared`, itself and `packs/base`; `server` never imports `client`; `client` imports only `client` and `shared`. No new circular imports.
- No `g.rng` draws in addon code unless the base game already draws there. Use a derived stream. `tests/golden.snapshot.json` must stay untouched unless the task is a deliberate behavior change.
- Every `src/**/*.ts` file starts with one line: `// MODULE: what | DEPENDS ON: a, b | USED BY: c, d`. Write only the description. The two lists are generated.
- `INDEX.md`'s `src/` tables are generated from those headers: never edit them by hand. Root, Docs and `tests/` tables are hand-written; update them when you add a file there.
- Hand-written glue still exists in `server/socket.ts`, `server/view.ts`, `client/icons.ts`, `client/render/board.ts` and `client/main.ts` (R6 to R8 of `Modular Rework Plan.md` remove it). The recipes say where it is touched.
- Removable files get a `[del.]` name prefix instead of being deleted.
- Tidebound chunk T12 (`tidebound/risingSea.ts`) comes before R6.

## After every change

```
npm run headers:write
npm run index
npm run typecheck
npm test
```

Add a pass to `change log.md`, tick `Rework Progress.md` when the work is rework, and update `INDEX.md` Root, Docs and `tests/` rows when files were added. Say what you did not verify. If you cannot run the commands, give the exact commands and ask for the output instead of claiming they pass.
