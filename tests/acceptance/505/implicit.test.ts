// AC4 #505.00692b98: "x² + y² − 1 = 0 over [−2, 2]² draws one closed sub-path within 0.5 px of the unit circle at
// 1,000 seeded points; y² − x³ + 2x − 1 = 0 over [−3, 3]² draws exactly two sub-paths, the oval and the branch; over
// [−2, 2]² a circle of radius 0.02 at (1.5, 0), smaller than a level-5 cell, is found, while a planted tracer that
// drops cells by corner signs misses it and fails; and sin(1 ÷ (x·y)) = 0 near the origin hits the 16,384-cell cap and
// draws as an estimate with a notice naming its box"
//
// Each curve is a path@1 with `fn: {zero, over_x, over_y, scales}` (no `max_cells`: the default, 16,384), drawn at
// 100 u per unit (1 u is 1 px at zoom 1). `geometry` gives its sub-paths in u, the cells its trace took (`cells`) and
// its notices (README: `geometry`). "Within 0.5 px" is both ways: every drawn point within 0.5 u of the zero set (the
// test's Newton projection onto it, in f64) and each of the seeded points of the curve within 0.5 u of the drawn
// line. y² = x³ − 2x + 1 = (x − 1)(x² + x − 1): the oval spans x from −φ to 1/φ, the branch starts at x = 1 and leaves
// the box at y = ±3. The planted tracer is `planted: "drops_cells_by_corner_signs"` (README: Planted programs).
import { describe, expect, it } from 'vitest';
import {
  CAPPED, CIRCLE, ELLIPTIC, SMALL, SQUARE2, SQUARE3, cappedDoc, circleDoc, ellipticDoc, planeU, smallDoc, type Plane,
} from './docs.ts';
import {
  AC, TIMEOUT, arr, closes, estimates, fails, fnAt, near, none, num, passes, seeded, show, toDrawn, toZeroSet, useRender, type FnGeometry, type JsonValue, type Pt, type Subpath,
} from './helpers.ts';

