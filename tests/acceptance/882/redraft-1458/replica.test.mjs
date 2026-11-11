// #882 AC3's ink half, redrafted under #1458 ("Every ink role but `ink_disabled` clears 4.5:1 on every fill #1003
// lists, in light and dark"). Replaces ../replica.test.mjs's third test; the screen tests there are unchanged. It reads
// the roles the look's guard resolves (`deep-canvas-render look`), as the old test did, so it needs no screen.
// Run: node --test tests/acceptance/882/redraft-1458/replica.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AC } from '../common.mjs';
import { ask, inkProblems } from './judge.mjs';

test(`${AC[3]} every ink role but ink_disabled keeps 4.5:1 on ground, raised, and hover and selected over either, in dark and in light`, () => {
  const [answer] = ask([{ look: 'clean' }]);
  const roles = answer?.roles;
  if (!roles?.light || !roles?.dark) assert.fail(`the look's answer has no roles per appearance: ${JSON.stringify({ ...answer, look: '(the definition)' }).slice(0, 400)}`);
  assert.deepEqual([...inkProblems('dark', roles.dark), ...inkProblems('light', roles.light)], []);
});
