// #2487, criterion 1, the refusals: a change whose commit messages name one issue (#9044) and that deletes or changes
// a test tagged for another (#9350) fails the guard when the edit has no approved proposal of its own, and a FAIL line
// names the test's file. Reached by running this checkout's real `node scripts/proof.mjs guard` in scratch
// repositories (README: The guard). Each case is its own top-level test, with no subtests.
import test from 'node:test';
import { expectRefused, guardRepo, KEPT, keptOneDeleted, keptWeakened, LONG, sandbox, SOURCE, source, STAGED, STAGED_FIXTURES } from './helpers.mjs';

const GONE = Object.fromEntries([STAGED, ...STAGED_FIXTURES].map((path) => [path, null]));

test('#2487.1131a9b0 a change naming #9044 whose second of three commits deletes #9350\'s test file of four tagged tests and its three fixtures, with no approval tag, fails the guard, naming the file', LONG, async (t) => {
  const scene = guardRepo(sandbox(t));
  scene.commit({ [SOURCE]: source(2) }, 'Change the answer');
  scene.commit(GONE, 'Remove the staged suite');
  scene.commit({ [SOURCE]: source(3) }, 'Change the answer again');
  expectRefused(await scene.guard(), `a deletion of ${STAGED} and its fixtures, with no tag,`, STAGED);
});

test('#2487.1131a9b0 a change naming #9044 that weakens the assertion of a test tagged for #9350, with no approval tag, fails the guard, naming the file', LONG, async (t) => {
  const scene = guardRepo(sandbox(t));
  scene.commit({ [KEPT]: keptWeakened }, 'Loosen a test');
  expectRefused(await scene.guard(), `a changed tagged test of ${KEPT}, with no tag,`, KEPT);
});

test('#2487.1131a9b0 a change that says Closes #9044 and deletes one of two tests tagged for #9350 from their file, with no approval tag, fails the guard, naming the file', LONG, async (t) => {
  const scene = guardRepo(sandbox(t));
  scene.commit({ [KEPT]: keptOneDeleted }, 'Drop a test', 'Closes');
  expectRefused(await scene.guard(), `a tagged test deleted from ${KEPT}, with no tag,`, KEPT);
});

test('#2487.1131a9b0 the deletion of #9350\'s test file and fixtures, as its own commit under an unsigned approval tag naming each file, fails the guard, naming the file', LONG, async (t) => {
  const scene = guardRepo(sandbox(t));
  const deletion = scene.commit(GONE, 'Remove the staged suite');
  scene.approve(deletion, [STAGED, ...STAGED_FIXTURES], null);
  expectRefused(await scene.guard(), `a deletion of ${STAGED} under an unsigned tag`, STAGED);
});

test('#2487.1131a9b0 the deletion of #9350\'s test file and fixtures in a commit that also changes other code, under a signed approval tag naming the deleted files, fails the guard, naming the file', LONG, async (t) => {
  const scene = guardRepo(sandbox(t));
  const mixed = scene.commit({ ...GONE, [SOURCE]: source(2) }, 'Remove the staged suite and change the answer');
  scene.approve(mixed, [STAGED, ...STAGED_FIXTURES]);
  expectRefused(await scene.guard(), `a deletion of ${STAGED} in a commit that is not its own proposal`, STAGED);
});
