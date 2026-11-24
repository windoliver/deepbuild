// #3171 AC1 #3171.952eea5a: "It is known which of the two it is: the covered time and the passes' own timestamps, read
// on the Spark alone and beside a second process that keeps the GPU busy".
// Run: node --test --test-concurrency=1 tests/acceptance/3171/ac1-readings.test.mjs   (README.md beside this file)
//
// The span test is run by cargo as the lanes run it, once alone and once beside load.rs, a second process that keeps
// the GPU busy, and its output (with --show-output, so a passing test's too) must state, for each trial it ran from
// trial 0 on, the covered time and the passes' own, in the words of the base test's own message:
// `trial <k>: <covered> ms covered, the passes' own <own>`. The base states them only when the gap bound fails. Which of
// the two the issue names it is, read from these readings on the Spark, is the implementer's evidence and is judged
// by hand (README.md); this test proves the readings are there to judge, in both conditions, whatever the test reads.
import assert from 'node:assert/strict';
import test from 'node:test';
import { MINUTE, shown, spanRun } from './helpers.mjs';

// The criterion's tag: `#3171.<first 8 hex digits of the SHA-256 of its text, trimmed, white space collapsed>`.
const AC1 = 'AC1 #3171.952eea5a';

/** The trials a run states, each once, numbered from 0 with none left out, each with readings that are times. */
function stated(run, where) {
  assert.notEqual(run.state, null, `${where}: no deep-gpu target ran the span test:\n${shown(run)}`);
  const numbers = [...new Set(run.trials.map(({ trial }) => trial))].sort((a, b) => a - b);
  assert.ok(numbers.length > 0, `${where}: the span test reads ${run.state} and states no trial's covered time and passes' own ("trial <k>: <covered> ms covered, the passes' own <own>"):\n${shown(run)}`);
  assert.deepEqual(numbers, numbers.map((_, k) => k), `${where}: the trials stated are ${numbers.join(', ')}, not each one from trial 0 on`);
  for (const { trial, covered, own } of run.trials) {
    assert.ok(Number.isFinite(covered) && covered > 0, `${where}: trial ${trial} states ${covered} ms covered`);
    assert.ok(Number.isFinite(own) && own > 0, `${where}: trial ${trial} states the passes' own as ${own} ms`);
  }
}

test(`${AC1} alone, the span test states each trial's covered time and the passes' own`, { timeout: 45 * MINUTE }, async () => {
  stated(await spanRun({ beside: false }), 'alone');
});

test(`${AC1} beside a second process that keeps the GPU busy, the span test states each trial's covered time and the passes' own`, { timeout: 45 * MINUTE }, async () => {
  const run = await spanRun({ beside: true });
  stated(run, `beside a load of ${run.passMs?.toFixed(0)} ms passes`);
});
