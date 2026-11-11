// #1957.d88f8e3a: "A pack study@1.0.0 with requires.packs [shelf@1.2.0] expands its reading room, which names
// shelf.bookcase@2, in a document that lists only study@1.0.0; a step that names lamp.desk@1 from an undeclared pack is
// refused at pack check, naming lamp; a shelf@1.2.0 that also requires study@1.0.0 is refused, naming the cycle; and a
// document that lists shelf@1.3.0 beside study@1.0.0 is refused, naming shelf@1.2.0 and shelf@1.3.0"
//
// One test per clause, each its own `deep-show run` process with its own store (README: Criteria to tests).
// asserts:
// 1. With acme/shelf@1.2.0, acme/shelf@1.3.0 and acme/study@1.0.0 installed, a board that lists only
//    acme/study@1.0.0 and holds the reading room r1 (study.room@1) resolves its packs (no error is pack_missing,
//    ref_unresolved or cycle, or names a pack version), and r1 expands through study@1.0.0 into exactly r1.shelves, an
//    item of shelf.bookcase@2, and the items shelf@1.2.0's bookcase makes under it (r1.shelves.sides.0–1,
//    r1.shelves.boards.0–2): never shelf@1.3.0's crown. Whether the board then draws isn't read (README: Readings).
// 2. With acme/shelf@1.2.0 and acme/lamp@1.0.0 installed, acme/study@1.1.0, whose reading room's step `light` names
//    lamp.desk@1 while its requires.packs lists only shelf@1.2.0, is refused at its pack check by an error naming lamp.
// 3. With acme/study@1.0.0 offered first, acme/shelf@1.2.0 that also requires study@1.0.0 is refused at its pack check
//    by an error `cycle` naming study@1.0.0 and shelf@1.2.0.
// 4. With acme/shelf@1.2.0, acme/shelf@1.3.0 and acme/study@1.0.0 installed, a board that lists acme/shelf@1.3.0
//    beside acme/study@1.0.0 is refused by an error naming shelf@1.2.0 and shelf@1.3.0.
// Wrong program: the merge base, whose pack check refuses `requires.packs` outright (`out_of_range` at
// `requires/packs`), so study@1.0.0 and study@1.1.0 never install, nothing names lamp or a cycle, and a board that
// lists study@1.0.0 is refused with pack_missing.

import { expect, it } from 'vitest';
import {
  BOOKCASE, DOC, LAMP_10, PACKS, ROOM, SHELF_12, SHELF_12_CYCLIC, SHELF_13, STUDY_10, STUDY_11, errors, expansionOf, indexed, installed, issues,
  mentions, outcome, packAt, packRow, present, roomBoard, run, scenario, show, sorted, useBuild, useEvidence,
} from './helpers.ts';

const bin = useBuild();
const evidence = useEvidence();
/** The codes a document's packs that don't resolve are refused with (README: Readings, clause 1). */
const RESOLUTION = ['pack_missing', 'ref_unresolved', 'cycle'];

it('#1957.d88f8e3a study@1.0.0 with requires.packs [shelf@1.2.0] expands its reading room, which names shelf.bookcase@2, in a document that lists only study@1.0.0', () => {
  const [packs, shown] = run(bin(), scenario(evidence(), [SHELF_12, SHELF_13, STUDY_10], [
    PACKS,
    present(DOC.a, roomBoard('A reading room', [packAt(STUDY_10)])),
  ]));
  installed(packs!, [SHELF_12, SHELF_13, STUDY_10]);

  const unresolved = errors(issues(shown!)).filter((i) => RESOLUTION.includes(i.code) || mentions(i.raw, 'shelf@') || mentions(i.raw, 'study@'));
  expect(unresolved.map((i) => i.raw), 'the board that lists only acme/study@1.0.0 resolves its packs: no error is pack_missing, ref_unresolved or cycle, or names a pack version').toEqual([]);
  const e = expansionOf(shown!, 'r1');
  expect([e.kind, e.pack], 'r1 expands as study.room@1 through acme/study@1.0.0').toEqual([ROOM, packAt(STUDY_10)]);
  const expected = sorted(['r1.shelves', ...indexed('r1.shelves.sides', 2), ...indexed('r1.shelves.boards', 3)]);
  expect(sorted(Object.keys(e.derived)), 'the reading room expands into its step shelves and the 2 sides and 3 boards shelf@1.2.0\'s bookcase makes under it (shelf@1.3.0\'s would add a crown)').toEqual(expected);
  expect(e.derived['r1.shelves']!['kind'], 'the step shelves is an item of shelf.bookcase@2').toBe(BOOKCASE);
}, 1_800_000);

it('#1957.d88f8e3a a step that names lamp.desk@1 from an undeclared pack is refused at pack check, naming lamp', () => {
  const [packs] = run(bin(), scenario(evidence(), [SHELF_12, LAMP_10, STUDY_11], [PACKS]));
  installed(packs!, [SHELF_12, LAMP_10]);
  const row = packRow(packs!, STUDY_11);
  expect(row.state, `acme/study@1.1.0, whose step names lamp.desk@1 while requires.packs lists only shelf@1.2.0, is refused at its pack check: ${show(row.raw)}`).toBe('refused');
  const naming = errors(row.issues).filter((i) => mentions(i.raw, 'lamp'));
  expect(naming.length, `an error of acme/study@1.1.0's refusal names lamp: ${show(row.issues.map((i) => i.raw), 3000)}`).toBeGreaterThan(0);
}, 1_800_000);

it('#1957.d88f8e3a a shelf@1.2.0 that also requires study@1.0.0 is refused, naming the cycle', () => {
  const [packs] = run(bin(), scenario(evidence(), [STUDY_10, SHELF_12_CYCLIC], [PACKS]));
  const row = packRow(packs!, SHELF_12_CYCLIC);
  const study = show(packRow(packs!, STUDY_10).raw);
  expect(row.state, `acme/shelf@1.2.0, which requires study@1.0.0, which requires it, is refused at its pack check: ${show(row.raw)}; study@1.0.0's row: ${study}`).toBe('refused');
  const cycle = errors(row.issues).filter((i) => i.code === 'cycle' && mentions(i.raw, 'study@1.0.0') && mentions(i.raw, 'shelf@1.2.0'));
  expect(cycle.length, `an error cycle names study@1.0.0 and shelf@1.2.0: ${show(row.issues.map((i) => i.raw), 3000)}; study@1.0.0's row: ${study}`).toBeGreaterThan(0);
}, 1_800_000);

it('#1957.d88f8e3a a document that lists shelf@1.3.0 beside study@1.0.0 is refused, naming shelf@1.2.0 and shelf@1.3.0', () => {
  const [packs, shown] = run(bin(), scenario(evidence(), [SHELF_12, SHELF_13, STUDY_10], [
    PACKS,
    present(DOC.a, roomBoard('A reading room beside another shelf', [packAt(STUDY_10), packAt(SHELF_13)])),
  ]));
  installed(packs!, [SHELF_12, SHELF_13, STUDY_10]);
  expect(outcome(shown!), `the board that lists acme/shelf@1.3.0 beside acme/study@1.0.0 is refused: ${show(shown!['issues'] ?? null)}`).toBe('refused');
  const both = errors(issues(shown!)).filter((i) => mentions(i.raw, 'shelf@1.2.0') && mentions(i.raw, 'shelf@1.3.0'));
  expect(both.length, `an error names shelf@1.2.0 and shelf@1.3.0: ${show(shown!['issues'] ?? null, 3000)}`).toBeGreaterThan(0);
}, 1_800_000);
