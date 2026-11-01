import { describe, expect, it } from 'vitest';
import { COST_MIN_SCALE, DEFAULT_VIEW, MAX_SCALE, MIN_SCALE, clampScale, clampView, costsVisible, panBy, viewCss, zoomAt } from '../src/client/techView';

// Bug 2 and Bug 3 (tech tree): the pure half of pan and zoom. No DOM: a view in, a view out.
// A view is { scale, x, y }: the world is drawn at `scale`, its top-left corner sits at (x, y) inside a w by h viewport.

const W = 600;
const H = 600;
/** The world point under a viewport point, for checking that a zoom keeps the point under the cursor still. */
const worldAt = (v: { scale: number; x: number; y: number }, px: number, py: number) => ({ x: (px - v.x) / v.scale, y: (py - v.y) / v.scale });

describe('tech tree zoom and pan (Bug 2)', () => {
  it('starts at scale 1 with no offset', () => {
    expect(DEFAULT_VIEW).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it('clamps the scale to the allowed range', () => {
    expect(clampScale(100)).toBe(MAX_SCALE);
    expect(clampScale(0.001)).toBe(MIN_SCALE);
    expect(clampScale(1)).toBe(1);
    expect(clampScale(Number.NaN)).toBe(1);
  });

  it('zooming keeps the world point under the cursor in place', () => {
    for (const [px, py, f] of [[300, 300, 2], [100, 200, 2], [450, 80, 1.5], [10, 590, 2.5]] as const) {
      const before = worldAt(DEFAULT_VIEW, px, py);
      const next = zoomAt(DEFAULT_VIEW, f, px, py, W, H);
      expect(next.scale).toBeCloseTo(f, 6);
      const after = worldAt(next, px, py);
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
    }
  });

  it('stops zooming at the largest and smallest scale', () => {
    expect(zoomAt(DEFAULT_VIEW, 1000, 300, 300, W, H).scale).toBe(MAX_SCALE);
    expect(zoomAt(DEFAULT_VIEW, 0.0001, 300, 300, W, H).scale).toBe(MIN_SCALE);
  });

  it('zooming out and back in at the same point returns to the start', () => {
    const out = zoomAt(DEFAULT_VIEW, 0.5, 300, 300, W, H);
    const back = zoomAt(out, 2, 300, 300, W, H);
    expect(back.scale).toBeCloseTo(1, 6);
    expect(back.x).toBeCloseTo(0, 6);
    expect(back.y).toBeCloseTo(0, 6);
  });

  it('cannot pan at scale 1 (the world fills the viewport exactly)', () => {
    expect(panBy(DEFAULT_VIEW, 120, -80, W, H)).toEqual(DEFAULT_VIEW);
  });

  it('pans a zoomed-in world, and stops at its edges', () => {
    const zoomed = { scale: 2, x: -300, y: -300 };
    const right = panBy(zoomed, 100, 50, W, H);
    expect(right.x).toBe(-200);
    expect(right.y).toBe(-250);
    expect(panBy(zoomed, 5000, 5000, W, H)).toEqual({ scale: 2, x: 0, y: 0 });
    expect(panBy(zoomed, -5000, -5000, W, H)).toEqual({ scale: 2, x: -600, y: -600 });
  });

  it('keeps a zoomed-out world inside the viewport', () => {
    const small = clampView({ scale: 0.5, x: -900, y: 900 }, W, H);
    expect(small.x).toBe(0);
    expect(small.y).toBe(300);
  });

  it('leaves the view alone while the viewport has no size yet', () => {
    const v = { scale: 2, x: -5000, y: 5000 };
    expect(clampView(v, 0, 0)).toEqual(v);
  });

  it('writes the view as a CSS transform', () => {
    expect(viewCss({ scale: 2, x: -300, y: -150.5 })).toBe('translate(-300px,-150.5px) scale(2)');
  });
});

describe('tech tree costs only when zoomed in (Bug 3)', () => {
  it('hides costs at the default overview zoom (scale 1) and further out so the tree is not cluttered', () => {
    expect(costsVisible(1)).toBe(false);
    expect(costsVisible(COST_MIN_SCALE - 0.01)).toBe(false);
    expect(costsVisible(MIN_SCALE)).toBe(false);
  });

  it('shows costs once the player zooms in to COST_MIN_SCALE or closer', () => {
    expect(costsVisible(COST_MIN_SCALE)).toBe(true);
    expect(costsVisible(MAX_SCALE)).toBe(true);
  });

  it('the threshold sits above the opening overview (scale 1) and within MAX_SCALE', () => {
    expect(COST_MIN_SCALE).toBeGreaterThan(1);
    expect(COST_MIN_SCALE).toBeLessThanOrEqual(MAX_SCALE);
  });
});
