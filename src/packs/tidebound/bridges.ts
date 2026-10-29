// MODULE: tidebound.bridges addon (the wide-water map perk now; the bridge piece itself arrives in T3) | USED BY: packs/tidebound
import type { AddonDef } from '../../shared';

export const bridgesAddon: AddonDef = {
  id: 'tidebound.bridges',
  name: 'Bridges',
  description: 'Roads across the sea. Both ends must touch ocean; they count toward Longest Road.',
  links: [
    { target: 'piece-cost', kind: 'mechanic' },
    { target: 'history', kind: 'mechanic' },
    { target: 'bot-goals', kind: 'bot' }
  ],
  register(api) {
    // T2a/T2b, wide water. Data only: nothing runs during a game. The shape stage reads the `water.extra` param (see shared/mapshape.ts and
    // packs/base/map/shapes.ts) and grows the canvas around the normal map, so with this pick off the generator draws exactly what it drew before.
    api.mapPerk({
      id: 'wide_water',
      label: 'Wide water',
      description: 'Seas and rivers several tiles wider. The board grows around the normal map to make room, so the land count stays the same.',
      stage: 'extras',
      // The default hexagon has no sea to widen, so with this pick the map sits on a continent instead (same as the ragged coast).
      conflicts: ['hexagon'],
      params: [{ id: 'water.extra', label: 'Extra water width (tiles)', min: 1, max: 5, step: 1, default: 4 }]
    });
  }
  // register() later: T3 (piece, placement rule, cost, Longest Road, build UI, bot builds)
};
