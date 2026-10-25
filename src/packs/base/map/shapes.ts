// MODULE: base map shapes (continent, ring, islands, archipelago, continents; lake, river, satellites, ragged) | USED BY: packs/base/map
import { rngInt, rngNext } from '../../../shared';
import type { MapCtx, PackApi } from '../../../shared';
// The land-field helpers are imported from their module directly (their names are generic and stay out of the shared index).
import {
  cellDistance, fillHeight, growBlobs, isArc, isCoastal, limitLand, oceanDistance, pickCenters, splitSizes, takeTop, waterNeighbours
} from '../../../shared/mapshape';
import type { BlobSpec, LandField } from '../../../shared/mapshape';

const clampInt = (v: number, min: number, max: number) => Math.max(min, Math.min(max, Math.floor(v)));

/** Land density slider shared by the base shapes (percent of the canvas). */
const landParam = (def: number) => ({ id: 'land', label: 'Land', min: 30, max: 90, step: 5, default: def });

/** Noise frequency (lattice units per cell) that gives features about half the canvas wide. */
const baseFreq = (f: LandField) => 1 / (0.5 * f.radius + 1.5);

function landDistance(f: LandField): Int32Array {
  const d = new Int32Array(f.size).fill(-1);
  const queue: number[] = [];
  for (let i = 0; i < f.size; i++) if (f.land[i]) { d[i] = 0; queue.push(i); }
  for (let k = 0; k < queue.length; k++) {
    const c = queue[k];
    for (const j of f.nb[c]) {
      if (j < 0 || d[j] >= 0) continue;
      d[j] = d[c] + 1;
      queue.push(j);
    }
  }
  return d;
}

// ---- Satellites -------------------------------------------------------------------------------------------------

const SAT_PATTERN = [2, 1, 3];
const satSizes = (n: number): number[] => Array.from({ length: n }, (_, i) => SAT_PATTERN[i % SAT_PATTERN.length]);
const satCount = (f: LandField, ctx: MapCtx): number => ctx.param('satellites.count') || Math.max(2, Math.round(f.L / 12));

function placeSatellites(f: LandField, ctx: MapCtx): void {
  for (const size of satSizes(satCount(f, ctx))) {
    const dist = landDistance(f);
    const pool: number[] = [];
    for (let i = 0; i < f.size; i++) if (!f.land[i] && !f.locked[i] && dist[i] >= 2 && dist[i] <= 4) pool.push(i);
    if (pool.length === 0) for (let i = 0; i < f.size; i++) if (!f.land[i] && !f.locked[i] && dist[i] >= 2) pool.push(i);
    if (pool.length === 0) { f.failed = 'satellites: no open water'; return; }
    const start = pool[rngInt(f.rng, pool.length)];
    const isle = [start];
    f.land[start] = 1;
    f.sat[start] = 1;
    while (isle.length < size) {
      const cand: number[] = [];
      for (const c of isle) {
        for (const n of f.nb[c]) {
          if (n < 0 || f.land[n] || f.locked[n] || cand.includes(n)) continue;
          // The islet keeps one water cell between itself and every other landmass.
          if (f.nb[n].some(m => m >= 0 && f.land[m] && !isle.includes(m))) continue;
          cand.push(n);
        }
      }
      if (cand.length === 0) break;
      cand.sort((a, b) => a - b);
      const pick = cand[rngInt(f.rng, cand.length)];
      isle.push(pick);
      f.land[pick] = 1;
      f.sat[pick] = 1;
    }
    if (isle.length < size) { f.failed = 'satellites: no room'; return; }
  }
}

// ---- Lake -------------------------------------------------------------------------------------------------------

const lakeCells = (f: LandField, ctx: MapCtx): number => Math.max(1, Math.round((f.L * ctx.param('lake.share')) / 100));

function carveLakes(f: LandField, ctx: MapCtx): void {
  const total = lakeCells(f, ctx);
  const lakes = Math.max(1, ctx.param('lake.count') || 1);
  for (let li = 0; li < lakes; li++) {
    const want = Math.floor(total / lakes) + (li < total % lakes ? 1 : 0);
    if (want <= 0) continue;
    // Lake cells keep at least one land tile between themselves and any other water (so a lake never opens to the sea).
    const dist = oceanDistance(f);
    let start = -1;
    for (let i = 0; i < f.size; i++) {
      if (!f.land[i] || f.keep[i] || dist[i] < 2) continue;
      if (start < 0 || dist[i] > dist[start]) start = i;
    }
    if (start < 0) return;
    const lake = [start];
    const inLake = new Uint8Array(f.size);
    inLake[start] = 1;
    while (lake.length < want) {
      let best = -1;
      for (const c of lake) {
        for (const n of f.nb[c]) {
          if (n < 0 || inLake[n] || !f.land[n] || f.keep[n] || dist[n] < 2) continue;
          if (best < 0 || dist[n] > dist[best] || (dist[n] === dist[best] && (f.h[n] > f.h[best] || (f.h[n] === f.h[best] && n < best)))) best = n;
        }
      }
      if (best < 0) break;
      inLake[best] = 1;
      lake.push(best);
    }
    for (const c of lake) { f.land[c] = 0; f.locked[c] = 1; }
    for (const c of lake) for (const n of f.nb[c]) if (n >= 0 && f.land[n]) f.keep[n] = 1;
    f.lakes++;
  }
}

