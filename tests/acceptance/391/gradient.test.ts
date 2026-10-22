import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { pixel, readPng, render, useBinaries, type Image, type JsonObject } from './helpers.ts';

useBinaries('deep-canvas-render');

// A 255 px wide gradient, so pixel 127's center sits at exactly half the way (127.5 / 255).
const W = 255;
const H = 32;
const MID = 127;
const GREY = 51; // sRGB 0.2
const scratch = mkdtempSync(join(tmpdir(), 'deep-391-gradient-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const LOOK: JsonObject = { light: { ground: [255, 255, 255], 'grad.from': [0, 0, 0], 'grad.to': [GREY, GREY, GREY] } };

const DOC: JsonObject = {
  format: 1, id: 'gradient-391', profile: 'figure', title: 'Gradient', description: 'A two-stop OKLab gradient from black to a grey of sRGB 0.2.', size: [W, H],
  layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
  items: {
    ramp: {
      id: 'ramp', kind: 'rect@1', layer: 'main', name: 'Ramp', order: 'a0',
      params: {
        box: [0, 0, W, H],
        paint: { fill: { gradient: { kind: 'linear', stops: [{ at: 0, role: 'grad.from' }, { at: 1, role: 'grad.to' }] } } },
      },
    },
  },
};

function draw(name: string, planted?: string): Image {
  const out = join(scratch, `${name}.png`);
  const report = render('render', { out, doc: DOC, look: LOOK, view: { zoom: 1, theme: 'light' }, ...(planted ? { planted } : {}) });
  expect([report['width'], report['height']], 'the render reports the document\'s size at scale 1').toEqual([W, H]);
  const image = readPng(out);
  expect([image.width, image.height], 'the PNG is the document\'s size').toEqual([W, H]);
  return image;
}

/**
 * The criterion's check of a drawn gradient, as a list of failures, each naming the pixel it read: the
 * midpoint reads 13, every row equals the first, and the ramp runs from black to the grey, never falling.
 *
 * The values, computed by this job in f64 with Ottosson's OKLab matrices (the ones palette's f64 tests
 * check) and the sRGB curve: code 51 is linear 0.03310, OKLab L 0.3211; half of that is L 0.1606, linear
 * 0.004138, sRGB 0.0522, code 13.31, so 13 (WPT's color-mix(in oklab, …) cases give the same midpoint rule). Pixel
 * 0's center (0.5 / 255 of the way) reads 0 and pixel 254's (254.5 / 255) reads 51 (50.84). GPUI's own
 * option converts with a 2.2 power curve: code 51 is linear 0.02899, L 0.3072; half is L 0.1536, linear
 * 0.003624, encoded 0.0777, code 19.8, before a triangular dither of up to two code values. The last
 * three checks keep a solid fill of code 13 from passing.
 */
function gradientFailures(image: Image): string[] {
  const failures: string[] = [];
  const mid = pixel(image, MID, H >> 1);
  if (mid.some((c) => c !== 13)) failures.push(`pixel (${MID}, ${H >> 1}) reads ${JSON.stringify(mid)} at the midpoint, not 13`);
  rows: for (let y = 1; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = pixel(image, x, 0); const b = pixel(image, x, y);
      if (a.some((c, i) => c !== b[i])) { failures.push(`pixel (${x}, ${y}) reads ${JSON.stringify(b)} where row 0 reads ${JSON.stringify(a)}: the rows differ`); break rows; }
    }
  }
  const first = pixel(image, 0, 0); const last = pixel(image, W - 1, 0);
  if (first.some((c) => c !== 0)) failures.push(`pixel (0, 0) reads ${JSON.stringify(first)}, not black`);
  if (last.some((c) => c !== GREY)) failures.push(`pixel (${W - 1}, 0) reads ${JSON.stringify(last)}, not ${GREY}`);
  for (let x = 1; x < W; x++) {
    const a = pixel(image, x - 1, 0)[0]; const b = pixel(image, x, 0)[0];
    if (b < a) { failures.push(`pixel (${x}, 0) reads ${b} after ${a} at (${x - 1}, 0): the ramp falls`); break; }
  }
  return failures;
}

describe('AC6 a two-stop OKLab gradient from black to sRGB 0.2, drawn by GPUI through the patch\'s exact gradient mode, reads 13 at its midpoint, with identical rows', () => {
  it('AC6 the exact mode: the midpoint reads 13 and every row of the horizontal gradient is identical', () => {
    const failures = gradientFailures(draw('exact'));
    expect(failures, 'the gradient drawn through the patch\'s exact mode').toEqual([]);
  }, 300_000);

  it('AC6 a build that draws it through GPUI\'s own OKLab option reads about 20 there, with rows that differ by its dither, and fails this test, naming the pixel', () => {
    const image = draw('gpui-oklab', 'gpui_oklab_gradient');
    const failures = gradientFailures(image);
    expect(failures.length > 0, 'the check fails on GPUI\'s own OKLab option').toBe(true);
    expect(failures[0], 'the failure names the pixel it read').toMatch(/^pixel \(\d+, \d+\) reads /);
    // The planted twin really is GPUI's option: about 20 at the midpoint (19.8 before its dither of up to
    // two code values), and rows that differ.
    const mid = pixel(image, MID, H >> 1)[0];
    expect(mid >= 17 && mid <= 23, `GPUI's own option reads about 20 at the midpoint, got ${mid}`).toBe(true);
    expect(failures.some((f) => f.includes('the rows differ')), `its dither makes the rows differ: ${JSON.stringify(failures)}`).toBe(true);
  }, 300_000);
});
