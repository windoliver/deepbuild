// #1962.6edffdaf: "shelf@2.0.0 declares `moved: {shelf.bookcase@2: furniture/case@1}` with `requires.packs
// [furniture@1.0.0]`: a corpus document upgraded from shelf@1.2.0 opens its 3 bookcases as `furniture.case@1` with the
// values recorded for them, raises one `migrated` notice per item, and draws to the snapshot hash recorded for it. A
// planted loader that drops instances of the old name fails, naming the items"
//
// asserts: in `r1`, with acme/shelf@1.2.0, acme/furniture@1.0.0 and acme/shelf@2.0.0 offered in that order
// (fixtures/packs/shelf-1.2.0, furniture-1.0.0, shelf-2.0.0; acme/shelf@2.0.0 checked first to declare exactly that
// `moved` entry and that `requires.packs`) all three install. The room, acme/shelf@1.2.0's corpus document of major 2
// (b1, b2 and b3 saved at shelf.bookcase@2), presented from your shell under the release that saved it opens clean to
// the values and the snapshot hash its record holds (the fixture held to the binary). Presented with its `packs` entry
// naming acme/shelf@2.0.0, as the patch that takes that version writes it, it is presented with no error; each
// bookcase expands as furniture.case@1 to exactly the derived items, kinds, params and positions recorded for it; each
// is named by exactly one `migrated` notice; and its one snapshot (at 0s, 480 × 280) has the sha256 recorded for the
// room. Under the planted loader `loader_drops_moved_instances` the three versions still install and the same check
// fails with failures naming b1, b2 and b3.
// Wrong programs: the merge base, whose pack check refuses acme/shelf@2.0.0 (`moved` is unknown_field), so the
// upgraded room names a version the store lacks and opens with its bookcases skipped, and which knows no such planted
// value (bad_input); the planted loader.

import { expect, it } from 'vitest';
import {
  BOOKCASES, CASE_1, DOC, FURNITURE_10, OLD_KIND, PACKS, SHELF_12, SHELF_20, at, installFailures, manifestOf, namesId, none, openedFailures,
  pinned, present, roomRecord, run, scenario, snapshotOf, useBinary, useEvidence,
} from './helpers.ts';

const bin = useBinary();
const evidence = useEvidence();
const PLANTED = 'loader_drops_moved_instances';
const VERSIONS = [SHELF_12, FURNITURE_10, SHELF_20];

/** acme/shelf@2.0.0 as the criterion declares it: the one `moved` entry and `requires.packs [furniture@1.0.0]`. */
function checkShelf20(): void {
  const m = manifestOf(SHELF_20);
  expect(m['moved'], 'the fixture: acme/shelf@2.0.0 declares moved {shelf.bookcase@2: furniture/case@1}').toEqual({ [OLD_KIND]: 'furniture/case@1' });
  expect(at(m, 'requires', 'packs'), 'the fixture: acme/shelf@2.0.0 requires.packs [furniture@1.0.0]').toEqual(['furniture@1.0.0']);
  expect([m['kinds'], m['recipes'], m['removed']], 'the fixture: acme/shelf@2.0.0 ships no kind, no recipe and no removed entry').toEqual([undefined, undefined, undefined]);
}

it('#1962.6edffdaf shelf@2.0.0 declares moved {shelf.bookcase@2: furniture/case@1} with requires.packs [furniture@1.0.0]: the corpus document upgraded from shelf@1.2.0 opens its 3 bookcases as furniture.case@1 with the values recorded for them, raises one migrated notice per item, and draws to the snapshot hash recorded for it', () => {
  const b = bin();
  checkShelf20();
  const rec = roomRecord();
  const snap = snapshotOf(rec).raw;
  const [packs, upgraded, saved] = run(b, scenario(evidence(), [
    PACKS,
    present(DOC.a, pinned(rec.document, SHELF_20), snap),
    present(DOC.b, rec.document, snap),
  ], { packs: VERSIONS }));
  // The fixture: under the release that saved it the room opens clean, to its record's values and snapshot hash.
  none(openedFailures(saved!, rec, OLD_KIND, 0, 'the room under acme/shelf@1.2.0'), 'the fixture: the record holds what acme/shelf@1.2.0 gives');
  none([...installFailures(packs!, VERSIONS), ...openedFailures(upgraded!, rec, CASE_1, 1, 'the room upgraded to acme/shelf@2.0.0')], 'the corpus document upgraded from shelf@1.2.0 to shelf@2.0.0');
}, 1_800_000);

it('#1962.6edffdaf a planted loader that drops instances of the old name (loader_drops_moved_instances) fails, naming the items', () => {
  const rec = roomRecord();
  const [packs, upgraded] = run(bin(), scenario(evidence(), [PACKS, present(DOC.a, pinned(rec.document, SHELF_20), snapshotOf(rec).raw)], { packs: VERSIONS, planted: PLANTED }));
  none(installFailures(packs!, VERSIONS), 'the plant is the load\'s, never the pack check\'s: all three versions install');
  const failures = openedFailures(upgraded!, rec, CASE_1, 1, 'the room upgraded to acme/shelf@2.0.0');
  for (const id of BOOKCASES) expect(failures.some((f) => namesId(f, id)), `the check fails naming ${id}:\n  ${failures.join('\n  ')}`).toBe(true);
}, 1_800_000);