// ---- River ------------------------------------------------------------------------------------------------------

const riverLength = (f: LandField, ctx: MapCtx): number => clampInt(ctx.param('river.length') || Math.max(3, Math.round(f.radius * 1.5)), 2, 60);

/**
 * A river is a one-tile-wide channel of water that starts on the shore and walks inland: each step goes through a
 * random side of the current tile. The longer it runs without splitting, the likelier a branch. A step may only enter
 * a tile that touches no other water than the channel it comes from, so a river is an inlet that never reaches
 * the sea or a lake a second time and never cuts the land in two.
 */
function carveRiver(f: LandField, ctx: MapCtx): void {
  const len = riverLength(f, ctx);
  const starts: number[] = [];
  for (let i = 0; i < f.size; i++) {
    if (!f.land[i] || f.keep[i] || !isCoastal(f, i) || !isArc(f, i)) continue;
    // Water on the shore must be open sea, not a lake.
    if (f.nb[i].some(j => j >= 0 && !f.land[j] && f.locked[j] && !f.river[j])) continue;
    starts.push(i);
  }
  if (starts.length === 0) return;
  const carve = (c: number) => { f.land[c] = 0; f.locked[c] = 1; f.river[c] = 1; };
  const first = starts[rngInt(f.rng, starts.length)];
  carve(first);
  let carved = 1;
  let heads = [first];
  let sinceSplit = 0;
  const options = (head: number): number[] => {
    const out: number[] = [];
    for (const n of f.nb[head]) {
      // Never reach the canvas edge (open sea) and never cut the land: the tile must keep one unbroken arc of land around it.
      if (n < 0 || !f.land[n] || f.keep[n] || waterNeighbours(f, n) !== 1) continue;
      if (f.nb[n].some(j => j < 0) || !isArc(f, n)) continue;
      out.push(n);
    }
    return out;
  };
  while (carved < len && heads.length > 0) {
    const next: number[] = [];
    for (const head of heads) {
      if (carved >= len) break;
      const opts = options(head);
      if (opts.length === 0) continue;
      const n = opts[rngInt(f.rng, opts.length)];
      carve(n);
      carved++;
      sinceSplit++;
      next.push(n);
      const chance = Math.min(0.5, 0.05 + 0.04 * sinceSplit);
      if (carved < len && rngNext(f.rng) < chance) {
        const again = options(head).filter(m => m !== n && waterNeighbours(f, m) === 1);
        if (again.length > 0) {
          const m = again[rngInt(f.rng, again.length)];
          carve(m);
          carved++;
          sinceSplit = 0;
          next.push(m);
        }
      }
    }
    heads = next;
  }
}

