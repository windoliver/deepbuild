// #1415 AC6 and AC7 on the canvas core (`deep-show run`, the default build): a patch that changes nothing answers no_change, and
// a create of an ID the document holds is refused with id_taken; each with the planted handler the criterion names (README:
// Surface choices, The planted handlers).

import { describe, expect, it } from 'vitest';
import {
  BOX, LAYER, P, TEST_MS, brief, codesOf, create, currentOf, defaultBinary, isObj, patch, play, revisions, rowsChange, rowsOf, sameRows,
  scenario, set, undo, useScratch, type JsonObject,
} from './helpers.ts';

useScratch();

/** The planted handler that commits a patch that changes nothing as a new revision, as the merge base does (AC6). */
const NO_OP_COMMITS = 'no_op_commits';
/** The planted handler whose create replaces the item that already holds the ID (AC7). */
const CREATE_OVERWRITES = 'create_overwrites';

/**
 * AC6's scenario: alpha's real patch makes revision 1; then a patch whose ops set the card's box and name to what they already
 * are; then an undo of that patch. The failures, each naming what it saw; a new revision is named by its number.
 */
function noChangeFailures(planted?: string): string[] {
  const run = play(defaultBinary(), scenario([
    patch(P(1), 0, [set('tag', 'params/box', [0, 0, 22, 10])]),
    revisions(),
    patch(P(2), 1, [set('card', 'params/box', BOX.card), set('card', 'name', 'Card')]),
    revisions(),
    undo(P(3), P(2)),
    revisions(),
  ], planted ? { planted } : {}));
  if (!run.ok) return [`deep-show run answered ${String(run.code)} for the scenario${planted ? ` with planted ${planted}` : ''}`];
  const [p1, r1, same, r2, undone, r3] = run.replies as [JsonObject, JsonObject, JsonObject, JsonObject, JsonObject, JsonObject];
  if (p1['outcome'] !== 'applied' || p1['rev'] !== 1) return [`the setup: alpha's patch P1 wasn't applied as revision 1: ${brief(p1)}`];
  const before = rowsOf(r1);
  const current = currentOf(before ?? []);
  const failures: string[] = [];
  if (same['outcome'] === 'applied' && typeof same['rev'] === 'number' && same['rev'] !== current?.rev) {
    failures.push(`the patch that changes nothing answered applied with a new revision, rev ${same['rev']}, where it answers no_change with the current revision's hash: ${brief(same)}`);
  }
  if (!codesOf(same).includes('no_change')) failures.push(`the patch that changes nothing doesn't answer no_change: ${brief(same)}`);
  if (same['outcome'] === 'applied') failures.push(`the patch that changes nothing answers applied, a success for a patch that did nothing: ${brief(same)}`);
  if (same['hash'] !== current?.hash) failures.push(`the no_change answer's hash is ${brief(same['hash'])}, not the current revision's, ${String(current?.hash)}`);
  if (typeof same['rev'] === 'number' && same['rev'] !== current?.rev) failures.push(`the no_change answer names rev ${same['rev']}, not the current revision, ${String(current?.rev)}`);
  if (Array.isArray(same['undo']) && same['undo'].length > 0) failures.push(`the no_change answer carries undo ops, an undo step: ${brief(same['undo'])}`);
  const after = rowsOf(r2);
  if (!sameRows(before, after)) {
    const added = (after ?? []).filter((r) => !(before ?? []).some((b) => b.rev === r.rev));
    failures.push(`the patch that changes nothing made a revision${added.length ? `, rev ${added.map((r) => r.rev).join(', rev ')}` : ''}: ${rowsChange(before, after)}`);
  }
  // No undo step: an undo of the patch has nothing to undo, so it applies nothing and makes no revision.
  if (undone['outcome'] === 'applied') failures.push(`an undo of the patch that changed nothing was applied (an undo step exists): ${brief(undone)}`);
  if (!sameRows(before, rowsOf(r3))) failures.push(`the undo of the patch that changed nothing made a revision: ${rowsChange(before, rowsOf(r3))}`);
  return failures;
}

/**
 * AC7's scenario: alpha's real patch makes revision 1; then alpha's create of `door`, which the board already holds in bravo's
 * layer. The failures, each naming what it saw; a changed document is named by both hashes.
 */
