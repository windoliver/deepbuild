// #3166 acceptance: one signed tag approves earlier commits of the change by `Approves: <item> @<sha>` lines.
// Every scenario is a scratch git repository run through this checkout's `node scripts/proof.mjs guard`; the tests
// read only its PASS guard: / FAIL guard: lines and its exit code. See README.md.
import test from 'node:test';
import { approve, hardware } from './authenticator.mjs';
import { BOUNDS, FIRST, SECOND, commit, fails, git, guard, loosen, note, passes, repository, says, skip } from './fixtures.mjs';

/** The criteria's change: two proposal commits, each editing a different tagged test. */
function twoProposals(t, list) {
  const w = repository(t, list);
  skip(w, FIRST);
  const first = commit(w, 'Propose skipping the first test');
  skip(w, SECOND);
  const second = commit(w, 'Propose skipping the second test');
  return { w, first, second };
}

test('#3166.b0866dde two proposal commits, each editing a different tagged test, pass the guard under one signed tag on the last commit holding an @<sha> line for each', (t) => {
  const person = hardware('person');
  const { w, first, second } = twoProposals(t, person.line);
  approve(w, person, [`${FIRST} @${first}`, `${SECOND} @${second}`], { on: second });
  passes(guard(t, w, 'one tag, a line for each commit'), 'one tag on the last commit approves both proposal commits', FIRST, SECOND);
});

test('#3166.5abaecb6 the first commit\'s test named with the second commit\'s ID, and the second\'s with the first\'s, lets neither edit through, and the guard names the first test', (t) => {
  const person = hardware('person');
  const { w, first, second } = twoProposals(t, person.line);
  approve(w, person, [`${FIRST} @${second}`, `${SECOND} @${first}`], { on: second });
  fails(guard(t, w, 'crossed lines'), 'a line approves its item for the commit it names alone', FIRST, SECOND);
});

test('#3166.9778b6a7 a line whose ID names a commit made after the tagged commit approves nothing, and the guard fails naming the edit', (t) => {
  const person = hardware('person');
  const w = repository(t, person.line);
  note(w);
  const tagged = commit(w, 'Ordinary work');
  skip(w, FIRST);
  const later = commit(w, 'Skip the first test, after the tagged commit');
  approve(w, person, [`${FIRST} @${later}`], { on: tagged });
  fails(guard(t, w, 'a commit made after the tagged commit'), 'the tagged commit does not descend from the commit the line names', FIRST);
});

test('#3166.9778b6a7 a line whose ID names a commit on another branch approves nothing, and the guard fails naming the edit', (t) => {
  const person = hardware('person');
  // A branch the change never holds: the tag sits on the edit's own commit and names the other branch's commit.
  const apart = repository(t, person.line);
  skip(apart, FIRST);
  const edit = commit(apart, 'Skip the first test');
  git(apart, 'checkout', '-q', '-b', 'other', 'main');
  skip(apart, FIRST);
  const elsewhere = commit(apart, 'The same skip, on another branch');
  git(apart, 'checkout', '-q', 'session/3166');
  approve(apart, person, [`${FIRST} @${elsewhere}`], { on: edit });
  const unmerged = guard(t, apart, 'a commit on a branch the change does not hold');
  // A branch the change merges after the tagged commit: its commit is the change's, and the tagged commit descends from none of it.
  const merged = repository(t, person.line);
  note(merged);
  const tagged = commit(merged, 'Ordinary work');
  git(merged, 'checkout', '-q', '-b', 'side', 'main');
  skip(merged, FIRST);
  const side = commit(merged, 'Skip the first test, on a side branch');
  git(merged, 'checkout', '-q', 'session/3166');
  git(merged, 'merge', '-q', '--no-ff', '-m', 'Merge the side branch', 'side');
  approve(merged, person, [`${FIRST} @${side}`], { on: tagged });
  const joined = guard(t, merged, 'a commit on a side branch merged after the tagged commit');
  fails(unmerged, 'a commit on another branch is no commit of the change', FIRST);
  fails(joined, 'the tagged commit does not descend from the side branch\'s commit', FIRST);
});

test('#3166.9778b6a7 a line whose ID is abbreviated to twelve digits approves nothing, and the guard fails naming the edit', (t) => {
  const person = hardware('person');
  const w = repository(t, person.line);
  skip(w, FIRST);
  const edit = commit(w, 'Skip the first test');
  note(w);
  const last = commit(w, 'Ordinary work');
  approve(w, person, [`${FIRST} @${edit.slice(0, 12)}`], { on: last });
  fails(guard(t, w, 'an ID abbreviated to twelve digits'), 'only a full commit ID approves', FIRST);
});

test('#3166.127971be the same tag unsigned approves nothing', (t) => {
  const person = hardware('person');
  const { w, first, second } = twoProposals(t, person.line);
  approve(w, null, [`${FIRST} @${first}`, `${SECOND} @${second}`], { on: second });
  fails(guard(t, w, 'the tag unsigned'), 'an unsigned tag approves nothing', FIRST, SECOND);
});

test('#3166.127971be the same tag signed by a key the approvers file doesn\'t list approves nothing', (t) => {
  const person = hardware('person'), outsider = hardware('outsider');
  const { w, first, second } = twoProposals(t, person.line);
  approve(w, outsider, [`${FIRST} @${first}`, `${SECOND} @${second}`], { on: second });
  fails(guard(t, w, 'the tag signed by an unlisted key'), 'a key the approvers file does not list approves nothing', FIRST, SECOND);
});

test('#3166.3b5fa948 a proposal commit approved by a later tag that also touches a file the tag doesn\'t name for it fails the guard, naming "the approved commit carries more than the files it names"', (t) => {
  const person = hardware('person');
  const w = repository(t, person.line);
  skip(w, FIRST);
  note(w, 'extra.txt');
  const wide = commit(w, 'Propose skipping the first test, with one more file');
  note(w);
  const last = commit(w, 'Ordinary work');
  approve(w, person, [`${FIRST} @${wide}`], { on: last });
  const r = guard(t, w, 'an over-wide proposal commit under a later tag');
  fails(r, 'a proposal commit touches only the files its approval names', FIRST);
  says(r, 'the over-wide commit is refused by name', 'the approved commit carries more than the files it names');
});

test('#3166.3acb8f5a a tag on a proposal commit with plain Approves: <item> lines passes as before', (t) => {
  const person = hardware('person');
  const w = repository(t, person.line);
  skip(w, FIRST);
  skip(w, SECOND);
  const proposal = commit(w, 'Propose skipping both tests');
  approve(w, person, [FIRST, SECOND], { on: proposal });
  passes(guard(t, w, 'plain lines on the proposal commit'), 'a line with no @<sha> approves its item for the tagged commit', FIRST, SECOND);
});

test('#3166.b04433e1 a tolerance raised in place fails even when a later tag approves it', (t) => {
  const person = hardware('person');
  const w = repository(t, person.line);
  loosen(w);
  const raise = commit(w, 'Propose a looser bound');
  note(w);
  const last = commit(w, 'Ordinary work');
  approve(w, person, [`${BOUNDS} @${raise}`], { on: last });
  fails(guard(t, w, 'a tolerance raised in place under a later tag'), 'an edit refused even as an approved proposal stays refused', BOUNDS);
});
