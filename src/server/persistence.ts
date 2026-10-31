// MODULE: S0.15 cross-game bot memory & player profile persistence (Service 19; JSON disk store + portable base64url export/import for Render free tier) | DEPENDS ON: none | USED BY: server/main
import fs from 'node:fs';
import path from 'node:path';

export const CURRENT_SCHEMA_VERSION = 2;
export const MAX_MEMORY_EVENTS = 50;
export const MAX_RELATIONSHIPS = 24;
export const MAX_FILE_BYTES = 16384;

export type PublicMemoryEventType =
  | 'robbed'
  | 'traded'
  | 'refused_trade'
  | 'broke_treaty'
  | 'cut_road'
  | 'won_game'
  | 'voted_against'
  | 'gifted'
  | 'attacked';

export const ALLOWED_PUBLIC_EVENT_TYPES = new Set<PublicMemoryEventType>([
  'robbed',
  'traded',
  'refused_trade',
  'broke_treaty',
  'cut_road',
  'won_game',
  'voted_against',
  'gifted',
  'attacked'
]);

const FORBIDDEN_PRIVATE_KEYS = new Set([
  'resources',
  'hand',
  'devCards',
  'newDevCards',
  'secret',
  'deck',
  'private',
  'hiddenVp',
  'exactCards'
]);

export interface BotRelationship {
  playerId: string;
  playerName: string;
  trust: number;
  grudge: number;
  gamesTogether: number;
  robbedMe: number;
  tradedWithMe: number;
  brokeDeal: number;
  lastSeenAt: number;
}

export interface BotMemoryEvent {
  type: PublicMemoryEventType;
  actorId: string;
  actorName?: string;
  turn: number;
  at: number;
  note?: string;
}

export interface BotMemoryFile {
  schemaVersion: number;
  botId: string;
  tier: 'main' | 'secondary' | 'overload';
  updatedAt: number;
  gamesPlayed: number;
  wins: number;
  relationships: Record<string, BotRelationship>;
  events: BotMemoryEvent[];
}

export interface PlayerProfileFile {
  schemaVersion: number;
  playerId: string;
  name: string;
  updatedAt: number;
  gamesPlayed: number;
  wins: number;
  favoriteDlc?: string;
  badges: string[];
}

export interface PersistenceBundle {
  schemaVersion: number;
  exportedAt: number;
  bots: Record<string, BotMemoryFile>;
  players: Record<string, PlayerProfileFile>;
}

const DEFAULT_DATA_DIR = path.resolve(process.cwd(), 'data');

function safeKey(raw: string): string {
  const cleaned = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return cleaned || 'default';
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/**
 * Verifies an event is strictly public and contains no hidden hand/deck/resource fields.
 * Throws if a forbidden private key or non-public event type is passed.
 */
export function sanitizePublicMemoryEvent(raw: Record<string, any>): BotMemoryEvent {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid memory event: must be an object');
  }
  for (const key of Object.keys(raw)) {
    if (FORBIDDEN_PRIVATE_KEYS.has(key)) {
      throw new Error(`Private field "${key}" is forbidden in public bot memory`);
    }
  }
  const type = raw.type as PublicMemoryEventType;
  if (!ALLOWED_PUBLIC_EVENT_TYPES.has(type)) {
    throw new Error(`Event type "${String(raw.type)}" is not a public memory event`);
  }
  const actorId = String(raw.actorId || '').trim();
  if (!actorId) {
    throw new Error('Memory event requires actorId');
  }
  const ev: BotMemoryEvent = {
    type,
    actorId: actorId.slice(0, 64),
    turn: Math.max(0, Math.floor(Number(raw.turn) || 0)),
    at: Math.max(0, Math.floor(Number(raw.at) || Date.now()))
  };
  if (typeof raw.actorName === 'string' && raw.actorName.trim()) {
    ev.actorName = raw.actorName.trim().slice(0, 40);
  }
  if (typeof raw.note === 'string' && raw.note.trim()) {
    ev.note = raw.note.trim().slice(0, 120);
  }
  return ev;
}

