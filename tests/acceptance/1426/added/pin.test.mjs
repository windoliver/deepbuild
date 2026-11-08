// #1426: "A planted rebase that applies cleanly while one row's test fails leaves the pin where it was and names that
// test". Scope: "A rebase that applies cleanly proves the source only. The pin moves only when the rows' tests also
// pass on the reference Mac." README.md, The added surface, pins what merge does.
// Run: node --test tests/acceptance/1426/added/pin.test.mjs
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { AC, repoRoot, SCRIPT } from './common.mjs';
import { judgePinHeld, judgePinMoves } from './pin-judge.mjs';

const script = join(repoRoot, SCRIPT);

test(`${AC.pin} merge onto a stub release that applies cleanly while the gradient row's test fails leaves the pin at 0.3.9, exits non-zero and names that test alone`, () => {
  assert.deepEqual(judgePinHeld(script), []);
});

test(`${AC.pin} (scope) the same clean merge with every row's test passing moves the pin to 0.3.10`, () => {
  assert.deepEqual(judgePinMoves(script), []);
});
