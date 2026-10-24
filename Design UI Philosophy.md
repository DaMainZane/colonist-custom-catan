# Design UI Philosophy

Decided 2026-10-24. This is the visual direction for the new client UI. It is built in Step 4 (UI and phone together), on top of the design-token layer described below.

## Why change

The current skin copies Colonist.io: saturated blue background, cream panels, glossy gradient buttons with 3D shadows, heavy black card outlines, illustrated resource icons, emoji avatars. It is busy, nothing says what matters most, and colors are hardcoded as hex values across `styles.css`, `constants.ts`, `icons.ts` and the board renderer.

## Direction

Assets from two references, colors from a third.

| Layer | Reference | What we take |
|---|---|---|
| UI shell | **Lichess** | The board is the hero. Everything else is flat, quiet and neutral, and stays out of the way. |
| Assets | **Mini Metro** + **Lichess pieces** | Flat solid shapes, no gradients, no decorative outlines (Mini Metro). Drawn as recognizable pictograms, like Lichess's flat chess pieces: a tree reads as a tree, a rock as a rock. |
| Color | **Dorfromantik** | Muted, warm, natural palette. Soft greens, clay, sand, slate, with matte finish instead of glossy. |

Not chosen: Dieter Rams style (monochrome plus one accent). Too cold for a game board.

## Principles

1. **Board first.** The board gets the most space and the most color. Panels, buttons and chrome use neutrals.
2. **Recognizable shapes, color supports them.** Every resource is a flat pictogram with a distinct silhouette (tree, brick wall, sheep, wheat, rock, ingots, cactus, cloud), so the game stays readable for colorblind players and at phone size. Pictograms, not abstract geometry: icons should be recognized without learning them.
3. **Flat and matte.** No gradients, no glossy highlights, no 3D button shadows. Depth comes from spacing and, where needed, one soft shadow level.
4. **Few colors, used with intent.** Muted palette for tiles. One accent color for "your turn" and primary actions. Player colors stay the most saturated things on the board so ownership reads instantly.
5. **Quiet motion.** Short, eased transitions for placing pieces, robber moves and card transfers. Respect `prefers-reduced-motion`.
6. **Same UI, any screen.** Phone first sizing (tap targets of at least 44px), then scale up. Designed together with the adaptive layouts in Step 4.
7. **Light and dark from the start.** Both themes come from the same tokens.

## Resource pictograms

Revised the same day after the first preview: the first draft used abstract geometric glyphs (triangle, diamond, circle), which were flat but not recognizable. The approved style is flat pictograms: solid silhouettes with at most one or two accent shades, no outlines, no gradients.

| Resource | Pictogram | Glyph color (on tile) |
|---|---|---|
| Wood | Layered pine tree with trunk | `#3d6240` |
| Brick | Staggered brick wall (3 rows) | `#8c3f28` |
| Sheep | Cream wool body, head and legs | wool `#f4f1ea`, rest `#4a5a2e` |
| Wheat | Stalk with five grains | `#9a7420` |
| Ore | Faceted rock, light facet plus shaded side | `#5b6670` |
| Gold | Stack of three ingots with a sparkle | `#8f6416`, sparkle `#f4f1ea` |
| Desert | Cactus with two arms | `#6f8f55` |
| Fog | Cloud with two wisps | `#8f9ba3` |

Rules for any glyph, including ones from packs:

- One recognizable silhouette, drawn flat, readable at about 24px.
- Main color is a darker shade of the tile color. Accent shades are limited to a light facet, a shaded side, or one cream detail.
- Designed in a 28x28 box so glyphs can be reused for tiles, hand cards and the trade UI.
- Pack-added resources and tiles must supply their own glyph following the same rules.

## Pieces

Pieces must stand out from every tile color while staying flat.

- **Road:** thick rounded bar (8px) in the player color.
- **Settlement:** house silhouette with a darker roof and a light door.
- **City:** tower plus house, larger than a settlement (about 1.3x) so the two are never confused at small sizes.
- **Rim:** every piece has a light rim (`--piece-rim`, currently `#f4f1ea`, about 1.5px outside the shape; roads 2.5px). This is the one allowed outline, and it exists only to separate pieces from tiles. Tested on wood, sheep, desert and brick tiles.
- Player colors are the most saturated colors on the board.

## Palette (starting point, tune by eye)

Warm, muted, inspired by the Dorfromantik feel. These are first guesses, not final values.

| Token | Role | Starting value |
|---|---|---|
| `--tile-wood` | forest | `#5f8a5a` |
| `--tile-brick` | clay | `#c0674a` |
| `--tile-sheep` | meadow | `#a9c27a` |
| `--tile-wheat` | field | `#e2c56b` |
| `--tile-ore` | stone | `#8d98a3` |
| `--tile-desert` | sand | `#d9c9a0` |
| `--tile-gold` | gold | `#d9a441` |
| `--tile-fog` | fog | `#c9d1d6` |
| `--tile-water` | sea | `#6f9fb0` |
| `--surface` / `--surface-2` | panels (light) | `#f4f1ea` / `#e9e5db` |
| `--ink` | text (light) | `#2b2f33` |
| `--accent` | your turn, primary action | `#d9893b` |
| `--player-red` / `--player-blue` | example player colors | `#e0483a` / `#3a7bd5` |
| `--piece-rim` | rim around pieces | `#f4f1ea` (may change, see open questions) |
| `--token` / `--token-ink` / `--token-hot` | number token, its text, and 6/8 text | `#f4f1ea` / `#2b2f33` / `#b3402e` |

Dark theme uses the same tile tokens, slightly desaturated, on a near-black warm neutral background.

## Typography

One typeface family, two or three sizes, two weights. Numbers (dice, VP, card counts) use tabular figures so they do not jump. No emoji in the UI chrome. Avatars become simple colored shapes or initials.

## Components

- **Buttons:** flat fill, 8px radius, no border. Primary uses `--accent`, secondary uses `--surface-2`. Disabled is lower contrast, not grayscale.
- **Panels:** flat `--surface`, 8 to 12px radius, one soft shadow level at most.
- **Hand:** resource cards are flat colored rectangles with the glyph and a count, no black outline. Stack with a small offset.
- **Trade, discard, pick:** same panel style, anchored consistently (bottom sheet on phones, side or corner panel on desktop).
- **Pieces:** see the Pieces section above.

## Implementation plan

1. **Design tokens.** Move every color, radius, spacing and font value into CSS variables (`:root` plus a dark theme block). Replace hardcoded hex in `styles.css`, `constants.ts` (`RES_META`), `icons.ts` and `render/board.ts` with tokens.
2. **Glyph set.** Replace `getBoardIconSvg` and `getMiniSvg` with the flat glyphs. Keep one function per resource so packs can register their own.
3. **Shell.** Restyle panels, buttons, lobby bar and menus. Remove emoji and gradient styling.
4. **Board and pieces.** Flat tiles, number tokens, ports and player pieces in the new style.
5. **Layouts.** Adaptive phone, tablet and desktop layouts (Step 4).
6. **Review on real devices.** Check contrast and colorblind readability, adjust the palette.

## Open questions

- Final typeface (system font stack, or one bundled font).
- Whether number tokens are circles (classic) or rounded squares.
- Whether player colors should follow the same muted palette or stay brighter than the tiles. Current lean: brighter.
- Piece rim color: the light rim works on the tested tiles, but John may switch it to black or gray. Try a dark rim and a gray rim in the next preview and compare, including in dark mode.
- Whether the sheep's cream wool and the fog cloud are too similar at small sizes.

## Sample
![[../../_attachments/file-20261024175027506.png]]