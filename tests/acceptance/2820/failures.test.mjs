// #2820 AC5: a binary build that fails ends the run BLOCKED, naming the binary; no build grant within the wait ends it
// INCONCLUSIVE no grant; either way the run takes no test grant and nothing passes. Written blind from issue #2820 at
// base f17fa347c (README).
import assert from 'node:assert/strict';
import test from 'node:test';
import { affected, BROKEN, BUILD_SLOTS, evidence, finalState, fixture, hold, prints, record, sandbox, selfBuilding, started, TEST, throttleLog, until, workspace } from './helpers.mjs';

const FILE = 'tests/fixture-2820/self-build.test.mjs';
// The neighbours hold their build slots longer than the run could wait.
const RUN_HOLD = 9 * 60_000;
const testGrants = (log) => log.filter((e) => e.event === 'granted' && e.class === 'test');

test('#2820.AC5a when a binary\'s build fails, the run ends BLOCKED naming the binary, takes no test grant, and nothing passes', TEST, async (t) => {
  const box = sandbox(t);
  const fx = fixture(box, {
    ...workspace(box, { 'fixture-broken': BROKEN }),
    [FILE]: selfBuilding(FILE, 'fixture-broken'),
  });
  const run = await affected(box, fx, [FILE]);
  const all = evidence(run, box, fx);
  const lines = run.stdout.split('\n');
  assert.ok(lines.some((line) => line.startsWith('BLOCKED') && line.includes('fixture-broken')), `no BLOCKED line names the binary fixture-broken\n${all}`);
  assert.equal(finalState(run.stdout), 'BLOCKED', `the run ended ${finalState(run.stdout)}, not BLOCKED\n${all}`);
  assert.notEqual(run.status, 0, `the run exited 0\n${all}`);
  assert.deepEqual(testGrants(throttleLog(box)), [], `the run took a test grant\n${all}`);
  assert.deepEqual(record(fx), [], `the planted test ran\n${all}`);
});

test('#2820.AC5b when no build grant comes within the wait, the run ends INCONCLUSIVE no grant, takes no test grant, and nothing passes', TEST, async (t) => {
  const box = sandbox(t);
  const fx = fixture(box, {
    ...workspace(box, { 'fixture-a': prints('fixture-a') }),
    [FILE]: selfBuilding(FILE, 'fixture-a'),
  });
  // Other sessions hold every build slot of the table for longer than the run waits.
  for (let k = 0; k < BUILD_SLOTS; k++) hold(box, 'build', `neighbour-${k}`, RUN_HOLD);
  assert.ok(await until(() => started(box) === BUILD_SLOTS, 60_000), `the neighbours did not take all ${BUILD_SLOTS} build grants`);
  // The run's build wait is its test-grant wait: 0.02 min here.
  const run = await affected(box, fx, [FILE], { DEEP_TEST_GRANT_WAIT: '0.02' });
  const all = evidence(run, box, fx);
  const log = throttleLog(box);
  assert.ok(run.stdout.split('\n').some((line) => line.startsWith('INCONCLUSIVE no grant')), `no "INCONCLUSIVE no grant" line\n${all}`);
  assert.equal(finalState(run.stdout), 'INCONCLUSIVE', `the run ended ${finalState(run.stdout)}, not INCONCLUSIVE\n${all}`);
  assert.notEqual(run.status, 0, `the run exited 0\n${all}`);
  const timeouts = log.filter((e) => e.event === 'timeout' && e.class === 'build');
  assert.ok(timeouts.length >= 1 && timeouts.every((e) => e.wait === 0.02), `the run's build request did not time out after its test-grant wait of 0.02 min\n${all}`);
  assert.deepEqual(testGrants(log), [], `the run took a test grant\n${all}`);
  assert.deepEqual(record(fx), [], `the planted test ran\n${all}`);
});
