// MODULE: tidebound.fishing addon stub (fish wild token, nets, fish icons; content arrives in T7) | USED BY: packs/tidebound
import type { AddonDef } from '../../shared';

export const fishingAddon: AddonDef = {
  id: 'tidebound.fishing',
  name: 'Fishing',
  description: 'Nets on the coast catch fish, a token that counts as any one resource. Fish icons on the sea boost the catch.',
  links: [
    { target: 'wild-token', kind: 'mechanic' },
    { target: 'marker', kind: 'mechanic' },
    { target: 'piece-cost', kind: 'mechanic' },
    { target: 'tidebound.tides', kind: 'content' }
  ]
  // register(): T7 (fish token, nets, icon boosts, tide replenish, feed the sea)
};
