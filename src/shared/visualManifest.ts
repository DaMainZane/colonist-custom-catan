// MODULE: builds the visual manifest from a registry (pieces, actions and overlay kinds with a visual) and checks visuals for unsafe markup and non-JSON values | DEPENDS ON: shared/registry, shared/visual | USED BY: shared/index
import { defsOf } from './registry';
import type { Registry } from './registry';
import { OVERLAY_KINDS } from './visual';
import type { ManifestEntry, OverlayKindVisual, PieceVisual, VisualManifest } from './visual';

const DEFAULT_ORDER = 100;

function byText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A deep copy that is plain JSON (drops functions and undefined), so the manifest never shares objects with a def. */
function copyPlain<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/**
 * The manifest for one registry: every piece and action that has a `visual`, plus every overlay kind, in a stable order (`button.order`, then id).
 * It depends only on the registered content, so it is the same for every player in a game. Empty when no def has a visual.
 */
export function buildVisualManifest(reg: Registry): VisualManifest {
  const pieces: ManifestEntry[] = [];
  for (const def of reg.pieces.values()) {
    if (def.visual) pieces.push({ ...copyPlain(def.visual), id: def.id, kind: 'piece' });
  }
  for (const def of reg.actions.values()) {
    if (def.visual) pieces.push({ ...copyPlain(def.visual), id: def.type, kind: 'action' });
  }
  pieces.sort((a, b) => (a.button.order ?? DEFAULT_ORDER) - (b.button.order ?? DEFAULT_ORDER) || byText(a.id, b.id));

  const overlays: OverlayKindVisual[] = [...defsOf<OverlayKindVisual>(reg, OVERLAY_KINDS).values()]
    .map(d => {
      const { replace: _replace, ...rest } = copyPlain(d);
      return rest;
    })
    .sort((a, b) => byText(a.id, b.id));

  return { version: 1, pieces, overlays };
}

// ---- Checks ------------------------------------------------------------------------------------------------------

const PLACEHOLDERS = /\{(color|dark)\}/g;

/** Problems in a string of SVG that the client will put into the page. Only `{color}` and `{dark}` may use braces. */
function markupProblems(label: string, s: string): string[] {
  const out: string[] = [];
  if (/<\s*script/i.test(s)) out.push(`${label}: contains a script tag`);
  if (/<\s*foreignObject/i.test(s)) out.push(`${label}: contains foreignObject`);
  if (/\son[a-z]+\s*=/i.test(s)) out.push(`${label}: contains an event attribute`);
  if (/javascript:/i.test(s)) out.push(`${label}: contains a javascript: url`);
  if (/[{}]/.test(s.replace(PLACEHOLDERS, ''))) out.push(`${label}: contains { or } outside {color} and {dark}`);
  return out;
}

function cssProblems(label: string, s: string): string[] {
  const out: string[] = [];
  if (/<\s*\/?\s*style/i.test(s)) out.push(`${label}: contains a style tag`);
  if (/@import/i.test(s)) out.push(`${label}: contains @import`);
  if (/expression\s*\(/i.test(s)) out.push(`${label}: contains expression()`);
  if (/javascript:/i.test(s)) out.push(`${label}: contains a javascript: url`);
  return out;
}

/** The path of the first value that JSON cannot carry (a function, a symbol, a bigint, a non-finite number), or null. */
function nonJsonPath(v: unknown, path: string): string | null {
  if (typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint') return path;
  if (typeof v === 'number' && !Number.isFinite(v)) return path;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const hit = nonJsonPath(v[i], `${path}[${i}]`);
      if (hit) return hit;
    }
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      const hit = nonJsonPath(x, `${path}.${k}`);
      if (hit) return hit;
    }
  }
  return null;
}

