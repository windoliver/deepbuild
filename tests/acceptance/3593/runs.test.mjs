// #3593 criterion 2: a settled suite S that the change reaches by import still runs when the change names S's issue,
// adds or edits a file under S, or edits a file a test of S reads by path. One test a case, the add and the edit
// apart (README: What each file proves).
import { test } from 'node:test';
import { IMPORTED, LONG, READ, affected, assert, closed, dump, fileOf, folderOf, importFixture, imported, leftNames, listOf, ranOf, sandbox, selects, suite, writeList } from './helpers.mjs';

// S and KEPT are both on the list, and both import the changed package file themselves. KEPT is none of the three
// cases, so a run that leaves it to the watch shows the list, and the wider rule, were in force when S ran.
const S = 90001, KEPT = 90002;

/** S ran and passed and no SETTLED line names it; then KEPT, left to the watch, shows the rule was in force. */
function ranWhateverTheListSays(box, out, which, why) {
  const all = dump(box, out);
  assert.ok(ranOf(box, S).some(({ ok }) => ok), `${which}: ${why}, and ${folderOf(S)} didn't run${leftNames(out, S) ? ': a SETTLED line leaves it to the watch' : ''}\n${all}`);
  assert.ok(!leftNames(out, S), `${which}: ${folderOf(S)} ran, and a SETTLED line still names it as left to the watch\n${all}`);
  keptLeft(box, out, which, ranOf(box, KEPT).length > 0);
}
/** KEPT, on the list and reached only by import, is left on a SETTLED line and not run or selected. */
function keptLeft(box, out, which, ran) {
  assert.ok(leftNames(out, KEPT) && !ran, `${which}: the wider settled rule wasn't in force here, so that ${folderOf(S)} ran shows nothing: ${folderOf(KEPT)}, on the list, reached only by an import of ${IMPORTED} and none of the three cases, ${ran ? 'ran' : 'is on no SETTLED line'}\n${dump(box, out)}`);
}

test(`#3593.0f5c9115 names S's issue: a settled suite the change reaches by import runs when the change's commit messages say Part of or Closes its issue; a selection that leaves it fails, naming the case`, LONG, async (t) => {
  const which = `names S's issue`;
  const box = sandbox(t);
  const fx = importFixture(box);
  for (const issue of [S, KEPT]) closed(box, issue);
  writeList(box, listOf(fx, [S, KEPT]));
  // The change: one commit over origin/main that edits the imported file and names S's issue.
  fx.git('checkout', '-q', '-b', 'change');
  fx.write({ [IMPORTED]: "export const shout = (text) => text.toUpperCase();\n// The change.\n" });
  fx.git('commit', '-qam', `Shout as before\n\nPart of #${S}`);
  const out = await affected(box, fx, []);
  ranWhateverTheListSays(box, out, which, `the change's commit message says "Part of #${S}"`);
  // The other keyword the trace lane reads.
  fx.git('commit', '-q', '--amend', '-m', `Shout as before\n\nCloses #${S}`);
  const closes = await affected(box, fx, ['--list']);
  assert.ok(selects(closes, fileOf(S)) && !leftNames(closes, S), `${which}: the change's commit message says "Closes #${S}", and ${folderOf(S)} is ${leftNames(closes, S) ? 'left to the watch on a SETTLED line' : 'not selected'}\n${dump(box, closes)}`);
  keptLeft(box, closes, which, selects(closes, fileOf(KEPT)));
  // The same change naming no issue leaves S to the watch, so the message is what ran it.
  fx.git('commit', '-q', '--amend', '-m', 'Shout as before');
  const unnamed = await affected(box, fx, ['--list']);
  assert.ok(leftNames(unnamed, S) && !selects(unnamed, fileOf(S)), `${which}: the same change with no issue in its message doesn't leave ${folderOf(S)} to the watch, so its run above shows nothing about the message\n${dump(box, unnamed)}`);
});

test(`#3593.0f5c9115 edits a file under S: a settled suite the change reaches by import runs when the change edits a file under its folder; a selection that leaves it fails, naming the case`, LONG, async (t) => {
  const box = sandbox(t);
  const fx = importFixture(box);
  writeList(box, listOf(fx, [S, KEPT]));
  // The paths stand for the change: the imported file and S's test file. The disk still holds the files the list
  // names for S, so only the change's own edit can run it.
  const out = await affected(box, fx, [IMPORTED, fileOf(S)]);
  ranWhateverTheListSays(box, out, 'edits a file under S', `the change's paths hold ${fileOf(S)}`);
});

test(`#3593.0f5c9115 adds a file under S: a settled suite the change reaches by import runs when the change adds a file under its folder; a selection that leaves it fails, naming the case`, LONG, async (t) => {
  const which = 'adds a file under S';
  const box = sandbox(t);
  const fx = importFixture(box);
  // The added file: a second test file of S, which imports the changed file too. The list names S's folder as it is
  // with the added file, so the folder's ID can't be what runs it: only the change's add can.
  const added = `tests/acceptance/${S}/added.test.mjs`, addedRun = `${S}-added`;
  fx.write({ [added]: imported(addedRun) });
  fx.git('add', '-A');
  fx.git('commit', '-qm', 'A second test file for the first suite');
  writeList(box, listOf(fx, [S, KEPT]));
  const out = await affected(box, fx, [IMPORTED, added]);
  ranWhateverTheListSays(box, out, which, `the change's paths hold ${added}, a file it adds under ${folderOf(S)}`);
  assert.ok(ranOf(box, addedRun).some(({ ok }) => ok), `${which}: the file the change adds under ${folderOf(S)}, ${added}, didn't run\n${dump(box, out)}`);
});

test(`#3593.0f5c9115 edits a file S reads by path: a settled suite runs when the change edits a file a test of S reads by path; a selection that leaves it fails, naming the case`, LONG, async (t) => {
  const which = 'edits a file S reads by path';
  const box = sandbox(t);
  // S's test imports util.mjs and also reads packages/a/greeting.txt by path. KEPT only imports util.mjs.
  const fx = importFixture(box, { [S]: imported(S, { reads: true }), [KEPT]: imported(KEPT), 90003: suite(90003) });
  writeList(box, listOf(fx, [S, KEPT]));
  const out = await affected(box, fx, [IMPORTED, READ]);
  ranWhateverTheListSays(box, out, which, `${fileOf(S)} reads ${READ} by path and the change's paths hold it`);
});
