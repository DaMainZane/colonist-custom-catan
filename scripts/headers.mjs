// scripts/headers.mjs
// Keeps the one-line header on every src/**/*.ts file correct:
//   // MODULE: what it does | DEPENDS ON: a, b | USED BY: c, d
// "what it does" is hand-written. DEPENDS ON and USED BY are computed from the import graph, so they never go stale.
//
//   node scripts/headers.mjs            report only (changes nothing)
//   node scripts/headers.mjs --write    insert missing headers, refresh stale ones
//   node scripts/headers.mjs --check    report, exit 1 if a header is missing or still TODO (for tests / CI)
//   node scripts/headers.mjs --check --strict   also exit 1 if DEPENDS ON / USED BY are out of date
//
// A file with no header gets "TODO describe" as its text; replace that by hand.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const args = new Set(process.argv.slice(2));
const WRITE = args.has('--write');
const CHECK = args.has('--check');
const STRICT = args.has('--strict'); // with --check, also fail on stale DEPENDS ON / USED BY lists
const CAP = 6; // names listed before "+N more"

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const files = walk(src).sort();
const fileSet = new Set(files);
const rel = (p) => path.relative(src, p).split(path.sep).join('/').replace(/\.ts$/, '');

function resolveImport(from, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), spec);
  for (const c of [base + '.ts', path.join(base, 'index.ts'), base]) {
    if (fileSet.has(c)) return c;
  }
  return null;
}

const IMPORT_RE =
  /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const HEADER_RE = /^\/\/ MODULE:\s*(.*)$/;

// ---- read every file, build the import graph ----
const info = new Map();
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const headerIdx = lines.slice(0, 8).findIndex((l) => HEADER_RE.test(l));
  const deps = new Set();
  for (const m of text.matchAll(IMPORT_RE)) {
    const target = resolveImport(f, m[1] ?? m[2] ?? m[3]);
    if (target && target !== f) deps.add(target);
  }
  info.set(f, { text, eol, lines, headerIdx, deps, usedBy: new Set() });
}
for (const [f, d] of info) for (const t of d.deps) info.get(t).usedBy.add(f);

const list = (set) => {
  const names = [...set].map(rel).sort();
  if (names.length === 0) return 'none';
  return names.length <= CAP ? names.join(', ') : `${names.slice(0, CAP).join(', ')}, +${names.length - CAP} more`;
};

// ---- compare with what each header should be ----
const missing = [];
const stale = [];
const todo = [];
let changed = 0;

for (const f of files) {
  const d = info.get(f);
  let what = 'TODO describe';
  if (d.headerIdx >= 0) {
    what = HEADER_RE.exec(d.lines[d.headerIdx])[1].split(' | ')[0].trim() || 'TODO describe';
  }
  const wanted = `// MODULE: ${what} | DEPENDS ON: ${list(d.deps)} | USED BY: ${list(d.usedBy)}`;
  if (what.startsWith('TODO')) todo.push(rel(f));

  if (d.headerIdx < 0) {
    missing.push(rel(f));
    if (WRITE) {
      const at = d.lines[0]?.startsWith('#!') ? 1 : 0;
      d.lines.splice(at, 0, wanted);
      fs.writeFileSync(f, d.lines.join(d.eol));
      changed++;
    }
  } else if (d.lines[d.headerIdx] !== wanted) {
    stale.push(rel(f));
    if (WRITE) {
      d.lines[d.headerIdx] = wanted;
      fs.writeFileSync(f, d.lines.join(d.eol));
      changed++;
    }
  }
}

const show = (title, arr) => {
  if (!arr.length) return;
  console.log(`\n${title} (${arr.length})`);
  for (const a of arr) console.log(`  ${a}`);
};

console.log(`${files.length} files scanned`);
show('No header' + (WRITE ? ' (inserted, text is TODO)' : ''), missing);
show('Header out of date' + (WRITE ? ' (refreshed)' : ''), stale);
show('Text still TODO, write a one-line description', todo);
if (WRITE) console.log(`\n${changed} files written`);

if (CHECK && (missing.length || todo.length || (STRICT && stale.length))) {
  console.log('\nHeader check failed. Run: node scripts/headers.mjs --write');
  process.exit(1);
}
