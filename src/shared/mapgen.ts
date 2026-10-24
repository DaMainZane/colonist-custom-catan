// MODULE: board generator (radius, tile counts, numbers, presets, ports) driven by the registry | USED BY: engine createGame, lobby preview, tests
import type { Registry } from './registry';
import { rngNext, rngShuffle } from './rng';
import type { RngState } from './rng';
import { buildTopology } from './topology';
import type { HexInit } from './topology';
import type { Board, Rules } from './types';

const NUMBER_POOL = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

function clampInt(val: any, min: number, max: number, fallback: number): number {
  const n = Number(val);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export function generateBoard(reg: Registry, rules: Rules, rng: RngState, presetId = 'standard'): Board {
  const preset = reg.presets.get(presetId) ?? reg.presets.get('standard');
  const radius = clampInt(rules.boardRadius, 1, 50, 2);
  const isLand = (t: string) => !!reg.tiles.get(t)?.land;

  const coords: { q: number; r: number }[] = [];
  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r++) coords.push({ q, r });
  }
  const total = coords.length;

  if (preset?.blank) {
    return buildTopology(coords.map(c => ({ q: c.q, r: c.r, type: 'water', number: null })), { isLand });
  }

  // Special tiles first (always keep at least one base tile), then base tiles cyclically.
  const counts: Record<string, number> = { ...rules.tileCounts, ...(preset?.tileCounts ? preset.tileCounts(rules, total) : {}) };
  const types: string[] = [];
  let budget = Math.max(0, total - 1);
  for (const [id, want] of Object.entries(counts)) {
    if (!reg.tiles.has(id)) continue;
    const n = Math.max(0, Math.min(Math.floor(Number(want) || 0), budget));
    for (let i = 0; i < n; i++) types.push(id);
    budget -= n;
  }
  const baseIds = [...reg.tiles.values()].filter(t => t.base).map(t => t.id);
  if (baseIds.length === 0) throw new Error('No base tiles registered (tile.base = true)');
  for (let i = 0; types.length < total; i++) types.push(baseIds[i % baseIds.length]);
  const shuffledTypes = rngShuffle(rng, types);

  const numbers: number[] = [];
  for (let i = 0; i < total; i++) numbers.push(NUMBER_POOL[i % NUMBER_POOL.length]);
  const shuffledNumbers = rngShuffle(rng, numbers);

  let numIdx = 0;
  const inits: HexInit[] = coords.map((c, idx) => {
    let type = shuffledTypes[idx] || baseIds[0];
    if (preset?.waterChance && rngNext(rng) < preset.waterChance && (c.q !== 0 || c.r !== 0)) {
      type = 'water';
    }
    const def = reg.tiles.get(type);
    const number = def && def.land && def.numbered ? shuffledNumbers[numIdx++] : null;
    return { q: c.q, r: c.r, type, number, ext: {} };
  });

  const extra = preset?.extra ? preset.extra(rules, total) : {};
  for (const hook of reg.hooks.afterMapGenerated) hook(inits, rules, rng, extra);

  const pool: string[] = [];
  for (const p of reg.ports.values()) {
    for (let i = 0; i < (p.copies ?? 1); i++) pool.push(p.id);
  }

  return buildTopology(inits, { isLand, autoPorts: rngShuffle(rng, pool) });
}
