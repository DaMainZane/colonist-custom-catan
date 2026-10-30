// MODULE: flat resource pictograms, dev card glyphs, UI icons, piece shapes | USED BY: render/*, main.ts
// Style rules (see Design UI Philosophy.md): flat solid silhouettes, no gradients, no outlines,
// drawn in a 28x28 box centered on 0,0 so one glyph works on tiles, hand cards and the trade UI.
// Colors come from CSS classes in styles.css (.g-wood, .g-brick ...), which read the design tokens.

type GlyphFn = () => string;

const GLYPHS: Record<string, GlyphFn> = {
  wood: () => `<path class="g-wood" d="M0,-14 L-6,-5 L-3,-5 L-8,2 L-4,2 L-10,10 L-1.8,10 L-1.8,14 L1.8,14 L1.8,10 L10,10 L4,2 L8,2 L3,-5 L6,-5 Z"/>`,

  brick: () => `<g class="g-brick">
    <rect x="-13" y="-11" width="12" height="6" rx="1"/><rect x="1" y="-11" width="12" height="6" rx="1"/>
    <rect x="-13" y="-4" width="7" height="6" rx="1"/><rect x="-4" y="-4" width="8" height="6" rx="1"/><rect x="6" y="-4" width="7" height="6" rx="1"/>
    <rect x="-13" y="3" width="12" height="6" rx="1"/><rect x="1" y="3" width="12" height="6" rx="1"/>
  </g>`,

  sheep: () => `
    <rect class="g-sheep" x="-6.5" y="6" width="2.4" height="6.5" rx="1"/>
    <rect class="g-sheep" x="2.5" y="6" width="2.4" height="6.5" rx="1"/>
    <ellipse class="g-sheep" cx="11" cy="-1.5" rx="3.6" ry="3.2"/>
    <g class="g-wool">
      <circle cx="-6" cy="0" r="5.6"/><circle cx="-0.5" cy="-4" r="6.4"/><circle cx="5" cy="-1" r="5.4"/>
      <circle cx="-2" cy="3.4" r="5.6"/><circle cx="3.5" cy="3.6" r="4.8"/>
    </g>`,

  wheat: () => `
    <path class="gs-wheat" d="M0,13 L0,-3"/>
    <g class="g-wheat">
      <ellipse cx="0" cy="-9" rx="2.6" ry="4.6"/>
      <ellipse cx="-4.6" cy="-3.5" rx="2.5" ry="4.4" transform="rotate(-28 -4.6 -3.5)"/>
      <ellipse cx="4.6" cy="-3.5" rx="2.5" ry="4.4" transform="rotate(28 4.6 -3.5)"/>
      <ellipse cx="-4.6" cy="3.5" rx="2.5" ry="4.4" transform="rotate(-28 -4.6 3.5)"/>
      <ellipse cx="4.6" cy="3.5" rx="2.5" ry="4.4" transform="rotate(28 4.6 3.5)"/>
    </g>`,

  ore: () => `
    <path class="g-ore" d="M-13,10 L-10,-2 L-3,-9 L5,-10 L12,-2 L13,10 Z"/>
    <path class="g-ore-lt" d="M-10,-2 L-3,-9 L5,-10 L1,0 L-6,2 Z"/>
    <path class="g-ore-dk" d="M5,-10 L12,-2 L13,10 L4,10 L1,0 Z"/>`,

  gold: () => `
    <g class="g-gold">
      <path d="M-13,11 L-10,5 L-1,5 L-3,11 Z"/><path d="M0,11 L2,5 L11,5 L13,11 Z"/><path d="M-6.5,4 L-4,-2 L4,-2 L6.5,4 Z"/>
    </g>
    <path class="g-spark" d="M9,-13 L10.2,-9.2 L14,-8 L10.2,-6.8 L9,-3 L7.8,-6.8 L4,-8 L7.8,-9.2 Z"/>`,

  desert: () => `<g class="g-desert">
    <rect x="-2.8" y="-12" width="5.6" height="25" rx="2.8"/>
    <rect x="-9" y="-1" width="8" height="4.4" rx="2.2"/><rect x="-9" y="-8" width="4.4" height="11" rx="2.2"/>
    <rect x="1" y="-5" width="8" height="4.4" rx="2.2"/><rect x="4.6" y="-11" width="4.4" height="10" rx="2.2"/>
  </g>`,

  fog: () => `<g class="g-fog">
    <circle cx="-5.5" cy="0.5" r="5.2"/><circle cx="1" cy="-4.5" r="6.8"/><circle cx="7.5" cy="0" r="5"/>
    <rect x="-10.5" y="0" width="23" height="5.5"/>
    <rect x="-9" y="8.4" width="15" height="2.4" rx="1.2"/><rect x="-3" y="12" width="12" height="2.4" rx="1.2"/>
  </g>`,

  // Tidebound fish token: body and tail in cream, eye cut out in the card color.
  fish: () => `<g class="g-fish"><ellipse cx="-2" cy="0" rx="9.5" ry="6.2"/><path d="M6,0 L13.5,-6.5 L13.5,6.5 Z"/></g><circle class="g-fish-eye" cx="-6.5" cy="-1.6" r="1.5"/>`
};

