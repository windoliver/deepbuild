// #1404 acceptance, third criterion, the left-running test redrafted blind under #1405's rule (REDRAFT.md).
// As tests/acceptance/1404/no-count.test.mjs: a Node wrapper that starts a child detached and leaves
// reads INCONCLUSIVE, naming the budget, and a budget that started none reads no verdict line and PASS.
// Only the childless budget changes: 100 million spins instead of 1 million. At 1 million, a run retires
// about 30 M instructions and identical runs moved -6% to +10% at load 430 on this Mac, so "at least 2%"
// can't be rejected at p under 0.01 and #1405's rule reads it INCONCLUSIVE for noise, not for a child.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { buildSpin, fileScope, macOnly, perfLane, reading, readsInconclusive, scratch, verdicts } from '../1404/helpers.mjs';

const scope = fileScope();
let lane;

// A Node wrapper that starts a child in its own session and leaves without waiting. The child sleeps
// past the end of the round, so its count doesn't exist when the budget ends; it then exits by itself.
const leaver = (spin) => `import { spawn } from 'node:child_process';
spawn(${JSON.stringify(spin)}, ['1000000', '30'], { detached: true, stdio: 'ignore' }).unref();
`;

before(() => {
  if (process.platform !== 'darwin') return;
  const spin = buildSpin(scratch(scope));
  lane = perfLane(scope, {
    tasks: [
      { id: 'left-running', command: ['node', 'benchmarks/left-running.mjs'], base: { 'benchmarks/left-running.mjs': leaver(spin) }, current: {} },
      // A budget that starts nothing, as hook-startup doesn't, large enough that its count holds.
      { id: 'childless', command: [spin, '100000000'], base: {}, current: {} },
    ],
  });
});

test('a budget that started a child still running when it ended reads INCONCLUSIVE, naming the budget, never PASS, and a budget that started none does not', { timeout: 1_800_000 }, () => {
  macOnly();
  readsInconclusive(lane, 'left-running');
  assert.deepEqual(verdicts(lane, 'childless'), [], reading(lane, 'childless'));
  assert.equal(lane.line('childless')?.instructions?.status, 'PASS', reading(lane, 'childless'));
});
