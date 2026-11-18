// AC2 #2031.b71a6207: "Two lights that each give a white pixel 0.25 in linear light, with ambient 0, read code 137 alone
// and code 188 together, within 1 code. A planted sum in encoded space reads 255 and fails, naming the pixel"
//
// A 256 × 128 white rect in the group `lamps` with ambient 0. The pixel is (128, 64), centre (128.5, 64.5). Light `a` sits
// 60 u left of that centre and light `b` 60 u right of it, each white with range 100 and energy 625/1024 (0.6103515625,
// exact in f32), so each reaches the pixel with (1 − 0.6²)² = 0.4096 and gives it 0.25 in linear light: encoded once,
// 0.25 is code 137 and 0.5 is code 188, while two encoded 137s summed clamp to 255 (helpers `whiteLit`, which this
// test checks first). Three documents, `a` alone, `b` alone and both, drawn in one `deep-gpu run` as the app's window
// shows them (`window2d`, Metal).
// Wrong programs: the base (no light read: 255 everywhere), a sum of encoded values, `deep-gpu run --planted
// light_encoded_sum`.
import { describe, expect, it } from 'vitest';
import {
  AC, doc, failsNaming, group, light, none, offBy, px, rect, requireMetal, useBin, useDir, whiteLit, windows, type Image, type JsonObject, type Light,
} from './helpers.ts';

const ID = AC[2];
const bin = useBin('deep-gpu');
const dir = useDir();
const PIXEL: [number, number] = [128, 64];
const ENERGY = 625 / 1024;
const A: Light = { at: [68.5, 64.5], energy: ENERGY, range: 100 };
const B: Light = { at: [188.5, 64.5], energy: ENERGY, range: 100 };
const CASES: { id: string; name: string; lights: Light[]; code: number }[] = [
  { id: 'lit-a', name: 'light a alone', lights: [A], code: 137 },
  { id: 'lit-b', name: 'light b alone', lights: [B], code: 137 },
  { id: 'lit-both', name: 'both lights', lights: [A, B], code: 188 },
];
const fixtures = (): JsonObject[] => CASES.map((c) => doc(c.id, [256, 128], [
  group('lamps', 'a0', { ambient: 0, lights: c.lights.map((l) => light(l)) }),
  rect('sheet', 'a1', [0, 0, 256, 128], 'lamps'),
]));

/** Each case whose pixel is more than 1 code off its stated code, naming the pixel. */
function offStated(images: Image[]): string[] {
  return CASES.flatMap((c, i) => offBy(images[i]!, ...PIXEL, c.code) <= 1 ? [] : [`${c.name}: pixel (${PIXEL.join(', ')}) reads ${px(images[i]!, ...PIXEL).slice(0, 3).join(', ')}, not ${c.code} within 1 code`]);
}

describe(`${ID} two lights sum in linear light`, () => {
  it(`${ID} each light alone reads 137 and the two together read 188, within 1 code`, () => {
    requireMetal();
    expect(CASES.map((c) => whiteLit(0, c.lights, ...PIXEL)), 'the closed form at the pixel: each light gives 0.25 in linear light').toEqual([137, 137, 188]);
    const images = windows(bin(), dir(), fixtures());
    console.log(`${ID}: pixel (${PIXEL.join(', ')}) reads ${CASES.map((c, i) => `${c.name} ${px(images[i]!, ...PIXEL).slice(0, 3).join('/')}`).join('; ')}`);
    none(offStated(images), 'the pixel against its stated code');
  });

  it(`${ID} a planted sum in encoded space reads 255 and fails, naming the pixel`, () => {
    requireMetal();
    const images = windows(bin(), dir(), fixtures(), { planted: 'light_encoded_sum' });
    expect(offBy(images[2]!, ...PIXEL, 255), `under the planted encoded sum both lights read 255 at pixel (${PIXEL.join(', ')}): ${px(images[2]!, ...PIXEL).join(', ')}`).toBeLessThanOrEqual(1);
    failsNaming(offStated(images), `pixel (${PIXEL.join(', ')})`, 'the planted sum in encoded space');
  });
});