// Packs that add resources or tiles register their own glyph, following the same rules.
export function registerGlyph(type: string, fn: GlyphFn): void {
  GLYPHS[type] = fn;
}

// Glyph centered on (x, y). Callers pass the center, `scale` 1 = 28px.
export function getBoardIconSvg(type: string, x: number, y: number, scale = 1): string {
  const fn = GLYPHS[type];
  if (!fn) return '';
  return `<g transform="translate(${x}, ${y}) scale(${scale})">${fn()}</g>`;
}

export function getMiniSvg(type: string): string {
  const fn = GLYPHS[type];
  if (!fn) return '';
  return `<svg class="glyph" width="28" height="28" viewBox="-14 -14 28 28" aria-hidden="true">${fn()}</svg>`;
}

// ---------- Dev card glyphs (cream on the dev card color) ----------

const DEV_GLYPHS: Record<string, GlyphFn> = {
  knight: () => `<g class="g-dev">
    <path d="M0,-13 L3,-8 L3,3 L-3,3 L-3,-8 Z"/><rect x="-7" y="3" width="14" height="3" rx="1.2"/>
    <rect x="-1.5" y="6" width="3" height="5" rx="1"/><circle cx="0" cy="12.5" r="2"/>
  </g>`,
  roadBuilding: () => `
    <path class="g-dev" d="M-11,12 L-3,-12 L3,-12 L11,12 Z"/>
    <g class="g-dev-bg"><rect x="-1" y="-9" width="2" height="4"/><rect x="-1" y="-1" width="2" height="5"/><rect x="-1" y="8" width="2" height="4"/></g>`,
  yearOfPlenty: () => `
    <g class="g-dev"><rect x="-10" y="-2" width="20" height="14" rx="2"/><rect x="-12" y="-7" width="24" height="6" rx="2"/>
    <ellipse cx="-4.5" cy="-10.5" rx="4" ry="3"/><ellipse cx="4.5" cy="-10.5" rx="4" ry="3"/></g>
    <rect class="g-dev-bg" x="-2" y="-7" width="4" height="19"/>`,
  monopoly: () => `
    <g class="g-dev"><rect x="-13" y="6" width="26" height="4" rx="2"/><rect x="-8" y="-10" width="16" height="17" rx="2"/></g>
    <rect class="g-dev-bg" x="-8" y="1" width="16" height="3.5"/>`,
  vp: () => `<polygon class="g-dev" transform="translate(0,1.2)" points="0,-13 3.17,-4.37 12.36,-4.02 5.14,1.67 7.64,10.52 0,5.4 -7.64,10.52 -5.14,1.67 -12.36,-4.02 -3.17,-4.37"/>`,
  back: () => `
    <path class="g-dev" d="M0,-12 L10.4,-6 L10.4,6 L0,12 L-10.4,6 L-10.4,-6 Z"/>
    <path class="g-dev-bg" d="M0,-6.5 L5.6,-3.2 L5.6,3.2 L0,6.5 L-5.6,3.2 L-5.6,-3.2 Z"/>`
};

