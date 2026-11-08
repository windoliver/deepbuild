// #1426 AC5: `merge` onto a stub new release, and `diff`. No network, no build.
// Run: node --test tests/acceptance/1426/merge.test.mjs
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { repoRoot, SCRIPT } from './common.mjs';
import { judgeCleanMerge, judgeDiff, judgeMerge } from './merge-judge.mjs';

const script = join(repoRoot, SCRIPT);

test('#1426.5f9ac1c5 merge onto a stub new release keeps a clean carried hunk and leaves a conflicting one marked, listing it', () => {
  assert.deepEqual(judgeMerge(script), []);
});

test('#1426.5f9ac1c5 merge with no conflict exits 0, moves the pin and passes check against the new release', () => {
  assert.deepEqual(judgeCleanMerge(script), []);
});

test('#1426.5f9ac1c5 (scope) diff shows each carried change against the pinned release', () => {
  assert.deepEqual(judgeDiff(script), []);
});
