// #3478: with neither DEEP_TEST_GRANT_WAIT nor DEEP_TEST_GRANT_STALL set, an affected.mjs run asks for its binaries'
// build grant and for its test grant with a stall of 720 minutes, not a 30-minute wait (docs/parallel-proof.md,
// section 6). Read from the log of the test's own throttle table. Written blind from issue #3478 at base 1b4929ae7.
import assert from 'node:assert/strict';
import test from 'node:test';
import { affected, ended, evidence, fixture, grants, prints, record, RUN_MIN, sandbox, selfBuilding, TEST, throttleLog, workspace } from './helpers.mjs';

const FILE = 'tests/fixture-3478/self-build.test.mjs';

test('#3478.caea9543 with neither variable set, a run that builds a binary is granted, and the log\'s granted entries for its top-level build and test requests each carry stall: 720 and no wait', TEST, async (t) => {
  const box = sandbox(t);
  const fx = fixture(box, {
    ...workspace(box, { 'fixture-a': prints('fixture-a') }),
    [FILE]: selfBuilding(FILE, 'fixture-a'),
  });
  const run = affected(box, fx, [FILE]);
  const result = await ended(run);
  const all = evidence(result, run, box, fx);
  assert.ok(result, `the run was still going ${RUN_MIN} min after it started, alone on its own table\n${all}`);
  assert.ok(record(fx).some((entry) => entry.event === 'built' && entry.status === 0), `the planted test never built its binary, so the run proves nothing\n${all}`);
  const log = throttleLog(box);
  for (const cls of ['build', 'test']) {
    const granted = grants(log, cls);
    assert.ok(granted.length >= 1, `the log holds no granted entry for a top-level ${cls} request of the run\n${all}`);
    for (const entry of granted) {
      assert.equal(entry.stall, 720, `the run's top-level ${cls} grant carries stall: 720; it reads ${JSON.stringify(entry)}\n${all}`);
      assert.ok(!('wait' in entry), `the run's top-level ${cls} grant carries no wait; it reads ${JSON.stringify(entry)}\n${all}`);
    }
  }
});
