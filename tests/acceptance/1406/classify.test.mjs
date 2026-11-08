// #1406 AC2, AC3: `classify` in scripts/affected.mjs excuses a FAIL on a timing budget the baseline names only when the
// load is above the core count. The load is passed in as a fourth argument, the one-minute load average:
// classify(failures, findings, baseline, load). The core count is os.availableParallelism().
import assert from 'node:assert/strict';
import { availableParallelism } from 'node:os';
import test from 'node:test';
import { classify } from '../../../scripts/affected.mjs';

const CORES = availableParallelism();
const ID = 'tests/acceptance/9406/timed.test.mjs > a budget';
const failure = { id: ID, state: 'FAIL', message: 'p50 2.1x the merge base' };
const baseline = { timing: [ID], failures: {}, lint: {} };
const show = (result) => JSON.stringify(result, null, 2);

test('#1406.28b2532a AC2 a baseline timing failure at a load below the core count reads FAIL from classify', () => {
  const load = CORES > 1 ? 1 : 0.5;
  const result = classify([failure], [], baseline, load);
  assert.ok(result.fresh.some((f) => f.id === ID && f.state === 'FAIL'), `at load ${load} on ${CORES} cores the failure is not in fresh as FAIL\n${show(result)}`);
  assert.ok(!result.unsure.some((f) => f.id === ID), `at load ${load} on ${CORES} cores the failure was excused into unsure\n${show(result)}`);
});

test('#1406.9024eb9f AC3 the same failure at a load above the core count reads INCONCLUSIVE, naming the load', () => {
  const load = CORES * 4;
  const result = classify([failure], [], baseline, load);
  const excused = result.unsure.find((f) => f.id === ID);
  assert.equal(excused?.state, 'INCONCLUSIVE', `at load ${load} on ${CORES} cores the failure is not INCONCLUSIVE\n${show(result)}`);
  assert.match(excused.message, new RegExp(`(?<![\\d.])${load}(?![\\d])`), `the message doesn't name the load ${load} passed in\n${show(result)}`);
  assert.ok(!result.fresh.some((f) => f.id === ID), `at load ${load} the failure is also in fresh\n${show(result)}`);
});
