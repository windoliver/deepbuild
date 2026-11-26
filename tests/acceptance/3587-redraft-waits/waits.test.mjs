// #3587: preflight's measured checks end at the budget with its margin, and a stop still reaches them. Each test runs
// scripts/preflight in a scratch entry of its own (helpers.mjs). Run with node --test, one file, its tests in order.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { entry, GATED, HANG, left, PASS, shown, SLOW, TIMEOUT, within } from './helpers.mjs';

const STARTED = /^stub check started$/m;
// Long enough for the warm-up's failing builds and the grant in an entry with nothing to build.
const START_MS = 60_000;

// Criteria 1 to 3 read one run: a check that never ends, with a child that never ends, under a 4 s budget with margin
// 0.5, so a 6.00 s allowance. Preflight is given the allowance plus 30 s from its start to exit.
const HANG_BUDGET = { budgetMs: 4_000, margin: 0.5 };
const ALLOWANCE_MS = 6_000;
let hangRun;
const hung = () => (hangRun ??= (async () => {
  const box = entry({ checks: HANG, ...HANG_BUDGET });
  const run = box.start();
  const exit = within(run.exited, ALLOWANCE_MS + 30_000);
  const began = await run.line(STARTED, START_MS);
  const ended = await exit;
  // What it printed last reaches the pipe after its exit; a process still holding the pipe is read as it stands.
  if (ended !== TIMEOUT) await within(run.closed, 5_000);
  const reading = { box, run, began, exit: ended === TIMEOUT ? null : ended, left: left(box), roles: box.recorded().map(({ role }) => role), log: box.log(), table: box.table(), out: run.out };
  box.stop();
  return reading;
})());

test('#3587.f9f3205c a check that never ends, and its child, are stopped at the allowance: preflight exits non-zero within it plus 30 s, prints the stopped line with the allowance to two decimals, and neither is left alive', { timeout: 180_000 }, async () => {
  const { began, exit, left: alive, roles, run } = await hung();
  assert.ok(began && roles.includes('check') && roles.includes('child'), `the stub check never started with its child${shown(run)}`);
  assert.notEqual(exit, null, `preflight was still running ${(ALLOWANCE_MS + 30_000) / 1000} s after its start: it waits for the hung checks with no timeout${shown(run)}`);
  assert.ok(Number.isInteger(exit.code) && exit.code !== 0, `preflight exited ${JSON.stringify(exit)}, not non-zero${shown(run)}`);
  assert.match(run.out, /^FAIL preflight budget: the checks ran past 6\.00 s, the budget with its margin, and were stopped$/m, `no stopped line naming the 6.00 s allowance${shown(run)}`);
  assert.deepEqual(alive, [], `alive after preflight exited: ${alive.join(', ')}${shown(run)}`);
});

test('#3587.ba427c00 in that run the output holds exactly one FAIL preflight budget line, no checks took line, and BLOCKED perf', { timeout: 180_000 }, async () => {
  const { run } = await hung();
  const budgetLines = run.out.split('\n').filter((line) => line.startsWith('FAIL preflight budget'));
  assert.equal(budgetLines.length, 1, `${budgetLines.length} FAIL preflight budget lines, not one${budgetLines.length > 1 ? ': a duplicate' : ''}${shown(run)}`);
  assert.doesNotMatch(run.out, /checks took/, `a checks took line beside the stopped line: a duplicate budget FAIL${shown(run)}`);
  assert.match(run.out, /^BLOCKED perf\b/m, `no BLOCKED perf line${shown(run)}`);
});

test('#3587.1c61ab9b in that run the throttle log records the preflight\'s timed grant and its release, and the table holds no grant or request of it afterwards', { timeout: 180_000 }, async () => {
  const { run, log, table } = await hung();
  const grant = log.find((line) => line.event === 'granted' && line.class === 'timed' && line.pid === run.pid);
  assert.ok(grant, `the throttle log in use records no timed grant to preflight (pid ${run.pid}): ${JSON.stringify(log)}${shown(run)}`);
  const released = log.find((line) => line.event === 'released' && line.id === grant.id);
  assert.ok(released, `timed grant ${grant.id} of preflight has no release in the log: it is still held${shown(run)}`);
  assert.deepEqual({ grants: table.grants, requests: table.requests }, { grants: [], requests: [] }, `the table still holds the preflight's grant or request`);
});

test('#3587.4d67f808 checks that end past the budget but within the allowance are not stopped: their output is complete, with checks took and no were stopped line', { timeout: 180_000 }, async () => {
  // A 3 s budget with margin 1, so a 6.00 s allowance; the check takes 3.2 s after the warm-up.
  const box = entry({ checks: SLOW(3_200), budgetMs: 3_000, margin: 1 });
  const run = box.start();
  const closed = await within(run.closed, START_MS + 30_000);
  assert.notEqual(closed, TIMEOUT, `preflight never ended${shown(run)}`);
  assert.match(run.out, /^stub check first line$/m, `the check never started${shown(run)}`);
  assert.match(run.out, /^stub check last line$/m, `the check's last line is missing: it was stopped before it ended${shown(run)}`);
  assert.match(run.out, /^FAIL preflight budget: checks took \d+\.\d\d s$/m, `no checks took line${shown(run)}`);
  assert.doesNotMatch(run.out, /were stopped/, `a were stopped line for checks within the allowance${shown(run)}`);
});

