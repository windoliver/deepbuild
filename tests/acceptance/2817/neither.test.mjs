import assert from 'node:assert/strict';
import test from 'node:test';
import { before, bothSides, CONTROL_TEST, dump, fixture, NEITHER_TEST, sandbox } from './helpers.mjs';

// Two real before-lane runs on two fresh fixtures (fresh HOME, so fresh bays): one whose only tagged test names no
// hub or CLI package, which must find nothing the lane put under target/debug; and a control whose tagged test
// names packages/cli/dist/main.js, which must find both. Without the control, a lane that never builds would pass.
test('#2817.e0f437e2 a tagged test naming neither the hub nor the CLI package finds no lane-built binaries', { timeout: 290_000 }, (t) => {
  const box = sandbox(t);
  fixture(box, { 'tests/acceptance/2817/neither.test.mjs': NEITHER_TEST });
  const neither = before(t, box);
  const sides = bothSides(neither.seen, neither.result);
  for (const side of ['change', 'base']) assert.deepEqual(sides[side].found, [], `${side} side: the lane put binaries under target/debug for a test naming neither package\n${dump(neither.result)}`);

  const other = sandbox(t);
  fixture(other, { 'tests/acceptance/2817/control.test.mjs': CONTROL_TEST });
  const control = before(t, other);
  const named = bothSides(control.seen, control.result);
  for (const side of ['change', 'base']) {
    assert.equal(named[side].hub, true, 'the control names a CLI that exists in its copy');
    assert.deepEqual(named[side].found, ['deep-hook', 'deep-show'], `${side} side (control): a test naming packages/cli/ got no deep-hook and deep-show under its copy's target/debug\n${dump(control.result)}`);
  }
});
