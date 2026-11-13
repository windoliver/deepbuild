// #2293.8649cfa0: In the rally at 0.5 s, `deep_show` with `include: ['pixels']` answers a `visible` row for `ball` whose
// box is the one the same scene draws when the ball's `at` is authored at the pose `eval` reads for `items/ball/at` at
// 0.5 s.
//
// One run shows the rally (its world's output binds the ball's pose to items/ball/at; the ball's item has no `at`) with
// its pixels at 0.5 s and reads `eval`'s pose at `items/ball/at` (its `pos`, `rot` and `scale`) at the same frame. A second run shows the same scene with that
// output left out and the ball's `at` authored at the pose the first run read, then with no `at` at all (the ball's
// authored place, the origin), each with its pixels at 0.5 s. The rally's ball box must equal the first of those
// (README: Tolerances); the second only proves the comparison draws somewhere else than the origin.
import { describe, expect, it } from 'vitest';
import {
  BALL_AT, CRITERIA, DOC, FRAME_AT_T, T, TIMEOUT, centre2, drawnHere, evalCall, fmt, pixelsCall, prebuildShow, rally, runShow, scenario,
  showBin, useTemp, valuesOf, vec, visibleBox, type JsonObject,
} from './helpers.ts';

prebuildShow(['full']);

const ID = CRITERIA[1];
const temp = useTemp();
/**
 * The pose at items/ball/at, read field by field: `eval` reads `items/<id>/at/<field>` from the evaluated transform, and
 * at the base answers null for the bare `items/ball/at` (README: Readings where the issue leaves a choice).
 */
const POSE = ['pos', 'rot', 'scale'] as const;
/** Half a pixel: the same item at the same pose draws the same box up to rounding (README: Tolerances). */
const BOX_TOL_PX = 0.5;
/** The comparison is meaningful only if the pose eval reads draws the ball well away from its authored place. */
const APART_PX = 10;

describe(`${ID} the rally's 3D frame at 0.5 s draws the ball where eval puts it`, () => {
  it(`${ID} deep_show with include: ['pixels'] at 0.5 s answers a visible row for ball whose box is the one the scene draws with the ball's at authored at eval's pose for items/ball/at`, () => {
    const bin = showBin('full');

    const a = DOC(1);
    const paths = POSE.map((f) => `${BALL_AT}/${f}`);
    const [frame, read] = runShow(bin, scenario(temp(), [a], [pixelsCall(a, rally({ output: true }), T), evalCall(a, FRAME_AT_T, paths)]), 'the rally at 0.5 s');
    const drawn = visibleBox(drawnHere(frame, 'the rally\'s frame at 0.5 s'), 'ball', 'the rally\'s frame at 0.5 s');
    const values = valuesOf(read, 'eval of the rally at 0.5 s');
    const pose: JsonObject = Object.fromEntries(POSE.map((f, i) => [f, vec(values[paths[i]!], 3, `eval's ${paths[i]} at 0.5 s`)]));
    const pos = pose['pos'] as number[];
    expect(Math.hypot(...pos), `eval reads the kicked ball away from its authored place (the origin) at 0.5 s: ${fmt(pos)}`).toBeGreaterThan(1);

    const b = DOC(2);
    const [moved, unmoved] = runShow(bin, scenario(temp(), [b], [
      pixelsCall(b, rally({ output: false, ballAt: pose }), T),
      pixelsCall(b, rally({ output: false }), T),
    ]), 'the rally with the ball authored at eval\'s pose, then at the origin');
    const want = visibleBox(drawnHere(moved, 'the ball authored at eval\'s pose, at 0.5 s'), 'ball', 'the ball authored at eval\'s pose, at 0.5 s');
    const origin = visibleBox(drawnHere(unmoved, 'the ball authored at the origin, at 0.5 s'), 'ball', 'the ball authored at the origin, at 0.5 s');
    const [cw, co] = [centre2(want), centre2(origin)];
    expect(Math.hypot(cw[0] - co[0], cw[1] - co[1]), `the ball authored at eval's pose ${JSON.stringify(pose)} draws at ${fmt(want)}, away from its box authored at the origin, ${fmt(origin)}`).toBeGreaterThan(APART_PX);

    const gap = Math.max(...drawn.map((x, i) => Math.abs(x - want[i]!)));
    expect(gap, `the rally's frame at 0.5 s draws ball at ${fmt(drawn)} (centre ${fmt(centre2(drawn))} px); authored at eval's pose (pos ${fmt(pos)} m) the same scene draws it at ${fmt(want)} (centre ${fmt(cw)} px); authored at the origin, at ${fmt(origin)} (centre ${fmt(co)} px)`).toBeLessThanOrEqual(BOX_TOL_PX);
  }, TIMEOUT);
});
