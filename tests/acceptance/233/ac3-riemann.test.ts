// AC3 #233.1d713f1c: "`math.riemann {dx: 0.25, input_sample_type: center}` on x² over [0, 1] expands to 4 bars with
// heights 0.015625 to 0.765625"
//
// The figure (1920 × 1080 u): `ax`, math.axes {x_range: [0, 1, 0.25], y_range: [0, 1, 0.25], x_length: 8, y_length:
// 6}; `curve`, math.plot {axes: ax, f: "x^2", x_range: [0, 1]}; `bars`, math.riemann {plot: curve, dx: 0.25,
// input_sample_type: center} (README: Documents: the riemann's `plot`). `deep show` presents it; the drawn form goes to
// `deep-canvas-render geometry`. A bar is a derived item of `bars` that draws one closed axis-aligned rectangle (README:
// Reading the drawing). There are 4, and left to right their heights, in y units through the stated conversion (y_length
// 6 math@1 units of 1080 ÷ 8 u over a y range of 1: 810 u per y unit), are 0.015625, 0.140625, 0.390625 and 0.765625,
// f at each bar's centre, within 1e-9.
// Wrong programs: the base (no math@1); left or right samples (0, 0.0625, …; 0.0625, …, 1); a dx dropped for the
// upstream default 0.1 (10 bars); a bar per step of the axes' own ticks; heights not through the y scale.
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, bounds, derivedOf, docId, drawnForm, geometryOfAll, mathDoc, notPresented, present, run, scenario, subpathsOf, unitOf, useBins,
  useFolders, type Box, type P2,
} from './helpers.ts';

const bin = useBins(['deep-show', 'deep-canvas-render']);
const folder = useFolders();
const SIZE: P2 = [1920, 1080];
const PER_Y = (6 * unitOf(SIZE)) / 1; // y_length 6 units over the y range [0, 1]
const HEIGHTS = [0.015625, 0.140625, 0.390625, 0.765625];
const doc = mathDoc('Riemann bars under x squared', SIZE, {
  ax: { kind: 'math.axes@1', params: { x_range: [0, 1, 0.25], y_range: [0, 1, 0.25], x_length: 8, y_length: 6 } },
  curve: { kind: 'math.plot@1', params: { axes: 'ax', f: 'x^2', x_range: [0, 1] } },
  bars: { kind: 'math.riemann@1', params: { plot: 'curve', dx: 0.25, input_sample_type: 'center' } },
});

/** A closed sub-path whose corners are its box's four corners: the rectangle it draws, or null. */
function rectangle(points: P2[]): Box | null {
  if (points.length < 4) return null;
  const b = bounds(points);
  const onCorner = (p: P2): boolean => (Math.abs(p[0] - b[0]) <= 1e-6 || Math.abs(p[0] - b[0] - b[2]) <= 1e-6) && (Math.abs(p[1] - b[1]) <= 1e-6 || Math.abs(p[1] - b[1] - b[3]) <= 1e-6);
  return b[2] > 0 && b[3] > 0 && points.every(onCorner) ? b : null;
}

describe(`${AC[3]} Riemann bars under x² over [0, 1]`, () => {
  it(`${AC[3]} math.riemann {dx: 0.25, input_sample_type: center} expands to 4 bars of heights 0.015625, 0.140625, 0.390625 and 0.765625`, () => {
    const a = run(bin('deep-show'), scenario(folder(), [present(docId(1), doc)]));
    expect(a.ok, `deep-show run accepts the scenario: ${a.why}`).toBe(true);
    const shown = a.replies[0]!;
    expect(notPresented(shown), 'the Riemann figure is presented with no error').toBe('');
    const derived = derivedOf(shown, 'bars');
    const geo = geometryOfAll(bin('deep-canvas-render'), drawnForm(doc, shown), Object.keys(derived));
    // One bar per rectangle drawn, however many marks (a fill and a stroke) draw it.
    const drawnRects = Object.values(geo).flatMap((g) => subpathsOf(g).filter((s) => s.closed).map((s) => rectangle(s.points)).filter((b): b is Box => b !== null));
    const bars = [...new Map(drawnRects.map((b) => [b.map((v) => v.toFixed(4)).join(' '), b])).values()].sort((p, q) => p[0] - q[0]);
    expect(bars.length, `math.riemann draws 4 bars: ${bars.map((b) => b.map((v) => v.toFixed(2)).join(' ')).join('; ')}`).toBe(4);
    const heights = bars.map((b) => b[3] / PER_Y);
    const off = heights.flatMap((h, i) => (Math.abs(h - HEIGHTS[i]!) <= 1e-9 ? [] : [`bar ${i + 1} from the left is ${h} high, not ${HEIGHTS[i]}`]));
    expect(off, `the bars' heights, left to right, in y units (${PER_Y} u each): ${heights.join(', ')}`).toEqual([]);
  }, TIMEOUT);
});
