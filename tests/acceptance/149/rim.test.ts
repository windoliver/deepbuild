// AC11 #149.c911c0df: A disc of radius 29 px under rims at 160° and 20°, each 3.5 px wide, draws rim coverage on both its
// left and right edges, mirror-symmetric about its vertical axis within 1 px and none on its lower quarter; a planted
// look that keeps only the first rim leaves the right edge bare and fails, naming the rim.
//
// The rim's coverage is what the rims add: the disc drawn with the two rims less the same disc with none, in f32, so no
// test reads a color to judge it. Angles run counter-clockwise from the right, so 160° and 20° are the upper left and the
// upper right: the criterion's own left and right edges fix that. "Its lower quarter" reads as the quarter of the disc
// centered on straight down, the sector within 45° of it (README: Readings). "Each 3.5 px wide" is held at each rim's own
// angle, across the contour, within the 1 px the criterion allows.
//
// Wrong programs: only the first rim kept (the planted `rim_keeps_first`), and a rim list refused or read as one; a rim at
// the look's `dir`, or mirrored; a rim that wraps round under the disc.
import { describe, expect, it } from 'vitest';
import { AC, at, failsNaming, figure, layerFloats, layersCall, look, mark, none, requireMetal, runGpu, useDir, useGpu, type Floats, type JsonObject, type Planted } from './helpers.ts';

const ID = AC[11];
const bin = useGpu();
const dir = useDir();
const SIZE = 128;
const C = 64; const R = 29; const WIDE = 3.5;
const RIMS = [160, 20];

const doc = figure('rim-149', [SIZE, SIZE], { disc: mark('disc', 'circle@1', 'a0', { center: [C, C], r: R, paint: { fill: { role: 'sepia' } } }) }, { collections: { faces: { members: ['disc'] } } });
const lit = (rim: JsonObject[]): JsonObject => look({ id: 'rim-149', light: { dir: 135, elevation: 45, rim } });
const WITH = lit(RIMS.map((d, i) => ({ role: i === 0 ? 'vermilion' : 'ochre', width: WIDE, dir: d, on: 'faces' })));
const WITHOUT = lit([]);

interface Added { mask: boolean[]; amount: number[] }
/** What the rims add at each pixel, the largest channel's change, and where that passes 2/255. */
function added(planted?: Planted): Added {
  const out = dir();
  const [a, b] = runGpu(bin(), out, [layersCall(doc, WITH), layersCall(doc, WITHOUT)], planted);
  const on: Floats = layerFloats(out, a!, 'main', [SIZE, SIZE], 'the disc with its rims');
  const off: Floats = layerFloats(out, b!, 'main', [SIZE, SIZE], 'the disc with none');
  const amount = new Array<number>(SIZE * SIZE).fill(0);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    amount[y * SIZE + x] = Math.max(...[0, 1, 2, 3].map((c) => Math.abs(at(on, x, y, c) - at(off, x, y, c))));
  }
  return { amount, mask: amount.map((a) => a > 2 / 255) };
}
/** A pixel's angle about the disc's center, 0° right, 90° up, in (−180, 180]. */
const angleOf = (x: number, y: number): number => (Math.atan2(C - (y + 0.5), x + 0.5 - C) * 180) / Math.PI;
const radiusOf = (x: number, y: number): number => Math.hypot(x + 0.5 - C, y + 0.5 - C);
const near = (a: number, b: number, within: number): boolean => Math.abs(((a - b + 540) % 360) - 180) <= within;

/** A rim's width across the contour on its own ray: the integral of its coverage, the change as a share of its peak. */
function widthOn(amount: number[], deg: number, peak: number): number {
  const a = (deg * Math.PI) / 180;
  let sum = 0;
  for (let r = R - 8; r <= R + 8; r += 0.125) {
    const sx = C + r * Math.cos(a) - 0.5; const sy = C - r * Math.sin(a) - 0.5;
    const x0 = Math.floor(sx); const y0 = Math.floor(sy); const fx = sx - x0; const fy = sy - y0;
    const read = (x: number, y: number): number => amount[y * SIZE + x]!;
    sum += ((read(x0, y0) * (1 - fx) + read(x0 + 1, y0) * fx) * (1 - fy) + (read(x0, y0 + 1) * (1 - fx) + read(x0 + 1, y0 + 1) * fx) * fy) * 0.125;
  }
  return sum / peak;
}
function problems({ mask, amount }: Added): string[] {
  const failures: string[] = [];
  const has = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < SIZE && y < SIZE && mask[y * SIZE + x]!;
  RIMS.forEach((deg, i) => {
    const pixels: [number, number][] = [];
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (has(x, y) && near(angleOf(x, y), deg, 12) && radiusOf(x, y) > R - 8) pixels.push([x, y]);
    const side = deg > 90 ? 'left' : 'right';
    if (pixels.length === 0) { failures.push(`rim ${i} at ${deg}°: the ${side} edge is bare`); return; }
    const wide = widthOn(amount, deg, Math.max(...pixels.map(([x, y]) => amount[y * SIZE + x]!)));
    if (Math.abs(wide - WIDE) > 1) failures.push(`rim ${i} at ${deg}°: ${wide.toFixed(2)} px wide, not ${WIDE} within 1 px`);
  });
  // A mirror of pixel index x about the axis at x = 64 is 127 − x.
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    if (!has(x, y)) continue;
    let matched = false;
    for (let dy = -1; dy <= 1 && !matched; dy++) for (let dx = -1; dx <= 1 && !matched; dx++) matched = has(SIZE - 1 - x + dx, y + dy);
    if (!matched) failures.push(`the rim at (${x}, ${y}) has no mirror within 1 px`);
    if (near(angleOf(x, y), -90, 45)) failures.push(`the rim reaches the lower quarter, at (${x}, ${y})`);
  }
  return failures;
}

describe(`${ID} a drawing look's two rims`, () => {
  it(`${ID} rims at 160° and 20° draw on both edges, mirror-symmetric within 1 px, none on the lower quarter`, () => {
    requireMetal();
    const drawn = added();
    expect(drawn.mask.some(Boolean), 'the rims draw').toBe(true);
    none(problems(drawn), 'the rims off the criterion');
  });

  it(`${ID} a planted look keeping only the first rim leaves the right edge bare and fails, naming the rim`, () => {
    requireMetal();
    failsNaming(problems(added('rim_keeps_first')), 'rim 1 at 20°', 'the look that keeps only the first rim');
  });
});
