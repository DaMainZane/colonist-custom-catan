// MODULE: base terrain styles (spread, clustered, realistic; `random` lives in index.ts) | USED BY: packs/base/map
import { habitatPlace, swapPlace } from '../../../shared';
import type { PackApi } from '../../../shared';

/** Spread and clustered are one swap-energy algorithm with opposite signs. Strength is the number of sweeps (0 = plain random). */
export function registerTerrains(api: PackApi): void {
  api.mapTerrain({
    id: 'spread',
    label: 'Spread',
    description: 'Tiles of one type avoid each other: no big patches.',
    stage: 'terrain',
    slot: 'terrain',
    params: [{ id: 'spread.strength', label: 'Strength (sweeps, 0 = random)', min: 0, max: 30, step: 1, default: 8 }],
    place: (cells, types, ctx) => swapPlace(cells, types, ctx.rng, -1, ctx.param('spread.strength'))
  });

  api.mapTerrain({
    id: 'clustered',
    label: 'Clustered',
    description: 'Tiles of one type group into patches.',
    stage: 'terrain',
    slot: 'terrain',
    params: [{ id: 'clustered.strength', label: 'Strength (sweeps, 0 = random)', min: 0, max: 40, step: 1, default: 12 }],
    place: (cells, types, ctx) => swapPlace(cells, types, ctx.rng, 1, ctx.param('clustered.strength'))
  });

  api.mapTerrain({
    id: 'realistic',
    label: 'Realistic',
    description: 'Mountains with ore, hills and forests around them, dry plains and the desert far from the sea.',
    stage: 'terrain',
    slot: 'terrain',
    params: [{ id: 'realistic.sweeps', label: 'Fine-tuning sweeps', min: 0, max: 10, step: 1, default: 3 }],
    // The habitat of each tile comes from its TileDef, so a pack's own tile is placed sensibly with no change here.
    place: (cells, types, ctx) => habitatPlace(cells, types, t => ctx.reg.tiles.get(t)?.habitat, ctx.rng, ctx.param('realistic.sweeps'))
  });
}
