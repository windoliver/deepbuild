// #2293.9d1c0f9e: The `bounds` mode of the rally at 0.5 s answers the ball's bounds centred on the position `eval` reads
// for `items/ball/at/pos` at 0.5 s.
//
// One run shows the rally (its world's output binds the ball's pose to items/ball/at; the ball's item has no `at`), reads
// `eval`'s `items/ball/at/pos` at 0.5 s, then asks for the `bounds` mode of that revision at 0.5 s. The ball's one row in
// the mode's `drawn` must have its box's centre, (min + max) / 2, at the position eval read (README: Tolerances).
import { describe, expect, it } from 'vitest';
import {
  BALL_POS, CRITERIA, DOC, FRAME_AT_T, T, TIMEOUT, arr, drawnHere, evalCall, fmt, modeCall, obj, prebuildShow, presented, rally, runShow,
  scenario, show, showBin, showCall, useTemp, valuesOf, vec, type JsonValue,
} from './helpers.ts';

prebuildShow(['full']);

const ID = CRITERIA[2];
const temp = useTemp();
/** A millimetre: the same pose read twice, in f32, agrees far closer; the authored place is metres away (README: Tolerances). */
const POS_TOL_M = 1e-3;

describe(`${ID} the rally's bounds mode at 0.5 s reads the ball where eval puts it`, () => {
  it(`${ID} the bounds mode at 0.5 s answers the ball's bounds centred on eval's items/ball/at/pos at 0.5 s`, () => {
    const d = DOC(3);
    const [shown, read, mode] = runShow(showBin('full'), scenario(temp(), [d], [
      showCall(d, rally({ output: true })),
      evalCall(d, FRAME_AT_T, [BALL_POS]),
      modeCall(d, 'bounds', T),
    ]), 'the rally\'s bounds at 0.5 s');
    presented(shown, 'the rally');
    const pos = vec(valuesOf(read, 'eval of the rally at 0.5 s')[BALL_POS], 3, `eval's ${BALL_POS} at 0.5 s`);
    expect(Math.hypot(...pos), `eval reads the kicked ball away from its authored place (the origin) at 0.5 s: ${fmt(pos)}`).toBeGreaterThan(1);

    const reply = drawnHere(mode, 'the bounds mode at 0.5 s');
    const rows = arr(reply['drawn'], 'the bounds mode: drawn').map((r, i) => obj(r, `the bounds mode: drawn[${i}]`));
    const ball = rows.filter((r) => r['id'] === 'ball');
    expect(ball.length, `the bounds mode draws one box for ball; it drew ${show(rows as JsonValue)}`).toBe(1);
    const min = vec(ball[0]!['min'], 3, 'the ball\'s bounds: min');
    const max = vec(ball[0]!['max'], 3, 'the ball\'s bounds: max');
    const centre = min.map((m, i) => (m + max[i]!) / 2);
    const gap = Math.max(...centre.map((c, i) => Math.abs(c - pos[i]!)));
    expect(gap, `the bounds mode at 0.5 s draws the ball's bounds from ${fmt(min)} to ${fmt(max)} m, centred at ${fmt(centre)}; eval reads ${BALL_POS} at ${fmt(pos)} m`).toBeLessThanOrEqual(POS_TOL_M);
  }, TIMEOUT);
});
