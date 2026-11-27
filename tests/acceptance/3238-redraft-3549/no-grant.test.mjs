// Blind redraft (#3549) of #3238 AC3: holders take every build slot of the limit throttle.mjs states for this platform
// (./helpers.mjs buildLimit), not of a hard-coded 1 or 2. Name, criterion, waits, assertions and expected values are
// the original's.
// #3238 AC3: with every build slot held and a wait of 0 (DEEP_LEASE_WAIT=0, the owner's decision), the script prints
// `INCONCLUSIVE no grant`, exits non-zero, and its command never starts. The base runs the command at once; the twin
// `runs-after-wait`, which runs the command once the throttle's wait is over, fails here too.
import assert from 'node:assert/strict';
import test from 'node:test';
import { AC3, copyScripts, dump, holdBuild, log, sandbox, start, startOf, within } from '../3238/helpers.mjs';
import { buildLimit } from './helpers.mjs';

const BUILD_LIMIT = buildLimit();
const JOB = 'cargo-build';

test(`${AC3} with every build slot held and DEEP_LEASE_WAIT=0, scripts/lease prints INCONCLUSIVE no grant, exits non-zero and never starts its command`, async (t) => {
  const box = sandbox(t);
  const lease = copyScripts(box);
  await holdBuild(box, BUILD_LIMIT);
  const run = start(box, [lease, 'node', box.stub, JOB, 'exit'], 'lease', { DEEP_LEASE_WAIT: '0' });
  const ended = await within(run.done, 300_000);
  const shown = () => dump(box, run);
  assert.ok(ended, `scripts/lease with DEEP_LEASE_WAIT=0 was still running after 5 min\n${shown()}`);
  assert.equal(startOf(box, JOB), undefined, `its command \`node stub.mjs ${JOB}\` started with no build grant\n${shown()}`);
  assert.ok(`${ended.stdout}\n${ended.stderr}`.split('\n').some((line) => line.startsWith('INCONCLUSIVE no grant')), `scripts/lease printed no INCONCLUSIVE no grant line\n${shown()}`);
  assert.ok(ended.status !== null && ended.status !== 0, `scripts/lease exited ${ended.status}${ended.signal ? ` (${ended.signal})` : ''}, not non-zero\n${shown()}`);
  assert.ok(log(box).some((entry) => entry.event === 'timeout' && entry.class === 'build'), `the log shows no build request that timed out\n${shown()}`);
});
