// MODULE: base resources and tiles (wood, brick, sheep, wheat, ore, desert, water) | DEPENDS ON: shared/index | USED BY: packs/base/index
import type { Habitat, PackApi } from '../../shared';

const RESOURCES = [
  { id: 'wood', name: 'Wood', color: '#119b18', border: '#0c7511' },
  { id: 'brick', name: 'Brick', color: '#f04716', border: '#bd320b' },
  { id: 'sheep', name: 'Sheep', color: '#6ec914', border: '#52990d' },
  { id: 'wheat', name: 'Wheat', color: '#fff59d', border: '#d4c028' },
  { id: 'ore', name: 'Ore', color: '#9da9b0', border: '#74828a' }
];

/** Order the base tiles fill the board with (cyclic), same as the original game. */
const BASE_TILE_ORDER = ['wood', 'wheat', 'sheep', 'brick', 'ore'];

/** Where each tile sits for the `realistic` terrain style (Map Generation Design, section 7). */
const HABITAT: Record<string, Habitat> = {
  ore: { h: 0.9, weight: 2 },
  brick: { h: 0.65, m: 0.35, weight: 1.5 },
  wood: { h: 0.5, m: 0.8, weight: 1.2 },
  sheep: { h: 0.35, m: 0.5 },
  wheat: { h: 0.25, m: 0.3 }
};

export function registerResourcesAndTiles(api: PackApi): void {
  for (const r of RESOURCES) api.resource(r);

  for (const id of BASE_TILE_ORDER) {
    const r = RESOURCES.find(x => x.id === id)!;
    api.tile({
      id,
      name: r.name,
      color: r.color,
      border: r.border,
      land: true,
      numbered: true,
      produces: id,
      base: true,
      habitat: HABITAT[id]
    });
  }

  // The driest cells, far from the coast: the habitat fills it first.
  api.tile({ id: 'desert', name: 'Desert', color: '#d4c890', border: '#b3a56b', land: true, numbered: false, habitat: { m: 0, weight: 3 } });
  api.tile({ id: 'water', name: 'Water', color: '#4a90c2', border: '#2f6f9f', land: false, numbered: false });
}
