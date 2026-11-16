// AC7 #225.57b5ccba: "A flow of a unit square along the vector field (−y, x) for time π/2 ends rotated 90° within 0.5 px,
// at 24 and 60 fps alike"
//
// The film (640 × 480, 1 s, frame_rate 24/1 or 60/1): `swirl`, a vector_field@1 with `fn: {x: "-y", y: "x"}` and
// `streams: {starts: {points: [[1, 0, 0]]}, step: 0.05, time: 2}`, which builds its stream table in `streams@1` at
// check; group `g` on the plane of origin (320, 240) u, unit 100 u, y up, warped by the identity `linear` at mix 1 with
// `flow: {streams: "swirl", time: π/2}` (#223's spelling); its child `square`, the path through the plane's (1, 0),
// (2, 0), (2, 1), (1, 1) and back to (1, 0). So the field (−y, x) is read in the warp's plane, a turn
// counterclockwise there.
// At each frame rate the film is played in one session, every frame from 0 to 1 s evaluated, then deep-show's `path`
// (#223) reads the square at 0.5 s and at 1 s: one drawn sub-path, within 0.5 u of the unit square turned 90° about the
// plane's origin, (0, 1), (0, 2), (−1, 2), (−1, 1), both ways (every drawn point near the turned outline, every point of
// the outline near the drawing). At zoom 1 a u is a px.
// The judge must be able to fail: on the same film with no `flow` on the group, the square drawn where it was written,
// it fails, naming the square.
// Wrong programs: the base (no vector_field@1, so no table to flow along); a flow stepped per frame (24 and 60 fps
// part); a field read y down (the square turns clockwise, to (0, −1)…); a flow by Euler (the square drifts 4% out,
// about 9 u at its far corner).
import { describe, it } from 'vitest';
import {
  AC, SWIRL, TIMEOUT, bothWays, evalAt, failsNaming, field, film, fl, flowGroup, frameTimes, none, pathCall, pathItem, present, presented, run, scenario,
  subpathsOf, toScreen, useBins, useFolders, type JsonObject, type Plane, type Pt,
} from './helpers.ts';

const bin = useBins(['show']);
const folder = useFolders();
const PLANE: Plane = { origin: [320, 240], unit: 100 };
const SQUARE: Pt[] = [[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]];
const TURNED: Pt[] = [[0, 1], [0, 2], [-1, 2], [-1, 1], [0, 1]].map((q) => toScreen(PLANE, q as Pt));

function squareFilm(fps: number, flow: boolean): JsonObject {
  return film('a square carried by the flow', [640, 480], [
    field('swirl', 'a0', { fn: SWIRL, streams: { starts: { points: [[1, 0, 0]] }, step: 0.05, time: 2 } }),
    flowGroup('g', 'a1', PLANE, 'swirl', flow ? Math.PI / 2 : null),
    pathItem('square', 'a2', `M ${SQUARE.map((q) => toScreen(PLANE, q).join(' ')).join(' L ')}`, { parent: 'g' }),
  ], { transport: { span: '1s', frame_rate: `${fps}/1` } });
}
/** Plays the film at `fps` and judges the square at 0.5 s and 1 s; each failure names the square, the rate and the time. */
function judgePlay(fps: number, flow: boolean): string[] {
  const replies = run(bin('show'), scenario(folder(), [present(squareFilm(fps, flow)), ...frameTimes(fps, 1).map((t) => evalAt(t)), pathCall('square', fl(0.5)), pathCall('square', fl(1))]));
  presented(replies[0]!, `the square film at ${fps} fps`);
  return [0.5, 1].flatMap((s, k) => {
    const what = `the square at ${fps} fps, ${s} s`;
    const drawn = subpathsOf(replies[replies.length - 2 + k]!, what);
    if (drawn.length !== 1) return [`${what}: ${drawn.length} sub-paths drawn, not 1`];
    return bothWays(drawn[0]!, TURNED, 0.5, what);
  });
}

describe(`${AC[7]} a flow along the field (−y, x) turns a unit square 90° in π/2`, () => {
  it(`${AC[7]} a flow of a unit square along the vector field (−y, x) for time π/2 ends rotated 90° within 0.5 px, at 24 and 60 fps alike`, () => {
    none([...judgePlay(24, true), ...judgePlay(60, true)], 'the square carried by the flow');
    failsNaming(judgePlay(24, false), ['the square at 24 fps'], 'the judge on the same film with no flow');
  }, TIMEOUT);
});
