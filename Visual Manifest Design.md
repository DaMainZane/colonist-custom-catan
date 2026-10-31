# Visual Manifest Design (R8.2)

Written 2026-10-31. Status: **OK from the owner on 2026-10-31 (decisions 1 to 9 as recommended).** R8.3 to R8.5 are built; R8.6 (another agent) and R8.7 follow. Facts come from `R8.1 Findings.md`, `shared/registry.ts`, `shared/viewData.ts`, `server/view.ts`, `server/net.ts`, `server/socket.ts`, `client/store.ts`, `client/types.ts`, `client/main.ts`, `client/render/pirates.ts`.

**Goal:** a DLC piece is described by plain data on its `PieceDef` or `ActionDef`. The server turns that into a manifest (JSON). The client draws buttons, spots and shapes from it. No per-piece edit in `client/` or `public/index.html`.

**Rule that shapes it:** `client` cannot import `packs`. So the manifest holds no functions.

## (a) Types (`src/shared/visual.ts`, plain data only)

```ts
export type VisualSlot = 'vertex' | 'edge' | 'edge:ocean' | 'hex';

export interface ButtonVisual {
  label: string;        // "Net"
  icon: string;         // a UI_ICONS name ("net"), or inline SVG if it starts with "<" (24x24 box, currentColor)
  order?: number;       // position in #pieceButtons, default 100
  group?: string;       // pieces with the same group share ONE button (bridge + rickety bridge)
}
export interface HintTexts { noSupply?: string; cannotAfford: string; noSpots: string }

export interface PieceVisual {
  slot: VisualSlot;
  button: ButtonVisual;
  hints: HintTexts;
  shape?: string;       // SVG fragment of the placed piece (c). Absent for actions: they place nothing
  rim?: number;         // rim width in px, default 3.4
  spot?: string;        // SVG fragment for the clickable spot marker. Default: the generic pulse by slot
  spotKey?: string;     // actions only: the payload field that carries the spot ("hexId")
  css?: string;         // (e)
}
export interface ManifestEntry extends PieceVisual { id: string; kind: 'piece' | 'action' }

export interface OverlayKindVisual {               // (f)
  id: string; label: string;
  tint: { light: string; dark: string };           // CSS colours
  line: { light: string; dark: string };
  pattern: string;                                 // REQUIRED: inner SVG of a 10x10 tile
  icon?: string; pulse?: boolean;
}
export interface VisualManifest { version: 1; pieces: ManifestEntry[]; overlays: OverlayKindVisual[] }
export const OVERLAY_KINDS = 'overlayKinds';       // api.define(OVERLAY_KINDS, def)
```

Why: one flat set of types the server builds and the client reads. `pattern` is required (not optional) so the compiler enforces the colourblind rule.
`id` and `kind` are not authored. The builder takes them from the `PieceDef.id` or `ActionDef.type` it was registered on.
Empty manifest: `{ version: 1, pieces: [], overlays: [] }`. Pieces are sorted by `order`, then `id`, so the JSON is stable.

## (b) Slots

- `vertex`: net, beacon, harbor (spots are port vertices).
- `edge`: a road-like edge piece on any edge.
- `edge:ocean`: an edge piece that only goes on ocean edges (bridge, rickety bridge). The spot layer skips the base road hover there.
- `hex`: **added by me.** Feed spots are sea tiles (`feedSpots`, `.fish-ring`), so three slots are not enough.

Why: the slot says where the spot marker and the shape sit on the board, and which click path the client uses.

## (c) Shape: SVG string with placeholders

- `{color}` is the owner's colour. `{dark}` is `shade(color, 0.7)` (**second placeholder, added by me:** the net post and house roofs need it).
- Client fills them with a plain string replace, only after checking the colour matches `/^#[0-9a-f]{3,8}$/i`. Player colours are constants, so this is a safety check, not a fix.
- Vertex shape: drawn around (0,0), inside a +-12 box. Client wraps it in `translate(x,y)`.
- Edge shape: drawn along the x axis from x=-50 to x=50, centred on y=0. Client wraps it in `translate(mid) rotate(angle) scale(len/100, 1)`. Authors put `vector-effect="non-scaling-stroke"` on strokes so planks do not squash.
- Client adds the rim by wrapping the shape in the existing `rimmedLayers(shape, rim)`.
- A test checks every shape: no `<script`, no `on...=` attribute, no `{...}` except the two placeholders.

Why: a string keeps the manifest pure data, and the same SVG style as `icons.ts` (`netMarkup`) moves over with little change.

## (d) Button, badge, hints

