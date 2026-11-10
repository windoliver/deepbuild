// #882 AC1, redrafted under #1458 ("Text has two inks and disabled. Rather than raise `ink_tertiary`, which has one
// caller, it goes"). Replaces ../look.test.mjs's first test; its scope test (judgeInkGuard) is unchanged.
// Run: node --test tests/acceptance/882/redraft-1458/look.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AC } from '../common.mjs';
import { ask, judgeLook } from './judge.mjs';

test(`${AC[1]} the shipped look passes its guard with the chrome roles, the ink at two tiers and disabled, in light and dark; the session readout at #b45309 fails it, naming the role, blocked and 0.044`, () => {
  assert.deepEqual(judgeLook(ask), []);
});
