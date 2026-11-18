// AC3 #2031.f59a759e: "A lit group that names no lights and no `ambient` draws a white rectangle at code 137, and the
// same group with its `light` removed draws it at 255. A planted default of 0 reads 0 and fails"
//
// A 160 × 96 white rect `sheet` in the group `lamps`, whose `light` is `{}`: it names neither `lights` nor `ambient`, so
// the defaults hold, ambient 0.25 and no light, and white (1 in linear light) × 0.25 encodes once to code 137 (helpers
// `whiteLit`, checked first). Its twin is the same document with the group's `light` removed. Both are drawn in one
// `deep-gpu run` as the app's window shows them (`window2d`, Metal), and every pixel of the rect is read: 137 and 255,
// each within 1 code (README: Readings).
// Wrong programs: the base (no light read: 255 in both), a default ambient of 0 or 1, a lit group that needs `lights`
// named, `deep-gpu run --planted light_default_ambient_zero`.
import { describe, expect, it } from 'vitest';
import {
  AC, doc, group, none, offBy, px, rect, requireMetal, unlitTwin, useBin, useDir, whiteLit, windows, type Image,
} from './helpers.ts';

const ID = AC[3];
const bin = useBin('deep-gpu');
const dir = useDir();
const SIZE: [number, number] = [160, 96];
const lit = doc('lit-default', SIZE, [
  group('lamps', 'a0', {}),
  rect('sheet', 'a1', [0, 0, ...SIZE], 'lamps'),
]);

/** Each pixel of the rect more than 1 code off `code`, the first few named, with a count. */
function offCode(im: Image, code: number, what: string): string[] {
  const off: string[] = [];
  for (let y = 0; y < SIZE[1]; y++) for (let x = 0; x < SIZE[0]; x++) if (offBy(im, x, y, code) > 1) off.push(`(${x}, ${y}) reads ${px(im, x, y).slice(0, 3).join(', ')}`);
  return off.length ? [`${what}: ${off.length} of ${SIZE[0] * SIZE[1]} pixels are more than 1 code off ${code}, such as ${off.slice(0, 4).join('; ')}`] : [];
}

describe(`${ID} a lit group's defaults`, () => {
  it(`${ID} a lit group that names no lights and no ambient draws white at 137, and with its light removed at 255`, () => {
    requireMetal();
    expect(whiteLit(0.25, [], 0, 0), 'the closed form: white × the default ambient 0.25, encoded once').toBe(137);
    const [withLight, without] = windows(bin(), dir(), [lit, unlitTwin(lit, 'lamps')]);
    console.log(`${ID}: pixel (80, 48) reads ${px(withLight!, 80, 48).join(', ')} lit and ${px(without!, 80, 48).join(', ')} with the light removed`);
    none([...offCode(withLight!, 137, 'the lit group with light {}'), ...offCode(without!, 255, 'the same group with its light removed')], 'the rect against 137 and 255');
  });

  it(`${ID} a planted default ambient of 0 reads 0 and fails`, () => {
    requireMetal();
    const [im] = windows(bin(), dir(), [lit], { planted: 'light_default_ambient_zero' });
    expect(offBy(im!, 80, 48, 0), `under the planted default the rect reads 0 within 1 code: ${px(im!, 80, 48).join(', ')}`).toBeLessThanOrEqual(1);
    expect(offCode(im!, 137, 'the planted default of 0').length, 'the planted default of 0 fails the check against 137').toBeGreaterThan(0);
  });
});
