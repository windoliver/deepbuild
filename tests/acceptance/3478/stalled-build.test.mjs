// #3478: a run whose build line stands still past its stall bound leaves it INCONCLUSIVE, with the build line's own
// first line, and never waits 30 minutes (docs/parallel-proof.md, section 6). On a table of the test's own. Written
// blind from issue #3478 at base 1b4929ae7.
import assert from 'node:assert/strict';
import test from 'node:test';
import { affected, ended, evidence, fixture, grants, holdEvery, plain, prints, record, sandbox, selfBuilding, summary, TEST, throttleLog, workspace } from './helpers.mjs';

const BUILDS = 'tests/fixture-3478/self-build.test.mjs', PLAIN = 'tests/fixture-3478/plain.test.mjs';
const FIRST = 'INCONCLUSIVE no grant: no build grant changed hands within 0.05 min for the run\'s binaries; no test grant was asked for';

test('#3478.981101c5 with DEEP_TEST_GRANT_STALL at 0.05 and every build slot held past the bound, a run that needs a binary prints the build line\'s INCONCLUSIVE no grant, an INCONCLUSIVE line for each file and a summary ending no job started, exits 2 within 5 minutes, and its tests never ran', TEST, async (t) => {
  const box = sandbox(t);
  const fx = fixture(box, {
    ...workspace(box, { 'fixture-a': prints('fixture-a') }),
    [BUILDS]: selfBuilding(BUILDS, 'fixture-a'),
    [PLAIN]: plain(PLAIN),
  });
  // Other sessions hold every build slot of the table for nine minutes, and nothing else changes.
  const line = await holdEvery(box, 'build');
  assert.ok(line.holders.every(Boolean), `every holder took its build grant\n${line.holders.map((holder) => holder?.out()).join('\n')}`);

  const run = affected(box, fx, [BUILDS, PLAIN], { DEEP_TEST_GRANT_STALL: '0.05' });
  const result = await ended(run, 5);
  const all = evidence(result, run, box, fx);
  assert.ok(result, `the run ends within 5 minutes of its start when no build grant changes hands for 0.05 min; it was still waiting\n${all}`);
  const lines = result.stdout.split('\n');
  assert.ok(lines.some((text) => text.startsWith(FIRST)), `the run prints "${FIRST}"\n${all}`);
  for (const file of [BUILDS, PLAIN]) assert.ok(lines.some((text) => text.startsWith('INCONCLUSIVE ') && text.includes(file)), `an INCONCLUSIVE line names ${file}\n${all}`);
  assert.match(summary(result.stdout), /^INCONCLUSIVE affected: .*no job started$/, `the summary reads INCONCLUSIVE and ends "no job started"\n${all}`);
  assert.equal(result.status, 2, `the run exits 2\n${all}`);
  assert.deepEqual(record(fx), [], `the run's tests never ran\n${all}`);
  assert.deepEqual(grants(throttleLog(box), 'test'), [], `no test grant was asked for\n${all}`);
});
