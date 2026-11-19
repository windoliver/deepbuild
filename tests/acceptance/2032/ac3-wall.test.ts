// AC3 #2032.e4dd3ca1: "A pixel at the centre of an occluding wall is within 1 code value of the same frame with `occlude`
// off, and a pixel behind the wall reads the ambient level alone. A planted pass that shadows the inside of the outline
// reads ambient at the centre and fails, naming the path"
//
// A 256 × 160 document whose group `lamps` holds ambient 0.25 and one white point light at (40, 80) (energy 0.75, range
// 400); `floor`, a white rect over the whole document; and `wall`, a closed path over [120, 30, 16, 100] filled in the
// colored role `accent`, with `occlude: true`. Three documents, drawn in one `deep-gpu run` as the app's window shows
// them (`window2d`, Metal): the wall occluding, the same with `occlude: false`, and the occluding one with no lights.
//   - The centre: pixel (128, 80), inside the wall. With `occlude` on, each of R, G and B is within 1 code of the frame
//     with `occlude` off, where the wall's face is lit as any child is.
//   - Behind: pixel (200, 80) on the white floor, whose segment to the light crosses the wall, more than 2 px from any
//     shadow edge. It reads the ambient level alone, white × 0.25, code 137 within 1 code; without the wall the light
//     would give it far more (helpers `white`).
// The planted pass is `deep-gpu run --planted shadow_inside_outline`: the centre then reads what it reads with no
// lights at all, the ambient level alone, and the check fails naming `wall`.
// Wrong programs: the base (`occlude` isn't read: the pixel behind the wall stays lit), a wall shadowed by its own
// outline, a shadow that ends at the wall's far side, an occluding path that is no longer drawn.
import { describe, expect, it } from 'vitest';
import {
  AC, blocked, boxPoly, centre, clearance, doc, failsNaming, fromPoint, group, inside, light, none, outline, px, reads, rect, requireMetal,
  rgb, useBin, useDir, white, windows, type Image, type JsonObject, type Light, type Poly, type Pt,
} from './helpers.ts';

const ID = AC[3];
const bin = useBin('deep-gpu');
const dir = useDir();
const AMBIENT = 0.25;
const LAMP: Light = { at: [40, 80], energy: 0.75, range: 400 };
const WALL: Poly = boxPoly(120, 30, 16, 100);
const CENTRE: Pt = [128, 80];
const BEHIND: Pt = [200, 80];
const AMBIENT_CODE = white(AMBIENT, [], ...BEHIND);

const fixture = (occlude: boolean, lights: JsonObject[] = [light(LAMP)]): JsonObject => doc(`shadow-wall-${occlude ? 'on' : 'off'}${lights.length ? '' : '-dark'}`, [256, 160], [
  group('lamps', 'a0', { ambient: AMBIENT, lights }),
  rect('floor', 'a1', [0, 0, 256, 160], 'lamps'),
  outline('wall', 'a2', WALL, 'lamps', { occlude, fill: 'accent' }),
]);
/** The largest difference of R, G and B between two frames at a pixel. */
const apart = (a: Image, b: Image, [x, y]: Pt): number => Math.max(...[0, 1, 2].map((k) => Math.abs(px(a, x, y)[k]! - px(b, x, y)[k]!)));

/** The fixture holds what the criterion says of its two pixels. */
function fixtureHolds(): void {
  expect(inside(centre(...CENTRE), WALL), 'pixel (128, 80) is inside the wall').toBe(true);
  expect([blocked(centre(...BEHIND), LAMP.at, [WALL]), clearance(centre(...BEHIND), [WALL], fromPoint(LAMP.at, 1024)) > 2], 'pixel (200, 80) is behind the wall, clear of its shadow\'s edges').toEqual([true, true]);
  expect(AMBIENT_CODE, 'white at the ambient level alone').toBe(137);
  expect(white(AMBIENT, [LAMP], ...BEHIND) - AMBIENT_CODE, 'with no wall the light gives the pixel behind it far more than ambient').toBeGreaterThan(16);
}
/** What the criterion holds of the occluding frame against the frame with `occlude` off; each failure names the path. */
function judged(on: Image, off: Image): string[] {
  const failures: string[] = [];
  if (apart(on, off, CENTRE) > 1) failures.push(`wall: the pixel at its centre (${CENTRE.join(', ')}) reads ${rgb(on, ...CENTRE)} while it occludes and ${rgb(off, ...CENTRE)} with occlude off, more than 1 code apart`);
  if (!reads(on, ...BEHIND, AMBIENT_CODE)) failures.push(`wall: pixel (${BEHIND.join(', ')}) behind it reads ${rgb(on, ...BEHIND)}, not the ambient level alone, code ${AMBIENT_CODE} within 1 code`);
  return failures;
}

describe(`${ID} an occluding wall stays lit, and the floor behind it keeps ambient alone`, () => {
  it(`${ID} the wall's centre is within 1 code of the frame with occlude off, and a pixel behind the wall reads ambient alone`, () => {
    fixtureHolds();
    requireMetal();
    const [on, off] = windows(bin(), dir(), [fixture(true), fixture(false)]);
    console.log(`${ID}: the centre reads ${rgb(on!, ...CENTRE)} occluding and ${rgb(off!, ...CENTRE)} with occlude off; behind the wall ${rgb(on!, ...BEHIND)}`);
    none(judged(on!, off!), 'the occluding wall against the frame with occlude off');
  });

  it(`${ID} a planted pass that shadows the inside of the outline reads ambient at the centre and fails, naming the path`, () => {
    fixtureHolds();
    requireMetal();
    const [on, off, dark] = windows(bin(), dir(), [fixture(true), fixture(false), fixture(true, [])], 'shadow_inside_outline');
    expect(apart(on!, dark!, CENTRE), `under the planted pass the wall's centre reads the ambient level alone, as with no lights: ${rgb(on!, ...CENTRE)} against ${rgb(dark!, ...CENTRE)}`).toBeLessThanOrEqual(1);
    failsNaming(judged(on!, off!), 'wall', 'the planted pass that shadows the inside of the outline');
  });
});
