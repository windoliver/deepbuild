// Criterion 1, live half (needs network and gh auth for windoliver/deepbuild): the lane passes on the
// real docs and the real open issues. It never skips: offline or signed out, the lane is INCONCLUSIVE and
// this test fails, saying so.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { laneName, makeFixture, runLane, verdicts } from './helpers.mjs';

test('criterion 1 (live): the lane passes on the real docs and the real open issues of windoliver/deepbuild', (t) => {
  const { repo } = makeFixture(t);
  // The caller's own environment and gh, with the repository named for a gh that reads it from git.
  const run = runLane(repo, { ...process.env, GH_REPO: process.env.GH_REPO ?? 'windoliver/deepbuild' });
  const name = laneName(run);
  const states = verdicts(run, name).map((l) => l.split(' ')[0]);
  if (states.includes('INCONCLUSIVE')) assert.fail(`BLOCKED: the lane couldn't read the open issues; this test needs network and gh auth for windoliver/deepbuild:\n${run.output}`);
  assert.deepEqual(states, ['PASS'], `the lane didn't pass on the real docs and open issues:\n${run.output}`);
  assert.equal(run.status, 0, run.output);
});
