// #1426: the lint criteria, on planted trees with stub releases. AC1: "Every vendored file that differs from its pinned
// release has a row, and every row names an issue and a test. A planted changed file with no row, and a planted row
// with no test, each fail the lint lane, naming it". AC4, AC6, AC7, AC8, AC9's lint half and AC10 as their tests say.
// README.md, The surface, pins how.
// Run: node --test tests/acceptance/1426/redraft-table/lint.test.mjs
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { AC, repoRoot, SCRIPT } from './common.mjs';
import { judgeCounts, judgeFileBudget, judgeHunkBudget, judgeLane, judgeMarks, judgeMissingRelease, judgeNewFile, judgeOverCount, judgeReason, judgeRowFields, judgeRowPerFile } from './lint-judge.mjs';

const script = join(repoRoot, SCRIPT);

test(`${AC[1]} a changed file with no row fails check naming it, in every tree under vendor/: nested, new, a manifest, gpui-pre-apple's own vendor/, quickjs-jit-runtime and unicode-17.0.0; with a row it passes`, () => {
  assert.deepEqual(judgeRowPerFile(script), []);
});

test(`${AC[1]} a row with no test (empty or a dash) and a row with no issue each fail check, naming the row`, () => {
  assert.deepEqual(judgeRowFields(script), []);
});

test(`${AC[1]} a tree whose pinned release can't be read is BLOCKED or INCONCLUSIVE, naming it, and never passes`, () => {
  assert.deepEqual(judgeMissingRelease(script), []);
});

test(`${AC[1]} the lint lane runs check: a planted changed file with no row and a planted row with no test each fail the lane as FAIL lint, naming it`, async () => {
  assert.deepEqual(await judgeLane(join(repoRoot, 'scripts/lanes.mjs')), []);
});

test(`${AC[4]} an unmarked hunk in a file that has a row, added or rewritten, fails check naming file and line; a mark in it or one unchanged line from it passes`, () => {
  assert.deepEqual(judgeMarks(script), []);
});

test(`${AC[6]} check prints each row's count of marked hunks, a new marked hunk moves it, and a row with none prints 0 and fails, naming it`, () => {
  assert.deepEqual(judgeCounts(script), []);
});

test(`${AC[7]} a marked 9-line hunk in a file with a row fails check naming file, line and size; 8 lines pass`, () => {
  assert.deepEqual(judgeHunkBudget(script), []);
});

test(`${AC[7]} (scope) a file with a row passes at 40 added lines and fails at 41, naming the file and the count`, () => {
  assert.deepEqual(judgeFileBudget(script), []);
});

test(`${AC[8]} a 60-line pure addition fails in place, passes moved to a new file with a one-line marked mod and a row for it, and fails with no row for the new file`, () => {
  assert.deepEqual(judgeNewFile(script), []);
});

test(`${AC[9]} (lint half) a row that raises its budget with no reason ("1 over", "1 over:") fails check, naming the row; one with its reason passes`, () => {
  assert.deepEqual(judgeReason(script), []);
});

test(`${AC[10]} check prints each row's hunks over budget; a second 9-line hunk in the row that allows 1 fails, naming the row, 2 and 1, even with another row's number spare; raised with a reason it passes`, () => {
  assert.deepEqual(judgeOverCount(script), []);
});
