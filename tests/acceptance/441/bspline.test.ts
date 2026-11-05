// AC3: "A bspline curve's acceleration is continuous at every point within 1e-6 relative, and moving one point
// changes only the four spans it touches"
//
// An open seven-point curve@1 with `mode: bspline`: a uniform cubic B-spline whose end points repeat three times
// (Curve `curve@1`: bspline mode), so eight spans and seven joints, one per point. Acceleration is the curve's
// second derivative in u, d²P/du² (this suite's `accel` field: a camera moving along u at a steady rate feels
// it), read at each joint's u from both sides (u ± 1e-9, the joints placed by this suite's reference arc
// length). The two sides must agree within 1e-6 of the largest acceleration at any joint (relative to that
// scale, since at the first and last joint, beside the repeated end points, the acceleration passes through 0),
// and each side must equal the reference's own d²P/du² there to the same bound, with the point at each joint
// on the reference's (C[j] + 4C[j+1] + C[j+2]) / 6 within 1e-6 × length, so a curve that isn't this B-spline
// can't pass. Moving the middle point (point 3, the control sequence's sixth entry) changes spans 2 to 5 only:
// spans 0 and 1, read at the same arc length from the start, and spans 6 and 7, read at the same arc length
// from the end, keep their points within 1e-6 × length, and the moved spans follow the reference.

import { describe, expect, it } from 'vitest';
import { AC, DOC, SLOW, admitted, curveRow, geometryCall, none, num, runShow, scenario, sceneDoc, show, useDir, useShow, v3, type CurveRow } from './helpers.ts';
import { RefCurve, add, bezPoint, bsplineOpenSpans, dist, fmt, fmtV, length, sub, type V3 } from './reference.ts';

const bin = useShow();
const dir = useDir();

const POINTS: V3[] = [[0, 0, 0], [0.5, 0.4, 0], [1, -0.2, 0.3], [1.5, 0.5, 0.1], [2, -0.1, -0.3], [2.5, 0.3, 0.2], [3, 0, 0]];
const MOVED_INDEX = 3;
const MOVED: V3[] = POINTS.map((p, k) => (k === MOVED_INDEX ? add(p, [0, 0.3, 0.2]) : p));
/** Point k (0 < k < n − 1) is control entry k + 2, used by spans k − 1 … k + 2. */
const TOUCHED = [MOVED_INDEX - 1, MOVED_INDEX, MOVED_INDEX + 1, MOVED_INDEX + 2];
const A = new RefCurve(bsplineOpenSpans(POINTS));
const B = new RefCurve(bsplineOpenSpans(MOVED));
const SPANS = A.spans.length;
const JOINTS = Array.from({ length: SPANS - 1 }, (_, i) => i + 1);
const DELTA = 1e-9;
const REL = 1e-6;

const curveItem = (points: V3[]) => ({ c: { kind: 'curve@1', params: { points, mode: 'bspline' } } });
const midS = (r: RefCurve, k: number): number => r.knotS(k) + r.lens[k]! / 2;

