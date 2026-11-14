// AC2: "An item crossing a region's edge draws in both looks with coverage summing to one at every pixel, and a third
// look in one frame outside a transition window is refused naming the shot and time, while a cross-fade between two
// shots that each draw two looks draws all four inside its window"
//
// The edge films (helpers.ts: edgeDoc) put a slab across a region's edge: its left half in the shot's look, its right
// half inside the region's mask and so in the region's look. The four coverage looks (helpers.ts: BODY) draw the slab's
// front face in four colors that all have red 240, under tone map none at unit exposure, so the face draws each exactly.
// Wherever the two looks' coverage sums to one, the slab's pixel keeps red 240 whatever share each look has and whatever
// space they are mixed in; a gap lets the ground through and lowers it, an overlap raises it. So:
// - `split` at 1 s, its edge torn: every slab pixel (3 px inside its silhouette) has red 240 ± 1; well left of the edge
//   (30 px) the slab's most common color is look a's, well right of it look b's, each within one code (both looks draw
//   it). The planted `region_sides_clip_independently` fails, naming the pixels.
// - `crowded`: a second region's mask arrives on the slab at 2 s, so from then on three looks would draw in one frame
//   outside any transition: `view3d` refuses the document, the refusal naming the shot `crowded` with a time `t` in
//   whole flicks in [2 s, 4 s), and no earlier time. The same film without the second region is drawn at 2.5 s.
// - `fade`: shots `one` (look a, region b) and `two` (look c, region d) joined by a 1 s cross-fade centred on 2 s. It is
//   drawn (four looks inside the window are no refusal). At 1 s the slab is a | b, at 3 s c | d, each within one code;
//   at 2 s, inside the window, left of the edge its green lies strictly between a's and c's and right of it strictly
//   between b's and d's (all four draw), and at all three times every slab pixel keeps red 240 ± 1.

