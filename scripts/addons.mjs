// scripts/addons.mjs
// Generates `src/packs/<dlc>/addons.generated.ts` from the exported `AddonDef` objects in each DLC pack folder.
// Orders addons deterministically so every dependency comes before the addons that depend on it.
// Fails loudly (exit 1) on a dependency cycle, a missing dependency, a duplicate addon id, or an addon id
// that does not start with `<packId>.`.
//
//   node scripts/addons.mjs           write/update src/packs/<dlc>/addons.generated.ts
//   node scripts/addons.mjs --check   change nothing, exit 1 if any generated file is missing or stale

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const packsDirIdx = args.indexOf('--packs-dir');
const packsDir = packsDirIdx >= 0 && args[packsDirIdx + 1]
  ? path.resolve(args[packsDirIdx + 1])
  : path.join(root, 'src', 'packs');

const CAP = 6; // matches scripts/headers.mjs

// Canonical tie-break order for independent baseline addons so the shipped manifest order stays identical.
// Topological sort still takes precedence: any `deps` edge always orders a dependency before its dependants.
const CANONICAL_ORDER = [
  'tidebound.bridges',
  'tidebound.rickety_bridges',
  'tidebound.tides',
  'tidebound.rising_sea',
  'tidebound.harbor',
  'tidebound.fishing',
  'tidebound.wrecks',
  'tidebound.pirates'
];
const CANONICAL_RANK = new Map(CANONICAL_ORDER.map((id, idx) => [id, idx]));

/** Extract balanced `{ ... }` block starting at `openBraceIdx` (ignoring braces inside strings and comments). */
function extractBraceBlock(text, openBraceIdx) {
  let depth = 0;
  let i = openBraceIdx;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < n && text[i] !== quote) {
        if (text[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(openBraceIdx, i + 1);
    }
    i++;
  }
  return text.slice(openBraceIdx);
}

