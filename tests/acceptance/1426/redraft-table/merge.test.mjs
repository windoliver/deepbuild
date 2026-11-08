// #1426 AC5: "`merge` onto a stub new release keeps a clean carried hunk and leaves a conflicting one marked, listing
// it". Scope: "`scripts/vendor-rebase.mjs merge | check | diff` does a three-way merge from the old pin to the new onto
// our tree and leaves conflict markers". README.md, The surface, pins how.
// Run: node --test tests/acceptance/1426/redraft-table/merge.test.mjs
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { AC, repoRoot, SCRIPT } from './common.mjs';
import { judgeDiff, judgeMergeClean, judgeMergeConflict } from './merge-judge.mjs';

const script = join(repoRoot, SCRIPT);

test(`${AC[5]} merge onto a stub gpui-pre 0.3.10 keeps the clean carried hunk, takes the release's far change, and leaves the conflicting hunk between markers with both sides, listing it alone at its line`, () => {
  assert.deepEqual(judgeMergeConflict(script), []);
});

test(`${AC[5]} (scope) a merge with no conflict exits 0, moves the pin, keeps both carried hunks, and check passes the merged tree`, () => {
  assert.deepEqual(judgeMergeClean(script), []);
});

test(`${AC[5]} (scope) diff prints each carried line against its release and names no file that doesn't differ`, () => {
  assert.deepEqual(judgeDiff(script), []);
});
