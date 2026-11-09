// AC6 #505.80c4ff9d (Oracle lane, port): "`#area.value` … within 1e-8" is "its integral by Gauss-Kronrod with an
// interval bound" (the issue's `fill`). Boost.Math f12be767c0's test/gauss_kronrod_quadrature_test.cpp runs
// gauss_kronrod<double, 15> on integrals with known values and checks each with BOOST_CHECK_CLOSE_FRACTION (relative)
// at a tolerance it states per case (expected_error<15>); test/adaptive_gauss_kronrod_quadrature_test.cpp runs the
// same integrands adaptively. Each case below is one of those integrals that a `fill` to the axis of a path fn can
// state: the integrand as the path's `y` over x (the closed function list's names), the range as `over` and the
// fill's `over`. Judged on `deep-canvas-render geometry`'s `area: {value, lo, hi}` (the #505 README's surface):
// `value` within Boost's GK15 tolerance of the known value, relative, and the interval bound [lo, hi] holding the
// known value (ours: "with an interval bound"). The known values are Boost's closed forms, computed here in f64.
//
// The tolerance is the fixed GK15 file's for double, not the adaptive file's 10·ε: that one is what an integrator
// run to its termination condition reaches, which the issue does not promise (its own bar is 1e-8). Where Boost's
// is looser than the criterion's 1e-8 (1e-7, 3.5e-3) Boost's stands: those are its integrands, not the criterion's x².
// No case's tolerance is tighter than f64 GK15 allows: Boost's own double, 15-point run passes each.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, document, fnAt, item, look, passes, scale, show, stroke, useRender, type JsonObject } from './helpers.ts';

const render = useRender();
const ID = AC[6];
const EPS = 2 ** -52;

interface Case { name: string; where: string; y: string; over: [number, number]; ymax: number; exact: number; tol: number }
/** Boost's cases, by its test function and line in gauss_kronrod_quadrature_test.cpp. */
const CASES: Case[] = [
  { name: 'test_linear: 5x + 7 over [0, 1]', where: 'lines 265-271', y: '5 * x + 7', over: [0, 1], ymax: 12, exact: 9.5, tol: 10 * EPS },
  { name: 'test_quadratic: 5x² + 7x + 12 over [0, 1]', where: 'lines 289-292', y: '5 * x^2 + 7 * x + 12', over: [0, 1], ymax: 24, exact: 17 + 1 / 6, tol: 10 * EPS },
  { name: 'test_ca f2: atan(√(x² + 1)) ÷ ((x² + 1)·√(x² + 1)) over [0, 1]', where: 'lines 312-315', y: 'atan(sqrt(x^2 + 1)) / ((x^2 + 1) * sqrt(x^2 + 1))', over: [0, 1], ymax: 1, exact: Math.PI / 4 - Math.PI / Math.SQRT2 + (3 * Math.atan(Math.SQRT2)) / Math.SQRT2, tol: 1e-7 },
  { name: 'test_three_quadrature_schemes_examples 1: t·log1p(t) over [0, 1]', where: 'lines 334-337', y: 'x * log1p(x)', over: [0, 1], ymax: 1, exact: 0.25, tol: 1e-8 },
  { name: 'test_three_quadrature_schemes_examples 2: t²·atan(t) over [0, 1]', where: 'lines 341-344', y: 'x^2 * atan(x)', over: [0, 1], ymax: 1, exact: (Math.PI - 2 + 2 * Math.LN2) / 12, tol: 2 * 1e-8 },
  { name: 'test_three_quadrature_schemes_examples 3: eᵗ·cos(t) over [0, π/2]', where: 'lines 347-350', y: 'exp(x) * cos(x)', over: [0, Math.PI / 2], ymax: 2, exact: Math.expm1(Math.PI / 2) / 2, tol: 1e-8 },
  { name: 'test_three_quadrature_schemes_examples 4: atan(√(x² + 2)) ÷ (√(x² + 2)·(x² + 1)) over [0, 1]', where: 'lines 353-356', y: 'atan(sqrt(x^2 + 2)) / (sqrt(x^2 + 2) * (x^2 + 1))', over: [0, 1], ymax: 1, exact: (5 * Math.PI * Math.PI) / 96, tol: 1e-8 },
  { name: 'test_three_quadrature_schemes_examples 6: √(1 − t²) over [0, 1]', where: 'lines 366-369', y: 'sqrt(1 - x^2)', over: [0, 1], ymax: 1, exact: Math.PI / 4, tol: 3.5e-3 },
];

/** y over `over` filled to the axis, 400 u a side through scales holding [0, ymax]. */
const areaDoc = (c: Case, i: number): JsonObject => document(`boost-gk-${i}`, `The area under ${c.y}`, [480, 480], [
  scale('ax', 'a0', c.over, [40, 440]),
  scale('ay', 'a1', [0, c.ymax], [440, 40]),
  item('area', 'path@1', 'b0', {
    fn: { y: c.y, over: c.over, scales: { x: 'ax', y: 'ay' } },
    fill: { to: 'axis', over: c.over },
    paint: { ...stroke('ink', 1), fill: { role: 'ink' } },
  }),
]);

describe(`${ID} Boost.Math's Gauss-Kronrod integrals (f12be767c0) as the area under a path fn`, () => {
  CASES.forEach((c, i) => {
    it(`${ID} ${c.name} (${c.where}): #area.value within ${c.tol.toExponential(2)} relative of ${c.exact}, and its interval bound holds it`, () => {
      const bin = render();
      const doc = areaDoc(c, i);
      passes(bin, doc, look(), c.y);
      const [g] = fnAt(bin, doc, 'area', [{}], c.y);
      expect(g!.area, `the curve answers #area: ${show(g!.raw)}`).not.toBeNull();
      const { value, lo, hi } = g!.area!;
      expect(Math.abs(value - c.exact) / Math.abs(c.exact), `#area.value ${value} against Boost's ${c.exact} (BOOST_CHECK_CLOSE_FRACTION at ${c.tol})`).toBeLessThanOrEqual(c.tol);
      expect(lo <= c.exact && c.exact <= hi, `the interval bound [${lo}, ${hi}] holds ${c.exact}`).toBe(true);
      expect(lo <= value && value <= hi, `the bound [${lo}, ${hi}] holds #area.value ${value}`).toBe(true);
    }, TIMEOUT);
  });
});
