// #457.ca859a60: "With a near plane 0.1 m from the camera, 0.08 m wide and 0.06 m high, so its half-diagonal is 0.05 m,
// a sphere of radius 1 mm centred on the near plane fails clearance under the default, √(0.1² + 0.05²) ≈ 0.112 m,
// naming the sphere, while a planted check whose default is the half-diagonal alone passes it; the same sphere 0.12 m
// from the camera passes"
//
// Fixture (helpers.ts `nearPlane`): a still camera, `near: 0.1`, its field of view 2·atan(0.04 ÷ 0.1) across the
// 320 px side, so in the 320 × 240 frame its near plane is 0.08 × 0.06 m (half-diagonal 0.05 m); the sphere `dot`
// (radius 1 mm) centred on the view axis 0.1 m out (on the near plane: its surface 0.099 m from the camera) or 0.12 m out
// (0.119 m); the kept crate 4 m out; one 1 s keyed shot. The requirement is `{kind: camera.framing, keep: [crate]}`,
// clearance at its default, auto.
//
// asserts:
//   - the sphere on the near plane FAILs with a clearance error naming `dot`: 0.099 m is inside √(0.1² + 0.05²);
//   - the sphere 0.12 m out PASSes with nothing raised;
//   - planted `clearance_half_diagonal` (auto clearance is the near plane's half-diagonal alone, 0.05 m): the sphere
//     on the near plane PASSes with nothing raised, so the failure above is what tells the two defaults apart.
// Wrong programs: the base (no clearance); the half-diagonal default (the planted one); the near distance alone (0.1 m:
// the 0.099 m sphere would still fail, but a sphere at a near-plane corner wouldn't); no default at all.
import { describe, expect, it } from 'vitest';
import {
  NEAR_CHECK, NEAR_FOV, TIMEOUT, brief, claimId, claimOn, docId, nearPlane, none, passFailures, pathIssues, proof, reqId, rowOf, run, scenarioOf,
  shown, useBuilds, useFolders, verdict, type Row,
} from './helpers.ts';

const ID = '#457.ca859a60';
const builds = useBuilds();
const folder = useFolders();
const [ON, PAST] = [docId(1), docId(2)];
const [C1, C2] = [claimId(1), claimId(2)];
const [R1, R2] = [reqId(1), reqId(2)];

describe(`${ID} the default clearance reaches the near plane's corners`, () => {
  it(`${ID} a 1 mm sphere centred on the near plane fails the default clearance naming the sphere, a half-diagonal default passes it, and the sphere 0.12 m out passes`, () => {
    const halfW = 0.1 * Math.tan((NEAR_FOV * Math.PI) / 360);
    expect([halfW, halfW * 0.75].map((v) => Number((2 * v).toFixed(12))), 'the fixture: the near plane is 0.08 m wide and 0.06 m high').toEqual([0.08, 0.06]);
    const judged = (planted?: string): [Row, Row] => {
      const claims = { [C1]: claimOn(ON, [[R1, NEAR_CHECK]]), [C2]: claimOn(PAST, [[R2, NEAR_CHECK]]) };
      const [a, b] = run(builds.debug(), scenarioOf(folder(), { [ON]: nearPlane(0.1), [PAST]: nearPlane(0.12) }, claims, [verdict(C1), verdict(C2)], planted ? { planted } : {}));
      return [rowOf(a!, R1, 'the sphere on the near plane'), rowOf(b!, R2, 'the sphere 0.12 m out')];
    };
    const [on, past] = judged();
    proof('sphere on the near plane row', on.raw);
    const found = pathIssues(on, 'clearance', 'dot');
    none([
      ...(on.result === 'FAIL' ? [] : [`the sphere on the near plane is ${on.result}, not FAIL: ${brief(on.raw)}`]),
      ...(found.length ? [] : [`no clearance error names the sphere dot, 0.099 m from the camera inside √(0.1² + 0.05²) ≈ 0.112 m; it raises: ${on.issues.map(shown).join(' | ') || 'nothing'}`]),
      ...passFailures(past, 'the sphere 0.12 m from the camera'),
    ], 'the default clearance fails the sphere on the near plane and passes it 0.12 m out');

    const [plantedOn] = judged('clearance_half_diagonal');
    none(passFailures(plantedOn, 'the sphere on the near plane under clearance_half_diagonal'), 'the planted half-diagonal default passes the sphere on the near plane, so it fails this criterion');
  }, TIMEOUT);
});
