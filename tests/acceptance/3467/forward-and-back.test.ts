// AC4 #3467.4c4b1527: The second fixture played forward decodes one sample a frame, and a jump back on it decodes
// from the key frame before its target and no sample earlier. A planted worker that starts every request at a key
// frame decodes more than one sample a frame and fails, naming the sum.
//
// The second fixture is criterion 3's (fixtures.ts, `IN_ORDER`: stored in order, a key frame every 30 frames). One
// `deep-canvas-render session`: 91 steps present frames 0 to 90, one each, in order, across the key frames at 30, 60
// and 90; then one step moves the clock back to frame 47's time, whose key frame is frame 30. The forward play is
// the requests before the first one for a frame behind the one asked before it; their `samples` must sum to the
// frames they cover (the frame asked ahead of the last one shown among them). The jump back is that first request
// behind: its `samples` must be the 18 from frame 30 through frame 47, no more and no fewer. The same session with
// `planted: "starts_every_request_at_key_frame"` must fail the same check, naming the forward play's sum.

import { describe, expect, it } from 'vitest';
import { IN_ORDER, frameTime, keyBefore } from './fixtures.ts';
import { ITEM, TIMEOUT, board, makeFixture, plantedRan, render, sessionLine, stored, useBinary, useTemp } from './helpers.ts';
import { forwardSum, judgeForwardAndBack, type JsonObject } from './judges.ts';

const renderBin = useBinary('deep-canvas-render');
const temp = useTemp('forward-and-back');
const LAST = 90;
const BACK = 47;
const KEY = keyBefore(IN_ORDER, BACK);
const PLANTED = 'starts_every_request_at_key_frame';
/** Frames 0 to 90, one step each, then back to frame 47. */
const TIMES = [...Array.from({ length: LAST + 1 }, (_, k) => frameTime(k)), frameTime(BACK)];

let made: { doc: JsonObject; store: string } | undefined;
function fixture(): { doc: JsonObject; store: string } {
  if (made === undefined) {
    const dir = temp();
    const { store, sha } = stored(dir, makeFixture(IN_ORDER, dir));
    made = { doc: board('forward-and-back', sha, [IN_ORDER.width, IN_ORDER.height], 61), store };
  }
  return made;
}

describe('AC4 #3467.4c4b1527 a recording stored in order plays as it does today', () => {
  it('AC4 #3467.4c4b1527 played forward it decodes one sample a frame, and a jump back decodes from the key frame before its target and no sample earlier', () => {
    const bin = renderBin();
    const { doc, store } = fixture();
    expect(KEY, 'frame 47\'s key frame is frame 30').toBe(30);
    const [answer] = render(bin, 'session', [sessionLine(doc, store, TIMES)], 'session playing frames 0 to 90 and jumping back to frame 47');
    console.log(`AC4 #3467.4c4b1527 played forward: ${JSON.stringify(forwardSum(answer, ITEM))}`);
    expect(judgeForwardAndBack(answer, ITEM, 0, LAST, BACK, KEY), 'one sample a frame forward; the jump back decodes frames 30 to 47').toEqual([]);
  }, TIMEOUT);

  it('AC4 #3467.4c4b1527 a planted worker that starts every request at a key frame decodes more than one sample a frame and fails the same check, naming the sum', () => {
    const bin = renderBin();
    const { doc, store } = fixture();
    const [answer] = render(bin, 'session', [sessionLine(doc, store, TIMES, PLANTED)], `session playing frames 0 to 90 and jumping back to frame 47, planted ${PLANTED}`);
    plantedRan(answer, PLANTED);
    const failures = judgeForwardAndBack(answer, ITEM, 0, LAST, BACK, KEY);
    expect(failures[0] ?? 'no failure: the planted worker passed the check', 'the check fails on the planted worker, naming the sum').toMatch(/decoded \d+ samples, not one a frame/);
    const play = forwardSum(answer, ITEM);
    console.log(`AC4 #3467.4c4b1527 planted ${PLANTED}: played forward: ${JSON.stringify(play)}`);
    expect(play !== null && play.sum > play.frames, `the planted worker decodes more than one sample a frame: ${JSON.stringify(play)}`).toBe(true);
  }, TIMEOUT);
});
