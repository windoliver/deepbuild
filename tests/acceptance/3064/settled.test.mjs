// #3064 AC1: with a settled list naming suite S, a change that reaches S only through a binary doesn't run S; and the
// issue's `--settled` (README: What each file proves).
import { test } from 'node:test';
import { CHANGE, LONG, NEAR, affected, assert, binaryFixture, dump, fileOf, fixture, folderOf, left, leftNames, listOf, ranOf, sandbox, selects, summary, writeList } from './helpers.mjs';

// S is on the list; the fixture's two other suites, which start the same build, are not.
const S = 90001, OTHERS = [90002, 90003];

test(`#3064.25bec8c3 --list: a settled suite the change reaches only through the build it starts is named on one SETTLED 1 line and leaves the selection; a selection that drops it without the line fails, naming it`, LONG, async (t) => {
  const box = sandbox(t);
  const fx = fixture(box);
  writeList(box, listOf(fx, [S]));
  const out = await affected(box, fx, ['--list', CHANGE]);
  const all = dump(box, out);
  assert.equal(out.status, 0, `affected.mjs --list exited ${out.status}\n${all}`);
  // What no list names is selected as today.
  for (const file of [...OTHERS.map(fileOf), NEAR]) assert.ok(selects(out, file), `the selection lost ${file}, which the settled list doesn't name\n${all}`);
  assert.ok(leftNames(out, S), `${folderOf(S)} is on the settled list and the change reaches it only through the build it starts, but no "SETTLED <n> …" line names it: ${selects(out, fileOf(S)) ? 'it is still selected' : 'the selection dropped it without the line'}\n${all}`);
  assert.deepEqual(left(out).map(({ count }) => count), [1], `the selection doesn't print one line "SETTLED 1 …" for the one suite it leaves (${folderOf(S)})\n${all}`);
  for (const issue of OTHERS) assert.ok(!leftNames(out, issue), `the SETTLED line names ${folderOf(issue)}, which the settled list doesn't hold\n${all}`);
  assert.ok(!selects(out, fileOf(S)), `${folderOf(S)} is named on the SETTLED line and still selected\n${all}`);
});

test(`#3064.25bec8c3 --list: a settled suite the change reaches only through a Rust binary it starts is named on one SETTLED 1 line and leaves the selection; a selection that drops it without the line fails, naming it`, LONG, async (t) => {
  const box = sandbox(t);
  const fx = binaryFixture(box);
  writeList(box, listOf(fx, [S]));
  const out = await affected(box, fx, ['--list', 'crates/deep-fix/src/main.rs']);
  const all = dump(box, out);
  assert.equal(out.status, 0, `affected.mjs --list exited ${out.status}\n${all}`);
  // The change is the binary's crate, which is selected as today.
  assert.ok(out.stdout.split('\n').includes('parallel cargo test: deep-fix'), `the selection doesn't hold the changed crate, deep-fix, as today\n${all}`);
  assert.ok(leftNames(out, S), `${folderOf(S)} is on the settled list and the change reaches it only through the binary it starts, deep-fix, but no "SETTLED <n> …" line names it: ${selects(out, fileOf(S)) ? 'it is still selected' : 'the selection dropped it without the line'}\n${all}`);
  assert.deepEqual(left(out).map(({ count }) => count), [1], `the selection doesn't print one line "SETTLED 1 …" for the one suite it leaves (${folderOf(S)})\n${all}`);
  assert.ok(!selects(out, fileOf(S)), `${folderOf(S)} is named on the SETTLED line and still selected\n${all}`);
});

test(`#3064.25bec8c3 a run: the settled suite doesn't run, the run prints SETTLED 1 naming it and reads INCONCLUSIVE; a run that drops it without the line fails, naming it`, LONG, async (t) => {
  const box = sandbox(t);
  const fx = fixture(box);
  writeList(box, listOf(fx, [S]));
  const out = await affected(box, fx, [CHANGE]);
  const all = dump(box, out);
  // The run is judged on a real run: what no list names ran, and passed.
  for (const who of [...OTHERS, 'near']) assert.ok(ranOf(box, who).some(({ ok }) => ok), `${who === 'near' ? NEAR : folderOf(who)}, which the settled list doesn't name, didn't run and pass\n${all}`);
  assert.ok(leftNames(out, S), `${folderOf(S)} is on the settled list and the change reaches it only through the build it starts, but the run printed no "SETTLED <n> …" line naming it: ${ranOf(box, S).length ? 'it ran' : 'the run dropped it without the line'}\n${all}`);
  assert.deepEqual(left(out).map(({ count }) => count), [1], `the run doesn't print one line "SETTLED 1 …" for the one suite it leaves (${folderOf(S)})\n${all}`);
  assert.deepEqual(ranOf(box, S), [], `${folderOf(S)} is named on the SETTLED line and ran all the same\n${all}`);
  // Nothing unrun reads PASS.
  assert.match(summary(out), /^INCONCLUSIVE affected: /, `the run left ${folderOf(S)} unrun and doesn't read INCONCLUSIVE: its summary is "${summary(out)}"\n${all}`);
  assert.equal(out.status, 2, `the run left ${folderOf(S)} unrun and exited ${out.status}, not 2 as an INCONCLUSIVE run does\n${all}`);
});

test(`scope: --settled runs the settled suites too, as --wide runs the wide ones`, LONG, async (t) => {
  const box = sandbox(t);
  const fx = fixture(box);
  writeList(box, listOf(fx, [S]));
  const listed = await affected(box, fx, ['--list', CHANGE]);
  assert.ok(leftNames(listed, S) && !selects(listed, fileOf(S)), `without --settled, ${folderOf(S)} isn't left to the watch on a SETTLED line, so --settled has nothing to show\n${dump(box, listed)}`);
  const out = await affected(box, fx, ['--settled', CHANGE]);
  const all = dump(box, listed, out);
  assert.ok(ranOf(box, S).some(({ ok }) => ok), `--settled didn't run ${folderOf(S)}\n${all}`);
  assert.ok(!leftNames(out, S), `--settled ran ${folderOf(S)}, and a SETTLED line still names it as left to the watch\n${all}`);
});
