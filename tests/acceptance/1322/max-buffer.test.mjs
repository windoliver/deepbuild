// #1322.2df04a4b: after measureOnce stops a run whose output passed maxBuffer, the measured command and its
// children are gone.
import assert from 'node:assert/strict';
import test from 'node:test';
import { measureOnce } from '../../../scripts/benchmark.mjs';
import { fixture, outcome, stillAlive } from './processes.mjs';

// Far past the 40 MiB write, so maxBuffer (32 MiB) stops the run, not the timeout.
const TIMEOUT_MS = 25_000;

test('#1322.2df04a4b a run stopped for writing 40 MiB past the 32 MiB maxBuffer leaves neither the still-running measured command nor its child running', async (t) => {
  const run = await fixture();
  t.after(() => run.cleanup());
  const { value, error } = outcome(() => measureOnce(run.command('flood'), run.dir, false, TIMEOUT_MS, false));
  assert.equal(value, undefined, 'measureOnce returned instead of stopping the run at maxBuffer');
  assert.equal(error.code, 'ENOBUFS');
  const gone = await run.gone();
  assert.deepEqual([run.pid('parent') > 0, run.pid('child') > 0], [true, true], `a process never said its PID before the overflow: ${run.lines}`);
  assert.equal(gone, true, `processes the overflowed run started are still running: ${stillAlive(run)}`);
});