test('#3587.62b7650e a SIGINT to preflight\'s process group while a never-ending check and its child run ends it within 30 s with exit 130, neither left alive, timed released', { timeout: 180_000 }, async () => {
  // A budget the run never reaches, so only the stop ends it.
  const box = entry({ checks: HANG, budgetMs: 600_000, margin: 0.5 });
  const run = box.start();
  const began = await run.line(STARTED, START_MS);
  assert.ok(began, `the stub check never started${shown(run)}`);
  process.kill(-run.pid, 'SIGINT');
  const exit = await within(run.exited, 30_000);
  const alive = left(box), log = box.log(), table = box.table();
  assert.notEqual(exit, TIMEOUT, `preflight was still running 30 s after the SIGINT to its group${shown(run)}`);
  assert.equal(exit.code, 130, `preflight exited ${JSON.stringify(exit)}, not 130${shown(run)}`);
  assert.deepEqual(alive, [], `alive after preflight exited: ${alive.join(', ')}${shown(run)}`);
  const grant = log.find((line) => line.event === 'granted' && line.class === 'timed' && line.pid === run.pid);
  assert.ok(grant && log.some((line) => line.event === 'released' && line.id === grant.id), `timed was not released: ${JSON.stringify(log)}${shown(run)}`);
  assert.deepEqual({ grants: table.grants, requests: table.requests }, { grants: [], requests: [] }, 'the table still holds the preflight\'s grant or request');
});

test('#3587.c4fdbceb when the process scripts/preflight becomes is SIGKILLed while the checks run, and they then end and pass, nothing more runs: no perf, no harness lane', { timeout: 180_000 }, async () => {
  // A budget the run never reaches; a harness budget is declared, so the harness lane is one the work could start.
  const box = entry({ checks: GATED, budgetMs: 600_000, margin: 0.5, harness: true });
  const run = box.start();
  const began = await run.line(STARTED, START_MS);
  assert.ok(began, `the stub check never started${shown(run)}`);
  process.kill(run.pid, 'SIGKILL');
  const killed = await within(run.exited, 10_000);
  assert.notEqual(killed, TIMEOUT, 'preflight outlived its SIGKILL');
  // The checks may end now, and pass.
  writeFileSync(join(box.state, 'go'), '');
  // The output pipe closes once every process holding it, preflight's work among them, is gone.
  const closed = await within(run.closed, 30_000);
  const roles = box.recorded().map(({ role }) => role);
  assert.notEqual(closed, TIMEOUT, `a process of the run still held its output 30 s after the checks could end: ${left(box).join(', ')}${shown(run)}`);
  assert.ok(!roles.includes('perf'), `scripts/perf.mjs started with no preflight watching${shown(run)}`);
  // The perf lane starts through scripts/lease, which names the command it runs; here, with no grant outside a test
  // run, the orphan's lease is refused before perf.mjs starts, so its try shows only in that line.
  assert.doesNotMatch(run.out, /scripts\/perf\.mjs/, `the work went on to start the perf run with no preflight watching${shown(run)}`);
  assert.ok(!roles.includes('harness'), `the harness lane started with no preflight watching${shown(run)}`);
});

test('#3587.4323e662 a budget whose allowance is not whole milliseconds (margin 0.1) still runs and times the checks: no BLOCKED check workload, and checks that pass read as passed', { timeout: 180_000 }, async () => {
  // 3001 ms × 1.1 = 3301.1 ms.
  const box = entry({ checks: PASS, budgetMs: 3_001, margin: 0.1 });
  const run = box.start();
  const closed = await within(run.closed, START_MS + 30_000);
  assert.notEqual(closed, TIMEOUT, `preflight never ended${shown(run)}`);
  assert.doesNotMatch(run.out, /BLOCKED check workload/, `a BLOCKED check workload line for a fractional allowance${shown(run)}`);
  assert.match(run.out, /^stub check passed$/m, `the checks never ran${shown(run)}`);
  assert.match(run.out, /^Checks elapsed: \d+\.\d\d s/m, `the checks were not timed${shown(run)}`);
  assert.doesNotMatch(run.out, /^BLOCKED perf\b/m, `passing checks read as failed: perf was blocked${shown(run)}`);
  assert.match(run.out, /^stub perf ran$/m, `perf never ran after checks that passed${shown(run)}`);
  assert.equal(closed.code, 0, `preflight exited ${JSON.stringify(closed)} on checks that passed${shown(run)}`);
});
