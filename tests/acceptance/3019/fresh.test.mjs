// AC2: a run whose merge base, toolchain or lockfile differs from every cached build builds fresh, and its verdicts
// are the same as with no cache at all. Each test fills the cache with a first run, makes one of the three differ, runs
// again with the cache, then runs the same state with no cache (DEEP_BUILD_CACHE_BYTES=0) and compares the verdicts.
// The base, which has no cache, passes these; each fails on a planted wrong program whose key misses one of the three.
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertNoCache, builds, lock, machineRepo, mainMoves, mergeBase, otherNode, pkg, proof, rightVerdicts, sandbox, show, timesBuilt, TIMEOUT } from './helpers.mjs';

const NO_CACHE = { DEEP_BUILD_CACHE_BYTES: '0' };

async function differs(t, what, move, { node } = {}) {
  const box = sandbox(t);
  const fixture = machineRepo(box);
  const first = await proof(box, fixture);
  assert.deepEqual(first.verdicts, rightVerdicts(), `the first run's verdicts are not the fixture's right ones\n${show(first)}`);
  move(fixture);
  const { base } = builds(fixture.worktree);
  const cached = await proof(box, fixture, { node });
  assert.equal(timesBuilt(cached, base), 1, `the run whose ${what} differs built its merge-base tree ${mergeBase(fixture.worktree).tree} ${timesBuilt(cached, base)} times, not once (fresh)\n${show(first)}\n${show(cached)}`);
  const none = await proof(box, fixture, { node, env: NO_CACHE });
  assertNoCache(none, base);
  assert.deepEqual(none.verdicts, rightVerdicts(), `the run with no cache gave other verdicts than the fixture's right ones\n${show(none)}`);
  assert.deepEqual(cached.verdicts, none.verdicts, `the run with the cache gave other verdicts than the same run with no cache\n${show(cached)}\n${show(none)}`);
}

test('#3019.abf36a2d a run whose merge base differs from every cached build builds fresh, with the verdicts of no cache', TIMEOUT, async (t) => {
  // Main moves by a commit that edits the package's sources and leaves the lock alone.
  await differs(t, 'merge base', (fixture) => mainMoves(fixture, { 'packages/w/src/note.txt': 'main moved on\n' }, 'Edit the note'));
});

test('#3019.abf36a2d a run whose toolchain differs from every cached build builds fresh, with the verdicts of no cache', TIMEOUT, async (t) => {
  const node = otherNode();
  if (!node) return t.skip(`needs a second node install beside ${process.execPath} (another version under its versions/node folder)`);
  // Same merge base, same lock: only the node that runs the proof and that PATH finds for npm and the build differs.
  await differs(t, 'toolchain', () => {}, { node });
});

test('#3019.abf36a2d a run whose lockfile differs from every cached build builds fresh, with the verdicts of no cache', TIMEOUT, async (t) => {
  // Main moves by a commit that edits only package.json and package-lock.json; the package's sources stay.
  await differs(t, 'lockfile', (fixture) => mainMoves(fixture, { 'package.json': pkg('0.0.1'), 'package-lock.json': lock('0.0.1') }, 'Edit the lock'));
});
