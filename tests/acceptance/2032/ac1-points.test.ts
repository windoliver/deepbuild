// AC1 #2032.9291cae9: "In a new fixture with one point light and 8 occluding polygons of 200 segments in total, 256 seeded
// points at least 2 px from any shadow edge read lit or shadowed exactly as a CPU f64 segment test says. A planted test
// against the polygons' bounding boxes fails, naming the first wrong point"
//
// The fixture, built in helpers' terms: a 512 × 512 document whose group `lamps` holds ambient 0.25 and one white point
// light at (256, 256) (energy 0.75, range 800); `floor`, a white rect over the whole document; and eight closed white
// paths `rock-a` to `rock-h` with `occlude: true`, each a lobed outline of 25 corners (helpers `blob`, seeds 2032 to
// 2039), four 120 u from the light and four 170 u from it: 200 segments in all, none holding the light. Its frame is
// the app's window (`deep-gpu run`'s `window2d`, Metal), read back at 1 px a unit.
// The points are pixels drawn from seed 2032 (x, then y), kept when the pixel's centre is more than 2 px from anything a
// shadow's edge can lie on, of the outlines and of their bounding boxes (helpers `clearance`), until 256 are kept. The
// CPU f64 segment test (helpers `blocked`) says `shadowed` where the straight segment from the pixel's centre to the
// light crosses an outline the centre isn't inside, else `lit`. A shadowed white pixel shows ambient alone, code 137;
// a lit one shows #2031's closed form for the light at that pixel; each within 1 code on R, G and B (README: Readings).
// The planted test is `deep-gpu run --planted shadow_bounding_boxes`: by the same f64 test against the boxes, the
// first point it gets wrong is point 4, pixel (376, 114), which the test finds again from the fixture.
// Wrong programs: the base (`occlude` isn't read: every point reads lit), a test against bounding boxes or hulls, an
// outline left open at its last corner, a shadow that starts at the light rather than the outline.
import { describe, expect, it } from 'vitest';
import {
  AC, blob, blocked, boundingBox, centre, clearance, distinctCorners, doc, fromPoint, group, light, outline, pixels, reading, rect,
  requireMetal, rgb, segments, useBin, useDir, white, windows, type Image, type Light, type Poly, type Pt,
} from './helpers.ts';

const ID = AC[1];
const bin = useBin('deep-gpu');
const dir = useDir();
const SIZE = 512;
const SEED = 2032;
const AMBIENT = 0.25;
const LAMP: Light = { at: [256, 256], energy: 0.75, range: 800 };
/** Longer than any shadow in the frame. */
const FAR = 4 * SIZE;
const ROCKS: Poly[] = Array.from({ length: 8 }, (_, k) => {
  const turn = (2 * Math.PI * (k + 0.5)) / 8; const d = k % 2 ? 170 : 120;
  return blob(Math.round(LAMP.at[0] + d * Math.cos(turn)), Math.round(LAMP.at[1] + d * Math.sin(turn)), 25, 36, SEED + k);
});
const BOXES = ROCKS.map(boundingBox);
const rockId = (k: number): string => `rock-${String.fromCharCode(97 + k)}`;

const fixture = doc('shadow-points', [SIZE, SIZE], [
  group('lamps', 'a0', { ambient: AMBIENT, lights: [light(LAMP)] }),
  rect('floor', 'a1', [0, 0, SIZE, SIZE], 'lamps'),
  ...ROCKS.map((p, k) => outline(rockId(k), `b${k}`, p, 'lamps', { occlude: true })),
]);

