// Criterion 4 (no upstream test): "In the door fixture, a placement with `start_on` whose filter names the kind
// `door_opne`, over a logic item that declares `door_open`, is refused at check, naming the placement, `door_opne` and
// `door_open`. Spelled right it checks. A planted check that accepts it passes the document, the door clip never
// starts, and the test fails, naming the placement"
//
// Through `deep-show run`'s `deep show` (the document check): the door (fixtures.ts) with `swing`'s start_on filtered
// to kinds [door_opne] (doc a), and to [door_open] (doc b). The refusal is the issue `occurrence.undeclared` (Logic:
// occurrences), naming the reader by its ID among the issue's `ids` or in its `path`, the name it read, and the
// declared name among at most three close names (`close`, as the canvas gives them for an unknown kind). Under the
// planted check, the misspelled door's frame at 6.000 s is its frame at 4.5 s, before door_open: the panel at rest.
import { describe, expect, it } from 'vitest';
import { AC, DOC, TIMEOUT, evalCall, failsNaming, none, notPresented, prebuild, present, runShow, scenario, secs, snapshotOf, undeclaredFailures, type JsonObject, type ShowPlanted } from './helpers.ts';
import { DOOR_KIND, PLACEMENT, T6, doorDoc, useDoorEvidence } from './fixtures.ts';

prebuild(['deep-show']);
const doorEvidence = useDoorEvidence();
const TYPO = 'door_opne';

/** The check of the misspelled door and of the door spelled right, each failure naming the placement; and whether the
 * misspelled door, when presented, never starts its clip (its frame at 6.000 s is its frame at 4.5 s). */
function checked(planted?: ShowPlanted): { failures: string[]; neverStarts: boolean } {
  const { ev, program } = doorEvidence();
  const [typo, right, at45, at6] = runShow(scenario(ev, [
    present(DOC.a, doorDoc(program, [TYPO])), present(DOC.b, doorDoc(program)), evalCall(DOC.a, secs(4.5)), evalCall(DOC.a, T6),
  ], planted), 'the door checked, misspelled and spelled right') as [JsonObject, JsonObject, JsonObject, JsonObject];
  const failures = undeclaredFailures(typo, { reader: PLACEMENT, wrong: TYPO, declared: DOOR_KIND }, `the door whose placement ${PLACEMENT} starts on kinds [${TYPO}]`);
  const checks = notPresented(right, `the door whose placement ${PLACEMENT} starts on kinds [${DOOR_KIND}]`);
  if (checks) failures.push(`${PLACEMENT}: spelled right, ${checks}`);
  const before = snapshotOf(at45); const after = snapshotOf(at6);
  return { failures, neverStarts: 'sha' in before && 'sha' in after && before.sha === after.sha };
}

describe(`${AC[4]} a start_on that names a kind its logic item doesn't declare is refused at check, with the close names`, () => {
  it(`${AC[4]} kinds [${TYPO}] over a latch that declares ${DOOR_KIND} is refused with occurrence.undeclared, naming ${PLACEMENT}, ${TYPO} and ${DOOR_KIND}; spelled right it checks`, () => {
    none(checked().failures, `the check of ${PLACEMENT}'s start_on`);
  }, TIMEOUT);

  it(`${AC[4]} a planted check that accepts the undeclared kind (undeclared_kind_accepted) passes the document, its clip never starts, and the test fails, naming ${PLACEMENT}`, () => {
    none(checked().failures, `the check of ${PLACEMENT}'s start_on`);
    const planted = checked('undeclared_kind_accepted');
    failsNaming(planted.failures, new RegExp(`\\b${PLACEMENT}\\b`), 'undeclared_kind_accepted');
    expect(planted.neverStarts, 'the misspelled door, passed by the planted check, never starts its clip: its frame at 6.000 s is its frame at 4.5 s').toBe(true);
  }, TIMEOUT);
});