// ---- Registration -------------------------------------------------------------------------------------------------

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function registerShapes(api: PackApi): void {
  api.mapShape({
    id: 'continent',
    label: 'Continent',
    description: 'One landmass with a natural coast.',
    stage: 'shape',
    phase: 'base',
    slot: 'shape',
    ruleOverrides: { requireConnected: true },
    params: [landParam(70)],
    run(f) {
      f.single = true;
      f.cleanup = true;
      fillHeight(f, { freq: baseFreq(f), amp: 2.4, pull: 0.9 });
      takeTop(f, f.baseTarget);
    }
  });

  api.mapShape({
    id: 'ring',
    label: 'Ring',
    description: 'A band of land around an enclosed lagoon.',
    stage: 'shape',
    phase: 'base',
    slot: 'shape',
    conflicts: ['lake'],
    ruleOverrides: { requireConnected: true },
    params: [landParam(60), { id: 'ring.lagoon', label: 'Lagoon size', min: 10, max: 50, step: 5, default: 25 }],
    run(f, ctx) {
      f.single = true;
      f.cleanup = true;
      const R = f.radius;
      const outside = (lr: number) => { let n = 0; for (let i = 0; i < f.size; i++) if (f.dist[i] > lr) n++; return n; };
      let lagoon = Math.max(1, Math.round((R * ctx.param('ring.lagoon')) / 100));
      while (lagoon > 1 && outside(lagoon) < f.baseTarget) lagoon--;
      // From radius 4 up, the two rings next to the lagoon are always land when the land budget allows it, so the band is
      // at least 2 tiles thick all the way round and roads never squeeze through a 1-wide neck (design 6.8).
      const inner = (l: number) => 6 * (l + 1) + 6 * (l + 2);
      let wide = R >= 4;
      if (wide) {
        while (lagoon > 1 && inner(lagoon) > f.baseTarget) lagoon--;
        wide = inner(lagoon) <= f.baseTarget && lagoon + 2 <= R;
      }
      limitLand(f, outside(lagoon));
      for (let i = 0; i < f.size; i++) if (f.dist[i] <= lagoon) f.locked[i] = 1;
      let cum = 0;
      let outer = lagoon + 1;
      for (let d = lagoon + 1; d <= R; d++) {
        cum += 6 * d;
        outer = d;
        if (cum >= f.baseTarget) break;
      }
      const mid = (lagoon + 1 + outer) / 2;
      const width = outer - lagoon + 1;
      fillHeight(f, { freq: baseFreq(f), amp: 1.2, pull: 0, rim: 0 });
      for (let i = 0; i < f.size; i++) {
        f.h[i] -= (1.6 * Math.abs(f.dist[i] - mid)) / width;
        // The core of the band is always land, so the ring is closed and the lagoon stays enclosed.
        if (Math.abs(f.dist[i] - mid) <= 0.5) f.h[i] += 2;
        if (wide && (f.dist[i] === lagoon + 1 || f.dist[i] === lagoon + 2)) f.h[i] += 2;
      }
      takeTop(f, f.baseTarget);
    }
  });

  api.mapShape({
    id: 'islands',
    label: 'Islands',
    description: 'A few big islands.',
    stage: 'shape',
    phase: 'base',
    slot: 'shape',
    params: [landParam(55), { id: 'islands.count', label: 'Islands (0 = automatic)', min: 0, max: 12, step: 1, default: 0 }],
    run(f, ctx) {
      f.single = false;
      f.cleanup = false;
      f.minSize = 6;
      const total = f.baseTarget;
      let k = ctx.param('islands.count') || clampInt(Math.round(f.radius / 1.5), 2, 8);
      while (k > 1 && k * 6 > total) k--;
      const sizes = splitSizes(f.rng, total, k, 6, 7);
      const centers = pickCenters(f, k, 1);
      if (!sizes || centers.length < k) { f.failed = 'islands: sizes'; return; }
      const specs: BlobSpec[] = sizes.map((size, i) => ({
        center: centers[i],
        size,
        stretch: 1 + rngInt(f.rng, 40) / 100,
        axis: rngInt(f.rng, 6),
        lobe: 0,
        lobeDir: 0,
        ox: 17.3 * (i + 1),
        oy: 41.9 * (i + 1)
      }));
      if (!growBlobs(f, specs, 1)) f.failed = 'islands: grow';
    }
  });

  api.mapShape({
    id: 'archipelago',
    label: 'Archipelago',
    description: 'Many small islands. Most go unused.',
    stage: 'shape',
    phase: 'base',
    slot: 'shape',
    params: [landParam(45), { id: 'archipelago.count', label: 'Islands (0 = automatic)', min: 0, max: 20, step: 1, default: 0 }],
    run(f, ctx) {
      f.single = false;
      f.cleanup = false;
      f.minSize = 3;
      const total = f.baseTarget;
      // One island must hold a table, so the biggest gets at least 7 tiles and the rest share what is left.
      let k = ctx.param('archipelago.count') || clampInt(Math.round(1.5 * f.radius), 4, 20);
      while (k > 1 && 7 + (k - 1) * 3 > total) k--;
      const sizes = splitSizes(f.rng, total, k, 3, 7);
      const centers = pickCenters(f, k, 1);
      if (!sizes || centers.length < k) { f.failed = 'archipelago: sizes'; return; }
      const specs: BlobSpec[] = sizes.map((size, i) => ({
        center: centers[i],
        size,
        stretch: 1 + rngInt(f.rng, 30) / 100,
        axis: rngInt(f.rng, 6),
        lobe: 0,
        lobeDir: 0,
        ox: 23.1 * (i + 1),
        oy: 53.7 * (i + 1)
      }));
      if (!growBlobs(f, specs, 1)) f.failed = 'archipelago: grow';
    }
  });

  api.mapShape({
    id: 'continents',
    label: 'Continents',
    description: '2 to 4 big landmasses with open water between them. Each has its own outline.',
    stage: 'shape',
    phase: 'base',
    slot: 'shape',
    params: [
      landParam(65),
      { id: 'continents.count', label: 'Continents', min: 2, max: 4, step: 1, default: 3 },
      { id: 'continents.gap', label: 'Water between', min: 1, max: 4, step: 1, default: 2 },
      { id: 'continents.stretch', label: 'Longest shape (%)', min: 100, max: 220, step: 10, default: 160 }
    ],
    run(f, ctx) {
      f.single = false;
      f.cleanup = false;
      const total = f.baseTarget;
      const gap = clampInt(ctx.param('continents.gap'), 1, 4);
      const stretchMax = Math.max(100, ctx.param('continents.stretch')) / 100;
      // Each continent gets at least 15% of the land, and no fewer than 3 tiles.
      const min = Math.max(3, Math.ceil(total * 0.15));
      f.minSize = min;
      let k = clampInt(ctx.param('continents.count'), 2, 4);
      while (k > 1 && k * min > total) k--;
      const sizes = splitSizes(f.rng, total, k, min, 7);
      const centers = pickCenters(f, k, 1);
      if (!sizes || centers.length < k) { f.failed = 'continents: sizes'; return; }
      for (let a = 0; a < k; a++) {
        for (let b = a + 1; b < k; b++) {
          if (cellDistance(f, centers[a], centers[b]) < gap + 2) { f.failed = 'continents: centers too close'; return; }
        }
      }
      const specs: BlobSpec[] = sizes.map((size, i) => ({
        center: centers[i],
        size,
        stretch: lerp(1, stretchMax, rngNext(f.rng)),
        axis: rngInt(f.rng, 6),
        lobe: 0.6 + rngNext(f.rng) * 0.8,
        lobeDir: rngInt(f.rng, 6),
        ox: 29.7 * (i + 1),
        oy: 67.3 * (i + 1),
        amp: 1.4
      }));
      if (!growBlobs(f, specs, gap)) f.failed = 'continents: grow';
    }
  });

  api.mapShape({
    id: 'lake',
    label: 'Lake',
    description: 'An enclosed lake inside the land. Lake shores get no ports.',
    stage: 'shape',
    phase: 'carve',
    conflicts: ['archipelago', 'ring'],
    params: [
      { id: 'lake.share', label: 'Lake size (% of land)', min: 5, max: 30, step: 1, default: 12 },
      { id: 'lake.count', label: 'Lakes', min: 1, max: 3, step: 1, default: 1 }
    ],
    budget: (f, ctx) => lakeCells(f, ctx),
    run: (f, ctx) => carveLakes(f, ctx)
  });

  api.mapShape({
    id: 'river',
    label: 'River',
    description: 'A channel of water that winds inland from the shore and may split.',
    stage: 'shape',
    phase: 'carve',
    conflicts: ['archipelago'],
    params: [{ id: 'river.length', label: 'Length in tiles (0 = automatic)', min: 0, max: 60, step: 1, default: 0 }],
    budget: (f, ctx) => riverLength(f, ctx),
    run: (f, ctx) => carveRiver(f, ctx)
  });

  api.mapShape({
    id: 'satellites',
    label: 'Satellite islets',
    description: 'One to three tile islets in the open sea around the mainland.',
    stage: 'shape',
    phase: 'scatter',
    conflicts: ['hexagon', 'islands', 'archipelago'],
    params: [{ id: 'satellites.count', label: 'Islets (0 = automatic)', min: 0, max: 30, step: 1, default: 0 }],
    budget: (f, ctx) => satSizes(satCount(f, ctx)).reduce((a, b) => a + b, 0),
    run: (f, ctx) => placeSatellites(f, ctx)
  });

  api.mapShape({
    id: 'ragged',
    label: 'Ragged coast',
    description: 'Fjords and bays: a finer, rougher coastline that stays connected.',
    stage: 'shape',
    phase: 'tweak',
    conflicts: ['hexagon'],
    // A long, broken coast is the point, so more thin land is fine.
    ruleOverrides: { thinLand: 0.4 },
    params: [{ id: 'ragged.amount', label: 'Ruggedness (%)', min: 20, max: 100, step: 10, default: 80 }],
    run(f, ctx) {
      f.ragged = Math.max(0, Math.min(1, ctx.param('ragged.amount') / 100));
      // Spikes are the point: skip spike removal (one-cell holes are still filled).
      f.spikes = false;
    }
  });
}
