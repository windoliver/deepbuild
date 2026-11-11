// #1432 acceptance, AC4: the time the size ratchet adds to the lint lane, read on this checkout. It
// judges a wall-clock budget, so it runs only under a timed grant (README: AC4 and load).
import assert from 'node:assert/strict';
import { cpus, loadavg } from 'node:os';
import test from 'node:test';
import { assertPasses, ratchet, ratchetCommand, root } from './helpers.mjs';

const BUDGET_S = 2;
const RUNS = 3;

test('AC4: the size ratchet adds under 2 s to the lint lane on this checkout', (t) => {
  ratchetCommand();
  const seconds = [];
  for (let run = 0; run < RUNS; run++) {
    const result = ratchet(root);
    assertPasses(result);
    seconds.push(result.seconds);
  }
  seconds.sort((a, b) => a - b);
  const median = seconds[Math.floor(RUNS / 2)];
  const load = loadavg()[0], cores = cpus().length;
  const reading = `median ${median.toFixed(2)} s of ${RUNS} runs (${seconds.map((s) => s.toFixed(2)).join(', ')} s) at load ${load.toFixed(1)} on ${cores} cores`;
  t.diagnostic(reading);
  if (median < BUDGET_S) return;
  if (load >= cores) return t.skip(`INCONCLUSIVE: over the ${BUDGET_S} s budget under load, ${reading}; this is not a pass`);
  assert.fail(`the ratchet adds ${reading}, not under ${BUDGET_S} s`);
});
