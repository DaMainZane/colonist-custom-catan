# Extension Points

One line per way to add content. Source of truth: `src/shared/registry.ts` (`PackApi`, hooks) and `src/shared/addons.ts` (`AddonDef`). Keyed registries live in the file named in each line. Import the constant, never the kind string (they differ: `COST_MODS` is `'pieceCostMods'`).

An addon registers only while its DLC and the addon are on. A duplicate id throws unless the def has `replace: true`. Pattern file for a whole addon: `src/packs/tidebound/harbor.ts`.

## AddonDef (`shared/addons.ts`)

| Field | Meaning |
|---|---|
| `id` | `<packId>.<name>`, e.g. `tidebound.harbor` |
| `name`, `description?` | Lobby card text |
| `deps?` | Addon ids that must be on; declared earlier in the pack's `addons` list |
| `allowCrossDlcDep?` | Needed for a dep on another DLC's addon |
| `links` | Rule of Two: 2 or more distinct `{ target, kind }` (`mechanic`, `ui`, `content`, `bot`), at least one target a General service id (`GENERAL_SERVICE_IDS`). Checked by `auditAddons` |
| `rules?` | Rule defaults, merged only while on |
| `register?(api)` | Registers content with `PackApi` |

A new addon is also added to its pack's `addons` array (`packs/<dlc>/index.ts`). A new pack is added to `allPacks` in `packs/index.ts`.

## PackApi methods (`shared/registry.ts`)

