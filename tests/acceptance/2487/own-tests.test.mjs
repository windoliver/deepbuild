// #2487, criterion 2: a change that names its issue (#9044) and edits only that issue's untagged tests, or adds
// tests, still passes the guard with no approval tag, while main holds another issue's (#9350) tagged tests, which the
// change leaves alone. Reached by running this checkout's real `node scripts/proof.mjs guard` in scratch repositories.
// These pass on the base too, as they must after the fix; a planted wrong program that refuses every edit of a test
// file is what they fail on (README: On the base; twins.json).
import test from 'node:test';
import { ADDED, addedText, expectPassed, guardRepo, LONG, MINE, mineEdited, mineOneDeleted, mineWithTagged, sandbox, SOURCE, source } from './helpers.mjs';

test('#2487.8f2af318 a change naming #9044 that changes a line of its own issue\'s untagged test, and the code it reads, passes the guard with no approval tag', LONG, async (t) => {
  const scene = guardRepo(sandbox(t));
  scene.commit({ [SOURCE]: source(2) }, 'Change the answer');
  scene.commit({ [MINE]: mineEdited }, 'Expect the new answer');
  expectPassed(await scene.guard(), `an edit of an untagged test of ${MINE}, with no tag,`);
});

test('#2487.8f2af318 a change naming #9044 that deletes one of its own issue\'s untagged tests passes the guard with no approval tag', LONG, async (t) => {
  const scene = guardRepo(sandbox(t));
  scene.commit({ [MINE]: mineOneDeleted }, 'Drop an untagged test');
  expectPassed(await scene.guard(), `an untagged test deleted from ${MINE}, with no tag,`);
});

test('#2487.8f2af318 a change naming #9044 that adds a test file whose tests carry #9044\'s tag passes the guard with no approval tag', LONG, async (t) => {
  const scene = guardRepo(sandbox(t));
  scene.commit({ [ADDED]: addedText(true) }, 'Add the issue\'s tests');
  expectPassed(await scene.guard(), `an added file of tagged tests, ${ADDED}, with no tag,`);
});

test('#2487.8f2af318 a change naming #9044 that adds a test carrying #9044\'s tag beside its own issue\'s untagged tests passes the guard with no approval tag', LONG, async (t) => {
  const scene = guardRepo(sandbox(t));
  scene.commit({ [MINE]: mineWithTagged }, 'Add a tagged test');
  expectPassed(await scene.guard(), `a tagged test added to ${MINE}, with no tag,`);
});

test('#2487.8f2af318 a change naming #9044 that adds an untagged test file in one commit and edits it in the next passes the guard with no approval tag', LONG, async (t) => {
  const scene = guardRepo(sandbox(t));
  scene.commit({ [ADDED]: addedText(false) }, 'Add tests');
  scene.commit({ [ADDED]: addedText(false, 2), [SOURCE]: source(2) }, 'Change the answer and the tests it added');
  expectPassed(await scene.guard(), `an edit of an untagged test the change added, ${ADDED}, with no tag,`);
});
