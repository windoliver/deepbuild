// #1426 AC2, on the real tree: each of the four rows' tests passes on a private copy and fails with that row's change
// reverted there. It needs macOS with Metal's compiler (full Xcode), cargo and node_modules, and hours on a cold build;
// a machine without them fails with INCONCLUSIVE, and the table is still read first.
// Run: node --test tests/acceptance/1426/reverts.test.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { carriedRows, README, repoRoot } from './common.mjs';
import { judgeReverts, machineProblem } from './reverts-judge.mjs';

test('#1426.eb2029f7 each row\'s test fails with that row\'s change reverted, for the sRGB layer tag, the exact gradient mode, the BGRA surface and the surface reports', () => {
  const file = join(repoRoot, README);
  assert.ok(carriedRows(existsSync(file) ? readFileSync(file, 'utf8') : ''), `${README} has no carried-patch table with the columns the README pins`);
  assert.equal(machineProblem(), null);
  assert.deepEqual(judgeReverts(), []);
});
