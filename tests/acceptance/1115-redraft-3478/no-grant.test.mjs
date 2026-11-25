// Blind redraft, under #3478, of tests/acceptance/1115-redraft-2833/no-grant.test.mjs (REDRAFT.md). The two tests of
// an affected.mjs run are redrafted; the unit lane's test is carried as it is.
// #1115: a vitest job the throttle ends with no grant ran nothing, so its files read INCONCLUSIVE, never FAIL "reported
// no test". Another session's holders fill the real table's test class. Under #3478 an affected.mjs run asks for its
// grant with a stall, not `--wait`, so 1115's throttle shim has no wait of the run's to shorten: the run's wait is
// short by #3478's own means, DEEP_TEST_GRANT_STALL at 0.02 minutes (1.2 s with no test grant changing hands), and
// the run's no-grant line shows that bound was the one that ended it. The unit lane's vitest job still asks with
// `--wait 30`, which the shim shortens to 1.2 s as before (tests/acceptance/1115/README.md: No grant).
import assert from 'node:assert/strict';
import test from 'node:test';
import { affected, dump, failIds, hold, laneState, LONG, sandbox, started, stop, summary, tree, unit, until, vitestFile } from '../1115/helpers.mjs';
import { testLimit } from '../1115-redraft-2833/helpers.mjs';

// #2833: the test class's limit is the one scripts/throttle.mjs states for this platform.
const LIMIT = testLimit();
const FILES = ['tests/fixture-1115/one.test.ts', 'tests/fixture-1115/two.test.ts'];
const files = Object.fromEntries(FILES.map((file) => [file, vitestFile("test('it passes', () => { expect(1).toBe(1); });")]));
// #3478: the bound, in minutes, of the run's stall, set for tests.
const STALL = '0.02';
const NO_GRANT = `INCONCLUSIVE no grant: no test grant changed hands within ${STALL} min`;

async function fill(box) {
  const holders = Array.from({ length: LIMIT }, (_, index) => hold(box, 'test', `neighbour-${index}`, 280_000));
  assert.ok(await until(() => started(box) === LIMIT, 60_000), `the neighbours did not take all ${LIMIT} test grants`);
  return holders;
}

function expectFilesInconclusive(run) {
  const all = dump(run);
  const lines = run.stdout.split('\n');
  assert.deepEqual(failIds(run.stdout), [], `the job with no grant reads as failures\n${all}`);
  assert.doesNotMatch(run.stdout, /reported no test/, `the job's files read as "reported no test"\n${all}`);
  assert.match(summary(run.stdout), /^INCONCLUSIVE affected: /, `the summary of a run with no grant reads otherwise\n${all}`);
  assert.equal(run.status, 2, all);
  for (const file of FILES) assert.ok(lines.some((line) => line.startsWith('INCONCLUSIVE') && line.includes(file)), `no INCONCLUSIVE line names ${file}\n${all}`);
  // #3478: the wait that ended with no grant was the run's stall, at the bound this test set.
  assert.ok(`${run.stdout}\n${run.stderr}`.split('\n').some((line) => line.startsWith(NO_GRANT)), `no "${NO_GRANT}" line: the run's wait was not its stall of ${STALL} min\n${all}`);
}

test('#1115.1f2f1fa0 a vitest job ended with no grant reads INCONCLUSIVE, not FAIL: its files read so in affected.mjs, and a later run with a grant passes', LONG, async (t) => {
  const box = sandbox(t);
  const fixture = tree(box, files, { shimThrottle: true });
  const holders = await fill(box);
  const refused = await affected(box, fixture, FILES, { DEEP_TEST_GRANT_STALL: STALL });
  expectFilesInconclusive(refused);
  holders.forEach(stop);
  await Promise.all(holders.map(({ done }) => done));
  // Nothing the refused run left may read as a refusal of this one.
  const run = await affected(box, fixture, FILES, { DEEP_TEST_GRANT_STALL: STALL });
  const all = dump(run);
  assert.match(summary(run.stdout), /^PASS affected: /, `with the grants free again, the run still reads otherwise\n${all}`);
});

// A job's output is shared with whatever printed before the throttle wrote, such as a node warning, so the state can't
// rest on the output's first line. #1115's base reads this job as FAIL "reported no test", the issue's complaint.
test('#1115.1f2f1fa0 a vitest job ended with no grant reads INCONCLUSIVE when a line of output came before the throttle\'s', LONG, async (t) => {
  const box = sandbox(t);
  const fixture = tree(box, files, { shimThrottle: true });
  await fill(box);
  expectFilesInconclusive(await affected(box, fixture, FILES, { T1115_PREAMBLE: '1', DEEP_TEST_GRANT_STALL: STALL }));
});

// Carried as it is. Passes on #1115's base, which finds the throttle's line in the output. Its wrong program reads the
// lane by its reports alone, so an empty report reads FAIL.
test('#1115.1f2f1fa0 a unit lane whose vitest job ended with no grant reads INCONCLUSIVE, not FAIL', LONG, async (t) => {
  const box = sandbox(t);
  const fixture = tree(box, files, { shimThrottle: true });
  await fill(box);
  const run = await unit(box, fixture, { T1115_PREAMBLE: '1' });
  const all = dump(run);
  assert.match(run.stdout, /INCONCLUSIVE no grant/, `the test class was not full, so this run shows nothing\n${all}`);
  assert.equal(laneState(run.stdout), 'INCONCLUSIVE', `a lane with no grant read ${laneState(run.stdout)}\n${all}`);
  assert.notEqual(run.status, 0, all);
});
