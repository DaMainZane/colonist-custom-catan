import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allPacks, basePack, fogPack, goldPack, tideboundPack } from '../src/packs';
import { mapOptionsView } from '../src/server/mapmenu';
import { simulateGame } from '../src/server/bots/sim';
import { addonOn, auditAddons, createGame, createRegistry, registryFor, resolveAddons } from '../src/shared';

// T0a/T0b: the Tidebound skeleton. Eight addon stubs with links, a lobby card from the manifest, and nothing in a game until the DLC is on.

const IDS = [
  'tidebound.bridges', 'tidebound.rickety_bridges', 'tidebound.tides', 'tidebound.rising_sea',
  'tidebound.harbor', 'tidebound.fishing', 'tidebound.wrecks', 'tidebound.pirates'
];

const cfg = { players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], seed: 42, shuffleSeats: false };
/** `packs` lists the loaded packs, so a registry with one more pack differs there and nowhere else. */
const strip = (g: any) => { const { packs: _p, ...rest } = g; return JSON.stringify(rest); };

describe('Tidebound manifest', () => {
  it('is in allPacks with the 8 addons in order, and passes the Rule of Two audit', () => {
    expect(allPacks).toContain(tideboundPack);
    expect(tideboundPack.addons?.map(a => a.id)).toEqual(IDS);
    expect(auditAddons(allPacks)).toEqual([]);
  });

  it('every addon has a name, a description and 2+ links', () => {
    for (const a of tideboundPack.addons ?? []) {
      expect(a.name, a.id).toBeTruthy();
      expect(a.description, a.id).toBeTruthy();
      expect(a.links.length, a.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('rickety bridges need bridges, and nothing else has a dependency yet', () => {
    const deps = Object.fromEntries((tideboundPack.addons ?? []).map(a => [a.id, a.deps ?? []]));
    expect(deps['tidebound.rickety_bridges']).toEqual(['tidebound.bridges']);
    expect(Object.entries(deps).filter(([id, d]) => d.length && id !== 'tidebound.rickety_bridges')).toEqual([]);
  });
});

describe('lobby card data', () => {
  it('the server sends the Tidebound DLC and its 8 addons from the manifest', () => {
    const view = mapOptionsView();
    expect(view.dlcs.find(d => d.id === 'tidebound')).toEqual({ id: 'tidebound', name: 'Tidebound', addons: IDS });
    const sent = view.addons.filter(a => a.pack === 'tidebound');
    expect(sent.map(a => a.id)).toEqual(IDS);
    for (const a of sent) expect(a.links.length).toBeGreaterThanOrEqual(2);
  });

  it('the setup page fallback catalog lists the same Tidebound ids as the server (no placeholder ids)', () => {
    const src = readFileSync(join(__dirname, '../src/client/render/setup.ts'), 'utf8');
    const inClient = new Set([...src.matchAll(/'(tidebound\.[a-z_]+)'/g)].map(m => m[1]));
    expect([...inClient].sort()).toEqual([...IDS].sort());
  });
});

describe('Tidebound off changes nothing', () => {
  const without = [basePack, goldPack, fogPack];

  it('gives the same new game as a registry without the pack', () => {
    const plain = createGame(createRegistry(without), cfg);
    const off = createGame(createRegistry(allPacks), cfg);
    expect(strip(off)).toBe(strip(plain));
  });

  it('the master switch is off by default, and a single addon flag cannot turn it on', () => {
    expect(resolveAddons(allPacks, {}).enabled.size).toBe(0);
    expect(resolveAddons(allPacks, { dlc: { tidebound: false }, addons: { 'tidebound.bridges': true } }).enabled.size).toBe(0);
    expect(registryFor(allPacks, {}).enabled.size).toBe(0);
  });

  it('a seeded bot game still finishes with the pack loaded (the golden test checks it plays the same)', () => {
    const a = simulateGame({ seed: 11, players: 3, preset: 'standard' });
    expect(a.error).toBeNull();
    expect(a.finished).toBe(true);
  });
});

describe('Tidebound on (stubs only)', () => {
  const on = { dlc: { tidebound: true } };

  it('enables all 8 addons but registers no content yet', () => {
    const base = createRegistry(without3());
    const reg = registryFor(allPacks, on);
    expect([...reg.enabled]).toEqual(IDS);
    expect(addonOn(reg, 'tidebound.pirates')).toBe(true);
    expect(reg.tiles.size).toBe(base.tiles.size);
    expect(reg.hooks.onTurnStart.length).toBe(base.hooks.onTurnStart.length);
    expect(JSON.stringify(reg.rules)).toBe(JSON.stringify(base.rules));
  });

  it('switching bridges off blocks rickety bridges, which the lobby prompts for', () => {
    const res = resolveAddons(allPacks, { ...on, addons: { 'tidebound.bridges': false } });
    expect(res.blocked).toEqual([{ addon: 'tidebound.rickety_bridges', missing: ['tidebound.bridges'] }]);
    expect(res.enabled.has('tidebound.tides')).toBe(true);
  });

  it('a game with the DLC on starts and records the switch', () => {
    const reg = registryFor(allPacks, on);
    const g = createGame(reg, { ...cfg, rules: on });
    expect(g.rules.dlc).toEqual({ tidebound: true });
  });
});

function without3() { return [basePack, goldPack, fogPack]; }
