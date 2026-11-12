// #1958.c08c09f6: "Uninstalling shelf@1.2.0 while a saved document names it keeps its bytes: the document loads, checks
// and draws to the same snapshot hash as before, deep_kinds lists the pack as retired, and a patch that creates a new
// bookcase is refused with pack_missing; and a planted store sweep that deletes the version fails the store's fixture,
// naming the pack and the document that names it"
//
// asserts: in `r1`, with acme/shelf@1.2.0 installed (fixtures/packs/shelf-1.2.0), the saved document DOC.b (the reading
// room: bookcases b1–b3 and boxes r01–r12, stored in your layer, naming acme/shelf@1.2.0) reads with its bookcases
// expanded and draws with its check PASS. Then `uninstall_pack` acme/shelf@1.2.0, and the store's fixture's check
// (`retiredFailures`) finds nothing: the `packs` row is `retired` with `named_by` at least 1; `read` gives the same
// `draws`; the same document drawn again is presented, its check PASS, its snapshot sha256 the one before. `deep_kinds`
// op list lists acme/shelf 1.2.0 with `state` `retired`. Your patch that creates a fourth bookcase is refused with a
// `pack_missing` naming acme/shelf and 1.2.0.
// The second test runs the store's fixture with the planted `store_sweep_deletes_named` (the sweep after uninstalling
// deletes the version though the document names it) and asserts `retiredFailures` fails with one failure naming
// acme/shelf@1.2.0 and DOC.b.
// Wrong program: the merge base, which has no `uninstall_pack` call and no such planted name (bad_input).

import { expect, it } from 'vitest';
import {
  BOOKCASE, BOOKCASES, KINDS_LIST, RETIRED_DOC, SHELF_12, arr, drawsOf, errors, failsNaming, issues, isObject, mentions, none, outcome, packAt,
  retiredCalls, retiredFailures, retiredSeeds, run, scenario, shot, show, sorted, useBuild, useEvidence, youPatch, type JsonObject,
} from './helpers.ts';

const bin = useBuild();
const evidence = useEvidence();

/** Your patch that creates a fourth bookcase in the saved document. */
const NEW_BOOKCASE = youPatch(RETIRED_DOC, 1, 0, 'adds a fourth bookcase', [
  { op: 'create', item: { id: '~1', kind: BOOKCASE, name: 'Bookcase 4', order: 'aF', params: { width: 1, levels: 2 }, at: { pos: [480, 20, 0] } } },
]);

it('#1958.c08c09f6 uninstalling shelf@1.2.0 while a saved document names it keeps its bytes: the document loads, checks and draws to the same snapshot hash as before, deep_kinds lists the pack as retired, and a patch that creates a new bookcase is refused with pack_missing', () => {
  const replies = run(bin(), scenario(evidence(), [...retiredCalls(), KINDS_LIST, NEW_BOOKCASE], { packs: [SHELF_12], seeds: retiredSeeds() }));
  const [readBefore, drawnBefore] = replies;
  const [kinds, patched] = replies.slice(-2);

  // The fixture means what it says: before uninstalling, the saved document expands its bookcases through 1.2.0 and draws.
  const expanded = sorted([...new Set(drawsOf(readBefore!, 'read before uninstalling').filter((id) => id.includes('.')).map((id) => id.split('.')[0]!))]);
  expect(expanded, `before uninstalling, the saved document's bookcases draw expanded: ${show(readBefore!, 1500)}`).toEqual([...BOOKCASES]);
  expect([outcome(drawnBefore!), drawnBefore!['result']], `before uninstalling, the saved document draws with its check PASS: ${show(drawnBefore!, 1500)}`).toEqual(['presented', 'PASS']);
  expect(shot(drawnBefore!, 'the draw before uninstalling'), 'before uninstalling, the draw carries one snapshot').not.toBe('');

  // The store's fixture: the version stays, retired and named, and the document loads, checks and draws as before.
  none(retiredFailures(replies), 'the store\'s fixture after uninstalling acme/shelf@1.2.0');

  // deep_kinds lists the pack as retired.
  const listed = arr(kinds!['packs'], 'deep_kinds list: packs').filter((r): r is JsonObject => isObject(r) && r['pack'] === SHELF_12.id && r['version'] === SHELF_12.version);
  expect(listed.map((r) => r['state']), `deep_kinds lists ${packAt(SHELF_12)} once, as retired: ${show(kinds!['packs'] ?? null)}`).toEqual(['retired']);

  // A patch that creates a new bookcase is refused with pack_missing.
  expect(outcome(patched!), `your patch creating a fourth bookcase is refused: ${show(patched!, 1500)}`).toBe('refused');
  const missing = issues(patched!, 'the patch').filter((i) => i.code === 'pack_missing' && mentions(i.raw, SHELF_12.id) && mentions(i.raw, SHELF_12.version));
  expect(missing.length, `the refusal is pack_missing naming ${SHELF_12.id} and ${SHELF_12.version}: ${show(errors(issues(patched!)).map((i) => i.raw), 1500)}`).toBeGreaterThan(0);
}, 1_800_000);

it('#1958.c08c09f6 a planted store sweep that deletes the version fails the store\'s fixture, naming the pack and the document that names it', () => {
  const replies = run(bin(), scenario(evidence(), retiredCalls(), { packs: [SHELF_12], seeds: retiredSeeds(), planted: 'store_sweep_deletes_named' }));
  failsNaming(retiredFailures(replies), [packAt(SHELF_12), RETIRED_DOC], 'the planted store sweep that deletes acme/shelf@1.2.0');
}, 1_800_000);
