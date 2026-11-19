// AC2 #2032.49695bb6: "With a sun at 30° and two 100 u square occluders 600 u apart, 64 seeded points read as the CPU f64
// test says, two of them named in the fixture where a point light 2,000 u away along that angle gives the other answer. A
// planted sun drawn as that far point light fails at the first of the two, naming it"
//
// The fixture: a 1000 × 700 document whose group `lamps` holds ambient 0.25 and one white sun, `{kind: "sun", angle: 30,
// energy: 0.25}`; `floor`, a white rect over the whole document, so the group's bounds are the document's; and two
// closed white paths with `occlude: true`, `square-a` over [150, 100, 100, 100] and `square-b` over [750, 100, 100, 100],
// their centres 600 u apart. Its frame is the app's window (`window2d`, Metal) at 1 px a unit.
// A sun's shadows run along its angle: 30° is the direction (cos 30°, sin 30°) in the document's axes, right and down
// (README: Readings, "A sun's angle"). The CPU f64 test says `shadowed` where the straight segment from the pixel's
// centre against that direction, to past the group's bounds, crosses an outline the centre isn't inside. A shadowed
// white pixel shows ambient alone, code 137; a lit one ambient plus the sun, 0.5 in linear light, code 188.
// The far point light is at (500 − 2000 cos 30°, 350 − 2000 sin 30°): 2,000 u from the centre of the group's bounds,
// toward the sun. The points are pixels drawn from seed 2032, kept when more than 2 px from anything a shadow's edge
// can lie on under the sun and under the far light: the first 62 where the two agree and the first 2 where they
// don't, in the stream's order. Those two are NAMED: point 22, pixel (640, 485), lit by the sun and shadowed by the far
// light, and point 32, pixel (897, 280), the other way round.
// The planted sun is `deep-gpu run --planted sun_far_point_light`.
// Wrong programs: the base (a sun is refused: its light has no `at`), a sun drawn as a far point light, shadows that
// run against the angle or turn the other way, shadows that stop short of the group's bounds.
import { describe, expect, it } from 'vitest';
import {
  AC, blocked, boxPoly, centre, clearance, doc, fromPoint, fromSun, group, outline, pixels, reading, rect, requireMetal, rgb, sun,
  sunward, useBin, useDir, white, windows, type Image, type Poly, type Pt, type Sun,
} from './helpers.ts';

const ID = AC[2];
const bin = useBin('deep-gpu');
const dir = useDir();
const [W, H] = [1000, 700];
const SEED = 2032;
const AMBIENT = 0.25;
const SUN: Sun = { angle: 30, energy: 0.25 };
/** Longer than the group's bounds are across. */
const FAR = 4 * (W + H);
const SQUARES: Poly[] = [boxPoly(150, 100, 100, 100), boxPoly(750, 100, 100, 100)];
/** The far point light: 2,000 u from the centre of the group's bounds, against the sun's angle. */
const FAR_LIGHT: Pt = sunward([W / 2, H / 2], SUN.angle, 2000);
/** The two points the fixture names: where the far point light gives the other answer. */
const NAMED: { point: number; pixel: Pt; sun: 'lit' | 'shadowed' }[] = [
  { point: 22, pixel: [640, 485], sun: 'lit' },
  { point: 32, pixel: [897, 280], sun: 'shadowed' },
];

const fixture = doc('shadow-sun', [W, H], [
  group('lamps', 'a0', { ambient: AMBIENT, lights: [sun(SUN)] }),
  rect('floor', 'a1', [0, 0, W, H], 'lamps'),
  outline('square-a', 'a2', SQUARES[0]!, 'lamps', { occlude: true }),
  outline('square-b', 'a3', SQUARES[1]!, 'lamps', { occlude: true }),
]);

