// #724 acceptance: an absolute ms limit off the reference Macs, beside an instruction comparison that
// reads PASS and one that reads FAIL. perf runs with the real counter and #568's recorded fingerprint
// of a Mac on battery, Low Power Mode on, thermal state fair (the machine is the boundary planted; the
// counts are real).
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { BASE_ITERATIONS, OTHER, PLUS_20, comparison, fileScope, perfLane, realPairs, show } from './helpers.mjs';

// Far above an awk run of a few hundred ms even under load: within the limit wherever it runs.
const LIMITS = { p50Ms: 60_000 };
let lane;
const scope = fileScope();

before(() => {
  if (process.platform !== 'darwin') return;
  lane = perfLane(scope, {
    boundary: 'fingerprint',
    planted: OTHER,
    observation: { status: 0, elapsedMs: 1, cpuMs: 1, peakBytes: 1, instructions: 123_456_789 },
    tasks: [
      { id: 'unchanged-limited', current: BASE_ITERATIONS, limits: LIMITS },
      { id: 'plus-20-limited', current: PLUS_20, limits: LIMITS },
    ],
  });
});

test('an absolute ms limit off the reference Macs stays INCONCLUSIVE whatever its instruction comparison reads', (t) => {
  if (process.platform !== 'darwin') assert.fail('BLOCKED: the counter is read from macOS\'s /usr/bin/time -l');
  t.diagnostic(`perf took ${lane.seconds.toFixed(1)} s`);
  for (const [id, instructions] of [['unchanged-limited', 'PASS'], ['plus-20-limited', 'FAIL']]) {
    const { printed, judged } = comparison(lane, id);
    realPairs(id, judged.pairs);
    assert.deepEqual(printed.fingerprint, OTHER, `${id} ran under the planted fingerprint`);
    assert.equal(judged.status, instructions, `${id}'s instruction comparison holds off the reference Macs too: ${JSON.stringify(judged)}`);
    const limit = printed.limits?.p50Ms;
    assert.ok(Array.isArray(limit?.runs) && limit.runs.length === 5, `${id} judges its ms limit on five runs: ${JSON.stringify(printed.limits)}`);
    for (const run of limit.runs) assert.ok(Number.isFinite(run) && run >= 0 && run < LIMITS.p50Ms, `${id}: run ${run} ms is within ${LIMITS.p50Ms} ms`);
    assert.equal(limit.status, 'INCONCLUSIVE', `${id}: an ms limit off the reference Macs, with the instruction comparison at ${judged.status}: ${JSON.stringify(limit)}`);
    assert.match(lane.result.stdout, RegExp(`^INCONCLUSIVE perf: [^\\n]*\\b${id}\\b[^\\n]*p50Ms[^\\n]*\\n {2}Fix: `, 'm'), show(lane.result));
  }
  assert.notEqual(lane.result.status, 0, show(lane.result));
  assert.doesNotMatch(lane.result.stdout, /^PASS perf/m, show(lane.result));
});
