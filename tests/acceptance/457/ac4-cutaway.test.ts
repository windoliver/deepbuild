// #457.352f4bf3: "With a half-section cutaway removing the casing between the camera and a kept piston, camera.framing
// reports the piston's occluded share as 0 with the cutaway in effect and above 0.9 with it off, still counts a valve
// on the kept side of the plane as an occluder, and passes with no except entry"
//
// Fixture (helpers.ts `engine`): a closed casing of six walls round the kept piston and the kept crank, both wholly
// behind the plane z = 0; a valve 0.15 m behind the plane, in front of the crank, hiding about 17% of its sample
// points by area; the camera 5 m out on +z. With the cutaway (`section`, a `cutaway@1` in the document, view class,
// which counts as pinned) the plane removes z > 0: the casing's front wall and the front halves of the others. Without
// it, the front wall stands between the camera and both kept items. The requirement is `{kind: camera.framing, keep:
// [piston, crank]}`: no `except`.
//
// asserts:
//   - with the cutaway: the row PASSes with nothing raised; the piston's occluded share is 0 at every checked time;
//     the crank's entries name the valve among their occluders with a share above 0 (the valve, on the kept side, still
//     occludes);
//   - without it: the piston's occluded share is above 0.9 at every checked time;
//   - planted `cutaway_hides_whole_items` (an item a cutaway in effect reaches never occludes, whichever side of its
//     planes it lies on): the crank's entries no longer name the valve, so the assertion above fails on it.
// Wrong programs: the base (no occluded share); a check that ignores cutaways (the piston hidden by the casing's front
// wall); one that drops every item a cutaway reaches (the planted one); one that needs an except entry to pass.
import { describe, expect, it } from 'vitest';
import {
  ENGINE_CHECK, TIMEOUT, brief, claimId, claimOn, docId, engine, none, occludedFor, passFailures, proof, reqId, rowOf, run, scenarioOf,
  useBuilds, useFolders, verdict, type JsonObject, type Row,
} from './helpers.ts';

const ID = '#457.352f4bf3';
const builds = useBuilds();
const folder = useFolders();
const [CUT, WHOLE] = [docId(1), docId(2)];
const [C1, C2] = [claimId(1), claimId(2)];
const [R1, R2] = [reqId(1), reqId(2)];
const claims: JsonObject = { [C1]: claimOn(CUT, [[R1, ENGINE_CHECK]]), [C2]: claimOn(WHOLE, [[R2, ENGINE_CHECK]]) };

describe(`${ID} a half-section cutaway cuts occluders as drawn`, () => {
  it(`${ID} with the cutaway the piston's share is 0 and the valve on the kept side still occludes the crank, passing with no except; without it the piston's share is above 0.9`, () => {
    const judged = (planted?: string): [Row, Row] => {
      const [a, b] = run(builds.debug(), scenarioOf(folder(), { [CUT]: engine(true), [WHOLE]: engine(false) }, claims, [verdict(C1), verdict(C2)], planted ? { planted } : {}));
      return [rowOf(a!, R1, 'the engine with its half-section'), rowOf(b!, R2, 'the engine whole')];
    };
    const [cut, whole] = judged();
    proof('cutaway row', cut.raw);
    proof('whole row', whole.raw);
    const failures = passFailures(cut, 'the engine with its half-section, no except entry');
    for (const o of occludedFor(cut, 'piston', 'the engine with its half-section')) if (o.share !== 0) failures.push(`with the cutaway in effect the piston's occluded share reads ${o.share} behind ${o.occluders.join(', ') || 'nothing'}, not 0`);
    const crank = occludedFor(cut, 'crank', 'the engine with its half-section');
    if (!crank.some((o) => o.occluders.includes('valve') && o.share !== null && o.share > 0)) failures.push(`with the cutaway the valve on the kept side of the plane isn't counted as an occluder of the crank: ${brief(crank.map((o) => o.raw), 800)}`);
    for (const o of occludedFor(whole, 'piston', 'the engine whole')) if (o.share === null || !(o.share > 0.9)) failures.push(`with the cutaway off the piston's occluded share reads ${o.share}, not above 0.9`);
    none(failures, 'the cutaway in effect cuts the casing, and only the casing, from the occluders');

    const [plantedCut] = judged('cutaway_hides_whole_items');
    const plantedCrank = occludedFor(plantedCut, 'crank', 'the engine with its half-section under cutaway_hides_whole_items');
    expect(plantedCrank.some((o) => o.occluders.includes('valve')), 'under cutaway_hides_whole_items the valve is dropped as an occluder, so the assertion above fails on it').toBe(false);
  }, TIMEOUT);
});
