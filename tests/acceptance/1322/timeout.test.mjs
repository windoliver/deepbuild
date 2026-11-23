// #1322.0e535c64: after measureOnce stops a run at its timeout, the measured command and its children are gone.
import assert from 'node:assert/strict';
import test from 'node:test';
import { measureOnce } from '../../../scripts/benchmark.mjs';
import { fixture, leftAfter, outcome } from './processes.mjs';

// Long enough for the command and its child to start and record their PIDs, short against their 30 s sleep.
const TIMEOUT_MS = 5_000;

for (const follow of [false, true]) {
  test(`#1322.0e535c64 a run stopped at its ${TIMEOUT_MS} ms timeout (follow = ${follow}) leaves neither the measured command nor its child running`, async (t) => {
    const run = fixture();
    t.after(() => run.cleanup());
    const { value, error } = outcome(() => measureOnce(run.command('sleep'), run.dir, false, TIMEOUT_MS, follow));
    assert.equal(value, undefined, 'measureOnce returned instead of stopping the run at its timeout');
    assert.equal(error.code, 'ETIMEDOUT');
    const pids = run.pids();
    assert.deepEqual(pids.filter(({ pid }) => !pid).map(({ name }) => name), [], 'a process never recorded its PID before the timeout');
    assert.deepEqual(await leftAfter(pids), [], 'processes the timed-out run started are still running');
  });
}
