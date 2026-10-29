// MODULE: tidebound.bridges addon stub (water road; content arrives in T3) | USED BY: packs/tidebound
import type { AddonDef } from '../../shared';

export const bridgesAddon: AddonDef = {
  id: 'tidebound.bridges',
  name: 'Bridges',
  description: 'Roads across the sea. Both ends must touch ocean; they count toward Longest Road.',
  links: [
    { target: 'piece-cost', kind: 'mechanic' },
    { target: 'history', kind: 'mechanic' },
    { target: 'bot-goals', kind: 'bot' }
  ]
  // register(): T3 (piece, placement rule, cost, Longest Road, build UI, bot builds)
};
