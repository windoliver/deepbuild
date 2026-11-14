// AC5 #223.3a3308e4 (Oracle lane): a tip sits on its path's end, along its arriving tangent, at its own length. Ported
// from a fork of an upstream animation library, pinned at `cfd33af5aa`: tests/unit/mobjects/test_shapes.py, lines
// 159–190, test_a_tip_points_along_the_path_at_its_end, and lines 230–241, test_an_arrows_tip_is_where_it_ends (README:
// Sources). No upstream code is copied.
//
// test_a_tip_points_along_the_path_at_its_end: a tip added to a random path of up to three cubics, its last cubic
// straight or bending, its last handle sometimes of no length, sits on the path's end and points along its arriving
// tangent (B′(1), else −B″(1), else B‴), within 1e-9 for a straight end and 2e-3 for a bending one.
// test_an_arrows_tip_is_where_it_ends: an arrow's tip is at its end, and keeps its length when the arrow is scaled.
// Ours, under a warp, so the tip is redrawn: each path is a child of group `g` on the plane of origin (400, 300) u,
// unit 100 u, y up, sheared by `linear {matrix: [[1, 1], [0, 1]]}` at mix 1 with `ends: redraw`, its end an arrow
// (`ends: {end: arrow, size: 4}`, stroke 3); the twin is the same path unwarped. Through `deep-canvas-render path`'s
// `ends.end`: the tip lies on the sheared end within 1e-6 u; its direction (from `angle`) is the sheared arriving
// tangent's within 1e-6 (a straight last cubic) or 2e-3 (bending), as unit vectors; its length is the twin's within
// 1e-6 u. Twelve random paths (four each straight, bending, and bending with a collapsed last handle) and eight
// straight arrows, all drawn by a seeded generator.
// The planted fault, in this file: tips drawn as if no warp applied (the twin's own heads, read as the warped ones);
// the port fails on them.
import { describe, expect, it } from 'vitest';
import {
  AC, PLANE, SHEAR, TIMEOUT, arriving, batch, dist, figure, LOOK, mat, none, onScreen, pathAccepted, pathItem, planeJson, randomCurves, short,
  sub2, toPlane, toScreen, useBins, warpGroup, type End, type JsonObject, type JsonValue, type Pt,
} from './helpers.ts';

const bin = useBins(['render']);
const shear = onScreen(PLANE, (q) => mat(SHEAR, q));
/** A screen direction sheared, as a unit vector. */
function shearDir(d: Pt): Pt {
  const p = mat(SHEAR, sub2(toPlane(PLANE, d), toPlane(PLANE, [0, 0])));
  const s = sub2(toScreen(PLANE, p), toScreen(PLANE, [0, 0]));
  const l = Math.hypot(s[0], s[1]);
  return [s[0] / l, s[1] / l];
}
interface Case { what: string; d: string; last: Pt[]; tol: number }
const CASES: Case[] = [
  ...randomCurves('#223 oracle tips straight', 4, { straightLast: true }).map((c, i) => ({ what: `straight path ${i}`, d: c.d, last: c.curves[c.curves.length - 1]!, tol: 1e-6 })),
  ...randomCurves('#223 oracle tips bending', 4).map((c, i) => ({ what: `bending path ${i}`, d: c.d, last: c.curves[c.curves.length - 1]!, tol: 2e-3 })),
  ...randomCurves('#223 oracle tips collapsed', 4, { collapseLast: true }).map((c, i) => ({ what: `path ${i} with a collapsed last handle`, d: c.d, last: c.curves[c.curves.length - 1]!, tol: 2e-3 })),
  ...randomCurves('#223 oracle arrows', 8, { straightLast: true }).map((c, i) => {
    const a = c.curves[0]![0]!; const b = c.curves[c.curves.length - 1]![3]!;
    return { what: `arrow ${i}`, d: `M ${a.join(' ')} L ${b.join(' ')}`, last: [a, a, b, b], tol: 1e-6 };
  }),
];
const doc = (c: Case, warped: boolean): JsonObject => figure('warp-oracle-tip', [800, 600], [
  warpGroup('g', warped ? { linear: { matrix: SHEAR }, mix: 1, plane: planeJson(PLANE), ends: 'redraw' } : null),
  pathItem('tip', 'a1', c.d, 3, { ends: { end: 'arrow', size: 4 } }, { parent: 'g' }),
]);
function heads(warped: boolean): End[] {
  const outs = batch(bin('render'), 'path', CASES.map((c) => ({ doc: doc(c, warped), item: 'tip', look: LOOK }) as JsonValue));
  return CASES.map((c, i) => {
    const e = pathAccepted(outs[i], [0], `${c.what}${warped ? ' sheared' : ''}`)[0]!.ends?.['end'];
    expect(e, `${c.what}: the path reports its end's head`).toBeDefined();
    return e!;
  });
}
/** The port's judge: each head on the sheared end, along the sheared arriving tangent, at the twin's length. */
function judgeTips(got: End[], own: End[]): string[] {
  return CASES.flatMap((c, i) => {
    const out: string[] = [];
    const end = shear(c.last[3]!);
    if (dist(got[i]!.tip, end) > 1e-6) out.push(`${c.what}: the tip is at (${got[i]!.tip.map(short).join(', ')}), not on the sheared end (${end.map(short).join(', ')})`);
    const want = shearDir(arriving(c.last));
    const a = (got[i]!.angle * Math.PI) / 180;
    const gap = Math.hypot(Math.cos(a) - want[0], Math.sin(a) - want[1]);
    if (gap > c.tol) out.push(`${c.what}: the tip points ${short(got[i]!.angle)}°, ${short(gap)} off the sheared arriving tangent (within ${c.tol})`);
    if (Math.abs(got[i]!.length - own[i]!.length) > 1e-6) out.push(`${c.what}: the tip is ${short(got[i]!.length)} u long, not its own ${short(own[i]!.length)} u`);
    return out;
  });
}

describe(`${AC[5]} (Oracle) a redrawn tip sits on the mapped end along the mapped tangent at its own length`, () => {
  it(`${AC[5]} test_a_tip_points_along_the_path_at_its_end and test_an_arrows_tip_is_where_it_ends, under a shear with ends: redraw; tips drawn as if unwarped fail`, () => {
    const own = heads(false);
    const sheared = heads(true);
    none(judgeTips(sheared, own), 'each redrawn tip sits on the sheared end, along the sheared arriving tangent, at its own length');
    expect(judgeTips(own, own).length, 'the port fails on tips drawn as if no warp applied').toBeGreaterThan(0);
  }, TIMEOUT);
});
