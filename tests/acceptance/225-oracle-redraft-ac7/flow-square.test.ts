// AC7 #225.57b5ccba: "A flow of a unit square along the vector field (−y, x) for time π/2 ends rotated 90° within 0.5
// px, at 24 and 60 fps alike"
//
// The #225 Oracle lane, criterion 7: the upstream test the Oracle page pins for it (commit cfd33af5aa, the motion
// tests' lines 207–229; use: port), run against our output (#136: a linked test counts only when run against our
// output). No upstream code runs here and none is copied.
//
// Upstream, and ours:
//   - Upstream carries a point along the field (−y, x) for a field time of 2π played over its run time, records the
//     scene at 10 fps and again at 60 fps, and asserts the point lands on the field's exact flow, the turn by that
//     time, within 1e-4 at both rates: a flow is its field's flow, whatever the frame rate.
//   - Ours: a `vector_field@1` item `swirl` with `fn: {x: "-y", y: "x"}` and `streams`, and a group whose warp flows
//     along its stream table (#223's `params.warp.flow: {streams: "swirl", time}`), holding the unit square through
//     the plane's (1, 0), (2, 0), (2, 1), (1, 1). The flow's time is keyed from 0 at 0 s to π/2 at 1 s, the field time
//     played over the run time as upstream's is. The film is played at 24 fps and again at 60 fps (its transport's
//     frame rate, confirmed by the export plan): deep-show's `path` draws the square at every frame from 0 to 1 s, in
//     order. At 1 s the square must lie within the criterion's 0.5 px of the square rotated 90° counterclockwise about
//     the plane's origin, (0, 1), (0, 2), (−1, 2), (−1, 1), both ways, at both rates. The rates and the bound are the
//     criterion's; upstream's 1e-4 in its own units is tighter, and the 0.5 px is ours to keep.
//
// Wrong programs, each failing the one judge (`judgeEnd`):
//   - The base: no `vector_field@1` (the film is refused or its field skipped) and no stream table for the flow.
//   - A flow that integrates between frames, one Euler step a frame (planted in test code, `eulerPerFrame`): its square
//     ends 11.78 u off at 24 fps and 4.64 u off at 60 fps (worked out by hand in the README), so it fails at each rate,
//     and the two rates disagree.
//   - A field read the other way round, so the flow turns clockwise (planted as a fixture, `fn: {x: "y", y: "-x"}`,
//     run through the binary): the square ends about 200 u from where it should, at both rates.
//   - A flow that never runs, or ignores the keyed time (its authored time is 0): the square ends where it started.
import { describe, expect, it } from 'vitest';
import {
  AC7, RATES, SQUARE, SWIRL, TIMEOUT, TOL, carried, eulerPerFrame, failsNaming, judgeEnd, lastDrawn, none, notPlayed, outline, play, rk4, stray, turn,
  useFolders, useShow, type Played,
} from './helpers.ts';

const bin = useShow();
const folder = useFolders();

describe(`${AC7} a unit square flowed along (−y, x) for π/2 ends rotated 90°, at 24 and 60 fps alike`, () => {
  it(`${AC7} the judge passes the field's exact flow and the design's RK4 at step 0.05, and fails the planted twins`, () => {
    for (const fps of RATES) {
      none(judgeEnd(fps, carried((q) => turn(q, Math.PI / 2))), `${fps} fps: the exact flow, the turn by π/2, passes`);
      none(judgeEnd(fps, carried((q) => rk4(q, Math.PI / 2, 0.05))), `${fps} fps: RK4 at the stream table's step 0.05 passes`);
      failsNaming(judgeEnd(fps, [outline(SQUARE)]), [`${fps} fps`, 'rotated 90°'], `${fps} fps: a flow that never runs (the square where it started)`);
    }
    // One Euler step a frame: each step scales a point's radius by √(1 + h²), h = (π/2) ÷ frames, so the corner
    // (2, 1), at √5 from the origin, ends 100 × √5 × ((1 + h²)^(n/2) − 1) u out, plus a small lag (README).
    const off = { 24: 11.78, 60: 4.64 } as const;
    for (const fps of RATES) {
      const euler = carried((q) => eulerPerFrame(q, fps));
      expect(stray(euler), `${fps} fps: the planted per-frame Euler square strays as worked out by hand`).toBeCloseTo(off[fps], 1);
      expect(stray(euler), `${fps} fps: the planted twin is far past the bound`).toBeGreaterThan(4 * TOL);
      failsNaming(judgeEnd(fps, euler), [`${fps} fps`, 'rotated 90°'], `${fps} fps: the planted flow that takes one Euler step a frame`);
    }
  }, TIMEOUT);

  it(`${AC7} played at 24 fps and at 60 fps, the square carried by the vector field's flow ends within 0.5 px of the square rotated 90°`, () => {
    const played: Played[] = RATES.map((fps) => play(bin(), folder(), fps, SWIRL));
    for (const p of played) none(notPlayed(p), `${p.fps} fps: the film is presented at its own rate and the square drawn at every frame`);
    const failures = played.flatMap((p) => judgeEnd(p.fps, lastDrawn(p)));
    none(failures, 'the square ends rotated 90° within 0.5 px at 24 and 60 fps alike');
  }, TIMEOUT);

  it(`${AC7} a planted twin, the field written clockwise as (y, −x), turns the square the other way, and the judge fails at both rates`, () => {
    const clockwise = { x: 'y', y: '-x' };
    for (const fps of RATES) {
      const p = play(bin(), folder(), fps, clockwise);
      // The twin is a well-formed film: it is presented and drawn, so only the geometry can fail it.
      none(notPlayed(p), `${fps} fps: the clockwise twin is presented and drawn at every frame`);
      const drawn = lastDrawn(p);
      expect(stray(drawn), `${fps} fps: the clockwise twin ends far from the square rotated 90° (the fault is live)`).toBeGreaterThan(100);
      failsNaming(judgeEnd(fps, drawn), [`${fps} fps`, 'rotated 90°'], `${fps} fps: the judge on the clockwise twin`);
    }
  }, TIMEOUT);
});
