// A serial block that names a budget file but also excludes it has not run that file.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
test('preflight rejects a serial command that excludes the automatic budget file it names', (t) => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'deep-serial-exclusion-')));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  cpSync(join(root, 'scripts'), join(cwd, 'scripts'), { recursive: true });
  mkdirSync(join(cwd, 'tests/acceptance/14'), { recursive: true });
  copyFileSync(join(root, 'tests/preflight.test.mjs'), join(cwd, 'tests/preflight.test.mjs'));
  copyFileSync(join(root, 'tests/acceptance/14/budgets.test.ts'), join(cwd, 'tests/acceptance/14/budgets.test.ts'));
  // The planted wrong schedule keeps the named file, but Vitest would not run it.
  appendFileSync(join(cwd, 'scripts/lanes.mjs'), `\nchecks.find(({ name }) => name === 'unit').commands.find((c) => c.includes('--no-file-parallelism')).push('--exclude', 'tests/acceptance/14/budgets.test.ts');\n`);
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const result = spawnSync(process.execPath, ['--test', '--test-name-pattern=the unit lane runs each reference-Mac budget file alone', 'tests/preflight.test.mjs'], { cwd, env, encoding: 'utf8', timeout: 60_000 });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /tests\/acceptance\/14\/budgets\.test\.ts is excluded from the serial block/);
});
