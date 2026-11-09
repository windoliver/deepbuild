// AC3 #505.5e6d3319 (Oracle lane, port): graphest 0a2e4808a6 plots a relation by interval arithmetic over the pixels
// of a 1024 × 1024 image of [−10, 10]² and compares the plot with a reference PNG in rust/tests/graph_tests/reference:
// a pixel is white where graphest proved no solution, black where it could not (examples.rs: "Infinite Frequency",
// y = sin(40 / x), t_f2c337b79a9843aa898fb494c3869916; "Wave", y = sin(x) / x, t_95e4d99eaafc4e749ca0703ff6a8f1b1;
// both at graph.rs's defaults, no @bounds or @size). The references are copied unchanged into fixtures/graphest/.
//
// Ours draws the same function as a path fn through scales that put [−10, 10]² on 1024 × 1024 u, so a reference pixel
// is one u. `deep-canvas-render geometry` gives the drawn line and its estimate notices, `check` its `curves` report
// (the #505 README's surface). What the reference fixes, judged on our output:
//
// 1. Where ours is bounded (the check's `curves.bound`), every drawn point lies within 0.5 u of a black pixel: each
//    is within 0.5 px of the curve, and graphest proved the white pixels hold none of it.
// 2. Where ours is bounded, every black pixel in a column inside that range lies within 0.5 u of the drawn line: in
//    these two files every black pixel outside the stretch near 0 holds the closed form's curve (checked when the
//    fixtures were taken; the README says how), so a line within 0.5 px of the curve passes within 0.5 u of it.
// 3. sin(40/x): next to x = 0 the reference's columns are black over all of y ∈ [−1, 1] (the curve sweeps the band
//    inside one pixel); right of that stretch graphest resolves it to a line. Ours names an estimate stretch from the
//    range's start, 0.01, and every stretch it can't bound lies inside the reference's unresolved one: right of it a
//    few dozen half-waves remain, far inside 2,000 points. sin(x)/x: the reference resolves every column, and ours
//    bounds the whole range, with no estimate.
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, Drawn, check, curvesOf, estimates, fnAt, look, nearBlack, none, pair, passes, pixelBox, reference, scale, document, item, stroke, show,
  useRender, type FnGeometry, type JsonValue,
} from './helpers.ts';

const render = useRender();
const ID = AC[3];
/** The reference's plane, 1024 px a side, one px per u here. */
const SIDE = 1024;
const PX = 20 / SIDE;
const toX = (u: number): number => -10 + u * PX;

const plot = (id: string, y: string, over: [number, number]) => document(id, `y = ${y}`, [SIDE, SIDE], [
  scale('gx', 'a0', [-10, 10], [0, SIDE]),
  scale('gy', 'a1', [-10, 10], [SIDE, 0]),
  item('curve', 'path@1', 'b0', { fn: { y, over, scales: { x: 'gx', y: 'gy' } }, paint: stroke('ink', 1) }),
]);
const within = (x: number, ranges: readonly [number, number][]): boolean => ranges.some(([a, b]) => x >= a && x <= b);
/** Whether [a, b] is covered by the union of `ranges` (each closed), to 1e-9. */
function covers(ranges: readonly [number, number][], [a, b]: [number, number]): boolean {
  let reach = a;
  for (const [lo, hi] of [...ranges].sort((p, q) => p[0] - q[0])) { if (lo > reach + 1e-9) break; reach = Math.max(reach, hi); }
  return reach >= b - 1e-9;
}

/** Rules 1 and 2 over the bound ranges: drawn points off every black pixel, black pixels off the drawn line. */
function againstReference(g: FnGeometry, refName: string, bound: [number, number][]): string[] {
  const ref = reference(refName);
  const out: string[] = [];
  for (const [i, s] of g.subpaths.entries()) {
    for (const p of s.points) {
      if (!within(toX(p[0]), bound)) continue;
      if (!nearBlack(ref, p, 1, 0.5)) out.push(`sub-path ${i}: the drawn point (${p[0].toFixed(3)}, ${p[1].toFixed(3)}) u, x = ${toX(p[0]).toFixed(5)}, is more than 0.5 u from every pixel the reference leaves black`);
    }
  }
  const drawn = new Drawn(g.subpaths);
  for (const [c, r] of ref.blacks) {
    if (!bound.some(([a, b]) => toX(c) >= a && toX(c + 1) <= b)) continue;
    const d = drawn.toBox(pixelBox(c, r, 1), 0.5);
    if (!(d <= 0.5)) out.push(`the reference's black pixel (${c}, ${r}), x in [${toX(c).toFixed(5)}, ${toX(c + 1).toFixed(5)}], is ${Number.isFinite(d) ? d.toFixed(3) : 'more than 0.5'} u from the drawn line`);
  }
  return out;
}