/** The 256 seeded pixels, in the stream's order. */
const POINTS: Pt[] = (() => {
  const next = pixels(SEED, SIZE, SIZE); const kept: Pt[] = [];
  while (kept.length < 256) {
    const [x, y] = next(); const c = centre(x, y);
    if (clearance(c, ROCKS, fromPoint(LAMP.at, FAR)) > 2 && clearance(c, BOXES, fromPoint(LAMP.at, FAR)) > 2) kept.push([x, y]);
  }
  return kept;
})();
/** The CPU f64 segment test at each point, against the outlines and against their bounding boxes. */
const SHADOWED = POINTS.map(([x, y]) => blocked(centre(x, y), LAMP.at, ROCKS));
const BOXED = POINTS.map(([x, y]) => blocked(centre(x, y), LAMP.at, BOXES));
const FIRST_WRONG = SHADOWED.findIndex((s, k) => s !== BOXED[k]);
const codes = ([x, y]: Pt): { lit: number; shadowed: number } => ({ lit: white(AMBIENT, [LAMP], x, y), shadowed: white(AMBIENT, [], x, y) });
const named = (k: number): string => `point ${k} at pixel (${POINTS[k]!.join(', ')})`;
const word = (shadowed: boolean): 'lit' | 'shadowed' => (shadowed ? 'shadowed' : 'lit');

/** The fixture holds what the criterion counts, and the CPU test tells its points apart. */
function fixtureHolds(): void {
  expect([ROCKS.length, segments(ROCKS), distinctCorners(ROCKS)], '8 occluding polygons of 200 segments in total, none of no length').toEqual([8, 200, true]);
  expect(POINTS.length, '256 seeded points').toBe(256);
  expect(POINTS.every((p) => codes(p).lit - codes(p).shadowed > 16), 'a lit point and a shadowed one read more than 16 codes apart at every point').toBe(true);
  expect(white(AMBIENT, [], 0, 0), 'a shadowed white pixel under ambient 0.25').toBe(137);
}
/** Each point that doesn't read as the CPU f64 segment test says, in the points' order, each naming its point. */
function offTest(im: Image): string[] {
  expect([im.width, im.height], 'the frame is 512 × 512 px: 1 px a unit').toEqual([SIZE, SIZE]);
  return POINTS.flatMap(([x, y], k) => {
    const c = codes([x, y]); const want = word(SHADOWED[k]!); const got = reading(im, x, y, c.lit, c.shadowed);
    return got === want ? [] : [`${named(k)} reads ${rgb(im, x, y)} (${got}); the CPU f64 segment test says ${want}, code ${c[want]}`];
  });
}

describe(`${ID} one point light and 8 occluding polygons, against the CPU f64 segment test`, () => {
  it(`${ID} 256 seeded points at least 2 px from any shadow edge read lit or shadowed as the CPU f64 segment test says`, () => {
    fixtureHolds();
    const shadowed = SHADOWED.filter(Boolean).length;
    expect(shadowed > 0 && shadowed < 256, `the CPU test says both: ${shadowed} points shadowed, ${256 - shadowed} lit`).toBe(true);
    requireMetal();
    const [im] = windows(bin(), dir(), [fixture]);
    const failures = offTest(im!);
    console.log(`${ID}: the CPU test says ${shadowed} of 256 points shadowed; ${failures.length} points read otherwise`);
    expect(failures.length, `points that don't read as the CPU f64 segment test says, the first wrong point first:\n  ${failures.slice(0, 20).join('\n  ')}`).toBe(0);
  });

  it(`${ID} a planted test against the polygons' bounding boxes fails, naming the first wrong point`, () => {
    fixtureHolds();
    expect(FIRST_WRONG, 'the first seeded point a bounding-box test gets wrong').toBe(4);
    expect(POINTS[FIRST_WRONG], 'that point\'s pixel').toEqual([376, 114]);
    requireMetal();
    const [im] = windows(bin(), dir(), [fixture], 'shadow_bounding_boxes');
    const [x, y] = POINTS[FIRST_WRONG]!; const c = codes([x, y]);
    expect(reading(im!, x, y, c.lit, c.shadowed), `under the planted bounding-box test, ${named(FIRST_WRONG)} reads as a test against the boxes says: ${rgb(im!, x, y)}`).toBe(word(BOXED[FIRST_WRONG]!));
    const failures = offTest(im!);
    expect(failures.length, 'the planted bounding-box test fails the check against the CPU f64 segment test').toBeGreaterThan(0);
    expect(failures[0], `the first failure names the first wrong point, ${named(FIRST_WRONG)}; the failures were:\n  ${failures.slice(0, 20).join('\n  ')}`).toContain(`${named(FIRST_WRONG)} `);
  });
});
