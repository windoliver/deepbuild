// AC5 #224.54b3f7df: "A curve@1 `fn` helix of 5 turns stays within 0.001 m of the true helix at 1,000 seeded s and uses
// at most 4,096 points"
//
// `helix`, a curve@1 with `fn: {x: cos s, y: sin s, z: 0.1 s, over: [0, 10π], tolerance: 0.001}` (radius 1 m, 0.2π m a
// turn, 5 turns) and `mode: linear`, so the curve tube, mark.curve and follow_path read is the polyline through its
// points. `geometry`'s curve row answers the points the formula built (`points`, README: The surface under test).
//   - At most 4,096 points, and at least two; the first at P(0) and the last at P(10π), each within 0.001 m.
//   - At 1,000 s drawn by mulberry32 seeded 224 over [0, 10π], the true point P(s) = (cos s, sin s, 0.1 s) lies within
//     0.001 m of the polyline (its nearest segment; the turns are 0.63 m apart, so the nearest is its own).
// Fails: no `fn` on curve@1; samples too coarse for the tolerance; more than 4,096 points; a curve cut short.
import { describe, expect, it } from 'vitest';
import { AC, DOC, PI, TIMEOUT, admitted, ask, dist, geometry, meshOf, none, present, sceneDoc, seeded, toSegment, useBins, type V3 } from './helpers.ts';

useBins();
const ID = AC[5];
const END = 10 * PI;
const P = (s: number): V3 => [Math.cos(s), Math.sin(s), 0.1 * s];

describe(`${ID} a helix from a formula over s`, () => {
  it(`${ID} a 5-turn helix stays within 0.001 m of the true helix at 1,000 seeded s in at most 4,096 points`, () => {
    const helix = { kind: 'curve@1', params: { fn: { x: 'cos(s)', y: 'sin(s)', z: '0.1 * s', over: [0, END], tolerance: 0.001 }, mode: 'linear' } };
    const [shownReply, geo] = ask([present(DOC(1), sceneDoc('A helix of five turns', { helix })), geometry(DOC(1), ['helix'])]);
    admitted(shownReply, 'the helix');
    const pts = meshOf(geo, 'helix', 'the helix').points;
    expect(pts.length, 'the helix is drawn through at least two points').toBeGreaterThanOrEqual(2);
    expect(pts.length, 'the helix uses at most 4,096 points').toBeLessThanOrEqual(4096);
    expect(dist(pts[0]!, P(0)), 'the helix starts at s = 0').toBeLessThanOrEqual(0.001);
    expect(dist(pts[pts.length - 1]!, P(END)), 'the helix ends at s = 10π, after 5 turns').toBeLessThanOrEqual(0.001);
    const rand = seeded(224);
    const f: string[] = [];
    for (let k = 0; k < 1000; k++) {
      const s = rand() * END;
      const p = P(s);
      let near = Infinity;
      for (let i = 0; i + 1 < pts.length; i++) near = Math.min(near, toSegment(p, pts[i]!, pts[i + 1]!));
      if (!(near <= 0.001)) f.push(`at s = ${s.toFixed(6)} the true helix is ${near.toExponential(3)} m from the curve`);
    }
    none(f, 'the curve stays within 0.001 m of the true helix at 1,000 seeded s');
  }, TIMEOUT);
});
