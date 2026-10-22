import { describe, expect, it } from 'vitest';
import {
  LOOK, check, cleanRole, cleanStatus, clone, errorsOf, expectClean, expectRefused, firstDifference, fixture, itemOf, items,
  num, pixel, raster, rasterInput, same, scratch, toLinear, useRenderBinary, type Image, type JsonObject, type Rgb,
} from './helpers.ts';

useRenderBinary();
const dir = scratch('mask');
const INK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

/** A 192 × 160 figure: one mask over one ink rect that covers the whole figure. */
function maskedDoc(mask: JsonObject): JsonObject {
  return {
    format: 1, id: 'mask-373', profile: 'figure', title: 'Mask', description: 'One mask over an ink rect that covers the figure.', size: [192, 160],
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    items: {
      cut: { id: 'cut', kind: 'mask@1', layer: 'main', name: 'Mask', order: 'a0', params: { ...mask, applies_to: 'children' } },
      under: { id: 'under', kind: 'rect@1', layer: 'main', name: 'Under', order: 'a1', parent: 'cut', params: { box: [0, 0, 192, 160], paint: { fill: { role: 'ink' } } } },
    },
  };
}
const LUMINANCE = maskedDoc({ shape: 'rect', box: [32, 32, 128, 96], mode: 'luminance', paint: { fill: { role: 'gray128' } } });
const SCISSOR = maskedDoc({ shape: 'rect', box: [40, 24, 100, 60] });

/** sRGB 0.5 gray (code 128, as near as 8 bits come) in linear light: 0.2159; the criterion's 0.214. */
const LINEAR_HALF = toLinear(128 / 255);

/**
 * The coverage the mask gives the ink under it, read back from ink over white as (255 − value) ÷ 255
 * (2D composites in sRGB-encoded space): the same at every pixel of the mask's box, 2 px in from its edges.
 */
function coverage(image: Image): { value: number; uniform: boolean } {
  const first = pixel(image, 34, 34);
  let uniform = true;
  for (let y = 34; y < 126; y++) for (let x = 34; x < 158; x++) if (!same(pixel(image, x, y), first)) uniform = false;
  return { value: (255 - first[0]) / 255, uniform };
}

/** The criterion's check of the luminance mask: it covers 0.214 within 1/255. */
function luminanceFailures(image: Image): string[] {
  const { value, uniform } = coverage(image);
  const failures: string[] = [];
  if (Math.abs(value - 0.214) > 1 / 255) failures.push(`the luminance mask covers ${value.toFixed(4)}, not 0.214 within 1/255`);
  if (!uniform) failures.push('the mask\'s coverage differs across its box');
  return failures;
}

