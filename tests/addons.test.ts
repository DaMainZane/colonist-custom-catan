import { describe, expect, it } from 'vitest';
import { allPacks } from '../src/packs';
import {
  addonOn, auditAddons, createGame, createRegistry, defsOf, registryFor, resolveAddons, GENERAL_SERVICE_IDS
} from '../src/shared';
import type { AddonDef, Pack } from '../src/shared';

/** A test-only DLC with two addons, the second needing the first. Real DLCs arrive in later stages. */
function fixtureDlc(over: Partial<AddonDef>[] = []): Pack {
  const bridges: AddonDef = {
    id: 'fix.bridges',
    name: 'Bridges',
    links: [{ target: 'piece-cost', kind: 'mechanic' }, { target: 'overlay', kind: 'ui' }],
    rules: { fixBridgeBase: 10 },
    register(api) {
      api.tile({ id: 'fixSea', name: 'Fix sea', color: '#00f', border: '#008', land: false, numbered: false });
      api.define('events', { id: 'fix.storm', name: 'Storm' });
      api.hook('onTurnStart', ctx => { ctx.g.ext.fixTurns = (ctx.g.ext.fixTurns || 0) + 1; });
    },
    ...(over[0] ?? {})
  };
  const tides: AddonDef = {
    id: 'fix.tides',
    name: 'Tides',
    deps: ['fix.bridges'],
    links: [{ target: 'round-clock', kind: 'mechanic' }, { target: 'fix.bridges', kind: 'content' }],
    rules: { fixTideEvery: 2 },
    register(api) { api.define('events', { id: 'fix.tide', name: 'Tide' }); },
    ...(over[1] ?? {})
  };
  return { id: 'fix', name: 'Fixture DLC', deps: ['base'], addons: [bridges, tides], register() {} };
}

const packs = (...extra: Pack[]): Pack[] => [...allPacks, ...extra];
const on = { dlc: { fix: true } };

describe('addon manifest and enabled sets', () => {
  it('lists every addon in the catalog but registers no addon content by default', () => {
    const reg = createRegistry(packs(fixtureDlc()));
    expect([...reg.addons.keys()]).toEqual(['fix.bridges', 'fix.tides']);
    expect(reg.dlcs.get('fix')).toEqual({ id: 'fix', name: 'Fixture DLC', addons: ['fix.bridges', 'fix.tides'] });
    expect(reg.addons.get('fix.tides')?.deps).toEqual(['fix.bridges']);
    expect(reg.enabled.size).toBe(0);
    expect(reg.tiles.has('fixSea')).toBe(false);
    expect(defsOf(reg, 'events').size).toBe(0);
    expect(reg.rules.fixBridgeBase).toBeUndefined();
  });

  it('registers content, rules, keyed definitions and hooks for the enabled addons', () => {
    const reg = registryFor(packs(fixtureDlc()), on);
    expect([...reg.enabled]).toEqual(['fix.bridges', 'fix.tides']);
    expect(addonOn(reg, 'fix.tides')).toBe(true);
    expect(reg.tiles.has('fixSea')).toBe(true);
    expect([...defsOf(reg, 'events').keys()]).toEqual(['fix.storm', 'fix.tide']);
    expect(reg.rules.fixBridgeBase).toBe(10);
    expect(reg.rules.fixTideEvery).toBe(2);
    expect(reg.hooks.onTurnStart.length).toBe(createRegistry(allPacks).hooks.onTurnStart.length + 1);
  });

  it('the DLC master switch is off by default and wins over individual addon flags', () => {
    expect(registryFor(packs(fixtureDlc()), {}).enabled.size).toBe(0);
    expect(registryFor(packs(fixtureDlc()), { dlc: { fix: false }, addons: { 'fix.bridges': true } }).enabled.size).toBe(0);
  });

  it('an addon can be switched off inside an enabled DLC, and its dependants are blocked', () => {
    const p = packs(fixtureDlc());
    expect([...registryFor(p, { ...on, addons: { 'fix.tides': false } }).enabled]).toEqual(['fix.bridges']);

    const res = resolveAddons(p, { ...on, addons: { 'fix.bridges': false } });
    expect(res.enabled.size).toBe(0);
    expect(res.blocked).toEqual([{ addon: 'fix.tides', missing: ['fix.bridges'] }]);
  });

  it('refuses a bad manifest at load time', () => {
    const wrongPrefix = fixtureDlc([{ id: 'other.bridges' }]);
    expect(() => createRegistry(packs(wrongPrefix))).toThrow(/must start with "fix\."/);

    const dup = fixtureDlc([{}, { id: 'fix.bridges' }]);
    expect(() => createRegistry(packs(dup))).toThrow(/duplicate addon/);

    const later = fixtureDlc([{ deps: ['fix.tides'] }]);
    expect(() => createRegistry(packs(later))).toThrow(/declared before it/);

    expect(() => createRegistry(packs(fixtureDlc()), {}, new Set(['fix.tides']))).toThrow(/dependency "fix.bridges" is not/);
  });

  it('"all" registers every addon', () => {
    expect(createRegistry(packs(fixtureDlc()), {}, 'all').enabled.size).toBe(2);
  });
});

