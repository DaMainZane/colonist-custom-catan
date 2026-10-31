// MODULE: architecture guard: layer import rules and no new circular imports (R3 of Modular Rework Plan.md)
// Reads src/**/*.ts as text and builds the import graph, so it needs no registry or game state.
//
// Layer rules (who may import whom):
//   shared  -> shared only                      (pure engine, runs on server and client)
//   packs   -> shared, its own pack, packs/base (packs/index.ts may import every pack)
//   server  -> server, shared, packs
//   client  -> client, shared
// Cycles: a cycle is two or more files that import each other at runtime (type-only imports are ignored).
// Any cycle not listed in KNOWN_CYCLES fails. A listed cycle that no longer exists also fails, so the list only shrinks.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/** Layer breaks that are allowed on purpose. Key: "from -> to". Value: why. Keep this empty if you can. */
const ALLOWED_LAYER_EXCEPTIONS: Record<string, string> = {};

/** Existing cycles we have not removed yet. Each entry is the sorted member files joined by " <-> ". Only shrink this list. */
const KNOWN_CYCLES: string[] = [
  // client: the action handlers and the renderers import each other (R7 removes this by routing through the store)
  'client/actions <-> client/render/board <-> client/render/bridgepicker <-> client/render/drawer <-> client/render/hand <-> client/render/index <-> client/render/trade',
  // server: bot scheduler, network emit and view building import each other
  'server/bots/scheduler <-> server/net <-> server/view'
];

const SRC = path.resolve(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const files = walk(SRC).sort();
const fileSet = new Set(files);
const rel = (p: string) => path.relative(SRC, p).split(path.sep).join('/').replace(/\.ts$/, '');

function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), spec);
  for (const c of [base + '.ts', path.join(base, 'index.ts'), base]) {
    if (fileSet.has(c)) return c;
  }
  return null;
}

const IMPORT_RE =
  /(?:import|export)\s+(type\s+)?[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

/** runtime edges (cycle check) and all edges (layer check) */
const runtimeEdges = new Map<string, Set<string>>();
const allEdges = new Map<string, Set<string>>();
for (const f of files) {
  const text = fs
    .readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const runtime = new Set<string>();
  const all = new Set<string>();
  for (const m of text.matchAll(IMPORT_RE)) {
    const typeOnly = !!m[1];
    const target = resolveImport(f, (m[2] ?? m[3] ?? m[4]) as string);
    if (!target || target === f) continue;
    all.add(target);
    if (!typeOnly) runtime.add(target);
  }
  runtimeEdges.set(f, runtime);
  allEdges.set(f, all);
}

// ---- layer rules ----
const layerOf = (r: string) => r.split('/')[0];
const packOf = (r: string) => {
  const parts = r.split('/');
  return parts[0] === 'packs' && parts.length > 2 ? parts[1] : null; // null for packs/index
};

function layerViolation(from: string, to: string): string | null {
  const fl = layerOf(from);
  const tl = layerOf(to);
  if (fl === 'shared') return tl === 'shared' ? null : 'shared may import only shared';
  if (fl === 'client') return tl === 'client' || tl === 'shared' ? null : 'client may import only client and shared';
  if (fl === 'server') return tl === 'server' || tl === 'shared' || tl === 'packs' ? null : 'server may not import client';
  if (fl === 'packs') {
    if (tl === 'shared') return null;
    if (tl !== 'packs') return 'packs may import only shared and packs';
    const fp = packOf(from);
    if (fp === null) return null; // packs/index.ts lists every pack
    const tp = packOf(to);
    if (tp === null) return 'a pack may not import packs/index';
    return tp === fp || tp === 'base' ? null : `pack "${fp}" may not import pack "${tp}"`;
  }
  return null;
}

describe('architecture: layers', () => {
  it('every import respects the layer rules', () => {
    const violations: string[] = [];
    for (const [from, targets] of allEdges) {
      for (const to of targets) {
        const key = `${rel(from)} -> ${rel(to)}`;
        const why = layerViolation(rel(from), rel(to));
        if (why && !(key in ALLOWED_LAYER_EXCEPTIONS)) violations.push(`${key}   (${why})`);
      }
    }
    expect(violations, 'layer violations').toEqual([]);
  });

  it('every allowed exception is still needed', () => {
    const stale = Object.keys(ALLOWED_LAYER_EXCEPTIONS).filter((key) => {
      const [from, to] = key.split(' -> ');
      const f = path.join(SRC, ...from.split('/')) + '.ts';
      const targets = allEdges.get(f);
      const t1 = path.join(SRC, ...to.split('/')) + '.ts';
      const t2 = path.join(SRC, ...to.split('/'), 'index.ts');
      return !(targets?.has(t1) || targets?.has(t2));
    });
    expect(stale, 'exceptions that no longer apply (delete them)').toEqual([]);
  });
});

// ---- cycles (Tarjan strongly connected components) ----
function findCycles(): string[] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[] = [];

  const visit = (v: string) => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of runtimeEdges.get(v) ?? []) {
      if (!idx.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, idx.get(w)!));
      }
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) out.push(comp.map(rel).sort().join(' <-> '));
    }
  };
  for (const f of files) if (!idx.has(f)) visit(f);
  return out.sort();
}

describe('architecture: circular imports', () => {
  const found = findCycles();

  it('has no cycle that is not in KNOWN_CYCLES', () => {
    expect(
      found.filter((c) => !KNOWN_CYCLES.includes(c)),
      'new circular imports (break them, or add to KNOWN_CYCLES only as a last resort)'
    ).toEqual([]);
  });

  it('KNOWN_CYCLES only lists cycles that still exist', () => {
    expect(
      KNOWN_CYCLES.filter((c) => !found.includes(c)),
      'cycles that are gone (delete them from KNOWN_CYCLES)'
    ).toEqual([]);
  });
});
