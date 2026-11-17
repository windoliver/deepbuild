// AC3 #1381.44fb6045: "The floor center of a flat-bottomed crater whose rim stands 30° high reads occlusion 0.75 ± 0.02;
// a slope-only occlusion reads 1 and fails"
//
// Fixture (helpers.ts `craterDoc`, README: Fixtures): the crater plate, 2,048 × 2,048 m at 0.5 m (4,097 × 4,097 samples)
// with `horizon: {azimuths: 16, size: 257}`: a flat floor at 0 out to 300 m from the centre, a wall rising linearly to
// the rim at 600 m, 600 × tan 30° = 346.41 m high, and a plateau at the rim's height beyond. From the floor's centre
// the wall's height over distance grows all the way to the rim and the plateau's falls past it, so the rim stands
// exactly 30° high along every azimuth. One frame by `view3d` at 640 × 360 reads `ground_points` at the centre (0, 0)
// (README: Assumed surfaces 3), the sun's cascades at zero range so the reading lies past the last cascade.
//
// Closed form: occlusion is 1 − the mean over the azimuths of sin² of the horizon angle, 1 − sin² 30° = 0.75 on every
// azimuth, so the centre reads 0.75 ± 0.02 (the issue's tolerance).
// The first test, the shipped program: the centre reads 0.75 ± 0.02.
// The second test: `--planted terrain_occlusion_from_slope` (README: Planted programs), occlusion from the ground's slope
// alone, reads 1 on the flat floor (within 0.02) and the first test's judge fails, naming the point.
//
// Catches: the base (no `horizon`, no readings); a slope-only occlusion; a trace that stops short of the rim; another
// formula over the same angles, such as 1 − mean(sin h) (0.5 here).
import { describe, expect, it } from 'vitest';
import {
  AC, CRATER_OCCLUSION, PLAIN, SMALL, craterDoc, framesOf, groundPoints, groundRows, requireMetal, runGpu, useGpu, useOut, writeJson,
  type Planted, type Xz,
} from './helpers.ts';

const ID = AC[3];
const NAME = `AC3 ${ID}`;
const bin = useGpu();
const out = useOut();
const CENTRE: Xz = [0, 0];
const TOLERANCE = 0.02;

/** The crater floor centre's occlusion. */
function centre(planted?: Planted): number {
  const what = `the crater's floor centre${planted ? ` under ${planted}` : ''}`;
  const doc = writeJson(out(), 'crater', craterDoc({ size: SMALL, zeroRange: true }));
  const [reply] = runGpu(bin(), out(), [{ call: 'view3d', doc, look: PLAIN, size: [...SMALL], frames: 1, ground_points: groundPoints([CENTRE]) }], planted);
  const [frame] = framesOf(reply!, 1, what);
  return groundRows(frame!, [CENTRE], what)[0]!.occlusion;
}
/** The judge: 0.75 ± 0.02 at the floor's centre, a failure naming the point. */
const judge = (occlusion: number): string[] => (Math.abs(occlusion - CRATER_OCCLUSION) <= TOLERANCE ? []
  : [`the crater's floor centre (0, 0) reads occlusion ${occlusion.toFixed(4)}, not ${CRATER_OCCLUSION} ± ${TOLERANCE} under a rim standing 30° high`]);

describe(`${NAME} sky occlusion at a crater's floor centre`, () => {
  it(`${NAME} the floor centre of a flat-bottomed crater whose rim stands 30° high reads occlusion 0.75 ± 0.02`, () => {
    requireMetal();
    const occlusion = centre();
    console.log(`${ID}: the crater's floor centre reads occlusion ${occlusion.toFixed(4)} (closed form ${CRATER_OCCLUSION})`);
    expect(judge(occlusion), 'the floor centre reads 0.75 ± 0.02').toEqual([]);
  }, 3_600_000);

  it(`${NAME} the planted terrain_occlusion_from_slope, a slope-only occlusion, reads 1 at the floor centre and fails`, () => {
    requireMetal();
    const occlusion = centre('terrain_occlusion_from_slope');
    console.log(`${ID} terrain_occlusion_from_slope: the floor centre reads occlusion ${occlusion.toFixed(4)}`);
    expect(Math.abs(occlusion - 1), `a slope-only occlusion reads 1 on the flat floor, got ${occlusion}`).toBeLessThanOrEqual(TOLERANCE);
    const failures = judge(occlusion);
    expect(failures.length, 'the judge fails on the slope-only occlusion').toBe(1);
    expect(failures[0], 'the failure names the point').toMatch(/floor centre \(0, 0\)/);
  }, 3_600_000);
});
