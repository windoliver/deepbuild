// AC5 #3036.69707b1e: "With `span: 5s` the groove behind the ball is 5 s long, and a plate with 5,000 samples alive is
// refused at check, naming the count"
//
// Fixtures (helpers.ts), shown by the working agent through deep_show:
//   - `laneDoc` with `tracks: {items: "rollers", width: 0.4, depth: 0.05, span: 5}`: criterion 1's lane and rolling
//     ball (1 m/s, read every 0.5 m). At 8 s the ball is at x = 3 m and was at x = −2 m 5 s before.
//   - `capDoc`: the lane with eight balls at rest on it, the collection `crowd` holding them, 30 s at 24 frames a
//     second, and `tracks: {items: "crowd", width: 0.4, depth: 0.05, span: 26}`: from 26 s on the plate reads each ball
//     at 26 × 24 + 1 = 625 whole multiples of the frame interval, 8 × 625 = 5,000 samples alive. Its twin with
//     `span: 20` holds 8 × 481 = 3,848, no more than 4,096.
//
// asserts:
//   - the span (deep_show, deep_query, terrain_rays at 8 s): the ball is where its keys put it; on the centre line the
//     drawn surface is `depth` lower than the plate as built, within 1 mm, from x = −1.45 m (just over one sample's
//     spacing past where the ball was 5 s before) to x = 2.95 m (the ball); and it is the plate as built within 1 mm
//     at x = −2.75 m and farther back (one sample's spacing and half the width behind where the ball was 5 s before),
//     and at x = 3.25 m and farther on (ahead of the ball);
//   - the cap: the plate with 5,000 samples alive is refused at check, an error naming `ground` at
//     items/ground/params/tracks whose `actual` holds `count: 5000`; its twin with 3,848 is presented, so it is the
//     count that is refused.
//
// Wrong programs this fails on (none planted): a plate that doesn't read `span` (the groove reaches back to the roll's
// start); a span read in frames, or in another unit; a groove drawn ahead of the ball; the base (it refuses `tracks`
// with another error, which names no count); no cap, a cap that refuses 3,848, a refusal that names no count or
// another count.
import { describe, it } from 'vitest';
import {
  AC, BALL_POS, CAP, LANE_FPS, OVER_SAMPLES, PLATE, ROLLING, SPAN, SPAN_AT, TIMEOUT, TRACKS, UNDER_SPAN, capDoc, capFailures, docId, drawnOf, laneDoc, lineProbes, metOf, none,
  placeFailures, placesOf, presented, query, runShow, samplesAt, show, spanFailures, spanJudgesFailTheirPlants, terrainRays, useBins, useFolders,
} from './helpers.ts';

const bin = useBins(['deep-show']);
const folder = useFolders();
const DOC = docId(5);
const OVER = docId(6);
const UNDER = docId(7);

describe(`${AC[5]} a span cuts the groove behind the ball, and a plate past 4,096 samples alive is refused`, () => {
  it(`${AC[5]} with span: 5s the groove behind the ball is 5 s long`, () => {
    spanJudgesFailTheirPlants();
    const samples = samplesAt(ROLLING, LANE_FPS, SPAN_AT, SPAN);
    const probes = lineProbes();
    const calls = [show(DOC, laneDoc('A ball rolled 10 m, tracks 5 s long', ROLLING, { ...TRACKS, span: SPAN })), query(DOC, [BALL_POS], samples.map((s) => s.t)), terrainRays(DOC, SPAN_AT, probes)];
    const [shown, placed, met] = runShow(bin('deep-show'), folder(), [DOC], calls);
    presented(shown!, 'the lane whose plate keeps 5 s of tracks');
    none(placeFailures(ROLLING, samples, placesOf(placed!, BALL_POS, samples.length)), 'the ball rolls at 1 m/s: at 8 s it is at x = 3 m, and was at x = −2 m 5 s before');
    none(spanFailures(drawnOf(metOf(met!, probes, 'the rays down onto the centre line at 8 s'), probes), SPAN_AT, SPAN), 'at 8 s the groove runs from where the ball was 5 s before to the ball, and no farther either way');
  }, TIMEOUT);

  it(`${AC[5]} a plate with 5,000 samples alive is refused at check, naming the count`, () => {
    spanJudgesFailTheirPlants();
    const [over, under] = runShow(bin('deep-show'), folder(), [OVER, UNDER], [
      show(OVER, capDoc('Eight balls, 5,000 samples alive', CAP.span)), show(UNDER, capDoc('Eight balls, 3,848 samples alive', UNDER_SPAN)),
    ]);
    none(capFailures(over!, PLATE, OVER_SAMPLES), `the plate that reads 8 balls over ${CAP.span} s at ${CAP.fps} frames a second is refused at check, naming the count 5,000`);
    presented(under!, 'the same plate with span 20, 3,848 samples alive');
  }, TIMEOUT);
});
