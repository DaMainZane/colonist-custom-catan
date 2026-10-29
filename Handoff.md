# Handoff (2026-10-29)

Refer to `Development Plan.md` for more details
## State
- **T1 and T2 are done** (Passes 60 to 65). `npm run typecheck; npm test` passed for the whole of T2 (T2a2, T2b1, T2b2, T2c), golden included. `change log.md`, `Development Plan.md` section 1 and `INDEX.md` are up to date. `GEN_VERSION` = 6.
- What T2 left in the data (all only with the `wide_water` pick on, no RNG draws, nothing read yet):
  - canvas grows around the normal map (`canvasRadiusFor`, `LandField.baseRadius`), land count unchanged;
  - `hex.ext.elevation` 1 to 3 on land by ranked `h` (1 below 0.65, 2 from 0.65, 3 from 0.9);
  - `hex.ext.fish` = 4 on 25% of shore sea and 8% of open sea (river channels excluded).
  - Written in `packs/tidebound/seaData.ts`, called from `wide_water.afterGenerated(inits, ctx, cells)`.
- Next: **T3 bridges**. Nothing is started.

## Decisions to keep
- Canvas grows; Tidebound's map is bigger than base Catan by design.
- `recipeKey` (`server/lobby.ts`) is unchanged: an addon changes the map only through a pick, and picks are in the key. Revisit at T12 (Rising sea), or when an addon changes the map without a pick.
- Readers of `ext.elevation` and `ext.fish` (T5d, T7b) must check the tile type first: a tile repainted in the lobby keeps its old keys.

## Next: T3
Split in `Development Plan.md`: T3a piece and placement rule (both edge ends in ocean), T3b cost (road + 1 ore), cap 10 scaled by radius, 2x past cap, T3c Longest Road, T3d build UI, T3e minimal bot support.
1. **T3a first.** Reuse `placement.ts` and the road piece; the bridge needs both edge ends touching ocean tiles (open sea: water that reaches the canvas edge, see `placeCoastPorts` in `topology.ts` for the ocean flood).
2. **Decide at T3b:** does the bridge cap scale by land radius (`rules.boardRadius`) or the real canvas? The canvas is bigger than `rules.boardRadius` with wide water on.

## Open checks (not done)
- UI zoom and bots on a board bigger than `rules.boardRadius`: look at `client/render/board.ts`, `server/bots/mapProfile.ts`. Quick test in a browser: Tidebound on, wide water, radius 3.
- Gallery pass: 1.5 rings per extra tile, island spacing on a big canvas, the elevation thresholds (0.65 and 0.9) and the fish shares (25% and 8%) are all guesses.

## Rules to keep
Claude can't run code: small steps, give exact commands. DLC off = zero effect. One chunk = one commit. `INDEX.md` and `change log.md` are part of done.
