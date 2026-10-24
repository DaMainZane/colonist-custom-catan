// MODULE: ids and small maps shared inside the base pack | USED BY: packs/base files, packs/gold, packs/fog
export const ROAD = 'road';
export const SETTLEMENT = 'settlement';
export const CITY = 'city';

/** Port id of the generic 3:1 port. Resource ports use the resource id. */
export const GENERIC_PORT = '3:1';

/** During setup, the only piece that may be placed in each phase. */
export const SETUP_PIECE: Record<string, string> = {
  setup_settlement: SETTLEMENT,
  setup_road: ROAD
};
