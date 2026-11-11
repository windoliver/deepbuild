// #1961.7bc49ab6: "An open document from shelf.bookcase 1.0 holds instance `b`, which derives `b.board.2`. A patch that
// names the pack version carrying 1.1, whose step `board` is renamed `shelf`, derives `b.shelf.2` and no `b.board.2`;
// its undo derives `b.board.2` again and no `b.shelf.2`, and after each every evaluated output and content key equals a
// cold evaluation of that revision. A planted expansion cache keyed by the kind and its inputs without the recipe's
// version keeps `b.board.2` after the patch and fails, naming `b` and both versions"
//
// One test per clause, each its own `deep-show run` process (README: Criteria to tests). Each opens the corpus document
// fixtures/bookcase-1.0.json (your board naming acme/shelf@1.0.0, holding instance b), reads revision 0, applies your
// patch that names acme/shelf@1.1.0, reads, undoes that patch and reads again.
// asserts:
// 1. derivesFailures: at revision 0 b derives b.board.2 and no b.shelf.2 (what the criterion starts from); the patch
//    applies, and after it the document names acme/shelf@1.1.0 and b derives b.shelf.2 and no b.board.2.
// 2. derivesFailures: the undo applies, and after it the document names acme/shelf@1.0.0 again and b derives b.board.2
//    and no b.shelf.2.
// 3. coldFailures: after the patch and after the undo, the read's expansion rows (pack, key, derived items with their
//    values, seeds and the rest) and draws equal, field by field, those of a fresh process that opens the stored
//    document that read showed.
// 4. Under `expansion_cache_without_recipe_version`, the patch applies, and the checks of 1 and 3 after the patch fail
//    with a failure naming `b`, b.board.2, shelf.bookcase 1.0 and shelf.bookcase 1.1.
// Wrong program: the merge base, where a patch reaches only items, so the patch that names acme/shelf@1.1.0 is refused;
// and the planted cache.

import { expect, it } from 'vitest';
import {
  V10, V11, coldFailures, coldRead, derivesFailures, failsNaming, fixture, named, none, outcome, patch, patchId, pinPatch, pinsOf, read, run,
  scenario, show, storedOf, undo, useBuild, useEvidence, type JsonObject,
} from './helpers.ts';

const bin = useBuild();
const evidence = useEvidence();
const DOCUMENT = fixture('bookcase-1.0.json');
const PIN = patchId(11);
const UNDO = patchId(12);

interface Session { opened: JsonObject; pinned: JsonObject; after: JsonObject; undone: JsonObject; back: JsonObject }

/** The open document, your patch naming acme/shelf@1.1.0, a read, your undo of it, a read. */
function session(planted?: string): Session {
  const [opened, pinned, after, undone, back] = run(bin(), scenario(evidence(), DOCUMENT, [
    read(),
    patch(pinPatch(PIN, 0, V11)),
    read(),
    undo(UNDO, PIN),
    read(),
  ], planted ? { planted } : {}));
  none(derivesFailures(opened!, 'opening', 'b', V10, V11), `the open document from ${V10.recipe}`);
  return { opened: opened!, pinned: pinned!, after: after!, undone: undone!, back: back! };
}
const applied = (reply: JsonObject, what: string): void => {
  expect(outcome(reply), `${what} applies: ${show(reply['issues'] ?? null, 2000)}`).toBe('applied');
};

it('#1961.7bc49ab6 a patch that names the pack version carrying shelf.bookcase 1.1 derives b.shelf.2 and no b.board.2', () => {
  const s = session();
  applied(s.pinned, `your patch that names ${named(V11)}`);
  none(derivesFailures(s.after, 'the patch', 'b', V11, V10), `b after the patch that names ${named(V11)}`);
}, 1_800_000);

it('#1961.7bc49ab6 its undo derives b.board.2 again and no b.shelf.2', () => {
  const s = session();
  applied(s.pinned, `your patch that names ${named(V11)}`);
  applied(s.undone, 'your undo of that patch');
  none(derivesFailures(s.back, 'the undo', 'b', V10, V11), 'b after the undo');
}, 1_800_000);

it('#1961.7bc49ab6 after the patch and after its undo, every evaluated output and content key equals a cold evaluation of that revision', () => {
  const s = session();
  applied(s.pinned, `your patch that names ${named(V11)}`);
  applied(s.undone, 'your undo of that patch');
  expect(pinsOf(s.after, 'after the patch'), `the revision the patch made names ${named(V11)}`).toEqual([named(V11)]);
  expect(pinsOf(s.back, 'after the undo'), `the revision the undo made names ${named(V10)}`).toEqual([named(V10)]);
  none(coldFailures(s.after, coldRead(bin(), storedOf(s.after, 'after the patch')), 'the patch', V11, V10), 'the revision the patch made, warm and cold');
  none(coldFailures(s.back, coldRead(bin(), storedOf(s.back, 'after the undo')), 'the undo', V10, V11), 'the revision the undo made, warm and cold');
}, 1_800_000);

it('#1961.7bc49ab6 a planted expansion cache keyed by the kind and its inputs without the recipe\'s version keeps b.board.2 after the patch and fails, naming b and both versions', () => {
  const planted = 'expansion_cache_without_recipe_version';
  const s = session(planted);
  applied(s.pinned, `your patch that names ${named(V11)}, under ${planted}`);
  const failures = [
    ...derivesFailures(s.after, 'the patch', 'b', V11, V10),
    ...coldFailures(s.after, coldRead(bin(), storedOf(s.after, 'after the patch'), { planted }), 'the patch', V11, V10),
  ];
  failsNaming(failures, ['`b`', 'b.board.2', V10.recipe, V11.recipe], `the planted cache ${planted}`);
}, 1_800_000);
