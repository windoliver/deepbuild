// #3064 AC3, its third case: a suite whose file differs from the listed tree is not settled and runs (README: What
// each file proves). The other two cases are the watch's, in watch.test.mjs.
import { test } from 'node:test';
import { CHANGE, LONG, affected, assert, dump, fileOf, fixture, folderOf, left, leftNames, listOf, ranOf, sandbox, suite, writeList } from './helpers.mjs';

const S = 90001, KEPT = 90002;

test(`#3064.a5a02f7e a suite whose file differs from the listed tree is not settled and runs; a list that admits it fails, naming the suite`, LONG, async (t) => {
  const box = sandbox(t);
  const fx = fixture(box);
  // The watch's list for the tree it ran, with S and KEPT settled.
  const list = listOf(fx, [S, KEPT]);
  writeList(box, list);
  // A landing since that tree edits S's test file. The change under test doesn't: it is package a's entry.
  fx.write({ [fileOf(S)]: `${suite(S)}// Edited since the listed tree.\n` });
  fx.git('commit', '-qam', 'A landing edits the suite of #90001');
  fx.git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const out = await affected(box, fx, [CHANGE]);
  const all = dump(box, out);
  assert.notEqual(fx.id(S), list.suites[folderOf(S)], `the fixture went wrong: ${folderOf(S)} is the folder the list names\n${all}`);
  assert.ok(ranOf(box, S).some(({ ok }) => ok), `${folderOf(S)} holds a file that differs from the listed tree (the list names its folder as ${list.suites[folderOf(S)]}, the disk holds ${fx.id(S)}) and didn't run: the list admitted it${leftNames(out, S) ? ' on a SETTLED line' : ''}\n${all}`);
  assert.ok(!leftNames(out, S), `${folderOf(S)}, whose file differs from the listed tree, ran, and a SETTLED line still names it as left to the watch\n${all}`);
  // KEPT holds the files the list names for it, so it is left: the list was in force when S ran.
  assert.ok(leftNames(out, KEPT) && !ranOf(box, KEPT).length, `the settled list wasn't in force in this run, so that ${folderOf(S)} ran shows nothing: ${folderOf(KEPT)}, which holds the files the list names, ${ranOf(box, KEPT).length ? 'ran' : 'is on no SETTLED line'}\n${all}`);
  assert.deepEqual(left(out).map(({ count }) => count), [1], `the run doesn't print one line "SETTLED 1 …" for the one suite it leaves (${folderOf(KEPT)})\n${all}`);
});
