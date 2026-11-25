// Criterion 2 of #3262 (#3262.e02db7d6): "In #3222's planted slow call's runs (`--sessions 15 --patches`, with and
// without `--slow`), the 15 patches' median service with the slow call in flight is at most 1.25 times their median
// with none (drafted; 434 ms against 88 ms on main). A planted canvas side that keeps render-backs fails, naming the
// render-back"
//
// The test runs the harness's two runs in this checkout and judges them (judge.mjs `judgeSlowCall`): the side's own
// count of the calls it holds must not rise with the slow call, a render-back, and the 15 patches' median service
// behind it must be within 1.25 times their median with none. Both failures name the render-back. It then takes the
// same two runs in the merge base's built checkout (`DEEP_3262_BASE`), right after, and keeps all four outputs side
// by side; where the merge base's times read within 1.25 too, the change's time proves nothing and the test is
// INCONCLUSIVE (README: The times are readings). The planted side is twins/keeps-render-backs.
// Run: DEEP_3262_BASE=<built merge base> node --test tests/acceptance/3262/ac2-slow-call.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { REPO, keep, mergeBase, runHarness, runOnMergeBase, sameCore } from './harness.mjs';
import { AC, PATCHES, judgeSlowCall } from './judge.mjs';

const NONE = ['--sessions', String(PATCHES), '--patches'];
const SLOW = [...NONE, '--slow'];

test('AC2 #3262.e02db7d6 in #3222\'s planted slow call\'s runs, the 15 patches\' median service with the slow call in flight is at most 1.25 times their median with none, and the side doesn\'t keep the render-back', { timeout: 30 * 60_000 }, async (t) => {
  const none = await runHarness(REPO, NONE, 'the harness\'s run of 15 patches with no slow call');
  const slow = await runHarness(REPO, SLOW, 'the harness\'s run of 15 patches behind the slow call');
  const judged = judgeSlowCall(slow.output, none.output);
  if (judged.blocked) throw Error(`BLOCKED: ${judged.blocked}`);
  assert.ok(judged.problems.length === 0, `AC2 ${AC[2]}: ${judged.problems.join('\n')}`);
  t.diagnostic(`the change: ${judged.reading}`);

  // The before of this after: the same two runs on the merge base, on this machine, right after.
  const base = mergeBase();
  const noneBefore = await runOnMergeBase(base, NONE, 'the harness\'s run of 15 patches with no slow call');
  const slowBefore = await runOnMergeBase(base, SLOW, 'the harness\'s run of 15 patches behind the slow call');
  sameCore(none, noneBefore, 'the runs of 15 patches');
  sameCore(slow, slowBefore, 'the runs of 15 patches behind the slow call');
  const control = judgeSlowCall(slowBefore.output, noneBefore.output);
  if (control.blocked) throw Error(`BLOCKED: on the merge base, ${control.blocked}`);
  t.diagnostic(`the merge base (${base.commit.slice(0, 9)}): ${control.reading}`);
  if (control.within) {
    throw Error(`INCONCLUSIVE: the merge base's runs, taken right after the change's, read the patches no slower behind the slow call either: ${control.reading}. The harness didn't read on this machine at this time what the criterion is about, so the change's reading (${judged.reading}) proves nothing; this is not a pass`);
  }
  t.diagnostic(`kept side by side: ${[...keep('patches-15', none, noneBefore), ...keep('patches-15-slow', slow, slowBefore)].join(', ')}`);
});