function idTakenFailures(planted?: string): string[] {
  const door = { id: 'door', kind: 'rect@1', name: 'Door again', order: 'a5', params: { box: [0, 0, 10, 10], paint: { fill: { role: 'ink' } } }, at: { pos: [0, 0, 0] } };
  const run = play(defaultBinary(), scenario([
    patch(P(1), 0, [set('tag', 'params/box', [0, 0, 22, 10])]),
    revisions(),
    patch(P(2), 1, [create(door)]),
    revisions(),
  ], planted ? { planted } : {}));
  if (!run.ok) return [`deep-show run answered ${String(run.code)} for the scenario${planted ? ` with planted ${planted}` : ''}`];
  const [p1, r1, created, r2] = run.replies as [JsonObject, JsonObject, JsonObject, JsonObject];
  if (p1['outcome'] !== 'applied' || p1['rev'] !== 1) return [`the setup: alpha's patch P1 wasn't applied as revision 1: ${brief(p1)}`];
  const failures: string[] = [];
  const was = currentOf(rowsOf(r1) ?? [])?.hash;
  const now = currentOf(rowsOf(r2) ?? [])?.hash;
  if (was !== now) failures.push(`the document's hash changed from ${String(was)} to ${String(now)}: the create replaced the door it already held`);
  if (!sameRows(rowsOf(r1), rowsOf(r2))) failures.push(`the create of door changed the revisions: ${rowsChange(rowsOf(r1), rowsOf(r2))}`);
  if (created['outcome'] !== 'refused') failures.push(`the create of door answers ${String(created['outcome'])}, not refused: ${brief(created)}`);
  const issue = (Array.isArray(created['issues']) ? created['issues'] : []).filter(isObj).find((i) => i['code'] === 'id_taken');
  if (!issue) failures.push(`the create of door isn't refused with an id_taken issue (it names [${codesOf(created).join(', ')}]): ${brief(created)}`);
  else {
    const ids = Array.isArray(issue['ids']) ? issue['ids'].map(String) : [];
    if (!ids.includes('door')) failures.push(`the id_taken issue doesn't name door in its ids: ${brief(issue)}`);
    const actual = issue['actual'];
    if (!isObj(actual) || actual['layer'] !== LAYER.bravo) failures.push(`the id_taken issue doesn't name door's writer layer, ${LAYER.bravo}, as actual.layer: ${brief(issue)}`);
  }
  return failures;
}

describe('#1415: a patch that changes nothing, and a create that would replace an item', () => {
  // AC6: "A patch whose ops leave every item's content key unchanged returns `no_change` with the current revision's hash and
  // creates no revision and no undo step. A planted handler that answers success with a new revision number fails, naming the
  // revision"
  it('AC6 a patch whose ops leave every item as it was answers no_change with the current revision\'s hash, and makes no revision and no undo step', () => {
    expect(noChangeFailures()).toEqual([]);
  }, TEST_MS);

  it(`AC6 (wrong program ${NO_OP_COMMITS}) a handler that answers the patch applied with a new revision number fails, naming the revision`, () => {
    const failures = noChangeFailures(NO_OP_COMMITS);
    // Revision 1 is current, so the planted handler's new revision is 2.
    expect(failures.some((f) => /\brev 2\b/.test(f)), `the planted handler's run fails naming the new revision, rev 2: ${JSON.stringify(failures)}`).toBe(true);
  }, TEST_MS);

  // AC7: "A patch that creates item `door` in a document that already holds `door` is refused with `id_taken`, naming the ID and
  // its writer layer, and the document's hash is unchanged. A planted handler that overwrites the item fails by hash"
  it('AC7 a create of door in a board that already holds door is refused with id_taken, naming door and bravo\'s layer, and the hash is unchanged', () => {
    expect(idTakenFailures()).toEqual([]);
  }, TEST_MS);

  it(`AC7 (wrong program ${CREATE_OVERWRITES}) a handler whose create overwrites door fails by hash`, () => {
    const failures = idTakenFailures(CREATE_OVERWRITES);
    expect(failures.some((f) => /hash changed from [0-9a-f]{64} to [0-9a-f]{64}/.test(f)), `the planted handler's run fails by hash, naming both: ${JSON.stringify(failures)}`).toBe(true);
  }, TEST_MS);
});
