// #3454 acceptance, AC8: the time the comment ratchet adds to the lint lane, read on this checkout. It judges a
// wall-clock budget, so it counts only on a reference Mac on mains power, with Low Power Mode off and the thermal state
// nominal; anywhere else it is a reading and the test is INCONCLUSIVE, never a pass (README: reading 15).
import assert from 'node:assert/strict';
import { cpus, loadavg } from 'node:os';
import test from 'node:test';
import { assertPasses, environmentProblem, guard, guardCommand, root } from './helpers.mjs';

const BUDGET_S = 10;
const RUNS = 3;

test('#3454.355ba129 AC8: the comment ratchet adds under 10 s to the lint lane on this checkout, on a reference Mac', (t) => {
  guardCommand();
  const runs = [];
  for (let run = 0; run < RUNS; run++) {
    const result = guard(root);
    assertPasses(result, `(this checkout as it stands, run ${run + 1})`);
    runs.push(result.seconds);
  }
  runs.sort((a, b) => a - b);
  const median = runs[Math.floor(RUNS / 2)];
  const reading = `median ${median.toFixed(2)} s of ${RUNS} runs (${runs.map((s) => s.toFixed(2)).join(', ')} s) at load ${loadavg()[0].toFixed(1)} on ${cpus().length} cores`;
  t.diagnostic(reading);
  const problem = environmentProblem();
  if (problem) return t.skip(`INCONCLUSIVE: ${problem}; a reading only, ${reading}; this is not a pass`);
  const within = median < BUDGET_S;
  assert.ok(within, `the comment ratchet adds ${reading}, not under ${BUDGET_S} s`);
});
