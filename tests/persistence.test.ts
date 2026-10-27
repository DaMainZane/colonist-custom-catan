// MODULE: tests for S0.15 cross-game bot memory & player profile persistence (Service 19) | USED BY: npm test
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  appendBotMemoryEvent,
  CURRENT_SCHEMA_VERSION,
  exportMemoryCode,
  importMemoryCode,
  loadBotMemory,
  loadPlayerProfile,
  MAX_FILE_BYTES,
  MAX_MEMORY_EVENTS,
  MAX_RELATIONSHIPS,
  migrateBotMemory,
  sanitizePublicMemoryEvent,
  saveBotMemory,
  savePlayerProfile
} from '../src/server/persistence';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cuhtan-persist-'));
}

describe('S0.15 Persistence (Service 19)', () => {
  it('saves and loads round-trip for bot memory and player profile', () => {
    const dir = makeTmpDir();
    try {
      let mem = loadBotMemory('overload_1', dir);
      expect(mem.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(mem.botId).toBe('overload_1');
      mem.tier = 'overload';
      mem.gamesPlayed = 4;
      mem.wins = 2;
      mem = appendBotMemoryEvent(mem, {
        type: 'robbed',
        actorId: 'zane',
        actorName: 'Zane',
        turn: 7,
        at: 1700000001000,
        note: 'Blocked wheat'
      });
      saveBotMemory(mem, dir);

      const loaded = loadBotMemory('overload_1', dir);
      expect(loaded.gamesPlayed).toBe(4);
      expect(loaded.wins).toBe(2);
      expect(loaded.events.length).toBe(1);
      expect(loaded.relationships.zane.robbedMe).toBe(1);
      expect(loaded.relationships.zane.grudge).toBeGreaterThan(0);

      const prof = loadPlayerProfile('zane', dir);
      prof.name = 'Zane';
      prof.gamesPlayed = 9;
      prof.wins = 5;
      prof.badges = ['founder'];
      savePlayerProfile(prof, dir);

      const loadedProf = loadPlayerProfile('zane', dir);
      expect(loadedProf.name).toBe('Zane');
      expect(loadedProf.gamesPlayed).toBe(9);
      expect(loadedProf.badges).toEqual(['founder']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('enforces MAX_MEMORY_EVENTS, MAX_RELATIONSHIPS, and MAX_FILE_BYTES', () => {
    const dir = makeTmpDir();
    try {
      let mem = loadBotMemory('cap_bot', dir);
      for (let i = 0; i < MAX_MEMORY_EVENTS + 25; i++) {
        mem = appendBotMemoryEvent(mem, {
          type: 'robbed',
          actorId: `player_${i % (MAX_RELATIONSHIPS + 10)}`,
          turn: i,
          at: 1700000000000 + i,
          note: 'x'.repeat(80)
        });
      }
      expect(mem.events.length).toBeLessThanOrEqual(MAX_MEMORY_EVENTS);
      expect(Object.keys(mem.relationships).length).toBeLessThanOrEqual(MAX_RELATIONSHIPS);
      expect(Buffer.byteLength(JSON.stringify(mem), 'utf8')).toBeLessThanOrEqual(MAX_FILE_BYTES);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects private fields and non-public event types', () => {
    expect(() =>
      sanitizePublicMemoryEvent({
        type: 'robbed',
        actorId: 'p1',
        turn: 3,
        resources: { wood: 2 }
      })
    ).toThrow(/Private field "resources" is forbidden/);

    expect(() =>
      sanitizePublicMemoryEvent({
        type: 'robbed',
        actorId: 'p1',
        turn: 3,
        devCards: ['knight']
      })
    ).toThrow(/Private field "devCards" is forbidden/);

    expect(() =>
      sanitizePublicMemoryEvent({
        type: 'peek_secret_hand',
        actorId: 'p1',
        turn: 3
      })
    ).toThrow(/not a public memory event/);
  });

  it('migrates v1 legacy grudges map and portable export/import code works', () => {
    const dir1 = makeTmpDir();
    const dir2 = makeTmpDir();
    try {
      const migrated = migrateBotMemory({
        id: 'legacy_bot',
        games: 6,
        wins: 3,
        grudges: { zane: 4 },
        events: [
          { type: 'traded', actorId: 'zane', turn: 2, at: 1000 },
          { type: 'robbed', actorId: 'clank', turn: 5, at: 2000, secret: 'should_drop' }
        ]
      });
      expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(migrated.gamesPlayed).toBe(6);
      expect(migrated.relationships.zane.grudge).toBe(4);
      expect(migrated.events.length).toBe(1);
      expect(migrated.events[0].type).toBe('traded');

      saveBotMemory(migrated, dir1);
      const code = exportMemoryCode(dir1);
      expect(code.startsWith('CTMEM1.')).toBe(true);

      const res = importMemoryCode(code, dir2);
      expect(res.botsImported).toBe(1);
      const restored = loadBotMemory('legacy_bot', dir2);
      expect(restored.gamesPlayed).toBe(6);
      expect(restored.relationships.zane.grudge).toBe(4);
    } finally {
      fs.rmSync(dir1, { recursive: true, force: true });
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  });
});
