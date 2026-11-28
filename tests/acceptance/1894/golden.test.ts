import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { afterAll, expect, test } from 'vitest';
import { BASE, cleanup, GOLDEN, REPO, runScenario } from './helpers.ts';

afterAll(cleanup);

test.runIf(process.env.DH1894_GOLDEN === 'write')(`records the learned rows the merge base ${BASE} gives on the recorded sessions`, async () => {
  const git = (...args: string[]): string => execFileSync('/usr/bin/git', args, { cwd: REPO, encoding: 'utf8' }).trim();
  expect(git('rev-parse', 'HEAD').startsWith(BASE), `the golden is written only at the base commit ${BASE}`).toBe(true);
  expect(git('status', '--porcelain', '--', 'packages'), 'the golden is written only with packages/ as the base has them').toBe('');
  const scenario = await runScenario(undefined);
  writeFileSync(GOLDEN, `${JSON.stringify({ base: git('rev-parse', 'HEAD'), ...scenario }, null, 2)}\n`);
}, 300_000);
