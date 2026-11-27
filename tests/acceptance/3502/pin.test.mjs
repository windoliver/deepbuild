// #3502, first criterion, its first and third clauses: the three vendored trees are one release at or past 0.3.13,
// with what must agree for that to be true of the build (README: One release), and `node scripts/vendor-rebase.mjs
// check` passes on it. Its second clause is build.test.mjs's and its fourth rows.test.mjs's.
// Run: node --test tests/acceptance/3502/pin.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { blocked, carriedRows, clip, judgePin, read, REPO, requireNewPin, rowName, TABLE, tilde } from './common.mjs';

test('AC1 #3502.46a47d8c vendor/gpui-pre, vendor/gpui-pre-apple and vendor/gpui-pre-macos are one release at or past 0.3.13, and Cargo.lock, the manifests, the toolkit\'s commit and .cargo/config.toml agree with it', () => {
  assert.deepEqual(judgePin(REPO), []);
});

test('AC1 #3502.46a47d8c node scripts/vendor-rebase.mjs check passes on the new pin, with a line for every row', { timeout: 3_600_000 }, () => {
  requireNewPin();
  const rows = carriedRows(read(REPO, TABLE));
  assert.ok(rows?.length, `${TABLE} holds the carried-patch table under "## Carried patches"`);
  // The lint lists each row's suite by loading its file: node's mark of this running test file stays behind.
  const { NODE_TEST_CONTEXT: _parent, ...env } = process.env;
  const run = spawnSync(process.execPath, ['scripts/vendor-rebase.mjs', 'check'], { cwd: REPO, encoding: 'utf8', timeout: 3_000_000, maxBuffer: 1 << 28, env });
  const output = tilde(`${run.stdout ?? ''}${run.stderr ?? ''}`);
  const lines = output.split('\n');
  const unreached = lines.filter((line) => line.startsWith('BLOCKED '));
  if (run.error || unreached.length) blocked(`the lint can't judge the tree here: ${run.error?.message ?? unreached.join('; ')}`);
  assert.deepEqual(lines.filter((line) => line.startsWith('FAIL ')), [], 'check prints no FAIL line');
  assert.equal(run.status, 0, `check exits 0: ${clip(output.slice(-1500))}`);
  const printed = lines.filter((line) => line.startsWith('ROW '));
  assert.deepEqual(rows.filter((row) => !printed.some((line) => line.startsWith(`ROW ${rowName(row)}:`))).map(rowName), [], 'check prints a ROW line for every row of the table');
});