/**
 * Migrates v0 or v1 bot memory payloads to `CURRENT_SCHEMA_VERSION` (v2) and enforces hard caps.
 */
export function migrateBotMemory(raw: any, fallbackBotId = 'bot_default'): BotMemoryFile {
  const obj = raw && typeof raw === 'object' ? raw : {};
  const botId = safeKey(obj.botId || obj.id || fallbackBotId);
  const tier =
    obj.tier === 'main' || obj.tier === 'secondary' || obj.tier === 'overload'
      ? obj.tier
      : 'secondary';

  const relationships: Record<string, BotRelationship> = {};
  const srcRels = obj.relationships && typeof obj.relationships === 'object' ? obj.relationships : {};

  // v1 legacy support: `grudges: { [pid]: number }` map
  if (obj.grudges && typeof obj.grudges === 'object') {
    for (const [pid, gVal] of Object.entries(obj.grudges)) {
      const k = safeKey(pid);
      relationships[k] = {
        playerId: k,
        playerName: k,
        trust: 0,
        grudge: clamp(Number(gVal) || 0, 0, 20),
        gamesTogether: 1,
        robbedMe: Math.max(0, Math.round(Number(gVal) || 0)),
        tradedWithMe: 0,
        brokeDeal: 0,
        lastSeenAt: Number(obj.updatedAt) || 0
      };
    }
  }

  for (const [pid, r] of Object.entries(srcRels)) {
    if (!r || typeof r !== 'object') continue;
    const rel = r as Record<string, any>;
    const k = safeKey(rel.playerId || pid);
    relationships[k] = {
      playerId: k,
      playerName: String(rel.playerName || rel.name || k).slice(0, 40),
      trust: clamp(Number(rel.trust) || 0, -20, 20),
      grudge: clamp(Number(rel.grudge) || 0, 0, 20),
      gamesTogether: Math.max(0, Math.floor(Number(rel.gamesTogether) || 0)),
      robbedMe: Math.max(0, Math.floor(Number(rel.robbedMe) || 0)),
      tradedWithMe: Math.max(0, Math.floor(Number(rel.tradedWithMe) || 0)),
      brokeDeal: Math.max(0, Math.floor(Number(rel.brokeDeal) || 0)),
      lastSeenAt: Math.max(0, Math.floor(Number(rel.lastSeenAt) || 0))
    };
  }

  const events: BotMemoryEvent[] = [];
  if (Array.isArray(obj.events)) {
    for (const item of obj.events) {
      try {
        events.push(sanitizePublicMemoryEvent(item));
      } catch {
        // Drop malformed or private legacy entries during migration
      }
    }
  }

  const mem: BotMemoryFile = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    botId,
    tier,
    updatedAt: Math.max(0, Math.floor(Number(obj.updatedAt) || Date.now())),
    gamesPlayed: Math.max(0, Math.floor(Number(obj.gamesPlayed ?? obj.games) || 0)),
    wins: Math.max(0, Math.floor(Number(obj.wins) || 0)),
    relationships,
    events
  };

  return enforceBotMemoryCaps(mem);
}

/**
 * Enforces `MAX_MEMORY_EVENTS`, `MAX_RELATIONSHIPS`, and `MAX_FILE_BYTES`.
 */
