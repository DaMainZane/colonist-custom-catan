// MODULE: tidebound.rickety_bridges addon stub (1-wood bridge that collapses on a 7; content arrives in T4) | USED BY: packs/tidebound
import type { AddonDef } from '../../shared';

export const ricketyBridgesAddon: AddonDef = {
  id: 'tidebound.rickety_bridges',
  name: 'Rickety bridges',
  description: 'A cheap bridge with 1 health that collapses on a 7. Upgrade it to a full bridge later.',
  deps: ['tidebound.bridges'],
  links: [
    { target: 'durability', kind: 'mechanic' },
    { target: 'seven-resolver', kind: 'mechanic' },
    { target: 'overlay', kind: 'ui' },
    { target: 'tidebound.bridges', kind: 'content' }
  ]
  // register(): T4 (piece, shared pool, upgrade, type picker, collapse on a 7, Longest Road recalc, animation)
};
