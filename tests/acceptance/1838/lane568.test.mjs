// #1838 criterion 1: #568's lane test, `node --test tests/acceptance/568/lane.test.mjs`, run as a process from this
// checkout (README: Surfaces). That suite plants the machine's fingerprint, so which Mac runs it doesn't matter; what the
// plant can't stand in for is the load each timed run reads at its start and end, which #568 counts against the cores.
import assert from 'node:assert/strict';
import { availableParallelism, loadavg } from 'node:os';
import test from 'node:test';
import { CHECKOUT, LONG, run, sandbox, show } from './helpers.mjs';

const SUITE = 'tests/acceptance/568/lane.test.mjs';
// The perf lane's timed runs, as #568 judges them, need macOS (/usr/bin/time -l and its instruction counter) and a load
// at or below the core count; anywhere else this criterion makes no claim.
const unfit = () => {
  if (process.platform !== 'darwin') return `this is ${process.platform}, not a Mac`;
  const [load] = loadavg(), cores = availableParallelism();
  return load > cores ? `the one-minute load ${load.toFixed(1)} is above the ${cores} cores` : null;
};
// #568's verdict on a run whose load was above the cores, or couldn't be read, as judgeLimit gives its reason.
const LOADED = /load [\d.]+ at a run's start or end is above the \d+ cores|the load at each run's start and end can't be read/;

test('#1838.25e8bbd8 tests/acceptance/568/lane.test.mjs passes on a fit reference Mac: its planted fingerprint reaches judgeTask, so every one of its tests passes', LONG, (t) => {
  const before = unfit();
  if (before) return t.skip(`INCONCLUSIVE: not a fit reference Mac (${before}); this is not a pass`);
  const box = sandbox(t);
  const result = run([process.execPath, '--test', '--test-reporter=tap', SUITE], { cwd: CHECKOUT, env: box.env });
  // A load that rose above the cores during the run leaves a planted reference Mac's budgets INCONCLUSIVE: the machine
  // was not fit, so the run says nothing either way.
  if (result.status !== 0 && LOADED.test(result.stdout)) return t.skip(`INCONCLUSIVE: the load rose above the cores during the run (now ${loadavg()[0].toFixed(1)}), so it ran on no fit machine; this is not a pass`);
  const count = (name) => Number(result.stdout.match(RegExp(`^# ${name} (\\d+)$`, 'm'))?.[1] ?? NaN);
  assert.equal(result.status, 0, `${SUITE} fails\n${show(result)}`);
  assert.ok(count('pass') >= 1 && count('pass') === count('tests'), `not every test of ${SUITE} passed\n${show(result)}`);
  for (const name of ['fail', 'cancelled', 'skipped', 'todo']) assert.equal(count(name), 0, `${SUITE}: ${name} ${count(name)}\n${show(result)}`);
});
