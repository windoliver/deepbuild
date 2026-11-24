// #3238 AC3: with every build slot held and a wait of 0 (DEEP_LEASE_WAIT=0, the owner's decision), the script prints
// `INCONCLUSIVE no grant`, exits non-zero, and its command never starts. The base runs the command at once; the twin
// `runs-after-wait`, which runs the command once the throttle's wait is over, fails here too.
import assert from 'node:assert/strict';
import test from 'node:test';
import { AC3, BUILD_SLOTS, copyScripts, dump, holdBuild, log, sandbox, start, startOf, within } from './helpers.mjs';

const JOB = 'cargo-build';

test(`${AC3} with every build slot held and DEEP_LEASE_WAIT=0, scripts/lease prints INCONCLUSIVE no grant, exits non-zero and never starts its command`, async (t) => {
  const box = sandbox(t);
  const lease = copyScripts(box);
  await holdBuild(box, BUILD_SLOTS);
  const run = start(box, [lease, 'node', box.stub, JOB, 'exit'], 'lease', { DEEP_LEASE_WAIT: '0' });
  const ended = await within(run.done, 300_000);
  const shown = () => dump(box, run);
  assert.ok(ended, `scripts/lease with DEEP_LEASE_WAIT=0 was still running after 5 min\n${shown()}`);
  assert.equal(startOf(box, JOB), undefined, `its command \`node stub.mjs ${JOB}\` started with no build grant\n${shown()}`);
  assert.ok(`${ended.stdout}\n${ended.stderr}`.split('\n').some((line) => line.startsWith('INCONCLUSIVE no grant')), `scripts/lease printed no INCONCLUSIVE no grant line\n${shown()}`);
  assert.ok(ended.status !== null && ended.status !== 0, `scripts/lease exited ${ended.status}${ended.signal ? ` (${ended.signal})` : ''}, not non-zero\n${shown()}`);
  assert.ok(log(box).some((entry) => entry.event === 'timeout' && entry.class === 'build'), `the log shows no build request that timed out\n${shown()}`);
});
