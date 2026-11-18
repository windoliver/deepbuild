// AC8 #1781.2282e9be: "A point field of 256 nodes, `-index` followed by 127 `+ 1`, is stored and each point holds
// 127 minus its index; `index` followed by 128 `+ 1` has 257 nodes and is refused, naming both counts.
// `sqrt(position.x)` with `fallback: 7` gives 7 at the 4 points with x = −0.5 m and 0.7071068 within 1e-6 at the other
// 4, with one `nonfinite` counting 4, and without a fallback it is refused at check. A planted evaluator that leaves a
// non-finite element at its earlier value fails, naming the element"
//
// Four documents, each holding `box`, `slab@1 {size: [1, 1, 1], shade: flat}`, with one stack each:
//   - counted: store {name: k, domain: point, type: f32, field: -index + 1 + 1 … (127 times)}: one node for the
//     minus, one for `index`, and two for each `+ 1`, 2 + 127 × 2 = 256;
//   - over: the same store with field `index + 1 + 1 … (128 times)`: 1 + 128 × 2 = 257 nodes;
//   - rooted: store {name: r, domain: point, type: f32, field: sqrt(position.x), fallback: 7}, then stores px, py, pz,
//     each point's own position (point, f32). The square root of −0.5 is not finite; of 0.5 it is 0.7071068;
//   - bare: the rooted store without its fallback.
//
// asserts:
//   - counted: the revision is presented, and the requirement `{kind: geometry.attributes, of: box, expect: {k:
//     {domain: point, type: f32, count: 8, values: [127, 126, 125, 124, 123, 122, 121, 120]}}}` PASSes, the row's `k`
//     holding 127 minus its index at each point;
//   - over: refused by an error issue `field.nodes` at items/box/modifiers/0/params/field naming nodes 257 and max 256;
//   - bare: refused by an error issue `fallback_missing` at or under items/box/modifiers/0;
//   - rooted: the revision is presented with exactly one `nonfinite` issue, not an error, naming the item `box`, the
//     attribute `r` and elements 4; a reading with no expect is INCONCLUSIVE; `r` is a point f32 of 8 values, 7 at
//     the 4 points with x = −0.5 m and 0.7071068 within 1e-6 at the 4 with x = 0.5 m;
//   - with the planted `store_nonfinite_keeps_earlier` (an element whose result is not finite keeps the value it had
//     before the store): exactly the 4 points with x = −0.5 m hold another value than 7, and the first is named,
//     `point <i>`.
import { describe, expect, it } from 'vitest';
import {
  BOX, FULL, PLANTED, TIMEOUT, admitted, brief, decided, expecting, failsNaming, issuesOf, judge, named, none, numbers, placesOf, positions, present, readOf,
  reading, refusalProblems, rowAt, sceneDoc, slabBox, store, useFolders, useShow, type JsonObject, type Judged,
} from './helpers.ts';
import { fmt, near, rootJudged } from './reference.ts';

/** The criterion: its number, and `#1781.` with the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = 'AC8 #1781.2282e9be';
const bin = useShow(FULL);
const folder = useFolders();

const COUNTED = `-index${' + 1'.repeat(127)}`;
const OVER = `index${' + 1'.repeat(128)}`;
/** One node for each number, name and operator of a field written with no call, swizzle or sum. */
const nodes = (field: string): number => (field.match(/[a-z]+|\d+|[-+]/g) ?? []).length;
const ROOT = 'sqrt(position.x)';

const fielded = (title: string, field: string): JsonObject => sceneDoc(title, { [BOX]: slabBox([store('k', 'point', 'f32', field)]) });
const rooted = (): JsonObject => sceneDoc('A box whose field is not finite on one side', { [BOX]: slabBox([store('r', 'point', 'f32', ROOT, { fallback: 7 }), ...positions('p', 'point')]) });
const bare = (): JsonObject => sceneDoc('A box whose root has no fallback', { [BOX]: slabBox([store('r', 'point', 'f32', ROOT)]) });
const INDEXED = expecting(BOX, { k: { domain: 'point', type: 'f32', count: 8, values: [127, 126, 125, 124, 123, 122, 121, 120] } });

