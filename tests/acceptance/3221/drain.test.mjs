// #3221 AC5: a timed request waits for every job in flight, and no new job starts while it waits. A planted pool that
// keeps dealing tokens during the wait fails, naming the job (twins.json: deals-in-drain). The timed request is a
// plain one, not a budget window, asked under a build grant of the test's own: a top-level timed request also waits
// for the machine's load below its cores (section 6), which a test can't set, and a nested one drains all the same.
import assert from 'node:assert/strict';
import test from 'node:test';
import { GiB, THROTTLE, dump, ended, finish, grantOf, passedThrough, pause, readings, run, sandbox, start, starts, ends, until } from './helpers.mjs';

const POOL = 2;
const JOBS = 4;

test('#3221.c7e55b61 a timed request waits for both jobs in flight on a pool of 2, and neither of the run\'s 2 waiting jobs starts while it waits', { timeout: 10 * 60_000 }, async (t) => {
  const box = sandbox(t);
  readings(box, { memory: 1024 * GiB, load: 0, cores: POOL + 1 });
  // Four jobs that each hold until their stop file: two take the pool's tokens, two wait for turns.
  const busy = run(box, 'busy', { jobs: Array(JOBS).fill({ mode: ['hold'] }) });
  let timed = null;
  const all = () => dump(box, busy, timed);
  assert.ok(await until(() => starts(box, 'busy').length >= POOL && grantOf(box, 'busy') && passedThrough(box, grantOf(box, 'busy')).length === JOBS, 180_000), `the run's ${POOL} first jobs never started, or its ${JOBS} jobs never all asked through its grant\n${all()}`);
  // deadline: a job that a pool lets through starts within 5 s of asking on this machine; the last two must not.
  await pause(5_000);
  const inFlight = starts(box, 'busy');
  assert.equal(inFlight.length, POOL, `${inFlight.length} of the run's ${JOBS} jobs started at once on a pool of ${POOL} tokens, so none waits for a turn\n${all()}`);

  const asked = Date.now();
  timed = start(box, [process.execPath, THROTTLE, 'build', '--', process.execPath, THROTTLE, 'timed', '--wait', '10', '--', process.execPath, box.env.T3221_JOB, 'timed', '0', 'exit'], { label: 'timed request (under a build grant)' });
  // deadline: the timed request is in the table well within 15 s of its start on this machine, before a token frees.
  await pause(15_000);
  // The jobs in flight end one after the other; each frees a token while the timed request waits. After the first, the
  // other still holds the timed request back, so a pool that deals during the wait has time to deal the freed token.
  for (const [n, job] of inFlight.entries()) {
    finish(box, `busy-${job.job}`);
    assert.ok(await until(() => ends(box, 'busy').some((e) => e.job === job.job), 60_000), `job busy#${job.job} didn't end on its stop file\n${all()}`);
    // deadline: a job dealt the freed token starts within 5 s on this machine, before the last job in flight ends.
    if (n < inFlight.length - 1) await pause(5_000);
  }
  const timedStarted = () => starts(box, 'timed')[0];
  const late = () => starts(box, 'busy').filter((e) => e.at > asked && !(timedStarted()?.at < e.at));
  // deadline: 3 minutes bound the wait for the timed command, or for a job that starts before it.
  await until(() => timedStarted() || late().length, 180_000);
  const startedLate = late();
  // Let everything end, so the run's last jobs and the timed request have no reason to stay.
  for (let k = 0; k < JOBS; k++) finish(box, `busy-${k}`);
  await ended(timed, 300_000, all);
  await ended(busy, 300_000, all);

  const timeline = [...starts(box), ...ends(box)].sort((a, b) => a.at - b.at)
    .map((e) => `${e.run === 'timed' ? 'the timed command' : `job ${e.run}#${e.job}`} ${e.event === 'start' ? 'started' : 'ended'} at +${((e.at - asked) / 1000).toFixed(1)} s`).join('\n');
  const named = startedLate.map((e) => `job busy#${e.job} (pid ${e.pid}) at +${((e.at - asked) / 1000).toFixed(1)} s`);
  assert.deepEqual(named, [], `a job started while the timed request waited: ${named.join(', ')}\ntimeline from the timed request:\n${timeline}\n${all()}`);
  const granted = timedStarted();
  assert.ok(granted, `the timed request never ran its command\ntimeline from the timed request:\n${timeline}\n${all()}`);
  for (const job of inFlight) {
    const end = ends(box, 'busy').find((e) => e.job === job.job);
    assert.ok(end && end.at <= granted.at, `the timed command started before job busy#${job.job}, in flight when it asked, had ended\ntimeline from the timed request:\n${timeline}\n${all()}`);
  }
  assert.equal(starts(box, 'busy').length, JOBS, `the run's last jobs never ran once the timed request was done\n${all()}`);
});
