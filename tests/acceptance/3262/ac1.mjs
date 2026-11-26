// Criterion 1 of #3262 (#3262.55d4e80f), the body of its test; ac1-sessions-1, -4 and -16.test.mjs each run it for one
// run of the harness: "With #3222's harness (`docs/spikes/3222/harness.mjs`), in each of its 1, 4 and 16-session runs,
// the median service of the last 20 calls is at most 1.25 times the first 20's (drafted; 1.7, 3.2 and 100 times on
// main). The harness's output on the merge base is kept beside it"
//
// The test runs the harness in this checkout and judges its output (judge.mjs `judgeGrowth`). It then runs the same
// command in the merge base's built checkout (`DEEP_3262_BASE`), right after and on the same machine, and keeps both
// outputs side by side (harness.mjs `keep`). The times are readings, each with its load: the merge base's run is what
// shows that the harness, on this machine at this time, reads the growth the criterion is about; where it reads none,
// the change's reading proves nothing and the test is INCONCLUSIVE (README: The times are readings).
import assert from 'node:assert/strict';
import { REPO, keep, mergeBase, runHarness, runOnMergeBase, sameCore } from './harness.mjs';
import { AC, judgeGrowth } from './judge.mjs';

/** The test of the harness's `n`-session run; `t` is node:test's context, for the readings it prints. */
export async function growth(n, t) {
  const flags = ['--sessions', String(n)];
  const what = `the harness's ${n}-session run`;
  const change = await runHarness(REPO, flags, what);
  const judged = judgeGrowth(change.output, n);
  if (judged.blocked) throw Error(`BLOCKED: ${judged.blocked}`);
  assert.ok(judged.problems.length === 0, `AC1 ${AC[1]}: ${judged.problems.join('\n')}`);
  t.diagnostic(`the change: ${judged.reading}`);

  // The before of this after: the same run on the merge base, on this machine, right after.
  const base = mergeBase();
  const before = await runOnMergeBase(base, flags, what);
  sameCore(change, before, what);
  const control = judgeGrowth(before.output, n);
  if (control.blocked) throw Error(`BLOCKED: on the merge base, ${control.blocked}`);
  t.diagnostic(`the merge base (${base.commit.slice(0, 9)}): ${control.reading}`);
  if (control.within) {
    throw Error(`INCONCLUSIVE: the merge base's run, taken right after the change's, reads no growth either: ${control.reading}. The harness didn't read on this machine at this time what the criterion is about, so the change's reading (${judged.reading}) proves nothing; this is not a pass`);
  }
  t.diagnostic(`kept side by side: ${keep(`sessions-${n}`, change, before).join(' and ')}`);
}
