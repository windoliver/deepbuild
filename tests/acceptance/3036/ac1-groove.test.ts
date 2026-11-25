// AC1 #3036.ea21520e: "A ball rolled 10 m in a straight line leaves a groove whose drawn depth on the centre line is
// `depth` within 1 mm and whose width at half depth is half of `width` within 5%, read from the plate's evaluated drawn
// surface. A planted plate that lowers by `depth` only at the samples, with nothing between them, fails, naming the gap"
//
// Fixture (helpers.ts `laneDoc`, judges.ts for its numbers), shown by the working agent through deep_show: `ground`, a
// terrain plate 12 × 2 m at 0.05 m, level at 0.5 m, with `tracks: {items: "rollers", width: 0.4, depth: 0.05}`; `ball`,
// a ball of radius 0.25 m which two channels roll from x = −5 m to x = 5 m along z = 0 in 10 s, its centre one radius
// over the plate; the collection `rollers` holding the ball; 2 frames a second, so the plate reads the ball every
// 0.5 m: 21 places, 0.5 m apart, wider than `width`.
//
// asserts, from one process (deep_show, deep_query, terrain_rays at 10 s):
//   - the ball is where its keys put it at each of the 21 times (within 1e-4 m): it rolled 10 m in a straight line, its
//     lowest point on the plate;
//   - on the centre line, every 0.05 m between the roll's ends (199 rays down through the row z = 0), the drawn surface
//     is `depth` lower than the plate as built, within 1 mm;
//   - at three cross-sections (x = −2.738 m and 2.262 m, between places the plate read, and x = 0.012 m, beside one),
//     160 rays 5 mm apart each, the lowering passes half the depth once on each side, 0.2 m apart within 5%;
//   - planted `tracks_lower_at_samples_only`: the same judge fails on the centre line in each of the 20 gaps between
//     two places the plate read, each failure naming its gap, and at none of the places it read.
//
// Wrong programs this fails on (the first planted, the rest not): a plate that lowers about each sample alone; the
// base, which refuses `tracks` and draws no groove; a groove of another depth; a profile half or twice as wide; a
// groove off the ball's line; a plate that reads the ground as y = 0 (the ball is 0.5 m over that, so no groove).
import { describe, expect, it } from 'vitest';
import {
  AC, BALL_POS, CUTS_AT, LANE_FPS, PLANTED, ROLLED_AT, ROLLING, TIMEOUT, TRACKS, cutProbes, docId, drawnOf, failsNaming, grooveFailures, grooveJudgeFailsItsPlants, laneDoc,
  lineProbes, metOf, none, placeFailures, placesOf, presented, query, runShow, samplesAt, show, terrainRays, useBins, useFolders, where,
  type Cut, type Height, type Sample, type ShowPlanted, type V3,
} from './helpers.ts';

const bin = useBins(['deep-show']);
const folder = useFolders();
const DOC = docId(1);

/** One process, under a planted program or none: the lane shown, the ball's place at each time the plate reads it, and the drawn surface at 10 s on the centre line and at the three cross-sections. */
function read(planted?: ShowPlanted): { samples: Sample[]; places: V3[]; line: Height[]; cuts: Cut[] } {
  const samples = samplesAt(ROLLING, LANE_FPS, ROLLED_AT);
  const line = lineProbes();
  const across = CUTS_AT.map((x) => cutProbes(x));
  const probes = [...line, ...across.flat()];
  const calls = [show(DOC, laneDoc('A ball rolled 10 m', ROLLING, TRACKS)), query(DOC, [BALL_POS], samples.map((s) => s.t)), terrainRays(DOC, ROLLED_AT, probes)];
  const [shown, placed, met] = runShow(bin('deep-show'), folder(), [DOC], calls, planted);
  presented(shown!, 'the lane whose plate keeps tracks behind the rolling ball');
  const heights = drawnOf(metOf(met!, probes, 'the rays down onto the lane at 10 s'), probes);
  let at = line.length;
  const cuts = across.map((c, k): Cut => { const cut = { x: CUTS_AT[k]!, heights: heights.slice(at, at + c.length) }; at += c.length; return cut; });
  return { samples, places: placesOf(placed!, BALL_POS, samples.length), line: heights.slice(0, line.length), cuts };
}

describe(`${AC[1]} a ball rolled 10 m leaves a groove of the tracks' depth and width`, () => {
  it(`${AC[1]} the groove's drawn depth on the centre line is depth within 1 mm and its width at half depth is half of width within 5%, read from the plate's evaluated drawn surface`, () => {
    grooveJudgeFailsItsPlants();
    const { samples, places, line, cuts } = read();
    none(placeFailures(ROLLING, samples, places), 'the ball rolls 10 m in a straight line, on the plate, through the 21 places its keys give');
    none(grooveFailures(samples, line, cuts), 'the groove is 0.05 m deep on its centre line within 1 mm and 0.2 m wide at half depth within 5%');
  }, TIMEOUT);

  it(`${AC[1]} a planted plate that lowers by depth only at the samples, with nothing between them (${PLANTED.atSamples}), fails, naming the gap`, () => {
    grooveJudgeFailsItsPlants();
    const { samples, places, line, cuts } = read(PLANTED.atSamples);
    none(placeFailures(ROLLING, samples, places), 'the planted plate moves no ball');
    const failures = grooveFailures(samples, line, cuts);
    failsNaming(failures, ['the gap between the places read at'], PLANTED.atSamples);
    expect(failures.filter((x) => x.startsWith('the place read at')), `under ${PLANTED.atSamples} no failure is at a place the plate read: it still lowers by the depth there`).toEqual([]);
    const gaps = samples.slice(0, -1).map((s, k) => where(samples, (s.at[0] + samples[k + 1]!.at[0]) / 2).name);
    expect(gaps.filter((g) => !failures.some((x) => x.startsWith(`${g}: on the centre line`))), `under ${PLANTED.atSamples} the centre line fails in each of the 20 gaps`).toEqual([]);
  }, TIMEOUT);
});
