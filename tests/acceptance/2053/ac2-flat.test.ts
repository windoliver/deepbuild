// AC2 #2053.9e8b1c74: "The same image with a flat page, every texel (128, 128), is within 1 code value of the frame with no
// `normal` at every pixel, and its centre pixel reads code 177 under the first light. A planted pass that multiplies by
// N·L alone reads code 151 there and fails, naming the pixel"
//
// AC1's document under its first light, `UP` (100 u toward the top edge, height 100): once with a 64 × 64 page of texels
// (128, 128) and once with no `normal`, both frames from one `window2d` process (Metal, with the store). Every pixel of
// the 320 × 320 frame must be within 1 code on R, G and B of the frame with no page, and the centre pixel (160, 160)
// must read 177 within 1 code, which the f64 form gives there (helpers `pagedLit`; with no page it is #2031's form).
// The planted program is `deep-gpu run --planted normal_dot_alone`: a paged pixel's term multiplied by max(0, N·L) and
// not divided by L.z; the frame with no page is unchanged by it, and its failure must name `pixel (160, 160)`.
// Wrong programs: the base (no store: the image doesn't draw), N·L alone, a page decoded from sRGB (a flat page then
// leans toward the bottom left), a page read where there is none.
import { describe, expect, it } from 'vitest';
import {
  AC, BOX, failsNaming, FLAT, litWall, MID, offBy, pagedLit, px, requireMetal, SIZE, storeIn, uniformPage, UP, useBin, useDir,
  whiteImage, windows, type Image,
} from './helpers.ts';

const ID = AC[2];
const bin = useBin('deep-gpu');
const dir = useDir();

/** The flat page's frame and the frame with no `normal`, under the first light. */
function frames(planted?: 'normal_dot_alone'): { flat: Image; bare: Image; page: Image } {
  const store = storeIn(dir());
  const asset = whiteImage(store, 64, 64);
  const { hash, page } = uniformPage(store, 64, 64, FLAT);
  const [flat, bare] = windows(bin(), dir(), store, [litWall('flat-up', asset, [UP], { normal: hash }), litWall('bare-up', asset, [UP])], planted);
  return { flat: flat!.image, bare: bare!.image, page };
}
/** Every pixel of the frame where the flat page is more than 1 code off the frame with no page, and the centre against `code`. */
function judged(f: { flat: Image; bare: Image }, code: number): string[] {
  const failures: string[] = [];
  if (offBy(f.flat, ...MID, code) > 1) failures.push(`the centre: pixel (${MID.join(', ')}) reads ${px(f.flat, ...MID).slice(0, 3).join(', ')}, not ${code} within 1 code`);
  expect([f.flat.width, f.flat.height, f.bare.width, f.bare.height], `both frames are ${SIZE.join(' × ')} px, 1 px a unit`).toEqual([...SIZE, ...SIZE]);
  for (let y = 0; y < SIZE[1]; y++) for (let x = 0; x < SIZE[0]; x++) {
    const [a, b] = [px(f.flat, x, y), px(f.bare, x, y)];
    if ([0, 1, 2].some((k) => Math.abs(a[k]! - b[k]!) > 1)) failures.push(`the flat page against no normal: pixel (${x}, ${y}) reads ${a.slice(0, 3).join(', ')}, the frame with no normal ${b.slice(0, 3).join(', ')}`);
  }
  return failures;
}

describe(`${ID} a flat page changes nothing`, () => {
  it(`${ID} a flat page is within 1 code of the frame with no normal at every pixel, and its centre reads 177 under the first light`, () => {
    requireMetal();
    const f = frames();
    expect(pagedLit(0, [UP], ...MID, { page: f.page, box: [BOX[0], BOX[1]] }), `the f64 form at pixel (${MID.join(', ')}) with the flat page`).toBe(177);
    console.log(`${ID}: pixel (${MID.join(', ')}) reads ${px(f.flat, ...MID).join(', ')} with the flat page and ${px(f.bare, ...MID).join(', ')} with no normal`);
    const failures = judged(f, 177);
    expect(failures, `pixels off, such as:\n  ${failures.slice(0, 20).join('\n  ')}\n(${failures.length} in all)`).toEqual([]);
  });

  it(`${ID} a planted pass that multiplies by N·L alone reads 151 at the centre and fails, naming the pixel`, () => {
    requireMetal();
    const f = frames('normal_dot_alone');
    expect(Math.abs(pagedLit(0, [UP], ...MID, { page: f.page, box: [BOX[0], BOX[1]], plant: 'dot_alone' }) - 151), 'the f64 form with N·L alone gives 151 within 1 code at the centre').toBeLessThanOrEqual(1);
    console.log(`${ID}: under normal_dot_alone pixel (${MID.join(', ')}) reads ${px(f.flat, ...MID).join(', ')}`);
    expect(offBy(f.flat, ...MID, 151), `under the planted N·L alone the centre pixel (${MID.join(', ')}) reads 151 within 1 code: ${px(f.flat, ...MID).join(', ')}`).toBeLessThanOrEqual(1);
    failsNaming(judged(f, 177), `pixel (${MID.join(', ')})`, 'the planted pass that multiplies by N·L alone');
  });
});
