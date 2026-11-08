// #1426: `check` in the lint lane, on a planted tree and stub pinned releases. No network, no build.
// Run: node --test tests/acceptance/1426/lint.test.mjs
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { repoRoot, SCRIPT } from './common.mjs';
import { judgeCounts, judgeFileBudget, judgeHunkBudget, judgeMarks, judgeMissingRelease, judgeNewFile, judgeNoRow, judgeOverCount, judgeReason, judgeRowCells, judgeWiring } from './lint-judge.mjs';

const script = join(repoRoot, SCRIPT);

test('#1426.4ef6dcfa a planted changed file with no row fails check, naming it, in every vendored tree', () => {
  assert.deepEqual(judgeNoRow(script), []);
});

test('#1426.4ef6dcfa a planted row with no test fails check, naming it; so does a test that is not there and a row with no issue', () => {
  assert.deepEqual(judgeRowCells(script), []);
});

test('#1426.4ef6dcfa a pinned release that cannot be read is BLOCKED or INCONCLUSIVE, never a pass', () => {
  assert.deepEqual(judgeMissingRelease(script), []);
});

test('#1426.4ef6dcfa the lint lane runs check: a planted changed file with no row and a planted row with no test each fail the lane, naming it', async () => {
  assert.deepEqual(await judgeWiring(join(repoRoot, 'scripts/lanes.mjs')), []);
});

test('#1426.08aec3b4 a planted unmarked hunk in a file that already has a row fails, naming file and line; a mark in or next to a hunk passes it', () => {
  assert.deepEqual(judgeMarks(script), []);
});

test('#1426.8e0bb54e the count of marked hunks prints per row and follows the tree, and a row with none fails, naming it', () => {
  assert.deepEqual(judgeCounts(script), []);
});

test('#1426.0c3a7dfa a planted marked 9-line hunk in a file with a row fails, naming file, line and size; a marked 8-line hunk passes', () => {
  assert.deepEqual(judgeHunkBudget(script), []);
});

test('#1426.0c3a7dfa (scope) a file passes at 40 added lines and fails at 41, naming the file and the count', () => {
  assert.deepEqual(judgeFileBudget(script), []);
});

test('#1426.fde8001d a 60-line addition fails in place and passes moved to a new file with a one-line mod and a row for the new file; with no such row it fails', () => {
  assert.deepEqual(judgeNewFile(script), []);
});

test('#1426.f66ec7fc a row that raises a budget with no reason fails, naming the row', () => {
  assert.deepEqual(judgeReason(script), []);
});

test('#1426.4e893008 hunks over budget print per row, and a change that raises a row past its number fails, naming the row, the count and the number', () => {
  assert.deepEqual(judgeOverCount(script), []);
});
