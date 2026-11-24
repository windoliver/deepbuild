// AC6 #1219.5569643b: "Changing one bay's width rebuilds only that frame, its brackets and its roof, by content key, and
// a second hall beside it rebuilds nothing"
//
// Fixture (judges.ts `twoHallsDoc`), shown by the working agent through deep_show: two whole halls in one document,
// each a seven-bay frame, a bracket set on its column heads, one between its columns and a folded hip_ridge roof:
// `a-frame`, `a-brackets`, `a-between`, `a-roof`, and `b-frame` (placed 20 m behind), `b-brackets`, `b-between`,
// `b-roof`. The change is a whole revision that differs from the first at one path, items/a-frame/params/bays/3:
// hall a's middle bay, 4.6 m, becomes 5 m.
//
// asserts, from one process (deep_show, eval, deep_show of the changed revision, eval; #387's `eval` answers every
// node with its operator, item, content key and run: ran | hit | kept):
//   - before the change each of the eight items has a building.build node: both halls were built;
//   - in the frame after it, hall a's frame, both its bracket sets and its roof each ran their build node under a new
//     content key, and no other item's build node ran;
//   - hall b's four build nodes keep their content keys, and no node of any operator ran on a hall b item.
//
// Wrong programs this fails on: the merge base, which builds none of the eight; brackets or a roof whose key leaves out
// the frame they read (they keep their key and don't rebuild); a key that holds the whole document, or every frame (hall
// b's key moves and it rebuilds); a roof that reads every bracket set in the document; a scheduler that reruns kept
// nodes; a change that rebuilds nothing, which the judge refuses rather than counting hall b's stillness.
import { describe, it } from 'vitest';
import {
  HALL_A, HALL_B, MIDDLE_BAY_PATH, docId, evalCall, judgesFailTheirPlants, nodesOf, none, presented, rebuildFailures, run, scenarioOf, show, twoHallsDoc, useBins,
  useFolders,
} from './helpers.ts';

/** The criterion's ID: `#1219.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = 'AC6 #1219.5569643b';
const bin = useBins(['deep-show']);
const folder = useFolders();
const DOC = docId(61);

describe(`${ID} a change to one hall's bay rebuilds that hall alone`, () => {
  it(`${ID} changing one bay's width rebuilds only that frame, its brackets and its roof, by content key, and a second hall beside it rebuilds nothing`, () => {
    judgesFailTheirPlants();
    const calls = [show(DOC, twoHallsDoc()), evalCall(DOC), show(DOC, twoHallsDoc(5)), evalCall(DOC)];
    const [shown, before, changed, after] = run(bin('deep-show'), scenarioOf(folder(), [DOC], {}, calls));
    presented(shown!, 'the two halls');
    presented(changed!, `the revision that changes ${MIDDLE_BAY_PATH} from 4.6 to 5`);
    none(
      rebuildFailures(nodesOf(before!, 'the frame before the change'), nodesOf(after!, 'the frame after the change'), HALL_A, HALL_B),
      'the change rebuilds hall a\'s frame, brackets and roof under new content keys, and nothing of hall b',
    );
  });
});
