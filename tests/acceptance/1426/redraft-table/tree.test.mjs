// #1426 AC1 on the real tree: "Every vendored file that differs from its pinned release has a row, and every row names
// an issue and a test". With the Scope: each row's removal condition, its test resolved against its suite's own list,
// its count of marked hunks above 0 and its hunks over budget within its number; the refusal recorded with its date
// and link; the design's line on patches corrected. It fetches the pinned releases (README.md, How to run).
// Run: node --test tests/acceptance/1426/redraft-table/tree.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AC, repoRoot } from './common.mjs';
import { judgeRealTree } from './tree-judge.mjs';

test(`${AC[1]} the real tree: every file that differs from its pinned release has a row; every row has an issue, a removal condition, a test its suite lists, marked hunks above 0 and hunks over budget within its number; the refusal and the design's line are recorded`, () => {
  assert.deepEqual(judgeRealTree(repoRoot), []);
});
