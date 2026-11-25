// #3240.a54f81e0: the sampler's own cost, with its GPU read, stays under 1% of one core over 10 minutes, as #3067's
// suite holds it. This test takes 10 minutes and a little: it is in a file of its own, to be scheduled apart.
// `load` runs as the child of a shell that waits for it and then prints `times`: the CPU, user and system, of the
// sampler and of every process it started and waited for (its ps and ioreg listings). It is stopped by its PID.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { THROTTLE, begun, dump, hold, pause, running, sandbox, samples, spin, start, until } from './helpers.mjs';

const MINUTES = 10;
// A sample whose GPU was read: no gpuUnread, and a gpu for outside and each grant.
const gpuRead = (sample) => !('failed' in sample) && !('gpuUnread' in sample) && typeof sample.outside?.gpu === 'number' && Array.isArray(sample.grants) && sample.grants.every((grant) => typeof grant.gpu === 'number');

test('#3240.a54f81e0 the sampler\'s own cost, with the ps listings and the GPU read it makes, is under 1% of one core over 10 minutes of sampling each minute', { timeout: (MINUTES + 3) * 60_000 }, async (t) => {
  if (process.platform !== 'darwin') return t.skip('INCONCLUSIVE: the GPU is read on macOS only, and this criterion runs on the Mac');
  const box = sandbox(t);
  // One idle stub grant, so the table exists and each sample reads a grant's tree.
  const granted = hold(box, 'idle', spin(box, 'idle', 0));
  await begun(box, granted, 'test');

  const pidFile = join(box.dir, 'load.pid');
  const timesFile = join(box.dir, 'times');
  const began = Date.now();
  const shell = start(box, ['/bin/sh', '-c', '"$0" "$1" load & echo $! > "$2"; wait $!; times > "$3"', process.execPath, THROTTLE, pidFile, timesFile], { label: 'sh: load, then times' });
  await until(() => samples(box).length > 0 || !running(shell), 60_000);
  assert.ok(samples(box).length > 0, `load wrote no sample to load.log in the table's folder\n${dump(box, shell, granted)}`);
  // With the GPU read: the cost is the sampler's with it, so the first sample already holds one.
  assert.ok(gpuRead(samples(box)[0]), `the first sample holds no GPU read, so its cost isn't the cost with the GPU read\n${dump(box, shell, granted)}`);
  const pid = Number(readFileSync(pidFile, 'utf8'));
  assert.ok(Number.isInteger(pid) && pid > 1, `the shell noted no pid for load: ${pid}`);

  // Ten minutes from its start, less what has passed, and 5 s more for the sample at the tenth minute.
  await until(() => !running(shell), MINUTES * 60_000 + 5_000 - (Date.now() - began), 1_000);
  assert.ok(running(shell), `load ended by itself within ${MINUTES} minutes; it runs until it is stopped by its PID\n${dump(box, shell, granted)}`);
  const seconds = (Date.now() - began) / 1000;
  process.kill(pid, 'SIGTERM');
  await until(() => existsSync(timesFile) && readFileSync(timesFile, 'utf8').trim().split('\n').length === 2, 20_000);
  await pause(100);
  assert.ok(existsSync(timesFile), `load didn't end within 20 s of a SIGTERM to its PID\n${dump(box, shell, granted)}`);

  // It did its work for those minutes: a sample at its start and one each minute after, each with its GPU read.
  const taken = samples(box);
  assert.deepEqual(taken.filter((sample) => !gpuRead(sample)), [], `every sample is a reading with its GPU read\n${dump(box, shell, granted)}`);
  assert.ok(taken.length >= MINUTES && taken.length <= MINUTES + 1, `${taken.length} samples in ${seconds.toFixed(0)} s; one at the start and one each minute after is ${MINUTES} or ${MINUTES + 1}\n${dump(box, shell, granted)}`);

  // times' second line: the user and system time of the shell's children, the sampler and what it waited for.
  const [, line] = readFileSync(timesFile, 'utf8').trim().split('\n');
  const spans = [...line.matchAll(/(\d+)m([\d.]+)s/g)].map(([, minutes, rest]) => 60 * Number(minutes) + Number(rest));
  assert.equal(spans.length, 2, `times printed ${JSON.stringify(line)}`);
  const cost = spans[0] + spans[1];
  t.diagnostic(`the sampler used ${cost.toFixed(2)} s of CPU in ${seconds.toFixed(0)} s: ${(100 * cost / seconds).toFixed(3)}% of one core, over ${taken.length} samples`);
  assert.ok(cost / seconds < 0.01, `the sampler used ${cost.toFixed(2)} s of CPU in ${seconds.toFixed(0)} s, ${(100 * cost / seconds).toFixed(2)}% of one core; the bound is 1%`);
});
