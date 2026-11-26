// #3587: a budget whose allowance is no whole number of milliseconds (4001 ms with a margin of 0.1: 4401.1 ms) still
// runs and times the checks.
import assert from 'node:assert/strict';
import test from 'node:test';
import { entry, exitBy, lines, shown, start, timedGrant } from './helpers.mjs';

test('#3587.4323e662 a budget whose allowance is not a whole number of milliseconds still runs and times the checks: no BLOCKED check workload line, and checks that pass read as passed', { timeout: 5 * 60_000 }, async (t) => {
  const cwd = entry(t, { checks: 'console.log("check ran");', limit: 4001, margin: 0.1 });
  const run = start(t, cwd);
  const grantAt = await timedGrant(run);
  assert.ok(grantAt, `the preflight never took its timed grant on its own table within two minutes: ${shown(run)}`);
  const ended = await exitBy(run, grantAt + 60_000);
  assert.ok(ended, `the preflight did not end within 60 s of its grant, though its checks end at once: ${shown(run)}`);
  assert.deepEqual(lines(run.out, /BLOCKED check workload/), [], `the checks were not run and timed under an allowance of ${(4001 * 1.1).toFixed(1)} ms: ${shown(run)}`);
  assert.ok(lines(run.out, /^check ran$/).length, `the check never ran: ${shown(run)}`);
  assert.deepEqual(lines(run.out, /^(BLOCKED|FAIL) /), [], `checks that pass read as not passed: ${shown(run)}`);
  assert.ok(lines(run.out, /^perf ran$/).length, `perf did not run after checks that passed: ${shown(run)}`);
  assert.equal(ended.code, 0, `a preflight whose checks and perf pass exited non-zero: ${shown(run)}`);
});