describe(`${ID} graphest's reference plots, run against our drawn line at the reference's pixel scale`, () => {
  it(`${ID} y = sin(40 / x) (graphest "Infinite Frequency"): the stretch ours can't bound starts at 0.01 and lies inside the reference's unresolved stretch near 0, and the rest is bounded`, () => {
    const bin = render();
    const doc = plot('graphest-infinite-frequency', 'sin(40 / x)', [0.01, 10]);
    const c = passes(bin, doc, look(), 'sin(40 / x)');
    const [g] = fnAt(bin, doc, 'curve', [{}], 'sin(40 / x)');
    // The reference's unresolved stretch: from x = 0, the columns black over every row that meets y ∈ [−1, 1].
    const ref = reference('t_f2c337b79a9843aa898fb494c3869916.png');
    const rows = [Math.floor(9 / PX), Math.floor(11 / PX)];
    let col = SIDE / 2;
    const full = (cc: number): boolean => { for (let r = rows[0]!; r <= rows[1]!; r++) if (!ref.black(cc, r)) return false; return true; };
    while (col < SIDE && full(col)) col++;
    const xg = toX(col);
    expect(xg, 'the reference leaves a stretch next to x = 0 unresolved').toBeGreaterThan(0.1);
    expect(xg, 'the reference resolves the curve well before x = 10').toBeLessThan(1);
    const notices = estimates(g!.notices, 'curve').map((n, i) => pair(n['x_range'], `the estimate notice ${i}: x_range`));
    expect(notices.some(([a]) => Math.abs(a - 0.01) <= 1e-9), `an estimate notice names a stretch from 0.01, where the reference is unresolved: ${show(g!.notices as unknown as JsonValue)}`).toBe(true);
    const curves = curvesOf(c, 'curve', 'sin(40 / x)');
    const outside = [...notices, ...curves.estimate].filter(([a, b]) => !(a >= 0.01 - 1e-9 && b <= xg + 1e-12));
    expect(outside, `every stretch ours can't bound lies inside the reference's unresolved [0, ${xg}]: notices ${JSON.stringify(notices)}, curves.estimate ${JSON.stringify(curves.estimate)}`).toEqual([]);
    expect(covers(curves.bound, [xg, 10]), `the check's bound covers [${xg}, 10], where the reference resolves the curve: ${JSON.stringify(curves.bound)}`).toBe(true);
    expect(g!.subpaths.reduce((n, s) => n + s.points.length, 0), 'at most 2,000 points').toBeLessThanOrEqual(2000);
  }, TIMEOUT);

  it(`${ID} y = sin(40 / x): where ours is bounded, every drawn point is within 0.5 px of a pixel the reference leaves black, and every black pixel there within 0.5 px of the line`, () => {
    const bin = render();
    const doc = plot('graphest-infinite-frequency', 'sin(40 / x)', [0.01, 10]);
    const curves = curvesOf(check(bin, doc, look(), 'sin(40 / x)'), 'curve', 'sin(40 / x)');
    const [g] = fnAt(bin, doc, 'curve', [{}], 'sin(40 / x)');
    expect(curves.bound.length, 'the check lists a bounded range').toBeGreaterThan(0);
    none(againstReference(g!, 't_f2c337b79a9843aa898fb494c3869916.png', curves.bound), 'sin(40 / x) against graphest t_f2c337b79a9843aa898fb494c3869916');
  }, TIMEOUT);

  it(`${ID} y = sin(x) / x (graphest "Wave") over [0.1, 10]: bounded throughout as the reference is resolved throughout, every drawn point within 0.5 px of a black pixel and every black pixel within 0.5 px of the line`, () => {
    const bin = render();
    const doc = plot('graphest-wave', 'sin(x) / x', [0.1, 10]);
    const c = passes(bin, doc, look(), 'sin(x) / x');
    const [g] = fnAt(bin, doc, 'curve', [{}], 'sin(x) / x');
    expect(estimates(g!.notices, 'curve'), 'no estimate notice').toEqual([]);
    const curves = curvesOf(c, 'curve', 'sin(x) / x');
    expect(curves.estimate, 'the check lists no estimate').toEqual([]);
    expect(covers(curves.bound, [0.1, 10]), `the check's bound covers [0.1, 10]: ${JSON.stringify(curves.bound)}`).toBe(true);
    none(againstReference(g!, 't_95e4d99eaafc4e749ca0703ff6a8f1b1.png', [[0.1, 10]]), 'sin(x) / x against graphest t_95e4d99eaafc4e749ca0703ff6a8f1b1');
  }, TIMEOUT);
});
