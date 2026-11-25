// AC2 #3036.c665f650: "The same ball hopping 2 m through the air leaves no groove under the hop, within one sample's
// spacing at each end. A planted plate that reads the item's ground position alone draws through the hop and fails,
// naming the span"
//
// Fixture (helpers.ts `laneDoc`, judges.ts `HOPPING`): criterion 1's lane, plate, tracks and ball, the ball's height
// keyed as well: on the plate until x = −1 m (4 s), 0.5 m up at x = 0 (5 s), on the plate again from x = 1 m (6 s). Its
// lowest point is more than 2 cm over the plate from 4.04 s to 5.96 s, so of the 21 places the plate reads, those at
// 4.5, 5 and 5.5 s are in the air and the other 18 on the ground. One sample's spacing is 0.5 m.
//
// asserts, from one process (deep_show, deep_query, terrain_rays at 10 s):
//   - the ball is where its keys put it at each of the 21 times (within 1e-4 m): it hops 2 m;
//   - the groove is there before and after the hop: on the centre line from x = −4.95 m to −1.05 m and from 1.05 m to
//     4.95 m the drawn surface is `depth` lower than the plate as built, within 1 mm;
//   - under the hop, farther than one sample's spacing (0.5 m) and half the width (0.2 m, how far a lowering reaches
//     past its line) from either end, so from x = −0.25 m to 0.25 m, the drawn surface is the plate as built within
//     1 mm;
//   - planted `tracks_read_ground_position`: the same judge fails under the hop alone, the failure naming the span
//     from x = −1 m to x = 1 m (4 s to 6 s).
//
// Wrong programs this fails on (the first planted, the rest not): a plate that reads x and z and never the height; a
// plate that joins the last place before the hop to the first after it; the base (no groove before or after the hop);
// a plate that reads the ground as y = 0 (no groove at all); one whose 2 cm is read from the ball's centre (no groove
// at all: the centre is 25 cm up).
import { describe, expect, it } from 'vitest';
import {
  AC, BALL_POS, HOPPING, LANE_FPS, PLANTED, ROLLED_AT, TIMEOUT, TRACKS, docId, drawnOf, failsNaming, hopFailures, hopJudgeFailsItsPlants, laneDoc, lineProbes, metOf, none,
  placeFailures, placesOf, presented, query, runShow, samplesAt, show, terrainRays, useBins, useFolders,
  type Height, type Sample, type ShowPlanted, type V3,
} from './helpers.ts';

const bin = useBins(['deep-show']);
const folder = useFolders();
const DOC = docId(2);

/** One process, under a planted program or none: the lane shown, the hopping ball's place at each time the plate reads it, and the drawn surface on the centre line at 10 s. */
function read(planted?: ShowPlanted): { samples: Sample[]; places: V3[]; line: Height[] } {
  const samples = samplesAt(HOPPING, LANE_FPS, ROLLED_AT);
  const probes = lineProbes();
  const calls = [show(DOC, laneDoc('A ball hopping 2 m', HOPPING, TRACKS)), query(DOC, [BALL_POS], samples.map((s) => s.t)), terrainRays(DOC, ROLLED_AT, probes)];
  const [shown, placed, met] = runShow(bin('deep-show'), folder(), [DOC], calls, planted);
  presented(shown!, 'the lane whose plate keeps tracks behind the hopping ball');
  return { samples, places: placesOf(placed!, BALL_POS, samples.length), line: drawnOf(metOf(met!, probes, 'the rays down onto the centre line at 10 s'), probes) };
}

describe(`${AC[2]} a ball hopping 2 m through the air leaves no groove under the hop`, () => {
  it(`${AC[2]} the groove is drawn before and after the hop and not under it, within one sample's spacing at each end`, () => {
    hopJudgeFailsItsPlants();
    const { samples, places, line } = read();
    none(placeFailures(HOPPING, samples, places), 'the ball hops 2 m: on the plate to x = −1 m, 0.5 m up at x = 0, on the plate again from x = 1 m');
    none(hopFailures(line), 'the groove lies before and after the hop, and none under it');
  }, TIMEOUT);

  it(`${AC[2]} a planted plate that reads the item's ground position alone (${PLANTED.groundAlone}) draws through the hop and fails, naming the span`, () => {
    hopJudgeFailsItsPlants();
    const { samples, places, line } = read(PLANTED.groundAlone);
    none(placeFailures(HOPPING, samples, places), 'the planted plate moves no ball');
    const failures = hopFailures(line);
    failsNaming(failures, ['under the hop, the span from x -1 m to x 1 m (4 s to 6 s)'], PLANTED.groundAlone);
    expect(failures.filter((x) => !x.startsWith('under the hop')), `under ${PLANTED.groundAlone} the groove is still drawn before and after the hop, so the hop's span alone fails`).toEqual([]);
  }, TIMEOUT);
});
