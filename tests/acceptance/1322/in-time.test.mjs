// #1322.160d30bf: a run that finishes in time is measured as before.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { measureOnce } from '../../../scripts/benchmark.mjs';
import { alive, fixture, leftAfter, outcome } from './processes.mjs';

const TIMEOUT_MS = 60_000;

// Spends at least 300 ms of CPU, writes one line to each stream and exits with the code it is given.
const WORK = `
const start = process.cpuUsage();
while ((({ user, system }) => user + system)(process.cpuUsage(start)) < 300_000);
process.stdout.write('measured\\n');
process.stderr.write('warn\\n');
process.exitCode = Number(process.argv[2]);
`;

function workCommand(run, code) {
  const script = join(run.dir, 'work.cjs');
  writeFileSync(script, WORK);
  return [process.execPath, script, String(code)];
}

test('#1322.160d30bf a captured run that exits 0 in time returns status 0, its stdout and output, elapsed and CPU time, a peak RSS and its loads', (t) => {
  const run = fixture();
  t.after(() => run.cleanup());
  const { value: result, error } = outcome(() => measureOnce(workCommand(run, 0), run.dir, false, TIMEOUT_MS, false));
  assert.equal(error, undefined, `measureOnce threw on a run that finished in time: ${error}`);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'measured\n');
  assert.equal(result.output, 'measured\nwarn\n');
  assert.ok(result.elapsedMs >= 300 && result.elapsedMs < TIMEOUT_MS, `elapsedMs ${result.elapsedMs}`);
  assert.ok(Number.isFinite(result.cpuMs) && result.cpuMs >= 300, `cpuMs ${result.cpuMs}`);
  // A node process's peak resident set is well over 10 MiB.
  assert.ok(Number.isSafeInteger(result.peakBytes) && result.peakBytes > 10 * 1024 * 1024, `peakBytes ${result.peakBytes}`);
  assert.ok(Number.isFinite(result.loadStart) && Number.isFinite(result.loadEnd), `loads ${result.loadStart} ${result.loadEnd}`);
  assert.deepEqual(result.uncounted, []);
  assert.equal(result.qos, null);
});

test('#1322.160d30bf a captured run that exits 3 in time returns status 3 with its output instead of throwing', (t) => {
  const run = fixture();
  t.after(() => run.cleanup());
  const { value: result, error } = outcome(() => measureOnce(workCommand(run, 3), run.dir, false, TIMEOUT_MS, false));
  assert.equal(error, undefined, `measureOnce threw on a run that finished in time: ${error}`);
  assert.equal(result.status, 3);
  assert.equal(result.output, 'measured\nwarn\n');
  assert.ok(result.cpuMs >= 300, `cpuMs ${result.cpuMs}`);
});

test('#1322.160d30bf a streamed run that exits 0 returns status 0 with empty captured output and its measurements', (t) => {
  const run = fixture();
  t.after(() => run.cleanup());
  const { value: result, error } = outcome(() => measureOnce(workCommand(run, 0), run.dir, true, TIMEOUT_MS, false));
  assert.equal(error, undefined, `measureOnce threw on a streamed run: ${error}`);
  assert.equal(result.status, 0);
  assert.equal(result.output, '');
  assert.equal(result.stdout, '');
  assert.ok(result.cpuMs >= 300, `cpuMs ${result.cpuMs}`);
  assert.ok(result.peakBytes > 10 * 1024 * 1024, `peakBytes ${result.peakBytes}`);
});

test('#1322.160d30bf a run that finishes in time is not stopped: a background child it left behind is still running after measureOnce returns', async (t) => {
  const run = fixture();
  t.after(() => run.cleanup());
  const { value: result, error } = outcome(() => measureOnce(run.command('background'), run.dir, false, TIMEOUT_MS, false));
  assert.equal(error, undefined, `measureOnce threw on a run that finished in time: ${error}`);
  assert.equal(result.status, 0);
  const [, child] = run.pids();
  assert.ok(child.pid, 'the background child never recorded its PID');
  // Give a stray kill time to land before looking.
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(alive(child.pid), true, `the background child ${child.pid} was killed although the run finished in time`);
  assert.deepEqual(await leftAfter([run.pids()[0]]), [], 'the measured command itself did not exit');
});
