// #3593 criterion 3, two of its three cases: a suite off the list, and one whose folder differs from the listed tree,
// run however the change reaches them, here by import (README: What each file proves). The third case, a suite of an
// open issue, is the watch's, in watch.test.mjs.
import { test } from 'node:test';
import { IMPORTED, LONG, affected, assert, dump, fileOf, folderOf, imported, importFixture, left, leftNames, listOf, ranOf, sandbox, writeList } from './helpers.mjs';

const S = 90001, KEPT = 90002;

/** KEPT holds the files the list names for it and is reached only by import, so it is left: the rule was in force. */
function keptLeft(box, out, why) {
  const all = dump(box, out);
  assert.ok(leftNames(out, KEPT) && !ranOf(box, KEPT).length, `the wider settled rule wasn't in force in this run, so that ${folderOf(S)} ran shows nothing: ${folderOf(KEPT)}, ${why}, ${ranOf(box, KEPT).length ? 'ran' : 'is on no SETTLED line'}\n${all}`);
  assert.deepEqual(left(out).map(({ count }) => count), [1], `the run doesn't print one line "SETTLED 1 …" for the one suite it leaves (${folderOf(KEPT)})\n${all}`);
}

test(`#3593.24d41793 a suite off the settled list runs when the change reaches it by import; a list that admits it fails, naming the suite`, LONG, async (t) => {
  const box = sandbox(t);
  const fx = importFixture(box);
  // The list holds KEPT alone. S imports the same changed file and is on no list.
  writeList(box, listOf(fx, [KEPT]));
  const out = await affected(box, fx, [IMPORTED]);
  const all = dump(box, out);
  assert.ok(ranOf(box, S).some(({ ok }) => ok), `${folderOf(S)} is off the settled list and the change reaches it by an import of ${IMPORTED}, and it didn't run: the list admitted it${leftNames(out, S) ? ' on a SETTLED line' : ''}\n${all}`);
  assert.ok(!leftNames(out, S), `${folderOf(S)}, off the settled list, ran, and a SETTLED line still names it as left to the watch\n${all}`);
  keptLeft(box, out, `on the list and reached by the same import`);
});

test(`#3593.24d41793 a suite whose folder differs from the listed tree runs when the change reaches it by import; a list that admits it fails, naming the suite`, LONG, async (t) => {
  const box = sandbox(t);
  const fx = importFixture(box);
  // The watch's list for the tree it ran, with S and KEPT settled.
  const list = listOf(fx, [S, KEPT]);
  writeList(box, list);
  // A landing since that tree edits S's test file. The change under test doesn't: it is the imported package file.
  fx.write({ [fileOf(S)]: `${imported(S)}// Edited since the listed tree.\n` });
  fx.git('commit', '-qam', 'A landing edits the first suite');
  fx.git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const out = await affected(box, fx, [IMPORTED]);
  const all = dump(box, out);
  assert.notEqual(fx.id(S), list.suites[folderOf(S)], `the fixture went wrong: ${folderOf(S)} is the folder the list names\n${all}`);
  assert.ok(ranOf(box, S).some(({ ok }) => ok), `${folderOf(S)} holds a file that differs from the listed tree (the list names its folder as ${list.suites[folderOf(S)]}, the disk holds ${fx.id(S)}), the change reaches it by an import of ${IMPORTED}, and it didn't run: the list admitted it${leftNames(out, S) ? ' on a SETTLED line' : ''}\n${all}`);
  assert.ok(!leftNames(out, S), `${folderOf(S)}, whose folder differs from the listed tree, ran, and a SETTLED line still names it as left to the watch\n${all}`);
  keptLeft(box, out, `which holds the files the list names and is reached by the same import`);
});
