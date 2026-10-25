// MODULE: base map content (hexagon shape, random terrain, standard numbers, Standard and Blank quick starts) | USED BY: packs/base/index
import { assignNumbers, rngShuffle } from '../../../shared';
import type { PackApi } from '../../../shared';
import { registerShapes } from './shapes';

/** The classic board as a recipe (the defaults of every slot), plus the M3 shapes. Terrain and number styles arrive in M4. */
export function registerMapContent(api: PackApi): void {
  api.mapShape({
    id: 'hexagon',
    label: 'Hexagon',
    description: 'The whole canvas is land: the classic board.',
    stage: 'shape',
    phase: 'base',
    slot: 'shape',
    default: true
  });

  registerShapes(api);

  api.mapTerrain({
    id: 'random',
    label: 'Random',
    description: 'Tiles are shuffled over the land.',
    stage: 'terrain',
    slot: 'terrain',
    default: true,
    place: (_cells, types, ctx) => rngShuffle(ctx.rng, types)
  });

  api.mapNumbers({
    id: 'standard',
    label: 'Standard',
    description: 'Shuffled tokens, no touching 6 and 8, equal numbers kept apart where possible.',
    stage: 'numbers',
    slot: 'numbers',
    default: true,
    place: (cells, pool, ctx) => assignNumbers(cells, pool, ctx.rng)
  });

  api.quickStart({ id: 'standard', label: 'Standard', picks: [] });
  // Replaces the old water-chance Archipelago preset chip: a real shape with exact land and connected islands.
  api.quickStart({ id: 'archipelago', label: 'Archipelago', picks: ['archipelago'] });
  // Blank stays special: an all-water canvas for the painter. It is not a shape (it breaks the land minimum).
  api.quickStart({ id: 'blank', label: 'Blank (all water)', blank: true, picks: [] });
}
