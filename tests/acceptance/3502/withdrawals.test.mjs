// #3502, sixth criterion: with a planted Notification Center whose calls take 2 s to return, 20 withdrawals in a row
// leave an input's frame on screen within 2 frames (drafted); the merge base waits on its UI thread and fails, naming
// the call (README: The withdrawals).
//
// The run is `deep-show live` with one wake, `withdrawals`: the app withdraws 20 notifications in a row by GPUI's own
// call while another thread posts an input into the window's queue. The center is planted by the loader
// (planted-center.m), so the same one stands under the head's build and the merge base's. Which thread made each of
// the center's calls is a count, judged on any Mac that shows the window; the input's 2 frames are a time, judged on
// a reference Mac at rest in a release build, and INCONCLUSIVE anywhere else. The merge base is the `deep-show`
// DEEP_3502_BASE_SHOW names; without it that test is BLOCKED.
// Run: node --test tests/acceptance/3502/withdrawals.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { debugBinary, givenBinary, inconclusive, releaseBinary, timingProblem } from './common.mjs';
import { centerCalls, FRAMES, judgeWithdrawals, liveRun, plantedCenter, requireShown, scenario, stillBoard, WITHDRAWALS } from './show.mjs';

const WAKE = { after_ms: 1_000, by: 'withdrawals', count: WITHDRAWALS };

/** One run under the planted center: the still board settles, then the wake; the check's two findings. */
function withdrawalsRun(bin, what) {
  const center = plantedCenter();
  // The merge base's UI thread sits in the center for 20 withdrawals of two 2 s calls each before it answers.
  const live = liveRun(bin, scenario(stillBoard(), { wake: [WAKE] }), { env: center.env, timeoutMs: 900_000 });
  requireShown(live, what);
  const wake = (Array.isArray(live.wakes) ? live.wakes : []).find(({ by }) => by === WAKE.by);
  assert.ok(wake, `${what}: the answer's live.wakes holds the withdrawals wake: ${JSON.stringify(live.wakes ?? null).slice(0, 400)}`);
  const found = judgeWithdrawals(wake, centerCalls(center.log));
  console.log(`AC6 ${what}: ${[...found.waited, found.late ?? `the input's frame presented within ${FRAMES} frames of its arrival`].join('; ')}`);
  return found;
}

test('AC6 #3502.350a78c3 under a planted Notification Center whose calls take 2 s, 20 withdrawals in a row keep every one of its calls off the UI thread', { timeout: 3 * 3_600_000 }, () => {
  assert.deepEqual(withdrawalsRun(debugBinary('deep-show'), 'the head').waited, []);
});

test('AC6 #3502.350a78c3 and they leave an input\'s frame on screen within 2 frames, on a reference Mac in a release build', { timeout: 3 * 3_600_000 }, async () => {
  const before = await timingProblem();
  if (before) inconclusive(`2 frames is a time, and ${before}`);
  const { waited, late } = withdrawalsRun(releaseBinary('deep-show'), 'the head, release');
  const after = late && await timingProblem();
  if (after) inconclusive(`the input's frame came late on a machine whose timing stopped counting during the run (${after})`, [late]);
  assert.deepEqual([...waited, ...(late ? [late] : [])], []);
});

test('AC6 #3502.350a78c3 the merge base waits on its UI thread and fails the same check, naming the call', { timeout: 3 * 3_600_000 }, () => {
  const base = givenBinary('DEEP_3502_BASE_SHOW', "a deep-show built from the merge base with the withdrawals wake added and nothing else");
  const { waited, late } = withdrawalsRun(base, 'the merge base');
  assert.equal(waited.length, 1, "the check fails the merge base: its UI thread made the center's calls");
  assert.match(waited[0], /^the UI thread made \d+ of the planted center's calls, each 2 s to return, and waited in them: removePendingNotificationRequestsWithIdentifiers: × \d+, removeDeliveredNotificationsWithIdentifiers: × \d+$/, 'the failure names the call');
  assert.ok(late, "the input's frame waited behind them, past 2 frames");
});