export function getDevSvg(type: string): string {
  const fn = DEV_GLYPHS[type] || DEV_GLYPHS.back;
  return `<svg class="glyph" width="28" height="28" viewBox="-14 -14 28 28" aria-hidden="true">${fn()}</svg>`;
}

// ---------- UI icons (24px grid, stroke follows currentColor) ----------

const S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const FILL = 'fill="currentColor" stroke="none"';

const UI_ICONS: Record<string, string> = {
  link: `<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>`,
  sound: `<path ${FILL} d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>`,
  mute: `<path ${FILL} d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>`,
  fit: `<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>`,
  bolt: `<path ${FILL} d="M13 2L4.5 13.5H11L10 22l9-12h-6.5z"/>`,
  sliders: `<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>`,
  theme: `<circle cx="12" cy="12" r="8"/><path ${FILL} d="M12 4a8 8 0 0 1 0 16z"/>`,
  check: `<path d="M5 12.5l4.5 4.5L19 7.5"/>`,
  close: `<path d="M6 6l12 12M18 6L6 18"/>`,
  plus: `<path d="M12 5v14M5 12h14"/>`,
  minus: `<path d="M5 12h14"/>`,
  play: `<path ${FILL} d="M8 5l11 7-11 7z"/>`,
  swap: `<path d="M5 8h13M14 4l4 4-4 4M19 16H6M10 12l-4 4 4 4"/>`,
  pencil: `<path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>`,
  users: `<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16.5 5a3 3 0 0 1 0 6M19 14c1.8.6 3 2.2 3 5"/>`,
  bank: `<path d="M3 10l9-6 9 6M5.5 10v8M9.8 10v8M14.2 10v8M18.5 10v8M3 21h18"/>`,
  dice: `<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="9" cy="9" r="1.3" ${FILL}/><circle cx="15" cy="15" r="1.3" ${FILL}/><circle cx="12" cy="12" r="1.3" ${FILL}/>`,
  pass: `<path d="M5 12h12M13 7l5 5-5 5"/>`,
  cards: `<rect x="6" y="3" width="12" height="18" rx="2.2"/>`,
  devcard: `<rect x="6" y="3" width="12" height="18" rx="2.2" ${FILL}/>`,
  devbuy: `<rect x="6" y="3" width="12" height="18" rx="2.2"/><path d="M12 9.5v5M9.5 12h5"/>`,
  road: `<path d="M6 18L18 6" stroke-width="5" stroke="currentColor" stroke-linecap="round" fill="none"/>`,
  bridge: `<path d="M3 16h18M5 16v4M19 16v4M5 16a7 6 0 0 1 14 0M9 12v4M12 10v6M15 12v4"/>`,
  // Tidebound fishing net: a mesh diamond.
  net: `<path d="M12 3.5L20.5 12 12 20.5 3.5 12z"/><path d="M7.75 7.75l8.5 8.5M16.25 7.75l-8.5 8.5"/>`,
  // Tidebound feed the sea: a fish.
  fish: `<path d="M3.5 12c2.6-4.4 8.4-5.6 12.4-2.2L20.5 7v10l-4.6-2.8C11.9 17.6 6.1 16.4 3.5 12z"/><circle cx="8.5" cy="11" r="1" ${FILL}/>`,
  house: `<path ${FILL} d="M12 3.5L3.5 11H6v8.5h12V11h2.5z"/>`,
  city: `<path ${FILL} d="M3.5 20V9.5l4-4 4 4V20zM12.5 20v-7h8v7z"/>`,
  sword: `<path d="M10 14L19 5M7.5 11.5l5 5M10 14l-5 5"/>`,
  waves: `<path d="M3 9q3-3 6 0t6 0 6 0M3 15q3-3 6 0t6 0 6 0"/>`,
  map: `<path d="M9 4L3.5 6v14L9 18l6 2 5.5-2V4L15 6zM9 4v14M15 6v14"/>`,
  home: `<path d="M4 11l8-7 8 7M6 10v10h12V10"/>`,
  refresh: `<path d="M20 6v5h-5M4 18v-5h5M18.5 9A7 7 0 0 0 6 7.5L4 11M5.5 15A7 7 0 0 0 18 16.5L20 13"/>`,
  arrowDown: `<path d="M12 5v14M6.5 13.5L12 19l5.5-5.5"/>`,
  arrowUp: `<path d="M12 19V5M6.5 10.5L12 5l5.5 5.5"/>`,
  chevronUp: `<path d="M6 15l6-6 6 6"/>`,
  chevronDown: `<path d="M6 9l6 6 6-6"/>`,
  trophy: `<path ${FILL} d="M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M12 14v4M8 20h8"/>`,
  star: `<polygon ${FILL} points="12,3 14.8,8.8 21,9.6 16.5,14 17.6,20.2 12,17.2 6.4,20.2 7.5,14 3,9.6 9.2,8.8"/>`,
  robber: `<circle ${FILL} cx="12" cy="6.5" r="3.5"/><path ${FILL} d="M6.5 20l1.5-8.5c0-2 1.8-3 4-3s4 1 4 3L17.5 20z"/>`,
  gift: `<rect x="4" y="10" width="16" height="10" rx="1.5"/><path d="M3 7h18v3H3zM12 7v13M12 7c-1.5-3-5-3-5-1s3.5 1 5 1c1.5 0 5 1 5-1s-3.5-2-5 1"/>`,
  crown: `<path ${FILL} d="M3.5 18L5 8l4.5 4L12 6l2.5 6L19 8l1.5 10z"/>`,
  tree: `<path ${FILL} d="M12 3L6.5 10h3L5.5 16h5v5h3v-5h5l-4-6h3z"/>`,
  bricks: `<rect x="3" y="5" width="8" height="4" rx="0.8" ${FILL}/><rect x="13" y="5" width="8" height="4" rx="0.8" ${FILL}/><rect x="3" y="10.5" width="5" height="4" rx="0.8" ${FILL}/><rect x="9.5" y="10.5" width="5" height="4" rx="0.8" ${FILL}/><rect x="16" y="10.5" width="5" height="4" rx="0.8" ${FILL}/><rect x="3" y="16" width="8" height="4" rx="0.8" ${FILL}/><rect x="13" y="16" width="8" height="4" rx="0.8" ${FILL}/>`,
  wool: `<path ${FILL} d="M8.5 16a3.5 3.5 0 0 1-.8-6.9 4.5 4.5 0 0 1 8.6 0 3.5 3.5 0 0 1-.8 6.9z"/><path d="M9 16v3.5M15 16v3.5"/>`,
  grain: `<path d="M12 21V5"/><ellipse ${FILL} cx="12" cy="5.5" rx="1.8" ry="3"/><ellipse ${FILL} cx="8.8" cy="10" rx="1.7" ry="2.8" transform="rotate(-28 8.8 10)"/><ellipse ${FILL} cx="15.2" cy="10" rx="1.7" ry="2.8" transform="rotate(28 15.2 10)"/><ellipse ${FILL} cx="8.8" cy="15" rx="1.7" ry="2.8" transform="rotate(-28 8.8 15)"/><ellipse ${FILL} cx="15.2" cy="15" rx="1.7" ry="2.8" transform="rotate(28 15.2 15)"/>`,
  rock: `<polygon ${FILL} points="4,19 6.5,9 11,5 16.5,6 20,12 19,19"/>`,
  eye: `<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>`,
  tech: `<path d="M12 9.5V5.1M14.1 13.2l3.9 2.3M9.9 13.2L6 15.5"/><circle cx="12" cy="12" r="2.6" ${FILL}/><circle cx="12" cy="3.6" r="1.7"/><circle cx="19.3" cy="16.2" r="1.7"/><circle cx="4.7" cy="16.2" r="1.7"/>`
};

