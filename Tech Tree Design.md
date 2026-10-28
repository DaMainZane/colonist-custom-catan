# Tech Tree Design

Locked 2026-10-28. This file is the spec for the next agent. Only the root tier is decided. Deeper nodes come later and may change.

---

## 1. Locked decisions

- **Hub and spoke.** Every branch starts at a central hub. One branch per DLC.
- **Five roots only.** The tree ships with exactly 5 techs, one root per DLC branch: Tidebound, Bulwark, Warlords, Wild Earth, Guildhall. The cosmetic DLC (Rowdy Tavern) has no branch.
- **DLC gating.** The 5 root techs are base-tier and always researchable, even with their DLC off. Every node beyond a root is hidden and not researchable unless that DLC is on. Gated nodes use the existing `dlc` field on `TechDef`; roots leave it unset.
- **No separate base branch.** The 4 old base techs in `stage1.ts` (`base.road_engineering`, `base.harbor_charters`, `base.literacy`, `base.fortified_towns`) are removed. See section 5.
- **Roots touch base gameplay only.** Each root changes something that exists with every DLC off (ports, discards, knight steals, tiles, road cost), which is why roots stay open without their DLC.
- **Game toggle.** `rules.techTreeOn` in the lobby. Off means nobody can research. This toggle is the only thing that turns the whole tree off; turning DLCs off does not.
- **Prices are per player** and scale with that player's buildings (section 2).
- **Registration only.** Techs register through `api.define(TECH_DEFS, ...)`. Do not edit `engine.ts` or base files for tech content. A disabled DLC or tech tree must have zero effect (no `g.rng` draws, no state, no new legal actions). The golden test stays green.

---

## 2. Cost formula

```
V    = settlements * 1 + cities * 2 + castles * 3        // this player's building value
cost = max(FLOOR, tier + offset + ceil(V / DIVISOR))     // in cards
```

- Constants live in one object: `TECH_COST = { settlement: 1, city: 2, castle: 3, divisor: 3, floor: 2 }`. Tune in the sim matrix.
- `tier` is 1 for every root. Deeper nodes add 1 per tier.
- `offset` is per tech (section 3), so impact can shift the price.
- Count pieces with `placedCount(g, pid, 'settlement' | 'city' | 'castle')`.
- Keep the existing Catch-up rule: a player with 0 techs who qualifies for Catch-up pays 1 less (never below the floor).
- Remove the old Literacy clause (cost cut by a third) from `techCostCards`.
- Payment stays wheat plus ore via `defaultTechPayment`.

Cost in cards for a tier 1 root, by building value V:

| Example player | V | ceil(V/3) | Offset 0 | Offset +1 | Offset +2 |
|---|---|---|---|---|---|
| Start (2 settlements) | 2 | 1 | 2 | 3 | 4 |
| 3 settlements, 1 city | 5 | 2 | 3 | 4 | 5 |
| 3 settlements, 3 cities | 9 | 3 | 4 | 5 | 6 |
| 2 settlements, 3 cities, 2 castles | 14 | 5 | 6 | 7 | 8 |

---

## 3. The five root techs

| DLC | Tech id | Effect | Offset | Cost at V = 2 / 5 / 9 / 14 |
|---|---|---|---|---|
| Tidebound | `tidebound.harbor_charters` | Unlocks upgrading a 3:1 port to 2:1 | 0 | 2 / 3 / 4 / 6 |
| Bulwark | `bulwark.stockpiling` | +2 discard limit | 0 | 2 / 3 / 4 / 6 |
| Warlords | `warlords.plunder` | Knight steals 1 extra card | +1 | 3 / 4 / 5 / 7 |
| Wild Earth | `wildearth.ground_work` | Convert a tile you touch into a basic resource tile of your choice | +2 | 4 / 5 / 6 / 8 |
| Guildhall | `guildhall.road_levy` | Past the road cap (2x price), roads cost 1 less brick or wood | 0 | 2 / 3 / 4 / 6 |

Offsets are placeholders. Tune them in the sim matrix.

---

## 4. What to add, per tech

