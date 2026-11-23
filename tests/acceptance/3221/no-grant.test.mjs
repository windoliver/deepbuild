// #3221 AC3: an admitted run prints no `INCONCLUSIVE no grant` line, however long a job waits its turn. A run that
// isn't admitted within its wait reads as it does today, and has started no job.
import assert from 'node:assert/strict';
import test from 'node:test';
import { GiB, THROTTLE, dump, ended, events, finish, grantOf, passedThrough, pause, readings, run, running, sandbox, start, starts, until, ends } from './helpers.mjs';

// A job's own --wait, in minutes: 3 s, which its turn must outlast.
const JOB_WAIT = '0.05';

test('#3221.9bee972a an admitted run whose job waits its turn longer than its --wait prints no INCONCLUSIVE no grant line, and the job runs once a token frees', { timeout: 10 * 60_000 }, async (t) => {
  const box = sandbox(t);
  // A pool of one token (a core less one of two).
  readings(box, { memory: 1024 * GiB, load: 0, cores: 2 });
  const holder = run(box, 'holder-run', { jobs: [{ mode: ['hold'] }] });
  let waiter = null;
  const all = () => dump(box, holder, waiter);
  // The holding run's job has the one token; then the waiting run is admitted and its job asks.
  assert.ok(await until(() => starts(box, 'holder-run').length === 1, 120_000), `the first run's job never started\n${all()}`);
  waiter = run(box, 'waiter', { jobs: [{ mode: ['exit'], wait: JOB_WAIT }] });
  assert.ok(await until(() => grantOf(box, 'waiter') && passedThrough(box, grantOf(box, 'waiter')).length === 1, 120_000), `the second run was never admitted, or its job never asked through its grant\n${all()}`);
  // deadline: the job's 3 s --wait must run out while it waits its turn; 8 s leaves it well past that.
  await pause(8_000);
  assert.equal(starts(box, 'waiter').length, 0, `the second run's job started while the pool's one token was held by the first run's job: it didn't wait its turn, so the test can't show what a long wait prints\n${all()}`);
  finish(box, 'holder-run-0');
  assert.equal(await ended(waiter, 180_000, all), 0, `the run whose job waited its turn didn't end with 0\n${all()}`);
  assert.equal(await ended(holder, 60_000, all), 0, `the run that held the token didn't end with 0\n${all()}`);
  const [job] = starts(box, 'waiter');
  const freed = ends(box, 'holder-run')[0];
  assert.ok(job && freed && job.at >= freed.at, `the waiting job didn't run after the token freed (its start ${job?.at}, the holder's end ${freed?.at})\n${all()}`);
  for (const child of [waiter, holder]) assert.doesNotMatch(child.output(), /INCONCLUSIVE no grant/, `${child.label} printed an INCONCLUSIVE no grant line, though it was admitted\n${all()}`);
});

test('#3221.9bee972a a run that isn\'t admitted within its wait prints INCONCLUSIVE no grant as today, exits 3 and has started no job', { timeout: 5 * 60_000 }, async (t) => {
  const box = sandbox(t);
  // No memory for a second run: past the first test grant, the memory rule keeps an admission out (section 6).
  readings(box, { memory: 0, load: 0, cores: 5 });
  const holder = start(box, [process.execPath, THROTTLE, 'test', '--', process.execPath, box.env.T3221_JOB, 'holder', '0', 'hold'], { label: 'test grant holder' });
  let late = null;
  const all = () => dump(box, holder, late);
  assert.ok(await until(() => starts(box, 'holder').length === 1, 120_000), `the test grant's holder never started\n${all()}`);
  late = run(box, 'late', { jobs: [{ mode: ['exit'] }], wait: '0.1' });
  const status = await ended(late, 180_000, all);
  assert.match(late.output().trim().split('\n')[0] ?? '', /^INCONCLUSIVE no grant: no test grant came within 0\.1 min/, `the run that wasn't admitted doesn't read as today\n${all()}`);
  assert.equal(status, 3, `the run that wasn't admitted exited ${status}, not 3\n${all()}`);
  assert.deepEqual(events(box).filter((e) => e.run === 'late'), [], `the run that wasn't admitted started its command or a job\n${all()}`);
  assert.ok(running(holder), `the holder ended, so the run may have been refused for another reason\n${all()}`);
});