describe(`${AC[3]} a bspline curve: C2 at every point, and local`, () => {
  it(`${AC[3]} the seven-point open bspline's acceleration is the same from both sides of each of its seven joints within 1e-6 relative, and moving point 3 changes only spans 2–5`, () => {
    expect(SPANS, 'seven points with ends repeated three times make eight spans').toBe(8);
    for (const k of TOUCHED) expect(dist(bezPoint(A.spans[k]!, 0.5), bezPoint(B.spans[k]!, 0.5)), `the move shifts span ${k} by more than 1 mm`).toBeGreaterThan(1e-3);

    const jointU = JOINTS.map((j) => A.knotS(j) / A.L);
    const atA = jointU.flatMap((u) => [u - DELTA, u + DELTA]);
    const keepFront = [0, 1].map((k) => midS(A, k));
    const keepBack = [SPANS - 2, SPANS - 1].map((k) => A.L - midS(A, k));
    const uAkeep = [...keepFront.map((s) => s / A.L), ...keepBack.map((e) => 1 - e / A.L)];
    const uBkeep = [...keepFront.map((s) => s / B.L), ...keepBack.map((e) => 1 - e / B.L)];
    const uBmoved = TOUCHED.map((k) => midS(B, k) / B.L);

    const [shownA, shownB, gA, gB] = runShow(bin(), scenario(dir(), [DOC.a, DOC.b], [
      show(DOC.a, sceneDoc('A bspline', curveItem(POINTS))),
      show(DOC.b, sceneDoc('The bspline with point 3 moved', curveItem(MOVED))),
      geometryCall(DOC.a, ['c'], [...atA, ...uAkeep]),
      geometryCall(DOC.b, ['c'], [...uBkeep, ...uBmoved]),
    ]));
    admitted(shownA!, 'the bspline document');
    admitted(shownB!, 'the moved bspline document');
    const ca: CurveRow = curveRow(gA!, 'c', 'geometry of the bspline');
    const cb: CurveRow = curveRow(gB!, 'c', 'geometry of the moved bspline');

    const failures: string[] = [];
    const tol = 1e-6 * A.L;
    if (ca.at.length !== atA.length + uAkeep.length) failures.push(`the bspline: ${ca.at.length} at entries for ${atA.length + uAkeep.length} values of u`);
    if (cb.at.length !== uBkeep.length + uBmoved.length) failures.push(`the moved bspline: ${cb.at.length} at entries for ${uBkeep.length + uBmoved.length} values of u`);
    if (failures.length) { none(failures, 'the bspline\'s at entries'); return; }
    const L = num(ca.outputs['length'], 'c.outputs.length');
    if (Math.abs(L - A.L) > tol) failures.push(`the bspline: length ${fmt(L)} m; the B-spline's arc length is ${fmt(A.L)} m`);

    const scaleA = Math.max(...JOINTS.map((j) => length(A.accelAt(j, 0))));
    JOINTS.forEach((j, i) => {
      const [left, right] = [ca.at[2 * i]!, ca.at[2 * i + 1]!];
      const knot = bezPoint(A.spans[j]!, 0);
      const aL = v3(left.raw['accel'], `at(${left.u}).accel`);
      const aR = v3(right.raw['accel'], `at(${right.u}).accel`);
      const jump = length(sub(aL, aR));
      if (!(jump <= REL * scaleA)) failures.push(`joint ${j} (point ${j - 1}, u = ${fmt(jointU[i]!)}): the acceleration jumps by ${fmt(jump)} from ${fmtV(aL)} to ${fmtV(aR)} (limit ${fmt(REL * scaleA)}, 1e-6 of the largest at a joint)`);
      for (const [side, row, a] of [['left', left, aL], ['right', right, aR]] as const) {
        const want = A.accel(row.u);
        if (!(length(sub(a, want)) <= REL * scaleA)) failures.push(`joint ${j}: the acceleration on its ${side} ${fmtV(a)} is not the B-spline's d²P/du² ${fmtV(want)}`);
        if (dist(row.point, knot) > tol) failures.push(`joint ${j}: the point on its ${side} ${fmtV(row.point)} is ${fmt(dist(row.point, knot))} m from the B-spline's joint ${fmtV(knot)}`);
      }
    });

    const keptA = ca.at.slice(atA.length);
    const keptB = cb.at.slice(0, uBkeep.length);
    const keptSpans = [0, 1, SPANS - 2, SPANS - 1];
    keptSpans.forEach((k, i) => {
      const d = dist(keptA[i]!.point, keptB[i]!.point);
      if (d > tol) failures.push(`span ${k}, which point ${MOVED_INDEX} doesn't touch, moved ${fmt(d)} m: ${fmtV(keptA[i]!.point)} became ${fmtV(keptB[i]!.point)}`);
    });
    TOUCHED.forEach((k, i) => {
      const row = cb.at[uBkeep.length + i]!;
      const want = B.point(row.u);
      if (dist(row.point, want) > tol) failures.push(`span ${k} of the moved bspline: ${fmtV(row.point)} is ${fmt(dist(row.point, want))} m from the moved B-spline's ${fmtV(want)}`);
    });
    // The kept spans' reference points really are the same curve at those arc lengths.
    keptSpans.forEach((k, i) => expect(dist(A.point(uAkeep[i]!), B.point(uBkeep[i]!)), `the reference keeps span ${k}`).toBeLessThan(1e-12));
    none(failures, 'the bspline\'s continuity and locality');
  }, SLOW);
});
