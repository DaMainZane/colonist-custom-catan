// scripts/index.mjs
// Generates the file tables for src/ in INDEX.md from the `// MODULE:` header of every src/**/*.ts file.
// Only the description (the text before the first " | ") is used, so the table changes only when a file is
// added, moved, deleted or re-described, never when imports change.
//
//   node scripts/index.mjs           rewrite the src tables in INDEX.md
//   node scripts/index.mjs --check   change nothing, exit 1 if INDEX.md is stale (used by tests/index.test.ts)
//
// Root, Docs and tests/ tables in INDEX.md stay hand-written. Each src table is found by its heading (see SECTIONS)
// and replaced up to the end of the table. A file under src/ that no section covers is an error.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const indexPath = path.join(root, 'INDEX.md');
const CHECK = process.argv.slice(2).includes('--check');

// dir is relative to src/. A file goes to the section with the longest matching dir.
// Row paths are shown relative to the section dir. heading is matched with startsWith.
const SECTIONS = [
  { dir: 'shared', heading: '## `src/shared/`' },
  { dir: 'packs', heading: '## `src/packs/`' },
  { dir: 'server', heading: '## `src/server/`' },
  { dir: 'server/bots', heading: '### `src/server/bots/`' },
  { dir: 'client', heading: '## `src/client/`' },
];

const HEADER_RE = /^\/\/ MODULE:\s*(.*)$/;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const relSrc = (p) => path.relative(src, p).split(path.sep).join('/');
// index.ts first inside each folder, then alphabetical
const sortKey = (p) => p.replace(/(^|\/)index\.ts$/, '$1\u0000');

const errors = [];
const rows = new Map(SECTIONS.map((s) => [s.dir, []]));

for (const f of walk(src)) {
  const rel = relSrc(f);
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/).slice(0, 8);
  const hit = lines.map((l) => HEADER_RE.exec(l)).find(Boolean);
  const what = hit ? hit[1].split(' | ')[0].trim() : '';
  if (!what || what.startsWith('TODO')) errors.push(`src/${rel}: missing or TODO header (run npm run headers)`);

  const section = SECTIONS.filter((s) => rel.startsWith(s.dir + '/')).sort((a, b) => b.dir.length - a.dir.length)[0];
  if (!section) {
    errors.push(`src/${rel}: no section in scripts/index.mjs covers this folder (add one to SECTIONS and a heading to INDEX.md)`);
    continue;
  }
  rows.get(section.dir).push({ rel: rel.slice(section.dir.length + 1), what: what || 'TODO describe' });
}

const cell = (s) => s.replace(/(?<!\\)\|/g, '\\|');
function tableFor(dir) {
  const list = rows.get(dir).sort((a, b) => (sortKey(a.rel) < sortKey(b.rel) ? -1 : sortKey(a.rel) > sortKey(b.rel) ? 1 : 0));
  return ['| File | What it does |', '|---|---|', ...list.map((r) => `| \`${r.rel}\` | ${cell(r.what)} |`)];
}

const text = fs.readFileSync(indexPath, 'utf8');
const eol = text.includes('\r\n') ? '\r\n' : '\n';
const lines = text.split(/\r?\n/);
const stale = [];

for (const s of SECTIONS) {
  const h = lines.findIndex((l) => l.startsWith(s.heading));
  if (h < 0) {
    errors.push(`INDEX.md: heading "${s.heading}" not found`);
    continue;
  }
  let start = h + 1;
  while (start < lines.length && !lines[start].startsWith('|')) {
    if (lines[start].startsWith('#')) break;
    start++;
  }
  if (start >= lines.length || !lines[start].startsWith('|')) {
    errors.push(`INDEX.md: no table under "${s.heading}"`);
    continue;
  }
  let end = start;
  while (end < lines.length && lines[end].startsWith('|')) end++;
  const next = tableFor(s.dir);
  const same = next.length === end - start && next.every((l, i) => l === lines[start + i]);
  if (!same) stale.push(`src/${s.dir}/`);
  lines.splice(start, end - start, ...next);
}

if (errors.length) {
  console.log(errors.join('\n'));
  process.exit(1);
}

if (CHECK) {
  if (stale.length) {
    console.log(`INDEX.md is out of date for: ${stale.join(', ')}\nRun: npm run index`);
    process.exit(1);
  }
  console.log('INDEX.md is up to date');
} else {
  fs.writeFileSync(indexPath, lines.join(eol));
  console.log(stale.length ? `INDEX.md updated: ${stale.join(', ')}` : 'INDEX.md already up to date');
}
