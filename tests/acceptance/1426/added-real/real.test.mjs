// #1426 a17e5e56: "A planted row naming a test that doesn't exist fails the lint, naming the row and the test; the same
// row naming an existing test passes. A row with no removal condition fails, naming the row". This is the real-tree
// half of its Scope line: "Each row names its test by full path and its removal condition: the upstream change that
// would retire it, or 'none' with a reason. The lint resolves each named test against the suite's own test list, so a
// row naming a test or script that doesn't exist fails, naming the row." On the checkout's own table, every row gives a
// removal condition and names its test by a full repo path to a file that exists, and that test is in its suite's own
// list as its runner gives it. A list this run can't read reads INCONCLUSIVE, naming what it lacks. README.md has how.
// Run: node --test tests/acceptance/1426/added-real/real.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ID, judgeTable, repoRoot } from './real-judge.mjs';

test(`${ID} (scope, the real tree) every row of the carried-patch table gives a removal condition and names its test by full repo path, and that test is in its suite's own list`, () => {
  const { state, lines } = judgeTable(repoRoot);
  const report = lines.join('\n');
  if (state === 'INCONCLUSIVE') throw new Error(`INCONCLUSIVE: a suite's list couldn't be read here, so the table isn't proven:\n${report}`);
  assert.equal(state, 'PASS', report);
});
