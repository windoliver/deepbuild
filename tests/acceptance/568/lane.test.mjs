// #568 acceptance: `node scripts/perf.mjs '<observation>'`, run as a process in a scratch
// repository whose scripts/benchmark.mjs answers `fingerprint()` with a recorded fingerprint.
import assert from 'node:assert/strict';
import test from 'node:test';
import { lane, OTHER, REFERENCE, show } from './helpers.mjs';

// Each command logs its invocations. QUICK takes a few ms; COLD_THEN_QUICK takes 1 s the first
// time and a few ms after; STEADY_50MS takes about 50 ms every time, so against a 10 ms limit
// every run is over by far more than five runs' spread.
const QUICK = ['sh', '-c', 'echo run >> runs.log'];
const COLD_THEN_QUICK = ['sh', '-c', 'echo run >> runs.log; if [ ! -e cold-done ]; then touch cold-done; sleep 1; fi'];
const STEADY_50MS = ['sh', '-c', 'echo run >> runs.log; sleep 0.05'];
const GENEROUS = { p50Ms: 500, peakBytes: 1_000_000_000 };
const TIGHT = { p50Ms: 10 };

const fiveReadings = (judged, what) => {
  assert.ok(Array.isArray(judged?.runs) && judged.runs.length === 5, `${what} carries its five runs: ${JSON.stringify(judged)}`);
  for (const run of judged.runs) assert.ok(Number.isFinite(run) && run >= 0, `${what}: reading ${run}`);
};

test('every result perf prints records the whole fingerprint, the macOS build included, on and off the reference Mac', async (t) => {
  for (const planted of [REFERENCE, OTHER]) {
    const { result, lines, line } = lane(t, { planted, task: { id: 'quick', command: QUICK, limits: GENEROUS } });
    assert.ok(line('preflight'), `no preflight result line: ${show(result)}`);
    assert.ok(line('quick'), `no result line for the quick task: ${show(result)}`);
    for (const printed of lines.filter(({ task }) => task)) {
      assert.deepEqual(printed.fingerprint, planted, `${printed.task} records the fingerprint it ran under (${planted.model}): ${JSON.stringify(printed)}`);
      assert.equal(printed.fingerprint.macosBuild, planted.macosBuild);
    }
  }
});

test('on the reference Mac, a task within its limits passes on five runs taken after an unmeasured warm-up', async (t) => {
  const { result, line, invocations } = lane(t, { planted: REFERENCE, task: { id: 'cold-start', command: COLD_THEN_QUICK, limits: GENEROUS } });
  const printed = line('cold-start');
  assert.ok(printed, `no result line for the task: ${show(result)}`);
  for (const metric of ['p50Ms', 'peakBytes']) {
    const judged = printed.limits?.[metric];
    fiveReadings(judged, metric);
    assert.equal(judged.status, 'PASS', `${metric}: ${JSON.stringify(judged)}\n${show(result)}`);
  }
  for (const run of printed.limits.p50Ms.runs) assert.ok(run < 500, `the 1 s cold run was judged, not warmed up: ${printed.limits.p50Ms.runs}`);
  assert.ok(invocations() >= 6, `the command ran ${invocations()} times; five runs after a warm-up take at least six`);
  assert.equal(result.status, 0, show(result));
  assert.match(result.stdout, /^PASS perf \(/m, show(result));
});

test('on the reference Mac, a task over its limit in all five runs by more than the margin fails the lane', async (t) => {
  const { result, line } = lane(t, { planted: REFERENCE, task: { id: 'slow', command: STEADY_50MS, limits: TIGHT } });
  const printed = line('slow');
  assert.ok(printed, `no result line for the task: ${show(result)}`);
  fiveReadings(printed.limits?.p50Ms, 'p50Ms');
  assert.equal(printed.limits.p50Ms.status, 'FAIL', JSON.stringify(printed.limits.p50Ms));
  assert.notEqual(result.status, 0, show(result));
  assert.match(result.stdout, /^FAIL perf: .*slow.*\n {2}Fix: /m, show(result));
  assert.doesNotMatch(result.stdout, /^PASS perf/m, show(result));
});

test('off the reference Mac, a task within its limits is a reading: INCONCLUSIVE with its five runs, and the lane does not pass', async (t) => {
  for (const planted of [OTHER, { ...REFERENCE, power: 'battery' }]) {
    const { result, line } = lane(t, { planted, task: { id: 'quick', command: QUICK, limits: GENEROUS } });
    const printed = line('quick');
    assert.ok(printed, `no result line for the task: ${show(result)}`);
    for (const metric of ['p50Ms', 'peakBytes']) {
      fiveReadings(printed.limits?.[metric], metric);
      assert.equal(printed.limits[metric].status, 'INCONCLUSIVE', `${planted.model} on ${planted.power}, ${metric}: ${JSON.stringify(printed.limits[metric])}`);
    }
    assert.notEqual(result.status, 0, show(result));
    assert.doesNotMatch(result.stdout, /^PASS perf/m, show(result));
    assert.match(result.stdout, /^INCONCLUSIVE perf: .*quick.*\n {2}Fix: /m, show(result));
  }
});

test('off the reference Mac, a task over its limit is a reading too: INCONCLUSIVE, never FAIL', async (t) => {
  for (const planted of [OTHER, { ...REFERENCE, thermalState: 'serious' }]) {
    const { result, line } = lane(t, { planted, task: { id: 'slow', command: STEADY_50MS, limits: TIGHT } });
    const printed = line('slow');
    assert.ok(printed, `no result line for the task: ${show(result)}`);
    fiveReadings(printed.limits?.p50Ms, 'p50Ms');
    assert.equal(printed.limits.p50Ms.status, 'INCONCLUSIVE', `${planted.model}, thermal ${planted.thermalState}: ${JSON.stringify(printed.limits.p50Ms)}`);
    assert.doesNotMatch(result.stdout, /^FAIL perf/m, `a budget counted off the reference Mac: ${show(result)}`);
    assert.notEqual(result.status, 0, show(result));
    assert.match(result.stdout, /^INCONCLUSIVE perf: .*slow.*\n {2}Fix: /m, show(result));
  }
});
