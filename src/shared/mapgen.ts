// MODULE: board generator (radius, tile counts, numbers, presets, ports) driven by the registry | USED BY: engine createGame, lobby preview, tests
import type { Registry } from './registry';
import { assignNumbers, buildNumberPool } from './numbers';
import { rngNext, rngShuffle } from './rng';
import type { RngState } from './rng';
import { buildTopology } from './topology';
import type { HexInit } from './topology';
import type { Board, Rules } from './types';

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

  // Final tile types first (water chance may turn some into ocean), so the number pool matches the real count
  // of numbered tiles. Before, the pool was sized by every hex, which handed out extra 2s on the standard board.
  const finalTypes = coords.map((c, idx) => {
    const type = shuffledTypes[idx] || baseIds[0];
    if (preset?.waterChance && rngNext(rng) < preset.waterChance && (c.q !== 0 || c.r !== 0)) return 'water';
    return type;
  });
  const numberedIdx: number[] = [];
  finalTypes.forEach((type, idx) => {
    const def = reg.tiles.get(type);
    if (def && def.land && def.numbered) numberedIdx.push(idx);
  });
  const placed = assignNumbers(numberedIdx.map(i => coords[i]), buildNumberPool(numberedIdx.length), rng);
  const numberAt = new Map<number, number>();
  numberedIdx.forEach((idx, k) => numberAt.set(idx, placed[k]));

  const inits: HexInit[] = coords.map((c, idx) => ({
    q: c.q, r: c.r, type: finalTypes[idx], number: numberAt.get(idx) ?? null, ext: {}
  }));

  const extra = preset?.extra ? preset.extra(rules, total) : {};
  for (const hook of reg.hooks.afterMapGenerated) hook(inits, rules, rng, extra);

  const pool: string[] = [];
  for (const p of reg.ports.values()) {
    for (let i = 0; i < (p.copies ?? 1); i++) pool.push(p.id);
  }

  return buildTopology(inits, { isLand, autoPorts: rngShuffle(rng, pool) });
}
