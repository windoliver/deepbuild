// AC1: "A curve's at(u) returns the point at that fraction of arc length within 1e-6 of its length, and a tube
// along it shows no twist"
//
// The curve is a two-span cubic Bézier in space (curve@1 `mode: bezier`, explicit handles, so its shape is fixed
// by the design alone), fast at its start and slow at its joint, with torsion. This suite's reference
// (reference.ts) measures its arc length by Gauss-Legendre quadrature and solves each u to a point; the program's
// `length` and its at(u) at 21 values of u must lie within 1e-6 × length of it. A tube@1 along the same curve
// reports its rings; "no twist" is read as: each ring's normal keeps one angle, within 1e-3 rad, to the
// rotation-minimizing frame this suite carries along the curve by double reflection on a dense grid, so the ring
// frames turn about the tangent only as an RMF does. The test first shows both checks can fail on this curve:
// a parameter-uniform at(u) misses by more than 1% of the length, and a frame held to `up` twists by more than
// 0.1 rad against the RMF.

import { describe, expect, it } from 'vitest';
import { AC, DOC, SLOW, admitted, curveRow, geometryCall, meshRow, none, num, runShow, scenario, sceneDoc, show, useDir, useShow } from './helpers.ts';
import { RefCurve, RefRmf, angleAbout, bezPoint, bezierSpans, dist, fmt, fmtV, perpendicular, type V3 } from './reference.ts';

const bin = useShow();
const dir = useDir();

const POINTS: V3[] = [[0, 0, 0], [1, 0.5, 0], [1.5, 0.2, 1]];
const IN: V3[] = [[0, 0, 0], [-0.15, -0.3, -0.3], [0, 0.4, -0.1]];
const OUT: V3[] = [[0.9, 0, 0], [0.15, 0.3, 0.3], [0, 0, 0]];
const REF = new RefCurve(bezierSpans(POINTS, IN, OUT));
const US = Array.from({ length: 21 }, (_, i) => i / 20);
/** "No twist": the ring frames' angle to the RMF stays within this of its value at the first ring (this suite's reading). */
const TWIST_TOL = 1e-3;

describe(`${AC[1]} at(u) by arc length, and a tube without twist`, () => {
  it(`${AC[1]} at(u) on a two-span Bézier is the point at u × length within 1e-6 × length, and the tube along it turns its rings only as the rotation-minimizing frame does`, () => {
    // The checks can fail on this curve: u read by span parameter misses, and an up-held frame twists.
    const byParam = Math.max(...US.map((u) => { const k = Math.min(Math.floor(u * 2), 1); return dist(bezPoint(REF.spans[k]!, u * 2 - k), REF.point(u)); }));
    expect(byParam, 'the fixture curve: u read by span parameter lands more than 1% of the length away somewhere').toBeGreaterThan(0.01 * REF.L);
    const rmf = new RefRmf(REF, [0, 1, 0]);
    const end = rmf.at(1);
    expect(Math.abs(angleAbout(end.normal, perpendicular([0, 1, 0], end.tangent), end.tangent)), 'the fixture curve: a frame held to up twists more than 0.1 rad against the RMF by its end').toBeGreaterThan(0.1);

    const doc = sceneDoc('A curve and a tube', {
      c: { kind: 'curve@1', params: { points: POINTS, mode: 'bezier', handles: { in: IN, out: OUT } } },
      tube: { kind: 'tube@1', params: { path: 'c', radius: 0.05, segments: 16, caps: 'flat' } },
    });
    const [shown, curveReply, tubeReply] = runShow(bin(), scenario(dir(), [DOC.a], [show(DOC.a, doc), geometryCall(DOC.a, ['c'], US), geometryCall(DOC.a, ['tube'])]));
    admitted(shown!, 'the curve and tube document');
    const c = curveRow(curveReply!, 'c', 'geometry of c');
    const tube = meshRow(tubeReply!, 'tube', 'geometry of the tube');

    const failures: string[] = [];
    const tol = 1e-6 * REF.L;
    const L = num(c.outputs['length'], 'c.outputs.length');
    if (Math.abs(L - REF.L) > tol) failures.push(`c: length ${fmt(L)} m; the arc length is ${fmt(REF.L)} m`);
    if (c.at.length !== US.length) failures.push(`c: ${c.at.length} at entries for ${US.length} values of u`);
    c.at.forEach((row, i) => {
      const u = US[i]!;
      const want = REF.point(u);
      if (row.u !== u) failures.push(`c: at entry ${i} is for u = ${row.u}, asked ${u}`);
      if (dist(row.point, want) > tol) failures.push(`c: at(${fmt(u)}) = ${fmtV(row.point)}, ${fmt(dist(row.point, want))} m from the point at ${fmt(u)} of the arc length ${fmtV(want)} (limit ${fmt(tol)} m)`);
    });

    if (tube.rings.length < 2) failures.push(`tube: ${tube.rings.length} rings reported`);
    const twist = tube.rings.map((r) => { const f = rmf.at(r.u); return angleAbout(f.normal, perpendicular(r.frame.normal, f.tangent), f.tangent); });
    tube.rings.forEach((r, k) => {
      let d = twist[k]! - twist[0]!;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) > TWIST_TOL) failures.push(`tube: ring ${k} (u = ${fmt(r.u)}) is twisted ${fmt(d)} rad about the tangent against the rotation-minimizing frame from ring 0 (limit ${TWIST_TOL})`);
    });
    none(failures, 'at(u) by arc length and the tube\'s twist');
  }, SLOW);
});