import { describe, expect, it } from 'vitest';
import {
  BODY, COVERAGE_LOOKS, FLICKS, TIMEOUT, ac, drawn, edgeColumn, edgeDoc, failsNaming, frameAt, framesOf, inconclusive, near,
  none, pixel, readPng, requireGpu, rgbText, run, shotTimes, show, slabMode, slabPixels, useBins, useDir, view3d, writeJson,
  type Image, type Planted, type Rgb,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const FPS = 30;
const MARGIN = 30;

/** Every slab pixel's red, against 240: a share of the two looks that doesn't sum to one moves it. */
function coverageProblems(image: Image, when: string): string[] {
  const pixels = slabPixels(3, [image.width, image.height]);
  const off: string[] = [];
  for (const [x, y] of pixels) {
    const c = pixel(image, x, y);
    if (Math.abs(c[0] - 240) > 1) off.push(`(${x}, ${y}) ${rgbText(c)}`);
  }
  return off.length ? [`${when}: ${off.length} of the slab's ${pixels.length} pixels have red other than 240 ± 1, so the looks' coverage there doesn't sum to one: ${off.slice(0, 8).join(', ')}`] : [];
}
/** The slab's most common color well left and well right of the edge, against the looks that should draw there. */
function sidesProblems(image: Image, when: string, left: Rgb, right: Rgb, names: [string, string]): string[] {
  const edge = edgeColumn([image.width, image.height]);
  const l = slabMode(image, (x) => x + 0.5 <= edge - MARGIN).color;
  const r = slabMode(image, (x) => x + 0.5 >= edge + MARGIN).color;
  return [
    ...(near(l, left, 1) ? [] : [`${when}: left of the edge the slab draws ${rgbText(l)}, not look ${names[0]}'s ${rgbText(left)}`]),
    ...(near(r, right, 1) ? [] : [`${when}: right of the edge the slab draws ${rgbText(r)}, not look ${names[1]}'s ${rgbText(right)}`]),
  ];
}

function split(planted?: Planted): string[] {
  requireGpu();
  const looks = COVERAGE_LOOKS();
  const d = dir();
  const doc = writeJson(d, 'split.json', edgeDoc('split', { edge: 'torn' }));
  const [reply] = run(bins.bin('deep-gpu'), d, [view3d({ doc, look: looks['a']!, looks, fps: FPS, from: 30, frames: 1, capture: [30], targets: ['final'] })], planted ? { planted } : {});
  const image = readPng(d, frameAt(framesOf(reply!, 'the split film at 1 s'), 30, 'the split film').final, 'the split film at 1 s');
  return [...coverageProblems(image, '1 s'), ...sidesProblems(image, '1 s', BODY.a, BODY.b, ['a', 'b'])];
}

describe(`${ac(2)} a region's edge splits an item between two looks; a third look is refused outside a transition, four draw inside one`, () => {
  it(`${ac(2)} a slab crossing a torn region edge draws in both looks, their coverage summing to one at every pixel`, () => {
    none(split(), 'the slab across the region\'s edge');
  }, TIMEOUT);

  it(`${ac(2)} (planted) each side clipped by its own copy of the edge leaves pixels whose coverage doesn't sum to one, and fails naming them`, () => {
    const plant: Planted = 'region_sides_clip_independently';
    failsNaming(split(plant), ['red other than 240'], `the planted ${plant}`);
  }, TIMEOUT);

  it(`${ac(2)} a third look in one frame outside a transition window is refused, naming the shot and the time`, () => {
    requireGpu();
    const looks = COVERAGE_LOOKS();
    const d = dir();
    const three = writeJson(d, 'crowded.json', edgeDoc('crowded', { third: true }));
    const two = writeJson(d, 'two.json', edgeDoc('crowded', { third: false }));
    const [refused, plain] = run(bins.bin('deep-gpu'), d, [
      view3d({ doc: three, look: looks['a']!, looks, fps: FPS, from: 0, frames: 120 }),
      view3d({ doc: two, look: looks['a']!, looks, fps: FPS, from: 75, frames: 1 }),
    ]);
    if (refused!['code'] === 'unsupported_platform') inconclusive('view3d reports unsupported_platform');
    framesOf(plain!, 'the crowded shot with one region, at 2.5 s');
    expect(refused!['code'], `three looks from 2 s in shot crowded are refused, not drawn: ${show(refused)}`).toBeDefined();
    expect(refused!['frames'], 'a refused document draws no frame').toBeUndefined();
    const times = shotTimes(refused!, 'crowded');
    expect(times.length, `the refusal names the shot crowded with a time t in flicks: ${show(refused)}`).toBeGreaterThan(0);
    for (const t of times) {
      expect(t >= 2 * FLICKS && t < 4 * FLICKS, `the time the refusal names, ${t} flicks (${(t / FLICKS).toFixed(4)} s), is when three looks would draw: in [2 s, 4 s)`).toBe(true);
    }
  }, TIMEOUT);

  it(`${ac(2)} a cross-fade between two shots that each draw two looks draws all four inside its window, coverage summing to one`, () => {
    requireGpu();
    const looks = COVERAGE_LOOKS();
    const d = dir();
    const doc = writeJson(d, 'fade.json', edgeDoc('fade'));
    const [reply] = run(bins.bin('deep-gpu'), d, [view3d({ doc, look: looks['a']!, looks, fps: FPS, from: 0, frames: 91, capture: [30, 60, 90], targets: ['final'] })]);
    drawn(reply!, 'the cross-faded film');
    const frames = framesOf(reply!, 'the cross-faded film');
    const at = (n: number): Image => readPng(d, frameAt(frames, n, 'the cross-faded film').final, `the cross-faded film at frame ${n}`);
    const [one, mid, two] = [at(30), at(60), at(90)];
    const problems = [
      ...coverageProblems(one, '1 s'), ...coverageProblems(mid, '2 s'), ...coverageProblems(two, '3 s'),
      ...sidesProblems(one, '1 s (shot one alone)', BODY.a, BODY.b, ['a', 'b']),
      ...sidesProblems(two, '3 s (shot two alone)', BODY.c, BODY.d, ['c', 'd']),
    ];
    const edge = edgeColumn([mid.width, mid.height]);
    const l = slabMode(mid, (x) => x + 0.5 <= edge - MARGIN).color;
    const r = slabMode(mid, (x) => x + 0.5 >= edge + MARGIN).color;
    const between = (v: number, p: number, q: number): boolean => v >= Math.min(p, q) + 3 && v <= Math.max(p, q) - 3;
    if (!between(l[1], BODY.a[1], BODY.c[1])) problems.push(`2 s, inside the window: left of the edge the slab draws ${rgbText(l)}, its green not strictly between look a's ${BODY.a[1]} and look c's ${BODY.c[1]}, so both don't draw there`);
    if (!between(r[1], BODY.b[1], BODY.d[1])) problems.push(`2 s, inside the window: right of the edge the slab draws ${rgbText(r)}, its green not strictly between look b's ${BODY.b[1]} and look d's ${BODY.d[1]}, so both don't draw there`);
    none(problems, 'the cross-fade between two two-look shots');
  }, TIMEOUT);
});
