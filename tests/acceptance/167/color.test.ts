// AC8 #167.48674636: "A linear scale over [0, 1] whose range is [blue, yellow] colors 0.5 at the two roles' OKLab
// midpoint within 0.001 ΔEOK, and a quantize scale over the same roles still gives one role per band"
//
// Roles `blue` (0, 0, 255) and `yellow` (255, 255, 0) in the look. Expected values from OKLab's published formula,
// calibrated here on two published values: palette 71011dee47's reference for sRGB blue, and the oracle page's WPT
// 2f57f45d21 color-mix of white and blue, oklab(0.726 -0.016 -0.156). An 8-bit pixel can't resolve 0.001 ΔEOK, so
// `geometry`'s rows answer each row's color unrounded as `oklab`, and `raster` must draw that color within one code.
// Quantize: d3-scale 83555bd759's bands (test/quantize-test.js), read from the pixels, which must be the roles exactly.
import { describe, expect, it } from 'vitest';
import {
  AC, BLUE, LOOK, TIMEOUT, YELLOW, deltaEok, document, f32Column, i32Column, item, midpoint, oklab, passes, pixel, quantizeBand, rasterAt, readPng, rowsAt, same, srgbOf, useRender, useTemp, type JsonObject, type Rgb,
} from './helpers.ts';

const render = useRender();
const temp = useTemp('color');
const ID = AC[8];

/** One 40 u cell per value in a row, whose role comes through `scale@1` `ramp`. */
function cells(values: number[], scale: JsonObject): JsonObject {
  const xs = values.map((_, i) => 10 + i * 40);
  return document('ramp-167', 'Cells colored through a scale', [20 + values.length * 40, 60], 1, [
    item('ramp', 'scale@1', 'a0', scale),
    item('cells', 'marks@1', 'b0', {
      mark: 'rect', n: values.length, key: 'key',
      columns: { key: i32Column(values.map((_, i) => i)), x: f32Column(xs), x2: f32Column(xs.map((x) => x + 40)), v: f32Column(values) },
      encode: { x: { column: 'x' }, x2: { column: 'x2' }, y: 10, y2: 50, role: { column: 'v', scale: 'ramp' } },
    }),
  ]);
}
const center = (i: number): [number, number] => [30 + i * 40, 30];

describe(`${ID} a linear scale over palette roles is a colormap, and quantize keeps bands`, () => {
  it(`${ID} (midpoint) a linear scale colors 0.5 at the roles' OKLab midpoint within 0.001 ΔEOK, and its ends at the roles`, () => {
    const blue = oklab(BLUE);
    const yellow = oklab(YELLOW);
    expect(deltaEok(blue, [0.4520137183853429, -0.032456984168764, -0.3115281476783751]), 'the formula gives palette\'s sRGB blue').toBeLessThan(1e-4);
    expect(deltaEok(midpoint(oklab([255, 255, 255]), blue), [0.726, -0.016, -0.156]), 'the formula gives WPT\'s white and blue midpoint').toBeLessThan(0.001);
    const mid = midpoint(blue, yellow);
    const expected = srgbOf(mid);
    expect(expected.every((c) => c >= 0 && c <= 1), `the midpoint is in sRGB: ${expected.join(' ')}`).toBe(true);
    const gamma: Rgb = [128, 128, 128];
    expect(deltaEok(oklab(gamma), mid), 'a mix in encoded sRGB lands far from the midpoint, so the check can see one').toBeGreaterThan(0.05);
    const doc = cells([0, 0.5, 1], { type: 'linear', domain: [0, 1], range: ['blue', 'yellow'], nice: false });
    const bin = render();
    passes(bin, doc, LOOK, 'the colormap');
    const rows = rowsAt(bin, doc, 'cells', [0], LOOK)[0]!;
    const reported = [0, 1, 2].map((k) => { const lab = rows[String(k)]!.oklab; expect(lab, `row ${k} answers its color`).not.toBeNull(); return lab!; });
    expect(deltaEok(reported[1]!, mid), `0.5 at the midpoint ${mid.join(' ')}: ${reported[1]!.join(' ')}`).toBeLessThanOrEqual(0.001);
    expect(deltaEok(reported[0]!, blue), '0 at blue').toBeLessThanOrEqual(0.001);
    expect(deltaEok(reported[2]!, yellow), '1 at yellow').toBeLessThanOrEqual(0.001);
    const drawn = pixel(readPng(rasterAt(bin, doc, [0], LOOK, temp(), 'ramp')[0]!.out), ...center(1));
    const want = expected.map((c) => Math.round(c * 255));
    expect(drawn.every((c, i) => Math.abs(c - want[i]!) <= 1), `the middle cell is drawn at ${want.join(' ')} within one code: ${drawn.join(' ')}`).toBe(true);
  }, TIMEOUT);

  it(`${ID} (quantize) a quantize scale over the same roles gives one role per band`, () => {
    const values = [0, 0.25, 0.49, 0.5, 0.75, 1];
    const doc = cells(values, { type: 'quantize', domain: [0, 1], range: ['blue', 'yellow'], nice: false });
    const bin = render();
    passes(bin, doc, LOOK, 'the quantized cells');
    const image = readPng(rasterAt(bin, doc, [0], LOOK, temp(), 'bands')[0]!.out);
    values.forEach((v, i) => {
      const want = [BLUE, YELLOW][quantizeBand(v, [0, 1], 2)]!;
      const got = pixel(image, ...center(i));
      expect(same(got, want), `${v} takes its band's role ${want.join(' ')}: ${got.join(' ')}`).toBe(true);
    });
  }, TIMEOUT);
});
