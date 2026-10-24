// MODULE: base pieces (road, settlement, city) | USED BY: packs/base/index
import type { PackApi } from '../../shared';
import { CITY, ROAD, SETTLEMENT } from './constants';
import { canPlaceRoad, canPlaceSettlement, canUpgradeToCity } from './placement';

export function registerPieces(api: PackApi): void {
  api.piece({
    id: ROAD,
    name: 'Road',
    target: 'edge',
    cost: { wood: 1, brick: 1 },
    vp: 0,
    produces: 0,
    canPlace: canPlaceRoad
  });

  api.piece({
    id: SETTLEMENT,
    name: 'Settlement',
    target: 'vertex',
    cost: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
    vp: 1,
    produces: 1,
    canPlace: canPlaceSettlement
  });

  api.piece({
    id: CITY,
    name: 'City',
    target: 'vertex',
    cost: { wheat: 2, ore: 3 },
    vp: 2,
    produces: 2,
    upgradeFrom: SETTLEMENT,
    canPlace: canUpgradeToCity
  });
}
