import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const runner = new URL('../scripts/lanes.mjs', import.meta.url).href;
test('the unit failure summary names the unlisted test, not an earlier LISTED failure', (t) => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'deep-listed-diagnostic-')));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, 'scripts'));
  writeFileSync(join(cwd, 'scripts/known-failures.json'), JSON.stringify({ failures: {
    'example.test.mjs › listed': 'known on main (#2444, added 2026-11-15)',
  }, skips: [] }));
  writeFileSync(join(cwd, 'example.test.mjs'), `import test from 'node:test';
    test('listed', () => { throw Error('old failure'); });
    test('new regression', () => { throw Error('new failure'); });`);
  const { NODE_TEST_CONTEXT, DEEP_THROTTLE, DEEP_BIN_DIR, ...env } = process.env;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import { runLanes } from ${JSON.stringify(runner)};
    process.exitCode = runLanes([{name: 'unit', commands: [[process.execPath, '--test', 'example.test.mjs']], fix: 'repair it'}], {cwd: process.cwd()});`],
  { cwd, encoding: 'utf8', timeout: 120_000, env: { ...env, HOME: join(cwd, 'home') } });
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /^LISTED example\.test\.mjs › listed.*#2444/m);
  assert.match(result.stdout, /^FAIL unit: example\.test\.mjs › new regression: new failure$/m);
});
