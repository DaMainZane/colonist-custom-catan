// MODULE: tech tree pan and zoom (pure view maths: clamp, zoom about a point, pan, and when the costs show) | DEPENDS ON: none | USED BY: client/render/techpanel
/** The tech tree view: the world is drawn at `scale`, with its top-left corner at (`x`, `y`) pixels inside the viewport. */
export interface TechView {
  scale: number;
  x: number;
  y: number;
}

export const MIN_SCALE = 0.4;
export const MAX_SCALE = 3;
/** Costs show from this zoom up (a judgement call: 1 is the opening view, so costs show there and hide once the player zooms out). */
export const COST_MIN_SCALE = 0.85;
export const DEFAULT_VIEW: TechView = { scale: 1, x: 0, y: 0 };

/** `-0` and `NaN` become `0`, so a clamped view compares cleanly. */
const num = (n: number): number => n || 0;

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Keeps the world on screen. A world bigger than the viewport cannot be dragged past its edges (no blank gap);
 * a world smaller than the viewport stays fully inside it. Before the viewport has a size the view is returned as is.
 */
export function clampView(v: TechView, w: number, h: number): TechView {
  const scale = clampScale(v.scale);
  if (!(w > 0) || !(h > 0)) return { scale, x: v.x, y: v.y };
  const axis = (pos: number, size: number): number => {
    const room = size - size * scale;
    return num(Math.min(Math.max(pos, Math.min(0, room)), Math.max(0, room)));
  };
  return { scale, x: axis(v.x, w), y: axis(v.y, h) };
}

/** Zooms by `factor` about the viewport point (`px`, `py`): the world point under it stays under it. */
export function zoomAt(v: TechView, factor: number, px: number, py: number, w: number, h: number): TechView {
  const scale = clampScale(v.scale * factor);
  const k = scale / v.scale;
  return clampView({ scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k }, w, h);
}

export function panBy(v: TechView, dx: number, dy: number, w: number, h: number): TechView {
  return clampView({ scale: v.scale, x: v.x + dx, y: v.y + dy }, w, h);
}

/** Costs under the techs only show when the tree is zoomed in close enough not to clutter the screen. */
export function costsVisible(scale: number): boolean {
  return scale >= COST_MIN_SCALE;
}

export function viewCss(v: TechView): string {
  const f = (n: number): string => String(Number(n.toFixed(3)));
  return `translate(${f(v.x)}px,${f(v.y)}px) scale(${f(v.scale)})`;
}
