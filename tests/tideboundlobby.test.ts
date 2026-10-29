import { describe, expect, it } from 'vitest';
import type { Board } from '../src/shared';
import { generateLobbyMap, isPreset, mergeSettings, mergeSettingsDetailed } from '../src/server/lobby';
import { mapOptionsForSettings, mapOptionsView } from '../src/server/mapmenu';
import { broadcastRoom, setIo } from '../src/server/net';
import { createRoom, rooms } from '../src/server/rooms';
import { defaultSettings, mapRegistryFor, mapRegistryKey, registry } from '../src/server/runtime';

// T2a2: the lobby builds its map, checks its picks and draws its map menu from the room's own registry (base plus the addons the room's
// DLC toggles turn on), so the Tidebound wide-water perk can be picked in the lobby, and only while Tidebound is on.

const tide = { dlc: { tidebound: true }, addons: {} as Record<string, boolean> };
const plain = { dlc: {} as Record<string, boolean>, addons: {} as Record<string, boolean> };

const hexSig = (b: Board) => b.hexes.map(h => `${h.q},${h.r}:${h.type}:${h.number}:${h.ext.hidden ? 1 : 0}`).join('|');
const landOf = (b: Board) => b.hexes.filter(h => registry.tiles.get(h.type)?.land).length;

describe('the room registry', () => {
  it('is the plain registry while no addon is on, and the same object every time', () => {
    expect(mapRegistryKey(defaultSettings())).toBe('');
    expect(mapRegistryFor(plain)).toBe(registry);
    expect(mapRegistryFor({ dlc: { tidebound: false }, addons: {} })).toBe(registry);
    expect(mapRegistryFor({ dlc: {}, addons: { 'tidebound.bridges': true } })).toBe(registry);
  });

  it('has the wide-water perk only while Tidebound and its bridges addon are on, and is cached per addon set', () => {
    expect(mapRegistryKey(tide)).toContain('tidebound.bridges');
    expect(mapRegistryFor(tide).mapPerks.has('wide_water')).toBe(true);
    expect(mapRegistryFor({ dlc: { tidebound: true }, addons: {} })).toBe(mapRegistryFor(tide));
    expect(mapRegistryFor({ dlc: { tidebound: true }, addons: { 'tidebound.bridges': false } }).mapPerks.has('wide_water')).toBe(false);
    expect(registry.mapPerks.has('wide_water')).toBe(false);
  });
});

describe('the map menu data of a room', () => {
  it('with no addon on it is the plain list', () => {
    const base = mapOptionsForSettings(plain);
    expect(base).toEqual(mapOptionsView());
    expect(base.options.map(o => o.id)).not.toContain('wide_water');
    expect(mapOptionsForSettings(plain)).toBe(base);
  });

  it('with Tidebound on it adds the perk, ready to pick, and changes nothing else', () => {
    const base = mapOptionsForSettings(plain);
    const view = mapOptionsForSettings(tide);
    const perk = view.options.find(o => o.id === 'wide_water');
    expect(perk).toMatchObject({ stage: 'extras', met: true });
    expect(perk?.params.map(p => p.id)).toEqual(['water.extra']);
    expect(view.options.map(o => o.id).filter(id => id !== 'wide_water')).toEqual(base.options.map(o => o.id));
    expect(view.dlcs).toEqual(base.dlcs);
    expect(view.addons).toEqual(base.addons);
    expect(view.quickStarts).toEqual(base.quickStarts);
    expect(view.scenarios).toEqual(base.scenarios);
    expect(JSON.parse(JSON.stringify(view)).options).toHaveLength(view.options.length);
  });
});

describe('settings merge follows the DLC toggles', () => {
  it('drops the pick and its param while Tidebound is off', () => {
    const m = mergeSettings({ mapPicks: ['continent', 'wide_water'], mapParams: { 'water.extra': 3 } }, defaultSettings());
    expect(m.mapPicks).toEqual(['continent']);
    expect(Object.keys(m.mapParams ?? {})).not.toContain('water.extra');
  });

  it('keeps them when the same patch turns Tidebound on, and clamps the param', () => {
    const m = mergeSettings({ dlc: { tidebound: true }, mapPicks: ['continent', 'wide_water'], mapParams: { 'water.extra': 9 } }, defaultSettings());
    expect(m.mapPicks).toEqual(['continent', 'wide_water']);
    expect(m.mapParams?.['water.extra']).toBe(5);
  });

  it('drops them again when Tidebound, or only its bridges addon, is switched off later', () => {
    const on = mergeSettings({ dlc: { tidebound: true }, mapPicks: ['continent', 'wide_water'], mapParams: { 'water.extra': 2 } }, defaultSettings());
    expect(on.mapParams?.['water.extra']).toBe(2);

    const dlcOff = mergeSettings({ dlc: { tidebound: false } }, on);
    expect(dlcOff.mapPicks).toEqual(['continent']);
    expect(Object.keys(dlcOff.mapParams ?? {})).not.toContain('water.extra');

    const addonOff = mergeSettings({ addons: { 'tidebound.bridges': false } }, on);
    expect(addonOff.mapPicks).toEqual(['continent']);
    expect(Object.keys(addonOff.mapParams ?? {})).not.toContain('water.extra');
  });

  it('a share code with the perk applies it only where Tidebound is on, and says what it dropped', () => {
    const code = 'hx1;g=1;r=8;picks=continent+wide_water;seed=ABCDEFG';
    const without = mergeSettingsDetailed({ mapSeed: code }, defaultSettings());
    expect(without.dropped).toEqual(['wide_water']);
    expect(without.settings.mapPicks).toEqual(['continent']);

    const withDlc = mergeSettingsDetailed({ mapSeed: code }, { ...defaultSettings(), dlc: { tidebound: true } });
    expect(withDlc.dropped).toEqual([]);
    expect(withDlc.settings.mapPicks).toEqual(['continent', 'wide_water']);
    expect(withDlc.settings.boardRadius).toBe(8);
    expect(withDlc.settings.mapSeed).toBe('ABCDEFG');
  });

  it('quick start ids are checked against the room registry', () => {
    expect(isPreset('goldRush')).toBe(true);
    expect(isPreset('goldRush', tide)).toBe(true);
    expect(isPreset('nope', tide)).toBe(false);
    expect(isPreset(7, tide)).toBe(false);
  });
});

