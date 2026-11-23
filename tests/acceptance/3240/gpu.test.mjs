// #3240.6f5727c7: GPU time by grant. `load` takes its first sample; then a stub grant's child and an ungranted
// process of the same program, so of the same name, each draw on the GPU for 10 s and idle on; the sample a minute
// later gives each its GPU time within a fifth of the test's own ioreg reading, to the grant's ID and to `outside`
// (README: The surface). It takes about 80 s.
import assert from 'node:assert/strict';
import test from 'node:test';
import { begun, draw, dump, gpuBetween, gpuStub, gpuTimes, hold, leads, listing, load, loose, noted, running, samples, sampled, sandbox, under, until } from './helpers.mjs';

const FIFTH = 0.2;
// Below this a stub drew too little to tell its own time from anything else's.
const ENOUGH = 0.1;
const within = (value, reference, what, context) => assert.ok(typeof value === 'number' && Math.abs(value - reference) <= FIFTH * reference,
  `${what} is ${value} s; the test's own ioreg read ${reference.toFixed(3)} s, so it must be within a fifth of that (${(reference * (1 - FIFTH)).toFixed(3)} to ${(reference * (1 + FIFTH)).toFixed(3)})\n${context}`);

test('#3240.6f5727c7 one stub grant whose child draws on the GPU for 10 s and one ungranted process of the same name that does the same: the sample gives each its GPU time within a fifth, to the grant\'s ID and to outside', { timeout: 420_000 }, async (t) => {
  if (process.platform !== 'darwin') return t.skip('INCONCLUSIVE: the GPU is read on macOS only, and this criterion runs on the Mac');
  const box = sandbox(t);
  gpuStub(box);
  const run = load(box);
  const first = await sampled(box, run, 1, 60_000);
  assert.ok(first, `load wrote no sample to load.log in the table's folder\n${dump(box, run)}`);
  // The test's own reading once the first sample's read is made: the stubs' clients are new since both.
  const before = gpuTimes();
  const granted = hold(box, 'granted', draw(box, 'granted', 10));
  const free = loose(box, 'free', draw(box, 'free', 10));
  const child = await begun(box, granted, 'test');
  const other = await begun(box, free);
  await until(() => (noted(box, 'granted', 'drawn') && noted(box, 'free', 'drawn')) || !running(run), 120_000, 250);
  const procs = listing();
  assert.ok(noted(box, 'granted', 'drawn') && noted(box, 'free', 'drawn'), `the stubs didn't finish drawing\n${dump(box, run, granted, free)}`);
  assert.equal(samples(box).length, 1, `the stubs finished drawing only after the second sample\n${dump(box, run, granted, free)}`);
  assert.ok(under(procs, child.pid, granted.pid), 'the drawing child is under the grant\'s holder');
  assert.equal(procs.get(child.pid)?.command, 'gpudraw', 'the grant\'s child is a process named gpudraw');
  assert.equal(procs.get(other.pid)?.command, procs.get(child.pid)?.command, 'the grant\'s child is named as the ungranted process is');

  const second = await sampled(box, run, 2, 100_000);
  const after = gpuTimes();
  const context = dump(box, run, granted, free);
  assert.ok(second, `no second sample within 100 s of the first\n${context}`);
  const between = gpuBetween(before, after);
  const mine = between.get(child.pid)?.s ?? 0;
  const theirs = between.get(other.pid)?.s ?? 0;
  const machine = [...between.values()].reduce((sum, { s }) => sum + s, 0);
  t.diagnostic(`the test's own ioreg, from its reading after the first sample to its reading after the second: the grant's child ${mine.toFixed(3)} s, the ungranted process ${theirs.toFixed(3)} s, every client ${machine.toFixed(3)} s; Metal's own timestamps gave the stubs ${noted(box, 'granted', 'drawn').metal?.toFixed(3)} s and ${noted(box, 'free', 'drawn').metal?.toFixed(3)} s; the sample: grant ${second.grants?.find((grant) => grant.id === child.id)?.gpu}, outside ${second.outside?.gpu}`);
  if (mine < ENOUGH || theirs < ENOUGH) return t.skip(`INCONCLUSIVE: the GPU gave the stubs ${mine.toFixed(3)} s and ${theirs.toFixed(3)} s in 10 s of drawing, under the ${ENOUGH} s a reading needs; run again`);

  assert.equal(second.failed, undefined, `the sample failed\n${context}`);
  assert.equal(second.gpuUnread, undefined, `the sample says the GPU wasn't read: ${second.gpuUnread}\n${context}`);
  // To its grant ID: the grant's entry, with its class and holder, has its child's GPU time.
  const entry = (second.grants ?? []).find((grant) => grant.id === child.id);
  assert.ok(entry, `grants holds no entry for the stub grant ${child.id}\n${context}`);
  assert.equal(entry.class, 'test', context);
  assert.equal(entry.pid, granted.pid, `the grant's pid is its holder's\n${context}`);
  within(entry.gpu, mine, 'the grant\'s gpu', context);
  // To outside: every process under no grant, the ungranted stub among them.
  assert.ok(typeof second.outside?.gpu === 'number' && second.outside.gpu >= (1 - FIFTH) * theirs,
    `outside's gpu (${second.outside?.gpu}) doesn't hold the ungranted process's ${theirs.toFixed(3)} s, less a fifth\n${context}`);

  // gpuTop: five at most, none at 0; the grant's child names its grant, the ungranted process none.
  assert.ok(Array.isArray(second.gpuTop) && second.gpuTop.length <= 5, `gpuTop lists five processes at most\n${context}`);
  for (const proc of second.gpuTop) assert.ok(Number.isInteger(proc.pid) && typeof proc.command === 'string' && typeof proc.gpu === 'number' && proc.gpu > 0, `a gpuTop entry: ${JSON.stringify(proc)}\n${context}`);
  for (const [pid, name, grant, reference] of [[child.pid, 'the grant\'s child', child.id, mine], [other.pid, 'the ungranted process', undefined, theirs]]) {
    const listed = second.gpuTop.find((proc) => proc.pid === pid);
    if (leads(between, pid)) assert.ok(listed, `${name} (pid ${pid}) used more GPU time than all but four processes, by a fifth, and isn't in gpuTop\n${context}`);
    if (!listed) continue;
    assert.equal(listed.grant, grant, `gpuTop's entry for ${name} names ${grant ? `its grant ${grant}` : 'no grant'}\n${context}`);
    assert.equal(listed.command, 'gpudraw', context);
    within(listed.gpu, reference, `gpuTop's gpu for ${name}`, context);
  }
});
