// MODULE: tidebound.rising_sea addon stub (tiles drown lowest elevation first; content arrives in T12) | DEPENDS ON: shared/index | USED BY: packs/tidebound/index
import type { AddonDef } from '../../shared';

export const risingSeaAddon: AddonDef = {
  id: 'tidebound.rising_sea',
  name: 'Rising sea',
  description: 'Land drowns from the lowest ground up. Bridges become the only roads. Works alone or with Tides.',
  links: [
    { target: 'tile-state', kind: 'mechanic' },
    { target: 'round-clock', kind: 'mechanic' },
    { target: 'tidebound.tides', kind: 'content' }
  ]
  // register(): T12 (drown lowest elevation first, optional with Tides, settings)
};
