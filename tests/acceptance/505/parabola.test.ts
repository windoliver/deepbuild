// AC2 #505.32c898a2: "y = a·x² over [−2, 2] with a bound to a slider draws within 0.5 px of the true parabola at 1,000
// checked x values, redraws in the frame the slider moves from 0.5 to 2, and with a = 2 its probe at x = 1.5 reads
// y = 4.5 and slope 6 within 1e-6"
//
// A path@1 with `fn: {y: "a * x^2", over: [-2, 2], vars: {a: "controls/a/value"}, scales}`, the slider `a` declared
// over [0.5, 2] at 0.5, and one entry of yours moving it to 2 at 1 s (the request's `input`, the input track the
// document reads). The scales put x at 100 u and y at 50 u per unit, so 0.5 u is 0.5 px at zoom 1. `geometry` gives
// the drawn sub-paths in u and the probe's anchor (README: `geometry`). "Within 0.5 px of the true parabola at 1,000
// checked x" is: each of 1,000 seeded x's point (x, a·x²), mapped through the scales, lies within 0.5 u of the drawn
// line, and every drawn point lies within 0.5 u of the curve. "In the frame the slider moves" is the frame at the
// entry's own flick: one flick before it the curve is a = 0.5's, at it a = 2's. No upstream test (oracle page).
import { describe, expect, it } from 'vitest';
import { PARABOLA, T, parabolaDoc, parabolaU } from './docs.ts';
import {
  AC, TIMEOUT, dist, entry, fnAt, near, none, passes, pointCount, seededIn, toDrawn, useRender, type FnGeometry, type Pt,
} from './helpers.ts';

const render = useRender();
const ID = AC[2];
const INPUT = [entry(T, 1, 'a', 2)];
const XS = seededIn(505_2, 1000, PARABOLA.x[0], PARABOLA.x[1]);
const at = (a: number, x: number): Pt => [parabolaU.x(x), parabolaU.y(a * x * x)];

/** Where the drawn line and the parabola y = a·x² part by more than 0.5 u. */
function apart(g: FnGeometry, a: number): string[] {
  const out: string[] = [];
  for (const x of XS) {
    const d = toDrawn(at(a, x), g.subpaths);
    if (!(d <= 0.5)) out.push(`x = ${x}: the curve's point is ${d.toFixed(3)} u from the drawn line`);
  }
  for (const [u, v] of g.subpaths.flatMap((s) => s.points)) {
    const x = (u - PARABOLA.ux[0]) / 100 + PARABOLA.x[0];
    const d = dist([u, v], at(a, x));
    if (!(d <= 0.5)) out.push(`the drawn point (${u}, ${v}) is ${d.toFixed(3)} u off the curve at its x`);
  }
  if (pointCount(g.subpaths) > 2000) out.push(`the curve draws ${pointCount(g.subpaths)} points, past 2,000`);
  if (g.subpaths.length === 0) out.push('the curve draws nothing');
  return out;
}

describe(`${ID} y = a·x² bound to a slider`, () => {
  it(`${ID} draws within 0.5 px of the true parabola at 1,000 checked x, and redraws in the frame the slider moves from 0.5 to 2`, () => {
    const bin = render();
    const doc = parabolaDoc();
    passes(bin, doc, 'the parabola with its slider', { input: INPUT });
    const [before, moved] = fnAt(bin, doc, 'curve', [{ t: T - 1, input: INPUT }, { t: T, input: INPUT }], 'the parabola');
    none(apart(before!, 0.5), 'one flick before the slider moves, the curve is y = 0.5·x² within 0.5 px');
    none(apart(moved!, 2), 'in the frame the slider moves to 2, the curve is y = 2·x² within 0.5 px');
  }, TIMEOUT);

  it(`${ID} with a = 2 its probe at x = 1.5 reads y = 4.5 and slope 6 within 1e-6`, () => {
    const bin = render();
    const doc = parabolaDoc();
    const [before, moved] = fnAt(bin, doc, 'curve', [{ t: T - 1, input: INPUT }, { t: T, input: INPUT }], 'the parabola');
    const p = moved!.anchors['p'];
    expect(p, `the probe p is a read-only anchor of the curve: ${JSON.stringify(moved!.raw).slice(0, 600)}`).toBeDefined();
    near(p!.x, 1.5, 1e-6, 'a = 2: the probe\'s x');
    near(p!.y, 4.5, 1e-6, 'a = 2: the probe\'s y');
    near(p!.slope, 6, 1e-6, 'a = 2: the probe\'s slope');
    expect(dist(p!.at, at(2, 1.5)), 'a = 2: the probe\'s anchor sits on the curve at x = 1.5, in u').toBeLessThanOrEqual(0.5);
    expect(dist(p!.foot, [parabolaU.x(1.5), parabolaU.y(0)]), 'a = 2: its foot is on the x axis below it').toBeLessThanOrEqual(0.5);
    // The probe reads the one formula: before the slider moves it reads a = 0.5's curve.
    const q = before!.anchors['p'];
    expect(q, 'the probe before the slider moves').toBeDefined();
    near(q!.y, 1.125, 1e-6, 'a = 0.5: the probe\'s y');
    near(q!.slope, 1.5, 1e-6, 'a = 0.5: the probe\'s slope');
  }, TIMEOUT);
});
