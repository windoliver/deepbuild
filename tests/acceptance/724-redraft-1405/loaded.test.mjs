// #724 acceptance, redrafted blind under #1405's rule (REDRAFT.md): the perf lane on a loaded Mac on
// battery, with the real counter and the live fingerprint, as tests/acceptance/724/loaded.test.mjs runs
// it, with the same plants and helpers. Only the instruction verdict's expectations change: the margin
// and spread give way to two seeded sign-flip tests against 2%, with the seed and both p values reported.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import {
  BASE_ITERATIONS, PLUS_1_5, PLUS_20, comparison, fileScope, independentCounts, loadedOnBattery, matchesCounter, perfLane, realPairs, show,
} from '../724/helpers.mjs';

let lane, counts;
const scope = fileScope();

before(() => {
  if (process.platform !== 'darwin') return;
  lane = perfLane(scope, {
    observation: { status: 0, elapsedMs: 1, cpuMs: 1, peakBytes: 1, instructions: 987_654_321 },
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
const planted = (current, low, high) => {
  const rise = counts[current] / counts[BASE_ITERATIONS] - 1;
  assert.ok(rise > low && rise < high, `the planted change retires ${(rise * 100).toFixed(2)}% more instructions, not between ${(low * 100).toFixed(2)}% and ${(high * 100).toFixed(2)}%`);
  return { current: counts[current], base: counts[BASE_ITERATIONS] };
};
const verdictLine = (state, id, what) => RegExp(`^${state} perf: [^\\n]*\\b${id}\\b[^\\n]*${what}[^\\n]*\\n {2}Fix: `, 'm');
// The seed and both p values, as #1405 puts them in the result.
const reported = (id, judged) => {
  assert.ok(judged.seed !== undefined && judged.seed !== null, `${id}: the seed is in the result: ${JSON.stringify(judged)}`);
  for (const field of ['pAbove', 'pBelow']) assert.ok(typeof judged[field] === 'number' && judged[field] >= 0 && judged[field] <= 1, `${id}: ${field} is in the result: ${JSON.stringify(judged)}`);
  return judged;
};

test('at a load average above 40 on battery, a planted 20% rise in instructions fails its comparison with the merge base, with every pair attached', (t) => {
  ready(t);
  const expected = planted(PLUS_20, 0.18, 0.22);
  const { judged } = comparison(lane, 'plus-20');
  realPairs('plus-20', judged.pairs);
  matchesCounter('plus-20', judged.pairs, expected);
  assert.equal(judged.status, 'FAIL', `a 20% rise in instructions retired, judged on its pairs: ${JSON.stringify(judged)}\n${show(lane.result)}`);
  assert.ok(reported('plus-20', judged).pAbove < 0.01, `"above 2%" at p under 0.01: ${JSON.stringify(judged)}`);
  assert.match(lane.result.stdout, verdictLine('FAIL', 'plus-20', 'instructions'), show(lane.result));
  assert.notEqual(lane.result.status, 0, show(lane.result));
  assert.doesNotMatch(lane.result.stdout, /^PASS perf/m, show(lane.result));
  loadedOnBattery(t, lane.before, lane.after);
});

test('under the same load, an unchanged task passes its instruction comparison, with the seed and both p values reported', (t) => {
  ready(t);
  const { judged } = comparison(lane, 'unchanged');
  realPairs('unchanged', judged.pairs);
  matchesCounter('unchanged', judged.pairs, { current: counts[BASE_ITERATIONS], base: counts[BASE_ITERATIONS] });
  assert.equal(judged.status, 'PASS', `${JSON.stringify(judged)}\n${show(lane.result)}`);
  assert.ok(reported('unchanged', judged).pBelow < 0.01, `"at least 2%" rejected at p under 0.01: ${JSON.stringify(judged)}`);
  assert.doesNotMatch(lane.result.stdout, verdictLine('(?:FAIL|INCONCLUSIVE|BLOCKED|INVALID)', 'unchanged', 'instructions'), show(lane.result));
  loadedOnBattery(t, lane.before, lane.after);
});

test('under the same load, a planted 1.5% rise passes: the line is 2%, never under it', (t) => {
  ready(t);
  const expected = planted(PLUS_1_5, 0.009, 0.0195);
  const { judged } = comparison(lane, 'plus-1-5');
  realPairs('plus-1-5', judged.pairs);
  matchesCounter('plus-1-5', judged.pairs, expected);
  assert.equal(judged.status, 'PASS', `a 1.5% rise is under the 2% line: ${JSON.stringify(judged)}\n${show(lane.result)}`);
  assert.ok(reported('plus-1-5', judged).pBelow < 0.01, `"at least 2%" rejected at p under 0.01: ${JSON.stringify(judged)}`);
  assert.doesNotMatch(lane.result.stdout, verdictLine('(?:FAIL|INCONCLUSIVE|BLOCKED|INVALID)', 'plus-1-5', 'instructions'), show(lane.result));
  loadedOnBattery(t, lane.before, lane.after);
});
