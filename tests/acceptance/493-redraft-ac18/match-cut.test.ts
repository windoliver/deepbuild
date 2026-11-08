// AC18 #493.e1213b8a: A cut with match {from: ball, to: sun}, where the ball's projected centre on the outgoing shot's last
// frame is 427 px right of and 164 px above the centre of a 1920×1080 frame with a 61 px radius, puts the sun's projected
// centre within 0.5 px of that point and its radius within 1% on the incoming shot's first frame; a planted framer that
// fits the sun by its keep at place [0.5, 0.5] misses by more than 450 px and fails, naming the transition.
//
// Through `deep-motion eval` with `project` and the plant `match_framer_ignores_match` (README: The surface under test,
// Planted programs). The ball and the sun are boxes (`mark.box@1`); an item's projected centre is `projected.<id>.center`
// and its radius half its projected box's height. The outgoing shot `out` holds an explicit pose, the eye 10 m in front of
// the target on +Z (azimuth 0, elevation 0), fov 40° across the 1920 px side; the ball is placed in closed form so its
// centre projects to (960 + 427, 540 − 164) px and its size found by bisection so its radius is 61 px, and the test first
// reads both back through the binary. The incoming shot `in` keeps the sun on the same camera at the same angles, so a
// framing that matches centre and size draws the sun exactly as the ball was drawn. Frames are 60 fps: the outgoing
// shot's last is 2 s − 1/60 s, the incoming shot's first is 2 s. A frame centred on the sun at [0.5, 0.5] of the safe frame
// (its centre, (960, 540)) is √(427² + 164²) = 457.4 px from the ball's point.
// No upstream test (oracle page: only criterion 11 is mapped).
import { describe, expect, it } from 'vitest';
import {
  AC, F60, TIMEOUT, box3d, camera3d, evalOk, evalPlanted, failsNaming, film, heightOf, none, projOf, rad, shot, useMotion,
  type Accepted, type JsonObject, type V3,
} from './helpers.ts';

const motion = useMotion();

const W = 1920; const H = 1080;
/** Where the ball's centre must project: 427 px right of and 164 px above the frame's centre. */
const POINT: [number, number] = [W / 2 + 427, H / 2 - 164];
const RADIUS = 61;
const EYE: V3 = [0, 0, 10];
/** The focal length in px: fov 40° across the wider side (Camera camera@1; Projector). */
const FOCAL = (W / 2) / Math.tan(rad(40) / 2);

/** A point seen from EYE looking down −Z (right +X, up +Y), in px. */
const projectPx = (p: V3): [number, number] => {
  const z = EYE[2] - p[2];
  return [W / 2 + (p[0] - EYE[0]) * FOCAL / z, H / 2 - (p[1] - EYE[1]) * FOCAL / z];
};
/** Half the height of the box of a cube's eight projected corners. */
function halfHeight(centre: V3, size: number): number {
  let lo = Infinity; let hi = -Infinity;
  for (let i = 0; i < 8; i++) {
    const c: V3 = [centre[0] + (i & 1 ? 0.5 : -0.5) * size, centre[1] + (i & 2 ? 0.5 : -0.5) * size, centre[2] + (i & 4 ? 0.5 : -0.5) * size];
    const y = projectPx(c)[1]; lo = Math.min(lo, y); hi = Math.max(hi, y);
  }
  return (hi - lo) / 2;
}
/** The ball: at depth 10 m on the line through POINT, sized by bisection so its radius is 61 px. */
const BALL_AT: V3 = [(POINT[0] - W / 2) * 10 / FOCAL, (H / 2 - POINT[1]) * 10 / FOCAL, 0];
const BALL_SIZE = ((): number => {
  let lo = 1e-3; let hi = 2;
  for (let k = 0; k < 200; k++) { const mid = (lo + hi) / 2; if (halfHeight(BALL_AT, mid) < RADIUS) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
})();

const OUT_LAST = 119 * F60;
const IN_FIRST = 120 * F60;

/** The film: `out` holds on the ball, `in` keeps the sun, joined at 2 s by the cut `cut1` matching ball to sun. */
function matchFilm(): JsonObject {
  return film('match-cut', [
    camera3d({ orbit: { azimuth: 0, elevation: 0, distance: 10 } }),
    box3d('ball', BALL_AT, BALL_SIZE),
    box3d('sun', [30, -8, -250], 20),
  ], {
    shots: {
      out: shot(0, 2, { target: [0, 0, 0], orbit: { azimuth: 0, elevation: 0, distance: 10 } }),
      in: shot(2, 4, { frame: { keep: ['sun'] } }),
    },
    transitions: { cut1: { from: 'out', to: 'in', kind: 'cut', match: { from: 'ball', to: 'sun' } } },
  }, { span: '4s', frame_rate: '60/1' }, [W, H]);
}
const LINE = { times: [OUT_LAST, IN_FIRST], project: ['ball', 'sun'] };

/** The match check: the sun on the incoming first frame against the ball on the outgoing last frame. Failures name the
 * transition; the miss is the distance between the two centres in px. */
function matchCheck(a: Accepted, what: string): { failures: string[]; miss: number } {
  const ball = projOf(a.frames[0]!, 'ball', what);
  const sun = projOf(a.frames[1]!, 'sun', what);
  const rBall = heightOf(ball) / 2; const rSun = heightOf(sun) / 2;
  const miss = Math.hypot(sun.center[0] - ball.center[0], sun.center[1] - ball.center[1]);
  const failures: string[] = [];
  if (!(miss <= 0.5)) failures.push(`transition cut1: the sun's centre (${sun.center.join(', ')}) px on the incoming first frame is ${miss} px from the ball's (${ball.center.join(', ')}) px`);
  const ratio = rSun / rBall;
  if (!(Math.abs(ratio - 1) <= 0.01)) failures.push(`transition cut1: the sun's radius ${rSun} px is ${ratio} × the ball's ${rBall} px`);
  return { failures, miss };
}

describe('AC18: a match cut solves the incoming framing onto the outgoing item', () => {
  it(`${AC[18]} the sun's centre within 0.5 px of the ball's point and its radius within 1% on the incoming first frame`, () => {
    const a = evalOk(motion.bin(), { doc: matchFilm(), ...LINE }, 'the match cut');
    // The scene is the criterion's: the ball 427 px right of and 164 px above the centre, radius 61 px.
    const ball = projOf(a.frames[0]!, 'ball', 'the match cut');
    expect(Math.hypot(ball.center[0] - POINT[0], ball.center[1] - POINT[1]), `the ball's centre on the outgoing last frame is at (${POINT.join(', ')}) px, got (${ball.center.join(', ')})`).toBeLessThanOrEqual(0.05);
    expect(Math.abs(heightOf(ball) / 2 / RADIUS - 1), `the ball's radius on the outgoing last frame is 61 px, got ${heightOf(ball) / 2}`).toBeLessThanOrEqual(1e-3);
    none(matchCheck(a, 'the match cut').failures, 'the match cut');
  }, TIMEOUT);

  it(`${AC[18]} a planted framer that fits the sun by its keep at [0.5, 0.5] misses by more than 450 px and fails, naming the transition`, () => {
    const a = evalPlanted(motion.bin(), { doc: matchFilm(), ...LINE, planted: 'match_framer_ignores_match' }, 'the planted framer');
    const { failures, miss } = matchCheck(a, 'the planted framer');
    expect(miss, `the planted framer misses the ball's point by more than 450 px, got ${miss}`).toBeGreaterThan(450);
    failsNaming(failures, ['transition cut1'], 'the planted framer');
  }, TIMEOUT);
});
