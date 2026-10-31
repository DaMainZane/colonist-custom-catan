// MODULE: header guard: every src file has a one-line MODULE description (R2 of Modular Rework Plan.md)
// Runs scripts/headers.mjs --check. Stale DEPENDS ON / USED BY lists do not fail the test (that would make every new import
// red and cause merge conflicts between two people); run `npm run headers:write` to refresh them, or `npm run headers:check -- --strict`.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

describe('file headers', () => {
  it('every src file has a MODULE line with a real description', () => {
    const script = path.resolve(process.cwd(), 'scripts', 'headers.mjs');
    const run = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
    expect(run.stdout, 'headers.mjs output').not.toContain('Header check failed');
    expect(run.status).toBe(0);
  });
});