- **Button:** built into `#pieceButtons`, which sits where `btnBuildBridge` is now (after Road, before Settle). Order today: bridge 10, net 20, feed 30, harbor 40.
- **Group:** entries with the same `group` show one button (the first by `order` gives label and icon).
- **Mode:** `setBuildMode(entry.id)`. The id is the build mode (a plain string already).
- **Badge:** no manifest field. Shown only when `pieces[id].left` is a number. No supply number means no badge (feed). Before data arrives the badge is hidden, so the `?? 10`, `?? 4`, `?? 1` defaults can go (R8.9).
- **Hint when the button is pressed, first match wins:** `left === 0` gives `noSupply`; the player cannot pay `cost` gives `cannotAfford`; `spots` is `[]` gives `noSpots`. If `noSupply` is missing (an action) that step is skipped.
- **Recipe popup** (`recipePopup<Id>`, drawn by `hand.ts`): the builder creates it from `pieces[id].cost`. See open decision 8.

Why: hints and badge fall out of data the client already has (`left`, `cost`, `spots`, resources). No extra manifest text beyond three strings.

## (e) Optional `css`

A string, injected once per entry into `<style id="vis-css-<id>">`. Re-injected only if the string changes. Like `ensurePirateStyles` in `pirates.ts`. Test: no `</style`, no `@import`.

## (f) Overlay kinds

`{ id, label, tint, line, pattern, icon?, pulse? }`, registered with `api.define(OVERLAY_KINDS, def)` and sent in `manifest.overlays`.
The client writes `--ov-<id>-tint` and `--ov-<id>-line` once per theme and builds one `<pattern id="ov-pat-<id>">` from `pattern`. `label` is required (colour, pattern, and text together: `Design UI Philosophy.md`, guardrail 4). `pulse` replaces the hard-coded `floodWarnFlash`. R8.8 step 1 moves `flood` and `flood-warn` onto this.

## (g) Tier 2: render modules (wrecks, pirates, fish, bridge picker)

They stay client code. Contract (the file is built in R8.8 step 6, not in R8.7):

```ts
// client/modules.ts
export interface BoardModule {
  id: string;                          // layer is <g id="board-<id>-layer">
  layer: 'under' | 'over';             // under = above hexes, below pieces; over = above pieces
  markup(state: GameState, me?: PlayerView): string;   // '' = nothing. board.ts rewrites the layer only when this string changes
  windowFns?: Record<string, (...a: any[]) => void>;   // inline onclick names
}
export function registerBoardModule(m: BoardModule): void;   // also does Object.assign(window, m.windowFns)
export function boardModules(): BoardModule[];               // board.ts loops over this
export function registerSpotChooser(group: string, fn: (loc: number, pieceIds: string[]) => void): void;
```

- A module file calls `registerBoardModule` when imported. Its own styles use the `ensure...Styles` pattern. Its own animation state (known wrecks, spawn timers) lives in the module.
- The imports come from a generated `client/render/modules.generated.ts` (same idea as `addons.generated.ts`, with a staleness test). `main.ts` imports it once. No edit per module.
- `board.ts` loops over `boardModules()` instead of `boardFishLayer`, `boardWrecksLayer`, `boardPiratesLayer`. `renderAll` is not touched.
- Their data already comes from `VIEW_DATA` (`wrecks`, `pirates`, `fishIcons`).
- **Spot chooser:** a click on a spot listed by 2 or more entries in one `group` calls the chooser. With none registered, the first entry by `order` wins. The bridge picker registers for the bridge group. Its upgrade and demolish popups on placed bridges stay inside it (R8.8 step 5 decides how the placed-bridge click reaches it).

Why: animated, custom pieces would need a drawing language in data. A small registry gets the same result with no `board.ts` edit.

## (h) Per-player piece data: `pieces[id]`

```ts
export interface PiecePlayerData {
  left: number | null;     // supply left. null = no supply concept (an action, e.g. feed)
  cost: Resources;         // this player's price right now. Equals legacy pieceCosts[id], feedCost, harborCost
  spots: number[] | null;  // legal locations now (vertex, edge or hex ids, ascending). null = not computed
}
// PlayerView.pieces?: Record<string, PiecePlayerData>
```

**What is null and what is undefined (exact):**
- `PlayerView.pieces` is `undefined` when the registry has no manifest entry at all (base game). JSON drops it.
- A key `pieces[id]` is **absent** when that id is not on offer to that player (addon off, tech missing: `PieceDef.available` false). Absent key means: hide the button. This matches the old `netsLeft` rule (`undefined` until the tech is owned).
- `left`: set for every player (supply is public, as `netsLeft` is today). `null` for actions.
- `cost`: set for every player when the key is present (as `pieceCosts` is today).
- `spots`: only for the viewer's own player (`who.self`), not over, and only when the engine would accept the action now (phase lists it, this player's turn). Otherwise `null`. `[]` means: your turn, nothing legal (so the `cannotAfford` or `noSpots` hint applies). Never `undefined` inside a present key.

