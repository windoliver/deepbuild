// AC3 #2053.dca1cc61: "The image of the first criterion turned 180° about its centre, under the same light 100 u toward the
// top of the frame, reads code 84 at its centre, because its normals turn with it. A planted pass that leaves the normals
// unturned reads 206 and fails, naming the image"
//
// AC1's document with the light `UP` at (160, 60), the image `wall` turned 180° by `at.rot`'s z about its origin, which
// is its centre (160, 160) since its box is centred on it (#535). Its page's normal (0, 0.6, 0.8) now leans toward the
// frame's bottom edge, away from the light. The frame is `window2d`'s (Metal, with the store). The centre pixel
// (160, 160) must read 84 within 1 code; the f64 form gives 83 there and 84 at (159, 159), each within 1 code of the
// criterion's 84 (helpers `pagedLit`, README: Readings). The planted program is `deep-gpu run --planted
// normal_unturned`: the page's normal taken in the frame's axes as if the image weren't turned; its failure must name
// the image, `wall`.
// Wrong programs: the base (no store: the image doesn't draw), normals left unturned, normals turned the wrong way (at
// 180° the same as unturned for y), the page's texel read unturned under a turned image.
import { describe, expect, it } from 'vitest';
import {
  AC, BOX, failsNaming, LEANING, litWall, MID, offBy, pagedLit, px, requireMetal, storeIn, uniformPage, UP, useBin, useDir, whiteImage, windows,
  type Image,
} from './helpers.ts';

const ID = AC[3];
const bin = useBin('deep-gpu');
const dir = useDir();

/** The turned image's frame under the light toward the top of the frame, and its page's bytes. */
function frame(planted?: 'normal_unturned'): { im: Image; page: Image } {
  const store = storeIn(dir());
  const asset = whiteImage(store, 64, 64);
  const { hash, page } = uniformPage(store, 64, 64, LEANING);
  const [w] = windows(bin(), dir(), store, [litWall('turned-up', asset, [UP], { normal: hash, turn: 180 })], planted);
  return { im: w!.image, page };
}
const reads = (im: Image): string => px(im, ...MID).slice(0, 3).join(', ');
/** The criterion's reading: the turned image's centre at 84; a failure names the image. */
const judged = (im: Image): string[] => (offBy(im, ...MID, 84) <= 1 ? [] : [`wall: turned 180° under the light toward the top of the frame, its centre pixel (${MID.join(', ')}) reads ${reads(im)}, not 84 within 1 code`]);

describe(`${ID} a page's normals turn with its image`, () => {
  it(`${ID} the image turned 180° reads 84 at its centre under the light toward the top of the frame`, () => {
    requireMetal();
    const { im, page } = frame();
    const form = pagedLit(0, [UP], ...MID, { page, box: [BOX[0], BOX[1]], turn: 180 });
    expect(Math.abs(form - 84), `the f64 form at pixel (${MID.join(', ')}) of the turned image gives ${form}, within 1 code of 84`).toBeLessThanOrEqual(1);
    console.log(`${ID}: the turned image's centre pixel (${MID.join(', ')}) reads ${reads(im)}`);
    const failures = judged(im);
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it(`${ID} a planted pass that leaves the normals unturned reads 206 and fails, naming the image`, () => {
    requireMetal();
    const { im, page } = frame('normal_unturned');
    expect(pagedLit(0, [UP], ...MID, { page, box: [BOX[0], BOX[1]], turn: 180, plant: 'unturned' }), 'the f64 form with the normals unturned gives 206 at the centre').toBe(206);
    console.log(`${ID}: under normal_unturned the centre pixel (${MID.join(', ')}) reads ${reads(im)}`);
    expect(offBy(im, ...MID, 206), `under the planted unturned normals the centre reads 206 within 1 code: ${reads(im)}`).toBeLessThanOrEqual(1);
    failsNaming(judged(im), 'wall', 'the planted pass that leaves the normals unturned');
  });
});
