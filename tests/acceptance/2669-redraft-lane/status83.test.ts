// #2669.6995f057: `tests/acceptance/83/status.test.ts` passes. It runs through the repo's own vitest, once, as a
// separate run. That suite starts this checkout's hub from its built CLI (#83's CURRENT checkout, whose `cli` is
// packages/cli/dist/main.js), so this test checks that CLI is built before the run and names it in its failure.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CURRENT, NODE, REPO, run, shown } from '../83/helpers.ts';
import { STATUS83 } from '../2669/helpers.ts';

describe(`${STATUS83} tests/acceptance/83/status.test.ts passes`, () => {
  it(`${STATUS83} the repo's vitest runs tests/acceptance/83/status.test.ts and every test in it passes`, async () => {
    expect(existsSync(CURRENT.cli), `the hub's CLI is built (${CURRENT.cli}); the suite drives this checkout's hub through it`).toBe(true);
    const env: NodeJS.ProcessEnv = {};
    // The outer run's own vitest variables would make the inner run think it is a worker of this one.
    for (const [key, value] of Object.entries(process.env)) if (!key.startsWith('VITEST') && key !== 'NODE_OPTIONS') env[key] = value;
    const r = await run(NODE, [join(REPO, 'node_modules/vitest/vitest.mjs'), 'run', 'tests/acceptance/83/status.test.ts', '--reporter=verbose'], { cwd: REPO, env, timeoutMs: 1_080_000 });
    expect(r.code, `tests/acceptance/83/status.test.ts passes (vitest exits 0): ${shown(r)}`).toBe(0);
    expect(r.stdout, 'it ran its tests and none failed').toMatch(/Tests\s+\d+ passed/);
    expect(r.stdout).not.toMatch(/Tests\s+[^\n]*\d+ failed/);
  }, 1_140_000);
});
