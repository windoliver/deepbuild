// Criterion 5 of #3507 (#3507.25e79c7f): "No acceptance test is edited"
//
// Every file under tests/acceptance/ that the merge base holds is, in this checkout, as the merge base has it: `git
// diff --name-status --no-renames <merge base> -- tests/acceptance` (the working tree against `git merge-base HEAD
// origin/main`, so an edit not yet committed counts) lists additions only. A file that is edited, deleted or changed
// in type fails, naming it (`editedProblems`); a file added, this suite's own among them, is no edit.
//
// What this adds to the edit guard (design: The edit guard): the guard lets an edit through when it comes as a signed
// approved proposal; this criterion lets none through. It passes at the merge base, where nothing differs. That it can
// fail was shown on planted lists of changes in this suite's scratch checks (README: What was checked): an `M`, a `D`
// and a `T` line each fail, naming the file.
// Run: node --test tests/acceptance/3507/ac5-unedited.test.mjs
import test from 'node:test';
import { changedSince, mergeBaseCommit, settle } from './drive.mjs';
import { editedProblems } from './judge.mjs';

test('AC5 #3507.25e79c7f no acceptance test is edited: every file under tests/acceptance/ that the merge base holds is as the merge base has it', (t) => {
  const base = mergeBaseCommit();
  const changes = changedSince(base, 'tests/acceptance');
  const lines = changes.split('\n').filter((l) => l.trim() !== '');
  t.diagnostic(`against the merge base ${base.slice(0, 9)}: ${lines.length} files under tests/acceptance/ differ, ${lines.filter((l) => l.startsWith('A\t')).length} of them added`);
  settle('AC5 #3507.25e79c7f', editedProblems(changes));
});
