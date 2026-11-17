// AC1 #2031.39426810: "In a new fixture, a 512 × 512 white rectangle in a lit group with one white light at its centre
// (range 200 u at 1 px a unit, energy 1, ambient 0) reads within 1 code value of the CPU f64 closed form at every pixel. A
// planted linear falloff reads code 188 where the form gives 198 at d = 100 px and fails, naming that pixel"
//
// The fixture is built in helpers' terms: a 512 × 512 document whose group `lamps` holds the white rect `sheet` over the
// whole document and `light: {ambient: 0, lights: [{at: [256, 256], color: white, energy: 1, range: 200}]}`. Its frame
// is the app's window (`deep-gpu run`'s `window2d`, Metal), read back at 1 px a unit. Each pixel's R, G and B must be
// within 1 code of the closed form at the pixel's centre (helpers `whiteLit`), and its alpha 255. "d = 100 px" is read
// as pixel (355, 255), whose centre lies 99.5 px right of the light and half a px above it (d = 99.501), the nearest
// pixel to d = 100 on that axis: the form gives 198 there and a linear falloff 188 (README: Readings).
// Wrong programs: the base (no light read: the rect stays 255), a linear or a single-square falloff, a reach measured
// in encoded space, `deep-gpu run --planted light_linear_falloff`.
import { describe, expect, it } from 'vitest';
import {
  AC, doc, failsNaming, group, light, offBy, px, rect, requireMetal, useBin, useDir, whiteLit, windows, type Image, type Light,
} from './helpers.ts';

const ID = AC[1];
const bin = useBin('deep-gpu');
const dir = useDir();
const SIZE = 512;
const LAMP: Light = { at: [256, 256], energy: 1, range: 200 };
const NAMED: [number, number] = [355, 255];

const fixture = doc('lit-falloff', [SIZE, SIZE], [
  group('lamps', 'a0', { ambient: 0, lights: [light(LAMP)] }),
  rect('sheet', 'a1', [0, 0, SIZE, SIZE], 'lamps'),
]);

/** Every pixel more than 1 code off the closed form, or not opaque, named by its coordinates. */
function offForm(im: Image): string[] {
  expect([im.width, im.height], 'the frame is 512 × 512 px: 1 px a unit').toEqual([SIZE, SIZE]);
  const failures: string[] = [];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const want = whiteLit(0, [LAMP], x, y);
    const p = px(im, x, y);
    if (offBy(im, x, y, want) > 1 || p[3] !== 255) {
      const d = Math.hypot(x + 0.5 - LAMP.at[0], y + 0.5 - LAMP.at[1]);
      failures.push(`pixel (${x}, ${y}) at d = ${d.toFixed(2)} px reads [${p.join(', ')}], the closed form gives ${want}`);
    }
  }
  return failures;
}

describe(`${ID} one white light over a 512 × 512 white rect, against the CPU f64 closed form`, () => {
  it(`${ID} every pixel reads within 1 code value of the closed form`, () => {
    requireMetal();
    const [im] = windows(bin(), dir(), [fixture]);
    const failures = offForm(im!);
    console.log(`${ID}: ${failures.length} of ${SIZE * SIZE} pixels off the form; pixel (${NAMED.join(', ')}) reads ${px(im!, ...NAMED).join(', ')}, the form ${whiteLit(0, [LAMP], ...NAMED)}`);
    expect(failures.length, `pixels more than 1 code off the CPU f64 closed form, such as:\n  ${failures.slice(0, 20).join('\n  ')}`).toBe(0);
  });

  it(`${ID} a planted linear falloff reads 188 where the form gives 198 at d = 100 px, and fails naming that pixel`, () => {
    requireMetal();
    expect(whiteLit(0, [LAMP], ...NAMED), `the closed form at pixel (${NAMED.join(', ')})`).toBe(198);
    const [im] = windows(bin(), dir(), [fixture], { planted: 'light_linear_falloff' });
    expect(offBy(im!, ...NAMED, 188), `under the planted linear falloff, pixel (${NAMED.join(', ')}) reads 188 within 1 code: ${px(im!, ...NAMED).join(', ')}`).toBeLessThanOrEqual(1);
    failsNaming(offForm(im!), `pixel (${NAMED.join(', ')})`, 'the planted linear falloff');
  });
});
