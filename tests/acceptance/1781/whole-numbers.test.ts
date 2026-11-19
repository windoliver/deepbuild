// AC5 #1781.d8b78c9f: "A u32 point attribute from `test.attrs@1` holding 2, 4, 8, 16, 32, 64, 128 and 256 passes
// through the same subdivide with all 26 values among those eight, each new point holding the value of the
// lowest-indexed source point it was made from. A planted subdivide that averages writes a value outside the eight
// and fails, naming the point"
//
// The fixture: `box`, a `test.attrs@1` whose one attribute is `{name: tag, domain: point, type: u32, values: [2, 4, 8,
// 16, 32, 64, 128, 256]}`, with the stack
//   0      subdivide {levels: 1, scheme: simple}
//   1–3    store px, py, pz: each point's own position after the subdivide (point, f32)
// Alpha's claim holds one reading of the whole stack's mesh, `{kind: geometry.attributes, of: box}`.
//
// Point i of the builder's box holds 2^(i + 1), so of any source points the lowest-indexed is the one whose value is
// least, wherever the builder stands its points. A point of the subdivided box is made from the corners nearest it:
// its own corner, its edge's two ends, or its face's four (reference.ts `tagsJudged`). The mean of two or four different
// powers of two is no power of two, so an average is never among the eight.
//
// asserts:
//   - the revision is presented; the reading's row is INCONCLUSIVE (a reading, never a pass);
//   - `tag` is a point u32 of 26 values, each one of the eight; the 26 points are a 1 m box's 8 corners, 12 edge
//     midpoints and 6 face centres; the 8 at its corners hold the eight values, each once; every other point holds
//     the least of the values at the corners it was made from;
//   - with the planted `subdivide_averages_whole` (a bool, i32 or u32 point attribute blended as a float one is): a
//     point holds a value outside the eight and is named, `point <i>`.
import { describe, expect, it } from 'vitest';
import {
  ATTRS, BOX, PLANTED, SUBDIVIDE, TIMEOUT, admitted, attrsBox, decided, failsNaming, judge, none, numbers, placesOf, positions, readOf, reading, rowAt, sceneDoc,
  useFolders, useShow, type JsonObject, type Judged,
} from './helpers.ts';
import { TAGS, tagsJudged } from './reference.ts';

/** The criterion: its number, and `#1781.` with the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = 'AC5 #1781.d8b78c9f';
const bin = useShow(ATTRS);
const folder = useFolders();

const doc = (): JsonObject => sceneDoc('A box whose points keep whole numbers', {
  [BOX]: attrsBox([{ name: 'tag', domain: 'point', type: 'u32', values: TAGS }], [SUBDIVIDE, ...positions('p', 'point')]),
});

/** The reading, judged point by point from each point's own position. */
function tagRead(judged: Judged, what: string): ReturnType<typeof tagsJudged> {
  const row = rowAt(judged, 0, what);
  decided(row, 'INCONCLUSIVE', `${what}: a reading with no expect`);
  return tagsJudged(what, numbers(readOf(row, 'tag', { domain: 'point', type: 'u32', count: 26 }, what), what), placesOf(row, 'p', 'point', 26, what));
}

describe(`${ID} a whole-number point attribute is never blended`, () => {
  it(`${ID} a u32 point attribute holding 2 to 256 passes through a simple subdivide with all 26 values among those eight, each new point holding its lowest-indexed source point's; a planted subdivide that averages writes a value outside the eight and fails, naming the point`, () => {
    const judged = judge(bin(), folder(), doc(), [reading(BOX)]);
    admitted(judged.shown, 'the tagged box');
    none(tagRead(judged, 'the subdivided box').problems, 'the tags after the subdivide');

    // The planted subdivide that averages.
    const planted = judge(bin(), folder(), doc(), [reading(BOX)], PLANTED.averages);
    admitted(planted.shown, `the tagged box under ${PLANTED.averages}`);
    const twin = tagRead(planted, `the subdivided box under ${PLANTED.averages}`);
    expect(twin.outside.length, `${PLANTED.averages} writes a value outside the eight; the problems were:\n  ${twin.problems.join('\n  ')}`).toBeGreaterThan(0);
    failsNaming(twin.problems, [`point ${twin.outside[0]} at `, 'outside the eight values'], `the planted ${PLANTED.averages}`);
  }, TIMEOUT);
});
