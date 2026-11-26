// #3550.02fff002: a thread listing that can't be made writes a sample that says so, never a zero, and the report
// counts it in no share. `load` runs with a ps first on its PATH (section 6: the listing is run by name from the PATH,
// as the process listing is) that hands every call to /bin/ps but the thread listing, which fails or names no thread
// (README: The surface). The live tests take a few seconds each and spin nothing; the third reads a fixture log.
import assert from 'node:assert/strict';
import { userInfo } from 'node:os';
import test from 'node:test';
import { PS_MARK, begun, dump, hold, load, logText, psCalls, psStub, redact, report, reported, running, sandbox, samples, threadLines, until } from './helpers.mjs';

const KEYS = ['procs', 'threads', 'runnable'];
/** The lines the report prints of runnable threads, past its count of the samples read. */
const shares = (found) => [...found.runnable, ...found.held, ...found.top, ...found.odd].map(({ line }) => line);

/** One sample of `load` beside an idle stub grant, with the sandbox's ps in `mode`, and the report over its log. */
async function unread(t, mode, how) {
  const box = sandbox(t);
  const path = psStub(box, mode);
  // One idle stub grant, so the sample has a grant whose threads it couldn't read.
  const granted = hold(box, 'idle', 0);
  const child = await begun(box, granted, 'test');
  const run = load(box, [], { PATH: path });
  // deadline: a sample takes a second and its listings; 60 s bound a sampler that writes none.
  await until(() => samples(box).length > 0 || !running(run), 60_000);
  const [sample] = samples(box);
  const context = `the sandbox's ps was asked for ${psCalls(box).length} thread listings (${how})\n${dump(box, run, granted)}`;
  assert.ok(sample, `load wrote no sample to load.log in the table's folder\n${context}`);
  // Only the thread listing was made to fail: the process listing worked, so the sample is a reading of the CPU.
  assert.equal(sample.failed, undefined, `the sample failed whole, though only its thread listing ${how}\n${context}`);
  assert.deepEqual(sample.grants?.map((grant) => grant.id), [child.id], `the sample lists the table's grant\n${context}`);
  assert.equal(typeof sample.outside?.cpu, 'number', `the sample holds outside's CPU\n${context}`);
  assert.ok(typeof sample.threadsUnread === 'string' && sample.threadsUnread.trim().length > 0, `the sample taken while the thread listing ${how} doesn't say the threads weren't read, in threadsUnread, a short reason\n${context}`);
  for (const [what, entry] of [...sample.grants.map((grant) => [`the grant ${grant.id}`, grant]), ['outside', sample.outside]]) {
    for (const key of KEYS) assert.ok(!(key in entry), `${what} has ${key} ${JSON.stringify(entry[key])} in a sample whose threads weren't read: it is never a zero\n${context}`);
  }
  assert.ok(!('runTop' in sample), `a sample whose threads weren't read has no runTop\n${context}`);
  // The reason is in the sampler's own words: not ps's error, which names a path under a home folder.
  assert.ok(!logText(box).includes(PS_MARK), `load.log holds the failing ps's own error text\n${context}`);
  for (const home of [box.home, userInfo().homedir]) assert.ok(!logText(box).includes(home), `load.log holds a path under ${redact(box, home)}\n${context}`);

  run.kill('SIGTERM');
  // deadline: load ends on a SIGTERM to its PID; 20 s bound one that doesn't.
  await until(() => !running(run), 20_000);
  const { out, lines } = await reported(box);
  const found = threadLines(lines);
  // Over every sample: the one there is wasn't read, so the report says so and prints no more of these lines.
  assert.deepEqual(found.read.map(({ line }) => line), ['threads read in 0 of 1 samples'], `load --report doesn't say the threads were read in 0 of 1 samples\n${out}\n${context}`);
  assert.deepEqual(shares(found), [], `load --report prints runnable threads from a sample whose threads weren't read\n${out}`);
}

test('#3550.02fff002 with the thread listing made to fail, the sample says the threads weren\'t read (threadsUnread, with no procs, threads, runnable or runTop, never a zero), and load --report counts it in no share', { timeout: 180_000 }, async (t) => {
  if (process.platform !== 'darwin') return t.skip('INCONCLUSIVE: the threads are read on macOS only, and this criterion runs on the Mac');
  await unread(t, 'fail', 'was made to fail');
});

test('#3550.02fff002 with a thread listing that names no thread, the sample says the threads weren\'t read (threadsUnread, with no procs, threads, runnable or runTop, never a zero), and load --report counts it in no share', { timeout: 180_000 }, async (t) => {
  if (process.platform !== 'darwin') return t.skip('INCONCLUSIVE: the threads are read on macOS only, and this criterion runs on the Mac');
  await unread(t, 'empty', 'named no thread');
});

test('#3550.02fff002 load --report over a fixture log counts a sample whose threads weren\'t read in no share: not in the means, not in a class\'s line, not in a minute held, not in the commands', { timeout: 120_000 }, async (t) => {
  // unread.jsonl: three samples above the cores. The first holds its threads (a build grant's 10 runnable, outside's
  // 30); the listing of the other two failed, one beside a build and a test grant, one with nothing held.
  const { out, lines } = await report(t, 'unread.jsonl');
  const found = threadLines(lines);
  assert.deepEqual(found.read.map(({ line }) => line), ['threads read in 1 of 3 samples'], `the report counts the samples whose threads were read, 1 of 3\n${out}`);
  // Counted as zeros, the two would make it build 3.33 and outside 10.00, with a line for test.
  assert.deepEqual(found.runnable.map(({ line }) => line).sort(), ['runnable build 10.00, 25.0%', 'runnable outside 30.00, 75.0%'], `the runnable threads by class and outside are the one read sample's\n${out}`);
  // Counted as minutes, they would add "held build and test" and "held nothing", and make it 1 of 3.
  assert.deepEqual(found.held.map(({ line }) => line), ['held build: 1 of 1 minutes, 100.0%, median load 40.00, cores busy 13.00, idle 5.00, under grants 4.00, runnable threads under grants 10.00, outside 30.00'], `the minutes held are the one read sample's\n${out}`);
  assert.equal(found.top.length, 1, `one line of the top commands under no grant\n${out}`);
  assert.deepEqual(found.top[0].commands.sort((a, b) => b.mean - a.mean), [{ command: 'rustc', mean: 12 }, { command: 'node', mean: 8 }], `the commands under no grant are means over the one read sample: rustc 12 and node 8\n${out}`);
  assert.deepEqual(found.odd, [], `a line of these that isn't in section 6's form\n${out}`);
});
