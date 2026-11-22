// AC4: verdicts with the cache match verdicts without it for the same change, on a change with one twin. A first run
// fills an empty cache, a second reuses it, and a third runs the same change with no cache (DEEP_BUILD_CACHE_BYTES=0).
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertNoCache, builds, machineRepo, mergeBase, proof, rightVerdicts, sandbox, show, timesBuilt, TIMEOUT } from './helpers.mjs';

test('#3019.a73b4639 verdicts with the cache match verdicts without it for the same change, which has a twin', TIMEOUT, async (t) => {
  const box = sandbox(t);
  const fixture = machineRepo(box);
  const { tree } = mergeBase(fixture.worktree);
  const { base } = builds(fixture.worktree);
  const filling = await proof(box, fixture);
  const reusing = await proof(box, fixture);
  const none = await proof(box, fixture, { env: { DEEP_BUILD_CACHE_BYTES: '0' } });
  assertNoCache(none, base);
  assert.deepEqual(none.verdicts, rightVerdicts(), `the run with no cache gave other verdicts than the fixture's right ones\n${show(none)}`);
  assert.deepEqual(filling.verdicts, none.verdicts, `the run that filled the cache gave other verdicts than the run with no cache\n${show(filling)}\n${show(none)}`);
  assert.deepEqual(reusing.verdicts, none.verdicts, `the run that reused the cache gave other verdicts than the run with no cache\n${show(reusing)}\n${show(none)}`);
  // The second run is a run with the cache only if it used it.
  assert.equal(timesBuilt(reusing, base), 0, `the second run built the merge-base tree ${tree} again (${timesBuilt(reusing, base)} times), so it ran without the cache\n${show(reusing)}`);
  assert.ok(reusing.lines.some((line) => line.role === 'base' && line.tree === tree && line.reused === true), `the second run printed no line BUILD {"role":"base","reused":true,"tree":"${tree}",…}\n${show(reusing)}`);
});
