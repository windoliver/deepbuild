// AC2, live: with the checkout's list, the public text lane run on main reads no finding. "Over main" is read as the
// lane's own run on main (README): a scratch copy of the checkout committed as origin/main, so the change and its commit
// messages are empty, and the lane reads every open issue of the repo through the caller's gh. Offline, signed out, or
// with no throttle grant, it skips as INCONCLUSIVE and never passes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LIVE_TIMEOUT, REPO, commit, ghProblem, liveEnv, makeCopy, runLanes, verdicts } from './helpers.mjs';

const LANE = 'public text';

test("#2405.67f3c930 AC2 (live): with the checkout's list, the public text lane run on main, which reads every open issue, reads no finding", (t) => {
  const env = liveEnv();
  const problem = ghProblem(env);
  if (problem) {
    t.skip(`INCONCLUSIVE: gh isn't signed in or can't reach GitHub, so the open issues can't be read: ${problem}`);
    return;
  }
  const { repo } = makeCopy(t);
  commit(repo, 'The tree as main holds it', { base: true });
  const run = runLanes(repo, env, [LANE], { timeout: LIVE_TIMEOUT });
  // The Proof: the lane's run over the open issues.
  t.diagnostic(run.output);
  const states = verdicts(run, LANE);
  if (run.signal || states.includes('INCONCLUSIVE')) {
    t.skip(`INCONCLUSIVE: the public text lane couldn't read the open issues of ${REPO} or didn't finish, so it has no verdict:\n${run.output}`);
    return;
  }
  // A list holding a name an open issue writes, which nobody restated first, fails here.
  assert.deepEqual(states, ['PASS'], `the public text lane doesn't pass on main with the checkout's list:\n${run.output}`);
  assert.equal(run.status, 0, run.output);
  // It read the open issues: its PASS line counts them.
  const read = Number(run.output.match(/(\d+) open issues name no studied product/)?.[1] ?? 0);
  assert.ok(read > 0, `the public text lane's PASS line doesn't say it read any open issue:\n${run.output}`);
});
