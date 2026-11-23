// #3171 AC2 #3171.52591b24: "In a whole-workspace `cargo test` on the Spark the test passes, or states that the GPU was
// shared and reads INCONCLUSIVE; it never reads FAIL for another process's work".
// Run: node --test --test-concurrency=1 tests/acceptance/3171/ac2-shared.test.mjs   (README.md beside this file)
//
// The GPU a whole-workspace run shares is made here on purpose: load.rs, a second process, keeps it busy with passes
// of about 200 ms while cargo runs the span test, which the lanes then read as they read any cargo run (cargoResults,
// scripts/lanes.mjs). Beside the load the test must read PASS or INCONCLUSIVE, an INCONCLUSIVE naming the GPU as
// shared, never FAIL. Alone it must read PASS: nothing shares the GPU there, so an INCONCLUSIVE would be no reading
// at all. The test's own bound is never loosened: a PASS, alone or beside the load, has every trial it states within
// the base's 100 ms of the passes' own time, so a span that counts the CPU's 200 ms gap still reads FAIL. The
// whole-workspace runs the issue's Proof names are evidence (README.md).
import assert from 'node:assert/strict';
import test from 'node:test';
import { BOUND_MS, MINUTE, shown, spanRun } from './helpers.mjs';

// The criterion's tag: `#3171.<first 8 hex digits of the SHA-256 of its text, trimmed, white space collapsed>`.
const AC2 = 'AC2 #3171.52591b24';

/** A PASS keeps the base test's bound on every trial it states. */
function withinBound(run, where) {
  for (const { trial, covered, own } of run.trials)
    assert.ok(covered < own + BOUND_MS, `${where}: the span test reads PASS with trial ${trial} at ${covered} ms covered, the passes' own ${own}: past the ${BOUND_MS} ms bound, so the gap would pass`);
}

test(`${AC2} beside a second process that keeps the GPU busy, the span test passes or reads INCONCLUSIVE saying the GPU was shared, never FAIL`, { timeout: 45 * MINUTE }, async () => {
  const run = await spanRun({ beside: true });
  const where = `beside a load of ${run.passMs?.toFixed(0)} ms passes`;
  assert.notEqual(run.state, null, `${where}: no deep-gpu target ran the span test:\n${shown(run)}`);
  assert.notEqual(run.state, 'FAIL', `${where}: the span test reads FAIL for another process's work:\n${shown(run)}`);
  assert.ok(['PASS', 'INCONCLUSIVE'].includes(run.state), `${where}: the span test reads ${run.state} (${run.message}):\n${shown(run)}`);
  if (run.state === 'INCONCLUSIVE') assert.match(run.message, /\bGPU\b[^]*\bshared?\b|\bshared?\b[^]*\bGPU\b/i, `${where}: the span test reads INCONCLUSIVE without saying the GPU was shared: ${run.message}`);
  else withinBound(run, where);
});

test(`${AC2} alone, the span test reads PASS within its bound`, { timeout: 45 * MINUTE }, async () => {
  const run = await spanRun({ beside: false });
  assert.equal(run.state, 'PASS', `alone: the span test reads ${run.state}${run.message ? ` (${run.message})` : ''}:\n${shown(run)}`);
  withinBound(run, 'alone');
});
