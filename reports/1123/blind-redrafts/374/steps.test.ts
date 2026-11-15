import { describe, expect, it } from 'vitest';
import {
  LOOK, PS, PS_MID, codeError, distanceFrom, encodedRamp, expectClean, figure, lookRole, oklabRamp, pixel, raster, same,
  scratch, useRenderBinary, type JsonObject, type Rgb, type Spec,
} from './helpers.ts';

useRenderBinary();
const dir = scratch('steps');

const STEPS: JsonObject = { over: 'children', stops: [{ at: 0, role: 'ps.a' }, { at: 1, role: 'ps.b' }], by: 'order' };

/** A group of five 60 u squares in a row (the i-th at x = 20 + 80 i), each filled by the same steps; `orders[i]` is square i's order key. */
function row(orders: string[]): JsonObject {
  const list: Spec[] = [{ id: 'row', kind: 'group@1', params: {} }];
  orders.forEach((order, i) => list.push({
    id: `sq${i}`, kind: 'rect@1', parent: 'row', order, params: { box: [20 + 80 * i, 20, 60, 60], paint: { fill: { steps: STEPS } } },
  }));
  return figure([440, 100], list);
}

/** The centre pixel of square i, and its four inner corners (a step is one solid color). */
const centre = (i: number): [number, number] => [50 + 80 * i, 50];
const corners = (i: number): [number, number][] => [[22, 22], [77, 22], [22, 77], [77, 77]].map(([x, y]) => [x! + 80 * i, y!]);

describe('AC3 steps give each member of a group one solid color mixed from the stops by its rank', () => {
  it('AC3 steps {over: children, stops: [{at: 0, role: a}, {at: 1, role: b}], by: order} over 5 squares colors the third at the OKLab midpoint within 0.001 ΔEOK, and the first and last exactly a and b', () => {
    const doc = row(['a00', 'a01', 'a02', 'a03', 'a04']);
    expectClean(doc, LOOK, 'steps over five children');
    // The check can fail: the midpoint mixed in encoded sRGB is not the OKLab midpoint.
    expect(distanceFrom(encodedRamp(PS, 0.5).map(Math.round) as Rgb, PS_MID), 'an encoded-sRGB midpoint is more than 0.001 ΔEOK off').toBeGreaterThan(0.001);

    const { image } = raster(dir, doc, LOOK, 'five squares');
    expect(pixel(image, ...centre(0)), 'the first square reads exactly the first role').toEqual(lookRole('ps.a'));
    expect(pixel(image, ...centre(4)), 'the last square reads exactly the last role').toEqual(lookRole('ps.b'));
    const third = pixel(image, ...centre(2));
    expect(distanceFrom(third, PS_MID), `the third square reads ${JSON.stringify(third)}, ΔEOK from the stops' OKLab midpoint`).toBeLessThanOrEqual(0.001);
    // The second and fourth sit a quarter and three quarters along the ramp.
    for (const [i, t] of [[1, 0.25], [3, 0.75]] as [number, number][]) {
      expect(codeError(pixel(image, ...centre(i)), oklabRamp(PS, t)), `square ${i} reads the ramp at ${t}`).toBeLessThanOrEqual(1);
    }
    // Each member is one solid color: its corners read what its centre reads.
    for (let i = 0; i < 5; i++) for (const [x, y] of corners(i)) expect(same(pixel(image, x, y), pixel(image, ...centre(i))), `square ${i} is solid: (${x}, ${y}) differs from its centre`).toBe(true);
  }, 300_000);

  it('AC3 members take their rank from their order keys, not from their position or their ID', () => {
    // sq0 … sq4 stand left to right, but their order keys rank them sq2, sq0, sq4, sq1, sq3 (ranks 2, 0, 4, 1, 3 by key a00 …).
    const ranks = [2, 0, 4, 1, 3];
    const doc = row(ranks.map((r) => `a0${r}`));
    expectClean(doc, LOOK, 'steps with shuffled order keys');
    const { image } = raster(dir, doc, LOOK, 'shuffled');
    const failures: string[] = [];
    ranks.forEach((rank, i) => {
      const expected = oklabRamp(PS, rank / 4);
      const e = codeError(pixel(image, ...centre(i)), expected);
      if (e > 1) failures.push(`sq${i} (rank ${rank}) reads ${JSON.stringify(pixel(image, ...centre(i)))}, ${e.toFixed(2)} code values from the ramp at ${rank / 4}`);
    });
    expect(failures, 'every square against the ramp at its rank').toEqual([]);
  }, 300_000);
});
