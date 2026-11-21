// #2487, criterion 1, "without its own approved proposal": the same edits of #9350's tagged tests, by a change that
// names #9044, pass the guard as their own commit under a signed approval tag naming what the commit carries, and a
// PASS line names the file, as the guard reports an edit it judged by an approved proposal. A guard that never looked
// at the file prints no such line, so it doesn't count as passing it (README: The guard).
import test from 'node:test';
import { expectPassed, guardRepo, KEPT, KEPT_TESTS, keptWeakened, LONG, sandbox, SOURCE, source, STAGED, STAGED_FIXTURES } from './helpers.mjs';

test('#2487.1131a9b0 the deletion of #9350\'s test file and fixtures, as its own commit of a change naming #9044 under a signed approval tag naming each file, passes the guard, by a PASS line naming the file', LONG, async (t) => {
  const scene = guardRepo(sandbox(t));
  scene.commit({ [SOURCE]: source(2) }, 'Change the answer');
  const deletion = scene.commit(Object.fromEntries([STAGED, ...STAGED_FIXTURES].map((path) => [path, null])), 'Remove the staged suite');
  scene.approve(deletion, [STAGED, ...STAGED_FIXTURES]);
  expectPassed(await scene.guard(), `a deletion of ${STAGED} under a signed tag naming it`, STAGED);
});

test('#2487.1131a9b0 the weakened test tagged for #9350, as its own commit of a change naming #9044 under a signed approval tag naming the test, passes the guard, by a PASS line naming the file', LONG, async (t) => {
  const scene = guardRepo(sandbox(t));
  const edit = scene.commit({ [KEPT]: keptWeakened }, 'Loosen a test');
  scene.approve(edit, [`${KEPT} › ${KEPT_TESTS[0]}`]);
  expectPassed(await scene.guard(), `a changed tagged test of ${KEPT} under a signed tag naming it`, KEPT);
});
