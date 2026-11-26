// AC1 #3467.261c442a: A fixture of 250 frames at 30 frames a second, encoded with two B-frames between reference
// frames and one key frame, plays forward through its whole span in the live view: the `samples` of its requests sum
// to at most 250. On the merge base the rows hold no `samples`, and this test fails, naming the field. A planted
// worker that keeps today's start rule sums to over 10,000 and fails, naming the sum.
//
// The recording (fixtures.ts, `REORDERED`) is one image@1 drawn at its own size on a board. Three runs of
// `deep-canvas-render`:
//
// 1. `idle` for 10 s of the real clock, the live view as #499's suite drives it: the recording's 8.33 s play
//    through, and every `decodes` row of the run's `players` block must hold `samples`. That call's rows are the ones
//    the merge base has, and there they hold no `samples`, which is how this test fails on it.
// 2. `session`, one step a frame at each frame's own time, in order: the test's own clock, so each of the 250 frames
//    is shown once. The real clock can't prove the planted worker's sum, since that worker's own decodes make the
//    clock skip frames and the sum then depends on which.
// 3. The second run again with `planted: "keeps_base_start_rule"`: the same check must fail, naming the sum, and the
//    sum is over 10,000.

import { describe, expect, it } from 'vitest';
import { REORDERED, frameTime } from './fixtures.ts';
import { ITEM, TIMEOUT, board, idleLine, makeFixture, plantedRan, render, sessionLine, stored, useBinary, useTemp } from './helpers.ts';
import { judgePlay, samplesSum, type JsonObject } from './judges.ts';

const renderBin = useBinary('deep-canvas-render');
const temp = useTemp('forward');
const FRAMES = REORDERED.frames;
const PLANTED = 'keeps_base_start_rule';

let made: { doc: JsonObject; store: string } | undefined;
/** The recording in a store, and the board that plays it at its own size (its span past the recording's end). */
function fixture(): { doc: JsonObject; store: string } {
  if (made === undefined) {
    const dir = temp();
    const { store, sha } = stored(dir, makeFixture(REORDERED, dir));
    made = { doc: board('forward', sha, [REORDERED.width, REORDERED.height], 12), store };
  }
  return made;
}
const everyFrame = (): number[] => Array.from({ length: FRAMES }, (_, k) => frameTime(k));

describe('AC1 #3467.261c442a a recording stored out of presentation order plays forward and each sample is decoded once', () => {
  it('AC1 #3467.261c442a played forward through its whole span on the real clock, the `samples` of its requests sum to at most 250', () => {
    const bin = renderBin();
    const { doc, store } = fixture();
    const [answer] = render(bin, 'idle', [idleLine(doc, store, 10)], 'idle playing the recording');
    console.log(`AC1 #3467.261c442a on the real clock the \`samples\` sum to: ${samplesSum(answer, ITEM, 'idle')}`);
    expect(judgePlay(answer, ITEM, 'idle', FRAMES, false), 'every `decodes` row holds `samples`, and they sum to at most 250').toBeNull();
  }, TIMEOUT);

  it('AC1 #3467.261c442a stepped through each of its 250 frames in order, the `samples` of its requests sum to at most 250', () => {
    const bin = renderBin();
    const { doc, store } = fixture();
    const [answer] = render(bin, 'session', [sessionLine(doc, store, everyFrame())], 'session stepping the recording');
    console.log(`AC1 #3467.261c442a stepped through, the \`samples\` sum to: ${samplesSum(answer, ITEM, 'session')}`);
    expect(judgePlay(answer, ITEM, 'session', FRAMES, true), 'every `decodes` row holds `samples`, and they sum to at most 250').toBeNull();
  }, TIMEOUT);

  it('AC1 #3467.261c442a a planted worker that keeps today\'s start rule sums to over 10,000 and fails the same check, naming the sum', () => {
    const bin = renderBin();
    const { doc, store } = fixture();
    const [answer] = render(bin, 'session', [sessionLine(doc, store, everyFrame(), PLANTED)], `session stepping the recording, planted ${PLANTED}`);
    plantedRan(answer, PLANTED);
    const failure = judgePlay(answer, ITEM, 'session', FRAMES, true);
    expect(failure ?? 'no failure: the planted worker passed the check', 'the check fails on the planted worker, naming the sum').toMatch(/requests sum to \d+, over the 250 samples/);
    const sum = samplesSum(answer, ITEM, 'session');
    console.log(`AC1 #3467.261c442a planted ${PLANTED}: the \`samples\` sum to: ${sum}`);
    expect(typeof sum === 'number' && sum > 10_000, `the planted worker's \`samples\` sum to over 10,000: ${sum}`).toBe(true);
  }, TIMEOUT);
});
