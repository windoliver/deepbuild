// #1115: a test whose failure message starts with INCONCLUSIVE or BLOCKED takes that state in lanes.mjs, as stateOf
// already does in affected.mjs, on real vitest and real node --test through the real unit lane.
import assert from 'node:assert/strict';
import test from 'node:test';
import { dump, laneState, LONG, nodeFile, sandbox, tree, unit, vitestFile } from './helpers.mjs';

const VITEST = 'tests/fixture-1115/states.test.ts';
const NODE = 'tests/fixture-1115-states.test.mjs';

test('#1115.3a2181d7 a vitest test failing with INCONCLUSIVE: … reads INCONCLUSIVE in lanes.mjs, not FAIL', LONG, async (t) => {
  const box = sandbox(t);
  // The three ways the repo's own tests do it: expect.fail, a message on expect as requireGpu() has, and a thrown Error.
  const run = await unit(box, tree(box, {
    [VITEST]: vitestFile(`test('expect.fail', () => { expect.fail('INCONCLUSIVE: the fixture reports unsupported_platform; this is not a pass'); });
test('a message on expect', () => { expect('fixture-os', 'INCONCLUSIVE: the GPU layer draws these pixels on another platform; this is not a pass').toBe('darwin'); });
test('a thrown error', () => { throw new Error('INCONCLUSIVE: the fixture could not read it'); });`),
  }));
  const all = dump(run);
  assert.equal(laneState(run.stdout), 'INCONCLUSIVE', `tests failing with INCONCLUSIVE: left the lane's state at ${laneState(run.stdout)}\n${all}`);
  assert.notEqual(run.status, 0, all);
});

test('#1115.3a2181d7 a node --test test failing with INCONCLUSIVE: … reads INCONCLUSIVE in lanes.mjs, not FAIL', LONG, async (t) => {
  const box = sandbox(t);
  const run = await unit(box, tree(box, {
    [NODE]: nodeFile("test('assert.fail', () => { assert.fail('INCONCLUSIVE: the fixture could not read it'); });"),
  }));
  const all = dump(run);
  assert.equal(laneState(run.stdout), 'INCONCLUSIVE', `a test failing with INCONCLUSIVE: left the lane's state at ${laneState(run.stdout)}\n${all}`);
  assert.notEqual(run.status, 0, all);
});

test('#1115.3a2181d7 a test failing with BLOCKED: … takes that state in lanes.mjs too', LONG, async (t) => {
  const box = sandbox(t);
  const run = await unit(box, tree(box, {
    [VITEST]: vitestFile("test('blocked', () => { expect.fail('BLOCKED: the fixture has no toolchain'); });"),
  }));
  const all = dump(run);
  assert.equal(laneState(run.stdout), 'BLOCKED', `a test failing with BLOCKED: left the lane's state at ${laneState(run.stdout)}\n${all}`);
  assert.notEqual(run.status, 0, all);
});

// Passes on the base, whose every failure reads FAIL. Its wrong program lets the first failure's state, or any
// INCONCLUSIVE, stand for the lane, so a real failure in a later command reads INCONCLUSIVE.
test('#1115.3a2181d7 a real failure beside a test failing with INCONCLUSIVE: … leaves the lane FAIL', LONG, async (t) => {
  const box = sandbox(t);
  const run = await unit(box, tree(box, {
    [VITEST]: vitestFile("test('inconclusive', () => { expect.fail('INCONCLUSIVE: the fixture could not read it'); });"),
    [NODE]: nodeFile("test('a real failure', () => { assert.equal(1, 2); });"),
  }));
  const all = dump(run);
  assert.equal(laneState(run.stdout), 'FAIL', `a real failure in the lane's last command read ${laneState(run.stdout)}\n${all}`);
  assert.notEqual(run.status, 0, all);
});
