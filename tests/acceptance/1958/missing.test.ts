// #1958.4879b3fb: "A document from another machine that names shelf@9.9.9, which this build has never had, opens: its 3
// bookcase instances are skipped with pack_missing naming shelf@9.9.9, its 12 other items draw, another writer's patch to
// those items leaves the 3 instances' bytes the same by hash, and a check that touches one is BLOCKED, naming the pack;
// and a planted loader that draws them with the installed shelf@1.2.0 fails, naming the item and both versions"
//
// asserts: in `r1`, with acme/shelf@1.2.0 installed (so a loader could reach for it), the reading room naming
// acme/shelf@9.9.9 (bookcases b1–b3, boxes r01–r12) presented from your shell opens, and the open's check
// (`skippedFailures`) finds nothing: presented with no error; one `pack_missing` naming acme/shelf and 9.9.9 with `ids`
// b1, b2, b3; no expansion of any bookcase; its snapshot sha256 is that of the 12 boxes alone, drawn in the same
// process. The same room stored on DOC.b as it came from another machine (b1–b3 in your layer, r01–r12 in the working
// agent's) reads at revision 0 with b1–b3 as stored; the working agent's patch moving r01 and r12 applies, after it r01
// holds its new box, b1–b3 hash the same as before, and `draws` is r01–r12. The room checked in the working agent's
// claim (`deep show --check`, DOC.d its deliverable) is BLOCKED, a `blocked` row naming acme/shelf.
// The second test opens the room under the planted `loader_draws_missing_with_installed` (the loader resolves a missing
// version through the installed version of the same pack) and asserts `skippedFailures` fails with one failure naming
// b1, 9.9.9 and 1.2.0.
// Wrong program: the merge base, which refuses the document whole with pack_missing and has no such planted name.

import { expect, it } from 'vitest';
import {
  BOOKCASES, DOC, MISSING, OTHERS, PACKS, SHELF_12, alphaPatch, arr, checkInClaim, drawsOf, failsNaming, hashOf, installed, isObject, mentions, none,
  obj, othersOnly, outcome, packAt, present, readDoc, room, run, scenario, shot, show, skippedFailures, stored, storedItems, useBuild, useEvidence,
  type JsonObject,
} from './helpers.ts';

const bin = useBuild();
const evidence = useEvidence();

/** The reading room as it came from another machine, naming acme/shelf@9.9.9. */
const FOREIGN = room(packAt(MISSING));
/** The same room stored: the bookcases in your layer, the 12 other items in the working agent's. */
const SEEDED = stored(FOREIGN, (id) => ((BOOKCASES as readonly string[]).includes(id) ? 'you-main' : 'alpha-main'));
const MOVED_R01 = [20, 344, 40, 40];
/** The working agent's patch to its own items: r01 and r12 move down. */
const ALPHA_MOVES = alphaPatch(DOC.b, 2, 0, 'moves two boxes down', [
  { op: 'set', id: 'r01', path: 'items/r01/params/box', value: MOVED_R01 },
  { op: 'set', id: 'r12', path: 'items/r12/params/box', value: [570, 344, 40, 40] },
]);
/** Each bookcase's bytes by hash, from a document's items. */
const bookcaseHashes = (items: JsonObject, what: string): string[] => BOOKCASES.map((id) => hashOf(obj(items[id], `${what}: ${id}`)));

it('#1958.4879b3fb a document from another machine naming shelf@9.9.9 opens: its 3 bookcases are skipped with pack_missing naming shelf@9.9.9, its 12 other items draw, another writer\'s patch to those items leaves the 3 instances\' bytes the same by hash, and a check that touches one is BLOCKED, naming the pack', () => {
  const [packs, opened, others, before, patched, after, checked] = run(bin(), scenario(evidence(), [
    PACKS,
    present(DOC.a, FOREIGN, { pixels: true }),
    present(DOC.c, othersOnly(), { pixels: true }),
    readDoc(DOC.b),
    ALPHA_MOVES,
    readDoc(DOC.b),
    checkInClaim(FOREIGN),
  ], { packs: [SHELF_12], seeds: { [DOC.b]: SEEDED }, claims: true }));
  installed(packs!, [SHELF_12]);

  // Opens: the bookcases skipped with pack_missing naming acme/shelf@9.9.9, the 12 other items drawn, nothing else.
  expect(outcome(others!), `the 12 other items alone are presented: ${show(others!, 1200)}`).toBe('presented');
  const othersShot = shot(others!, 'the 12 other items alone');
  expect(othersShot, 'the 12 other items alone draw one snapshot').not.toBe('');
  none(skippedFailures(opened!, othersShot), 'the open of the document naming acme/shelf@9.9.9');

  // Another writer's patch to the 12 other items leaves the 3 instances' bytes the same by hash.
  const seeded = bookcaseHashes(obj(SEEDED['items'], 'the stored room\'s items'), 'the stored room');
  const kept = bookcaseHashes(storedItems(before!, 'read before the patch'), 'read before the patch');
  expect(kept, `the stored document opens with b1–b3 byte for byte as they came: ${show(before!, 1500)}`).toEqual(seeded);
  expect(outcome(patched!), `the working agent's patch to r01 and r12 applies: ${show(patched!, 1500)}`).toBe('applied');
  const afterItems = storedItems(after!, 'read after the patch');
  expect(obj(obj(afterItems['r01'], 'r01 after the patch')['params'], 'r01\'s params')['box'], 'the patch landed: r01 holds its new box').toEqual(MOVED_R01);
  expect(bookcaseHashes(afterItems, 'read after the patch'), 'after another writer\'s patch, b1–b3 hash the same as before it').toEqual(kept);
  expect(drawsOf(after!, 'read after the patch'), 'what draws of the stored document is its 12 other items').toEqual(OTHERS);

  // A check that touches one is BLOCKED, naming the pack.
  expect(checked!['result'], `the check in the claim of the document naming ${packAt(MISSING)} is BLOCKED: ${show(checked!, 1500)}`).toBe('BLOCKED');
  const blocked = arr(checked!['blocked'] ?? [], 'the check: blocked').filter((b) => isObject(b) && mentions(b, MISSING.id));
  expect(blocked.length, `a blocked row names the pack ${MISSING.id}: ${show(checked!['blocked'] ?? null)}`).toBeGreaterThan(0);
}, 1_800_000);

it('#1958.4879b3fb a planted loader that draws the missing version\'s instances with the installed shelf@1.2.0 fails, naming the item and both versions', () => {
  const [opened, others] = run(bin(), scenario(evidence(), [
    present(DOC.a, FOREIGN, { pixels: true }),
    present(DOC.c, othersOnly(), { pixels: true }),
  ], { packs: [SHELF_12], planted: 'loader_draws_missing_with_installed' }));
  expect(outcome(others!), 'the 12 other items alone are presented').toBe('presented');
  failsNaming(skippedFailures(opened!, shot(others!, 'the 12 other items alone')), ['b1', MISSING.version, SHELF_12.version], 'the planted loader that draws acme/shelf@9.9.9\'s bookcases with acme/shelf@1.2.0');
}, 1_800_000);
