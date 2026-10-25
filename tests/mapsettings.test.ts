import { describe, expect, it } from 'vitest';
import {
  createRegistry, effectiveFlags, generateMap, paramOf, resolveMapOptions, resolveParams, resolvePicks
} from '../src/shared';
import type { Board, Pack } from '../src/shared';
import { allPacks } from '../src/packs';
import { goldRushCount } from '../src/packs/gold';
import { fogIslandCount } from '../src/packs/fog';
import { rematch } from '../src/server/game';
import {
  applyMapStart, generateLobbyMap, isPreset, mergeSettings, mergeSettingsDetailed, newBoard, recipeKey, refreshMap
} from '../src/server/lobby';
import { createRoom, rooms } from '../src/server/rooms';
import { defaultSettings, fullRules, registry } from '../src/server/runtime';

// ---- A registry with extra options, to test slots, conflicts, requires and params without touching real content ----

const labPack: Pack = {
  id: 'lab',
  name: 'Lab',
  deps: ['base'],
  register(api) {
    api.mapShape({
      id: 'blob', label: 'Blob', stage: 'shape', phase: 'base', slot: 'shape',
      params: [{ id: 'blob.land', label: 'Land', min: 30, max: 100, step: 5, default: 70 }]
    });
    api.mapPerk({ id: 'sun', label: 'Sun', stage: 'extras', conflicts: ['rain'], ruleOverrides: { hotTouch: 'allow' } });
    api.mapPerk({ id: 'rain', label: 'Rain', stage: 'extras' });
    api.mapPerk({ id: 'ships', label: 'Ships', stage: 'extras', requires: ['crossing'] });
  }
};
const ferryPack: Pack = { id: 'ferry', name: 'Ferry', deps: ['base'], register(api) { api.capability('crossing'); } };

const lab = createRegistry([...allPacks, labPack]);
const labWithCrossing = createRegistry([...allPacks, labPack, ferryPack]);

const ids = (list: { id: string }[]) => list.map(o => o.id);

describe('pick resolution', () => {
  it('same slot: the later pick replaces the earlier one', () => {
    const r = resolvePicks(lab, ['hexagon', 'blob']);
    expect(r.picks).toEqual(['blob']);
    expect(r.dropped).toEqual([{ id: 'hexagon', reason: 'replaced' }]);
  });

  it('conflicts: the later pick wins, whichever side declares the conflict', () => {
    expect(resolvePicks(lab, ['sun', 'rain']).picks).toEqual(['rain']);
    expect(resolvePicks(lab, ['rain', 'sun']).picks).toEqual(['sun']);
    expect(resolvePicks(lab, ['sun', 'rain']).dropped).toEqual([{ id: 'sun', reason: 'conflict' }]);
  });

  it('drops unknown ids, unmet requirements and duplicates', () => {
    const r = resolvePicks(lab, ['gold', 'gold', 'nope', 'ships']);
    expect(r.picks).toEqual(['gold']);
    expect(r.dropped.map(d => d.reason).sort()).toEqual(['unknown', 'unmet']);
    expect(resolvePicks(labWithCrossing, ['ships']).picks).toEqual(['ships']);
  });

  it('fills empty slots with their defaults, and skips a slot that has a pick', () => {
    expect(ids(resolveMapOptions(lab, ['gold']).options)).toEqual(['hexagon', 'random', 'standard', 'gold']);
    expect(ids(resolveMapOptions(lab, ['blob']).options)).toEqual(['random', 'standard', 'blob']);
    // The stored picks never contain defaults.
    expect(resolveMapOptions(lab, ['gold']).picks).toEqual(['gold']);
  });

  it('clamps params to their range and step, and keeps only params of active options', () => {
    const options = resolveMapOptions(lab, ['blob']).options;
    expect(resolveParams(options, { 'blob.land': 1000, junk: 5 })).toEqual({ 'blob.land': 100 });
    expect(resolveParams(options, { 'blob.land': 0 })).toEqual({ 'blob.land': 30 });
    expect(resolveParams(options, { 'blob.land': 47 })).toEqual({ 'blob.land': 45 });
    expect(resolveParams(options, { 'blob.land': 'abc' })).toEqual({});
    expect(resolveParams(resolveMapOptions(lab, []).options, { 'blob.land': 50 })).toEqual({});
    expect(resolveParams(options, null)).toEqual({});
  });

  it('param lookup falls back to the default, then to 0', () => {
    const options = resolveMapOptions(lab, ['blob']).options;
    expect(paramOf(options, {}, 'blob.land')).toBe(70);
    expect(paramOf(options, { 'blob.land': 45 }, 'blob.land')).toBe(45);
    expect(paramOf(options, {}, 'nothing')).toBe(0);
  });

  it('flags: defaults, then the overrides of active options', () => {
    expect(effectiveFlags(resolveMapOptions(lab, []).options).hotTouch).toBe('forbid');
    expect(effectiveFlags(resolveMapOptions(lab, ['sun']).options).hotTouch).toBe('allow');
  });
});

