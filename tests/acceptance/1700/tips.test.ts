// #1700.542d9581: "A 12-tooth gear extruded 0.05 m, outer radius 0.5 m and root radius 0.42 m, reads tips 12 around z,
// and the same gear with one tooth removed reads 11"
//
// Fixture (helpers.ts `gearsDoc`), a stored scene, the one deliverable of a claim of alpha's: `gear`, an `extrude@1`
// 0.05 m along +z of a 12-tooth outline about the origin (tooth k centred at 30k°, its flanks from the root radius
// 0.42 m at ±9° to the outer radius 0.5 m at ±5°, each tooth's top a straight land between its two corners on the
// outer radius, each two teeth joined by a straight root); and `gear-11`, the same outline with tooth 0 left out and
// its root joined straight across the gap, 2 m along x. Projected along z, each tooth's top land is a stretch of the
// outline on its convex hull, and no root point reaches the hull: the hull's chord between two neighbouring teeth
// lies 0.5 cos 10° ≈ 0.492 m from the centre, and across the missing tooth 0.5 cos 25° ≈ 0.453 m, both past 0.42 m.
// The claim's two requirements: `{kind: geometry.shape, of: gear, readings: [{tips: {axis: z}}], expect: {tips: 12}}`
// and `{of: gear-11, readings: [{tips: {axis: z}}], expect: {tips: 11}}`.
//
// asserts: both requirements PASS, the gear's one tips result 12 and the gear with one tooth removed's 11.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, claimId, claimOf, decided, docId, gearsDoc, oneAt, reqId, rowOf, run, scenarioOf, shape, tips, useBuild, useFolders, verdict } from './helpers.ts';

/** The criterion's ID: `#1700.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#1700.542d9581';
const bin = useBuild();
const folder = useFolders();

const GEARS = docId(1);
const claims = {
  [claimId(1)]: claimOf(GEARS, [
    { id: reqId(1), check: shape('gear', [tips('z')], { tips: 12 }) },
    { id: reqId(2), check: shape('gear-11', [tips('z')], { tips: 11 }) },
  ]),
};

describe(`${ID} tips counts the outline's stretches on its convex hull`, () => {
  it(`${ID} the 12-tooth gear extruded 0.05 m reads tips 12 around z, and the same gear with one tooth removed reads 11`, () => {
    const [v] = run(bin(), scenarioOf(folder(), { [GEARS]: gearsDoc() }, claims, [verdict(claimId(1))]));
    const twelve = rowOf(v!, reqId(1), 'the 12-tooth gear');
    decided(twelve, 'PASS', 'the 12-tooth gear read for tips 12 around z');
    expect(oneAt(twelve, 0, 'the 12-tooth gear: tips').value, 'the 12-tooth gear reads tips 12 around z').toBe(12);
    const eleven = rowOf(v!, reqId(2), 'the gear with one tooth removed');
    decided(eleven, 'PASS', 'the gear with one tooth removed read for tips 11 around z');
    expect(oneAt(eleven, 0, 'the gear with one tooth removed: tips').value, 'the gear with one tooth removed reads tips 11 around z').toBe(11);
  }, TIMEOUT);
});