/** Extract top-level property `key` inside an object literal `{ ... }`. */
function extractTopLevelProp(block, propName) {
  let depth = 0;
  let i = 0;
  const n = block.length;
  while (i < n) {
    const ch = block[i];
    const next = block[i + 1];
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < n && block[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n && !(block[i] === '*' && block[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < n && block[i] !== quote) {
        if (block[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (ch === '{' || ch === '[' || ch === '(') {
      depth++;
      i++;
      continue;
    }
    if (ch === '}' || ch === ']' || ch === ')') {
      depth--;
      i++;
      continue;
    }
    if (depth === 1) {
      const rest = block.slice(i);
      const m = new RegExp(`^${propName}\\s*:\\s*`).exec(rest);
      if (m && (i === 0 || /[\s,{;]/.test(block[i - 1]))) {
        return rest.slice(m[0].length);
      }
    }
    i++;
  }
  return null;
}

function parseAddonsInFile(filePath, fileBase) {
  const text = fs.readFileSync(filePath, 'utf8');
  const re = /export\s+const\s+([A-Za-z0-9_$]+)\s*:\s*AddonDef\s*=\s*\{/g;
  const found = [];
  for (const m of text.matchAll(re)) {
    const exportName = m[1];
    const openBraceIdx = m.index + m[0].length - 1;
    const block = extractBraceBlock(text, openBraceIdx);

    const idRest = extractTopLevelProp(block, 'id');
    const idMatch = idRest ? /^['"]([^'"]+)['"]/.exec(idRest) : null;
    if (!idMatch) {
      throw new Error(`${filePath}: AddonDef "${exportName}" is missing a string literal id`);
    }
    const id = idMatch[1];

    const deps = [];
    const depsRest = extractTopLevelProp(block, 'deps');
    if (depsRest && depsRest.startsWith('[')) {
      const closeBracket = depsRest.indexOf(']');
      const arrText = closeBracket >= 0 ? depsRest.slice(1, closeBracket) : depsRest;
      for (const dm of arrText.matchAll(/['"]([^'"]+)['"]/g)) {
        deps.push(dm[1]);
      }
    }

    const allowRest = extractTopLevelProp(block, 'allowCrossDlcDep');
    const allowCrossDlcDep = allowRest ? /^true\b/.test(allowRest) : false;

    found.push({
      id,
      exportName,
      fileBase,
      filePath,
      deps,
      allowCrossDlcDep
    });
  }
  return found;
}

function detectPackId(packDirPath, dirName) {
  const indexPath = path.join(packDirPath, 'index.ts');
  if (fs.existsSync(indexPath)) {
    const txt = fs.readFileSync(indexPath, 'utf8');
    const m = /export\s+const\s+\w+\s*:\s*Pack\s*=\s*\{[\s\S]*?\bid\s*:\s*['"]([^'"]+)['"]/.exec(txt);
    if (m) return m[1];
  }
  return dirName.replace(/^_/, '');
}

function compareReady(a, b) {
  const ra = CANONICAL_RANK.has(a.id) ? CANONICAL_RANK.get(a.id) : Infinity;
  const rb = CANONICAL_RANK.has(b.id) ? CANONICAL_RANK.get(b.id) : Infinity;
  if (ra !== rb) return ra - rb;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  if (a.fileBase !== b.fileBase) return a.fileBase < b.fileBase ? -1 : 1;
  return a.exportName < b.exportName ? -1 : a.exportName > b.exportName ? 1 : 0;
}

function findCyclePath(remaining, samePackDeps) {
  const remIds = new Set(remaining.map((a) => a.id));
  const visited = new Set();
  const stack = [];
  const onStack = new Set();

  function dfs(id) {
    visited.add(id);
    stack.push(id);
    onStack.add(id);
    for (const dep of samePackDeps.get(id) || []) {
      if (!remIds.has(dep)) continue;
      if (!visited.has(dep)) {
        const cyc = dfs(dep);
        if (cyc) return cyc;
      } else if (onStack.has(dep)) {
        const idx = stack.indexOf(dep);
        return [...stack.slice(idx), dep];
      }
    }
    stack.pop();
    onStack.delete(id);
    return null;
  }

  for (const a of remaining) {
    if (!visited.has(a.id)) {
      const cyc = dfs(a.id);
      if (cyc) return cyc.reverse().join(' -> ');
    }
  }
  return remaining.map((a) => a.id).join(' <-> ');
}

function formatHeaderList(names) {
  const sorted = [...names].sort();
  if (sorted.length === 0) return 'none';
  return sorted.length <= CAP
    ? sorted.join(', ')
    : `${sorted.slice(0, CAP).join(', ')}, +${sorted.length - CAP} more`;
}

function buildGeneratedContent(dirName, packId, orderedAddons) {
  const byFile = new Map();
  for (const a of orderedAddons) {
    if (!byFile.has(a.fileBase)) byFile.set(a.fileBase, []);
    byFile.get(a.fileBase).push(a.exportName);
  }
  const sortedFiles = [...byFile.keys()].sort();
  const headerDeps = [
    ...sortedFiles.map((f) => `packs/${dirName}/${f}`),
    'shared/index'
  ];
  const headerLine = `// MODULE: generated addon list for ${packId} (dependency-ordered by scripts/addons.mjs; do not edit by hand) | DEPENDS ON: ${formatHeaderList(headerDeps)} | USED BY: packs/${dirName}/index`;

  const importLines = sortedFiles.map((f) => {
    const names = byFile.get(f).sort().join(', ');
    return `import { ${names} } from './${f}';`;
  });

  const varName = `${packId}Addons`;
  const items = orderedAddons.map((a) => `  ${a.exportName}`).join(',\n');

  return [
    headerLine,
    '// Generated by scripts/addons.mjs. Do not edit by hand; run `npm run addons` to regenerate.',
    "import type { AddonDef } from '../../shared';",
    ...importLines,
    '',
    `export const ${varName}: AddonDef[] = [`,
    items,
    '];',
    ''
  ].join('\n');
}

const errors = [];
const packEntries = [];
const allAddonOwners = new Map();

if (!fs.existsSync(packsDir)) {
  console.error(`Packs directory not found: ${packsDir}`);
  process.exit(1);
}

const packDirs = fs
  .readdirSync(packsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

for (const dirName of packDirs) {
  const dirPath = path.join(packsDir, dirName);
  const packId = detectPackId(dirPath, dirName);
  const tsFiles = fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.ts') && e.name !== 'index.ts' && e.name !== 'addons.generated.ts')
    .map((e) => e.name)
    .sort();

  const addons = [];
  for (const fileName of tsFiles) {
    const filePath = path.join(dirPath, fileName);
    const fileBase = fileName.replace(/\.ts$/, '');
    try {
      const parsed = parseAddonsInFile(filePath, fileBase);
      addons.push(...parsed);
    } catch (err) {
      errors.push(err.message || String(err));
    }
  }

  if (addons.length === 0) continue;

  for (const a of addons) {
    if (!a.id.startsWith(`${packId}.`) || a.id.length <= packId.length + 1) {
      errors.push(`src/packs/${dirName}/${a.fileBase}.ts: addon "${a.id}" id must start with "${packId}."`);
    }
    if (allAddonOwners.has(a.id)) {
      errors.push(`src/packs/${dirName}/${a.fileBase}.ts: duplicate addon id "${a.id}"`);
    }
    allAddonOwners.set(a.id, packId);
  }

  packEntries.push({ dirName, dirPath, packId, addons });
}

const stale = [];
const updated = [];

for (const entry of packEntries) {
  const { dirName, dirPath, packId, addons } = entry;
  const byId = new Map(addons.map((a) => [a.id, a]));
  const samePackDeps = new Map(addons.map((a) => [a.id, []]));
  const dependents = new Map(addons.map((a) => [a.id, []]));
  const inDegree = new Map(addons.map((a) => [a.id, 0]));

  for (const a of addons) {
    const seenDeps = new Set();
    for (const dep of a.deps) {
      if (dep === a.id) {
        errors.push(`src/packs/${dirName}/${a.fileBase}.ts: dependency cycle: addon "${a.id}" depends on itself`);
        continue;
      }
      const depOwner = allAddonOwners.get(dep);
      if (!depOwner) {
        errors.push(`src/packs/${dirName}/${a.fileBase}.ts: addon "${a.id}" depends on missing addon "${dep}"`);
        continue;
      }
      if (depOwner !== packId) {
        if (!a.allowCrossDlcDep) {
          errors.push(`src/packs/${dirName}/${a.fileBase}.ts: addon "${a.id}" depends on "${dep}" from another pack "${depOwner}" without allowCrossDlcDep`);
        }
        continue;
      }
      if (!byId.has(dep)) {
        errors.push(`src/packs/${dirName}/${a.fileBase}.ts: addon "${a.id}" depends on missing addon "${dep}"`);
        continue;
      }
      if (!seenDeps.has(dep)) {
        seenDeps.add(dep);
        samePackDeps.get(a.id).push(dep);
        dependents.get(dep).push(a);
        inDegree.set(a.id, inDegree.get(a.id) + 1);
      }
    }
  }

  // Deterministic Kahn's algorithm
  const ready = addons.filter((a) => inDegree.get(a.id) === 0);
  const ordered = [];
  while (ready.length > 0) {
    ready.sort(compareReady);
    const cur = ready.shift();
    ordered.push(cur);
    for (const depUser of dependents.get(cur.id)) {
      const nextDeg = inDegree.get(depUser.id) - 1;
      inDegree.set(depUser.id, nextDeg);
      if (nextDeg === 0) ready.push(depUser);
    }
  }

  if (ordered.length < addons.length) {
    const remaining = addons.filter((a) => !ordered.includes(a));
    const cycleDesc = findCyclePath(remaining, samePackDeps);
    errors.push(`src/packs/${dirName}: dependency cycle detected: ${cycleDesc}`);
    continue;
  }

  const outPath = path.join(dirPath, 'addons.generated.ts');
  const nextText = buildGeneratedContent(dirName, packId, ordered);
  const prevText = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : null;
  const norm = (s) => (s === null ? null : s.replace(/\r\n/g, '\n'));

  if (norm(prevText) !== norm(nextText)) {
    const relOut = `src/packs/${dirName}/addons.generated.ts`;
    stale.push(relOut);
    if (!CHECK) {
      const eol = prevText && prevText.includes('\r\n') ? '\r\n' : '\n';
      fs.writeFileSync(outPath, nextText.replace(/\n/g, eol));
      updated.push(relOut);
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

if (CHECK) {
  if (stale.length > 0) {
    console.log(`addons.generated.ts is out of date for: ${stale.join(', ')}\nRun: npm run addons`);
    process.exit(1);
  }
  console.log('addons.generated.ts files are up to date');
} else {
  console.log(
    updated.length > 0
      ? `addons.generated.ts updated: ${updated.join(', ')}`
      : 'addons.generated.ts already up to date'
  );
}
