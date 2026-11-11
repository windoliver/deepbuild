// #724 acceptance: the perf lane on a loaded Mac on battery, with the real counter and the live
// fingerprint. One lane run measures three tasks against their merge base: one unchanged, one whose
// program retires 1.5% more instructions and one whose program retires 20% more. The three tests that
// judged them under #724's margin run from tests/acceptance/724-redraft-1405/ under #1405's rule.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { before, test } from 'node:test';
import {
  BASE_ITERATIONS, PLUS_1_5, PLUS_20, comparison, fileScope, perfLane, realPairs, show,
} from './helpers.mjs';

const OBSERVED_INSTRUCTIONS = 987_654_321;
let lane;
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
});

const ready = (t) => {
  if (process.platform !== 'darwin') assert.fail('BLOCKED: the counter is read from macOS\'s /usr/bin/time -l');
  t.diagnostic(`perf took ${lane.seconds.toFixed(1)} s`);
};
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
