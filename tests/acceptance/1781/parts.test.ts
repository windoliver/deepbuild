// AC7 #1781.9a742846: "On the slab box, `store {name: w, field: -99}` followed by
// `store {name: w, on: top, field: 10 * position.x + 20 * position.z}` leaves the 4 points of part `top` at −15, −5,
// 5 and 15 and the 4 others at −99. A planted evaluator that runs over the whole domain overwrites the 4 others and
// fails, naming the first"
//
// The fixture: `box`, `slab@1 {size: [1, 1, 1], shade: flat}`, whose part `top` is its upper face, with the stack
//   0      store {name: w, domain: point, type: f32, field: -99}
//   1      store {name: w, domain: point, type: f32, field: 10 * position.x + 20 * position.z}, on: top
//   2–4    store px, py, pz: each point's own position (point, f32)
// Alpha's claim holds one reading of the whole stack's mesh, `{kind: geometry.attributes, of: box}`.
//
// Worked by hand (reference.ts `partJudged`): at (x, z) = (−0.5, −0.5), (0.5, −0.5), (−0.5, 0.5) and (0.5, 0.5) the second
// field is −15, −5, 5 and 15. The 4 points of `top` are the box's upper corners; the 4 others, its lower corners,
// keep the first store's −99.
//
// asserts:
//   - the revision is presented; the reading's row is INCONCLUSIVE (a reading, never a pass);
//   - `w` is a point f32 of 8 values; the 8 points are the box's corners, at x and z = ±0.5 m; each upper point
//     holds 10 x + 20 z at its own position within 1e-6, so the four hold −15, −5, 5 and 15, and each lower point
//     holds −99;
//   - with the planted `store_ignores_on` (a store with `on` evaluates over its whole domain): exactly the 4 lower
//     points hold another value than −99, and the first of them is named, `point <i>`.
import { describe, expect, it } from 'vitest';
import {
  BOX, FULL, PLANTED, TIMEOUT, admitted, decided, failsNaming, judge, none, numbers, placesOf, positions, readOf, reading, rowAt, sceneDoc, slabBox, store,
  useFolders, useShow, type JsonObject, type Judged,
} from './helpers.ts';
import { partJudged } from './reference.ts';

/** The criterion: its number, and `#1781.` with the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = 'AC7 #1781.9a742846';
const bin = useShow(FULL);
const folder = useFolders();

const doc = (): JsonObject => sceneDoc('A box whose top keeps a field of its own', {
  [BOX]: slabBox([
    store('w', 'point', 'f32', '-99'),
    store('w', 'point', 'f32', '10 * position.x + 20 * position.z', { on: 'top' }),
    ...positions('p', 'point'),
  ]),
});

/** The reading, judged point by point from each point's own position. */
function partRead(judged: Judged, what: string): ReturnType<typeof partJudged> {
  const row = rowAt(judged, 0, what);
  decided(row, 'INCONCLUSIVE', `${what}: a reading with no expect`);
  return partJudged(what, numbers(readOf(row, 'w', { domain: 'point', type: 'f32', count: 8 }, what), what), placesOf(row, 'p', 'point', 8, what));
}

describe(`${ID} a store on a part writes only that part's elements`, () => {
  it(`${ID} store w = −99, then store w on top = 10 x + 20 z, leaves the 4 points of top at −15, −5, 5 and 15 and the 4 others at −99; a planted evaluator that runs over the whole domain overwrites the 4 others and fails, naming the first`, () => {
    const judged = judge(bin(), folder(), doc(), [reading(BOX)]);
    admitted(judged.shown, 'the slab box');
    none(partRead(judged, 'the slab box').problems, 'w on the top and off it');

    // The planted evaluator that runs over the whole domain.
    const planted = judge(bin(), folder(), doc(), [reading(BOX)], PLANTED.wholeDomain);
    admitted(planted.shown, `the slab box under ${PLANTED.wholeDomain}`);
    const twin = partRead(planted, `the slab box under ${PLANTED.wholeDomain}`);
    expect(twin.wrong, `${PLANTED.wholeDomain} overwrites the 4 others and no point of top; the problems were:\n  ${twin.problems.join('\n  ')}`).toEqual(twin.others);
    failsNaming(twin.problems, [`point ${twin.others[0]} at `], `the planted ${PLANTED.wholeDomain}`);
  }, TIMEOUT);
});