export function uiIcon(name: string, size = 20): string {
  const body = UI_ICONS[name];
  if (!body) return '';
  return `<svg class="ui-icon" width="${size}" height="${size}" viewBox="0 0 24 24" ${S} aria-hidden="true">${body}</svg>`;
}

// Fills static markup: data-icon="link" (UI icon), data-glyph="wood" (resource glyph), data-dev="knight", data-robber.
export function hydrateIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach(el => {
    el.innerHTML = uiIcon(el.dataset.icon || '', Number(el.dataset.size) || 20);
  });
  root.querySelectorAll<HTMLElement>('[data-glyph]').forEach(el => {
    el.innerHTML = getMiniSvg(el.dataset.glyph || '');
  });
  root.querySelectorAll<HTMLElement>('[data-dev]').forEach(el => {
    el.innerHTML = getDevSvg(el.dataset.dev || '');
  });
  root.querySelectorAll<HTMLElement>('[data-robber]').forEach(el => {
    el.innerHTML = `<svg width="26" height="30" viewBox="-14 -24 28 40" aria-hidden="true">${robberMarkup()}</svg>`;
  });
}

// ---------- Dice faces ----------

const PIPS: Record<number, number[][]> = {
  1: [[18, 18]],
  2: [[11, 11], [25, 25]],
  3: [[11, 11], [18, 18], [25, 25]],
  4: [[11, 11], [25, 11], [11, 25], [25, 25]],
  5: [[11, 11], [25, 11], [18, 18], [11, 25], [25, 25]],
  6: [[11, 10], [25, 10], [11, 18], [25, 18], [11, 26], [25, 26]]
};

