// #1426 on the real tree: the carried-patch table, `check` as the lane runs it, the refusal and the design's line.
// The first test fetches the real pinned releases, and `check` reaches them its own way; with no network each fails
// with INCONCLUSIVE. The scope tests read files only.
// Run: node --test tests/acceptance/1426/tree.test.mjs
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { remove, repoRoot, SCRIPT } from './common.mjs';
import { fetchReleases, judgeDesign, judgeRealCheck, judgeRefusal, judgeTable } from './tree-judge.mjs';

test('#1426.4ef6dcfa every vendored file that differs from its pinned release has a row, by a count of our own, and every row names an issue and a test that is there', () => {
  const { dir, inconclusive } = fetchReleases(repoRoot);
  try {
    assert.equal(inconclusive, undefined);
    assert.deepEqual(judgeTable(repoRoot, dir), []);
  } finally {
    remove(dir);
  }
});

test('#1426.8e0bb54e #1426.4e893008 check passes the tree as the lane runs it, and prints for every row a non-zero count of marked hunks and its hunks over budget, none past the row\'s number', () => {
  assert.deepEqual(judgeRealCheck(join(repoRoot, SCRIPT), repoRoot), []);
});

test('#1426.4ef6dcfa (scope) the file records zed\'s refusal with its date and link and no longer calls the patch open', () => {
  assert.deepEqual(judgeRefusal(repoRoot), []);
});

test('#1426.4ef6dcfa (scope) the design no longer calls rquickjs the only patch', () => {
  assert.deepEqual(judgeDesign(repoRoot), []);
});
