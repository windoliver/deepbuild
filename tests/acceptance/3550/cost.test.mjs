// #3550.397ab2ea: the sampler's own cost, with the thread listing, stays under 1% of one core over 10 minutes, as
// #3067's suite holds it. This test takes 10 minutes and a little: it is in a file of its own, to be scheduled apart.
// `load` runs as the child of a shell that waits for it and then prints `times`: the CPU, user and system, of the
// sampler and of every process it started and waited for (its ps and ioreg listings). It is stopped by its PID. It
// runs with the machine's own ps, and spins nothing.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { THROTTLE, begun, dump, hold, running, sandbox, samples, start, until } from './helpers.mjs';

const MINUTES = 10;
const whole = (value) => Number.isInteger(value) && value >= 0;
// A sample whose threads were read: no threadsUnread, the three counts for outside and each grant, and runTop.
const threadsRead = (sample) => !('failed' in sample) && !('threadsUnread' in sample) && Array.isArray(sample.runTop)
  && [sample.outside, ...(Array.isArray(sample.grants) ? sample.grants : [{}])].every((entry) => ['procs', 'threads', 'runnable'].every((key) => whole(entry?.[key])));

test('#3550.397ab2ea the sampler\'s own cost, with the thread listing it makes at each sample, is under 1% of one core over 10 minutes of sampling each minute', { timeout: (MINUTES + 3) * 60_000 }, async (t) => {
  if (process.platform !== 'darwin') return t.skip('INCONCLUSIVE: the threads are read on macOS only, and this criterion runs on the Mac');
  const box = sandbox(t);
  // One idle stub grant, so the table exists and each sample reads a grant's tree.
  const granted = hold(box, 'idle', 0);
  await begun(box, granted, 'test');

  const pidFile = join(box.dir, 'load.pid');
  const timesFile = join(box.dir, 'times');
  const began = Date.now();
  const shell = start(box, ['/bin/sh', '-c', '"$0" "$1" load & echo $! > "$2"; wait $!; times > "$3"', process.execPath, THROTTLE, pidFile, timesFile], { label: 'sh: load, then times' });
  // deadline: the first sample takes a second and its listings; 60 s bound a sampler that writes none.
  await until(() => samples(box).length > 0 || !running(shell), 60_000);
  assert.ok(samples(box).length > 0, `load wrote no sample to load.log in the table's folder\n${dump(box, shell, granted)}`);
  // With the thread listing: the cost is the sampler's with it, so the first sample already holds the threads.
  assert.ok(threadsRead(samples(box)[0]), `the first sample holds no thread reading (procs, threads and runnable for outside and each grant, and runTop), so its cost isn't the cost with the thread listing\n${dump(box, shell, granted)}`);
  const pid = Number(readFileSync(pidFile, 'utf8'));
  assert.ok(Number.isInteger(pid) && pid > 1, `the shell noted no pid for load: ${pid}`);

  // Ten minutes from its start, less what has passed, and 5 s more for the sample at the tenth minute.
  const left = MINUTES * 60_000 + 5_000 - (Date.now() - began);
  // deadline: the criterion's ten minutes of sampling; the wait ends early only if load ends by itself.
  await until(() => !running(shell), left, 1_000);
  assert.ok(running(shell), `load ended by itself within ${MINUTES} minutes; it runs until it is stopped by its PID\n${dump(box, shell, granted)}`);
  const seconds = (Date.now() - began) / 1000;
  process.kill(pid, 'SIGTERM');
  // deadline: load ends on a SIGTERM to its PID and the shell prints its times; 20 s bound one that doesn't.
  await until(() => existsSync(timesFile) && readFileSync(timesFile, 'utf8').trim().split('\n').length === 2, 20_000);
  assert.ok(existsSync(timesFile) && readFileSync(timesFile, 'utf8').trim().split('\n').length === 2, `load didn't end within 20 s of a SIGTERM to its PID\n${dump(box, shell, granted)}`);

  // It did its work for those minutes: a sample at its start and one each minute after, each with its threads read.
  const taken = samples(box);
  const span = `${seconds.toFixed(0)} s`;
  assert.deepEqual(taken.filter((sample) => !threadsRead(sample)), [], `every sample is a reading with its threads read\n${dump(box, shell, granted)}`);
  assert.ok(taken.length >= MINUTES && taken.length <= MINUTES + 1, `${taken.length} samples in ${span}; one at the start and one each minute after is ${MINUTES} or ${MINUTES + 1}\n${dump(box, shell, granted)}`);

  // times' second line: the user and system time of the shell's children, the sampler and what it waited for.
  const [, line] = readFileSync(timesFile, 'utf8').trim().split('\n');
  const spans = [...line.matchAll(/(\d+)m([\d.]+)s/g)].map(([, minutes, rest]) => 60 * Number(minutes) + Number(rest));
  assert.equal(spans.length, 2, `times printed ${JSON.stringify(line)}`);
  const cost = spans[0] + spans[1];
  const share = `${(100 * cost / seconds).toFixed(3)}% of one core`;
  t.diagnostic(`the sampler used ${cost.toFixed(2)} s of CPU in ${span}: ${share}, over ${taken.length} samples`);
  // deadline: the criterion's own measure, the sampler's CPU against the ten minutes it sampled for.
  assert.ok(cost < 0.01 * seconds, `the sampler used ${cost.toFixed(2)} s of CPU in ${span}, ${share}; the bound is 1%`);
});