| Method | Registers |
|---|---|
| `resource(def)`, `tile(def)` | Resource, tile (`TileDef`: `land`, `numbered`, `produces`, `onProduce`, `habitat`, `noPort`) |
| `piece(def)` | `PieceDef`: `target` vertex or edge, `cost`, `vp`, `produces`, `upgradeFrom`, `baseLimit`, `roadLike`, `available?(g, pid)` (on offer to this player now? decides only whether it shows in the client's `pieceCosts`; default yes), `canPlace(ctx, pid, loc, mode)` |
| `devcard(def)`, `award(def)` | Dev card (`validate`, `play`, `legal`), award (`min`, `metric`) |
| `phase(def)` | Phase: `actions[]`, `actor`, `onEnter`, `onExit` |
| `action(def)` | `ActionDef`: `type`, `validate(ctx, pid, payload)`, `apply(ctx, pid, payload)`, `legal?(ctx, pid)` (bot and fuzz candidates; must not use the RNG) |
| `phaseAction(phaseId, actionType)` | Makes an action playable in an existing phase (usually `'main'`). Throws if the phase is unknown. Call from an addon |
| `port(def)`, `preset(def)` | Port type; old map preset (deprecated, use `quickStart`) |
| `mapShape(def)`, `mapTerrain(def)`, `mapNumbers(def)`, `mapPerk(def)`, `quickStart(def)` | Map menu content. Pick ids are unique across shapes, terrains, numberings and perks |
| `capability(id)` | Declares a feature (e.g. `crossing`). A map option with `requires` is refused until it exists |
| `define(kind, def)` | Adds `{ id, ... }` to a keyed registry (table below) |
| `productionStep(order, fn, stepId?)` | Shortcut into the `PRODUCTION_STEPS` registry |
| `hook(name, fn)` | Adds a hook (table below). Unknown names throw |

## Hooks (`HookName`)

Call sites were opened and checked.

| Hook | Signature | Fired from |
|---|---|---|
| `onGameStart` | `(ctx)` | `shared/engine.ts` |
| `onTurnStart` | `(ctx)` | `shared/state.ts` |
| `onTurnEnd` | `(ctx)` | `packs/base/actions/endTurn.ts` |
| `onRoundStart` | `(ctx)` seat 0's turn is about to start; `g.round` is the new round | `shared/state.ts` |
| `onRoundEnd` | `(ctx)` last seat ended; `g.round` is still the finished round | `shared/state.ts` |
| `onRoll` | `(ctx, sum)` | `packs/base/actions/roll.ts` |
| `onBuild` | `(ctx, pieceDef, playerId, location)` | `packs/base/building.ts` |
| `afterAction` | `(ctx, actionType)` | `shared/engine.ts` |
| `vp` | `(g, reg, player, includeHidden) => number`, results are summed | `shared/state.ts` |
| `afterMapGenerated` | `(hexInits, rules, rng, extra)` | `shared/mapgen.ts` (two call sites) |
| `onView` | `(g, reg, viewerId, view)` | `shared/views.ts` (`playerView`) |

## Keyed registries (`api.define(CONSTANT, def)`)

| Constant | File | Def shape |
|---|---|---|
| `COST_MODS` | `shared/pricing.ts` | `{ id, apply(g, p, def, cost) => Resources }` after base cost and limit doubling; also applies to `priceOfUpgrade` |
| `RATIO_MODS` | `shared/tradeRatio.ts` | `{ id, order?, exemptFloor?, apply(g, reg, pid, resource, current) => number \| { ratio, exemptFloor?, reason? } }`; order constants in `RATIO_MOD_ORDER`; 2:1 floor after |
| `HARBOR_RATIO_MODS` | `shared/tradeRatio.ts` | `{ id, apply(g, reg, pid, resource) => number \| null, validateTrade?, recordTrade?, explainNoOneToOne? }`; runs after the floor, minimum 1:1 |
| `PORT_IDLE_CHECKS` | `shared/tradeRatio.ts` | `{ id, idle(g, reg, vertexId), exempt?(g, reg, vertexId) }` |
| `PRODUCTION_STEPS` | `shared/production.ts` | `{ id, order, run(ctx, item, sum?) }`; order constants in `PRODUCTION_STAGE_ORDER` |
| `TILE_STATES` | `shared/tileState.ts` | `{ id, name, blocksProduction?, yieldDelta?, yieldMultiplier?, blocksRobber?, nextState? }` |
| `DURABILITY_DEFS` | `shared/tileState.ts` | `{ id, pieceId, maxDurability, repairCost, permanent? }` |
| `WILD_TOKENS` | `shared/tileState.ts` | `{ id, name, countInDiscard?, stealable? }` |
| `SEVEN_STEPS` | `shared/sevenResolver.ts` | `{ id, order, isDlcSideEffect?, priority?, canFire?(ctx), run(ctx) }`; order in `SEVEN_STEP_ORDER`; side effects capped (default 2 per 7) |
| `DISCARD_LIMIT_MODS` | `shared/sevenResolver.ts` | `{ id, apply(g, reg, p, currentLimit) => number }` |
| `STAT_HANDLERS` | `shared/history.ts` | `{ id, handle(ctx, actionType) }` |
| `EVENT_CARDS` | `shared/eventDeck.ts` | `{ id, title, description, pack?, copies?, apply(ctx) }` |
| `BOT_GOALS` | `shared/botGoals.ts` | `{ id, goalClass?, goals?(ctx, pid), vertexDelta?, edgeDelta?, actionScore?, threatDelta? }`; class `generic`, `basic` (default) or `advanced` gates bot tiers |
| `CONTRACT_CONDITIONS` | `shared/stage1.ts` | `{ id, name, description, tier, vp, dlc?, check(g, reg, pid) }` |
| `TECH_DEFS` | `shared/stage1.ts` | `{ id, name, branch, tier, path?, prereq?, costOffset?, costResources?, dlc?, description, onUnlock?(ctx, pid) }`; gate a feature with `techGate(g, pid, techId)` |
| `STEAL_COUNT_MODS` | `packs/base/robbing.ts` | `{ id, apply(g, reg, thiefId, victimId, source, current) => number }` |
| `VIEW_DATA` | `shared/viewData.ts` | `{ id, priority?, shared?(g, reg), overlays?(g, reg), player?(g, reg, p, who), vpBonus?(g, reg, pid) }`: fields added to the state `server/view.ts` sends. `shared` is public (`null` when its addon is off, so give it a `null` default in an always-on pack-level entry), `overlays` is hex id to `{ kind }` (`undefined`/`null` = not taking part, `{}` = taking part with nothing), `player` is per player (`who.self`, `who.over`, `who.spectator`; `undefined` when off), `vpBonus` is `{ [breakdownKey]: n }`. First wins per field: higher `priority`, then lower id. Merge helpers: `mergeViewShared`, `mergeViewOverlays`, `mergeViewPlayer`, `mergeViewVpBonus` |

Not checked: registries defined inside a single pack (outside the files above). Search for `export const .* = '` before assuming none exist.

## What the client sends (`server/socket.ts`)

A new action or piece needs no server handler. `act` and `place` are the only game entries a module uses; both always send the engine's refusal reason back to the player, and treat the client's object as untrusted.

| Event | Payload | Runs |
|---|---|---|
| `act` | `{ code, type, payload }` | Any registered action type (`dispatch` refuses unknown or illegal ones). `type` must be a string and `payload` a plain object, else `{}` |
| `place` | `{ code, piece, loc }` | The `build` action for any registered piece (`build` checks the id, the spot, supply and price) |

`clickVertex` and `clickEdge` are only the base clicks (steal victim, settlement to city, new settlement; road, or bridge on an ocean edge). The base game events (`rollDice`, `endTurn`, trades, ...) keep one handler each.

## Rules to keep when using these

- Zero `g.rng` draws in addon code unless the base game already draws there; use a derived stream (see `deriveTideRng` in `tidebound/tides.ts`). The golden snapshot depends on it.
- A disabled addon must change nothing: register everything inside `register`.
- After adding imports, run `npm run headers:write`; after adding a file, `npm run index`.
