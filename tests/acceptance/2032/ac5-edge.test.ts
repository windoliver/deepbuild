// AC5 #2032.f2f22b4c: "On a row that crosses a straight shadow edge at 45°, at least one pixel reads strictly between the
// shadowed and the lit value and none farther than 2 px from the CPU edge does. A planted edge with no antialiasing has no
// such pixel and fails"
//
// A 256 × 256 document whose group `lamps` holds ambient 0.25 and one white point light at (40, 40) (energy 0.75, range
// 1000); `floor`, a white rect over the whole document; and `wall`, a closed white path over [100, 20, 10, 80] with
// `occlude: true`. The wall's corner (100, 100) lies on the 45° line from the light, and the wall on one side of it,
// so its shadow's edge runs from that corner along y = x: the CPU edge. The row is y = 200, which crosses that edge once,
// at pixel (200, 200), whose centre lies on it; pixels left of it are lit and pixels right of it shadowed, by the CPU
// f64 segment test (helpers `blocked`), which the test checks first. The frame is the app's window (`window2d`, Metal).
// On the row, a pixel "reads strictly between" when each of R, G and B is more than 1 code above the shadowed value
// (ambient alone, 137) and more than 1 code below the lit value there (#2031's closed form for the light at that
// pixel), so a pixel within 1 code of either doesn't count. A pixel's distance from the CPU edge is from its centre to
// the line, |x − 200| ÷ √2 px (README: Readings).
// The planted edge is `deep-gpu run --planted shadow_edge_aliased`: every pixel then takes all of the light or none.
// Wrong programs: the base (`occlude` isn't read: the whole row reads lit), an edge with no antialiasing, an edge
// blurred over several px, an edge drawn more than 2 px from where the segment test puts it.
import { describe, expect, it } from 'vitest';
import {
  AC, blocked, boxPoly, centre, doc, failsNaming, group, light, none, outline, px, rect, requireMetal, rgb, useBin, useDir, white,
  windows, type Image, type Light, type Poly,
} from './helpers.ts';

const ID = AC[5];
const bin = useBin('deep-gpu');
const dir = useDir();
const SIZE = 256;
const AMBIENT = 0.25;
const LAMP: Light = { at: [40, 40], energy: 0.75, range: 1000 };
const WALL: Poly = boxPoly(100, 20, 10, 80);
const ROW = 200;
/** The pixel of the row whose centre the CPU edge y = x passes through. */
const CROSSING = 200;
const SHADOWED = white(AMBIENT, [], 0, ROW);
const lit = (x: number): number => white(AMBIENT, [LAMP], x, ROW);
/** The distance from pixel (x, ROW)'s centre to the CPU edge, the line y = x, in px. */
const fromEdge = (x: number): number => Math.abs(x - CROSSING) / Math.SQRT2;
const NO_BETWEEN = 'no pixel reads strictly between';

const fixture = doc('shadow-edge', [SIZE, SIZE], [
  group('lamps', 'a0', { ambient: AMBIENT, lights: [light(LAMP)] }),
  rect('floor', 'a1', [0, 0, SIZE, SIZE], 'lamps'),
  outline('wall', 'a2', WALL, 'lamps', { occlude: true }),
]);

/** The fixture holds what the criterion says of the row: one straight shadow edge at 45°, crossed at pixel 200. */
function fixtureHolds(): void {
  const corner = WALL[3]!;
  expect([corner, [corner[0] - LAMP.at[0], corner[1] - LAMP.at[1]]], 'the wall\'s corner (100, 100) is at 45° from the light: as far right of it as below it').toEqual([[100, 100], [60, 60]]);
  const row = Array.from({ length: SIZE }, (_, x) => x).filter((x) => x !== CROSSING);
  expect(row.filter((x) => blocked(centre(x, ROW), LAMP.at, [WALL]) !== (x > CROSSING)), 'on row 200 the CPU test says lit left of pixel 200 and shadowed right of it').toEqual([]);
  expect([SHADOWED, Math.min(...row.map(lit)) - SHADOWED > 16], 'the shadowed value is 137 and the lit value more than 16 codes above it along the row').toEqual([137, true]);
}
/** Which of the pixel's R, G and B lie strictly between the shadowed and the lit value, by more than 1 code. */
const between = (im: Image, x: number): boolean[] => px(im, x, ROW).slice(0, 3).map((c) => c > SHADOWED + 1 && c < lit(x) - 1);
/** What the criterion holds of the row: a pixel strictly between, and none of them farther than 2 px from the CPU edge. */
function judged(im: Image): string[] {
  expect([im.width, im.height], 'the frame is 256 × 256 px: 1 px a unit').toEqual([SIZE, SIZE]);
  const xs = Array.from({ length: SIZE }, (_, x) => x);
  const failures = xs.filter((x) => fromEdge(x) > 2 && between(im, x).some(Boolean))
    .map((x) => `pixel (${x}, ${ROW}), ${fromEdge(x).toFixed(2)} px from the CPU edge, reads ${rgb(im, x, ROW)}, strictly between the shadowed value ${SHADOWED} and the lit value ${lit(x)}`);
  if (!xs.some((x) => between(im, x).every(Boolean))) failures.unshift(`row ${ROW}: ${NO_BETWEEN} the shadowed value ${SHADOWED} and the lit value; near the CPU edge it reads ${[-2, -1, 0, 1, 2].map((k) => `(${CROSSING + k}) ${rgb(im, CROSSING + k, ROW)}`).join('; ')}`);
  return failures;
}

describe(`${ID} a shadow's edge is antialiased, within 2 px of the CPU edge`, () => {
  it(`${ID} on a row across a 45° shadow edge, a pixel reads strictly between shadowed and lit, and none farther than 2 px from the CPU edge does`, () => {
    fixtureHolds();
    requireMetal();
    const [im] = windows(bin(), dir(), [fixture]);
    console.log(`${ID}: row ${ROW} reads ${[-3, -2, -1, 0, 1, 2, 3].map((k) => `(${CROSSING + k}) ${rgb(im!, CROSSING + k, ROW)}`).join('; ')}; lit there ${lit(CROSSING)}, shadowed ${SHADOWED}`);
    none(judged(im!), 'the row across the shadow edge');
  });

  it(`${ID} a planted edge with no antialiasing has no such pixel and fails`, () => {
    fixtureHolds();
    requireMetal();
    const [im] = windows(bin(), dir(), [fixture], 'shadow_edge_aliased');
    failsNaming(judged(im!), NO_BETWEEN, 'the planted edge with no antialiasing');
  });
});
