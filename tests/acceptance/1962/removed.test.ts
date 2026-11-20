// #1962.1c118241: "shelf@2.0.0 without `shelf.bookcase`, with no `moved` entry and no `removed` entry, is refused at
// pack check, naming the kind. With `removed: {shelf.bookcase@2: "superseded"}` it installs, and upgrading the corpus
// document is refused with a fix, naming the 3 items; the document on shelf@1.2.0 still draws to the same snapshot
// hash"
//
// asserts: in `r1`, two processes, acme/shelf@1.2.0 offered first in each (the fixtures checked first: neither 2.0.0
// ships a kind or a recipe, neither declares `moved`, the first declares no `removed` and the second exactly
// {shelf.bookcase@2: "superseded"}):
// - acme/shelf@2.0.0 of fixtures/packs/shelf-2.0.0-dropped is refused at its pack check by an error
//   `unintended_removal` naming shelf.bookcase@2;
// - acme/shelf@2.0.0 of fixtures/packs/shelf-2.0.0-removed installs. The room (acme/shelf@1.2.0's corpus document of
//   major 2: b1, b2 and b3 at shelf.bookcase@2), presented from your shell as saved, on acme/shelf@1.2.0, draws to the
//   snapshot hash recorded for it (at 0s, 480 × 280; the fixture held to the binary). Presented to the same document
//   with its `packs` entry naming that 2.0.0, as the patch that takes the version writes it, it is refused, and for
//   each of b1, b2 and b3 an error `unknown_kind` names it in its `ids` and in its `fix`; then the room as saved,
//   presented again, is presented and draws to the same snapshot hash as before.
// The codes and the fix's naming are this job's choices (README: Choices).
// Wrong programs: the merge base, whose pack check installs the dropped 2.0.0 and refuses the removed one (`removed`
// is unknown_field), so the upgraded room names a version the store lacks and opens with its bookcases skipped; a
// check that lets a kind disappear silently, refuses the removal it lists, or upgrades the room by skipping its
// bookcases; a refusal with the catch-all fix.

import { expect, it } from 'vitest';
import {
  BOOKCASES, DOC, OLD_KIND, PACKS, SHELF_12, SHELF_20_DROPPED, SHELF_20_REMOVED, errors, installFailures, issues, manifestOf, namesId, none,
  outcome, packRow, pinned, present, roomRecord, run, scenario, shot, show, snapshotOf, useBinary, useEvidence, where, type JsonObject,
  type PackFixture,
} from './helpers.ts';

const bin = useBinary();
const evidence = useEvidence();

/** A 2.0.0 that ships nothing of the bookcase, as its fixture must hold it: no kind, no recipe, no moved entry, and `removed` as given. */
function checkDropped(p: PackFixture, removed: JsonObject | undefined): void {
  const m = manifestOf(p);
  expect([m['kinds'], m['recipes'], m['moved'], m['removed']], `the fixture: ${where(p)} ships no kind, no recipe, no moved entry, and removed ${show(removed ?? null)}`)
    .toEqual([undefined, undefined, undefined, removed]);
}

/** The first clause: the 2.0.0 that drops the bookcase silently is refused at its pack check, naming the kind. */
function droppedFailures(packs: JsonObject): string[] {
  const failures = installFailures(packs, [SHELF_12]);
  const row = packRow(packs, SHELF_20_DROPPED);
  if (row.state !== 'refused') return [...failures, `${where(SHELF_20_DROPPED)} is ${row.state} at its pack check: it ships no ${OLD_KIND} and lists it under neither moved nor removed, so it must be refused, naming ${OLD_KIND}`];
  if (!row.errors.some((i) => i.code === 'unintended_removal' && JSON.stringify(i.raw).includes(OLD_KIND))) {
    failures.push(`${where(SHELF_20_DROPPED)} is refused without an error unintended_removal naming ${OLD_KIND}: ${show(row.errors.map((i) => i.raw), 2500)}`);
  }
  return failures;
}

/**
 * The rest: the 2.0.0 that lists the bookcase as removed installs; the room's upgrade to it is refused, each bookcase
 * named by an error `unknown_kind` in its `ids` and its `fix`; and the room on acme/shelf@1.2.0 then draws to the
 * snapshot hash it drew to before (`before`).
 */
function removedFailures(packs: JsonObject, upgrade: JsonObject, after: JsonObject, before: string): string[] {
  const failures = installFailures(packs, [SHELF_12, SHELF_20_REMOVED]);
  const what = `the room upgraded to ${where(SHELF_20_REMOVED)}`;
  if (outcome(upgrade) !== 'refused') failures.push(`${what} is ${outcome(upgrade)}, not refused: ${show(upgrade['issues'] ?? null, 1500)}; notices ${show(upgrade['notices'] ?? null, 800)}`);
  const refusals = errors(issues(upgrade, what)).filter((i) => i.code === 'unknown_kind');
  for (const id of BOOKCASES) {
    if (!refusals.some((i) => i.ids.includes(id) && namesId(i.fix, id))) failures.push(`no error unknown_kind of ${what} names ${id} in its ids and its fix: ${show(errors(issues(upgrade, what)).map((i) => i.raw), 1500)}`);
  }
  if (outcome(after) !== 'presented' || shot(after) !== before) {
    failures.push(`the room on acme/shelf@1.2.0, after the refused upgrade, is ${outcome(after)} and draws to ${shot(after) || 'no snapshot'}, not the snapshot hash it drew to before, ${before}: ${show(after['issues'] ?? null, 800)}`);
  }
  return failures;
}

it('#1962.1c118241 shelf@2.0.0 without shelf.bookcase, with no moved entry and no removed entry, is refused at pack check, naming the kind; with removed {shelf.bookcase@2: "superseded"} it installs, upgrading the corpus document is refused with a fix naming the 3 items, and the document on shelf@1.2.0 still draws to the same snapshot hash', () => {
  const b = bin();
  checkDropped(SHELF_20_DROPPED, undefined);
  checkDropped(SHELF_20_REMOVED, { [OLD_KIND]: 'superseded' });
  const rec = roomRecord();
  const snap = snapshotOf(rec).raw;
  const [dropped] = run(b, scenario(evidence(), [PACKS], { packs: [SHELF_12, SHELF_20_DROPPED] }));
  const [packs, before, upgrade, after] = run(b, scenario(evidence(), [
    PACKS,
    present(DOC.a, rec.document, snap),
    present(DOC.a, pinned(rec.document, SHELF_20_REMOVED), snap),
    present(DOC.a, rec.document, snap),
  ], { packs: [SHELF_12, SHELF_20_REMOVED] }));
  // The fixture: before the upgrade the room on acme/shelf@1.2.0 is presented and draws to the hash recorded for it.
  expect([outcome(before!), shot(before!)], `the fixture: the room on acme/shelf@1.2.0 draws to its recorded snapshot hash: ${show(before!['issues'] ?? null, 800)}`).toEqual(['presented', snapshotOf(rec).sha256]);
  none([...droppedFailures(dropped!), ...removedFailures(packs!, upgrade!, after!, shot(before!))], 'the 2.0.0 that drops the bookcase, and the one that lists it as removed');
}, 1_800_000);
