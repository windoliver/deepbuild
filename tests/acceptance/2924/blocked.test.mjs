// #2924 AC5, the BLOCKED cases: a readings file that is missing or malformed, whenever it is read, and a set
// DEEP_THROTTLE_READINGS on the machine's table or outside a test run, are `BLOCKED throttle` naming the variable,
// exit 2, and the command doesn't start.
//
// The machine's table is never touched: those two cases run throttle.mjs under bwrap with a fresh tmpfs mounted over
// the user's ~/.deepbuild (the home from the password database), checked from inside before throttle.mjs starts, so
// whatever the program does, the live ~/.deepbuild/throttle/ is out of its reach. Outside a test run is a new PID
// namespace, whose process table has no `node --test` ancestor. Without bwrap those cases are skipped, never run on
// the live table.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { userInfo } from 'node:os';
import test from 'node:test';
import { GiB, dump, readings, request, running, sandbox, started, startOf, until, waits } from './helpers.mjs';

async function blocked(box, run, others = []) {
  const status = await run.done;
  assert.equal(startOf(box, run.label), undefined, `${run.label}'s command started\n${dump(box, run, ...others)}`);
  assert.match(run.output(), /^BLOCKED throttle/m, dump(box, run, ...others));
  assert.match(run.output(), /DEEP_THROTTLE_READINGS/, `the BLOCKED line doesn't name the variable\n${dump(box, run, ...others)}`);
  assert.equal(status, 2, dump(box, run, ...others));
}

const MALFORMED = {
  'missing': null,
  'not JSON': '{"memory": 1, "load"',
  'missing cores': { memory: 64 * GiB, load: 1 },
  'non-numeric memory': { memory: 'plenty', load: 1, cores: 8 },
  'cores 0': { memory: 64 * GiB, load: 1, cores: 0 },
};
for (const [name, value] of Object.entries(MALFORMED)) {
  test(`#2924.AC5 a readings file that is ${name}, read for a second test request, is BLOCKED throttle naming DEEP_THROTTLE_READINGS, exit 2`, { timeout: 60_000 }, async (t) => {
    const box = sandbox(t);
    const holder = request(box, 'holder', { env: { DEEP_THROTTLE_READINGS: readings(box, 'good', { memory: 1024 * GiB, load: 1, cores: 64 }) } });
    await started(box, holder, 15_000);
    const file = value === null ? join(box.dir, 'absent.json') : readings(box, 'bad', value);
    await blocked(box, request(box, 'second', { exit: true, env: { DEEP_THROTTLE_READINGS: file } }), [holder]);
  });
}

test('#2924.AC5 a readings file rewritten to not-JSON while a request waits is BLOCKED throttle at the next read, exit 2', { timeout: 60_000 }, async (t) => {
  const box = sandbox(t);
  const env = { DEEP_THROTTLE_READINGS: readings(box, 'readings', { memory: 1024 * GiB, load: 100, cores: 8 }) };
  const holder = request(box, 'holder', { env });
  await started(box, holder, 15_000);
  const second = request(box, 'second', { exit: true, env });
  await waits(box, second, 8_000, [holder], 'while the readings show load 100 on 8 cores');
  readings(box, 'readings', 'not json');
  assert.ok(await until(() => !running(second), 15_000), `the waiting request didn't end within 15 s of a malformed file\n${dump(box, holder, second)}`);
  await blocked(box, second, [holder]);
});

// The user's ~/.deepbuild, from the password database, hidden under a fresh tmpfs for the program.
const DEEPBUILD = join(userInfo().homedir, '.deepbuild');
const GUARD = 'mountpoint -q "$T2924_GUARD" && [ -z "$(ls -A "$T2924_GUARD")" ] || { echo "GUARD: $T2924_GUARD is not a fresh tmpfs"; exit 99; }; exec "$@"';
const bwrap = (pidns) => ['bwrap', '--dev-bind', '/', '/', '--tmpfs', DEEPBUILD, ...(pidns ? ['--unshare-pid', '--proc', '/proc'] : []), '--die-with-parent', '--', 'sh', '-c', GUARD, 'sh'];
const unguarded = (pidns) => {
  if (!existsSync(DEEPBUILD)) return `INCONCLUSIVE: ${DEEPBUILD} doesn't exist, so no tmpfs can hide it; never run without one`;
  const probe = spawnSync(bwrap(pidns)[0], [...bwrap(pidns).slice(1), 'true'], { env: { ...process.env, T2924_GUARD: DEEPBUILD }, encoding: 'utf8' });
  return probe.status === 0 ? false : `INCONCLUSIVE: bwrap can't hide ${DEEPBUILD} here (${(probe.error?.message ?? probe.stdout + probe.stderr).trim()}); never run on the live table`;
};

async function onMachineTable(t, pidns, env) {
  const box = sandbox(t);
  const file = readings(box, 'readings', { memory: 1024 * GiB, load: 1, cores: 64 });
  const run = request(box, 'machine', { exit: true, prefix: bwrap(pidns), env: { ...env, T2924_GUARD: DEEPBUILD, DEEP_THROTTLE_TABLE: undefined, DEEP_THROTTLE_READINGS: file } });
  await run.done;
  assert.doesNotMatch(run.output(), /^GUARD:/m, `the tmpfs guard failed, so throttle.mjs never ran\n${dump(box, run)}`);
  await blocked(box, run);
}

const inTest = unguarded(false);
test('#2924.AC5 inside a test run, on the machine\'s table (HOME is the user\'s own, no DEEP_THROTTLE_TABLE), a set DEEP_THROTTLE_READINGS is BLOCKED throttle, exit 2', { timeout: 60_000, skip: inTest }, (t) => onMachineTable(t, false, { HOME: userInfo().homedir }));

const outside = unguarded(true);
test('#2924.AC5 outside a test run (no node --test in the process table), a set DEEP_THROTTLE_READINGS is BLOCKED throttle, exit 2', { timeout: 60_000, skip: outside }, (t) => onMachineTable(t, true, {}));
