import { describe, expect, it } from 'vitest';
import {
  LOOK, arr, check, clone, codeError, encodedRamp, errorsOf, expectClean, expectRefused, fixture, lookRole, obj,
  oklabRamp, paramsOf, pixel, raster, rasterInput, scratch, useRenderBinary, type Image, type Stop,
} from './helpers.ts';

useRenderBinary();
const dir = scratch('stroke');
const DOC = fixture('stroke-gradient.figure');

// The stroke: `M 20 40 L 532 40`, 24 u wide with butt caps, so its length is 512 u and rows 28–51 are
// wholly inside it. Its three stops run from w to e of its box, which here is arc length ÷ 512.
const STROKE: Stop[] = [
  { at: 0, color: lookRole('grad.a') }, { at: 0.5, color: lookRole('grad.b') }, { at: 1, color: lookRole('grad.c') },
];
/** The 32 sampled arc lengths: the centres of columns 28, 44, …, 524, on row 40. */
const SAMPLES = Array.from({ length: 32 }, (_, k) => 28 + 16 * k);

type Ramp = (stops: Stop[], t: number) => [number, number, number];

/** The criterion's check of the stroke: every sample within one code value of the ramp; failures name the arc length. */
function strokeFailures(read: (x: number) => [number, number, number], ramp: Ramp): string[] {
  const failures: string[] = [];
  for (const x of SAMPLES) {
    const s = x + 0.5 - 20;
    const expected = ramp(STROKE, s / 512);
    const actual = read(x);
    const e = codeError(actual, expected);
    if (e > 1) failures.push(`at arc length ${s} u the stroke reads ${JSON.stringify(actual)}, ${e.toFixed(2)} code values from its OKLab ramp's ${JSON.stringify(expected.map((v) => +v.toFixed(2)))}`);
  }
  return failures;
}

// The focal disc: a 384 u square at (20, 80), a radial gradient from its centre C (212, 272) out to
// radius r = 192, with its focal point F moved 0.4 r along 0°, to (288.8, 272). SVG's two-point form
// (SVG 1.1, radialGradient with fx, fy and fr = 0): the color at P is the ramp at the largest t ≥ 0
// for which P lies on the circle of centre F + t (C − F) and radius t r.
const C: [number, number] = [212, 272];
const R = 192;
const F: [number, number] = [C[0] + 0.4 * R, C[1]];
const RADIAL: Stop[] = [{ at: 0, color: lookRole('rad.from') }, { at: 1, color: lookRole('rad.to') }];

function svgFocalT(px: number, py: number): number {
  const d = [px - F[0], py - F[1]] as const; const e = [C[0] - F[0], C[1] - F[1]] as const;
  const a = e[0] * e[0] + e[1] * e[1] - R * R; // < 0: the focal point is inside the circle
  const de = d[0] * e[0] + d[1] * e[1]; const dd = d[0] * d[0] + d[1] * d[1];
  return (de - Math.sqrt(de * de - a * dd)) / a;
}
const plainT = (px: number, py: number): number => Math.hypot(px - C[0], py - C[1]) / R;

/** Every 16th pixel of the square, 4 px in from its edges. */
const GRID: [number, number][] = [];
for (let y = 84; y < 80 + 384 - 2; y += 16) for (let x = 24; x < 20 + 384 - 2; x += 16) GRID.push([x, y]);

function radialFailures(read: (x: number, y: number) => [number, number, number], t: (px: number, py: number) => number): string[] {
  const failures: string[] = [];
  for (const [x, y] of GRID) {
    const expected = oklabRamp(RADIAL, t(x + 0.5, y + 0.5));
    const actual = read(x, y);
    const e = codeError(actual, expected);
    if (e > 1) failures.push(`pixel (${x}, ${y}) reads ${JSON.stringify(actual)}, ${e.toFixed(2)} code values from the two-point form's ${JSON.stringify(expected.map((v) => +v.toFixed(2)))}`);
  }
  return failures;
}

const at = (image: Image) => (x: number, y = 40): [number, number, number] => pixel(image, x, y);

describe('AC1 a gradient stroke matches its OKLab ramp, a focal radial gradient matches SVG\'s two-point form, and a stroke naming a status role is refused', () => {
  it('AC1 a gradient stroke\'s color at 32 sampled arc lengths matches its OKLab ramp within one code value', () => {
    // The check can fail: the same stops mixed in sRGB-encoded space miss the ramp by up to 13 code values.
    const wrong = strokeFailures((x) => encodedRamp(STROKE, (x + 0.5 - 20) / 512), oklabRamp);
    expect(wrong.length, 'stops mixed in encoded sRGB fail this check').toBeGreaterThan(8);

    const { image } = raster(dir, DOC, LOOK, 'stroke-gradient');
    expect(strokeFailures(at(image), oklabRamp), 'the stroke at 32 arc lengths, against its OKLab ramp').toEqual([]);
    // The ramp runs along the stroke's length on every row of it, not only its centre line.
    for (const x of SAMPLES) {
      const row28 = pixel(image, x, 28); const row51 = pixel(image, x, 51);
      expect(codeError(row28, oklabRamp(STROKE, (x + 0.5 - 20) / 512)), `column ${x}, row 28 (the stroke's top row)`).toBeLessThanOrEqual(1);
      expect(codeError(row51, oklabRamp(STROKE, (x + 0.5 - 20) / 512)), `column ${x}, row 51 (the stroke's bottom row)`).toBeLessThanOrEqual(1);
    }
  }, 300_000);

  it('AC1 a focal radial gradient matches the two-point form SVG defines', () => {
    // The check can fail: the same gradient drawn without its focal point misses by up to 49 code values.
    const plain = radialFailures((x, y) => oklabRamp(RADIAL, plainT(x + 0.5, y + 0.5)), svgFocalT);
    expect(plain.length, 'a radial gradient that ignores its focal point fails this check').toBeGreaterThan(50);
    // The fixture really names the focal point the test computes with.
    const fill = obj(obj(paramsOf(DOC, 'focal-disc')['paint'], 'paint')['fill'], 'paint.fill');
    expect(obj(fill['gradient'], 'fill.gradient')['focal'], 'the fixture\'s focal point').toEqual({ length: 0.4, angle: 0 });

    const { image } = raster(dir, DOC, LOOK, 'stroke-gradient');
    expect(radialFailures((x, y) => pixel(image, x, y), svgFocalT), `${GRID.length} pixels of the focal disc, against SVG's two-point form`).toEqual([]);
  }, 300_000);

  it('AC1 a stroke naming a status role is refused, naming the item; the same stroke over data roles passes', () => {
    expectClean(DOC, LOOK, 'the stroke gradient over data roles');
    const planted = clone(DOC);
    const stroke = obj(obj(paramsOf(planted, 'stroke-ramp')['paint'], 'paint')['stroke'], 'paint.stroke');
    const stops = arr(obj(stroke['gradient'], 'stroke.gradient')['stops'], 'stroke.gradient.stops');
    obj(stops[1], 'stops[1]')['role'] = 'status.pass';
    const errors = errorsOf(check(planted, LOOK));
    expect(errors.map((e) => e.code), 'the only error is the status-color rule').toEqual(['status_color_unbound']);
    expect(errors[0]?.ids, 'the error names the stroke').toContain('stroke-ramp');
    expect(errors[0]?.path.startsWith('items/stroke-ramp/params/paint/stroke'), `the error's path is the stroke's, got ${errors[0]?.path}`).toBe(true);
    // A refused document is never drawn.
    expectRefused('raster', rasterInput(dir, planted, LOOK), 'status_color_unbound', 'the stroke names a status role');
  }, 300_000);
});