describe('registry map content', () => {
  const dup = (register: Pack['register']): Pack => ({ id: 'dup', name: 'Dup', deps: ['base'], register });

  it('refuses a duplicate option id, in the same kind or another one', () => {
    expect(() => createRegistry([...allPacks, dup(api => api.mapShape({ id: 'hexagon', label: 'X', stage: 'shape', phase: 'base' }))]))
      .toThrow(/duplicate/);
    expect(() => createRegistry([...allPacks, dup(api => api.mapPerk({ id: 'hexagon', label: 'X', stage: 'extras' }))]))
      .toThrow(/already used/);
  });

  it('lets replace: true override', () => {
    const reg = createRegistry([...allPacks, dup(api => api.mapShape({ id: 'hexagon', label: 'Changed', stage: 'shape', phase: 'base', slot: 'shape', default: true, replace: true }))]);
    expect(reg.mapShapes.get('hexagon')?.label).toBe('Changed');
  });

  it('the shipped packs register the classic recipe, the perks and the quick starts', () => {
    expect([...registry.mapShapes.keys()]).toContain('hexagon');
    expect([...registry.mapTerrains.keys()]).toContain('random');
    expect([...registry.mapNumberings.keys()]).toContain('standard');
    expect([...registry.mapPerks.keys()].sort()).toEqual(['fog', 'gold', 'island_mix']);
    expect([...registry.quickStarts.keys()].sort()).toEqual(['archipelago', 'blank', 'fogIsland', 'goldRush', 'standard']);
    expect(registry.quickStarts.get('blank')?.blank).toBe(true);
  });
});

describe('perks in generateMap', () => {
  const rules = () => fullRules(defaultSettings());
  const hidden = (b: Board) => b.hexes.filter(h => h.ext.hidden).length;
  const count = (b: Board, type: string) => b.hexes.filter(h => h.type === type).length;

  it('gold adds a third of the tiles', () => {
    const { board, recipe } = generateMap(registry, rules(), { seed: 'G1', picks: ['gold'] });
    expect(count(board, 'gold')).toBe(goldRushCount(19));
    expect(recipe.picks).toEqual(['gold']);
  });

  it('a typed gold count on the Rules tab wins over the perk', () => {
    const typed = fullRules({ ...defaultSettings(), goldTiles: 2 });
    expect(count(generateMap(registry, typed, { seed: 'G1', picks: ['gold'] }).board, 'gold')).toBe(2);
  });

  it('fog hides tiles, and a typed fog count wins', () => {
    expect(hidden(generateMap(registry, rules(), { seed: 'F1', picks: ['fog'] }).board)).toBe(fogIslandCount(19));
    const typed = fullRules({ ...defaultSettings(), fogTiles: 3 });
    expect(hidden(generateMap(registry, typed, { seed: 'F1', picks: ['fog'] }).board)).toBe(3);
  });

  it('ticking fog changes neither the tile types nor the tokens', () => {
    const plain = generateMap(registry, rules(), { seed: 'F2' }).board;
    const fogged = generateMap(registry, rules(), { seed: 'F2', picks: ['fog'] }).board;
    expect(fogged.hexes.map(h => h.type)).toEqual(plain.hexes.map(h => h.type));
    expect(fogged.hexes.map(h => h.number)).toEqual(plain.hexes.map(h => h.number));
    expect(hidden(fogged)).toBeGreaterThan(0);
  });

  it('the same recipe gives the same map, perks included', () => {
    const sig = (b: Board) => b.hexes.map(h => `${h.q},${h.r}:${h.type}:${h.number}:${h.ext.hidden ? 1 : 0}`).join('|');
    const a = generateMap(registry, rules(), { seed: 'REPLAY', picks: ['gold', 'fog'] });
    const b = generateMap(registry, rules(), { seed: 'REPLAY', picks: ['gold', 'fog'] });
    expect(sig(a.board)).toBe(sig(b.board));
    expect(a.report).toEqual(b.report);
  });

  it('unknown picks and clashing picks are reported, not fatal', () => {
    const { report } = generateMap(lab, rules(), { seed: 'W1', picks: ['hexagon', 'blob', 'bogus'] });
    const msgs = report.warnings.filter(w => w.code === 'pick-ignored').map(w => w.message).join(' ');
    expect(msgs).toContain('bogus');
    expect(msgs).toContain('hexagon');
  });
});