const render = useRender();
const ID = AC[4];
const PHI = (1 + Math.sqrt(5)) / 2;
const F = {
  circle: (x: number, y: number) => x * x + y * y - 1,
  elliptic: (x: number, y: number) => y * y - x ** 3 + 2 * x - 1,
  small: (x: number, y: number) => (x - 1.5) ** 2 + y * y - 0.0004,
};
const toU = (p: Plane) => { const m = planeU(p); return (x: number, y: number): Pt => [m.x(x), m.y(y)]; };
const fromU = (p: Plane) => { const m = planeU(p); return (u: Pt): [number, number] => [m.fx(u[0]), m.fy(u[1])]; };
/** Drawn points more than 0.5 u from the zero set of `f`. */
function offCurve(g: FnGeometry, f: (x: number, y: number) => number, p: Plane): string[] {
  const out: string[] = [];
  g.subpaths.forEach((s, i) => s.points.forEach((pt) => {
    const d = toZeroSet(pt, f, toU(p), fromU(p));
    if (!(d <= 0.5)) out.push(`sub-path ${i}: the drawn point (${pt[0].toFixed(3)}, ${pt[1].toFixed(3)}) is ${d.toFixed(3)} u from the curve`);
  }));
  return out;
}
/** Points of the curve (in u) more than 0.5 u from the drawn line. */
function missed(points: Pt[], subpaths: readonly Subpath[]): string[] {
  return points.flatMap((p) => { const d = toDrawn(p, subpaths); return d <= 0.5 ? [] : [`the curve's point (${p[0].toFixed(3)}, ${p[1].toFixed(3)}) is ${d.toFixed(3)} u from the drawn line`]; });
}
/** The cubic x³ − 2x + 1 = c's root above 1, by bisection. */
function branchX(c: number): number {
  let lo = 1; let hi = 3;
  for (let k = 0; k < 200; k++) { const m = (lo + hi) / 2; if (m ** 3 - 2 * m + 1 < c) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
const cellsWithin = (g: FnGeometry): void => {
  expect(g.cells, `the trace reports its cells: ${show(g.raw)}`).not.toBeNull();
  expect(g.cells!, 'the trace never takes more than max_cells (16,384) cells').toBeLessThanOrEqual(16_384);
};

describe(`${ID} implicit curves traced on an interval quadtree`, () => {
  it(`${ID} x² + y² − 1 = 0 over [−2, 2]² draws one closed sub-path within 0.5 px of the unit circle at 1,000 seeded points`, () => {
    const bin = render();
    const doc = circleDoc();
    passes(bin, doc, CIRCLE);
    const [g] = fnAt(bin, doc, 'curve', [{}], CIRCLE);
    expect(g!.subpaths.length, `one sub-path: ${show(g!.raw)}`).toBe(1);
    expect(closes(g!.subpaths[0]!), 'it is closed').toBe(true);
    const rand = seeded(505_4);
    const onCircle = Array.from({ length: 1000 }, () => { const th = 2 * Math.PI * rand(); return toU(SQUARE2)(Math.cos(th), Math.sin(th)); });
    none(missed(onCircle, g!.subpaths), '1,000 seeded points of the unit circle');
    none(offCurve(g!, F.circle, SQUARE2), 'the drawn points');
    expect(estimates(g!.notices, 'curve'), 'no estimate').toEqual([]);
    cellsWithin(g!);
  }, TIMEOUT);

  it(`${ID} y² − x³ + 2x − 1 = 0 over [−3, 3]² draws exactly two sub-paths, the oval and the branch`, () => {
    const bin = render();
    const doc = ellipticDoc();
    passes(bin, doc, ELLIPTIC);
    const [g] = fnAt(bin, doc, 'curve', [{}], ELLIPTIC);
    expect(g!.subpaths.length, `exactly two sub-paths: ${show(g!.raw)}`).toBe(2);
    const m = planeU(SQUARE3);
    const xs = (s: Subpath): number[] => s.points.map((p) => m.fx(p[0]));
    const oval = g!.subpaths.find((s) => Math.max(...xs(s)) < 0.9);
    const branch = g!.subpaths.find((s) => Math.min(...xs(s)) > 0.9);
    expect(oval, 'one sub-path lies left of x = 0.9: the oval').toBeDefined();
    expect(branch, 'one sub-path lies right of x = 0.9: the branch').toBeDefined();
    expect(closes(oval!), 'the oval is closed').toBe(true);
    near(Math.min(...xs(oval!)), -PHI, 0.005, 'the oval\'s left end (x = −φ, 0.5 px)');
    near(Math.max(...xs(oval!)), 1 / PHI, 0.005, 'the oval\'s right end (x = 1/φ, 0.5 px)');
    expect(closes(branch!), 'the branch is open: it leaves the box').toBe(false);
    near(Math.min(...xs(branch!)), 1, 0.005, 'the branch turns at x = 1 (0.5 px)');
    const ends = [branch!.points[0]!, branch!.points[branch!.points.length - 1]!].map((p) => m.fy(p[1])).sort((a, b) => a - b);
    near(ends[0]!, -3, 0.005, 'the branch leaves the box at y = −3 (0.5 px)');
    near(ends[1]!, 3, 0.005, 'the branch leaves the box at y = 3 (0.5 px)');
    none(offCurve(g!, F.elliptic, SQUARE3), 'the drawn points');
    // Points of the curve, from its closed form: the oval for x in (−φ, 1/φ), the branch for x in (1, the box's edge).
    const rand = seeded(505_41);
    const top = branchX(9);
    const points: Pt[] = [];
    for (let k = 0; k < 500; k++) {
      const x = -PHI + (1 / PHI + PHI) * rand();
      points.push(toU(SQUARE3)(x, (rand() < 0.5 ? -1 : 1) * Math.sqrt(Math.max(0, x ** 3 - 2 * x + 1))));
      const xb = 1 + (top - 1) * rand();
      points.push(toU(SQUARE3)(xb, (rand() < 0.5 ? -1 : 1) * Math.sqrt(Math.max(0, xb ** 3 - 2 * xb + 1))));
    }
    none(missed(points, g!.subpaths), '1,000 seeded points of the oval and the branch');
    cellsWithin(g!);
  }, TIMEOUT);

  it(`${ID} over [−2, 2]² a circle of radius 0.02 at (1.5, 0), smaller than a level-5 cell, is found`, () => {
    // A level-5 cell of [−2, 2]² is 4 ÷ 2⁵ = 0.125 on a side; the circle's 0.04 fits inside one, corners and all.
    expect(0.04 < 4 / 2 ** 5, 'the circle is smaller than a level-5 cell').toBe(true);
    const bin = render();
    const doc = smallDoc();
    passes(bin, doc, SMALL);
    const [g] = fnAt(bin, doc, 'curve', [{}], SMALL);
    none(found(g!), 'the small circle');
  }, TIMEOUT);

  it(`${ID} a planted tracer that drops cells by corner signs misses the small circle and fails`, () => {
    const bin = render();
    const [g] = fnAt(bin, smallDoc(), 'curve', [{ planted: 'drops_cells_by_corner_signs' }], `${SMALL}, the planted tracer`);
    fails(found(g!), 'the small circle is found, on the planted tracer');
  }, TIMEOUT);

  it(`${ID} sin(1 ÷ (x·y)) = 0 near the origin hits the 16,384-cell cap and draws as an estimate with a notice naming its box`, () => {
    const bin = render();
    const doc = cappedDoc();
    const c = passes(bin, doc, CAPPED);
    const [g] = fnAt(bin, doc, 'curve', [{}], CAPPED);
    expect(g!.cells, `the trace reports its cells: ${show(g!.raw)}`).not.toBeNull();
    expect(g!.cells, 'the trace hits the 16,384-cell cap, and no more').toBe(16_384);
    const notices = estimates(g!.notices, 'curve');
    expect(notices.length, `an estimate notice names the curve: ${show(g!.notices as unknown as JsonValue)}`).toBeGreaterThan(0);
    const boxes = notices.map((n, i) => arr(n['box'], `the estimate notice ${i}: box`).map((v, k) => num(v, `box[${k}]`)));
    const inside = boxes.filter(([x0, y0, x1, y1]) => x0! < x1! && y0! < y1! && x0! >= -1 - 1e-9 && x1! <= 1 + 1e-9 && y0! >= -1 - 1e-9 && y1! <= 1 + 1e-9);
    expect(inside.length, `a box [x0, y0, x1, y1] inside [−1, 1]²: ${JSON.stringify(boxes)}`).toBeGreaterThan(0);
    expect(inside.some(([x0, y0, x1, y1]) => x0! <= 0 && x1! >= 0 && y0! <= 0 && y1! >= 0), `the box named holds the origin, where the trace can't settle: ${JSON.stringify(boxes)}`).toBe(true);
    expect(estimates(c.notices, 'curve').length, 'the check report carries the estimate notice too').toBeGreaterThan(0);
  }, TIMEOUT);
});

/** Why the small circle isn't found: one closed sub-path, every point within 0.5 u of it, 200 of its points within 0.5 u of the line. */
function found(g: FnGeometry): string[] {
  const out: string[] = [];
  if (g.subpaths.length !== 1) out.push(`${g.subpaths.length} sub-paths drawn, not one`);
  else if (!closes(g.subpaths[0]!)) out.push('the sub-path is not closed');
  out.push(...offCurve(g, F.small, SQUARE2));
  const rand = seeded(505_42);
  const circle = Array.from({ length: 200 }, () => { const th = 2 * Math.PI * rand(); return toU(SQUARE2)(1.5 + 0.02 * Math.cos(th), 0.02 * Math.sin(th)); });
  out.push(...missed(circle, g.subpaths));
  return out;
}
