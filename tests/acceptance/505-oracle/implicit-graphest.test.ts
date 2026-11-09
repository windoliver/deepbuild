// AC4 #505.00692b98 (Oracle lane, port): graphest 0a2e4808a6 traces implicit relations by interval arithmetic over a
// subdivision of the plane and compares each plot with a reference PNG (rust/tests/graph_tests/reference): white where
// it proved no solution, black where it could not. examples.rs's two products of circles, both @bounds(-3, 3, -3, 3)
// on graph.rs's default 1024 × 1024: t_0b3b446edb104b2680bdb05fcdbef602, twenty-five circles of radius √0.4 at the
// integer points of [−2, 2]², each one factor of a product (the Oracle page's "products of small circles"), and
// t_b8b04a37eaf64d0491cc2b1e6ee7bb1b, four lines and three circles of radius √10 / 5 in one product. The references
// are copied unchanged into fixtures/graphest/. In both, every black pixel holds a point of the zero set and every
// pixel that holds one is black (checked against the factors' closed forms when the fixtures were taken; the README
// says how), so the reference is the curve at its pixel scale.
//
// Ours traces the same expression as a path fn `zero` (the #505 README's implicit form) over the same box, drawn at
// 256 u a side: one u is four reference pixels, so 0.5 px of ours is two of theirs. Judged on our output: every drawn
// point lies within 0.5 u of a black pixel (graphest proved the white ones hold no solution), and every black pixel
// lies within 0.5 u of the drawn line (a piece ours misses, such as a whole circle a tracer dropped, leaves its pixels
// far from the line), with no estimate notice. At this scale the trace needs on the order of 10⁵ cells, past the
// default cap, so the documents set the issue's own field `max_cells` to 262,144 (README: Choices).
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, Drawn, document, estimates, fnAt, item, look, nearBlack, none, passes, pixelBox, reference, scale, show, stroke, useRender, type JsonValue,
} from './helpers.ts';

const render = useRender();
const ID = AC[4];
/** Our side in u, and reference pixels per u. */
const SIDE = 256;
const K = 1024 / SIDE;
const MAX_CELLS = 262_144;

const shift = (v: string, c: number): string => (c === 0 ? v : c > 0 ? `(${v} - ${c})` : `(${v} + ${-c})`);
/** graphest's 25-circle product, factor by factor in its order: (x − 2) with y − 2 … y + 2, then x − 1, …, x + 2. */
const CIRCLES = [2, 1, 0, -1, -2].flatMap((cx) => [2, 1, 0, -1, -2].map((cy) => `(${shift('x', cx)}^2 + ${shift('y', cy)}^2 - 0.4)`)).join(' * ');
/** graphest's (2y−x−1)(2y−x+1)(2x+y−1)(2x+y+1)((5x−2)²+(5y−6)²−10)((5x)²+(5y)²−10)((5x+2)²+(5y+6)²−10). */
const LINES_AND_CIRCLES = '(2 * y - x - 1) * (2 * y - x + 1) * (2 * x + y - 1) * (2 * x + y + 1) * ((5 * x - 2)^2 + (5 * y - 6)^2 - 10) * ((5 * x)^2 + (5 * y)^2 - 10) * ((5 * x + 2)^2 + (5 * y + 6)^2 - 10)';

const traced = (id: string, zero: string) => document(id, `${id}: the zero set of a product`, [SIDE, SIDE], [
  scale('ix', 'a0', [-3, 3], [0, SIDE]),
  scale('iy', 'a1', [-3, 3], [SIDE, 0]),
  item('curve', 'path@1', 'b0', { fn: { zero, over_x: [-3, 3], over_y: [-3, 3], max_cells: MAX_CELLS, scales: { x: 'ix', y: 'iy' } }, paint: stroke('ink', 1) }),
]);

function againstReference(id: string, zero: string, refName: string): void {
  const bin = render();
  const doc = traced(id, zero);
  passes(bin, doc, look(), id);
  const [g] = fnAt(bin, doc, 'curve', [{}], id);
  expect(estimates(g!.notices, 'curve'), `no estimate notice: ${show(g!.notices as unknown as JsonValue)}`).toEqual([]);
  expect(g!.cells, `the trace reports its cells: ${show(g!.raw)}`).not.toBeNull();
  expect(g!.cells!, `the trace takes at most max_cells (${MAX_CELLS}) cells`).toBeLessThanOrEqual(MAX_CELLS);
  expect(g!.subpaths.length, 'it draws').toBeGreaterThan(0);
  const ref = reference(refName);
  const failures: string[] = [];
  g!.subpaths.forEach((s, i) => s.points.forEach((p) => {
    if (!nearBlack(ref, p, K, 0.5)) failures.push(`sub-path ${i}: the drawn point (${p[0].toFixed(3)}, ${p[1].toFixed(3)}) u is more than 0.5 u from every pixel the reference leaves black`);
  }));
  const drawn = new Drawn(g!.subpaths);
  for (const [c, r] of ref.blacks) {
    const d = drawn.toBox(pixelBox(c, r, K), 0.5);
    if (!(d <= 0.5)) failures.push(`the reference's black pixel (${c}, ${r}), at x ${(-3 + (c + 0.5) * 6 / 1024).toFixed(4)}, y ${(3 - (r + 0.5) * 6 / 1024).toFixed(4)}, is ${Number.isFinite(d) ? d.toFixed(3) : 'more than 0.5'} u from the drawn line`);
  }
  none(failures, `${id} against graphest ${refName}`);
}

describe(`${ID} graphest's reference plots of products of circles, run against our traced curve`, () => {
  it(`${ID} twenty-five circles of radius √0.4 (graphest t_0b3b446edb104b2680bdb05fcdbef602): every drawn point within 0.5 px of a black reference pixel and every black pixel within 0.5 px of the line`, () => {
    againstReference('graphest-circles', CIRCLES, 't_0b3b446edb104b2680bdb05fcdbef602.png');
  }, TIMEOUT);

  it(`${ID} four lines and three circles (graphest t_b8b04a37eaf64d0491cc2b1e6ee7bb1b): every drawn point within 0.5 px of a black reference pixel and every black pixel within 0.5 px of the line`, () => {
    againstReference('graphest-lines-and-circles', LINES_AND_CIRCLES, 't_b8b04a37eaf64d0491cc2b1e6ee7bb1b.png');
  }, TIMEOUT);
});
