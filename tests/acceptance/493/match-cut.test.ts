// AC18 #493.e1213b8a: A cut with match {from: ball, to: sun}, where the ball's projected centre on the outgoing shot's
// last frame is 427 px right of and 164 px above the centre of a 1920×1080 frame with a 61 px radius, puts the sun's
// projected centre within 0.5 px of that point and its radius within 1% on the incoming shot's first frame; a planted
// framer that fits the sun by its keep at place [0.5, 0.5] misses by more than 450 px and fails, naming the transition.
//
// Through `deep-motion eval` with `project`. Shot `a` [0, 2 s) holds a level pose 10 m from its target with fov 40°;
// the ball, a box, sits on the target plane where it projects 427 px right of and 164 px above the frame's centre with
// a half-height of about 61 px (the radius is read as half the projected box's height). Shot `b` [2 s, 4 s) keeps the
// sun; transition `cut1` is `{kind: "cut", match: {from: "ball", to: "sun"}}`. The plant is `match_framer_ignores_match`.
import { describe, expect, it } from 'vitest';
import {
  AC, F60, TIMEOUT, box3d, camera3d, evalOk, evalPlanted, failsNaming, film, fl, heightOf, none, projOf, shot, useMotion, type Accepted,
} from './helpers.ts';

const motion = useMotion();
const FOCAL = 960 / Math.tan((20 * Math.PI) / 180);
const BALL: [number, number, number] = [(427 * 10) / FOCAL, (164 * 10) / FOCAL, 0];
const DOC = film('match', [camera3d(), box3d('ball', BALL, (2 * 61 * 10) / FOCAL), box3d('sun', [-200, 80, -900], 50, 'ink'), box3d('ground', [0, -2, 0], [20, 0.1, 20], 'muted')], {
  shots: {
    a: shot(0, 2, { target: [0, 0, 0], orbit: { azimuth: 0, elevation: 0, distance: 10 } }),
    b: shot(2, 4, { frame: { keep: ['sun'] } }),
  },
  transitions: { cut1: { from: 'a', to: 'b', kind: 'cut', match: { from: 'ball', to: 'sun' } } },
});
const TIMES = [fl(2) - F60, fl(2)];

function matchFailures(a: Accepted): { failures: string[]; miss: number } {
  const ball = projOf(a.frames[0]!, 'ball', 'the outgoing last frame'); const sun = projOf(a.frames[1]!, 'sun', 'the incoming first frame');
  const miss = Math.hypot(sun.center[0] - ball.center[0], sun.center[1] - ball.center[1]);
  const ratio = heightOf(sun) / heightOf(ball);
  const failures: string[] = [];
  if (!(miss <= 0.5)) failures.push(`transition cut1: the sun's centre lands ${miss.toFixed(2)} px from the ball's (${ball.center.map((v) => v.toFixed(2)).join(', ')})`);
  if (!(Math.abs(ratio - 1) <= 0.01)) failures.push(`transition cut1: the sun's radius is ${ratio.toFixed(4)} times the ball's`);
  return { failures, miss };
}

describe(`${AC[18]} a match cut frames the incoming item where the outgoing one was`, () => {
  it(`${AC[18]} the cut with match {from: ball, to: sun} puts the sun's projected centre within 0.5 px of the ball's and its radius within 1% on the incoming shot's first frame`, () => {
    const a = evalOk(motion.bin(), { doc: DOC, times: TIMES, project: ['ball', 'sun'] }, 'the match cut');
    const ball = projOf(a.frames[0]!, 'ball', 'the outgoing last frame');
    expect(Math.abs(ball.center[0] - (960 + 427)) <= 1 && Math.abs(ball.center[1] - (540 - 164)) <= 1, `the ball projects 427 px right of and 164 px above the centre: ${ball.center}`).toBe(true);
    expect(Math.abs(heightOf(ball) / 2 - 61), `the ball's radius is about 61 px: ${heightOf(ball) / 2}`).toBeLessThanOrEqual(3);
    none(matchFailures(a).failures, 'the match cut');
  }, TIMEOUT);

  it(`${AC[18]} a planted framer that fits the sun by its keep at place [0.5, 0.5] misses by more than 450 px and fails, naming the transition`, () => {
    const r = matchFailures(evalPlanted(motion.bin(), { doc: DOC, times: TIMES, project: ['ball', 'sun'], planted: 'match_framer_ignores_match' }, 'the planted framer'));
    expect(r.miss, 'the plant misses by more than 450 px').toBeGreaterThan(450);
    failsNaming(r.failures, ['transition cut1'], 'the match check on the plant');
  }, TIMEOUT);
});
