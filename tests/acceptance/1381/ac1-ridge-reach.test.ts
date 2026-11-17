// AC1 #1381.aa8d0d8a: "A straight 100 m ridge under a 5° sun casts a shadow reaching 1,143 m from the crest, within one
// horizon texel"
//
// Fixture (helpers.ts `ridgeDoc`, README: Fixtures): the ridge plate, 8,192 × 8,192 m at 2 m (4,097 × 4,097 samples)
// with `horizon: {azimuths: 16, size: 257}`, so one horizon texel is 8,192 ÷ 256 = 32 m. A straight ridge along z, its
// crest 100 m high at x = −1,024, its lee foot 400 m east, a flat floor at 0 beyond. The key sun stands 5° above the
// horizon on the −x side, shining toward +x, perpendicular to the ridge, with its cascades set to zero range
// (`shadow_far: 0`, README: Assumed surfaces 2), so every ground point lies past the last cascade and the horizon alone
// shades it. One frame by `view3d` at 640 × 360 with `ground_points` along the line z = −256 from 400 m to 2,000 m east
// of the crest, every 4 m (401 points), each reading the sun's visibility there (README: Assumed surfaces 3).
//
// Closed form: the crest stands atan(100 ÷ d) above a floor point d m from it, so the sun at 5° meets it at d = 100 ÷
// tan 5° = 1,143.005 m, where the visibility, a smoothstep across the sun's ±0.27°, is one half. The shadow reaches
// 1,143 m within one texel when every point up to 1,143.005 − 32 m reads under one half and every point from 1,143.005
// + 32 m reads one half or more. So that a uniform grey can't pass, it is a shadow: the crest stands over 0.27° plus a
// texel's change above the sun up to 1,000 m (5.71° there), so those points read at most 0.05, and that far below it
// past 1,300 m (4.40°), so those read at least 0.95.
//
// Catches: the base (no `horizon` on a plate, no zero-range cascades, no readings); a plate whose far ground has no
// horizon shadow; a trace that stops short of the crest or a min-max pyramid that overstates it; a horizon fetched away
// from the sun; a visibility that isn't centred on the sun's elevation.
import { describe, expect, it } from 'vitest';
import {
  AC, CREST_X, LEE_FOOT, REACH, RIDGE_TEXEL, SMALL, PLAIN, framesOf, groundPoints, groundRows, requireMetal, ridgeDoc, runGpu, useGpu, useOut,
  writeJson, type Xz,
} from './helpers.ts';

const ID = AC[1];
const NAME = `AC1 ${ID}`;
const bin = useGpu();
const out = useOut();
const LINE_Z = -256;
/** Distances east of the crest, 400 m to 2,000 m every 4 m. */
const D = Array.from({ length: 401 }, (_, k) => LEE_FOOT + 4 * k);
const POINTS: Xz[] = D.map((d) => [CREST_X + d, LINE_Z]);

describe(`${NAME} a straight ridge's shadow under a low sun`, () => {
  it(`${NAME} a 100 m ridge under a 5° sun casts a shadow reaching 1,143 m from the crest, within one horizon texel (32 m)`, () => {
    requireMetal();
    const what = 'the ridge under a 5° sun, cascades at zero range';
    const doc = writeJson(out(), 'ridge', ridgeDoc({ size: SMALL, sun: { still: 5 }, view: 'far' }));
    const [reply] = runGpu(bin(), out(), [{ call: 'view3d', doc, look: PLAIN, size: [...SMALL], frames: 1, ground_points: groundPoints(POINTS) }]);
    const [frame] = framesOf(reply!, 1, what);
    const rows = groundRows(frame!, POINTS, what);

    const reach = D.find((_, k) => rows[k]!.sun >= 0.5) ?? null;
    console.log(`${ID}: the shadow's reach from the crest along z = ${LINE_Z}: ${reach === null ? 'past 2,000 m' : `${reach} m`} (closed form ${REACH.toFixed(3)} m, texel ${RIDGE_TEXEL} m)`);
    const wrong: string[] = [];
    D.forEach((d, k) => {
      const v = rows[k]!.sun;
      const at = `the point ${d} m east of the crest (${POINTS[k]![0]}, ${LINE_Z}) reads sun_visibility ${v.toFixed(3)}`;
      if (d <= REACH - RIDGE_TEXEL && v >= 0.5) wrong.push(`${at}: lit, though the shadow reaches ${REACH.toFixed(1)} m`);
      if (d >= REACH + RIDGE_TEXEL && v < 0.5) wrong.push(`${at}: in shadow, past the shadow's reach of ${REACH.toFixed(1)} m`);
      if (d <= 1000 && v > 0.05) wrong.push(`${at}: not in full shadow, though the crest stands ${(Math.atan(100 / d) * 180 / Math.PI).toFixed(2)}° there`);
      if (d >= 1300 && v < 0.95) wrong.push(`${at}: not fully lit, though the crest stands ${(Math.atan(100 / d) * 180 / Math.PI).toFixed(2)}° there`);
    });
    expect(wrong, `${what}: the shadow reaches ${REACH.toFixed(3)} m from the crest within one texel (${RIDGE_TEXEL} m); ${wrong.length} points disagree`).toEqual([]);
    expect(reach, 'the shadow ends within the line').not.toBeNull();
    expect(Math.abs(reach! - REACH), `the shadow's reach, ${reach} m, is within one horizon texel of ${REACH.toFixed(3)} m`).toBeLessThanOrEqual(RIDGE_TEXEL);
  }, 3_600_000);
});
