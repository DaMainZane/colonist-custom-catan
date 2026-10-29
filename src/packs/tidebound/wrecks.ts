// MODULE: tidebound.wrecks addon stub (storm event leaves salvage markers; content arrives in T9) | USED BY: packs/tidebound
import type { AddonDef } from '../../shared';

export const wrecksAddon: AddonDef = {
  id: 'tidebound.wrecks',
  name: 'Shipwreck salvage',
  description: 'A storm leaves a wreck at sea or on the shore. The first road, bridge or port to reach it claims the loot.',
  links: [
    { target: 'marker', kind: 'mechanic' },
    { target: 'event-deck', kind: 'content' },
    { target: 'overlay', kind: 'ui' },
    { target: 'tidebound.bridges', kind: 'mechanic' }
  ]
  // register(): T9 (storm event, wreck marker, 65/35 placement, claim rule, loot, spawn animations)
};
