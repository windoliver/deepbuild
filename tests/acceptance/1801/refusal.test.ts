// AC4: A patch that removes an item five rows name is refused as today, and the refusal's `actual` now lists the
// same five rows `refs_to` returns, in the same order; a planted refusal that names only the first fails.
//
// The door of AC1 (README: Fixtures) is the item five rows name. Alpha reads refs_to the door, then sends a patch that
// deletes it. Today (the base) the patch is refused with one `ref_unresolved` per handle's parent and nothing for the
// constraint, the driver or the instancer (BASE-FAILURE.txt); the criterion keeps the refusal and asks that its
// `ref_unresolved` issue naming the door carry, as its `actual`, the rows refs_to gave, in refs_to's order.
import { describe, expect, it } from 'vitest';
import {
  DOC, DOOR_REFS, FULL, doorScene, doorSeed, failsNaming, none, patch, presented, refsFailures, refsTo, refusalFailures, rows, run, scenario, show, useBuilds, useEvidence,
  type JsonObject,
} from './helpers.ts';

const builds = useBuilds([FULL]);
const evidence = useEvidence();

/** Alpha's door scene at revision 1, refs_to the door, and a patch on revision 1 that deletes the door. */
function deleteTheDoor(planted?: string): { refs: JsonObject[]; refused: JsonObject } {
  const [shown, read, refused] = run(builds.bin(FULL), scenario(evidence(), { [DOC.door]: { document: doorSeed() } }, [
    show(DOC.door, doorScene()),
    refsTo(DOC.door, 'door'),
    patch(DOC.door, 1, 1, [{ op: 'delete', id: 'door' }]),
  ], planted ? { planted } : {}));
  expect(presented(shown, 'alpha\'s door scene'), 'the door scene is revision 1').toBe(1);
  const refs = rows(read, 'refs_to door');
  none(refsFailures('door', refs, DOOR_REFS), 'refs_to door gives the five rows the document holds');
  return { refs, refused: refused! };
}

describe('AC4 a patch that removes an item rows still name is refused, and the refusal lists every row refs_to gives', () => {
  it('AC4 the patch deleting the door is refused as today, and its ref_unresolved naming the door has as actual refs_to\'s five rows, in the same order', () => {
    const { refs, refused } = deleteTheDoor();
    console.log(`AC4 refs_to door: ${JSON.stringify(refs)}\nAC4 the refusal's issues: ${JSON.stringify(refused['issues']).slice(0, 4000)}`);
    none(refusalFailures('door', refused, refs), 'the refusal\'s actual is the five rows refs_to gives, in its order');
    expect(refused['rev'], 'a refused patch leaves the document at revision 1').toBe(1);
  });

  it('AC4 a planted refusal that names only the first row fails, naming the four rows it left out', () => {
    const { refs, refused } = deleteTheDoor('refusal_names_first_ref');
    failsNaming(refusalFailures('door', refused, refs), refs.slice(1).map((r) => String(r['path'])), 'a refusal that names only the first row');
  });
});
