// #2820 AC3: a binary a selected test reads through DEEP_BIN_DIR is still built from the run's own checkout before any
// test starts, and now before the test grant is granted. Written blind from issue #2820 at base f17fa347c (README).
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { affected, binDirReading, buildBeforeTest, evidence, fixture, prints, record, sandbox, TEST, throttleLog, workspace } from './helpers.mjs';

const FILE = 'tests/fixture-2820/bin-dir.test.mjs';

test('#2820.AC3 a binary a selected test reads through DEEP_BIN_DIR is built from the run\'s own checkout before any test starts, and before the run\'s test grant is granted', TEST, async (t) => {
  const box = sandbox(t);
  // The binary prints a token only this fixture's source holds, so what ran was built from the run's own checkout.
  const token = `fixture-b ${randomBytes(6).toString('hex')}`;
  const fx = fixture(box, {
    ...workspace(box, { 'fixture-a': prints('fixture-a'), 'fixture-b': prints(token) }),
    [FILE]: binDirReading(FILE, 'fixture-b'),
  });
  const run = await affected(box, fx, [FILE]);
  const all = evidence(run, box, fx);
  const start = record(fx).find((e) => e.event === 'start');
  assert.ok(start, `the planted test never ran, so the run proves nothing\n${all}`);
  assert.ok(start.dir, `the planted test ran with no DEEP_BIN_DIR\n${all}`);
  assert.ok(start.exists, `fixture-b was not in DEEP_BIN_DIR (${start.dir}) when the test started\n${all}`);
  const ran = record(fx).find((e) => e.event === 'ran');
  assert.equal(ran?.stdout, token, `the binary in DEEP_BIN_DIR was not built from the run's own checkout\n${all}`);
  const grant = buildBeforeTest(throttleLog(box), all);
  assert.ok(Date.parse(grant.at) <= start.at, `the test started before the run's test grant\n${all}`);
});
