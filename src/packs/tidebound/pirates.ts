// MODULE: tidebound.pirates addon stub (roaming sea raiders beaten with knights; content arrives in T10) | USED BY: packs/tidebound
import type { AddonDef } from '../../shared';

export const piratesAddon: AddonDef = {
  id: 'tidebound.pirates',
  name: 'Pirates',
  description: 'Up to 2 pirates roam the ocean and rob coastal settlements. Beating one takes knights, and it pays more than a wreck.',
  links: [
    { target: 'strength', kind: 'mechanic' },
    { target: 'marker', kind: 'mechanic' },
    { target: 'bot-goals', kind: 'bot' },
    { target: 'tidebound.wrecks', kind: 'content' }
  ]
  // register(): T10 (marker, random move, strength growth, knights to drive off, rob 2x, flee mode)
};
