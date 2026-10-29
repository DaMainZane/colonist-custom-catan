# Handoff (2026-10-29)

Refer to `Development Plan.md` for more details
## State
- **T1, T2, T3, and T4 are done** (Passes 60 to 69). `npm run typecheck; npm test` passed for T1 through T4 (including `tests/tidebound.test.ts`, `tests/tideboundrickety.test.ts`, and `tests/golden.test.ts`). `change log.md`, `Development Plan.md` section 1 and `INDEX.md` are up to date. `GEN_VERSION` = 6.
- What T3 and T4 shipped:
  - **T3 (`packs/tidebound/bridges.ts`)**: `bridge` piece (`crossing` capability, water edge topology via `addWaterTopology`), ocean-only placement rule (`e.hexIds.length === 0`), cost `wood + brick + ore`, cap 10 scaled by land radius (`rules.boardRadius`) and VP, 2x past 10, counts toward Longest Road (`roadLike: true`), `#btnBuildBridge` UI, and `bridgeBotGoal`.
  - **T4 (`packs/tidebound/ricketyBridges.ts`, `client/render/bridgepicker.ts`)**: `rickety_bridge` piece (`wood: 1`, health 1, shared pool and shared 2x threshold with bridges via `syncBridgePool` and `ricketyPoolCostMod`), `upgrade_bridge` action (`brick: 1, ore: 1`), client type picker & upgrade popup, `ricketyCollapseStep` (`SEVEN_STEPS`, breaks all rickety bridges on a 7 with zero RNG draws and syncs the pool), Longest Road recalculation on piece break (`updateAwards`, emitting `pieceBroken` and `awardChanged` into the S0.10 public change log), and client bridge collapse animation + sound (`playBridgeCollapseSound`).
- Next: **T5 Tides engine** (`T5a` to `T5e`).

## Decisions to keep
- Canvas grows; Tidebound's map is bigger than base Catan by design.
- Bridge and rickety bridge caps scale by the land radius (`rules.boardRadius`), not the grown `wide_water` canvas radius.
- Rickety bridge collapse trigger is **7 only** (`ricketyCollapseStep` in `SEVEN_STEPS`, zero RNG draws).
- `recipeKey` (`server/lobby.ts`) is unchanged: an addon changes the map only through a pick, and picks are in the key. Revisit at T12 (Rising sea), or when an addon changes the map without a pick.
- Readers of `ext.elevation` and `ext.fish` (T5d, T7b) must check the tile type first: a tile repainted in the lobby keeps its old keys.

## Next: T5 (Tides engine)
Split in `Development Plan.md`:
1. **T5a**: `flooded` tile state and seeded per-cluster schedule.
2. **T5b**: Spring tide (every 4th round, 2 rings).
3. **T5c**: Settings: on/off, high/low slider.
4. **T5d**: Elevation resistance (reads `hex.ext.elevation`, checking land tile type first).
5. **T5e**: Ports idle while flooded, production stage skips flooded tiles.

## Open checks (not done)
- UI zoom and bots on a board bigger than `rules.boardRadius`: look at `client/render/board.ts`, `server/bots/mapProfile.ts`. Quick test in a browser: Tidebound on, wide water, radius 3.
- Gallery pass: 1.5 rings per extra tile, island spacing on a big canvas, the elevation thresholds (0.65 and 0.9) and the fish shares (25% and 8%) are all guesses.

## Rules to keep
Claude can't run code: small steps, give exact commands. DLC off = zero effect. One chunk = one commit. `INDEX.md` and `change log.md` are part of done.
