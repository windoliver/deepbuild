// #1961.0c0ae838: "When shelf.bookcase 1.1 renames its step `board` to `shelf`, a document from 1.0 whose instance broke
// out `b.board.2` keeps that item as the writer's own by hash, raises `derived_orphan` naming `b.board.2` and the note on
// it, and `b.shelf.2` expands; a planted loader that drops the broken-out item, or hands its ID to the new expansion,
// fails, naming the ID"
//
// One test per clause, each its own `deep-show run` process (README: Criteria to tests). Each opens the corpus document
// fixtures/bookcase-1.0-broken-out.json (your board naming acme/shelf@1.0.0, whose instance b broke out b.board.2, which
// your layer holds) with your note on b.board.2, reads revision 0, applies your patch that names acme/shelf@1.1.0 (the
// load under shelf.bookcase 1.1) and reads again.
// asserts:
// 1. keptFailures: after the load, b.board.2 is still in the stored document, in your layer, with the sha256 of its
//    canonical bytes unchanged, and b's expansion doesn't write it.
// 2. orphanFailures: the patch's reply, or the read of the revision it made, raises derived_orphan in one entry naming
//    b.board.2 and the note's ULID.
// 3. expandsFailures: b expands through acme/shelf@1.1.0 and its derived items hold b.shelf.2.
// 4, 5. Under `orphan_load_drops_broken_out` and under `orphan_load_hands_id_to_expansion`, the three checks together
//    fail, and a failure names b.board.2.
// Each test first requires what its clause needs to mean anything: revision 0 holds b.board.2 as your item, b expands
// through acme/shelf@1.0.0 without it, and the patch applies, so the stored document names acme/shelf@1.1.0.
// Wrong program: the merge base, where a patch reaches only items, so the patch that names acme/shelf@1.1.0 is refused;
// and the two planted loaders.

import { expect, it } from 'vitest';
import {
  NOTE, V10, V11, YOUR_LAYER, expandsFailures, expansionOf, failsNaming, fixture, hashOf, itemsOf, keptFailures, named, none, noteOn, obj,
  orphanFailures, outcome, patch, patchId, pinPatch, pinsOf, read, run, scenario, show, useBuild, useEvidence, type JsonObject,
} from './helpers.ts';

const bin = useBuild();
const evidence = useEvidence();
const DOCUMENT = fixture('bookcase-1.0-broken-out.json');
const ITEM = 'b.board.2';
const PIN = patchId(1);

interface Load { before: JsonObject; patched: JsonObject; after: JsonObject; mine: JsonObject }

/** The corpus document opened, your patch naming acme/shelf@1.1.0 applied, and each read; with what each clause needs checked. */
function load(planted?: string): Load {
  const [before, patched, after] = run(bin(), scenario(evidence(), DOCUMENT, [read(), patch(pinPatch(PIN, 0, V11)), read()], {
    notes: [noteOn(ITEM)], ...(planted ? { planted } : {}),
  }));
  const mine = obj(itemsOf(before!, 'revision 0')[ITEM], `revision 0 holds ${ITEM}, broken out under ${V10.recipe}, as your item`);
  expect(mine['layer'], `${ITEM} is in your layer at revision 0`).toBe(YOUR_LAYER);
  const e0 = expansionOf(before!, 'b', 'revision 0');
  expect([e0?.pack, e0 ? ITEM in e0.derived : null], `at revision 0, b expands through ${named(V10)} and doesn't write ${ITEM}: ${show(before!['expansions'] ?? null)}`).toEqual([named(V10), false]);
  expect(outcome(patched!), `your patch that names ${named(V11)} applies: ${show(patched!['issues'] ?? null, 2000)}`).toBe('applied');
  expect(pinsOf(after!, 'after the patch'), `the stored document names ${named(V11)} after the patch`).toEqual([named(V11)]);
  return { before: before!, patched: patched!, after: after!, mine };
}

it('#1961.0c0ae838 when shelf.bookcase 1.1 renames its step board to shelf, a document from 1.0 whose instance broke out b.board.2 keeps that item as the writer\'s own by hash', () => {
  const l = load();
  expect(hashOf(l.mine), `revision 0's ${ITEM} is the corpus document's, byte for byte`).toBe(hashOf(obj(obj(DOCUMENT['items'], 'items')[ITEM], ITEM)));
  none(keptFailures(l.after, 'b', ITEM, l.mine), `${ITEM} after the load under ${V11.recipe}`);
}, 1_800_000);

it('#1961.0c0ae838 the load under shelf.bookcase 1.1 raises derived_orphan naming b.board.2 and the note on it', () => {
  const l = load();
  none(orphanFailures(l.patched, l.after, ITEM, NOTE), `the load under ${V11.recipe}`);
}, 1_800_000);

it('#1961.0c0ae838 after the load under shelf.bookcase 1.1, b.shelf.2 expands', () => {
  const l = load();
  none(expandsFailures(l.after, 'b', 'b.shelf.2'), `b after the load under ${V11.recipe}`);
}, 1_800_000);

for (const planted of ['orphan_load_drops_broken_out', 'orphan_load_hands_id_to_expansion']) {
  it(`#1961.0c0ae838 a planted loader (${planted}) fails this check, naming b.board.2`, () => {
    const l = load(planted);
    const failures = [
      ...keptFailures(l.after, 'b', ITEM, l.mine),
      ...orphanFailures(l.patched, l.after, ITEM, NOTE),
      ...expandsFailures(l.after, 'b', 'b.shelf.2'),
    ];
    failsNaming(failures, [ITEM], `the planted loader ${planted}`);
  }, 1_800_000);
}
