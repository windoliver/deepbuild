// Criterion 3: with no network and no cache, the lane is INCONCLUSIVE, never PASS.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fakeGh, laneName, makeFixture, runLane, sandboxEnv, verdicts } from './helpers.mjs';

test('#910.fa84e550 criterion 3: with gh unable to reach GitHub, no target/open-issues.json and no DEEP_OPEN_ISSUES, the lane alone is INCONCLUSIVE and the checks don\'t pass', (t) => {
  const { sandbox, repo } = makeFixture(t);
  fakeGh(sandbox, { offline: true });
  assert.equal(existsSync(join(repo, 'target', 'open-issues.json')), false, 'the fixture holds no cached open issues');
  const run = runLane(repo, sandboxEnv(sandbox), { drift: false });
  const name = laneName(run);
  // A lane that reads a failed fetch as no open issues prints PASS here; one that reports it as FAIL or BLOCKED
  // prints that state instead.
  assert.deepEqual(verdicts(run, name), ['INCONCLUSIVE'], `the lane's verdict is INCONCLUSIVE:\n${run.output}`);
  // runLanes' result is scripts/checks.mjs' exit status: an INCONCLUSIVE lane that exits 0 lets the checks pass.
  assert.notEqual(run.status, 0, `runLanes returned 0 with the lane INCONCLUSIVE:\n${run.output}`);
});
