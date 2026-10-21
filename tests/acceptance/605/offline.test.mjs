// Criterion 2: offline, the lane is INCONCLUSIVE, not PASS.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fakeGh, laneName, makeFixture, runLane, sandboxEnv, verdicts } from './helpers.mjs';

test('criterion 2: offline (gh can\'t reach GitHub, nothing cached), the lane is INCONCLUSIVE, not PASS, and the checks don\'t pass', (t) => {
  const { sandbox, repo } = makeFixture(t);
  fakeGh(sandbox, { offline: true });
  const run = runLane(repo, sandboxEnv(sandbox));
  const name = laneName(run);
  // A lane that reads a failed fetch as no open issues prints PASS here; one that reports it as FAIL or
  // BLOCKED prints that state instead of INCONCLUSIVE.
  assert.deepEqual(verdicts(run, name).map((l) => l.split(' ')[0]), ['INCONCLUSIVE'], `the lane's verdict is INCONCLUSIVE:\n${run.output}`);
  // runLanes' result is scripts/checks.mjs' exit status: an INCONCLUSIVE lane that still exits 0 lets
  // the checks pass.
  assert.notEqual(run.status, 0, `runLanes returned 0 with the lane INCONCLUSIVE:\n${run.output}`);
});
