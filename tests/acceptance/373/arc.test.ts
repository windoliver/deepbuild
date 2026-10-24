import { describe, expect, it } from 'vitest';
import { LOOK, fixture, pixel, raster, same, scratch, useRenderBinary, type Image, type Rgb } from './helpers.ts';

useRenderBinary();
const dir = scratch('arc');
const DOC = fixture('arcs.figure');
const INK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];
const QUARTER = (Math.PI * 100 * 100) / 4; // 7,853.98 u²: the sector
const SEGMENT = QUARTER - (100 * 100) / 2; // 2,853.98 u²: the same arc closed along its chord

/**
 * The point `d` u out from `center` along 45°. The design doesn't say which way degrees turn in 2D, so
 * the arc from 0° to 90° may sweep toward +y (s = 1) or −y (s = −1); the sector's raster says which,
 * and every later sample uses the same s.
 */
const along45 = (center: [number, number], d: number, s: number): [number, number] => [center[0] + d * Math.SQRT1_2, center[1] + s * d * Math.SQRT1_2];

/**
 * The covered area in [x0, x0 + 256) × [0, 256), in u² at zoom 1: each pixel's coverage read back from
 * ink over white as (255 − value) ÷ 255, since 2D composites in sRGB-encoded space (canvas core:
 * Conventions).
 */
function area(image: Image, x0: number): number {
  let sum = 0;
  for (let y = 0; y < 256; y++) for (let x = x0; x < x0 + 256; x++) sum += (255 - pixel(image, x, y)[0]) / 255;
  return sum;
}

/** The criterion's check of the filled sector: its sample is covered and its area is 7,854 u² within 0.5%. */
function sectorFailures(image: Image, s: number): string[] {
  const failures: string[] = [];
  const [x, y] = along45([128, 128], 50, s);
  const got = pixel(image, x, y);
  if (!same(got, INK)) failures.push(`the sample 50 u out along 45°, pixel (${Math.floor(x)}, ${Math.floor(y)}), reads ${JSON.stringify(got)}, not covered`);
  const a = area(image, 0);
  if (Math.abs(a - QUARTER) > 0.005 * QUARTER) failures.push(`the sector covers ${a.toFixed(1)} u², not 7,854 u² within 0.5%`);
  return failures;
}

/** Which way the arc sweeps: the sign whose 45° sample the sector covers (the other must be empty). */
function sweep(image: Image): number {
  const down = pixel(image, ...along45([128, 128], 50, 1)); const up = pixel(image, ...along45([128, 128], 50, -1));
  expect([same(down, INK), same(up, INK)].filter(Boolean).length, `exactly one of the two 45° samples (toward +y and toward −y) is covered: ${JSON.stringify([down, up])}`).toBe(1);
  return same(down, INK) ? 1 : -1;
}

describe('AC5 a filled arc closes through the centre (a sector) or along inner_r (a ring sector), and an unfilled arc\'s stroke stays open', () => {
  it('AC5 a filled circle@1 with r 100 u and arc {from: 0, to: 90} covers the sample 50 u out along 45°, and its area is 7,854 u² within 0.5%', () => {
    const { image } = raster(dir, DOC, LOOK, 'arcs.figure');
    const s = sweep(image);
    expect(sectorFailures(image, s), 'the sector').toEqual([]);
  }, 300_000);

  it('AC5 a twin closed along the chord covers 2,854 u², misses that sample, and fails', () => {
    const s = sweep(raster(dir, DOC, LOOK, 'arcs.figure').image);
    const { image } = raster(dir, DOC, LOOK, 'arcs.figure with the arc closed along its chord', { planted: 'arc_closed_along_chord' });
    const a = area(image, 0);
    expect(Math.abs(a - SEGMENT), `the twin covers ${a.toFixed(1)} u², the segment's 2,854 u² within 0.5%`).toBeLessThanOrEqual(0.005 * SEGMENT);
    const [x, y] = along45([128, 128], 50, s);
    expect(pixel(image, x, y), 'the twin misses the sample 50 u out along 45°').toEqual(WHITE);
    const failures = sectorFailures(image, s);
    expect(failures.length, `the sector's check fails on the twin: ${JSON.stringify(failures)}`).toBe(2);
  }, 300_000);

  it('AC5 with inner_r: 50 the sample 25 u out is empty', () => {
    const { image } = raster(dir, DOC, LOOK, 'arcs.figure');
    const s = sweep(image);
    for (const sign of [1, -1]) expect(pixel(image, ...along45([384, 128], 25, sign)), `the ring sector's sample 25 u out along 45° (s = ${sign}) is empty`).toEqual(WHITE);
    // It is a ring sector, not nothing: the sample 75 u out, between the radii, is covered.
    expect(pixel(image, ...along45([384, 128], 75, s)), 'the ring sector covers the sample 75 u out along 45°').toEqual(INK);
    expect(pixel(image, ...along45([384, 128], 75, -s)), 'and not its mirror, outside the arc').toEqual(WHITE);
  }, 300_000);

  it('AC5 with no fill, no stroked pixel lies within 40 u of the centre', () => {
    const { image } = raster(dir, DOC, LOOK, 'arcs.figure');
    const s = sweep(image);
    const near: string[] = [];
    for (let y = 88; y < 168; y++) for (let x = 600; x < 680; x++) {
      if (Math.hypot(x + 0.5 - 640, y + 0.5 - 128) > 40) continue;
      const got = pixel(image, x, y);
      if (!same(got, WHITE)) near.push(`(${x}, ${y}) reads ${JSON.stringify(got)}`);
    }
    expect(near.slice(0, 10), 'pixels within 40 u of the open arc\'s centre').toEqual([]);
    // The stroke is drawn along the arc: the point on it at 45° is inked.
    const [x, y] = along45([640, 128], 100, s);
    expect(pixel(image, x, y)[0] < 128, `the stroke along the arc, at (${Math.floor(x)}, ${Math.floor(y)}), is drawn: ${JSON.stringify(pixel(image, x, y))}`).toBe(true);
  }, 300_000);
});
