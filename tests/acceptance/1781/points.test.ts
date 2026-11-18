// AC4 #1781.90e5e7d8: "The same box, whose points lie at x and z = ±0.5 m, stores the point field
// `2 * position.x + 2 * position.z + 2` as f32. After `subdivide {levels: 1, scheme: simple}` each of its 26 points
// holds the field's value at its own position within 1e-6: the 8 source points keep theirs, each of the 12 edge points
// holds the mean of its edge's two ends, each of the 6 face points the mean of its face's four, and the 26 values sum
// to 52. A planted subdivide that copies one end's value to an edge point fails on a ring edge, naming the point"
//
// The fixture: `box`, `slab@1 {size: [1, 1, 1], shade: flat}`, with the stack
//   0      store {name: f, domain: point, type: f32, field: 2 * position.x + 2 * position.z + 2}
//   1      subdivide {levels: 1, scheme: simple}
//   2–4    store px, py, pz: each point's own position after the subdivide (point, f32)
// Alpha's claim holds one reading of the whole stack's mesh, `{kind: geometry.attributes, of: box}`.
//
// Worked by hand (reference.ts `rampJudged`): the field is 0, 2, 2 and 4 at the corners (x, z) = (−0.5, −0.5), (0.5, −0.5),
// (−0.5, 0.5) and (0.5, 0.5), at both heights, so the 8 source points sum to 16. A ring edge (an edge of the top or
// the bottom outline) joins two corners whose values differ by 2, so its point holds 1 or 3; an upright edge joins
// two of one value. The 12 edge points sum to 2 × (1 + 3 + 3 + 1) + (0 + 2 + 2 + 4) = 24, the 6 face points to
// 2 + 2 + 1 + 3 + 1 + 3 = 12, and 16 + 24 + 12 = 52.
//
// asserts:
//   - the revision is presented; the reading's row is INCONCLUSIVE (a reading, never a pass);
//   - `f` is a point f32 of 26 values; the 26 points are the box's 8 corners, 12 edge midpoints and 6 face centres,
//     at x and z = ±0.5 m and half way; each point holds the mean of the field at the corners it was made from (its
//     own corner, its edge's two ends or its face's four), which is the field at its own position, within 1e-6; the
//     26 values sum to 52;
//   - with the planted `subdivide_edge_copies_end` (an edge point takes one end's value of a float point attribute):
//     a point of a ring edge holds another value and is named, `point <i>`, and no source point or upright edge's
//     point is wrong.
import { describe, expect, it } from 'vitest';
import {
  BOX, FULL, PLANTED, SUBDIVIDE, TIMEOUT, admitted, decided, failsNaming, judge, none, numbers, placesOf, positions, readOf, reading, rowAt, sceneDoc, slabBox,
  store, useFolders, useShow, type JsonObject, type Judged,
} from './helpers.ts';
import { rampJudged } from './reference.ts';

/** The criterion: its number, and `#1781.` with the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = 'AC4 #1781.90e5e7d8';
const bin = useShow(FULL);
const folder = useFolders();

const FIELD = '2 * position.x + 2 * position.z + 2';
const doc = (): JsonObject => sceneDoc('A flat box whose points keep a ramp', {
  [BOX]: slabBox([store('f', 'point', 'f32', FIELD), SUBDIVIDE, ...positions('p', 'point')]),
});

/** The reading, judged point by point from each point's own position. */
function rampRead(judged: Judged, what: string): ReturnType<typeof rampJudged> {
  const row = rowAt(judged, 0, what);
  decided(row, 'INCONCLUSIVE', `${what}: a reading with no expect`);
  return rampJudged(what, numbers(readOf(row, 'f', { domain: 'point', type: 'f32', count: 26 }, what), what), placesOf(row, 'p', 'point', 26, what));
}

describe(`${ID} a float point attribute interpolates through a subdivide`, () => {
  it(`${ID} after a simple subdivide each of the box's 26 points holds 2 x + 2 z + 2 at its own position within 1e-6, an edge point the mean of its two ends, a face point the mean of its four, 52 in all; a planted subdivide that copies one end's value to an edge point fails on a ring edge, naming the point`, () => {
    const judged = judge(bin(), folder(), doc(), [reading(BOX)]);
    admitted(judged.shown, 'the flat box');
    none(rampRead(judged, 'the subdivided box').problems, 'the ramp after the subdivide');

    // The planted subdivide that copies one end's value to an edge point.
    const planted = judge(bin(), folder(), doc(), [reading(BOX)], PLANTED.edgePoint);
    admitted(planted.shown, `the flat box under ${PLANTED.edgePoint}`);
    const twin = rampRead(planted, `the subdivided box under ${PLANTED.edgePoint}`);
    const onRing = twin.wrong.filter((i) => twin.ring.includes(i));
    expect(onRing.length, `${PLANTED.edgePoint} fails on a ring edge's point; the problems were:\n  ${twin.problems.join('\n  ')}`).toBeGreaterThan(0);
    failsNaming(twin.problems, [`point ${onRing[0]} at `], `the planted ${PLANTED.edgePoint}`);
    expect(twin.wrong.filter((i) => twin.kept.includes(i)), 'no source point and no upright edge\'s point holds another value: copying an end changes nothing there').toEqual([]);
  }, TIMEOUT);
});
