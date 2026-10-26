// #724 acceptance: the perf lane on a loaded Mac on battery, with the real counter and the live
// fingerprint. One lane run measures three tasks against their merge base: one unchanged, one whose
// program retires 1.5% more instructions and one whose program retires 20% more. Each load test
// asserts first; if the run wasn't at a load average above 40 on battery throughout, it is then
// skipped as INCONCLUSIVE with what it saw, never passed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { before, test } from 'node:test';
import {
  BASE_ITERATIONS, PLUS_1_5, PLUS_20, comparison, fileScope, independentCounts, loadedOnBattery, matchesCounter, perfLane, realPairs, reported, show,
} from './helpers.mjs';

const OBSERVED_INSTRUCTIONS = 987_654_321;
let lane, counts;
const scope = fileScope();

before(() => {
  if (process.platform !== 'darwin') return;
  lane = perfLane(scope, {
    observation: { status: 0, elapsedMs: 1, cpuMs: 1, peakBytes: 1, instructions: OBSERVED_INSTRUCTIONS },
    tasks: [
      { id: 'unchanged', current: BASE_ITERATIONS },
      { id: 'plus-1-5', current: PLUS_1_5 },
      { id: 'plus-20', current: PLUS_20 },
    ],
  });
  counts = independentCounts(scope, [BASE_ITERATIONS, PLUS_1_5, PLUS_20]);
});

const ready = (t) => {
  if (process.platform !== 'darwin') assert.fail('BLOCKED: the counter is read from macOS\'s /usr/bin/time -l');
  t.diagnostic(`perf took ${lane.seconds.toFixed(1)} s`);
};
// The plant is what it says: this test's own reading of the real counter, apart from the lane. The
// 1.5% plant's window, 0.9% to 1.95%, keeps it a rise and under the 2% floor; the 20% plant's, 18% to
// 22%, keeps it far over any margin its pairs could set.
const planted = (current, low, high) => {
  const rise = counts[current] / counts[BASE_ITERATIONS] - 1;
  assert.ok(rise > low && rise < high, `the planted change retires ${(rise * 100).toFixed(2)}% more instructions, not between ${(low * 100).toFixed(2)}% and ${(high * 100).toFixed(2)}%`);
  return { current: counts[current], base: counts[BASE_ITERATIONS] };
};
const verdictLine = (state, id, what) => RegExp(`^${state} perf: [^\\n]*\\b${id}\\b[^\\n]*${what}[^\\n]*\\n {2}Fix: `, 'm');

test('at a load average above 40 on battery, a planted 20% rise in instructions fails its comparison with the merge base, with every pair attached', (t) => {
  ready(t);
  const expected = planted(PLUS_20, 0.18, 0.22);
  const { judged } = comparison(lane, 'plus-20');
  realPairs('plus-20', judged.pairs);
  matchesCounter('plus-20', judged.pairs, expected);
  for (const [round, { current, base }] of judged.pairs.entries()) {
    assert.ok(current / base - 1 > 0.15 && current / base - 1 < 0.25, `pair ${round} is not the planted rise: ${current} against ${base}`);
  }
  assert.equal(judged.status, 'FAIL', `a 20% rise in instructions retired, judged on its pairs: ${JSON.stringify(judged)}\n${show(lane.result)}`);
  reported('plus-20', judged);
  assert.match(lane.result.stdout, verdictLine('FAIL', 'plus-20', 'instructions'), show(lane.result));
  assert.notEqual(lane.result.status, 0, show(lane.result));
  assert.doesNotMatch(lane.result.stdout, /^PASS perf/m, show(lane.result));
  loadedOnBattery(t, lane.before, lane.after);
});

test('under the same load, an unchanged task passes its instruction comparison, with the margin and the pairs\' spread reported', (t) => {
  ready(t);
  const { judged } = comparison(lane, 'unchanged');
  realPairs('unchanged', judged.pairs);
  matchesCounter('unchanged', judged.pairs, { current: counts[BASE_ITERATIONS], base: counts[BASE_ITERATIONS] });
  assert.equal(judged.status, 'PASS', `${JSON.stringify(judged)}\n${show(lane.result)}`);
  const { spread, margin } = reported('unchanged', judged);
  t.diagnostic(`unchanged: change ${(judged.change * 100).toFixed(3)}%, spread ${(spread * 100).toFixed(3)}%, margin ${(margin * 100).toFixed(3)}%`);
  assert.doesNotMatch(lane.result.stdout, verdictLine('(?:FAIL|INCONCLUSIVE|BLOCKED|INVALID)', 'unchanged', 'instructions'), show(lane.result));
  loadedOnBattery(t, lane.before, lane.after);
});

test('under the same load, a planted 1.5% rise passes: the margin is the larger of 2% and the pairs\' spread, never under 2%', (t) => {
  ready(t);
  const expected = planted(PLUS_1_5, 0.009, 0.0195);
  const { judged } = comparison(lane, 'plus-1-5');
  realPairs('plus-1-5', judged.pairs);
  matchesCounter('plus-1-5', judged.pairs, expected);
  const { change, spread, margin } = reported('plus-1-5', judged);
  t.diagnostic(`plus-1-5: change ${(change * 100).toFixed(3)}%, spread ${(spread * 100).toFixed(3)}%, margin ${(margin * 100).toFixed(3)}%`);
  assert.ok(margin >= 0.02, `margin ${margin}`);
  assert.equal(judged.status, 'PASS', `a 1.5% rise is within the 2% floor: ${JSON.stringify(judged)}\n${show(lane.result)}`);
  assert.doesNotMatch(lane.result.stdout, verdictLine('(?:FAIL|INCONCLUSIVE|BLOCKED|INVALID)', 'plus-1-5', 'instructions'), show(lane.result));
  loadedOnBattery(t, lane.before, lane.after);
});

test('every result perf prints carries instructions retired, the counter they came from and the macOS build', (t) => {
  ready(t);
  const build = execFileSync('sw_vers', ['-buildVersion'], { encoding: 'utf8' }).trim();
  const results = lane.lines.filter(({ task }) => task);
  assert.deepEqual(results.map(({ task }) => task).sort(), ['plus-1-5', 'plus-20', 'preflight', 'unchanged'], show(lane.result));
  for (const printed of results) {
    assert.match(String(printed.counter), /\/usr\/bin\/time -l/, `${printed.task} names where its counts came from: ${JSON.stringify(printed)}`);
    assert.equal(printed.fingerprint?.macosBuild, build, `${printed.task} records the macOS build the counter ran under`);
  }
  // The preflight workload runs once a side: its readings carry their counts beside CPU time and peak memory.
  const preflight = lane.line('preflight');
  assert.equal(preflight.current?.instructions, OBSERVED_INSTRUCTIONS, `the observed workload's count: ${JSON.stringify(preflight)}`);
  assert.ok(Number.isSafeInteger(preflight.base?.instructions) && preflight.base.instructions > 0, `the merge base's workload count: ${JSON.stringify(preflight.base)}`);
  for (const id of ['unchanged', 'plus-1-5', 'plus-20']) realPairs(id, comparison(lane, id).judged.pairs);
});