const bySun = ([x, y]: Pt): boolean => { const c = centre(x, y); return blocked(c, sunward(c, SUN.angle, FAR), SQUARES); };
const byFarLight = ([x, y]: Pt): boolean => blocked(centre(x, y), FAR_LIGHT, SQUARES);
/** The 64 seeded pixels, in the stream's order: 62 where the sun and the far light agree, 2 where they don't. */
const POINTS: Pt[] = (() => {
  const next = pixels(SEED, W, H); const kept: Pt[] = []; let same = 0; let other = 0;
  while (same < 62 || other < 2) {
    const p = next(); const c = centre(...p);
    if (clearance(c, SQUARES, fromSun(SUN.angle, FAR)) <= 2 || clearance(c, SQUARES, fromPoint(FAR_LIGHT, FAR)) <= 2) continue;
    if (bySun(p) === byFarLight(p)) { if (same < 62) { same++; kept.push(p); } } else if (other < 2) { other++; kept.push(p); }
  }
  return kept;
})();
const LIT = white(AMBIENT + SUN.energy, [], 0, 0);
const SHADOWED = white(AMBIENT, [], 0, 0);
const word = (shadowed: boolean): 'lit' | 'shadowed' => (shadowed ? 'shadowed' : 'lit');
const named = (k: number): string => `point ${k} at pixel (${POINTS[k]!.join(', ')})`;

/** The fixture holds what the criterion says of it. */
function fixtureHolds(): void {
  const [a, b] = SQUARES.map((s) => ({ side: [s[2]![0] - s[0]![0], s[2]![1] - s[0]![1]], mid: [(s[0]![0] + s[2]![0]) / 2, (s[0]![1] + s[2]![1]) / 2] }));
  expect([a!.side, b!.side, Math.hypot(b!.mid[0]! - a!.mid[0]!, b!.mid[1]! - a!.mid[1]!)], 'two 100 u squares, their centres 600 u apart').toEqual([[100, 100], [100, 100], 600]);
  expect([LIT, SHADOWED], 'white under ambient 0.25 plus a sun of 0.25, and under ambient alone').toEqual([188, 137]);
  expect(POINTS.length, '64 seeded points').toBe(64);
  const others = POINTS.flatMap((p, k) => (bySun(p) === byFarLight(p) ? [] : [{ point: k, pixel: p, sun: word(bySun(p)) }]));
  expect(others, 'the two points where the far point light gives the other answer are the two the fixture names').toEqual(NAMED);
}
/** Each point that doesn't read as the CPU f64 test says of the sun, in the points' order, each naming its point. */
function offTest(im: Image): string[] {
  expect([im.width, im.height], 'the frame is 1000 × 700 px: 1 px a unit').toEqual([W, H]);
  return POINTS.flatMap(([x, y], k) => {
    const want = word(bySun([x, y])); const got = reading(im, x, y, LIT, SHADOWED);
    return got === want ? [] : [`${named(k)} reads ${rgb(im, x, y)} (${got}); the CPU f64 test says ${want} under a sun at 30°, code ${want === 'lit' ? LIT : SHADOWED}`];
  });
}

describe(`${ID} a sun at 30° over two square occluders, against the CPU f64 test`, () => {
  it(`${ID} 64 seeded points read as the CPU f64 test says, the two named points among them`, () => {
    fixtureHolds();
    requireMetal();
    const [im] = windows(bin(), dir(), [fixture]);
    const failures = offTest(im!);
    console.log(`${ID}: the CPU test says ${POINTS.filter(bySun).length} of 64 points shadowed; ${failures.length} points read otherwise`);
    expect(failures.length, `points that don't read as the CPU f64 test says:\n  ${failures.slice(0, 20).join('\n  ')}`).toBe(0);
  });

  it(`${ID} a planted sun drawn as the far point light fails at the first of the two named points, naming it`, () => {
    fixtureHolds();
    requireMetal();
    const [im] = windows(bin(), dir(), [fixture], 'sun_far_point_light');
    const first = NAMED[0]!; const [x, y] = first.pixel;
    expect(reading(im!, x, y, LIT, SHADOWED), `under the planted far point light, ${named(first.point)} reads the other answer: ${rgb(im!, x, y)}`).toBe(word(byFarLight(first.pixel)));
    const failures = offTest(im!);
    expect(failures.length, 'the planted sun fails the check against the CPU f64 test').toBeGreaterThan(0);
    expect(failures[0], `the first failure names the first of the two named points, ${named(first.point)}; the failures were:\n  ${failures.slice(0, 20).join('\n  ')}`).toContain(`${named(first.point)} `);
  });
});
