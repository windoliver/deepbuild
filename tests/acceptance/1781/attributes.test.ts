// AC1 #1781.7a007913: "`test.attrs@1` returns a 1 m box with one attribute for each of the 36 pairs of a mesh domain
// (point, edge, face, corner) and a type, 450 values in all. `geometry.attributes` reads each back with its domain,
// type, count (8, 12, 6 or 24) and values. A u32 value of 16,777,217 reads back exactly; a planted mesh that keeps it
// as f32 returns 16,777,216 and fails, naming the attribute and the element"
//
// The fixture (reference.ts `EVERY`): `box`, a `test.attrs@1` whose params list 36 attributes named
// `<domain>_<type>`, each with one value per element of its domain (8, 12, 6 or 24), 9 × 50 = 450 values. Every
// number is exact in f32 but one: `point_u32`'s element 3 is 16,777,217. Alpha presents the document and its claim's
// one requirement is `{kind: geometry.attributes, of: box, expect: {name → {domain, type, count, values}}}` over
// all 36, with the default tolerance.
//
// asserts:
//   - the revision is presented and the requirement PASSes; the row's results hold each of the 36 attributes with
//     its domain, type, count and values (bool, i32 and u32 exactly, float types within 1e-6), 450 values in all, and
//     `point_u32`'s element 3 reads 16,777,217;
//   - with the planted `attrs_kept_as_f32` (the built mesh keeps every attribute's values as f32): `point_u32`'s
//     element 3 reads 16,777,216, the requirement FAILs, and its one `geometry.attribute` issue names the attribute
//     `point_u32`, the element 3, expected 16,777,217 and actual 16,777,216.
import { describe, expect, it } from 'vitest';
import { ATTRS, BOX, PLANTED, TIMEOUT, admitted, attrsBox, brief, decided, expecting, judge, readOf, rowAt, sceneDoc, useFolders, useShow, type JsonObject } from './helpers.ts';
import { BIG, COUNTS, EVERY, firstDifference } from './reference.ts';

/** The criterion: its number, and `#1781.` with the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = 'AC1 #1781.7a007913';
const bin = useShow(ATTRS);
const folder = useFolders();

const doc = (): JsonObject => sceneDoc('A box with every attribute', { [BOX]: attrsBox(EVERY) });
const CHECK = expecting(BOX, Object.fromEntries(EVERY.map((a) => [a.name, { domain: a.domain, type: a.type, count: COUNTS[a.domain], values: a.values }])));
const big = EVERY.find((a) => a.name === BIG.attribute)!;
const BIG_SHAPE = { domain: big.domain, type: big.type, count: COUNTS[big.domain] };

describe(`${ID} every pair of a mesh domain and a type reads back`, () => {
  it(`${ID} test.attrs@1's box carries 36 attributes, 450 values, and geometry.attributes reads each back with its domain, type, count and values, a u32 of 16,777,217 exactly; a planted mesh that keeps it as f32 returns 16,777,216 and fails, naming the attribute and the element`, () => {
    expect([EVERY.length, EVERY.reduce((n, a) => n + a.values.length, 0)], 'the fixture lists 36 attributes and 450 values').toEqual([36, 450]);

    const judged = judge(bin(), folder(), doc(), [CHECK]);
    admitted(judged.shown, 'the box with every attribute');
    const row = rowAt(judged, 0, 'the box read against its 36 attributes');
    decided(row, 'PASS', 'the box read against its 36 attributes');
    let total = 0;
    for (const a of EVERY) {
      const read = readOf(row, a.name, { domain: a.domain, type: a.type, count: COUNTS[a.domain] }, 'the box');
      expect(firstDifference(a.type, read.values, a.values), `${a.name} reads back the values its params list (the first element that differs, −1 for none): ${brief(read.values, 600)}`).toBe(-1);
      total += read.values.length;
    }
    expect(total, 'the 36 arrays hold 450 values in all').toBe(450);
    expect(readOf(row, BIG.attribute, BIG_SHAPE, 'the box').values[BIG.element], `${BIG.attribute}'s element ${BIG.element} reads back 16,777,217 exactly`).toBe(BIG.value);

    // The planted mesh that keeps its values as f32.
    const twin = judge(bin(), folder(), doc(), [CHECK], PLANTED.f32);
    admitted(twin.shown, `the box under ${PLANTED.f32}`);
    const kept = rowAt(twin, 0, `the box under ${PLANTED.f32}`);
    expect(readOf(kept, BIG.attribute, BIG_SHAPE, `the box under ${PLANTED.f32}`).values[BIG.element], 'kept as f32, 16,777,217 reads back 16,777,216').toBe(BIG.asF32);
    decided(kept, 'FAIL', `the box under ${PLANTED.f32}`);
    expect(kept.differs.map((d) => [d.attribute, d.element, d.expected, d.actual]), `one geometry.attribute issue names the attribute, the element and both values: ${brief(kept.raw['issues'] ?? null, 3000)}`)
      .toEqual([[BIG.attribute, BIG.element, BIG.value, BIG.asF32]]);
  }, TIMEOUT);
});
