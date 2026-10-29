// MODULE: pack list entry point | USED BY: server, sims, tests
import type { Pack } from '../shared';
import { basePack } from './base';
import { fogPack } from './fog';
import { goldPack } from './gold';
import { tideboundPack } from './tidebound';

export { basePack, fogPack, goldPack, tideboundPack };

/** Every shipped pack in load order (base first, the others depend on it). */
export const allPacks: Pack[] = [basePack, goldPack, fogPack, tideboundPack];
