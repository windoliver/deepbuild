// #1700.44a11d63: "A 0.3 m cube at y = 0 rests on the ground; raised by 2 mm it reads not resting with a gap of
// 0.002 m within 1e-9 m"
//
// Fixture (helpers.ts `restingDoc`), a stored scene, the one deliverable of a claim of alpha's: `cube`, a `slab@1` of
// size [0.3, 0.3, 0.3] standing on y = 0 (its lowest face at y = 0), and `raised`, the same cube 1 m along x and
// 0.002 m up. The ground is the plane y = 0. The claim's two requirements: `{kind: geometry.shape, of: cube, readings:
// [{rests: {on: ground}}], expect: {rests: true}}` and `{of: raised, readings: [{rests: {on: ground}}], expect: {rests:
// false}}`.
//
// asserts: both requirements PASS; the cube's one rests result is true; the raised cube's is false, with `gap`
// 0.002 m within 1e-9 m.
import { describe, expect, it } from 'vitest';
import {
  RAISE, TIMEOUT, brief, claimId, claimOf, decided, docId, nearAbs, oneAt, reqId, restingDoc, rests, rowOf, run, scenarioOf, shape, useBuild, useFolders,
  verdict,
} from './helpers.ts';

/** The criterion's ID: `#1700.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#1700.44a11d63';
const bin = useBuild();
const folder = useFolders();

const CUBES = docId(1);
const claims = {
  [claimId(1)]: claimOf(CUBES, [
    { id: reqId(1), check: shape('cube', [rests('ground')], { rests: true }) },
    { id: reqId(2), check: shape('raised', [rests('ground')], { rests: false }) },
  ]),
};

describe(`${ID} rests reads the gap under an item's lowest points`, () => {
  it(`${ID} a 0.3 m cube at y = 0 rests on the ground; raised by 2 mm it reads not resting with a gap of 0.002 m within 1e-9 m`, () => {
    const [v] = run(bin(), scenarioOf(folder(), { [CUBES]: restingDoc() }, claims, [verdict(claimId(1))]));
    const onGround = rowOf(v!, reqId(1), 'the cube at y = 0');
    decided(onGround, 'PASS', 'the cube at y = 0 read for resting on the ground');
    expect(oneAt(onGround, 0, 'the cube at y = 0: rests').value, 'the cube at y = 0 rests on the ground').toBe(true);
    const raised = rowOf(v!, reqId(2), 'the cube raised by 2 mm');
    decided(raised, 'PASS', 'the cube raised by 2 mm read for not resting');
    const r = oneAt(raised, 0, 'the cube raised by 2 mm: rests');
    expect(r.value, 'the cube raised by 2 mm reads not resting').toBe(false);
    expect(nearAbs(r.raw['gap'], RAISE, 1e-9), `its gap is 0.002 m within 1e-9 m: ${brief(r.raw)}`).toBe(true);
  }, TIMEOUT);
});
