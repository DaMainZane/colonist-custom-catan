# Handoff (2026-10-29)

Refer to `Development Plan.md` for more details
## State
- T1, T2a, T2a2 done (Pass 60 to 62). T2b1 code written (Pass 63): Tidebound wide water now **grows the canvas** and keeps the normal land count. `GEN_VERSION` = 6.
- Last test run: 415 passed, 2 failed (`mapmix.test.ts` pinned GEN_VERSION 5; `tideboundlobby.test.ts` expected less land). Both tests edited to the new rules, **not yet re-run**.
- First command: `npm run typecheck; npm test`. If green, T2b1 is done: mark Pass 63 as passed in `change log.md` and `Development Plan.md` section 1.

## Decision (T2b)
Canvas grows. Tidebound map radius is larger than base Catan by default. River and continent logic reused, only widened. No new generator content.

## How it works
- `canvasRadiusFor(radius, extra)` in `shared/mapshape.ts`: radius + ceil(1.5 x extra) rings (4 extra = 6), cap `MAX_RADIUS` 50.
- `LandField.baseRadius` = the normal map's radius. Land share, island/archipelago count, river length, ring size, noise size read it. `radius` is the canvas.
- `runShape` takes `landRadius`; `ShapeResult.radius` is the canvas the arrays use (fallback hexagon = normal size).
- `mapgen.ts` builds the canvas from `shape.radius`. Pick off = identical output.

## Next
1. **T2b2**: elevation 1 to 3 on `h` (higher is rarer). Needs: where it is stored (likely `ext.elevation` on land hexes, set by the `wide_water` perk's `afterGenerated`), which land cells get it (`h` is rank-normalized 0..1 per land cell in `buildCellInfo`), and a thresholds rule. Only with the pick on, no new RNG draws. Tests in `tideboundmap.test.ts`.
2. **T2c**: seeded fish icons on sea tiles; recheck golden. Revisit `recipeKey` (see Pass 62).
3. Then T3 bridges.

## Open checks (not done)
- UI zoom and bots on a board bigger than `rules.boardRadius`: look at `client/render/board.ts`, `server/bots/mapProfile.ts`. Quick test in a browser: Tidebound on, wide water, radius 3.
- T3 bridge cap: scale by land radius (`rules.boardRadius`) or real canvas? Decide at T3b.
- Gallery pass: 1.5 rings per extra tile and island spacing on a big canvas are guesses.

## Rules to keep
Claude can't run code: small steps, give exact commands. DLC off = zero effect. One chunk = one commit. `INDEX.md` and `change log.md` are part of done (`INDEX.md` not touched for T2b1: add `canvasRadiusFor` and `baseRadius` to the `mapshape.ts` entry).
