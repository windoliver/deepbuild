// #3587: checks that end past the budget (3 s) but within the allowance (margin 1, so 6.00 s) are not stopped.
import assert from 'node:assert/strict';
import test from 'node:test';
import { entry, exitBy, lines, shown, start, timedGrant } from './helpers.mjs';

const LIMIT = 3000, MARGIN = 1, ALLOWANCE = LIMIT * (1 + MARGIN);
const CHECKS = `
console.log('check started');
await new Promise((done) => setTimeout(done, 4000));
console.log('check last line');
`;

test('#3587.4d67f808 checks that end past the budget but within the allowance are not stopped: their output is complete, with a "checks took" budget FAIL and no "were stopped" line', { timeout: 5 * 60_000 }, async (t) => {
  const cwd = entry(t, { checks: CHECKS, limit: LIMIT, margin: MARGIN });
  const run = start(t, cwd);
  const grantAt = await timedGrant(run);
  assert.ok(grantAt, `the preflight never took its timed grant on its own table within two minutes: ${shown(run)}`);
  const ended = await exitBy(run, grantAt + ALLOWANCE + 60_000);
  assert.ok(ended, `the preflight did not end within ${(ALLOWANCE + 60_000) / 1000} s of its grant, though its checks end after 4 s: ${shown(run)}`);
  assert.ok(lines(run.out, /^check started$/).length, `the check never started: ${shown(run)}`);
  assert.ok(lines(run.out, /^check last line$/).length, `the check's last line, "check last line", is missing: the checks were stopped before the allowance of ${(ALLOWANCE / 1000).toFixed(2)} s. ${shown(run)}`);
  assert.deepEqual(lines(run.out, /were stopped/), [], `checks that ended within the allowance read as stopped: ${shown(run)}`);
  assert.equal(lines(run.out, /^FAIL preflight budget: checks took \d+\.\d{2} s$/).length, 1, `no single "FAIL preflight budget: checks took <s> s" line for checks past the ${LIMIT / 1000} s budget: ${shown(run)}`);
});
