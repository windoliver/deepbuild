// AC4 #2032.8db573d6: "A shadowed white pixel with ambient 0.25 reads code 137, and code 188 with a second light that is
// not blocked and gives 0.25 there, within 1 code. A planted shadow that removes ambient as well reads 0 and fails"
//
// A 256 × 128 document whose group `lamps` holds ambient 0.25; `floor`, a white rect over the whole document; and `wall`,
// a closed white path over [70, 20, 10, 88] with `occlude: true`. The pixel is (128, 64), centre (128.5, 64.5).
//   - `blocked`: a white point light at (28.5, 64.5), energy 1, range 400. The segment from the pixel's centre to it
//     crosses the wall, and the pixel is more than 2 px from the wall's shadow edges.
//   - `open`: a white point light at (188.5, 64.5), 60 u right of the centre with nothing between, range 100 and energy
//     625/1024 (exact in f32), so it gives the pixel (1 − 0.6²)² × 625/1024 = 0.25 in linear light, as #2031's AC2 has it.
// Two documents, drawn in one `deep-gpu run` as the app's window shows them (`window2d`, Metal): `blocked` alone, where
// the pixel keeps ambient alone, 0.25, code 137; and both lights, 0.25 + 0.25, code 188 (helpers `white`, which the test
// checks against the criterion's two codes first).
// The planted shadow is `deep-gpu run --planted shadow_removes_ambient`: with `blocked` alone the pixel reads 0.
// Wrong programs: the base (`occlude` isn't read: the blocked light reaches the pixel), a shadow that removes ambient
// or every light, a shadow drawn as a dark overlay rather than one light's term left out.
import { describe, expect, it } from 'vitest';
import {
  AC, blocked, boxPoly, centre, clearance, doc, fromPoint, group, light, none, offBy, outline, reads, rect, requireMetal, rgb, useBin,
  useDir, white, windows, type Image, type JsonObject, type Light, type Poly, type Pt,
} from './helpers.ts';

const ID = AC[4];
const bin = useBin('deep-gpu');
const dir = useDir();
const AMBIENT = 0.25;
const PIXEL: Pt = [128, 64];
const WALL: Poly = boxPoly(70, 20, 10, 88);
const BLOCKED: Light = { at: [28.5, 64.5], energy: 1, range: 400 };
const OPEN: Light = { at: [188.5, 64.5], energy: 625 / 1024, range: 100 };
const CASES: { id: string; name: string; lights: Light[]; reaching: Light[]; code: number }[] = [
  { id: 'shadow-ambient-one', name: 'the blocked light alone', lights: [BLOCKED], reaching: [], code: 137 },
  { id: 'shadow-ambient-two', name: 'the blocked light and the open one', lights: [BLOCKED, OPEN], reaching: [OPEN], code: 188 },
];
const fixtures = (): JsonObject[] => CASES.map((c) => doc(c.id, [256, 128], [
  group('lamps', 'a0', { ambient: AMBIENT, lights: c.lights.map((l) => light(l)) }),
  rect('floor', 'a1', [0, 0, 256, 128], 'lamps'),
  outline('wall', 'a2', WALL, 'lamps', { occlude: true }),
]));

/** The fixture holds what the criterion says of the pixel, and the closed form gives the criterion's two codes. */
function fixtureHolds(): void {
  const c = centre(...PIXEL);
  expect([blocked(c, BLOCKED.at, [WALL]), clearance(c, [WALL], fromPoint(BLOCKED.at, 1024)) > 2, blocked(c, OPEN.at, [WALL])], 'the wall blocks the first light from the pixel, clear of its shadow\'s edges, and not the second').toEqual([true, true, false]);
  expect(CASES.map((k) => white(AMBIENT, k.reaching, ...PIXEL)), 'ambient 0.25 alone, and with a light that gives 0.25 there').toEqual([137, 188]);
  expect(white(AMBIENT, [BLOCKED], ...PIXEL) - 137, 'with no wall the blocked light gives the pixel far more than ambient').toBeGreaterThan(16);
}
/** Each case whose pixel is more than 1 code off its stated code, naming the pixel. */
function offStated(images: Image[]): string[] {
  return CASES.flatMap((c, i) => (reads(images[i]!, ...PIXEL, c.code) ? [] : [`${c.name}: the shadowed pixel (${PIXEL.join(', ')}) reads ${rgb(images[i]!, ...PIXEL)}, not ${c.code} within 1 code`]));
}

describe(`${ID} a shadowed pixel keeps ambient and every other light`, () => {
  it(`${ID} a shadowed white pixel with ambient 0.25 reads 137, and 188 with a second light that isn't blocked, within 1 code`, () => {
    fixtureHolds();
    requireMetal();
    const images = windows(bin(), dir(), fixtures());
    console.log(`${ID}: pixel (${PIXEL.join(', ')}) reads ${CASES.map((c, i) => `${c.name} ${rgb(images[i]!, ...PIXEL)}`).join('; ')}`);
    none(offStated(images), 'the shadowed pixel against its stated code');
  });

  it(`${ID} a planted shadow that removes ambient as well reads 0 and fails`, () => {
    fixtureHolds();
    requireMetal();
    const images = windows(bin(), dir(), fixtures(), 'shadow_removes_ambient');
    expect(offBy(images[0]!, ...PIXEL, 0), `under the planted shadow, with the blocked light alone, pixel (${PIXEL.join(', ')}) reads 0 within 1 code: ${rgb(images[0]!, ...PIXEL)}`).toBeLessThanOrEqual(1);
    expect(offStated(images).length, 'the planted shadow that removes ambient fails the check against the stated codes').toBeGreaterThan(0);
  });
});
