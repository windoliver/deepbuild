// AC3: A channel keying `items/eq/parts/t-b_5e2/role` from ink to accent at 1 s recolors only that part's paths,
// every other part's pixels unchanged, and `opacity` from 1 to 0.3 on the other four parts dims them to 0.3
// within one code value.
import { describe, expect, it } from 'vitest';
import {
  codeDiff, countWhere, expectClean, f32Channel, firstDifferenceIn, flicks, pixel, put, rasterAt, role, roleChannel, same, scratch,
  useRenderBinary, vectorDoc, vectorItem, type Image, type JsonObject,
} from './helpers.ts';

useRenderBinary();
const dir = scratch('channels');

// eq5.svg: viewBox 0 0 300 80, drawn at size 300 × 80 from the origin, so its coordinates are document u.
// Rects [x, y, w, h] of each part's paths, all filled #000000 (ink).
const PATHS: Record<string, [number, number, number, number][]> = {
  't-a_1': [[10, 20, 40, 40]],
  't-b_5e2': [[70, 20, 30, 40], [106, 20, 14, 40]],
  't-c_7': [[140, 20, 40, 40]],
  't-d_3f': [[200, 20, 40, 40]],
  't-e_9': [[256, 20, 34, 40]],
};
const TARGET = 't-b_5e2';
const OTHERS = Object.keys(PATHS).filter((p) => p !== TARGET);

const src = put(dir, 'eq5.svg');
const doc = (channels?: JsonObject): JsonObject =>
  vectorDoc('ac3-eq', [300, 80], [vectorItem('eq', { src, size: [300, 80], colors: { '#000000': 'ink' }, alt: 'a + b = c - d e' })], channels);

/** True when (x, y) lies within `pad` px of one of the part's path rects. */
const nearPart = (id: string, pad: number) => (x: number, y: number): boolean =>
  PATHS[id]!.some(([rx, ry, rw, rh]) => x >= rx - pad && x < rx + rw + pad && y >= ry - pad && y < ry + rh + pad);

/** Every pixel of a part's paths, inset 1 px from their edges, meets `f`; answers the first that doesn't. */
function interiorFails(image: Image, id: string, f: (c: [number, number, number]) => boolean): string | null {
  for (const [rx, ry, rw, rh] of PATHS[id]!) {
    for (let y = ry + 1; y < ry + rh - 1; y++) for (let x = rx + 1; x < rx + rw - 1; x++) {
      const c = pixel(image, x, y);
      if (!f(c)) return `${id}: pixel (${x}, ${y}) reads ${JSON.stringify(c)}`;
    }
  }
  return null;
}

const T = [flicks(0), flicks(1, 2), flicks(1), flicks(2)];

describe('AC3 a vector part is a channel target: its role and its opacity', () => {
  it('AC3 keying items/eq/parts/t-b_5e2/role from ink to accent at 1 s recolors both of that part\'s paths and no other pixel', () => {
    const plain = doc();
    expectClean(plain, dir, 'eq5.svg with no channel');
    const keyed = doc({ recolor: roleChannel(`items/eq/parts/${TARGET}/role`, [[0, 'ink'], [1, 'accent']]) });
    expectClean(keyed, dir, 'eq5.svg with the role channel');
    const [s] = rasterAt(dir, plain, dir, [flicks(1)], 'eq5.svg, no channel');
    for (const id of Object.keys(PATHS)) expect(interiorFails(s!, id, (c) => same(c, role('ink'))), `with no channel, ${id} draws in ink`).toBeNull();
    const [, half, at1, at2] = rasterAt(dir, keyed, dir, T, 'eq5.svg, role keyed');
    expect(firstDifferenceIn(half!, s!, 0, 0, 300, 80), 'at 0.5 s the part is still ink: the frame is the plain one, byte for byte').toBeNull();
    for (const [name, frame] of [['1 s', at1!], ['2 s', at2!]] as const) {
      expect(interiorFails(frame, TARGET, (c) => codeDiff(c, role('accent')) <= 1), `at ${name} both of ${TARGET}'s paths are accent`).toBeNull();
      expect(firstDifferenceIn(frame, s!, 0, 0, 300, 80, nearPart(TARGET, 1)), `at ${name} every pixel off ${TARGET}'s paths is the plain frame's, byte for byte`).toBeNull();
      const changed = countWhere(frame, 0, 0, 300, 80, (c, x, y) => !same(c, pixel(s!, x, y)));
      expect(changed, `at ${name} the recolor changes ${TARGET}'s pixels (28 × 38 + 12 × 38 inside its paths at least)`).toBeGreaterThanOrEqual(1520);
    }
  });

  it('AC3 opacity from 1 to 0.3 on the other four parts dims each to 0.3 within one code value, leaving t-b_5e2 and the ground exact', () => {
    const plain = doc();
    const channels: JsonObject = {};
    for (const id of OTHERS) channels[`dim-${id}`] = f32Channel(`items/eq/parts/${id}/opacity`, [[0, 1], [1, 0.3]]);
    const keyed = doc(channels);
    expectClean(keyed, dir, 'eq5.svg with four opacity channels');
    const [s] = rasterAt(dir, plain, dir, [0], 'eq5.svg, no channel');
    const [at0, , at1, at2] = rasterAt(dir, keyed, dir, T, 'eq5.svg, opacity keyed');
    expect(firstDifferenceIn(at0!, s!, 0, 0, 300, 80), 'at 0 s every part is at opacity 1: the plain frame, byte for byte').toBeNull();
    // Ink (0) at opacity 0.3 over the ground (255), composited in sRGB-encoded space as 2D writer layers are:
    // 0.3 × 0 + 0.7 × 255 = 178.5 on each channel. Linear-light compositing gives 218 and fails.
    const dimmed = 0.7 * 255;
    for (const [name, frame] of [['1 s', at1!], ['2 s', at2!]] as const) {
      for (const id of OTHERS) {
        expect(interiorFails(frame, id, (c) => c.every((v) => Math.abs(v - dimmed) <= 1)), `at ${name} ${id} reads ${dimmed} within one code value`).toBeNull();
      }
      expect(firstDifferenceIn(frame, s!, 0, 0, 300, 80, (x, y) => OTHERS.some((id) => nearPart(id, 1)(x, y))), `at ${name} ${TARGET} and the ground are the plain frame's, byte for byte`).toBeNull();
    }
  });
});
