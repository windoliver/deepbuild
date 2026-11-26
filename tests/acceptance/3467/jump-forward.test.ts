// AC3 #3467.f53de7f6: On a fixture of 60 s at 30 frames a second with a key frame every 30 frames, stored in order,
// a jump from frame 30 to frame 1,515 decodes at most 16 samples. A planted worker that keeps today's start rule
// decodes 1,485 and fails, naming the count.
//
// The recording (fixtures.ts, `IN_ORDER`) is one image@1 on a board. One `deep-canvas-render session` of two steps:
// the first presents frame 29, for which the player asks the worker for frame 29 and then, ahead, for frame 30, so
// frame 30 is the last frame the worker decoded; the second moves the clock to frame 1,515's time. The jump's count
// is the `samples` of the one request for frame 1,515, made right after the request for frame 30. Frame 1,515's key
// frame is frame 1,500, so 16 samples reach it; today's rule decodes every sample after frame 30, 1,485 of them. The
// same session with `planted: "keeps_base_start_rule"` must fail the same check, naming that count.

import { describe, expect, it } from 'vitest';
import { IN_ORDER, frameTime, keyBefore } from './fixtures.ts';
import { ITEM, TIMEOUT, board, makeFixture, plantedRan, render, sessionLine, stored, useBinary, useTemp } from './helpers.ts';
import { judgeJumpForward, jumpCount, type JsonObject } from './judges.ts';

const renderBin = useBinary('deep-canvas-render');
const temp = useTemp('jump-forward');
const FROM = 30;
const TO = 1515;
/** The samples from the key frame before the target through it: 1,500 to 1,515. */
const REACH = TO - keyBefore(IN_ORDER, TO) + 1;
const PLANTED = 'keeps_base_start_rule';
/** Frame 29 on screen (frame 30 asked ahead), then frame 1,515. */
const TIMES = [frameTime(FROM - 1), frameTime(TO)];

let made: { doc: JsonObject; store: string } | undefined;
function fixture(): { doc: JsonObject; store: string } {
  if (made === undefined) {
    const dir = temp();
    const { store, sha } = stored(dir, makeFixture(IN_ORDER, dir));
    made = { doc: board('jump-forward', sha, [IN_ORDER.width, IN_ORDER.height], 61), store };
  }
  return made;
}

describe('AC3 #3467.f53de7f6 a jump forward starts at the key frame before its target', () => {
  it('AC3 #3467.f53de7f6 a jump from frame 30 to frame 1,515 decodes at most 16 samples', () => {
    const bin = renderBin();
    const { doc, store } = fixture();
    expect(REACH, 'frame 1,515 is 16 samples from its key frame').toBe(16);
    const [answer] = render(bin, 'session', [sessionLine(doc, store, TIMES)], 'session jumping from frame 30 to frame 1,515');
    console.log(`AC3 #3467.f53de7f6 the jump from frame 30 to frame 1,515 decodes: ${jumpCount(answer, ITEM, TO)} samples`);
    expect(judgeJumpForward(answer, ITEM, FROM, TO, REACH, 16), 'the request for frame 1,515 decodes at most 16 samples').toBeNull();
  }, TIMEOUT);

  it('AC3 #3467.f53de7f6 a planted worker that keeps today\'s start rule decodes 1,485 and fails the same check, naming the count', () => {
    const bin = renderBin();
    const { doc, store } = fixture();
    const [answer] = render(bin, 'session', [sessionLine(doc, store, TIMES, PLANTED)], `session jumping from frame 30 to frame 1,515, planted ${PLANTED}`);
    plantedRan(answer, PLANTED);
    const failure = judgeJumpForward(answer, ITEM, FROM, TO, REACH, 16);
    expect(failure ?? 'no failure: the planted worker passed the check', 'the check fails on the planted worker, naming the count').toMatch(/decoded \d+ samples, more than 16/);
    console.log(`AC3 #3467.f53de7f6 planted ${PLANTED}: the jump decodes: ${jumpCount(answer, ITEM, TO)} samples`);
    expect(jumpCount(answer, ITEM, TO), 'the planted worker decodes every sample after frame 30 through frame 1,515').toBe(1485);
  }, TIMEOUT);
});
