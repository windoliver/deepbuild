// #824: a comparison with the merge base that couldn't be made is BLOCKED, never a PASS on this side's readings alone.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const REPO = fileURLToPath(new URL('..', import.meta.url));

test('a merge base that cannot be built leaves the run BLOCKED', () => {
  // The system's tools but no npm, so the merge base's copy can't be built.
  const run = spawnSync(process.execPath, ['benchmarks/hub-churn.mjs', '--merge-base', '--cycles', '1'], { cwd: REPO, encoding: 'utf8', env: { HOME: process.env.HOME, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }, timeout: 300_000 });
  expect(run.stdout).toMatch(/^BLOCKED hub churn: .*merge base/m);
  expect(run.stdout).not.toMatch(/^PASS/m);
  expect(run.status).toBe(1);
}, 320_000);
