// MODULE: tidebound.harbor addon stub (1:1 port upgrade, one per player; content arrives in T8) | USED BY: packs/tidebound
import type { AddonDef } from '../../shared';

export const harborAddon: AddonDef = {
  id: 'tidebound.harbor',
  name: 'Harbor',
  description: 'Upgrade a port to a harbor for 1:1 trades. One per player, and it keeps working while flooded.',
  links: [
    { target: 'trade-ratio', kind: 'mechanic' },
    { target: 'piece-cost', kind: 'mechanic' },
    { target: 'tidebound.tides', kind: 'mechanic' }
  ]
  // register(): T8 (1:1 upgrade, limit 1, works while flooded, max 4 trades per turn, invalid-ratio prompt)
};