describe('AC6 masks: luminance in linear light, rect masks as scissors, four deep at most, and never over status', () => {
  it('AC6 a luminance mask of sRGB 0.5 gray covers 0.214 within 1/255', () => {
    expect(Math.abs(LINEAR_HALF - 0.214), 'code 128 is sRGB 0.5 gray within 1/255 of 0.214 in linear light').toBeLessThan(1 / 255);
    const { image } = raster(dir, LUMINANCE, LOOK, 'the luminance mask');
    expect(luminanceFailures(image), 'the luminance mask').toEqual([]);
    expect(pixel(image, 16, 16), 'outside its shape the mask covers nothing').toEqual(WHITE);
    expect(pixel(image, 176, 144), 'outside its shape the mask covers nothing').toEqual(WHITE);
  }, 300_000);

  it('AC6 a planted mask that reads encoded luma covers 0.5 and fails', () => {
    const { image } = raster(dir, LUMINANCE, LOOK, 'the luminance mask reading encoded luma', { planted: 'mask_encoded_luma' });
    const { value } = coverage(image);
    expect(Math.abs(value - 128 / 255), `the planted mask covers ${value.toFixed(4)}: encoded 0.5`).toBeLessThanOrEqual(1 / 255);
    expect(luminanceFailures(image).length, 'the luminance check fails on it').toBeGreaterThan(0);
  }, 300_000);

  it('AC6 a rect mask is a scissor with no offscreen pass', () => {
    const { image, report } = raster(dir, SCISSOR, LOOK, 'the rect mask');
    const wrong: string[] = [];
    for (let y = 0; y < 160; y++) for (let x = 0; x < 192; x++) {
      const inside = x >= 40 && x < 140 && y >= 24 && y < 84;
      if (!same(pixel(image, x, y), inside ? INK : WHITE)) wrong.push(`(${x}, ${y}) reads ${JSON.stringify(pixel(image, x, y))}`);
    }
    expect(wrong.slice(0, 10), 'the rect mask cuts the ink exactly at its box').toEqual([]);
    expect(num(report['offscreen'], 'raster: offscreen'), 'a rect mask draws through no offscreen pass').toBe(0);
    // The counter is live: a luminance mask takes coverage from its own paint, through offscreen passes.
    const lum = raster(dir, LUMINANCE, LOOK, 'the luminance mask');
    expect(num(lum.report['offscreen'], 'raster: offscreen'), 'a luminance mask draws through an offscreen pass').toBeGreaterThanOrEqual(1);
  }, 300_000);

  it('AC6 a fifth nested mask is refused naming the item; four nested masks clip to their intersection', () => {
    const doc = fixture('masks.board');
    expectClean(doc, 'clean', 'masks.board, with four nested masks');
    const { image } = raster(dir, doc, 'clean', 'masks.board');
    expect(pixel(image, 352, 120), 'inside all four masks the rect draws').toEqual(cleanRole('ink'));
    expect(pixel(image, 280, 120), 'inside three of them, outside m4, it is masked').toEqual(WHITE);

    const planted = clone(doc);
    items(planted)['m5'] = { id: 'm5', kind: 'mask@1', layer: 'main', name: 'Mask 5', order: 'a08', parent: 'm4', params: { shape: 'rect', box: [304, 80, 96, 80], applies_to: 'children' } };
    itemOf(planted, 'deep')['parent'] = 'm5';
    const errors = errorsOf(check(planted, 'clean'));
    expect([...new Set(errors.map((e) => e.code))], 'the only error is the mask depth').toEqual(['mask_depth']);
    expect(errors.some((e) => e.ids.includes('m5')), `the error names the fifth mask, m5: ${JSON.stringify(errors.map((e) => e.ids))}`).toBe(true);
    expectRefused('raster', rasterInput(dir, planted, 'clean'), 'mask_depth', 'a fifth mask nests');
  }, 300_000);

  it('AC6 a mask over a status mark leaves its pixels exact', () => {
    const doc = fixture('masks.board');
    const bare = clone(doc);
    delete items(bare)['veil'];
    delete itemOf(bare, 'gate')['parent'];
    delete itemOf(bare, 'plain')['parent'];
    const masked = raster(dir, doc, 'clean', 'masks.board').image;
    const unmasked = raster(dir, bare, 'clean', 'masks.board without its luminance mask').image;
    // The status mark `gate` is the box [32, 40, 96, 24]: every pixel in it, glyph or word included, is as unmasked.
    const crop = (image: Image): Image => {
      const rgba = new Uint8Array(96 * 24 * 4);
      for (let y = 0; y < 24; y++) rgba.set(image.rgba.subarray(((40 + y) * image.width + 32) * 4, ((40 + y) * image.width + 128) * 4), y * 96 * 4);
      return { width: 96, height: 24, rgba };
    };
    expect(firstDifference(crop(masked), crop(unmasked)), 'the status mark under the mask draws exactly as with no mask').toBeNull();
    const pass = cleanStatus().colors['pass']!;
    expect(mostCommon(crop(masked)), 'the status mark\'s fill is the look\'s pass color, exact').toEqual(pass);
    // The mask does apply to the plain rect beside it.
    expect(same(pixel(masked, 170, 70), pixel(unmasked, 170, 70)), `the plain rect under the same mask is masked: ${JSON.stringify([pixel(masked, 170, 70), pixel(unmasked, 170, 70)])}`).toBe(false);
  }, 300_000);
});

function mostCommon(image: Image): Rgb {
  const counts = new Map<string, number>();
  for (let i = 0; i < image.rgba.length; i += 4) {
    const k = `${image.rgba[i]},${image.rgba[i + 1]},${image.rgba[i + 2]}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
  return best.split(',').map(Number) as Rgb;
}
