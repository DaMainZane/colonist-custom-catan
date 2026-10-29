// MODULE: tidebound.tides addon stub (flooding coast tiles on a seeded schedule; content arrives in T5 and T6) | USED BY: packs/tidebound
import type { AddonDef } from '../../shared';

export const tidesAddon: AddonDef = {
  id: 'tidebound.tides',
  name: 'Tides',
  description: 'Coast tiles flood on a seeded schedule and produce nothing while flooded. Higher ground resists.',
  links: [
    { target: 'round-clock', kind: 'mechanic' },
    { target: 'tile-state', kind: 'mechanic' },
    { target: 'production', kind: 'mechanic' },
    { target: 'overlay', kind: 'ui' }
  ]
  // register(): T5 (flooded state, schedule, spring tide, settings, elevation resistance, ports idle), T6 (warnings, title card, heat map)
};
