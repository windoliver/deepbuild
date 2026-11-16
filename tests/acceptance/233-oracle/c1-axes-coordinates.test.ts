// Oracle lane, criterion 1 (AC1 #233.b6a28e06), port: a fork of the upstream math-film library at cfd33af5aa,
// tests/unit/mobjects/test_plotting.py:191-212, `test_coordinates_and_points_are_inverse`: Axes with any ranges and
// lengths map coordinates to points and back within 1e-8 × (1 + the largest coordinate), c2p alike.
//
// Upstream draws its cases by property search over x and y ranges (low in [−50, 50], width in [0.5, 100], step in
// [0.1, 10]) and lengths (x in [1, 12], y in [1, 7]); here four fixed cases spread over those domains, the criterion's
// own first. Each is a math.axes with a math.plot on it, at 1920 × 1080 u, drawn through `deep-canvas-render geometry`.
// "Coordinates to points": each axis's drawn tick marks against its shown tick values fit u = a + b·value, within 1e-6
// u, and b spans the axis's length in math@1 units (the frame's short side ÷ 8 each) over its range, x to the right and
// y up (so b < 0 in u). "And back": every on-curve point the plot draws reads back through those maps to (x, f(x)),
// x inside the range, within 1e-6 × (1 + its largest coordinate): upstream's 1e-8 is widened to what f64 geometry
// drawn in u keeps (README: Tolerances).
// Not ported: `axes @ coords` and `c2p` being one call (both are upstream's own call names, not ours); the reference
// project's graphical test_axes and test_plot_functions with their control frames, which are that renderer's pixels
// (criterion 1's golden is our own frame: README).
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, axesMap, back, drawnParts, mathDoc, none, onCurve, subpathsOf, unitOf, useBins, useFolders, type JsonObject, type P2 } from './helpers.ts';

const bin = useBins(['deep-show', 'deep-canvas-render']);
const folder = useFolders();
const SIZE: P2 = [1920, 1080];
interface Case { x: [number, number, number]; y: [number, number, number]; lengths: P2; f: string; fn: (x: number) => number }
const line = (x: [number, number, number], y: [number, number, number]): Pick<Case, 'f' | 'fn'> => {
  const k = (y[1] - y[0]) / (x[1] - x[0]);
  return { f: `(${y[0]}) + (${k}) * (x - (${x[0]}))`, fn: (v) => y[0] + k * (v - x[0]) };
};
const CASES: Case[] = [
  { x: [-3, 3, 1], y: [0, 9, 3], lengths: [8, 5], f: 'x^2', fn: (v) => v * v },
  { x: [-50, 50, 10], y: [-2, 3, 1], lengths: [12, 7], ...line([-50, 50, 10], [-2, 3, 1]) },
  { x: [0.5, 1.5, 0.25], y: [-40, 60, 20], lengths: [1, 3], ...line([0.5, 1.5, 0.25], [-40, 60, 20]) },
  { x: [-10, 90, 25], y: [5, 5.5, 0.1], lengths: [6, 2], ...line([-10, 90, 25], [5, 5.5, 0.1]) },
];

describe(`${AC[1]} (oracle, port) test_coordinates_and_points_are_inverse`, () => {
  for (const [n, c] of CASES.entries()) {
    it(`${AC[1]} case ${n + 1}: axes x ${JSON.stringify(c.x)}, y ${JSON.stringify(c.y)}, lengths ${c.lengths.join(' × ')}: coordinates map to points and back`, () => {
      const doc: JsonObject = mathDoc(`Axes, case ${n + 1}`, SIZE, {
        ax: { kind: 'math.axes@1', params: { x_range: c.x, y_range: c.y, x_length: c.lengths[0], y_length: c.lengths[1] } },
        curve: { kind: 'math.plot@1', params: { axes: 'ax', f: c.f } },
      });
      const { derived, geo, why } = drawnParts(bin('deep-show'), bin('deep-canvas-render'), folder, doc, ['ax', 'curve']);
      expect(why, 'the figure is presented and drawn').toBe('');
      const m = axesMap(derived, geo);
      none(m.failures, 'both axes draw their ticks');
      const unit = unitOf(SIZE);
      const failures: string[] = [];
      if (m.x!.residual > 1e-6) failures.push(`the x ticks stray ${m.x!.residual} u from one linear map`);
      if (m.y!.residual > 1e-6) failures.push(`the y ticks stray ${m.y!.residual} u from one linear map`);
      if (Math.abs(m.x!.b * (c.x[1] - c.x[0]) - c.lengths[0] * unit) > 1e-6) failures.push(`x spans ${m.x!.b * (c.x[1] - c.x[0])} u, not x_length ${c.lengths[0]} × ${unit} u`);
      if (Math.abs(-m.y!.b * (c.y[1] - c.y[0]) - c.lengths[1] * unit) > 1e-6) failures.push(`y spans ${-m.y!.b * (c.y[1] - c.y[0])} u upward, not y_length ${c.lengths[1]} × ${unit} u`);
      const points = Object.keys(derived).filter((id) => id.startsWith('curve')).flatMap((id) => subpathsOf(geo[id]!).flatMap(onCurve));
      if (points.length < 2) failures.push('the plot draws no curve');
      for (const p of points) {
        const x = back(m.x!, p[0]); const y = back(m.y!, p[1]);
        const tol = 1e-6 * (1 + Math.max(Math.abs(x), Math.abs(y)));
        if (x < c.x[0] - tol || x > c.x[1] + tol) failures.push(`a curve point reads back to x ${x}, outside [${c.x[0]}, ${c.x[1]}]`);
        else if (Math.abs(y - c.fn(x)) > tol) failures.push(`the curve point (${p.join(', ')}) u reads back to (${x}, ${y}), f(x) = ${c.fn(x)}`);
      }
      none(failures.slice(0, 20), 'coordinates and points are inverse');
    }, TIMEOUT);
  }
});
