// AC3 #1781.c26a7b7d: "A 1 m slab box with `shade: flat` stores the corner field
// `normal.x + 2 * normal.y + 4 * normal.z` as f32. Its 24 corners hold −4, −2, −1, 1, 2 and 4, each 4 times, and the 3
// corners at every point hold 3 different values. After `subdivide {levels: 1, scheme: simple}` its 96 corners hold
// the same six values, each 16 times; a planted subdivide that keeps one value per welded point fails, naming the
// first point"
//
// The fixture: `box`, `slab@1 {size: [1, 1, 1], shade: flat}`, with the stack
//   0      store {name: n, domain: corner, type: f32, field: normal.x + 2 * normal.y + 4 * normal.z}
//   1–3    store cx, cy, cz: each corner's own position (corner, f32, position.x | .y | .z)
//   4      subdivide {levels: 1, scheme: simple}
//   5–7    store dx, dy, dz: each corner's own position after the subdivide
//   8–10   store px, py, pz: each point's own position after the subdivide (point, f32)
// Alpha's claim holds two readings of it, neither with an `expect`: `{kind: geometry.attributes, of: box, after: 3}`
// (the mesh before the subdivide) and `{kind: geometry.attributes, of: box}` (the whole stack's).
//
// What the corners must hold is worked from the field (reference.ts `cornersBefore`, `cornersAfter`): on a flat box
// the corner of a face holds that face's code, ±1 for ±x, ±2 for ±y, ±4 for ±z, so the corners standing at one place
// hold one code for each face through it: 3 different codes at a source point; after the subdivide 4 corners at an
// edge point, 2 of each of its 2 faces, and 4 at a face point, all of its 1 face. Each face's code is then held 4
// times before and 4 + 4 × 2 + 4 = 16 times after.
//
// asserts:
//   - the revision is presented; each reading's row is INCONCLUSIVE (a reading, never a pass);
//   - before: `n` is a corner f32 of 24 values; the corners stand 3 at each of the box's 8 corners, each 3 holding
//     the 3 codes of the faces through it; each of the six codes is held 4 times;
//   - after: `n` holds 96 values; the 26 points are the box's 8 corners, 12 edge midpoints and 6 face centres; the
//     corners at each point hold what its faces give; each code is held 16 times;
//   - with the planted `subdivide_corners_per_point` (a corner attribute through the subdivide keeps one value per
//     welded point): the corners at a point on more than one face hold one value, so the check of the corners at
//     each point fails, and its first problem names the first such point, `point <i>`, by its index.
import { describe, expect, it } from 'vitest';
import {
  BOX, FULL, PLANTED, SUBDIVIDE, TIMEOUT, admitted, decided, judge, none, numbers, placesOf, positions, readOf, reading, rowAt, sceneDoc, slabBox, store,
  useFolders, useShow, type JsonObject, type Judged,
} from './helpers.ts';
import { cornersAfter, cornersBefore } from './reference.ts';

/** The criterion: its number, and `#1781.` with the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = 'AC3 #1781.c26a7b7d';
const bin = useShow(FULL);
const folder = useFolders();

const FIELD = 'normal.x + 2 * normal.y + 4 * normal.z';
/** The last modifier before the subdivide. */
const BEFORE = 3;
const doc = (): JsonObject => sceneDoc('A flat box whose corners keep their faces', {
  [BOX]: slabBox([store('n', 'corner', 'f32', FIELD), ...positions('c', 'corner'), SUBDIVIDE, ...positions('d', 'corner'), ...positions('p', 'point')]),
});
const CHECKS = [reading(BOX, BEFORE), reading(BOX)];

/** The two readings, each judged against the field: before the subdivide, and after it point by point. */
function cornersRead(judged: Judged, what: string): { before: string[]; after: ReturnType<typeof cornersAfter> } {
  const b = rowAt(judged, 0, `${what}, before the subdivide`);
  decided(b, 'INCONCLUSIVE', `${what}: a reading with no expect, before the subdivide,`);
  const before = cornersBefore(
    numbers(readOf(b, 'n', { domain: 'corner', type: 'f32', count: 24 }, `${what}, before the subdivide`), what),
    placesOf(b, 'c', 'corner', 24, `${what}, before the subdivide`),
  );
  const a = rowAt(judged, 1, `${what}, after the subdivide`);
  decided(a, 'INCONCLUSIVE', `${what}: a reading with no expect, after the subdivide,`);
  const after = cornersAfter(
    numbers(readOf(a, 'n', { domain: 'corner', type: 'f32', count: 96 }, `${what}, after the subdivide`), what),
    placesOf(a, 'd', 'corner', 96, `${what}, after the subdivide`),
    placesOf(a, 'p', 'point', 26, `${what}, after the subdivide`),
  );
  return { before, after };
}

describe(`${ID} a corner attribute is carried inside its source face`, () => {
  it(`${ID} the flat box's 24 corners hold −4, −2, −1, 1, 2 and 4 four times each, 3 different at every point, and after a simple subdivide its 96 corners hold them 16 times each; a planted subdivide that keeps one value per welded point fails, naming the first point`, () => {
    const judged = judge(bin(), folder(), doc(), CHECKS);
    admitted(judged.shown, 'the flat box');
    const read = cornersRead(judged, 'the flat box');
    none([...read.before, ...read.after.shape, ...read.after.points, ...read.after.counts], 'the corner field before and after the subdivide');

    // The planted subdivide that keeps one value per welded point.
    const planted = judge(bin(), folder(), doc(), CHECKS, PLANTED.corners);
    admitted(planted.shown, `the flat box under ${PLANTED.corners}`);
    const twin = cornersRead(planted, `the flat box under ${PLANTED.corners}`).after;
    none(twin.shape, `the subdivided box's points and corners under ${PLANTED.corners}`);
    expect(twin.points.length, `${PLANTED.corners} fails the check of the corners at each point, but it found nothing wrong`).toBeGreaterThan(0);
    expect(twin.points[0]!.startsWith(`point ${twin.first} at `), `the first problem names the first point on more than one face, point ${twin.first}:\n  ${twin.points.join('\n  ')}`).toBe(true);
  }, TIMEOUT);
});
