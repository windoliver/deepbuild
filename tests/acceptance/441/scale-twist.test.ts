// AC6: "On a two-span linear curve whose spans are 0.2 m and 0.8 m long, a sweep with `rings: 3`, `scale: 1 − 0.75 ×
// u` and `twist: 90` has its ring at the joint at scale 0.85, its ring 0.5 m along at 0.625, and its last ring at
// 0.25, turned 90°, each within 1e-12; a planted sweep that reads u by span puts 0.625 at the joint and fails, and
// a `scale` of 1 − 1.2 × u, which reaches 0 on the range, is refused at check, naming the range"
//
// The curve runs straight along +x through (0, 0, 0), (0.2, 0, 0) and (1, 0, 0), so its rotation-minimizing frame
// is fixed: N = +y (from up), B = T × N = +z. Rings are found by where they sit (the joint at x = 0.2, 0.5 m
// along at x = 0.5, the last at x = 1), so a program that misreads u can't move the ring it is judged at. Each
// named ring's `scale` and `turn` must be the closed form's (1 − 0.75 u; 90 u degrees) within 1e-12, and its
// vertices the asymmetric outline set there: P + scale (x X + y Y), X = cos θ N + sin θ B, Y = −sin θ N + cos θ B,
// within 1e-12 m. The same bar with `scale: 1 − 1.2 × u` must be refused when presented, an error naming
// items/bar/params/along/range. The twin (`u_by_span`) must fail, naming the joint, at 0.625.

import { describe, expect, it } from 'vitest';
import { AC, DOC, SLOW, admitted, errors, failsNaming, geometryCall, issues, meshRow, none, runShow, scenario, sceneDoc, show, useDir, useShow, type JsonObject, type MeshRow, type ShowPlanted } from './helpers.ts';
import { add, dist, fmt, fmtV, scale, type V3 } from './reference.ts';

const bin = useShow();
const dir = useDir();

const POINTS: V3[] = [[0, 0, 0], [0.2, 0, 0], [1, 0, 0]];
const OUTLINE: [number, number][] = [[0, -0.01], [0.1, -0.01], [0.1, 0.01], [0, 0.01]];
const N: V3 = [0, 1, 0];
const B: V3 = [0, 0, 1];
const TOL = 1e-12;
const bar = (scaleExpr: string): JsonObject => ({ kind: 'extrude@1', params: { outline: OUTLINE, along: { curve: 'line', range: [0, 1], scale: scaleExpr, rings: 3 }, twist: 90 } });
const items = (scaleExpr: string): Record<string, JsonObject> => ({ line: { kind: 'curve@1', params: { points: POINTS, mode: 'linear' } }, bar: bar(scaleExpr) });
const NAMED = [
  { name: 'the joint', x: 0.2, u: 0.2, scale: 0.85, turn: 18 },
  { name: 'the ring 0.5 m along', x: 0.5, u: 0.5, scale: 0.625, turn: 45 },
  { name: 'the last ring', x: 1, u: 1, scale: 0.25, turn: 90 },
];

function expectedRing(x: number, s: number, turnDeg: number): V3[] {
  const th = (turnDeg * Math.PI) / 180;
  const X = add(scale(N, Math.cos(th)), scale(B, Math.sin(th)));
  const Y = add(scale(N, -Math.sin(th)), scale(B, Math.cos(th)));
  return OUTLINE.map(([ox, oy]) => add([x, 0, 0], scale(add(scale(X, ox), scale(Y, oy)), s)));
}

/** Every check AC6 names on the three rings; each failure names its ring. */
function ringProblems(g: MeshRow): string[] {
  const out: string[] = [];
  for (const want of NAMED) {
    const ring = g.rings.find((r) => dist(r.frame.point, [want.x, 0, 0]) <= TOL);
    if (!ring) { out.push(`${want.name} (${fmt(want.x)}, 0, 0): no ring there; the rings sit at ${g.rings.map((r) => fmtV(r.frame.point)).join(' ')}`); continue; }
    if (Math.abs(ring.scale - want.scale) > TOL) out.push(`${want.name} (${fmt(want.x)}, 0, 0) has scale ${ring.scale}, not ${want.scale} (1 − 0.75 × ${want.u})`);
    if (Math.abs(ring.turn - want.turn) > TOL) out.push(`${want.name} (${fmt(want.x)}, 0, 0) is turned ${ring.turn}°, not ${want.turn}° (90 × ${want.u})`);
    const exp = expectedRing(want.x, want.scale, want.turn);
    const got = ring.vertices.map((i) => g.positions[i]!);
    if (got.length !== exp.length || got.some((p, j) => dist(p, exp[j]!) > TOL)) out.push(`${want.name} (${fmt(want.x)}, 0, 0): its outline sits at ${got.map(fmtV).join(' ')}, not ${exp.map(fmtV).join(' ')} (scale ${want.scale}, turned ${want.turn}°)`);
  }
  return out;
}

function built(planted?: ShowPlanted): { g: MeshRow; refused: JsonObject } {
  const [shown, refused, reply] = runShow(bin(), scenario(dir(), [DOC.a, DOC.b], [
    show(DOC.a, sceneDoc('A tapered, twisted bar', items('1 - 0.75 * u'))),
    show(DOC.b, sceneDoc('A bar tapered to nothing', items('1 - 1.2 * u'))),
    geometryCall(DOC.a, ['bar']),
  ], planted));
  admitted(shown!, 'the tapered bar document');
  return { g: meshRow(reply!, 'bar', 'geometry of the bar'), refused: refused! };
}

describe(`${AC[6]} scale and twist read by arc length`, () => {
  it(`${AC[6]} with rings: 3 the ring at the joint has scale 0.85, the ring 0.5 m along 0.625 and the last 0.25 turned 90°, each within 1e-12; scale 1 − 1.2 × u is refused at check, naming the range`, () => {
    const { g, refused } = built();
    none(ringProblems(g), 'the tapered, twisted bar\'s rings');
    expect(refused['outcome'], `the bar whose scale reaches 0 is refused: ${JSON.stringify(refused).slice(0, 1500)}`).toBe('refused');
    const errs = errors(issues(refused, 'the refused bar'));
    expect(errs.some((e) => JSON.stringify(e.raw).includes('items/bar/params/along/range')), `an error names items/bar/params/along/range: ${JSON.stringify(refused['issues'])}`).toBe(true);
  }, SLOW);

  it(`${AC[6]} the planted u_by_span (u read by span) puts 0.625 at the joint and fails, naming the joint`, () => {
    const failures = ringProblems(built('u_by_span').g);
    failsNaming(failures, ['the joint'], 'the planted u_by_span');
    expect(failures.some((f) => f.startsWith('the joint') && f.includes('scale 0.625')), `the planted u_by_span puts 0.625 at the joint:\n  ${failures.join('\n  ')}`).toBe(true);
  }, SLOW);
});