export function enforceBotMemoryCaps(mem: BotMemoryFile): BotMemoryFile {
  // 1. Cap events to most recent MAX_MEMORY_EVENTS
  if (mem.events.length > MAX_MEMORY_EVENTS) {
    mem.events = mem.events.slice(mem.events.length - MAX_MEMORY_EVENTS);
  }

  // 2. Cap relationships to MAX_RELATIONSHIPS by most recent lastSeenAt
  const relEntries = Object.entries(mem.relationships);
  if (relEntries.length > MAX_RELATIONSHIPS) {
    relEntries.sort((a, b) => b[1].lastSeenAt - a[1].lastSeenAt);
    const nextRels: Record<string, BotRelationship> = {};
    for (const [k, v] of relEntries.slice(0, MAX_RELATIONSHIPS)) {
      nextRels[k] = v;
    }
    mem.relationships = nextRels;
  }

  // 3. Enforce strict byte cap (MAX_FILE_BYTES)
  while (Buffer.byteLength(JSON.stringify(mem), 'utf8') > MAX_FILE_BYTES) {
    if (mem.events.length > 0) {
      mem.events.shift();
      continue;
    }
    const keys = Object.keys(mem.relationships);
    if (keys.length > 0) {
      delete mem.relationships[keys[0]];
      continue;
    }
    break;
  }

  return mem;
}

export function loadBotMemory(botId: string, baseDir = DEFAULT_DATA_DIR): BotMemoryFile {
  const key = safeKey(botId);
  const filePath = path.join(baseDir, 'bots', `${key}.json`);
  if (!fs.existsSync(filePath)) {
    return migrateBotMemory({ botId: key }, key);
  }
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(text);
    return migrateBotMemory(parsed, key);
  } catch {
    return migrateBotMemory({ botId: key }, key);
  }
}

export function saveBotMemory(mem: BotMemoryFile, baseDir = DEFAULT_DATA_DIR): BotMemoryFile {
  const normalized = enforceBotMemoryCaps(migrateBotMemory(mem, mem.botId));
  normalized.updatedAt = Date.now();
  const botsDir = path.join(baseDir, 'bots');
  fs.mkdirSync(botsDir, { recursive: true });
  const filePath = path.join(botsDir, `${safeKey(normalized.botId)}.json`);
  fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}

export function appendBotMemoryEvent(
  mem: BotMemoryFile,
  rawEvent: Record<string, any>
): BotMemoryFile {
  const ev = sanitizePublicMemoryEvent(rawEvent);
  mem.events.push(ev);
  const actorKey = safeKey(ev.actorId);
  const rel: BotRelationship = mem.relationships[actorKey] || {
    playerId: actorKey,
    playerName: ev.actorName || actorKey,
    trust: 0,
    grudge: 0,
    gamesTogether: 0,
    robbedMe: 0,
    tradedWithMe: 0,
    brokeDeal: 0,
    lastSeenAt: ev.at
  };
  if (ev.actorName) rel.playerName = ev.actorName;
  rel.lastSeenAt = ev.at;

  switch (ev.type) {
    case 'robbed':
    case 'attacked':
      rel.robbedMe += 1;
      rel.grudge = clamp(rel.grudge + 1.5, 0, 20);
      rel.trust = clamp(rel.trust - 1.0, -20, 20);
      break;
    case 'cut_road':
    case 'voted_against':
      rel.grudge = clamp(rel.grudge + 1.0, 0, 20);
      rel.trust = clamp(rel.trust - 0.5, -20, 20);
      break;
    case 'broke_treaty':
      rel.brokeDeal += 1;
      rel.grudge = clamp(rel.grudge + 3.0, 0, 20);
      rel.trust = clamp(rel.trust - 3.0, -20, 20);
      break;
    case 'traded':
    case 'gifted':
      rel.tradedWithMe += 1;
      rel.trust = clamp(rel.trust + 1.0, -20, 20);
      rel.grudge = clamp(rel.grudge - 0.5, 0, 20);
      break;
    default:
      break;
  }

  mem.relationships[actorKey] = rel;
  return enforceBotMemoryCaps(mem);
}

