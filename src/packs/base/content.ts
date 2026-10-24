// MODULE: base resources and tiles (wood, brick, sheep, wheat, ore, desert, water) | USED BY: packs/base/index
import type { PackApi } from '../../shared';

const RESOURCES = [
  { id: 'wood', name: 'Wood', color: '#119b18', border: '#0c7511' },
  { id: 'brick', name: 'Brick', color: '#f04716', border: '#bd320b' },
  { id: 'sheep', name: 'Sheep', color: '#6ec914', border: '#52990d' },
  { id: 'wheat', name: 'Wheat', color: '#fff59d', border: '#d4c028' },
  { id: 'ore', name: 'Ore', color: '#9da9b0', border: '#74828a' }
];

/** Order the base tiles fill the board with (cyclic), same as the original game. */
const BASE_TILE_ORDER = ['wood', 'wheat', 'sheep', 'brick', 'ore'];

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
      base: true
    });
  }

  api.tile({ id: 'desert', name: 'Desert', color: '#d4c890', border: '#b3a56b', land: true, numbered: false });
  api.tile({ id: 'water', name: 'Water', color: '#4a90c2', border: '#2f6f9f', land: false, numbered: false });
}