### Tidebound: Harbor charters
- **Rule:** a **city** on a 3:1 port vertex can be upgraded to a 2:1 port. Cost: 2 wood, 1 brick, 1 ore (from `Ideas.md`, Harbor upgrade; counted against the 2x-over-cap rule). The 2:1 floor stays.
- **Hook:** `shared/tradeRatio.ts`, a `RatioModifier` registered with `api.define(RATIO_MODS, ...)`. Replace the old `techHarborCharterRatioModifier` (it made every 3:1 port 2:1 with no upgrade).
- **Add:** per-vertex "upgraded port" state; an `upgradePort` action (server and client); cost through the piece cost service.
- **UI:** highlight upgradable port cities with the overlay kit, plus an upgrade button.
- **Bots:** Secondary and up upgrade the port that matches their main resource. Main ignores it.
- **Tests:** only cities, only 3:1 ports, ratio floor, DLC off has no effect.

### Bulwark: Stockpiling
- **Hook:** a `DiscardLimitModifier` registered with `api.define(DISCARD_LIMIT_MODS, ...)`, gated by `hasTech`. It stacks with the Catch-up bonus.
- **Add:** the modifier only. No new action.
- **UI:** show the new limit in the tech panel and the discard prompt.
- **Bots:** nothing; they read the limit through `effectiveDiscardLimit`.
- **Tests:** limit 7 becomes 9; stacks with Catch-up.

### Warlords: Plunder
- **Rule:** when a **knight** is played, the steal takes 1 extra card. A rolled 7 is unchanged. Capped by the victim's hand size.
- **Hook:** the steal lives in the base pack (`packs/base/robbing.ts`). Refactor it once to ask a new registry (for example `STEAL_COUNT_MODS`) for the card count, with zero change in behavior and the golden test green. Then register Plunder through `api.*`.
- **Add:** the registry, the modifier, a history entry for the bigger steal.
- **UI:** the steal result card shows the number of cards taken.
- **Bots:** Secondary and up value knight plays slightly higher.
- **Tests:** knight steals 2, a 7 steals 1, a victim with 1 card loses 1, DLC off has no effect.

### Wild Earth: Ground work
- **Rule:** single-use ability. The player converts one tile that touches their own **settlement or city** (not roads) into one of the 5 basic resources of their choice. The source tile can be any **land** tile type, desert and modded or special tiles included. Sea tiles are not valid. The number token stays. Once used, the tech has no further effect.
- **Hook:** the tile state layer (`shared/tileState.ts`).
- **Add:** a `convertTile` action (single use, tracked per player); a **special tile filter** like the 7 filter. It tints only the tiles that qualify, in a distinct tint with a pattern as well as a color; a resource picker; persistence of the changed tile in game state and export codes.
- **UI:** overlay kit tint, tile click, then resource choice.
- **Bots:** pick the conversion with the best added pip production.
- **Tests:** only touching land tiles, any land source type (desert and modded included), sea refused, only basic targets, number kept, second use refused, DLC off has no effect.

### Guildhall: Road levy
- **Rule:** only when a road is built **past the cap** and the 2x price applies, it costs 1 less brick or wood. Adaptive: take the discount from whichever of the two the player holds fewer of. Roads at normal cost get no discount.
- **Hook:** `COST_MODS` (see `techRoadCostModifier` in `stage1.ts` as the template) and `shared/pricing.ts` for the "above cap" check.
- **Add:** the modifier. Remove the old `base.road_engineering` modifier.
- **UI:** the road cost display shows the discounted price.
- **Bots:** nothing, if they read costs through the pricing service.
- **Tests:** no discount below the cap, -1 above it, adaptive pick, DLC off has no effect.

---

## 5. General work

Verify first (not confirmed on this branch): does a `researchTech` action, a tech panel and bot research logic exist? `stage1.ts` has the logic only.

1. Remove the 4 base techs and the Literacy clause. Update any test that names them.
2. Add the cost formula and `TECH_COST` constants. Replace `techCostCards`.
3. Add `rules.techTreeOn` to the lobby (default off, so existing games stay unchanged).
4. Add the research action (server and client).
5. Build the hub-and-spoke tech panel: the 5 roots always shown, extension nodes generated from `TECH_DEFS` and hidden when their DLC is off, a cost readout per player.
6. Add the 5 techs one at a time, each ending with `npm run typecheck` and `npm test`, `MODULE:` headers, and `INDEX.md` and `change log.md` updated.
7. Sim matrix: tech tree on and off, with each DLC on and off.

The 5 roots need no DLC pack, since they only change base gameplay. Extension nodes later need their DLC pack registered (`allPacks` has only base, gold, fog today). Build order follows `Ideas.md`: Tidebound, Bulwark, Warlords, Wild Earth, Guildhall.

---

## 6. Open questions

- None open.

---

## 7. Later (not locked)

Deeper nodes per branch, a free starting tech setting, techs that need another branch, a second robber move.
