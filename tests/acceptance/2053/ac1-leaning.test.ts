// AC1 #2053.2bd7063d: "In a new fixture, a white 64 × 64 image at 1 px a unit carries a page whose every texel is (128,
// 204), the normal (0, 0.6, 0.8) leaning toward the image's top edge, in a lit group with ambient 0 and one white light of
// energy 0.5, range 400 u and height 100 u. With the light 100 u from the image's centre toward its top edge the centre
// pixel reads code 206, and with the light 100 u toward its bottom edge it reads code 84, each within 1 code. Every pixel
// is within 1 code value of the CPU f64 form computed from the same page bytes. A planted flipped green channel reads 84
// and 206 and fails, naming the pixel"
//
// The fixture is built in helpers' terms: a 320 × 320 document whose lit group `lamps` (ambient 0) holds the image
// `wall`, a white 64 × 64 PNG with a 64 × 64 page of texels (128, 204), its box centred on (160, 160) at 1 px a unit.
// Two documents differ only in the light: `UP` at (160, 60) and `DOWN` at (160, 260), each white, energy 0.5, range
// 400, height 100. Their frames are the app's window (`deep-gpu run`'s `window2d`, Metal, with the store the PNGs are
// in). "The centre pixel" is (160, 160), whose top-left corner is the image's centre (README: Readings). Every pixel of
// the image's box must be within 1 code on R, G and B of the f64 form (helpers `pagedLit`) computed from the page's
// bytes as its PNG decodes. The planted program is `deep-gpu run --planted normal_flipped_green`: the page's green read
// as 255 − g, so the normal leans toward the bottom edge; its failure must name `pixel (160, 160)`.
// Wrong programs: the base (no page read: the image lit as a flat card, 177 under both lights), a page decoded from
// sRGB, +y read toward the bottom edge, N·L without ÷ L.z, L built without the height, the flipped green.
import { describe, expect, it } from 'vitest';
import {
  AC, DOWN, failsNaming, LEANING, litWall, MID, offBy, offInBox, pagedLit, px, requireMetal, storeIn, uniformPage, UP, useBin, useDir,
  whiteImage, windows, BOX, type Image, type FormPlant,
} from './helpers.ts';

const ID = AC[1];
const bin = useBin('deep-gpu');
const dir = useDir();

/** The two frames, the light up and the light down, and the page's bytes; under `planted` when given. */
function frames(planted?: 'normal_flipped_green'): { up: Image; down: Image; page: Image } {
  const store = storeIn(dir());
  const asset = whiteImage(store, 64, 64);
  const { hash, page } = uniformPage(store, 64, 64, LEANING);
  const [up, down] = windows(bin(), dir(), store, [
    litWall('leaning-up', asset, [UP], { normal: hash }),
    litWall('leaning-down', asset, [DOWN], { normal: hash }),
  ], planted);
  return { up: up!.image, down: down!.image, page };
}
/** Every pixel of the image's box off the f64 form under each light, named by the light and the pixel. */
function offForm(f: { up: Image; down: Image; page: Image }, plant: FormPlant = 'none'): string[] {
  const form = (lamp: typeof UP) => (x: number, y: number): number => pagedLit(0, [lamp], x, y, { page: f.page, box: [BOX[0], BOX[1]], plant });
  return [...offInBox(f.up, form(UP), 'the light toward the top edge'), ...offInBox(f.down, form(DOWN), 'the light toward the bottom edge')];
}
const shownMid = (im: Image): string => px(im, ...MID).slice(0, 3).join(', ');

describe(`${ID} a page leaning toward the image's top edge turns its surface toward each light`, () => {
  it(`${ID} the centre pixel reads 206 with the light toward the top edge and 84 toward the bottom, and every pixel is within 1 code of the CPU f64 form`, () => {
    requireMetal();
    const f = frames();
    const form = [pagedLit(0, [UP], ...MID, { page: f.page, box: [BOX[0], BOX[1]] }), pagedLit(0, [DOWN], ...MID, { page: f.page, box: [BOX[0], BOX[1]] })];
    expect(form, `the f64 form at pixel (${MID.join(', ')}) under the light up and the light down`).toEqual([206, 84]);
    console.log(`${ID}: pixel (${MID.join(', ')}) reads ${shownMid(f.up)} with the light up and ${shownMid(f.down)} with it down`);
    const failures = [
      ...(offBy(f.up, ...MID, 206) <= 1 ? [] : [`the light toward the top edge: the centre pixel (${MID.join(', ')}) reads ${shownMid(f.up)}, not 206 within 1 code`]),
      ...(offBy(f.down, ...MID, 84) <= 1 ? [] : [`the light toward the bottom edge: the centre pixel (${MID.join(', ')}) reads ${shownMid(f.down)}, not 84 within 1 code`]),
      ...offForm(f),
    ];
    expect(failures, `pixels off the stated codes or the CPU f64 form, such as:\n  ${failures.slice(0, 20).join('\n  ')}\n(${failures.length} in all)`).toEqual([]);
  });

  it(`${ID} a planted flipped green channel reads 84 and 206 and fails, naming the pixel`, () => {
    requireMetal();
    const f = frames('normal_flipped_green');
    const box: [number, number] = [BOX[0], BOX[1]];
    expect([pagedLit(0, [UP], ...MID, { page: f.page, box, plant: 'flipped_green' }), pagedLit(0, [DOWN], ...MID, { page: f.page, box, plant: 'flipped_green' })].map((c, i) => Math.abs(c - [84, 206][i]!) <= 1),
      'the f64 form with the green flipped gives 84 and 206 within 1 code at the centre pixel').toEqual([true, true]);
    console.log(`${ID}: under normal_flipped_green pixel (${MID.join(', ')}) reads ${shownMid(f.up)} up and ${shownMid(f.down)} down`);
    expect([offBy(f.up, ...MID, 84), offBy(f.down, ...MID, 206)].every((d) => d <= 1),
      `under the planted flipped green the centre pixel reads 84 with the light up and 206 with it down, within 1 code: ${shownMid(f.up)}; ${shownMid(f.down)}`).toBe(true);
    failsNaming(offForm(f), `pixel (${MID.join(', ')})`, 'the planted flipped green channel');
  });
});