describe('the lobby map', () => {
  const base = { ...defaultSettings(), boardRadius: 8, mapPicks: ['continent', 'wide_water'] };
  const fell = (m: ReturnType<typeof generateLobbyMap>) => m.meta.report.warnings.some(w => w.code === 'shape-fallback');

  it('uses the perk with Tidebound on: the same land on a bigger canvas', () => {
    let checked = 0;
    for (const seed of ['LOBBY1', 'LOBBY2', 'LOBBY3', 'LOBBY4']) {
      const wide = generateLobbyMap({ ...base, mapSeed: seed, dlc: { tidebound: true } });
      const normal = generateLobbyMap({ ...base, mapSeed: seed, mapPicks: ['continent'], dlc: { tidebound: true } });
      expect(wide.meta.recipe.picks).toEqual(['continent', 'wide_water']);
      expect(wide.meta.report.warnings.some(w => w.code === 'pick-ignored')).toBe(false);
      if (fell(wide) || fell(normal)) continue;
      checked++;
      expect(landOf(wide.board), seed).toBe(landOf(normal.board));
      expect(wide.board.hexes.length, seed).toBeGreaterThan(normal.board.hexes.length);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('with Tidebound off a stray pick is ignored and the map is the plain continent', () => {
    for (const seed of ['LOBBY1', 'LOBBY2']) {
      const stray = generateLobbyMap({ ...base, mapSeed: seed, dlc: {} });
      const clean = generateLobbyMap({ ...base, mapSeed: seed, mapPicks: ['continent'], dlc: {} });
      expect(stray.meta.report.warnings.some(w => w.code === 'pick-ignored'), seed).toBe(true);
      expect(hexSig(stray.board), seed).toBe(hexSig(clean.board));
    }
  });

  it('DLC off gives the same map as before this change (the plain registry)', () => {
    const settings = { ...defaultSettings(), boardRadius: 6, mapPicks: ['islands', 'river'], mapSeed: 'SAME6' };
    expect(hexSig(generateLobbyMap(settings).board)).toBe(hexSig(generateLobbyMap({ ...settings, dlc: { tidebound: false } }).board));
  });
});

describe('the lobby sends each socket the list for its room', () => {
  it('sends it when the addon set changes, before the state, and not again while it stays the same', () => {
    const room = createRoom('host-t2a2', 'Host');
    const log: any[] = [];
    const sock = { data: { mapOptionsKey: '' }, emit: (ev: string, data: any) => log.push(['sock', ev, data]) };
    setIo({
      to: (id: string) => ({ emit: (ev: string, data: any) => log.push([id, ev, data]) }),
      sockets: { sockets: new Map([['host-t2a2', sock]]) }
    } as any);
    const lists = () => log.filter(l => l[0] === 'sock' && l[1] === 'mapOptions');
    try {
      // The connection already got the plain list, so a plain room sends nothing more.
      broadcastRoom(room);
      expect(lists()).toHaveLength(0);
      expect(log.some(l => l[0] === 'host-t2a2' && l[1] === 'gameState')).toBe(true);

      room.settings.dlc = { tidebound: true };
      log.length = 0;
      broadcastRoom(room);
      expect(lists()).toHaveLength(1);
      expect(lists()[0][2].options.some((o: any) => o.id === 'wide_water')).toBe(true);
      const at = log.findIndex(l => l[1] === 'mapOptions');
      expect(log.slice(at + 1).some(l => l[1] === 'gameState')).toBe(true);

      log.length = 0;
      broadcastRoom(room);
      expect(lists()).toHaveLength(0);

      room.settings.dlc = {};
      broadcastRoom(room);
      expect(lists()).toHaveLength(1);
      expect(lists()[0][2].options.some((o: any) => o.id === 'wide_water')).toBe(false);
    } finally {
      delete rooms[room.code];
      setIo(undefined as any);
    }
  });
});
