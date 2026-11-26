// The sampler's thread reading where tests/acceptance/3550 can't reach on the Mac (#3550, docs/parallel-proof.md
// section 6, "Threads by grant"): on a machine other than macOS `ps -M` lists no threads, so a sample says the threads
// weren't read and asks ps for no such listing. The platform is the one thing stood in for: `load` runs as a process
// that reads process.platform as linux, on the suite's own sandbox and its recording ps.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { dump, load, psCalls, psStub, running, samples, sandbox, until } from './acceptance/3550/helpers.mjs';

test('on a machine other than macOS a sample says the threads weren\'t read (threadsUnread, with no procs, threads, runnable or runTop) and makes no thread listing', { timeout: 120_000 }, async (t) => {
  const box = sandbox(t);
  const linux = join(box.dir, 'linux.mjs');
  writeFileSync(linux, 'Object.defineProperty(process, \'platform\', { value: \'linux\' });\n');
  const run = load(box, [], { PATH: psStub(box, 'record'), NODE_OPTIONS: `--import=${linux}` });
  // deadline: the first sample takes a second and its listing; 60 s bound a sampler that writes none.
  await until(() => samples(box).length > 0 || !running(run), 60_000);
  if (running(run)) run.kill('SIGTERM');
  const [sample] = samples(box);
  const context = dump(box, run);
  assert.ok(sample, `load wrote no sample to load.log in the table's folder\n${context}`);
  assert.equal(sample.failed, undefined, `the sample failed\n${context}`);
  assert.ok(typeof sample.threadsUnread === 'string' && sample.threadsUnread.trim(), `the sample doesn't say the threads weren't read, in threadsUnread\n${context}`);
  for (const key of ['procs', 'threads', 'runnable']) assert.ok(!(key in sample.outside), `outside holds ${key}, of threads that weren't read\n${context}`);
  assert.ok(!('runTop' in sample), `the sample holds runTop, of threads that weren't read\n${context}`);
  assert.deepEqual(psCalls(box), [], `load asked ps for a thread listing, which lists no threads there\n${context}`);
});
