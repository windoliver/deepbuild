// #724 acceptance: a host whose /usr/bin/time can't report the counter. perf runs with its copy of
// scripts/benchmark.mjs pointed at a stand-in that runs the real /usr/bin/time and drops the
// "instructions retired" and "cycles elapsed" lines from its report; the observed workload, measured
// on the same host, has no count either.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { BASE_ITERATIONS, comparison, fileScope, perfLane, show } from './helpers.mjs';

let lane;
const scope = fileScope();

before(() => {
  if (process.platform !== 'darwin') return;
  lane = perfLane(scope, {
    boundary: 'no-counter',
    observation: { status: 0, elapsedMs: 1, cpuMs: 1, peakBytes: 1, instructions: null },
    tasks: [{ id: 'unchanged', current: BASE_ITERATIONS }],
  });
});

test('a result from a host that can\'t read the counter carries it missing, never 0, and reads INCONCLUSIVE', (t) => {
  if (process.platform !== 'darwin') assert.fail('BLOCKED: the stand-in wraps macOS\'s /usr/bin/time -l');
  t.diagnostic(`perf took ${lane.seconds.toFixed(1)} s`);
  const { judged } = comparison(lane, 'unchanged');
  for (const [round, pair] of judged.pairs.entries()) {
    assert.deepEqual([pair?.current, pair?.base], [null, null], `pair ${round} records the missing count as null: ${JSON.stringify(pair)}`);
  }
  assert.equal(judged.status, 'INCONCLUSIVE', `${JSON.stringify(judged)}\n${show(lane.result)}`);
  assert.equal(judged.change, null, `no change from missing counts: ${JSON.stringify(judged)}`);
  assert.match(lane.result.stdout, /^INCONCLUSIVE perf: [^\n]*\bunchanged\b[^\n]*instructions[^\n]*\n {2}Fix: /m, show(lane.result));
  assert.notEqual(lane.result.status, 0, show(lane.result));
  assert.doesNotMatch(lane.result.stdout, /^PASS perf/m, show(lane.result));
  const preflight = lane.line('preflight');
  assert.ok(preflight, `no preflight result line: ${show(lane.result)}`);
  assert.equal(preflight.current?.instructions, null, `the observed workload's missing count: ${JSON.stringify(preflight.current)}`);
  assert.equal(preflight.base?.instructions, null, `the merge base's workload, measured on this host: ${JSON.stringify(preflight.base)}`);
});
