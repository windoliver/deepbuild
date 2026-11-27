// Blind redraft (#3549) of #3240's line test: the build class is full at the limit throttle.mjs states for this
// platform (./helpers.mjs buildLimit), not at a hard-coded 1. The grant whose child spins 2 cores is one of its
// holders; the others' children idle. Name, criterion, waits, assertions and expected values are the original's.
// #3240.f0d5ecc3: the line. On a test's own table a `build` stub grant whose child spins 2 cores is held, every other
// build slot is held too, and one more `build` request waits behind them; the sample records that one request
// waiting, of class `build`, never a held grant, and idle and busy cores that add up to the machine's (README: The
// surface). It takes about 20 s.
import assert from 'node:assert/strict';
import { cpus, loadavg } from 'node:os';
import test from 'node:test';
import { CLASSES, begun, dump, hold, load, noted, pause, running, sampled, sandbox, span, spin, tree, warm } from '../3240/helpers.mjs';
import { buildLimit } from './helpers.mjs';

const BUILD_LIMIT = buildLimit();
// Below this the spinner's cores can't be told from none at half a core.
const ENOUGH = 1;
const WITHIN = 0.5;

test('#3240.f0d5ecc3 one build grant held whose child spins 2 cores and one build request waiting: the sample records 1 request waiting, of class build, and idle and busy cores that sum to the machine\'s', { timeout: 240_000 }, async (t) => {
  const box = sandbox(t);
  const holder = hold(box, 'holder', spin(box, 'holder', 2), { cls: 'build' });
  await begun(box, holder, 'build');
  // The rest of the class: a build grant for each other slot, its child idle, so the next request waits.
  const others = Array.from({ length: BUILD_LIMIT - 1 }, (_, k) => hold(box, `holder-${k + 2}`, spin(box, `holder-${k + 2}`, 0), { cls: 'build' }));
  for (const other of others) await begun(box, other, 'build');
  const waiter = hold(box, 'waiter', spin(box, 'waiter', 0), { cls: 'build', wait: 10 });
  // As #2924's suite reads a wait: a node process can take seconds to start on a loaded machine, and a request granted
  // at once starts its command well inside 8 s.
  await pause(8_000);
  assert.equal(noted(box, 'waiter'), undefined, `the build request was granted beside the held ones\n${dump(box, holder, ...others, waiter)}`);
  assert.ok(running(waiter), `the build request ended instead of waiting\n${dump(box, holder, ...others, waiter)}`);

  const readings = await warm([holder.pid], 2, 60_000);
  const run = load(box);
  const sample = await sampled(box, run, 1, 60_000, readings);
  if (running(run)) run.kill('SIGTERM');
  const context = dump(box, run, holder, ...others, waiter);
  assert.equal(noted(box, 'waiter'), undefined, `the build request was granted before the sample was read\n${context}`);
  assert.ok(sample, `load wrote no sample to load.log in the table's folder\n${context}`);
  assert.equal(sample.failed, undefined, `the sample failed\n${context}`);

  // In line: the one request, by class, never a grant held.
  assert.deepEqual(sample.waiting, Object.fromEntries(CLASSES.map((cls) => [cls, cls === 'build' ? 1 : 0])), `waiting holds 1 request of class build and none of the others\n${context}`);

  // The cores not busy and busy, adding up to the machine's.
  assert.equal(sample.cores, cpus().length, `cores\n${context}`);
  for (const key of ['idle', 'busy']) assert.ok(typeof sample[key] === 'number' && sample[key] >= 0 && sample[key] <= sample.cores, `${key} is ${sample[key]}, not a number of cores from 0 to ${sample.cores}\n${context}`);
  assert.ok(Math.abs(sample.idle + sample.busy - sample.cores) <= 0.01, `idle ${sample.idle} and busy ${sample.busy} sum to ${sample.idle + sample.busy}, not the machine's ${sample.cores} cores\n${context}`);
  const spun = span(readings, (procs) => tree(procs, holder.pid));
  t.diagnostic(`the test's ps read the spinning grant's tree at ${spun.lo.toFixed(2)} to ${spun.hi.toFixed(2)} cores; the sample: idle ${sample.idle}, busy ${sample.busy} of ${sample.cores}, at a 1-minute load of ${sample.load}`);
  if (spun.lo < ENOUGH) return t.skip(`INCONCLUSIVE: the machine (1-minute load ${loadavg()[0].toFixed(1)} on ${cpus().length} cores) gave the spinner ${spun.lo.toFixed(2)} cores, under the ${ENOUGH} core its busy cores need to show`);
  // The spinner's 2 cores are busy: a busy that leaves them out is no reading of the cores.
  assert.ok(sample.busy >= spun.lo - WITHIN, `busy is ${sample.busy}, below the ${spun.lo.toFixed(2)} cores the spinning grant's child alone used\n${context}`);
});
