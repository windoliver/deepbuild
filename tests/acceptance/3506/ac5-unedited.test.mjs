// Criterion 5 of #3506 (#3506.25e79c7f): "No acceptance test is edited"
//
// Every file under tests/acceptance/ that the merge base holds is, in this checkout, as the merge base has it: `git
// diff --name-status --no-renames <merge base> -- tests/acceptance` (the working tree against `git merge-base HEAD
// origin/main`, so an edit not yet committed counts) lists additions only. A file edited, deleted or changed in type
// fails, naming it (#3507's `editedProblems`, the same words' judge); a file added, this suite's own among them, is no
// edit. It passes at the merge base, where nothing differs.
// Run: node --test tests/acceptance/3506/ac5-unedited.test.mjs
import test from 'node:test';
import { editedProblems } from '../3507/judge.mjs';
import { changedSince, mergeBaseCommit, settle } from './drive.mjs';
import { AC } from './judge.mjs';

test(`AC5 ${AC[5]} no acceptance test is edited: every file under tests/acceptance/ that the merge base holds is as the merge base has it`, (t) => {
  const base = mergeBaseCommit();
  const lines = changedSince(base, 'tests/acceptance').split('\n').filter((l) => l.trim() !== '');
  t.diagnostic(`against the merge base ${base.slice(0, 9)}: ${lines.length} files under tests/acceptance/ differ, ${lines.filter((l) => l.startsWith('A\t')).length} of them added`);
  settle(`AC5 ${AC[5]}`, editedProblems(lines.join('\n')));
});
