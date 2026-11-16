// Oracle lane, criterion 3 (AC3 #233.1d713f1c), port: a fork of the upstream math-film library at cfd33af5aa,
// tests/unit/mobjects/test_plotting.py:245-288, `test_riemann_rectangles_span_their_sample_and_base_on_transformed_axes`:
// each rectangle spans its dx and rises from its base to f at its left, centre or right sample, within 1e-12.
//
// Ported cases, each a math.axes, a math.plot on it and a math.riemann on the plot, at 1920 × 1080 u, drawn through
// `deep-canvas-render geometry`; each bar (a closed axis-aligned rectangle a derived item of the riemann draws) read
// back to coordinates through the axes' drawn tick maps (README: Reading the drawing):
//   - upstream's own: axes x [−2, 2], y [−2, 3], no tips; f(x) = x² − 0.25 over [−1, 1], dx 1, samples left and right:
//     two bars, over [−1, 0] and [0, 1], each from 0 to f at its sample;
//   - the criterion's: axes x [0, 1, 0.25], y [0, 1, 0.25]; x² over [0, 1], dx 0.25, samples center and right: four
//     bars, over [k/4, (k + 1)/4], each from 0 to f at its sample (with center, criterion 3's 0.015625 … 0.765625).
// Each edge reads back within 1e-9 of its coordinate (upstream's 1e-12, widened to what u in f64 keeps: README:
// Tolerances).
// Not ported: upstream's center case on x² − 0.25 with dx 1 (its two samples, ±0.5, are roots, so both bars have no
// height), and left samples on x² over [0, 1] (the first sample, 0, is a root: a bar of no height); its bounded_graph (a
// parameter the issue's math.riemann doesn't list); the axes turned, scaled and moved before plotting; the fill opacity
// and stroke width; the reference project's graphical test_get_riemann_rectangles, whose control frames are that
// renderer's pixels.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, axesMap, back, bounds, drawnParts, mathDoc, none, subpathsOf, useBins, useFolders, type Box, type P2 } from './helpers.ts';

const bin = useBins(['deep-show', 'deep-canvas-render']);
const folder = useFolders();
const SIZE: P2 = [1920, 1080];
const OFFSET = { left: 0, center: 0.5, right: 1 } as const;
interface Case { name: string; x: number[]; y: number[]; f: string; fn: (x: number) => number; over: P2; dx: number; tips?: boolean }
const CASES: Case[] = [
  { name: 'upstream: x² − 0.25 over [−1, 1], dx 1', x: [-2, 2, 1], y: [-2, 3, 1], f: 'x^2 - 0.25', fn: (v) => v * v - 0.25, over: [-1, 1], dx: 1, tips: false },
  { name: 'the criterion\'s: x² over [0, 1], dx 0.25', x: [0, 1, 0.25], y: [0, 1, 0.25], f: 'x^2', fn: (v) => v * v, over: [0, 1], dx: 0.25 },
];
function rectangle(points: P2[]): Box | null {
  if (points.length < 4) return null;
  const b = bounds(points);
  const on = (p: P2): boolean => (Math.abs(p[0] - b[0]) <= 1e-6 || Math.abs(p[0] - b[0] - b[2]) <= 1e-6) && (Math.abs(p[1] - b[1]) <= 1e-6 || Math.abs(p[1] - b[1] - b[3]) <= 1e-6);
  return b[2] > 0 && points.every(on) ? b : null;
}

describe(`${AC[3]} (oracle, port) Riemann rectangles span their dx and rise to f at their sample`, () => {
  for (const c of CASES) {
    for (const sample of (c.dx === 1 ? ['left', 'right'] : ['center', 'right']) as (keyof typeof OFFSET)[]) {
      it(`${AC[3]} ${c.name}, ${sample} samples: each bar spans its dx and rises from 0 to f at its sample`, () => {
        const doc = mathDoc(`Riemann bars, ${sample}`, SIZE, {
          ax: { kind: 'math.axes@1', params: { x_range: c.x, y_range: c.y, ...(c.tips === false ? { tips: false } : {}) } },
          curve: { kind: 'math.plot@1', params: { axes: 'ax', f: c.f, x_range: c.over } },
          bars: { kind: 'math.riemann@1', params: { plot: 'curve', dx: c.dx, input_sample_type: sample } },
        });
        const { derived, geo, why } = drawnParts(bin('deep-show'), bin('deep-canvas-render'), folder, doc, ['ax', 'bars']);
        expect(why, 'the figure is presented and drawn').toBe('');
        const m = axesMap(derived, geo);
        none(m.failures, 'both axes draw their ticks');
        const rects = Object.keys(derived).filter((id) => id.startsWith('bars')).flatMap((id) => subpathsOf(geo[id]!).filter((s) => s.closed).map((s) => rectangle(s.points)).filter((b): b is Box => b !== null));
        const bars = [...new Map(rects.map((b) => [b.map((v) => v.toFixed(4)).join(' '), b])).values()].sort((p, q) => p[0] - q[0]);
        const n = Math.round((c.over[1] - c.over[0]) / c.dx);
        expect(bars.length, `${n} bars`).toBe(n);
        const failures: string[] = [];
        bars.forEach((b, k) => {
          const x0 = c.over[0] + k * c.dx;
          const top = c.fn(x0 + OFFSET[sample] * c.dx);
          const [lo, hi] = [Math.min(0, top), Math.max(0, top)];
          const read = { left: back(m.x!, b[0]), right: back(m.x!, b[0] + b[2]), bottom: back(m.y!, b[1] + b[3]), top: back(m.y!, b[1]) };
          for (const [edge, want] of [['left', x0], ['right', x0 + c.dx], ['bottom', lo], ['top', hi]] as const) {
            if (Math.abs(read[edge] - want) > 1e-9) failures.push(`bar ${k + 1}'s ${edge} reads ${read[edge]}, not ${want}`);
          }
        });
        none(failures, 'each bar spans its dx and rises to f at its sample');
      }, TIMEOUT);
    }
  }
});
