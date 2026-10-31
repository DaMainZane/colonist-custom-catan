import { describe, expect, it } from 'vitest';
import { basePack } from '../src/packs';
import { OVERLAY_KINDS, createRegistry, defsOf, emptyManifest, registryFor } from '../src/shared';
import type { ActionDef, AddonDef, OverlayKindVisual, Pack, PieceDef, PieceVisual } from '../src/shared';

// R8.3: `visual` on PieceDef and ActionDef, and the OVERLAY_KINDS registry. Nothing reads them yet (the manifest is sent in R8.4),
// so these tests only check that defs with and without a `visual` both register, that the data is plain JSON, and that an addon that is off adds nothing.

const BEACON_VISUAL: PieceVisual = {
  slot: 'vertex',
  button: { label: 'Look', icon: 'net', order: 20 },
  hints: { noSupply: 'None left.', cannotAfford: 'Cannot pay.', noSpots: 'No spot.' },
  shape: '<path d="M-8,8 L0,-10 L8,8 Z" fill="{color}"/><rect x="-2" y="2" width="4" height="6" fill="{dark}"/>',
  rim: 3.4
};

const ACTION_VISUAL: PieceVisual = {
  slot: 'hex',
  spotKey: 'hexId',
  button: { label: 'Do', icon: 'fish', order: 30 },
  hints: { cannotAfford: 'Cannot pay.', noSpots: 'No spot.' }
};

const FLOOD_LIKE: OverlayKindVisual = {
  id: 'vtest_flood',
  label: 'Flooded',
  tint: { light: 'rgba(59,126,161,0.34)', dark: 'rgba(118,190,222,0.30)' },
  line: { light: 'rgba(33,92,140,0.85)', dark: 'rgba(168,222,245,0.9)' },
  pattern: '<path d="M0,5 Q2.5,2 5,5 T10,5" fill="none" stroke="currentColor"/>',
  pulse: true
};

const pieceWith: PieceDef = {
  id: 'vtest_with', name: 'With look', target: 'vertex', cost: { wood: 1 }, vp: 0, produces: 0,
  canPlace: () => false, visual: BEACON_VISUAL
};
const pieceWithout: PieceDef = {
  id: 'vtest_without', name: 'Without look', target: 'vertex', cost: { wood: 1 }, vp: 0, produces: 0,
  canPlace: () => false
};
const actionWith: ActionDef = {
  type: 'vtest_act_with', validate: () => null, apply: () => {}, visual: ACTION_VISUAL,
  price: () => ({ wheat: 1 }), available: () => true
};
const actionWithout: ActionDef = { type: 'vtest_act_without', validate: () => null, apply: () => {} };

const lookAddon: AddonDef = {
  id: 'vtest.look',
  name: 'Visual test',
  links: [
    { target: 'piece-cost', kind: 'mechanic' },
    { target: 'overlay', kind: 'ui' }
  ],
  register(api) {
    api.piece(pieceWith);
    api.piece(pieceWithout);
    api.action(actionWith);
    api.action(actionWithout);
    api.define(OVERLAY_KINDS, FLOOD_LIKE);
  }
};

const testPack: Pack = { id: 'vtest', name: 'Visual test', deps: ['base'], addons: [lookAddon], register() {} };
const packs = [basePack, testPack];

describe('visual on PieceDef, ActionDef and OVERLAY_KINDS (R8.3)', () => {
  it('registers defs with and without a visual', () => {
    const reg = registryFor(packs, { dlc: { vtest: true } });
    expect(reg.pieces.get('vtest_with')?.visual).toEqual(BEACON_VISUAL);
    expect(reg.pieces.has('vtest_without')).toBe(true);
    expect(reg.pieces.get('vtest_without')?.visual).toBeUndefined();
    expect(reg.actions.get('vtest_act_with')?.visual).toEqual(ACTION_VISUAL);
    expect(reg.actions.has('vtest_act_without')).toBe(true);
    expect(reg.actions.get('vtest_act_without')?.visual).toBeUndefined();
  });

  it('keeps the optional action hooks `price` and `available` on the def', () => {
    const reg = registryFor(packs, { dlc: { vtest: true } });
    const def = reg.actions.get('vtest_act_with')!;
    expect(def.price?.({} as any, reg, 'a')).toEqual({ wheat: 1 });
    expect(def.available?.({} as any, 'a')).toBe(true);
    expect(reg.actions.get('vtest_act_without')?.price).toBeUndefined();
  });

  it('registers overlay kinds in the keyed registry, and a duplicate id throws unless replace is set', () => {
    const reg = registryFor(packs, { dlc: { vtest: true } });
    expect(defsOf<OverlayKindVisual>(reg, OVERLAY_KINDS).get('vtest_flood')).toMatchObject({ label: 'Flooded', pulse: true });

    const dup: AddonDef = {
      ...lookAddon,
      register(api) {
        api.define(OVERLAY_KINDS, FLOOD_LIKE);
        api.define(OVERLAY_KINDS, FLOOD_LIKE);
      }
    };
    expect(() => createRegistry([basePack, { ...testPack, addons: [dup] }], {}, 'all')).toThrow(/duplicate/);

    const replaced: AddonDef = {
      ...lookAddon,
      register(api) {
        api.define(OVERLAY_KINDS, FLOOD_LIKE);
        api.define(OVERLAY_KINDS, { ...FLOOD_LIKE, label: 'Soaked', replace: true });
      }
    };
    const reg2 = createRegistry([basePack, { ...testPack, addons: [replaced] }], {}, 'all');
    expect(defsOf<OverlayKindVisual>(reg2, OVERLAY_KINDS).get('vtest_flood')?.label).toBe('Soaked');
  });

  it('registers nothing when the DLC or the addon is off', () => {
    for (const rules of [{}, { dlc: { vtest: false } }, { dlc: { vtest: true }, addons: { 'vtest.look': false } }]) {
      const reg = registryFor(packs, rules);
      expect(reg.pieces.has('vtest_with')).toBe(false);
      expect(reg.actions.has('vtest_act_with')).toBe(false);
      expect(defsOf(reg, OVERLAY_KINDS).size).toBe(0);
    }
  });

  it('is plain data: every visual and overlay kind survives a JSON round trip unchanged', () => {
    for (const v of [BEACON_VISUAL, ACTION_VISUAL, FLOOD_LIKE]) {
      expect(JSON.parse(JSON.stringify(v))).toEqual(v);
    }
    expect(JSON.parse(JSON.stringify(emptyManifest()))).toEqual({ version: 1, pieces: [], overlays: [] });
  });

  it('the base game and the shipped packs register no visual yet', () => {
    const reg = registryFor([basePack], {});
    for (const def of reg.pieces.values()) expect(def.visual).toBeUndefined();
    for (const def of reg.actions.values()) expect(def.visual).toBeUndefined();
    expect(defsOf(reg, OVERLAY_KINDS).size).toBe(0);
  });
});
