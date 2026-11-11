// The PNG codec and the exact comparison (#37): a round trip, a size change, one changed 4×4 block, masks painted on both sides.
import { expect, it } from 'vitest';
import { comparePixels, decodePng, encodePng, highlight, paintMasks, type Image } from '../src/png.ts';

const image = (w: number, h: number, seed = 1): Image => {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = (i * seed) & 255; data[i * 4 + 1] = (i >> 3) & 255; data[i * 4 + 2] = (i * 7) & 255; data[i * 4 + 3] = 255; }
  return { width: w, height: h, data };
};
/** A copy with one 4×4 block set to one color. */
const plantBlock = (image: Image, at: { x: number; y: number }): Image => {
  const data = new Uint8Array(image.data);
  for (let y = at.y; y < at.y + 4; y++) for (let x = at.x; x < at.x + 4; x++) { const o = (y * image.width + x) * 4; data[o] = 7; data[o + 1] = 200; data[o + 2] = 90; data[o + 3] = 255; }
  return { ...image, data };
};

it('round-trips and compares exactly', () => {
  const a = image(40, 30);
  expect(decodePng(encodePng(a))).toEqual(a);
  expect(comparePixels(a, decodePng(encodePng(a)))).toEqual({ same: true });
  const b = plantBlock(a, { x: 10, y: 5 });
  const c = comparePixels(b, a);
  expect(c).toMatchObject({ same: false, reason: 'pixels', differing: 16, boxes: [{ x: 10, y: 5, width: 4, height: 4 }] });
  expect(comparePixels(b, a, { tolerance: 16 })).toEqual({ same: true });
  expect(comparePixels(image(41, 30), a)).toMatchObject({ same: false, reason: 'size' });
  const m = [{ x: 8, y: 4, width: 8, height: 8 }];
  expect(comparePixels(paintMasks(b, m), paintMasks(a, m))).toEqual({ same: true });
  const h = highlight(b, c.same ? [] : (c as { boxes: { x: number; y: number; width: number; height: number }[] }).boxes);
  expect(h.width).toBe(64);
  expect(decodePng(encodePng(h)).data[(5 * 64 + 50) * 4]).toBe(220);
});
