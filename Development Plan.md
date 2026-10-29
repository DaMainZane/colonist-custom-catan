# Development Plan

Rewritten 2026-10-28. Tidebound is the first full DLC and is split into chunks below. Later stages stay outlines until their gate. History is in `change log.md`.

---

## 1. Done

- **Stage 0 and Stage 1 infrastructure.** All shared services, DLC manifest, lobby cards. Gate passed 2026-10-28.
- **Tech tree roots** (Passes 51 to 54): radial panel, 5 root techs, research action, sim rows. No deeper nodes.
- **No DLC has gameplay code.** `allPacks` = base, gold, fog, tidebound (T0a: skeleton only, 8 addon stubs, no content).
- **T1 port ladder, done 2026-10-29 (T1a to T1d; typecheck and tests passed, Pass 60 in `change log.md`).** Port upgrade is a level per vertex; Raise the Port upgrades the whole port 3:1 to 2:1 (no resource choice); `HARBOR_RATIO_MODS` gives the harbor-only 1:1 floor (nothing registers into it until T8); panel and `techroots.test.ts` follow.
- **T2a wide-water perk, done 2026-10-29 (typecheck and tests passed, Pass 61).** `wide_water` map perk (param `water.extra`, 1 to 5, default 4) registered by `tidebound.bridges`: less land on the same canvas, wider gaps between islands, archipelago islets and continents (fewer landmasses first, then a smaller gap, so it fits), wider rivers. Perk off = the generator draws exactly what it drew before, so `GEN_VERSION` stays 5. Tests: `tests/tideboundmap.test.ts`.
- **T2a2 lobby sees DLC map perks, done 2026-10-29 (typecheck and tests passed, Pass 62).** Decision A: the lobby builds its map, checks picks and draws the menu from `mapRegistryFor(settings)` (plain registry while no addon is on); each socket gets the room's `mapOptions` list when the room's addon set changes (`net.ts`). No client change. Tests: `tests/tideboundlobby.test.ts`.
- **T2b1 wide water grows the canvas, done 2026-10-29 (typecheck and tests passed, Pass 63).** Decision: the canvas grows. Tidebound's map is bigger than base Catan by design; the land count stays what the radius gives, the extra room is sea (4 extra = 6 rings). Reuses the river and continent logic, only widened. `GEN_VERSION` is now 6.
- **T2b2 elevation 1 to 3, done 2026-10-29 (typecheck and tests passed, Pass 64).** `ext.elevation` on land hexes, written by the `wide_water` perk's `afterGenerated` from the ranked height `h` (1 below 0.65, 2 from 0.65, 3 from 0.9: about 65% / 25% / 10% of the land, higher is rarer). No RNG draws. `PerkDef.afterGenerated` now gets the land cells as a third argument. New file `packs/tidebound/seaData.ts`. Nothing reads it until T5d.
- **T2c seeded fish icons, done 2026-10-29 (typecheck and tests passed, Pass 65).** `ext.fish` = 4 on sea tiles (not land, not river): 25% of the shore sea, 8% of the open sea, picked by ranked extras-stage noise, so no RNG draws. `recipeKey` checked and left alone (Pass 65). Nothing reads it until T7b. **T2 is closed.**
- **T4a rickety piece and T4b upgrade, done 2026-10-29 (typecheck and tests passed, Pass 67).** `rickety_bridge` (1 wood, health 1, shared pool and shared 2x threshold with bridges), `upgrade_bridge` (1 brick + 1 ore), `api.phaseAction`, bot goal. T4d must call `syncBridgePool` after a collapse.
- **T4c bridge type picker and upgrade popup, done 2026-10-29 (typecheck and tests passed, Pass 68).** New `client/render/bridgepicker.ts`: type picker on an empty ocean edge (Bridge or Rickety bridge) and an upgrade popup on your own rickety bridge. Server side: `upgradeBridge` socket event, `bridgeUpgradeCost` in your player view (`bridgeUpgradeView`). Rickety bridges drawn dashed with two planks.
- **T3 Bridges (T3a to T3e), done 2026-10-29 (typecheck and tests passed, Pass 66).** `bridge` piece (`tidebound.bridges`, `crossing` capability, water edge topology via `addWaterTopology`), ocean-only placement rule (`e.hexIds.length === 0`, connected to player's building or unblocked vertex with a road-like piece), cost `wood + brick + ore`, base limit 10 scaled by `rules.boardRadius` and `vpToWin` (`scaledPieceLimit`), 2x cost past 10 on board, counts toward Longest Road (`roadLike: true`), build UI (`#btnBuildBridge`, recipe popup, board cross-plank rendering and ocean edge spots), and minimal bot support (`bridgeBotGoal` + `hasReachableSpot`). **T3 is closed.**

---

## 2. Working rules

1. Golden test stays green. Refactor behind a service first, then add.
2. DLC off = zero effect: no `g.rng` draws, no state, no legal actions. Each addon uses its own derived RNG stream.
3. Registration only (`api.*`). No edits to `engine.ts` or base files for DLC content.
4. Done per chunk: `npm run typecheck; npm test`, DLC-off test, `MODULE:` header, `INDEX.md` + `change log.md`, `g.version` bump if state shape changed, sim ladder unchanged.
5. One chunk = one commit. Claude can't run code, so each chunk ends with the exact commands. Next chunk starts after they pass.
6. Every addon needs 2+ links incl. one General service (`auditAddons`).
7. Git: pull only on a clean tree; check for `<<<<<<<` before committing a merge.
8. Any ideas in tidebound that is noted to be reserve for other dlc will not be included in tidebound development process, it will remain in `Ideas.md` as backlog for future work.

---

## 3. Tidebound

Specs: `Ideas.md` (Tidebound), `Tech Tree Design.md` §8, `Map Generation Design.md`, `Design UI Philosophy.md`.

**Addons:** `tidebound.bridges`, `rickety_bridges`, `tides`, `rising_sea`, `harbor`, `fishing`, `wrecks`, `pirates`.

**Rule:** chunks T1 to T10 ship content ungated (tree off = available from the start). T11 adds the tech gates.

| #   | Chunk           | Ships                                                                                                                                                                                                              | Reuses                              |
| --- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| T0  | Skeleton        | `src/packs/tidebound/` with 8 addons + links, in `allPacks`, lobby card, DLC-off test. Replace placeholder `tidebound.*` ids.                                                                                      | `addons.ts`                         |
| T1  | Port ladder     | Root becomes whole-port 3:1 to 2:1 (no resource choice). `portUpgrades` becomes a level per vertex. 1:1 floor exception for harbors only. Fix panel and `techroots` tests.                                         | `tradeRatio.ts`, `pricing.ts`       |
| T2  | Map support     | Perk: sea and rivers 4-5 tiles wider, elevation 1 to 3 on `h` (higher rarer), seeded fish icons on sea tiles. Data only. Bump `GEN_VERSION`.                                                                       | `PerkDef`, `river` op, `h`          |
| T3  | Bridges         | Piece, both edge ends in ocean, cost road + 1 ore, cap 10 scaled by radius, 2x past cap, counts for Longest Road. Build UI, bot builds.                                                                            | `pricing.ts`, `longestRoad.ts`      |
| T4  | Rickety bridges | 1 wood, health 1, upgrade 1 brick + 1 ore, shared pool, type picker popup, collapse on a 7, Longest Road recalc through change log, collapse animation.                                                            | durability, Seven Resolver          |
| T5  | Tides engine    | `flooded` state, seeded schedule (per-cluster phase, spring tide every 4th round = 2 rings), settings (on/off, high/low slider), elevation resistance, ports idle while flooded, production stage.                 | tile state, round clock, production |
| T6  | Tides UI        | Warning 1 turn ahead (tint + wave pattern, fading flash), rise title card, flooded tint in both themes, elevation heat-map toggle.                                                                                 | overlay kit                         |
| T7  | Fishing         | Fish wild token (spend action, hand row, counts for discard, stealable, ignored by bank cap), nets, fish icon boosts (max 4), tide replenish, feed-the-sea action (1 wheat). Closes the held-wild-token loose end. | wild token, marker                  |
| T8  | Harbor          | 1:1 upgrade, limit 1 per player, works while flooded, invalid-ratio prompt explains harbors.                                                                                                                       | T1, T5                              |
| T9  | Wrecks          | Storm event, wreck marker, sea/shore 65/35, fair spawn within 4 tiles of a player, first connecting road/bridge/port claims, loot with floor rule + slow scaling, two spawn animations.                            | event deck, marker, overlay         |
| T10 | Pirates         | Max 2, ocean only, random move, strength grows slowly, knights needed, rob 2x, flee mode, avoid stronger players.                                                                                                  | marker, strength model              |
| T11 | Tech nodes      | Register the 9 nodes (§8), `path` field, fork layout, cost divisor fix, `techGate` helper on every gated feature, demolish-bridge action, Grand Causeway, Harbor empire.                                           | tech panel                          |
| T12 | Rising sea      | Drown lowest elevation first, optional with Tides, settings.                                                                                                                                                       | tile state, `h`                     |
| T13 | Bots + dialogue | Flood exposure in `scoreVertex`, salvage goal, port and net placement, pirate avoidance, tech research, public-info-only lines.                                                                                    | bot goals, dialogue                 |
| T14 | Balance gate    | Sim matrix: Tidebound on/off x tree on/off at 25+ VP. Check Grand Causeway swing and tier prices.                                                                                                                  | sim matrix                          |

### Split step
| ID   | Step                                                                               | Size |
| ---- | ---------------------------------------------------------------------------------- | ---- |
| T4d  | Collapse on a 7 in the Seven Resolver                                              | L    |
| T4e  | Longest Road recalculation through the change log                                  | L    |
| T4f  | Collapse animation                                                                 | S    |
| T5a  | flooded tile state and seeded per-cluster schedule                                 | L    |
| T5b  | Spring tide (every 4th round, 2 rings)                                             | M    |
| T5c  | Settings: on/off, high/low slider                                                  | S    |
| T5d  | Elevation resistance                                                               | M    |
| T5e  | Ports idle while flooded, production stage skips flooded tiles                     | M    |
| T6a  | Warning one turn ahead: tint, wave pattern, fading flash                           | M    |
| T6b  | Rise title card                                                                    | S    |
| T6c  | Flooded tint for both themes                                                       | S    |
| T6d  | Elevation heat-map toggle                                                          | S    |
| T7a  | Fish wild token in hand (spend action, discard count, stealable, ignores bank cap) | L    |
| T7b  | Nets                                                                               | M    |
| T7c  | Fish icon boosts, max 4                                                            | M    |
| T7d  | Tide replenish                                                                     | S    |
| T7e  | Feed-the-sea action (1 wheat)                                                      | S    |
| T8a  | Harbor 1:1 upgrade, limit 1 per player, works while flooded                        | M    |
| T8b  | Max 4 trades per turn per harbor, invalid-ratio prompt explains harbors            | S    |
| T9a  | Storm event and wreck marker                                                       | M    |
| T9b  | Sea/shore 65/35 placement, fair spawn within 4 tiles of a player                   | M    |
| T9c  | First connecting road, bridge, or port claims the wreck                            | M    |
| T9d  | Loot with floor rule and slow scaling                                              | M    |
| T9e  | Two spawn animations                                                               | S    |
| T10a | Pirate marker, max 2, ocean only, random move                                      | M    |
| T10b | Strength grows slowly, knights needed to drive off                                 | M    |
| T10c | Rob 2x                                                                             | S    |
| T10d | Flee mode, avoid stronger players                                                  | M    |
| T11a | path field, fork layout, cost divisor fix                                          | M    |
| T11b | techGate helper                                                                    | S    |
| T11c | Register nodes 1-3 and gate their features                                         | M    |
| T11d | Register nodes 4-6 and gate their features                                         | M    |
| T11e | Register nodes 7-9 and gate their features                                         | M    |
| T11f | Demolish-bridge action, Grand Causeway, Harbor empire                              | L    |
| T12a | Drown lowest elevation first                                                       | M    |
| T12b | Make it optional with Tides, add settings                                          | S    |
| T13a | Flood exposure in scoreVertex                                                      | M    |
| T13b | Salvage goal                                                                       | M    |
| T13c | Port and net placement                                                             | M    |
| T13d | Pirate avoidance                                                                   | M    |
| T13e | Tech research                                                                      | M    |
| T13f | Public-info-only dialogue lines                                                    | S    |
| T14a | Sim matrix runner: Tidebound on/off x tree on/off at 25+ VP                        | M    |
| T14b | Check Grand Causeway swing                                                         | S    |
| T14c | Tune tier prices                                                                   | S    |
Each chunk adds minimal bot support (reads costs and ratios through services, no crashes). T13 is the tuning pass.

**Left for other DLCs (hooks only):** robber/knight blocks harbor (Warlords), wall +1 elevation (Bulwark), bog and silt (Wild Earth), Lighthouse sight (Wild Earth), sea caravans (Guildhall).

---

## 4. Decisions needed

| Before | Decision                                                  | Assumed                                                                               |
| ------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| T5     | Robber on a tile that floods                              | Stays; tile produces nothing anyway - Committed                                       |
| T4     | Rickety collapse trigger                                  | 7 only - Committed                                                                    |
| T8     | Harbor build cost; Ideas mentions "max 4 per turn" at 1:1 | Needs a number; plain 1:1 max cap of 4 1:1 trade per turn for each harbor - Committed |
| T11    | 4 tiers vs 5 levels; cost divisor at 25+ VP               | `Tech Tree Design.md` §9 - Check author note in the same file - Committed             |

Resolved: bridges count for Longest Road.

**Resolved (found in T2a):** T2a2, how a DLC map perk reaches the lobby. Chose option A: `lobby.ts` and the map menu use the room's registry (`mapRegistryFor`), the server sends `mapOptions` per socket when the room's addon set changes, and the client is untouched. Option B (perks in the static registry behind a capability) was dropped because it breaks "DLC off = nothing registered".

**Resolved (T2b, 2026-10-29):** the canvas grows. Tidebound raises the map radius over base Catan by default; it reuses the river and continent logic, only widened (and added where there is none). Nothing new in the generator beyond the canvas.

**Resolved (T3, 2026-10-29):** bridge cap scaling reads the land radius (`rules.boardRadius`) via `scaledPieceLimit(10, rules.vpToWin, rules.boardRadius)`, not the grown `wide_water` canvas radius, and base limit before 2x cost is 10 (`baseLimit: 10`).

**Open:**

| Before | Decision | Options |
| ------ | -------- | ------- |
| - | None open. | |

---

## 5. Stages after Tidebound

Order from `Ideas.md`: Bulwark, Warlords core, Wild Earth, Guildhall, social layer, scenarios, Real-time, Dominion. Each reuses the T0 to T14 pattern (skeleton, mechanics, UI, tech nodes, bots, balance) and is re-planned at its gate.

---

## 6. Risks

- **Seed drift.** One stray RNG draw breaks replays and golden. Highest risk: T2 (map gen) and T4 (Seven Resolver).
- **Persistence.** Render free plan has no disk; bot/player memory resets on deploy. Export codes cover it.
- **Scope.** Cut or reorder at each gate. T12 is the first to cut.
- **Parallel work.** Agree who owns a chunk before starting; pull often.
- **Stale docs.** `INDEX.md` is part of done.
