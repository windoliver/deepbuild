// #3064 AC2: a settled suite S runs when the change names S's issue, edits a file of S, or is in S's own package. One
// test a case, each on a real run (README: What each file proves).
import { test } from 'node:test';
import { CHANGE, LONG, affected, assert, closed, dump, fileOf, fixture, folderOf, leftNames, listOf, ranOf, sandbox, selects, suite, writeList } from './helpers.mjs';

// S and KEPT are both on the list, and both start the build the change is in. KEPT is none of the three cases, so a
// run that leaves it to the watch shows the list was in force when S ran.
const S = 90001, KEPT = 90002;

/** S ran and passed and no SETTLED line names it; then KEPT, left to the watch, shows the rule was in force. */
function ranWhateverTheListSays(box, out, which, why) {
  const all = dump(box, out);
  assert.ok(ranOf(box, S).some(({ ok }) => ok), `${which}: ${why}, and ${folderOf(S)} didn't run${leftNames(out, S) ? ': a SETTLED line leaves it to the watch' : ''}\n${all}`);
  assert.ok(!leftNames(out, S), `${which}: ${folderOf(S)} ran, and a SETTLED line still names it as left to the watch\n${all}`);
  assert.ok(leftNames(out, KEPT) && !ranOf(box, KEPT).length, `${which}: the settled list wasn't in force in this run, so that ${folderOf(S)} ran shows nothing: ${folderOf(KEPT)}, on the list and none of the three cases, ${ranOf(box, KEPT).length ? 'ran' : 'is on no SETTLED line'}\n${all}`);
}

test(`#3064.1c658f8a names S's issue: a settled suite runs when the change's commit messages say Part of or Closes its issue; a selection that skips it fails, naming the case`, LONG, async (t) => {
  const which = `names S's issue`;
  const box = sandbox(t);
  const fx = fixture(box);
  for (const issue of [S, KEPT]) closed(box, issue);
  writeList(box, listOf(fx, [S, KEPT]));
  // The change: one commit over origin/main that edits package a's entry and names S's issue.
  fx.git('checkout', '-q', '-b', 'change');
  fx.write({ [CHANGE]: "console.log('hello from a');\n// The change.\n" });
  fx.git('commit', '-qam', `Greet as before\n\nPart of #${S}`);
  const out = await affected(box, fx, []);
  ranWhateverTheListSays(box, out, which, `the change's commit message says "Part of #${S}"`);
  // The other keyword the trace lane reads.
  fx.git('commit', '-q', '--amend', '-m', `Greet as before\n\nCloses #${S}`);
  const closes = await affected(box, fx, ['--list']);
  assert.ok(selects(closes, fileOf(S)) && !leftNames(closes, S), `${which}: the change's commit message says "Closes #${S}", and ${folderOf(S)} is ${leftNames(closes, S) ? 'left to the watch on a SETTLED line' : 'not selected'}\n${dump(box, closes)}`);
  // The same change naming no issue leaves S to the watch, so the message is what ran it.
  fx.git('commit', '-q', '--amend', '-m', 'Greet as before');
  const unnamed = await affected(box, fx, ['--list']);
  assert.ok(leftNames(unnamed, S) && !selects(unnamed, fileOf(S)), `${which}: the same change with no issue in its message doesn't leave ${folderOf(S)} to the watch, so its run above shows nothing about the message\n${dump(box, unnamed)}`);
});

test(`#3064.1c658f8a edits a file of S: a settled suite runs when the change adds or edits a file under its folder; a selection that skips it fails, naming the case`, LONG, async (t) => {
  const box = sandbox(t);
  const fx = fixture(box);
  writeList(box, listOf(fx, [S, KEPT]));
  // The paths stand for the change: package a's entry and S's test file. The disk still holds the files the list
  // names for S, so only the change's own edit can run it.
  const out = await affected(box, fx, [CHANGE, fileOf(S)]);
  ranWhateverTheListSays(box, out, 'edits a file of S', `the change's paths hold ${fileOf(S)}`);
});

test(`#3064.1c658f8a is in S's own package: a settled suite runs when the change is in a package whose files its tests import themselves; a selection that skips it fails, naming the case`, LONG, async (t) => {
  const box = sandbox(t);
  // S's test starts package a's build and also imports packages/a/src/util.mjs itself, with no process between. The
  // change is another file of package a, which reaches S only through the build.
  const fx = fixture(box, { suites: { [S]: suite(S, { own: true }), [KEPT]: suite(KEPT), 90003: suite(90003) } });
  writeList(box, listOf(fx, [S, KEPT]));
  const out = await affected(box, fx, [CHANGE]);
  ranWhateverTheListSays(box, out, `is in S's own package`, `${fileOf(S)} imports packages/a/src/util.mjs itself and the change is ${CHANGE}, in the same package`);
});
