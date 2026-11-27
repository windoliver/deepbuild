import assert from 'node:assert/strict';
import test from 'node:test';
import { admittedRun, dump, endedWithin, endOf, entryOf, plainTest, refusedNoGrant, running, sandbox, startOf, until } from './helpers.mjs';

test('#3694.28023738 at load 57 on 18 cores with 50 GB available and one run\'s test grant held, a plain test request is granted as a top-level test grant and its command runs', { timeout: 4 * 60_000 }, async (t) => {
  const box = sandbox(t);
  const run = admittedRun(box, 'run');
  let plain = null;
  const all = () => dump(box, run, plain);
  await until(() => startOf(box, 'run') || !running(run), 120_000);
  assert.ok(startOf(box, 'run') && running(run), `the run ${run.named} was never admitted on an empty table\n${all()}`);
  const runGrant = entryOf(box, run, 'granted');
  assert.ok(runGrant?.class === 'test' && runGrant.run === true, `the log shows no test grant of a run's admission for ${run.named}: ${JSON.stringify(runGrant)}\n${all()}`);

  plain = plainTest(box, 'plain', '0.5');
  const status = await endedWithin(plain, 120_000);
  assert.ok(startOf(box, 'plain'), `the plain test request ${plain.named} was not granted beside the run's test grant at load 57 on 18 cores with 50 GB available: ${refusedNoGrant(plain) ? 'its wait of 0.5 min ran out with INCONCLUSIVE no grant' : `it ended with ${status} and its command never started`}\n${all()}`);
  assert.equal(status, 0, `the plain test request ${plain.named} exited ${status}\n${all()}`);
  const granted = entryOf(box, plain, 'granted');
  assert.ok(granted?.class === 'test' && granted.grant === 'top-level', `the log shows no top-level granted entry of class test for the plain request ${plain.named}: ${JSON.stringify(granted)}\n${all()}`);
  assert.ok(running(run) && !endOf(box, 'run'), `the run's test grant was not held all the while the plain request ran\n${all()}`);
});