describe('keyed registries (api.define)', () => {
  const defPack = (...ids: { id: string; replace?: boolean }[]): Pack => ({
    id: 'defs', name: 'Defs', deps: ['base'], register(api) { for (const d of ids) api.define('events', d); }
  });

  it('throws on a duplicate id, and replace: true overrides it', () => {
    expect(() => createRegistry(packs(defPack({ id: 'a' }, { id: 'a' })))).toThrow(/duplicate events "a"/);
    const reg = createRegistry(packs(defPack({ id: 'a' }, { id: 'a', replace: true })));
    expect(defsOf(reg, 'events').size).toBe(1);
  });

  it('kinds are separate namespaces', () => {
    const p: Pack = { id: 'two', name: 'Two', deps: ['base'], register(api) { api.define('events', { id: 'x' }); api.define('techs', { id: 'x' }); } };
    const reg = createRegistry(packs(p));
    expect(defsOf(reg, 'events').has('x') && defsOf(reg, 'techs').has('x')).toBe(true);
  });
});

describe('a DLC that is off changes nothing', () => {
  it('gives the same new game as a registry without the DLC', () => {
    const cfg = { players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], seed: 42, shuffleSeats: false };
    const strip = (g: any) => { const { packs: _p, ...rest } = g; return JSON.stringify(rest); };
    const plain = createGame(createRegistry(allPacks), cfg);
    const withDlcOff = createGame(registryFor(packs(fixtureDlc()), {}), cfg);
    expect(strip(withDlcOff)).toBe(strip(plain));
  });

  it('the same DLC turned on does register, so the switch is real', () => {
    const reg = registryFor(packs(fixtureDlc()), on);
    const g = createGame(reg, { players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], seed: 1, shuffleSeats: false, rules: on });
    expect(g.rules.dlc).toEqual({ fix: true });
    expect(g.rules.fixBridgeBase).toBe(10);
  });
});

describe('Rule of Two audit', () => {
  it('the shipped packs pass', () => {
    expect(auditAddons(allPacks)).toEqual([]);
  });

  it('the fixture DLC passes', () => {
    expect(auditAddons(packs(fixtureDlc()))).toEqual([]);
  });

  it('knows the 20 General services', () => {
    expect(new Set(GENERAL_SERVICE_IDS).size).toBe(20);
  });

  const problems = (over: Partial<AddonDef>[], pack: Partial<Pack> = {}) =>
    auditAddons(packs({ ...fixtureDlc(over), ...pack }));

  it('flags an addon with fewer than two distinct links', () => {
    expect(problems([{ links: [{ target: 'overlay', kind: 'ui' }] }]).join('\n')).toMatch(/1 distinct link/);
    expect(problems([{ links: [{ target: 'overlay', kind: 'ui' }, { target: 'overlay', kind: 'ui' }] }]).join('\n')).toMatch(/1 distinct link/);
  });

  it('flags an addon with no link to a General service', () => {
    const out = problems([{}, { links: [{ target: 'fix.bridges', kind: 'content' }, { target: 'fix.bridges', kind: 'mechanic' }] }]);
    expect(out.join('\n')).toMatch(/no link to a General service/);
  });

  it('flags unknown targets, unknown kinds and self links', () => {
    const out = problems([{ links: [{ target: 'nope', kind: 'ui' }, { target: 'overlay', kind: 'magic' as any }, { target: 'fix.bridges', kind: 'bot' }] }]).join('\n');
    expect(out).toMatch(/unknown target "nope"/);
    expect(out).toMatch(/unknown kind "magic"/);
    expect(out).toMatch(/links to itself/);
  });

  it('flags a DLC that does not depend on base, and a cross-DLC dependency', () => {
    expect(problems([], { deps: [] }).join('\n')).toMatch(/must list "base"/);

    const other: Pack = {
      id: 'oth', name: 'Other', deps: ['base'],
      addons: [{ id: 'oth.siege', name: 'Siege', deps: ['fix.bridges'], links: [{ target: 'strength', kind: 'mechanic' }, { target: 'overlay', kind: 'ui' }] }],
      register() {}
    };
    expect(auditAddons(packs(fixtureDlc(), other)).join('\n')).toMatch(/from another DLC/);
    const allowed = { ...other, addons: [{ ...other.addons![0], allowCrossDlcDep: true }] };
    expect(auditAddons(packs(fixtureDlc(), allowed))).toEqual([]);
  });
});
