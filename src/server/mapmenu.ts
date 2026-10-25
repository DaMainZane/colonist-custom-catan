// MODULE: map menu data (the registry's map options and quick starts as plain JSON for the lobby dropdown) | USED BY: server/socket, tests
// The client draws the whole map menu from this list, so a pack that registers a shape, style or perk shows up
// with no client change (design section 12, "What the server sends").
import { allMapOptions } from '../shared';
import type { MapOptionStage, ParamDef } from '../shared';
import { registry } from './runtime';

export interface MapOptionView {
  id: string;
  label: string;
  description: string;
  stage: MapOptionStage;
  /** Shape ops only: tweak, base, carve or scatter. */
  phase?: string;
  /** Options in the same slot replace each other. */
  slot?: string;
  /** Used when its slot is empty. */
  default: boolean;
  conflicts: string[];
  requires: string[];
  /** Every capability in `requires` is registered. An unmet option is shown greyed and the server refuses it. */
  met: boolean;
  /** The seed and share code reveal hidden information (fog). */
  secret: boolean;
  params: ParamDef[];
}

export interface QuickStartView {
  id: string;
  label: string;
  /** The all-water canvas for the painter. */
  blank: boolean;
}

export interface MapOptionsView {
  options: MapOptionView[];
  quickStarts: QuickStartView[];
}

/** Every registered option (shapes first, then terrain, numbers, perks) and every quick start, as plain data. */
export function mapOptionsView(): MapOptionsView {
  const options: MapOptionView[] = allMapOptions(registry).map(o => ({
    id: o.id,
    label: o.label,
    description: o.description ?? '',
    stage: o.stage,
    phase: o.stage === 'shape' ? o.phase : undefined,
    slot: o.slot,
    default: !!o.default,
    conflicts: [...(o.conflicts ?? [])],
    requires: [...(o.requires ?? [])],
    met: (o.requires ?? []).every(c => registry.capabilities.has(c)),
    secret: !!o.secret,
    params: (o.params ?? []).map(p => ({ id: p.id, label: p.label, min: p.min, max: p.max, step: p.step, default: p.default }))
  }));
  const quickStarts: QuickStartView[] = [...registry.quickStarts.values()].map(q => ({ id: q.id, label: q.label, blank: !!q.blank }));
  return { options, quickStarts };
}
