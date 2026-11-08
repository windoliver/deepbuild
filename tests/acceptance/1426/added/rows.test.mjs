// #1426: "A planted row naming a test that doesn't exist fails the lint, naming the row and the test; the same row
// naming an existing test passes. A row with no removal condition fails, naming the row". Scope: "Each row names its
// test by full path and its removal condition: the upstream change that would retire it, or "none" with a reason. The
// lint resolves each named test against the suite's own test list". README.md, The added surface, pins how.
// Run: node --test tests/acceptance/1426/added/rows.test.mjs
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { AC, repoRoot, SCRIPT } from './common.mjs';
import { judgeCargoTests, judgeNodeTests, judgeRemoval, judgeVitestTests } from './rows-judge.mjs';

const script = join(repoRoot, SCRIPT);

test(`${AC.tests} a row naming a node --test name its file holds only as text, part of a name or a file that is gone fails check, naming the row and the test; the same row passes once the file has that test`, () => {
  assert.deepEqual(judgeNodeTests(script), []);
});

test(`${AC.tests} (scope) a row's vitest test is read from vitest's own list: a name in a comment fails, naming the row and the test, and a real test passes`, () => {
  assert.deepEqual(judgeVitestTests(script), []);
});

test(`${AC.tests} (scope) a row's Rust test is read from cargo's own list: a missing test and a function that is no test fail, naming the row and the test, and a real test passes`, () => {
  assert.deepEqual(judgeCargoTests(script), []);
});

test(`${AC.tests} a row with no removal condition (empty, a dash, or "none" with no reason) fails check, naming the row; "none: <reason>" and an upstream change pass`, () => {
  assert.deepEqual(judgeRemoval(script), []);
});
