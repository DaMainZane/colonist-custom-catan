// MODULE: index and generated-addons guard: INDEX.md src tables and packs/<dlc>/addons.generated.ts stay up to date (R2 & R9.1)
// Runs scripts/index.mjs --check and scripts/addons.mjs --check.
// Fix: run `npm run addons` and `npm run index`.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('INDEX.md', () => {
  it('src tables are generated from the current file headers', () => {
    const script = path.resolve(process.cwd(), 'scripts', 'index.mjs');
    const run = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
    expect(run.stdout, 'index.mjs output').toContain('INDEX.md is up to date');
    expect(run.status).toBe(0);
  });
});

describe('addons.generated.ts (R9.1)', () => {
  const script = path.resolve(process.cwd(), 'scripts', 'addons.mjs');

  it('generated pack addon lists are up to date with the addon files', () => {
    const run = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
    expect(run.stdout, 'addons.mjs output').toContain('addons.generated.ts files are up to date');
    expect(run.status).toBe(0);
  });

  it('fails loudly when addons.generated.ts is stale, or on a cycle, a missing dep, or a wrong pack prefix', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'addons-gen-'));
    try {
      const dlcDir = path.join(tmp, 'testdlc');
      fs.mkdirSync(dlcDir, { recursive: true });
      fs.writeFileSync(
        path.join(dlcDir, 'index.ts'),
        `export const testdlcPack: Pack = { id: 'testdlc', name: 'Test', deps: ['base'], register() {} };\n`
      );
      fs.writeFileSync(
        path.join(dlcDir, 'alpha.ts'),
        `export const alphaAddon: AddonDef = { id: 'testdlc.alpha', name: 'Alpha', deps: ['testdlc.beta'], links: [] };\n`
      );
      fs.writeFileSync(
        path.join(dlcDir, 'beta.ts'),
        `export const betaAddon: AddonDef = { id: 'testdlc.beta', name: 'Beta', links: [] };\n`
      );

      // 1. Stale check fails before generation
      const staleRun = spawnSync(process.execPath, [script, '--check', '--packs-dir', tmp], { encoding: 'utf8' });
      expect(staleRun.status).toBe(1);
      expect(staleRun.stdout).toContain('addons.generated.ts is out of date');

      // 2. Generation orders beta before alpha (since alpha depends on beta) and is deterministic
      const genRun = spawnSync(process.execPath, [script, '--packs-dir', tmp], { encoding: 'utf8' });
      expect(genRun.status).toBe(0);
      const genText = fs.readFileSync(path.join(dlcDir, 'addons.generated.ts'), 'utf8');
      const arrayBody = genText.split('AddonDef[] = [')[1] || '';
      expect(arrayBody.indexOf('betaAddon')).toBeGreaterThanOrEqual(0);
      expect(arrayBody.indexOf('betaAddon')).toBeLessThan(arrayBody.indexOf('alphaAddon'));

      const checkAfter = spawnSync(process.execPath, [script, '--check', '--packs-dir', tmp], { encoding: 'utf8' });
      expect(checkAfter.status).toBe(0);

      // 3. Cycle fails loudly
      fs.writeFileSync(
        path.join(dlcDir, 'beta.ts'),
        `export const betaAddon: AddonDef = { id: 'testdlc.beta', name: 'Beta', deps: ['testdlc.alpha'], links: [] };\n`
      );
      const cycleRun = spawnSync(process.execPath, [script, '--packs-dir', tmp], { encoding: 'utf8' });
      expect(cycleRun.status).toBe(1);
      expect(cycleRun.stderr).toMatch(/cycle/i);

      // 4. Missing dep fails loudly
      fs.writeFileSync(
        path.join(dlcDir, 'beta.ts'),
        `export const betaAddon: AddonDef = { id: 'testdlc.beta', name: 'Beta', deps: ['testdlc.missing'], links: [] };\n`
      );
      const missingRun = spawnSync(process.execPath, [script, '--packs-dir', tmp], { encoding: 'utf8' });
      expect(missingRun.status).toBe(1);
      expect(missingRun.stderr).toMatch(/missing addon "testdlc\.missing"/);

      // 5. Addon id not starting with pack id fails loudly
      fs.writeFileSync(
        path.join(dlcDir, 'beta.ts'),
        `export const betaAddon: AddonDef = { id: 'other.beta', name: 'Beta', links: [] };\n`
      );
      const prefixRun = spawnSync(process.execPath, [script, '--packs-dir', tmp], { encoding: 'utf8' });
      expect(prefixRun.status).toBe(1);
      expect(prefixRun.stderr).toMatch(/must start with "testdlc\."/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
