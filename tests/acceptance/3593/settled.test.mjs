// #3593 criterion 1: with a settled list naming suite S of a closed issue, a change to a package file S's test imports
// itself, with no process between, doesn't run S: --list and a run print SETTLED 1 naming S, and the run reads
// INCONCLUSIVE (README: What each file proves).
import { test } from 'node:test';
import { IMPORTED, LONG, OWN_TEST, affected, assert, closed, dump, fileOf, folderOf, importFixture, left, leftNames, listOf, ranOf, sandbox, selects, summary, writeList } from './helpers.mjs';

// S is on the list; OFF, which imports the same file, is not.
const S = 90001, OFF = 90002;

test(`#3593.419d4752 --list: a settled suite whose test imports the changed package file itself is named on one SETTLED 1 line and leaves the selection; a selection that runs it, or drops it without the line, fails, naming it`, LONG, async (t) => {
  const box = sandbox(t);
  const fx = importFixture(box);
  closed(box, S);
  writeList(box, listOf(fx, [S]));
  const out = await affected(box, fx, ['--list', IMPORTED]);
  const all = dump(box, out);
  assert.equal(out.status, 0, `affected.mjs --list exited ${out.status}\n${all}`);
  // What no list names is selected as today: a suite off the list, and the package's own test outside tests/acceptance/.
  for (const file of [fileOf(OFF), OWN_TEST]) assert.ok(selects(out, file), `the selection lost ${file}, which the settled list doesn't name\n${all}`);
  assert.ok(leftNames(out, S), `${folderOf(S)} is on the settled list and the change reaches it only by an import of ${IMPORTED}, but no "SETTLED <n> …" line names it: ${selects(out, fileOf(S)) ? 'it is still selected' : 'the selection dropped it without the line'}\n${all}`);
  assert.deepEqual(left(out).map(({ count }) => count), [1], `the selection doesn't print one line "SETTLED 1 …" for the one suite it leaves (${folderOf(S)})\n${all}`);
  assert.ok(!leftNames(out, OFF), `the SETTLED line names ${folderOf(OFF)}, which the settled list doesn't hold\n${all}`);
  assert.ok(!selects(out, fileOf(S)), `${folderOf(S)} is named on the SETTLED line and still selected\n${all}`);
});

test(`#3593.419d4752 a run: a settled suite whose test imports the changed package file itself doesn't run, the run prints SETTLED 1 naming it and reads INCONCLUSIVE; a run that runs it, or drops it without the line, fails, naming it`, LONG, async (t) => {
  const box = sandbox(t);
  const fx = importFixture(box);
  closed(box, S);
  writeList(box, listOf(fx, [S]));
  const out = await affected(box, fx, [IMPORTED]);
  const all = dump(box, out);
  // The run is judged on a real run: the suite no list names ran, and passed.
  assert.ok(ranOf(box, OFF).some(({ ok }) => ok), `${folderOf(OFF)}, which the settled list doesn't name, didn't run and pass\n${all}`);
  assert.ok(leftNames(out, S), `${folderOf(S)} is on the settled list and the change reaches it only by an import of ${IMPORTED}, but the run printed no "SETTLED <n> …" line naming it: ${ranOf(box, S).length ? 'it ran' : 'the run dropped it without the line'}\n${all}`);
  assert.deepEqual(left(out).map(({ count }) => count), [1], `the run doesn't print one line "SETTLED 1 …" for the one suite it leaves (${folderOf(S)})\n${all}`);
  assert.deepEqual(ranOf(box, S), [], `${folderOf(S)} is named on the SETTLED line and ran all the same\n${all}`);
  // Nothing unrun reads PASS.
  assert.match(summary(out), /^INCONCLUSIVE affected: /, `the run left ${folderOf(S)} unrun and doesn't read INCONCLUSIVE: its summary is "${summary(out)}"\n${all}`);
  assert.equal(out.status, 2, `the run left ${folderOf(S)} unrun and exited ${out.status}, not 2 as an INCONCLUSIVE run does\n${all}`);
});
