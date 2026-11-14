// AC2 #223.48c2501c (Oracle lane): the plane reads a point as x + iy with y up. Ported from an upstream animation
// library, pinned at `a6d5cc02b4`: tests/test_graphical_units/test_transform.py, lines 109–117, test_ApplyComplexFunction,
// with its control frames control_data/transform/ApplyComplexFunction.npz (README: Sources). No upstream code is copied.
//
// The upstream test maps a square of side 2 by z + 2i over an animation and compares every frame with its control
// frames, in which the square rises on screen. Ours: the square through the plane's (±1, ±1), drawn as a path
// back to its start, under group `g` warped by `complex {f: "z + vec2(0, 2)"}` on the plane of origin (400, 300) u,
// unit 100 u, y up, its mix keyed linearly from 0 to 1 over 1 s (the animation's progress). Read through
// `deep-canvas-render path` at progress 0, 0.25, 0.5, 0.75 and 1: every corner has risen by 2 × progress plane units,
// 200 × progress u up the screen, within 1e-6 u.
// The planted fault: the same film on a plane read y down, where the square sinks 200 × progress u (read, so the fault
// is shown live); the port fails on it.
// The frame comparison itself needs the control frames rendered by the upstream library, outside the repo: BLOCKED.
import { describe, expect, it } from 'vitest';
import {
  AC, PLANE, TIMEOUT, blocked, dist, expectClean, figure, fl, keyed, none, pathAll, pathItem, planeJson, short, toScreen, useBins, vertices,
  warpGroup, type JsonObject, type PathFrame, type Pt,
} from './helpers.ts';

const bin = useBins(['render']);
const PROGRESS = [0, 0.25, 0.5, 0.75, 1];
const CORNERS: Pt[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const square = CORNERS.map((q) => toScreen(PLANE, q));
const film = (y: 'up' | 'down'): JsonObject => figure(`warp-oracle-rise-${y}`, [800, 600], [
  warpGroup('g', { complex: { f: 'z + vec2(0, 2)' }, mix: 0, plane: planeJson({ ...PLANE, y }) }),
  pathItem('square', 'a1', `M ${[...square, square[0]!].map((p) => p.join(' ')).join(' L ')}`, 2, {}, { parent: 'g' }),
], { transport: { span: '2s' }, channels: { mix: keyed('items/g/params/warp/mix', [[0, 0], [1, 1]]) } });

/** The port's judge: at each progress every corner has moved 200 × progress u up the screen (`way` −1) or down it (+1). */
function judgeMove(frames: PathFrame[], way: -1 | 1): string[] {
  const failures: string[] = [];
  frames.forEach((f, k) => {
    const p = PROGRESS[k]!;
    const drawn = f.subpaths[0] ? vertices(f.subpaths[0]) : [];
    square.forEach((c, i) => {
      const want: Pt = [c[0], c[1] + way * 200 * p];
      const got = drawn[i];
      if (!got || dist(got, want) > 1e-6) failures.push(`at progress ${p}, corner ${i} is at (${got ? got.map(short).join(', ') : 'nowhere'}), not ${way < 0 ? 'risen' : 'sunk'} to (${want.map(short).join(', ')})`);
    });
  });
  return failures;
}

describe(`${AC[2]} (Oracle) a square mapped by z + 2i rises on screen`, () => {
  it(`${AC[2]} test_ApplyComplexFunction: under z + 2i the square rises 2 plane units on screen as its mix runs from 0 to 1`, () => {
    expectClean(bin('render'), film('up'), 'the square under z + 2i');
    const frames = pathAll(bin('render'), [{ doc: film('up'), item: 'square', times: PROGRESS.map(fl) }], 'the square under z + 2i')[0]!;
    none(judgeMove(frames, -1), 'the square rises as the plane reads y up');
  }, TIMEOUT);

  it(`${AC[2]} the port fails on the planted fault, the plane read y down`, () => {
    const frames = pathAll(bin('render'), [{ doc: film('down'), item: 'square', times: PROGRESS.map(fl) }], 'the square on a plane read y down')[0]!;
    none(judgeMove(frames, 1), 'on a plane read y down the warp moves the square down the screen (the fault is live)');
    expect(judgeMove(frames, -1).length, 'the port fails on the square that sinks').toBeGreaterThan(0);
  }, TIMEOUT);

  it(`${AC[2]} test_ApplyComplexFunction's frames against its control frames`, () => {
    blocked('the control frames (ApplyComplexFunction.npz) are the upstream library\'s own renders; comparing ours with them needs the pinned test rendered once outside the repo and its frames stored as goldens beside our fixture\'s',
      'render the pinned graphical test once outside the repo and store its frames, with our fixture\'s matching frames, as goldens (the issue\'s Proof line).');
  }, TIMEOUT);
});
