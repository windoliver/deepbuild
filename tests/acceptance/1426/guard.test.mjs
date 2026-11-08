// #1426 AC9: the real proof guard, reached by running `node scripts/proof.mjs guard` in a scratch repository. It needs
// node_modules (scripts/proof-change.mjs imports typescript) and ssh-keygen; nothing else.
// Run: node --test tests/acceptance/1426/guard.test.mjs
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { repoRoot } from './common.mjs';
import { judgeSigned, judgeUnsigned } from './guard-judge.mjs';

const script = join(repoRoot, 'scripts/proof.mjs');

test('#1426.f66ec7fc an unsigned change to a row\'s budget number, up or down, is refused by the proof guard, naming the table\'s file', () => {
  assert.deepEqual(judgeUnsigned(script), []);
});

test('#1426.f66ec7fc the maintainer\'s signed proposal changes the number; a stranger\'s signature does not; prose outside the table needs none', () => {
  assert.deepEqual(judgeSigned(script), []);
});