/** The rooted reading, judged point by point from each point's own position. */
function rootRead(judged: Judged, what: string): ReturnType<typeof rootJudged> {
  const row = rowAt(judged, 0, what);
  decided(row, 'INCONCLUSIVE', `${what}: a reading with no expect`);
  return rootJudged(what, numbers(readOf(row, 'r', { domain: 'point', type: 'f32', count: 8 }, what), what), placesOf(row, 'p', 'point', 8, what));
}

describe(`${ID} a field's size, its fallback and its non-finite elements`, () => {
  it(`${ID} a 256-node point field is stored, each point holding 127 minus its index, and a 257-node one is refused, naming both counts; sqrt(position.x) with fallback 7 gives 7 at the 4 points with x = −0.5 m and 0.7071068 at the other 4, with one nonfinite counting 4, and is refused without a fallback; a planted evaluator that leaves a non-finite element at its earlier value fails, naming the element`, () => {
    expect([nodes(COUNTED), nodes(OVER)], 'the two fields hold 256 and 257 nodes').toEqual([256, 257]);

    // 256 nodes: stored.
    const counted = judge(bin(), folder(), fielded('A box with a field of 256 nodes', COUNTED), [INDEXED]);
    admitted(counted.shown, 'the box with a field of 256 nodes');
    const row = rowAt(counted, 0, 'the box with a field of 256 nodes');
    decided(row, 'PASS', 'k read for 127 minus each point\'s index');
    const k = numbers(readOf(row, 'k', { domain: 'point', type: 'f32', count: 8 }, 'the box with a field of 256 nodes'), 'the box with a field of 256 nodes');
    none(k.flatMap((v, i) => (near(v, 127 - i) ? [] : [`point ${i}: holds ${fmt(v)}, not ${127 - i}`])), 'each point holds 127 minus its index');

    // 257 nodes, and a root with no fallback: refused.
    const [over, unguarded] = present(bin(), folder(), [fielded('A box with a field of 257 nodes', OVER), bare()]);
    none([
      ...refusalProblems(over!, 'a field of 257 nodes', { code: 'field.nodes', at: `items/${BOX}/modifiers/0/params/field`, names: { nodes: 257, max: 256 } }),
      ...refusalProblems(unguarded!, 'sqrt(position.x) without a fallback', { code: 'fallback_missing', at: `items/${BOX}/modifiers/0` }),
    ], 'the two refusals');

    // The root with its fallback.
    const judged = judge(bin(), folder(), rooted(), [reading(BOX)]);
    admitted(judged.shown, 'the rooted box');
    const raised = issuesOf(judged.shown).filter((i) => i.code === 'nonfinite');
    expect(raised.map((i) => [i.severity !== 'error', i.ids.includes(BOX) || named(i, 'id') === BOX, named(i, 'attribute'), named(i, 'elements')]),
      `one nonfinite issue, not an error, names the item ${BOX}, the attribute r and 4 elements: ${brief(judged.shown['issues'] ?? null)}`).toEqual([[true, true, 'r', 4]]);
    none(rootRead(judged, 'the rooted box').problems, 'r at x = −0.5 m and at x = 0.5 m');

    // The planted evaluator that leaves a non-finite element at its earlier value.
    const planted = judge(bin(), folder(), rooted(), [reading(BOX)], PLANTED.keepsEarlier);
    admitted(planted.shown, `the rooted box under ${PLANTED.keepsEarlier}`);
    const twin = rootRead(planted, `the rooted box under ${PLANTED.keepsEarlier}`);
    expect(twin.wrong, `${PLANTED.keepsEarlier} leaves the 4 points with x = −0.5 m at another value, and no other; the problems were:\n  ${twin.problems.join('\n  ')}`).toEqual(twin.negative);
    failsNaming(twin.problems, [`point ${twin.negative[0]} at `], `the planted ${PLANTED.keepsEarlier}`);
  }, TIMEOUT);
});