export function migratePlayerProfile(raw: any, fallbackId = 'player_default'): PlayerProfileFile {
  const obj = raw && typeof raw === 'object' ? raw : {};
  const playerId = safeKey(obj.playerId || obj.id || fallbackId);
  const badges = Array.isArray(obj.badges)
    ? obj.badges.map((b: any) => String(b).slice(0, 40)).slice(0, 32)
    : [];
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    playerId,
    name: String(obj.name || playerId).slice(0, 40),
    updatedAt: Math.max(0, Math.floor(Number(obj.updatedAt) || Date.now())),
    gamesPlayed: Math.max(0, Math.floor(Number(obj.gamesPlayed ?? obj.games) || 0)),
    wins: Math.max(0, Math.floor(Number(obj.wins) || 0)),
    favoriteDlc: typeof obj.favoriteDlc === 'string' ? obj.favoriteDlc.slice(0, 32) : undefined,
    badges
  };
}

export function loadPlayerProfile(playerId: string, baseDir = DEFAULT_DATA_DIR): PlayerProfileFile {
  const key = safeKey(playerId);
  const filePath = path.join(baseDir, 'players', `${key}.json`);
  if (!fs.existsSync(filePath)) {
    return migratePlayerProfile({ playerId: key }, key);
  }
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    return migratePlayerProfile(JSON.parse(text), key);
  } catch {
    return migratePlayerProfile({ playerId: key }, key);
  }
}

export function savePlayerProfile(
  profile: PlayerProfileFile,
  baseDir = DEFAULT_DATA_DIR
): PlayerProfileFile {
  const normalized = migratePlayerProfile(profile, profile.playerId);
  normalized.updatedAt = Date.now();
  const playersDir = path.join(baseDir, 'players');
  fs.mkdirSync(playersDir, { recursive: true });
  const filePath = path.join(playersDir, `${safeKey(normalized.playerId)}.json`);
  fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}

/**
 * Exports all bot memory files and player profiles into a compact `CTMEM1.<base64url>` string
 * so Render free-tier hosts can back up / restore state across container restarts.
 */
export function exportMemoryCode(baseDir = DEFAULT_DATA_DIR): string {
  const bundle: PersistenceBundle = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: Date.now(),
    bots: {},
    players: {}
  };

  const botsDir = path.join(baseDir, 'bots');
  if (fs.existsSync(botsDir)) {
    for (const f of fs.readdirSync(botsDir)) {
      if (!f.endsWith('.json')) continue;
      const id = f.slice(0, -5);
      bundle.bots[id] = loadBotMemory(id, baseDir);
    }
  }

  const playersDir = path.join(baseDir, 'players');
  if (fs.existsSync(playersDir)) {
    for (const f of fs.readdirSync(playersDir)) {
      if (!f.endsWith('.json')) continue;
      const id = f.slice(0, -5);
      bundle.players[id] = loadPlayerProfile(id, baseDir);
    }
  }

  const b64 = Buffer.from(JSON.stringify(bundle), 'utf8').toString('base64url');
  return `CTMEM1.${b64}`;
}

/**
 * Imports a `CTMEM1.<base64url>` memory bundle code and persists migrated & capped files.
 */
export function importMemoryCode(
  code: string,
  baseDir = DEFAULT_DATA_DIR
): { botsImported: number; playersImported: number } {
  const trimmed = String(code || '').trim();
  if (!trimmed.startsWith('CTMEM1.')) {
    throw new Error('Invalid memory code prefix (expected CTMEM1.)');
  }
  const payload = trimmed.slice('CTMEM1.'.length);
  const jsonText = Buffer.from(payload, 'base64url').toString('utf8');
  const parsed = JSON.parse(jsonText) as Partial<PersistenceBundle>;

  let botsImported = 0;
  let playersImported = 0;

  if (parsed.bots && typeof parsed.bots === 'object') {
    for (const [id, rawMem] of Object.entries(parsed.bots)) {
      saveBotMemory(migrateBotMemory(rawMem, id), baseDir);
      botsImported++;
    }
  }

  if (parsed.players && typeof parsed.players === 'object') {
    for (const [id, rawProf] of Object.entries(parsed.players)) {
      savePlayerProfile(migratePlayerProfile(rawProf, id), baseDir);
      playersImported++;
    }
  }

  return { botsImported, playersImported };
}
