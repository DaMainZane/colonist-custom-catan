// MODULE: index guard: INDEX.md src tables match the file headers (R2 of Modular Rework Plan.md)
// Runs scripts/index.mjs --check. Fails when a src file is added, moved, deleted or re-described and INDEX.md was not regenerated.
// Fix: run `npm run index`. Import changes never make it fail, because only the description of each header is used.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

describe('INDEX.md', () => {
  it('src tables are generated from the current file headers', () => {
    const script = path.resolve(process.cwd(), 'scripts', 'index.mjs');
    const run = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
    expect(run.stdout, 'index.mjs output').toContain('INDEX.md is up to date');
    expect(run.status).toBe(0);
  });
});
