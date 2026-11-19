// AC1: In a fixture scene where a door is the target of one constraint, bound in one driver, the parent of two
// handles and named by one instancer, `refs_to` the door returns exactly five rows with those four kinds and each
// field's path; removing the constraint by patch makes it four. A planted read that walks only parents returns two
// and fails, naming the missing kinds.
//
// The door scene is a document alpha shares (#96's `docs[…].document`, its layer empty at revision 0) and draws as
// one whole revision; alpha then reads refs_to, deletes the constraint by patch, and reads again (README: Fixtures,
// Surface choices). The rows are judged against the document's own five naming fields, `DOOR_REFS`.
import { describe, expect, it } from 'vitest';
import {
  DOC, DOOR_REFS, FULL, coverage, doorScene, doorSeed, failsNaming, none, patch, presented, refsFailures, refsTo, rows, run, scenario, show, useBuilds, useEvidence,
} from './helpers.ts';

const builds = useBuilds([FULL]);
const evidence = useEvidence();
const KINDS = ['constraint', 'driver_binding', 'instancer', 'parent'];

describe('AC1 refs_to an item returns every row that names it, with the naming field\'s path and the kind of reference', () => {
  it('AC1 refs_to the door returns exactly its five rows of four kinds, each with its field\'s path, and four once a patch removes the constraint', () => {
    const [shown, before, removed, after] = run(builds.bin(FULL), scenario(evidence(), { [DOC.door]: { document: doorSeed() } }, [
      show(DOC.door, doorScene()),
      refsTo(DOC.door, 'door'),
      patch(DOC.door, 1, 1, [{ op: 'delete', id: 'aim' }]),
      refsTo(DOC.door, 'door'),
    ]));
    expect(presented(shown, 'alpha\'s door scene'), 'the door scene is revision 1').toBe(1);

    const five = rows(before, 'refs_to door');
    console.log(`AC1 refs_to door: ${JSON.stringify(five)}; after the constraint's removal: ${JSON.stringify(after?.['rows'])}`);
    none(refsFailures('door', five, DOOR_REFS), 'refs_to door gives the five rows the document holds');
    expect([...new Set(five.map((r) => r['kind']))].sort(), 'the five rows are of four kinds').toEqual(KINDS);
    expect(coverage(before, 'refs_to door'), 'the coverage block: all five rows, nothing cut').toMatchObject({ complete: true, rows_total: 5, rows_shown: 5, cut: [] });

    expect(removed!['outcome'], `the patch deleting the constraint aim applies: ${JSON.stringify(removed).slice(0, 1500)}`).toBe('applied');
    const four = rows(after, 'refs_to door after the constraint is removed');
    none(refsFailures('door', four, DOOR_REFS.filter((r) => r.kind !== 'constraint')), 'refs_to door after the constraint is removed gives the other four');
    expect(coverage(after, 'refs_to door after the constraint is removed'), 'the coverage block: all four rows, nothing cut').toMatchObject({ complete: true, rows_total: 4, rows_shown: 4, cut: [] });
  });

  it('AC1 a planted read that walks only parents returns the two handles\' rows and fails, naming the missing kinds', () => {
    const [shown, reply] = run(builds.bin(FULL), scenario(evidence(), { [DOC.door]: { document: doorSeed() } }, [
      show(DOC.door, doorScene()),
      refsTo(DOC.door, 'door'),
    ], { planted: 'refs_parents_only' }));
    presented(shown, 'alpha\'s door scene');
    const got = rows(reply, 'refs_to door under refs_parents_only');
    expect(got.map((r) => r['kind']), 'the planted read returns the two parent rows').toEqual(['parent', 'parent']);
    failsNaming(refsFailures('door', got, DOOR_REFS), ['constraint', 'driver_binding', 'instancer'], 'a read that walks only parents');
  });
});