/** Problems in one piece or action visual. `label` names it in the messages. Empty array = fine. */
export function visualProblems(label: string, v: PieceVisual): string[] {
  const out: string[] = [];
  const bad = nonJsonPath(v, label);
  if (bad) out.push(`${bad}: not plain JSON`);
  if (v.shape !== undefined) out.push(...markupProblems(`${label}.shape`, String(v.shape)));
  if (v.spot !== undefined) out.push(...markupProblems(`${label}.spot`, String(v.spot)));
  if (v.css !== undefined) out.push(...cssProblems(`${label}.css`, String(v.css)));
  const icon = v.button?.icon;
  if (typeof icon === 'string' && icon.startsWith('<')) out.push(...markupProblems(`${label}.button.icon`, icon));
  if (!v.button || !String(v.button.label ?? '').trim()) out.push(`${label}: button.label is empty`);
  if (!v.button || !String(v.button.icon ?? '').trim()) out.push(`${label}: button.icon is empty`);
  if (v.button?.order !== undefined && !Number.isFinite(v.button.order)) out.push(`${label}: button.order is not a number`);
  if (!v.hints || !String(v.hints.cannotAfford ?? '').trim()) out.push(`${label}: hints.cannotAfford is empty`);
  if (!v.hints || !String(v.hints.noSpots ?? '').trim()) out.push(`${label}: hints.noSpots is empty`);
  if (v.rim !== undefined && !(Number.isFinite(v.rim) && v.rim >= 0)) out.push(`${label}: rim is not a number of 0 or more`);
  return out;
}

/** Problems in one overlay kind: it needs a label and a pattern (colourblind rule), and its markup must be safe. */
export function overlayProblems(o: OverlayKindVisual): string[] {
  const label = `overlay ${o.id}`;
  const out: string[] = [];
  const bad = nonJsonPath(o, label);
  if (bad) out.push(`${bad}: not plain JSON`);
  if (!String(o.label ?? '').trim()) out.push(`${label}: label is empty`);
  if (!String(o.pattern ?? '').trim()) out.push(`${label}: pattern is empty (a tint alone fails the colourblind rule)`);
  else out.push(...markupProblems(`${label}.pattern`, o.pattern));
  for (const part of ['tint', 'line'] as const) {
    const c = o[part];
    if (!c || !String(c.light ?? '').trim() || !String(c.dark ?? '').trim()) out.push(`${label}: ${part} needs light and dark colours`);
  }
  if (typeof o.icon === 'string' && o.icon.startsWith('<')) out.push(...markupProblems(`${label}.icon`, o.icon));
  return out;
}

/** Problems across a whole manifest: each entry, duplicate ids, a piece without a shape, an action without `spotKey`, a group that mixes slots. */
export function manifestProblems(m: VisualManifest): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const groupSlot = new Map<string, string>();
  for (const e of m.pieces) {
    const label = `${e.kind} ${e.id}`;
    out.push(...visualProblems(label, e));
    if (seen.has(e.id)) out.push(`${label}: duplicate id in the manifest`);
    seen.add(e.id);
    if (e.kind === 'piece' && !String(e.shape ?? '').trim()) out.push(`${label}: a piece needs a shape`);
    if (e.kind === 'action' && !String(e.spotKey ?? '').trim()) out.push(`${label}: an action needs spotKey`);
    const group = e.button?.group;
    if (group) {
      const prior = groupSlot.get(group);
      if (prior !== undefined && prior !== e.slot) out.push(`${label}: group "${group}" mixes slots "${prior}" and "${e.slot}"`);
      groupSlot.set(group, e.slot);
    }
  }
  const overlayIds = new Set<string>();
  for (const o of m.overlays) {
    out.push(...overlayProblems(o));
    if (overlayIds.has(o.id)) out.push(`overlay ${o.id}: duplicate id in the manifest`);
    overlayIds.add(o.id);
  }
  return out;
}

/**
 * Everything wrong with the visuals registered in `reg`: the checks on each def's own visual (this still sees a function the manifest copy would drop)
 * plus the checks on the built manifest. A test runs this on every shipped registry, so a bad visual fails `npm test`, not the player's browser.
 */
export function registryVisualProblems(reg: Registry): string[] {
  const out: string[] = [];
  for (const def of reg.pieces.values()) if (def.visual) out.push(...visualProblems(`piece ${def.id}`, def.visual));
  for (const def of reg.actions.values()) if (def.visual) out.push(...visualProblems(`action ${def.type}`, def.visual));
  for (const def of defsOf<OverlayKindVisual>(reg, OVERLAY_KINDS).values()) out.push(...overlayProblems(def));
  out.push(...manifestProblems(buildVisualManifest(reg)));
  return out;
}
