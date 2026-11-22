// #3067.4573b740, its second half: a `ps` failure writes a sample that says so, never a zero. `load` runs with a
// stub `ps` first on its PATH that hands every call to /bin/ps until a flag file appears and fails from then on
// (README: Gaps and assumptions). The sampler's next sample comes a minute after its first, so this takes about 70 s.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, userInfo } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { dump, hold, load, logText, running, sandbox, samples, startOf, until } from './helpers.mjs';

test('#3067.4573b740 a ps failure writes a sample that says so (at, load, cores and failed), with no grants, outside or top, never a zero, and the sampler runs on', { timeout: 240_000 }, async (t) => {
  const box = sandbox(t);
  const bin = join(box.dir, 'bin');
  const flag = join(box.dir, 'ps-fails');
  const calls = join(box.dir, 'ps-failed-calls');
  mkdirSync(bin);
  writeFileSync(join(bin, 'ps'), `#!/bin/sh\nif [ -e '${flag}' ]; then echo failed >> '${calls}'; echo 'ps: this stub fails' >&2; exit 1; fi\nexec /bin/ps "$@"\n`);
  chmodSync(join(bin, 'ps'), 0o755);
  // One idle stub grant, so the table exists and a right sample has a grant to list.
  const granted = hold(box, 'idle');
  await until(() => startOf(box, 'idle') || !running(granted), 30_000);
  assert.ok(startOf(box, 'idle'), `the stub grant never started\n${dump(box, granted)}`);
  const [, id] = startOf(box, 'idle').throttle.match(/^test:(\S+)$/);

  const run = load(box, [], { PATH: `${bin}:${process.env.PATH}` });
  await until(() => samples(box).length > 0 || !running(run), 30_000);
  const [first] = samples(box);
  assert.ok(first, `load wrote no sample to load.log in the table's folder\n${dump(box, run, granted)}`);
  // While the stub ps hands on to /bin/ps the reading works, so what follows is the failure's doing.
  assert.equal(first.failed, undefined, `the first sample failed though ps worked\n${dump(box, run, granted)}`);
  assert.deepEqual(first.grants?.map((grant) => grant.id), [id], `the first sample lists the table's grant\n${dump(box, run, granted)}`);
  assert.equal(typeof first.outside?.cpu, 'number', dump(box, run, granted));

  writeFileSync(flag, '');
  // The next sample comes a minute after the first.
  await until(() => samples(box).length > 1 || !running(run), 100_000, 250);
  const second = samples(box)[1];
  const context = `the stub ps failed ${existsSync(calls) ? readFileSync(calls, 'utf8').split('\n').length - 1 : 0} calls\n${dump(box, run, granted)}`;
  assert.ok(second, `no second sample within 100 s of the first\n${context}`);
  assert.ok(typeof second.failed === 'string' && second.failed.trim().length > 0, `the sample taken while ps failed doesn't say so in failed, a short reason\n${context}`);
  for (const key of ['grants', 'outside', 'top']) assert.ok(!(key in second), `a failed sample has no ${key}: it is never a zero\n${context}`);
  assert.ok(typeof second.at === 'string' && !Number.isNaN(Date.parse(second.at)), `at\n${context}`);
  assert.ok(typeof second.load === 'number' && second.load > 0, `load\n${context}`);
  assert.equal(second.cores, cpus().length, `cores\n${context}`);
  const gap = Date.parse(second.at) - Date.parse(first.at);
  assert.ok(gap >= 50_000 && gap <= 100_000, `the second sample comes a minute after the first, not ${gap / 1000} s\n${context}`);
  // #3067.4ec1293f holds for a failed sample too: its reason carries no path under a home folder.
  for (const home of [box.home, userInfo().homedir]) assert.ok(!logText(box).includes(home), `load.log holds a path under ${home}\n${context}`);
  assert.ok(running(run), `load ended after a ps failure; it runs until it is stopped by its PID\n${context}`);
});
