// #1426 AC3, on the real tree: the rebase trial's record, checked against the tree. A left pin's conflicts are re-found
// by running `merge` on a copy of vendor/ with the real releases (network); a moved pin's five suites run here (macOS
// with Metal's compiler, cargo, node_modules). What the machine can't do fails with INCONCLUSIVE.
// Run: node --test tests/acceptance/1426/record.test.mjs
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { repoRoot, SCRIPT } from './common.mjs';
import { judgeTrial } from './record-judge.mjs';
import { machineProblem } from './reverts-judge.mjs';

test('#1426.f319fe8d the record names the versions tried and ends with the pin moved and the five suites passing, or every conflicting hunk and failing suite listed', () => {
  assert.deepEqual(judgeTrial(join(repoRoot, SCRIPT), repoRoot, machineProblem()), []);
});
