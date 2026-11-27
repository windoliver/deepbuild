// #3502, fourth criterion: a shown window holding a still document for 60 s runs 0 request-frame callbacks on the
// new pin, as #1551 reads it; a planted link that never pauses fails, naming the count.
//
// The surface is #1551's (tests/acceptance/1551/README.md): the canvas-idle lane's still board in `deep-show live`,
// watched for 60 s from the moment it settles, `live.request_frames` and `live.window`, and the planted
// `link_never_stops`. A count is judged on any Mac that shows the window. A tree that isn't on the new pin fails
// before a window opens: 0 callbacks on the old pin is #1551's reading, not this one.
// Run: node --test tests/acceptance/3502/still.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { debugBinary, requireNewPin } from './common.mjs';
import { liveRun, mentions, requireShown, scenario, STILL_MS, stillBoard, stillProblem } from './show.mjs';

const WATCH = { watch_from: 'settled', watch_ms: STILL_MS };

test('AC4 #3502.e758e239 on the new pin, the still board, once settled in the app\'s shown window, runs 0 request-frame callbacks over 60 s', { timeout: 3 * 3_600_000 }, () => {
  requireNewPin();
  const live = liveRun(debugBinary('deep-show'), scenario(stillBoard(), WATCH));
  requireShown(live, 'the still minute');
  console.log(`AC4 request_frames ${live.request_frames} at ${live.display?.refresh_hz} Hz`);
  assert.equal(stillProblem(live), null);
});

test('AC4 #3502.e758e239 a planted link that never pauses (link_never_stops) fails the same check, naming the count', { timeout: 3 * 3_600_000 }, () => {
  const live = liveRun(debugBinary('deep-show'), scenario(stillBoard(), WATCH, 'link_never_stops'));
  requireShown(live, 'link_never_stops');
  const problem = stillProblem(live);
  console.log(`AC4 planted: ${problem ?? 'no request-frame callback'}`);
  assert.ok(problem !== null && live.request_frames > 0 && mentions(problem, live.request_frames), `the check fails the planted link, naming its ${live.request_frames} callbacks: ${problem}`);
});
