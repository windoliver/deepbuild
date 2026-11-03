// AC4: "Swept along an S curve in the xz plane with an inflection at its middle, a 0.10 × 0.01 m bar outline set
// 0.05 m to one side of the curve stays on that side at every ring, its frame within 1e-6 rad of curve@1's own
// rotation-minimizing frame there; a planted sweep on Frenet frames turns the bar 180° at the inflection, moving
// it to the other side, and fails, naming the ring"
//
// The parity fixture (parity/geometry/sweep-s-bar.scene) holds the S curve, the bar and the expected values. One
// run presents it and reads the bar's mesh and rings and curve@1's frame at every ring's u. Each ring's vertices
// must sit 0.045–0.055 m along T × up from this suite's reference point on the curve at that u, its frame must
// be within 1e-6 rad of curve@1's there, and curve@1's normal must be +y within 1e-6 rad (the RMF of a planar
// curve started from up). The twin (`sweep_frenet`) must fail, first at ring 32, the first past the inflection.

import { describe, expect, it } from 'vitest';
import { AC, DOC, SLOW, admitted, curveRow, failsNaming, fixture, geometryCall, meshRow, none, num, obj, runShow, scenario, sceneDoc, show, useDir, useShow, type CurveRow, type Frame, type JsonObject, type MeshRow, type ShowPlanted } from './helpers.ts';
import { RefCurve, angle, bezierSpans, cross, dot, fmt, sub, unit, type V3 } from './reference.ts';

const bin = useShow();
const dir = useDir();
const SCENE = fixture('parity', 'geometry', 'sweep-s-bar.scene');
const ITEMS = obj(SCENE['items'], 'the fixture\'s items') as Record<string, JsonObject>;
const CURVE = obj(ITEMS['s']!['params'], 'the S curve\'s params');
const HANDLES = obj(CURVE['handles'], 'the S curve\'s handles');
const REF = new RefCurve(bezierSpans(CURVE['points'] as V3[], HANDLES['in'] as V3[], HANDLES['out'] as V3[]));
const RINGS = num(SCENE['rings'], 'rings');
const RING_U = Array.from({ length: RINGS }, (_, k) => k / (RINGS - 1));
const [SIDE_MIN, SIDE_MAX] = SCENE['side'] as [number, number];
const SIDE_TOL = num(SCENE['side_tolerance_m'], 'side_tolerance_m');
const TOL = num(SCENE['tolerance_rad'], 'tolerance_rad');
const TWIN = (SCENE['twins'] as JsonObject[])[0]!;
const UP: V3 = [0, 1, 0];

const frameAngle = (a: Frame, b: Frame): number => Math.max(angle(a.tangent, b.tangent), angle(a.normal, b.normal), angle(a.binormal, b.binormal));

function built(planted?: ShowPlanted): { bar: MeshRow; s: CurveRow } {
  const [shown, barReply, sReply] = runShow(bin(), scenario(dir(), [DOC.a], [
    show(DOC.a, sceneDoc('A bar along an S curve', ITEMS)),
    geometryCall(DOC.a, ['bar']),
    geometryCall(DOC.a, ['s'], RING_U),
  ], planted));
  admitted(shown!, 'the S-curve bar document');
  return { bar: meshRow(barReply!, 'bar', 'geometry of the bar'), s: curveRow(sReply!, 's', 'geometry of the S curve') };
}

/** Every check AC4 names, ring by ring; each failure starts with `ring <k> `. */
function barProblems(bar: MeshRow, s: CurveRow): string[] {
  if (bar.rings.length !== RINGS) return [`the bar has ${bar.rings.length} rings; rings: ${RINGS} on an open smooth curve gives ${RINGS}`];
  if (s.at.length !== RINGS) return [`curve@1 answered ${s.at.length} at entries for ${RINGS} values of u`];
  const out: string[] = [];
  bar.rings.forEach((ring, k) => {
    const u = RING_U[k]!;
    const at = `ring ${k} (u = ${fmt(u)})`;
    if (Math.abs(ring.u - u) > 1e-12) { out.push(`${at}: reported at u = ${ring.u}`); return; }
    const c = REF.point(u);
    const side = unit(cross(REF.tangent(u), UP));
    const offsets = ring.vertices.map((i) => dot(sub(bar.positions[i]!, c), side));
    if (offsets.some((d) => d < 0)) out.push(`${at}: the bar is on the other side of the curve, its vertices ${offsets.map(fmt).join(', ')} m along T × up`);
    else if (offsets.some((d) => d < SIDE_MIN - SIDE_TOL || d > SIDE_MAX + SIDE_TOL)) out.push(`${at}: the bar's vertices are ${offsets.map(fmt).join(', ')} m along T × up, not ${SIDE_MIN}–${SIDE_MAX}`);
    const curveFrame = s.at[k]!;
    const a = frameAngle(ring.frame, curveFrame);
    if (!(a <= TOL)) out.push(`${at}: its frame is ${fmt(a)} rad from curve@1's frame there (limit ${TOL} rad)`);
    const n = angle(curveFrame.normal, UP);
    if (!(n <= TOL)) out.push(`${at}: curve@1's own frame there is not rotation-minimizing: its normal is ${fmt(n)} rad from +y`);
  });
  return out;
}

describe(`${AC[4]} a bar swept along an S curve keeps its side`, () => {
  it(`${AC[4]} the 0.10 × 0.01 m bar 0.05 m to one side stays on that side at all 64 rings, each ring's frame within 1e-6 rad of curve@1's rotation-minimizing frame`, () => {
    const [before, after] = SCENE['inflection_between_rings'] as [number, number];
    const signed = (u: number): number => { const { span, t } = REF.locate(u); return dot(cross(REF.tangent(u), REF.accelAt(span, t)), UP); };
    expect(signed(RING_U[before]!) * signed(RING_U[after]!), `the fixture curve: its curvature changes side between rings ${before} and ${after}`).toBeLessThan(0);
    const { bar, s } = built();
    none(barProblems(bar, s), 'the bar along the S curve');
  }, SLOW);

  it(`${AC[4]} the planted ${String(TWIN['planted'])} (Frenet frames) moves the bar to the other side past the inflection and fails, naming ring ${String(TWIN['first_ring'])} first`, () => {
    const { bar, s } = built(TWIN['planted'] as ShowPlanted);
    const failures = barProblems(bar, s);
    failsNaming(failures, TWIN['names'] as string[], `the planted ${String(TWIN['planted'])}`);
    expect(failures.some((f) => f.startsWith(`ring ${String(TWIN['first_ring'])} `) && f.includes('other side')), `the planted ${String(TWIN['planted'])}: ring ${String(TWIN['first_ring'])} is on the other side:\n  ${failures.join('\n  ')}`).toBe(true);
    const first = Math.min(...failures.map((f) => Number(/^ring (\d+) /.exec(f)?.[1] ?? Infinity)));
    expect(first, `the planted ${String(TWIN['planted'])} turns the bar at the inflection, not before:\n  ${failures.join('\n  ')}`).toBe(num(TWIN['first_ring'], 'first_ring'));
  }, SLOW);
});