**How the server computes it:**
- One generic always-on `VIEW_DATA` entry, `base.pieces_view` (in the base pack), loops over the registry. It cannot be one entry per addon: `mergeViewPlayer` keeps the first entry per top-level key and drops the rest, so a second addon's `pieces` would vanish.
- For a piece: `left = p.pieces[id] ?? null`; `cost = pieceCost(g, p, def, reg)`; `spots` = every vertex or edge where the `build` action's `validate` passes for `{ piece: id, loc }`. That one check includes supply, price, `canPlace` and geometry, so there is no per-piece spots function.
- For an action: `spots` = `legal(ctx, pid)` payloads that pass `validate`, mapped to `payload[spotKey]`. `cost` comes from new optional `ActionDef.price?(g, reg, pid)`; availability from new optional `ActionDef.available?(g, pid)` (R8.3 adds both).
- Legacy fields (`netsLeft`, `netSpots`, `feedSpots`, `harborSpots`, `bridgesLeft`, ...) keep being sent until R8.8 deletes each. `tests/view.snapshot.json` is regenerated once in R8.6, as a reviewed diff.

Why: `validate` is the one source of truth, so the highlighted spots can never disagree with what the server accepts.

## (i) Edge piece spots

The server lists them (`pieces.bridge.spots`, `pieces.rickety_bridge.spots`) through the same `validate` scan. `canClientPlaceBridge` in `board.ts` is then dead and is deleted in R8.8 step 5. The bridge picker learns which types fit an edge by asking which grouped entries list that edge id.
Cost: an edge `spots` array can hold a few hundred ids, sent once per broadcast to its own player only. The same size class as `netSpots` today.

## Wire transport (R8.4, depends on decision 1)

Separate `visuals` event: `{ key: string, manifest: VisualManifest }`.
- `key` = `mapRegistryKey({ dlc, addons })`, taken from `room.settings` in the lobby and from `room.game.rules` in a game. The manifest comes from `mapRegistryFor(...)` (cached), not `gameRegistry` (rebuilt on every call).
- `syncVisuals(socketId, room)` in `net.ts` runs in every `broadcastRoom`, **also in a game**, and sends before `gameState`. Per socket it remembers `sock.data.visualsKey` and resends only on change (same trick as `syncMapOptions`, but not skipped in a game).
- Nothing is sent on connect (changed while building R8.4, simpler than the first draft). A socket that was never sent a manifest has no remembered key, so the first broadcast to it always sends one, even an empty one. A reconnect is a new socket, so it gets one too. The client also resets its copy on disconnect.
- Rematch: back in the lobby the key is recomputed from the settings, so a changed addon set resends. A reconnect is a new socket, so it always gets a fresh send. Spectators get the same event as players (same `humanIds` loop, which includes spectators: checked).
- Client: `client/visuals.ts` holds the manifest. `setManifest` replaces it and, if a state exists, calls `renderAll`. Before the first `visuals` event, or if it never comes, the manifest is empty and the UI shows no generated buttons. If it arrives after the first `gameState`, the re-render adds them.

## Tier 1 and tier 2 summary

| Tier 1 (manifest data) | Tier 2 (client module) | Stays hard-coded |
|---|---|---|
| net, harbor, feed, bridge, rickety bridge buttons and spots, shapes of net and bridges, overlay kinds `flood` and `flood-warn` | fish grounds, wrecks, pirates, bridge picker | road, settlement, city; `wall-incomplete`, `plague`, `wave`, `crack`, `season` overlays (DLCs not built) |

## Open decisions

| # | Question | My recommendation |
|---|---|---|
| 1 | Manifest transport | Separate `visuals` event (above). |
| 2 | Wrecks, pirates, fish stay as code | Yes, confirm. |
| 3 | Base pieces stay hard-coded | Yes, confirm. |
| 4 | Proof piece for R9.2 | The template beacon (vertex piece). The manifest can describe it: slot `vertex`, a small house-like shape, a button, three hints. It needs only a `pieceLimits` rule. Not built here. |
| 5 | Add slot `hex` | Yes. Feed needs it. |
| 6 | `clickSpot` also handles actions | Yes. A `piece` entry emits `place`; an `action` entry emits `act` with `{ [spotKey]: loc }`. Feed and harbor are actions. |
| 7 | Generic `base.pieces_view` entry, spots from `validate` | Yes (section h). |
| 8 | Recipe popups (`hand.ts`) | The button builder in R8.7 also creates `recipePopup<Id>` from `pieces[id].cost`. Then R8.8 can delete the `hand.ts` entries. `hand.ts` is missing from the R8.8 deletion list in `Rework Progress.md` (found in R8.1). |
| 9 | Second placeholder `{dark}` | Yes. |

Decisions 1 to 4 are yours. 5 to 9 are design details I made; say so if you disagree.

## Not checked yet (read before the step that needs it)

`rimmedLayers` and the `UI_ICONS` format (`icons.ts`), R8.7. Whether `makeCtx` has side effects when called from `view.ts`, R8.6. The payload keys and `legal`/`validate` of `feed_sea` and `upgrade_harbor`, and how `feedCost`/`harborCost` are computed (`fishing.ts`, `harbor.ts`), R8.3 and R8.6. `scripts/addons.mjs`, to reuse it for `modules.generated.ts`, R8.8.
