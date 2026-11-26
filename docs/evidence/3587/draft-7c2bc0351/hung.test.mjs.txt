// #3587: a check that never ends, with a child that never ends, under a budget of 4 s and a margin of 0.5, so the
// allowance is 6.00 s. One run serves the first three criteria.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { HUNG_CHECKS, alive, entry, exitBy, lines, readPids, shown, sleep, start, throttleLog, throttleTable, timedGrant, until } from './helpers.mjs';

const LIMIT = 4000, MARGIN = 0.5, ALLOWANCE = LIMIT * (1 + MARGIN);
const LONG = { timeout: 5 * 60_000 };
let run, grantAt, ended, pids, left;
const cleanups = [];
const t = { after: (cleanup) => cleanups.push(cleanup) };
after(() => { for (const cleanup of cleanups.reverse()) cleanup(); });

before(async () => {
  const cwd = entry(t, { checks: HUNG_CHECKS, perf: 'import { writeFileSync } from "node:fs"; writeFileSync("perf-ran", "");', limit: LIMIT, margin: MARGIN });
  run = start(t, cwd);
  grantAt = await timedGrant(run);
  // Bounded from the grant: a timed grant waits for the machine's load, and the budget is the checks', inside it.
  ended = await exitBy(run, (grantAt ?? performance.now()) + ALLOWANCE + 30_000);
  await until(() => !run.exit || ['check', 'child'].every((name) => !alive(readPids(cwd)[name])), 1000);
  pids = readPids(cwd);
  left = ['check', 'child'].filter((name) => alive(pids[name]));
  // What still runs is stopped, by PID and group, before the log and table are read: a SIGKILL gives nothing back.
  run.kill();
  await sleep(300);
}, LONG);

test('#3587.f9f3205c a check that never ends, with a child that never ends, is stopped at the allowance: preflight exits non-zero within it plus 30 s, says so with the allowance, and neither is left alive', LONG, () => {
  assert.ok(grantAt, `the preflight never took its timed grant on its own table within two minutes: ${shown(run)}`);
  assert.ok(pids.check && pids.child, `the stub check never started: ${shown(run)}`);
  assert.ok(ended, `the preflight hung: it was still running ${(ALLOWANCE + 30_000) / 1000} s after its timed grant, waiting on checks that never end, with no timeout at the allowance of ${(ALLOWANCE / 1000).toFixed(2)} s. ${shown(run)}`);
  assert.notEqual(ended.code, 0, `the preflight passed a run whose checks never ended: ${shown(run)}`);
  assert.ok(lines(run.out, /^FAIL preflight budget: the checks ran past 6\.00 s, the budget with its margin, and were stopped$/).length >= 1,
    `no line "FAIL preflight budget: the checks ran past 6.00 s, the budget with its margin, and were stopped": ${shown(run)}`);
  assert.deepEqual(left, [], `still alive after the preflight ended: ${left.map((name) => `the ${name} (pid ${pids[name]})`).join(', ')}`);
});

test('#3587.ba427c00 in that run the output holds exactly one FAIL preflight budget line, no "checks took" line, and BLOCKED perf', LONG, () => {
  const budget = lines(run.out, /^FAIL preflight budget/);
  assert.equal(budget.length, 1, `expected exactly one FAIL preflight budget line, got ${budget.length}${budget.length > 1 ? ' (a duplicate budget FAIL for the same run)' : ''}: ${JSON.stringify(budget)}; ${shown(run)}`);
  assert.deepEqual(lines(run.out, /checks took/), [], `a "checks took" line beside the stop's line duplicates the budget FAIL: ${shown(run)}`);
  assert.ok(lines(run.out, /^BLOCKED perf/).length >= 1, `no BLOCKED perf line: ${shown(run)}`);
});

test('#3587.1c61ab9b in that run the throttle log records the preflight\'s timed grant and its release, and the table holds none of its grants or requests afterwards', LONG, () => {
  const log = throttleLog(run.cwd);
  const grant = log.find((line) => line.event === 'granted' && line.class === 'timed');
  assert.ok(grant, `the table's log records no timed grant: ${JSON.stringify(log)}`);
  assert.ok(ended, `the preflight never ended by itself, so it never gave back its timed grant ${grant.id} (pid ${grant.pid})`);
  const released = log.filter((line) => line.event === 'released' && line.id === grant.id);
  assert.equal(released.length, 1, `the log records no release of timed grant ${grant.id} (pid ${grant.pid}): ${JSON.stringify(log)}`);
  const ours = new Set([run.pid, grant.pid, ...run.tracked]);
  const { grants = [], requests = [] } = throttleTable(run.cwd);
  const held = [...grants, ...requests].filter((item) => ours.has(item.pid) || item.id === grant.id);
  assert.deepEqual(held, [], `the table still holds the preflight's ${held.map((item) => `${item.class} ${item.id}`).join(', ')} after it ended`);
});
