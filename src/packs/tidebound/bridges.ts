// MODULE: tidebound.bridges addon (the wide-water map perk now; the bridge piece itself arrives in T3) | USED BY: packs/tidebound
import type { AddonDef } from '../../shared';
import { applyElevation, placeFish } from './seaData';

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
    // T2a/T2b/T2b2/T2c, wide water. Data only: nothing runs during a game. The shape stage reads the `water.extra` param (see shared/mapshape.ts and
    // packs/base/map/shapes.ts) and grows the canvas around the normal map, so with this pick off the generator draws exactly what it drew before.
    // The same pick then writes the sea data later chunks read, with no RNG draws (see seaData.ts): `ext.elevation` 1 to 3 on land by ranked height
    // (higher is rarer) and `ext.fish` on seeded sea tiles.
    api.mapPerk({
      id: 'wide_water',
      label: 'Wide water',
      description: 'Seas and rivers several tiles wider. The board grows around the normal map to make room, so the land count stays the same. Land gets an elevation (1 to 3) and some sea tiles hold fish; both are used by later Tidebound features.',
      stage: 'extras',
      // The default hexagon has no sea to widen, so with this pick the map sits on a continent instead (same as the ragged coast).
      conflicts: ['hexagon'],
      params: [{ id: 'water.extra', label: 'Extra water width (tiles)', min: 1, max: 5, step: 1, default: 4 }],
      afterGenerated(inits, ctx, cells) {
        applyElevation(inits, cells);
        placeFish(inits, ctx);
      }
    });
  }
  // register() later: T3 (piece, placement rule, cost, Longest Road, build UI, bot builds)
};