export function dieFaceSvg(n: number): string {
  const pts = PIPS[n];
  if (!pts) return '';
  return `<svg viewBox="0 0 36 36" width="36" height="36" aria-label="${n}">${pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="3.3" fill="currentColor"/>`).join('')}</svg>`;
}

// ---------- Board pieces (flat shapes with one light rim so they separate from every tile) ----------

export function shade(color: string, f: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(color || '');
  if (!m) return color;
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return `rgb(${r},${g},${b})`;
}

// Rim layer first (all shapes grown by the stroke, in the rim color), then the real fills on top.
function rimmedLayers(layers: { d: string; fill: string }[], rimW = 3.4): string {
  const rim = layers.map(l => `<path d="${l.d}"/>`).join('');
  const body = layers.map(l => `<path d="${l.d}" style="fill:${l.fill}"/>`).join('');
  return `<g style="fill:var(--piece-rim);stroke:var(--piece-rim);stroke-width:${rimW};stroke-linejoin:round">${rim}</g>${body}`;
}

const LIGHT = 'var(--piece-rim)';

export function settlementMarkup(col: string): string {
  return rimmedLayers([
    { d: 'M-8.5,-2 H8.5 V10 H-8.5 Z', fill: col },
    { d: 'M-11.5,-1.5 L0,-12.5 L11.5,-1.5 Z', fill: shade(col, 0.7) },
    { d: 'M-2.3,3.2 H2.3 V10 H-2.3 Z', fill: LIGHT }
  ], 3.8);
}

// Tower plus house, about 1.35x the settlement so the two are never confused at small sizes.
export function cityMarkup(col: string): string {
  const roof = shade(col, 0.7);
  return rimmedLayers([
    { d: 'M-14,-6 H-3 V11 H-14 Z', fill: col },
    { d: 'M-15.5,-6 L-8.5,-13.5 L-1.5,-6 Z', fill: roof },
    { d: 'M-3,1 H14 V11 H-3 Z', fill: col },
    { d: 'M-4.5,1.5 L5.5,-6.5 L15.5,1.5 Z', fill: roof },
    { d: 'M-11,-2 H-6 V2 H-11 Z', fill: LIGHT },
    { d: 'M-11,5 H-6 V9 H-11 Z', fill: LIGHT },
    { d: 'M3,5 H8 V11 H3 Z', fill: LIGHT }
  ], 3.8);
}

// Tidebound fishing net: a post with a mesh diamond in the owner's color. Smaller than a settlement and clearly not a roof, so the two are never mixed up.
export function netMarkup(col: string): string {
  const mesh = `<path d="M-5.25,-8 L5.25,2 M5.25,-8 L-5.25,2" style="fill:none;stroke:var(--piece-rim);stroke-width:1.6;stroke-linecap:round"/>`;
  return rimmedLayers([
    { d: 'M-1.6,-3 H1.6 V11 H-1.6 Z', fill: shade(col, 0.7) },
    { d: 'M0,-13 L10.5,-3 L0,7 L-10.5,-3 Z', fill: col }
  ], 3.4) + mesh;
}

/**
 * Tidebound fishing ground drawn on a sea tile (T7c): a fish with one pip per boost. A filled pip is a boost left, an empty one is used up;
 * `left` 0 draws the fish as a dashed outline (the icon never goes away, it only waits for the tide or a feed). Colors come from the .fish-ground
 * classes in styles.css. Drawn around (0, 0) in a 28 unit box, like the glyphs.
 */
export function fishGroundMarkup(left: number, max = 4): string {
  const n = Math.max(0, Math.min(max, Math.round(left)));
  const pips = Array.from({ length: max }, (_, i) => {
    const x = (i - (max - 1) / 2) * 7;
    return `<circle class="fish-pip${i < n ? ' on' : ''}" cx="${x}" cy="11" r="2.4"/>`;
  }).join('');
  return `<g class="fish-ground${n <= 0 ? ' spent' : ''}"><g transform="translate(0,-3)"><g class="fish-body"><ellipse cx="-2" cy="0" rx="9.5" ry="6.2"/><path d="M6,0 L13.5,-6.5 L13.5,6.5 Z"/></g><circle class="fish-eye" cx="-6.5" cy="-1.6" r="1.5"/></g>${pips}</g>`;
}

export function robberMarkup(): string {
  return rimmedLayers([
    { d: 'M-9,14 L9,14 L6.5,1 C10,-2.5 6.5,-11 0,-11 C-6.5,-11 -10,-2.5 -6.5,1 Z', fill: 'var(--robber)' },
    { d: 'M-6.3,-14.5 a6.3,6.3 0 1 0 12.6,0 a6.3,6.3 0 1 0 -12.6,0 Z', fill: 'var(--robber)' }
  ], 3.2);
}

// ---------- Card stacks ----------

// Flat resource card stack: small offset per extra card (max 4 visible), glyph and count on the front card.
export function buildOverlappingStackHtml(
  cardClass: string,
  innerSvgHtml: string,
  count: number,
  onClickStr: string,
  titleStr = '',
  extraStyle = ''
): string {
  const visibleSlices = Math.min(Math.max(1, count), 4);
  const offsetStep = 7;
  const cardW = 48;
  const totalWidth = cardW + (visibleSlices - 1) * offsetStep;

  let slicesHtml = '';
  for (let i = 0; i < visibleSlices; i++) {
    const isFront = i === visibleSlices - 1;
    slicesHtml += `
      <div class="stack-slice ${cardClass}" style="left:${i * offsetStep}px; ${isFront ? extraStyle : ''}">
        ${isFront ? innerSvgHtml : ''}
        ${isFront ? `<span class="card-count">${count}</span>` : ''}
      </div>`;
  }

  return `
    <div class="stacked-group" style="width:${totalWidth}px;" ${onClickStr ? `onclick="${onClickStr}"` : ''} title="${titleStr}">
      ${slicesHtml}
    </div>`;
}
