// #2444/#1624: exercise the corrected discovery with a new automatic file its lane omits.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
test('local timing discovery rejects an unlisted automatic file but does not launch deliberately by-hand files', (t) => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'deep-local-discovery-')));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, 'tests/acceptance'), { recursive: true });
  copyFileSync(join(root, 'tests/preflight.test.mjs'), join(cwd, 'tests/preflight.test.mjs'));
  symlinkSync(join(root, 'scripts'), join(cwd, 'scripts'));
  writeFileSync(join(cwd, 'tests/acceptance/plans.ts'), '// Not an issue folder.\n');
  const budget = (issue) => {
    mkdirSync(join(cwd, 'tests/acceptance', issue), { recursive: true });
    writeFileSync(join(cwd, 'tests/acceptance', issue, issue === '112' ? 'live.test.ts' : 'budgets.test.ts'), 'environmentProblem();\n');
  };
  budget('14');
  budget('112');
  const run = () => {
    const { NODE_TEST_CONTEXT, ...env } = process.env;
    return spawnSync(process.execPath, ['--test', '--test-name-pattern=the unit lane runs each reference-Mac budget file alone', 'tests/preflight.test.mjs'], { cwd, env, encoding: 'utf8', timeout: 60_000 });
  };
  const ordinary = run();
  assert.equal(ordinary.status, 0, ordinary.stdout + ordinary.stderr);
  // The wrong program is a lane table omitting this newly required automatic budget file.
  budget('unlisted-automatic');
  const omitted = run();
  assert.equal(omitted.status, 1, omitted.stdout + omitted.stderr);
  assert.match(omitted.stdout + omitted.stderr, /tests\/acceptance\/unlisted-automatic\/budgets\.test\.ts runs in the parallel block/);
  assert.doesNotMatch(omitted.stdout + omitted.stderr, /ENOTDIR|ERR_MODULE_NOT_FOUND/);
});
