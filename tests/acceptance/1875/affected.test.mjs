// #1875: affected.mjs reads PASS only when it ran what the change reaches. A selected file it leaves to a person
// (byHand) or to a lane of its own (ownLane) makes the run INCONCLUSIVE, naming it, and a change to the setup file
// vitest.config.ts names reads as one that feeds every suite. Reached by running `node scripts/affected.mjs <paths>`
// in a scratch tree holding this checkout's scripts (README: The affected.mjs tree).
import assert from 'node:assert/strict';
import test from 'node:test';
import { CHECKOUT, affected, affectedTree, dump, fileIn, inconclusive, lanesLists, mergeBaseScripts, probe, real, sandbox, summary } from './helpers.mjs';

const PLAIN = 'tests/fixture-1875/plain.test.mjs';
const SETUP = 'tests/vitest-setup.ts';
// The setup's own test, as the repo's names it: by its path, so a change to the setup selects it.
const SETUP_TEST = 'tests/vitest-setup.test.mjs';
const setupFiles = {
  'vitest.config.ts': real('vitest.config.ts'),
  [SETUP]: real(SETUP),
  [SETUP_TEST]: `// The probe for ${SETUP}, named by its path.\n${probe('the setup probe passes')}`,
};

/** A run on `path` alone must read INCONCLUSIVE, exit non-zero, and name `path` on an INCONCLUSIVE line. */
async function unrunReadsInconclusive(t, list, entry) {
  assert.ok(lanesLists(CHECKOUT)[list].includes(entry), `lanes.mjs ${list} no longer holds ${entry}`);
  const box = sandbox(t);
  const path = fileIn(entry);
  const tree = affectedTree(box, { [path]: probe(`the ${list} probe passes`) });
  const listing = await affected(box, tree, ['--list', path]);
  assert.ok(listing.stdout.includes(path), `affected.mjs --list does not select ${path}, so the change does not reach it\n${dump(listing)}`);
  const run = await affected(box, tree, [path]);
  assert.match(summary(run.stdout), /^INCONCLUSIVE affected: /, `a change reaching only ${path} (in ${list}) does not read INCONCLUSIVE\n${dump(run)}`);
  assert.notEqual(run.status, 0, `a change reaching only ${path} exited 0\n${dump(run)}`);
  assert.ok(inconclusive(run.stdout).some((line) => line.includes(path)), `no INCONCLUSIVE line names ${path}\n${dump(run)}`);
}

test('#1875.801bc708 a change that reaches only a file in byHand, one under tests/acceptance/685/, reads INCONCLUSIVE, naming the file', async (t) => {
  await unrunReadsInconclusive(t, 'byHand', 'tests/acceptance/685/');
});

test('#1875.f6c302f9 a change that reaches only a file in ownLane reads INCONCLUSIVE, naming it', async (t) => {
  // Its first entry, as lanes.mjs holds it at the base: tests/acceptance/684/lean.test.ts.
  await unrunReadsInconclusive(t, 'ownLane', lanesLists(CHECKOUT).ownLane[0]);
});

test('#1875.e267e730 a change to tests/vitest-setup.ts prints INCONCLUSIVE tests/vitest-setup.ts feeds every suite; on main it selects one file', async (t) => {
  const box = sandbox(t);
  // Before: the merge base's scripts select the setup's one test for it.
  const before = affectedTree(box, setupFiles, { scripts: mergeBaseScripts(box), name: 'before' });
  const listing = await affected(box, before, ['--list', SETUP]);
  const selected = listing.stdout.split('\n').filter((line) => /^(?:parallel|alone|timed|slow) (?:vitest|node): /.test(line)).flatMap((line) => line.replace(/^[^:]+: /, '').split(' '));
  assert.deepEqual(selected, [SETUP_TEST], `on main, a change to ${SETUP} does not select one file\n${dump(listing)}`);
  // After: this checkout's scripts.
  const tree = affectedTree(box, setupFiles);
  const run = await affected(box, tree, [SETUP]);
  const line = `INCONCLUSIVE ${SETUP} feeds every suite`;
  assert.ok(run.stdout.split('\n').some((each) => each.startsWith(line)), `a change to ${SETUP} does not print "${line}"\n${dump(run)}`);
  assert.match(summary(run.stdout), /^INCONCLUSIVE affected: /, `a change to ${SETUP} does not read INCONCLUSIVE\n${dump(run)}`);
  assert.notEqual(run.status, 0, dump(run));
});

test('#1875.aeda0f53 a change that reaches no by-hand, own-lane, timed or slow file can still read PASS', async (t) => {
  const box = sandbox(t);
  const tree = affectedTree(box, { [PLAIN]: probe('the plain probe passes') });
  const run = await affected(box, tree, [PLAIN]);
  assert.match(summary(run.stdout), /^PASS affected: .* 1 passed/, `a change reaching only the plain file ${PLAIN} does not read PASS with it passed\n${dump(run)}`);
  assert.equal(run.status, 0, dump(run));
  assert.deepEqual(inconclusive(run.stdout), [], `a run with nothing unrun printed INCONCLUSIVE lines\n${dump(run)}`);
});
