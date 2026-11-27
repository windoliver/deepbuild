import assert from 'node:assert/strict';
import test from 'node:test';
import { POOL, admittedRun, askedJob, dump, endedWithin, endOf, entryOf, finish, holdsStill, plainTest, release, running, sandbox, startOf, tableLog, until } from './helpers.mjs';

test('#3694.b252ab9d with the pool\'s 17 tokens all dealt to a run\'s jobs and three more of its jobs waiting, a plain test request asked after them starts only once a token is free, and gets that token ahead of the run\'s waiting jobs', { timeout: 8 * 60_000 }, async (t) => {
  const box = sandbox(t);
  const dealt = Array.from({ length: POOL }, (_, k) => ({ name: `dealt-${k + 1}` }));
  const waiting = [1, 2, 3].map((k) => ({ name: `waiting-${k}`, go: 'late' }));
  const run = admittedRun(box, 'run', [...dealt, ...waiting]);
  let plain = null;
  const all = () => dump(box, run, plain);
  const started = (jobs) => jobs.filter((job) => startOf(box, job.name)).map((job) => job.name);

  await until(() => started(dealt).length === POOL || !running(run), 240_000);
  assert.equal(started(dealt).length, POOL, `only ${started(dealt).length} of the run's ${POOL} first jobs got a turn on a pool of ${POOL} tokens (18 cores)\n${all()}`);

  release(box, 'late');
  const inTable = (job) => {
    const asked = askedJob(box, job.name);
    return asked && tableLog(box).some((e) => e.event === 'passed' && e.pid === asked.child);
  };
  await until(() => waiting.every(inTable) || !running(run), 60_000);
  assert.ok(waiting.every(inTable), `the run's three late jobs never all asked through the run's grant (the log's passed entries)\n${all()}`);
  assert.ok(await holdsStill(() => started(waiting).length === 0, 2_000), `a late job of the run, ${started(waiting).join(', ')}, started while the pool's ${POOL} tokens were all dealt\n${all()}`);

  plain = plainTest(box, 'plain', '10');
  await until(() => entryOf(box, plain, 'granted') || !running(plain), 60_000);
  assert.ok(entryOf(box, plain, 'granted'), `the plain test request ${plain.named} was not granted within 60 s beside the run's test grant at load 57 on 18 cores with 50 GB available, so it never waited for a token\n${all()}`);
  assert.ok(await holdsStill(() => !startOf(box, 'plain') && started(waiting).length === 0, 3_000), `while the pool's ${POOL} tokens were all dealt to the run's jobs, ${startOf(box, 'plain') ? `the plain request's command started (${plain.named})` : `the run's late job ${started(waiting).join(', ')} started`}\n${all()}`);

  finish(box, 'dealt-1');
  await until(() => startOf(box, 'plain') || started(waiting).length || !running(plain), 60_000);
  const plainStart = startOf(box, 'plain');
  const ahead = waiting.map((job) => startOf(box, job.name)).filter((begun) => begun && (!plainStart || begun.at <= plainStart.at));
  assert.equal(ahead.length, 0, `the token dealt-1 gave back went to the run's waiting job ${ahead.map((begun) => begun.name).join(', ')}, which started ${plainStart ? 'before the plain request\'s command did' : 'while the plain request\'s command had not started'}: the pool served arrival order, not the run with the least time on turns\n${all()}`);
  assert.ok(plainStart, `the plain test request ${plain.named} did not start within 60 s of a token going back\n${all()}`);
  const freed = endOf(box, 'dealt-1');
  assert.ok(freed && plainStart.at >= freed.at, `the plain request's command started at ${plainStart.at}, before dealt-1 gave its token back at ${freed?.at}\n${all()}`);
  assert.equal(await endedWithin(plain, 60_000), 0, `the plain test request ${plain.named} did not end with 0 once it had its turn\n${all()}`);
});
