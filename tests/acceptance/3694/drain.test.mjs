import assert from 'node:assert/strict';
import test from 'node:test';
import { TEST_CEILING, admittedRun, dump, endedWithin, endOf, finish, holdsStill, plainTest, refusedNoGrant, running, sampledInLine, sandbox, startOf, timedRequest, until } from './helpers.mjs';

test('#3694.2f5b9fe1 with a timed request waiting beside a run\'s test grant, a plain test request is not granted and its command never starts, and once the timed request has left the line a plain test request is granted', { timeout: 5 * 60_000 }, async (t) => {
  const box = sandbox(t);
  const run = admittedRun(box, 'run');
  let timed = null, drained = null, after = null;
  const all = () => dump(box, run, timed, drained, after);
  await until(() => startOf(box, 'run') || !running(run), 120_000);
  assert.ok(startOf(box, 'run') && running(run), `the run ${run.named} was never admitted on an empty table\n${all()}`);

  timed = timedRequest(box, 'timed', '0.5');
  const lined = await sampledInLine(box, (waiting) => waiting.timed >= 1, { stopped: () => Boolean(startOf(box, 'timed')) || !running(timed) });
  assert.ok(lined.at, `the timed request ${timed.named} never stood in line beside the run's grant\n${all()}`);

  drained = plainTest(box, 'drained', '0.1');
  await endedWithin(drained, 120_000);
  assert.ok(running(timed) && !startOf(box, 'timed'), `the timed request ${timed.named} was no longer waiting when the plain request's wait ended\n${all()}`);
  assert.ok(refusedNoGrant(drained) && !startOf(box, 'drained'), `the plain test request ${drained.named} was granted while a timed request waited: the drain did not hold (exit ${drained.status})\n${all()}`);

  await endedWithin(timed, 120_000);
  assert.ok(refusedNoGrant(timed) && !startOf(box, 'timed'), `the timed request ${timed.named} did not leave the line with INCONCLUSIVE no grant once its 0.5 min ran out (exit ${timed.status})\n${all()}`);
  after = plainTest(box, 'after', '0.5');
  const status = await endedWithin(after, 120_000);
  assert.ok(startOf(box, 'after') && status === 0, `once the timed request had left the line, the plain test request ${after.named} was still not granted beside the run's grant at load 57 on 18 cores (exit ${status}): so the refusal above was no drain's\n${all()}`);
});

test('#3694.2f5b9fe1 with the test ceiling\'s grants held by admitted runs, a plain test request waits in line with its command unstarted, and is granted once one of them ends', { timeout: 5 * 60_000 }, async (t) => {
  const box = sandbox(t);
  const runs = [];
  let plain = null;
  const all = () => dump(box, runs, plain);
  for (let k = 1; k <= TEST_CEILING; k++) {
    const run = admittedRun(box, `run-${k}`);
    runs.push(run);
    await until(() => startOf(box, `run-${k}`) || !running(run), 120_000);
    assert.ok(startOf(box, `run-${k}`) && running(run), `run ${k} of the test ceiling's ${TEST_CEILING}, ${run.named}, was not admitted\n${all()}`);
  }

  plain = plainTest(box, 'plain', '10');
  const lined = await sampledInLine(box, (waiting) => waiting.test >= 1, { stopped: () => Boolean(startOf(box, 'plain')) || !running(plain) });
  assert.ok(lined.at && !startOf(box, 'plain'), `the plain test request ${plain.named} ${startOf(box, 'plain') ? `was granted past the test ceiling of ${TEST_CEILING}` : 'never stood in line'}\n${all()}`);
  assert.ok(await holdsStill(() => !startOf(box, 'plain') && running(plain), 3_000), `the plain test request ${plain.named} ${startOf(box, 'plain') ? `started while the test ceiling's ${TEST_CEILING} grants were held` : `left the line (exit ${plain.status})`}\n${all()}`);

  const last = `run-${TEST_CEILING}`;
  finish(box, last);
  await until(() => startOf(box, 'plain') || !running(plain), 60_000);
  assert.ok(startOf(box, 'plain'), `once ${last} ended, leaving room under the test ceiling, the plain test request ${plain.named} was not granted within 60 s at load 57 on 18 cores with 50 GB available\n${all()}`);
  const freed = endOf(box, last);
  assert.ok(freed && startOf(box, 'plain').at >= freed.at, `the plain request's command started at ${startOf(box, 'plain').at}, before ${last} ended at ${freed?.at}\n${all()}`);
  assert.equal(await endedWithin(plain, 60_000), 0, `the plain test request ${plain.named} did not end with 0\n${all()}`);
});
