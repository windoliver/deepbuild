// AC6 #1781.11d8dbb9: "A box from `test.attrs@1` with an f32 edge attribute passes through
// `array {count: 3, offset: [2, 0, 0]}`, its copies 2 m apart, with 36 edge values, each equal to its source edge's.
// Through `subdivide` it is refused, naming `mod.subdivide@1`, the attribute, `edge` and `f32`. A planted subdivide
// that builds without the attribute fails, naming it"
//
// The fixture: `box`, a `test.attrs@1` whose one attribute is `{name: ridge, domain: edge, type: f32, values: [1.5,
// 2.5, …, 12.5]}`, a value of its own on each of the 12 edges, in two documents:
//   - arrayed: its stack is `array {count: 3, offset: [2, 0, 0]}`. The copies stand 2 m apart and the box is 1 m,
//     so no two copies share a point and the arrayed mesh has 3 × 12 = 36 edges;
//   - subdivided: its stack is `subdivide {levels: 1, scheme: simple}`, which has no rule for an edge attribute.
//
// asserts:
//   - arrayed: the revision is presented; a reading with no expect is INCONCLUSIVE; `ridge` is an edge f32 of 36
//     values, and each of the 12 source values is held by exactly 3 edges, one per copy;
//   - subdivided: the revision is refused by an error issue `attribute.no_rule` under items/box/modifiers/0 that
//     names modifier `mod.subdivide@1`, attribute `ridge`, domain `edge` and type `f32`;
//   - with the planted `subdivide_drops_edge_attrs` (the subdivide builds its mesh without an edge attribute, and
//     refuses nothing): the check of that refusal fails, naming `ridge`; the revision is presented; and the
//     requirement `{kind: geometry.attributes, of: box, expect: {ridge: {domain: edge, type: f32, count: 48, values}}}`
//     FAILs with a `geometry.attribute` issue naming the attribute `ridge`, which the row's results don't hold.
import { describe, expect, it } from 'vitest';
import {
  ARRAY, ATTRS, BOX, PLANTED, SUBDIVIDE, TIMEOUT, admitted, attrsBox, brief, decided, expecting, failsNaming, judge, none, numbers, present, readOf,
  reading, refusalProblems, rowAt, sceneDoc, useFolders, useShow, type JsonObject, type Refusal,
} from './helpers.ts';
import { fmt, near, type Attribute } from './reference.ts';

/** The criterion: its number, and `#1781.` with the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = 'AC6 #1781.11d8dbb9';
const bin = useShow(ATTRS);
const folder = useFolders();

const RIDGE: Attribute = { name: 'ridge', domain: 'edge', type: 'f32', values: Array.from({ length: 12 }, (_, k) => k + 1.5) };
const arrayed = (): JsonObject => sceneDoc('A box with an edge attribute, arrayed', { [BOX]: attrsBox([RIDGE], [ARRAY]) });
const subdivided = (): JsonObject => sceneDoc('A box with an edge attribute, subdivided', { [BOX]: attrsBox([RIDGE], [SUBDIVIDE]) });
const NO_RULE: Refusal = { code: 'attribute.no_rule', at: `items/${BOX}/modifiers/0`, names: { modifier: 'mod.subdivide@1', attribute: RIDGE.name, domain: 'edge', type: 'f32' } };
/** A simple subdivide of a box leaves E′ = 2E + C = 2 × 12 + 24 = 48 edges; the values are never compared. */
const SUBDIVIDED_EDGES = expecting(BOX, { [RIDGE.name]: { domain: 'edge', type: 'f32', count: 48, values: Array.from({ length: 48 }, () => 0) } });

describe(`${ID} an edge attribute is carried by array, and subdivide has no rule for it`, () => {
  it(`${ID} an f32 edge attribute passes through array ×3, 2 m apart, with 36 edge values, each its source edge's; through subdivide it is refused, naming mod.subdivide@1, the attribute, edge and f32; a planted subdivide that builds without the attribute fails, naming it`, () => {
    // Through the array.
    const judged = judge(bin(), folder(), arrayed(), [reading(BOX)]);
    admitted(judged.shown, 'the arrayed box');
    const row = rowAt(judged, 0, 'the arrayed box');
    decided(row, 'INCONCLUSIVE', 'the arrayed box: a reading with no expect');
    const ridge = numbers(readOf(row, RIDGE.name, { domain: 'edge', type: 'f32', count: 36 }, 'the arrayed box'), 'the arrayed box');
    none((RIDGE.values as number[]).flatMap((source) => {
      const n = ridge.filter((v) => near(v, source)).length;
      return n === 3 ? [] : [`${n} of the 36 edges hold ${fmt(source)}, not 3: one for its source edge in each copy`];
    }), 'each edge of each copy holds its source edge\'s value');

    // Through the subdivide.
    const [refused] = present(bin(), folder(), [subdivided()]);
    none(refusalProblems(refused!, 'the subdivided box', NO_RULE), 'the subdivide refuses the build');

    // The planted subdivide that builds without the attribute.
    const twin = judge(bin(), folder(), subdivided(), [SUBDIVIDED_EDGES], PLANTED.drops);
    failsNaming(refusalProblems(twin.shown, `the subdivided box under ${PLANTED.drops}`, NO_RULE), [RIDGE.name], `the planted ${PLANTED.drops}`);
    admitted(twin.shown, `the subdivided box under ${PLANTED.drops}`);
    const lacks = rowAt(twin, 0, `the subdivided box under ${PLANTED.drops}`);
    decided(lacks, 'FAIL', `the subdivided box under ${PLANTED.drops}, read for its edge attribute,`);
    expect(lacks.differs.map((d) => d.attribute), `a geometry.attribute issue names the attribute the mesh lacks: ${brief(lacks.raw['issues'] ?? null, 3000)}`).toEqual([RIDGE.name]);
    expect(lacks.reads.map((r) => r.attribute), 'the row read no such attribute').not.toContain(RIDGE.name);
  }, TIMEOUT);
});