describe('lobby settings and map', () => {
  const sigOf = (b: Board) => b.hexes.map(h => `${h.q},${h.r}:${h.type}:${h.number}:${h.ext.hidden ? 1 : 0}`).join('|');
  const count = (b: Board, type: string) => b.hexes.filter(h => h.type === type).length;
  const fakeRoom = (over: Record<string, any> = {}) => {
    const settings = { ...defaultSettings(), ...over };
    const { board, meta } = generateLobbyMap(settings);
    settings.mapSeed = meta.recipe.seed;
    return { settings, board, mapMeta: meta };
  };

  it('mergeSettings keeps valid picks, drops the rest, and falls back to the old values', () => {
    const merged = mergeSettings({ mapPicks: ['gold', 'nope', 'fog', 'fog'], mapParams: { x: 1 } }, defaultSettings());
    expect(merged.mapPicks).toEqual(['gold', 'fog']);
    expect(merged.mapParams).toEqual({});

    const kept = mergeSettings({ boardRadius: 3 }, { ...defaultSettings(), mapPicks: ['gold'], mapSeed: 'ABC', mapSeedLocked: true });
    expect(kept.boardRadius).toBe(3);
    expect(kept.mapPicks).toEqual(['gold']);
    expect(kept.mapSeed).toBe('ABC');
    expect(kept.mapSeedLocked).toBe(true);
    expect(mergeSettings({ mapSeedLocked: false }, { ...defaultSettings(), mapSeedLocked: true }).mapSeedLocked).toBe(false);
  });

  it('cleans a typed seed', () => {
    expect(mergeSettings({ mapSeed: ' catan night! ' }, defaultSettings()).mapSeed).toBe('catan-night');
    expect(mergeSettings({ mapSeed: '' }, { ...defaultSettings(), mapSeed: 'ABC' }).mapSeed).toBe('');
  });

  it('a full share code applies the whole recipe and reports what it could not use', () => {
    const { settings, dropped } = mergeSettingsDetailed({ mapSeed: 'hx1;g=1;r=3;picks=gold+bogus;seed=ABCDEFG' }, defaultSettings());
    expect(settings.boardRadius).toBe(3);
    expect(settings.mapSeed).toBe('ABCDEFG');
    expect(settings.mapPicks).toEqual(['gold']);
    expect(dropped).toEqual(['bogus']);
  });

  it('recipeKey changes with anything that decides the map, and only with those', () => {
    const base = defaultSettings();
    const key = recipeKey(base);
    expect(recipeKey({ ...base, boardRadius: 3 })).not.toBe(key);
    expect(recipeKey({ ...base, mapSeed: 'X' })).not.toBe(key);
    expect(recipeKey({ ...base, mapPicks: ['gold'] })).not.toBe(key);
    expect(recipeKey({ ...base, goldTiles: 4 })).not.toBe(key);
    expect(recipeKey({ ...base, fogTiles: 4 })).not.toBe(key);
    expect(recipeKey({ ...base, vpToWin: 12, mapSeedLocked: true })).toBe(key);
  });

  it('a picked style survives a radius change, and the seed stays', () => {
    const room = fakeRoom({ mapPicks: ['gold'], mapSeed: 'KEEP' });
    expect(count(room.board, 'gold')).toBe(goldRushCount(19));

    const next = mergeSettings({ boardRadius: 3 }, room.settings);
    expect(recipeKey(next)).not.toBe(recipeKey(room.settings));
    room.settings = next;
    refreshMap(room);
    expect(room.board.hexes).toHaveLength(37);
    expect(count(room.board, 'gold')).toBe(goldRushCount(37));
    expect(room.settings.mapPicks).toEqual(['gold']);
    expect(room.settings.mapSeed).toBe('KEEP');
  });

  it('the same seed gives the same map, and an empty seed rolls a new one that is stored', () => {
    const room = fakeRoom({ mapSeed: 'SAME' });
    const first = sigOf(room.board);
    refreshMap(room);
    expect(sigOf(room.board)).toBe(first);

    room.settings.mapSeed = '';
    refreshMap(room);
    expect(room.settings.mapSeed).toMatch(/^[0-9A-Z]{7}$/);
    expect(room.mapMeta.recipe.seed).toBe(room.settings.mapSeed);
  });

  it('quick starts set the picks and roll a new seed', () => {
    const room = fakeRoom({ mapSeed: 'OLD1' });
    applyMapStart(room, 'goldRush');
    expect(room.settings.mapPicks).toEqual(['gold']);
    expect(room.settings.mapSeed).toMatch(/^[0-9A-Z]{7}$/);
    expect(count(room.board, 'gold')).toBe(goldRushCount(19));
    expect(room.mapMeta?.recipe.picks).toEqual(['gold']);

    applyMapStart(room, 'fogIsland');
    expect(room.settings.mapPicks).toEqual(['fog']);
    expect(room.board.hexes.some(h => h.ext.hidden)).toBe(true);

    applyMapStart(room, 'standard');
    expect(room.settings.mapPicks).toEqual([]);
    expect(count(room.board, 'gold')).toBe(0);
    expect(room.board.hexes.some(h => h.ext.hidden)).toBe(false);
  });

  it('blank stays special, and the Archipelago chip is a recipe now (M3 shape)', () => {
    const room = fakeRoom({ mapPicks: ['gold'] });
    applyMapStart(room, 'blank');
    expect(room.board.hexes.every(h => h.type === 'water')).toBe(true);
    expect(room.mapMeta).toBeUndefined();
    expect(room.settings.mapPicks).toEqual([]);

    applyMapStart(room, 'archipelago');
    expect(room.board.hexes).toHaveLength(19);
    expect(room.settings.mapPicks).toEqual(['archipelago']);
    expect(room.mapMeta?.recipe.picks).toEqual(['archipelago']);
    expect(room.settings.mapSeed).toMatch(/^[0-9A-Z]{7}$/);
  });

  it('knows its preset ids', () => {
    for (const id of ['standard', 'blank', 'archipelago', 'goldRush', 'fogIsland']) expect(isPreset(id)).toBe(true);
    expect(isPreset('nope')).toBe(false);
    expect(isPreset(5)).toBe(false);
  });

  it('newBoard follows the settings recipe, or applies a quick start', () => {
    expect(newBoard({ ...defaultSettings(), boardRadius: 3 }).hexes).toHaveLength(37);
    expect(newBoard(defaultSettings(), 'goldRush').hexes.some(h => h.type === 'gold')).toBe(true);
    expect(newBoard(defaultSettings(), 'blank').hexes.every(h => h.type === 'water')).toBe(true);
  });

  it('a new room stores the seed it rolled; a rematch rolls a new one unless the seed is locked', () => {
    const room = createRoom('host-m2', 'Host');
    try {
      const first = room.settings.mapSeed;
      expect(first).toMatch(/^[0-9A-Z]{7}$/);
      expect(room.mapMeta?.recipe.seed).toBe(first);

      rematch(room);
      expect(room.settings.mapSeed).not.toBe(first);

      room.settings.mapSeedLocked = true;
      const kept = room.settings.mapSeed;
      const sig = sigOf(room.board);
      rematch(room);
      expect(room.settings.mapSeed).toBe(kept);
      expect(sigOf(room.board)).toBe(sig);
    } finally {
      delete rooms[room.code];
    }
  });
});
