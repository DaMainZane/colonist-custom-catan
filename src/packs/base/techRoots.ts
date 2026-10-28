// MODULE: the 5 root techs of the tech tree (one per DLC branch, base-tier so they never need their DLC) and their effects | USED BY: packs/base/index, tests
import { TECH_DEFS } from '../../shared';
import type { PackApi, TechDef } from '../../shared';
import { registerTechEffects } from './techEffects';

/**
 * The roots from Tech Tree Design.md, section 3, in build order (Tidebound, Bulwark, Warlords, Wild Earth, Guildhall).
 * They carry no `dlc` and no `prereq`, so they are researchable with their DLC off. Offsets are placeholders for the sim matrix.
 * Each tech's effect lives in `techEffects.ts` (a modifier on an existing registry, or the action in `actions/techActions.ts`)
 * and checks `hasTech` first, so a game where nobody researched it is unchanged.
 */
export const TECH_ROOTS: TechDef[] = [
  {
    id: 'tidebound.harbor_charters',
    name: 'Harbor charters',
    branch: 'tidebound',
    tier: 1,
    costOffset: 0,
    description: 'Upgrade a city on a 3:1 port so one resource of your choice trades 2:1 there (2 wood, 1 brick, 1 ore).'
  },
  {
    id: 'bulwark.stockpiling',
    name: 'Stockpiling',
    branch: 'bulwark',
    tier: 1,
    costOffset: 0,
    description: 'Your discard limit is 2 higher.'
  },
  {
    id: 'warlords.plunder',
    name: 'Plunder',
    branch: 'warlords',
    tier: 1,
    costOffset: 1,
    description: 'When you play a knight, the steal takes 1 extra card.'
  },
  {
    id: 'wildearth.ground_work',
    name: 'Ground work',
    branch: 'wildearth',
    tier: 1,
    costOffset: 2,
    description: 'Once: turn a land tile next to your settlement or city into a basic resource tile of your choice.'
  },
  {
    id: 'guildhall.road_levy',
    name: 'Road levy',
    branch: 'guildhall',
    tier: 1,
    costOffset: 0,
    description: 'Roads past the road cap (2x price) cost 1 less brick or wood.'
  }
];

/** Registers the roots and their effects. Later nodes are added by their DLC pack with `api.define(TECH_DEFS, ...)`, never here. */
export function registerTechRoots(api: PackApi): void {
  for (const def of TECH_ROOTS) api.define(TECH_DEFS, def);
  registerTechEffects(api);
}
