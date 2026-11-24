// #3240.2d406576: a GPU read that fails writes a sample that says so, never a zero, and the report counts it in no
// share. `load` runs with a stub `ioreg` first on its PATH (section 6: run by name from the PATH, as `ps` is) that
// fails every call, printing a marked error under the sandbox's HOME (README: The surface). It takes a few seconds.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { begun, dump, hold, load, logText, running, sampled, sandbox, spin, until } from './helpers.mjs';

const MARK = 'ioreg-stub-3240-error';

test('#3240.2d406576 with the GPU read made to fail, the sample says the GPU wasn\'t read (gpuUnread, no gpu and no gpuTop, never a zero), and load --report counts it in no share', { timeout: 120_000 }, async (t) => {
  if (process.platform !== 'darwin') return t.skip('INCONCLUSIVE: the GPU is read on macOS only, and this criterion runs on the Mac');
  const box = sandbox(t);
  const bin = join(box.dir, 'bin');
  const calls = join(box.dir, 'ioreg-calls');
  mkdirSync(bin);
  writeFileSync(join(bin, 'ioreg'), `#!/bin/sh\necho "$*" >> '${calls}'\necho '${MARK}: ${box.home}/accelerator could not be listed' >&2\nexit 1\n`);
  chmodSync(join(bin, 'ioreg'), 0o755);
  // One idle stub grant, so the sample has a grant whose GPU time it couldn't read.
  const granted = hold(box, 'idle', spin(box, 'idle', 0));
  const child = await begun(box, granted, 'test');

  const run = load(box, [], { PATH: `${bin}:${process.env.PATH}` });
  const sample = await sampled(box, run, 1, 60_000);
  const context = `the stub ioreg was called ${existsSync(calls) ? readFileSync(calls, 'utf8').split('\n').length - 1 : 0} times\n${dump(box, run, granted)}`;
  assert.ok(sample, `load wrote no sample to load.log in the table's folder\n${context}`);
  // Only the GPU read was made to fail: ps worked, so the sample is a reading of the CPU.
  assert.equal(sample.failed, undefined, `the sample failed whole, though only its GPU read was made to fail\n${context}`);
  assert.deepEqual(sample.grants?.map((grant) => grant.id), [child.id], `the sample lists the table's grant\n${context}`);
  assert.ok(typeof sample.gpuUnread === 'string' && sample.gpuUnread.trim().length > 0, `the sample taken while ioreg failed doesn't say the GPU wasn't read, in gpuUnread, a short reason\n${context}`);
  for (const [what, entry] of [...sample.grants.map((grant) => [`the grant ${grant.id}`, grant]), ['outside', sample.outside]]) {
    assert.ok(entry && !('gpu' in entry), `${what} has a gpu in a sample whose GPU wasn't read: it is never a zero\n${context}`);
  }
  assert.ok(!('gpuTop' in sample), `a sample whose GPU wasn't read has no gpuTop\n${context}`);
  // The reason is in the sampler's own words: not ioreg's error, which names a path under a home folder.
  assert.ok(!logText(box).includes(MARK), `load.log holds the stub ioreg's own error text\n${context}`);
  for (const home of [box.home, userInfo().homedir]) assert.ok(!logText(box).includes(home), `load.log holds a path under ${home}\n${context}`);

  run.kill('SIGTERM');
  await until(() => !running(run), 20_000);
  const report = load(box, ['--report']);
  await until(() => !running(report), 30_000);
  await report.done;
  const out = report.output();
  // Over every sample: the one there is wasn't read, so no second counts, and no share is printed.
  assert.match(out, /^GPU read in 0 of 1 samples, 0\.000 s in all$/m, `load --report counts the sample whose GPU wasn't read as read\n${out}\n${context}`);
  const shares = out.split('\n').filter((line) => /^GPU (?!read in )\S+ \d+\.\d{3} s, \d+\.\d%$/.test(line.trimEnd()) || line.startsWith('GPU top commands'));
  assert.deepEqual(shares, [], `load --report prints a GPU share from a sample whose GPU wasn't read\n${out}`);
});
