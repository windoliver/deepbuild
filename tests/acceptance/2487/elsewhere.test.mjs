// #2487, criterion 1, wherever the test lives: "a test tagged for an issue other than the one the change names" is
// any tagged test under the repo's test paths, not only one in the folder tests/acceptance/<its issue>/. Main holds
// three more test files here, each of two tests carrying #9350's tag, none under tests/acceptance/: a package's test
// folder, a test colocated with a package's source, and the top of tests/. A change naming #9044 deletes or weakens
// one with no approval tag; the guard must refuse it, a FAIL line naming the file. Reached by running this checkout's
// real `node scripts/proof.mjs guard` (README: The guard). Each case is its own top-level test, with no subtests.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { expectRefused, guardRepo, LONG, OTHER_TAG, sandbox } from './helpers.mjs';

const IN_PACKAGE_TESTS = 'packages/planted/test/held.test.ts';
const COLOCATED = 'packages/planted/src/held.test.ts';
const TOP_OF_TESTS = 'tests/held.test.mjs';

const STRICT = '  expect([3, 1, 2].slice()).toEqual([3, 1, 2]);';
const vitestLines = ['import { expect, test } from \'vitest\';', '',
  `test('${OTHER_TAG} holds the order it was given', () => {`, STRICT, '});', '',
  `test('${OTHER_TAG} holds an empty list empty', () => {`, '  expect([].slice()).toEqual([]);', '});', ''];
const vitestText = vitestLines.join('\n');
/** The colocated file with its first test's assertion weakened: the test stays, its name and tag too. */
const vitestWeakened = vitestLines.map((line) => (line === STRICT ? '  expect([3, 1, 2].slice()).toBeTruthy();' : line)).join('\n');

const nodeLines = ['import assert from \'node:assert/strict\';', 'import test from \'node:test\';', '',
  `test('${OTHER_TAG} holds the order it was given', () => {`, '  assert.deepEqual([3, 1, 2].slice(), [3, 1, 2]);', '});', '',
  `test('${OTHER_TAG} holds an empty list empty', () => {`, '  assert.deepEqual([].slice(), []);', '});', ''];
const nodeText = nodeLines.join('\n');
/** The file at the top of tests/ with its second test deleted; the first is left as it was. */
const nodeOneDeleted = `${nodeLines.slice(0, 6).join('\n')}\n`;

/**
 * helpers.mjs's scene, with the three files outside tests/acceptance/ added to main: one more commit, which names no
 * issue, and main and origin/main moved to it, so the change starts there and its own commits are the scene's.
 */
function sceneWithTestsElsewhere(t) {
  const box = sandbox(t);
  const scene = guardRepo(box);
  for (const [path, content] of [[IN_PACKAGE_TESTS, vitestText], [COLOCATED, vitestText], [TOP_OF_TESTS, nodeText]]) {
    mkdirSync(dirname(join(scene.cwd, path)), { recursive: true });
    writeFileSync(join(scene.cwd, path), content);
  }
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: scene.cwd, env: box.env, stdio: 'pipe', encoding: 'utf8' });
  git('add', '-A');
  git('commit', '-qm', 'base: tagged tests outside tests/acceptance/');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('branch', '-f', 'main', 'HEAD');
  return scene;
}

test('#2487.1131a9b0 a change naming #9044 that deletes a file of two tests tagged for #9350 from a package\'s test folder, with no approval tag, fails the guard, naming the file', LONG, async (t) => {
  const scene = sceneWithTestsElsewhere(t);
  scene.commit({ [IN_PACKAGE_TESTS]: null }, 'Remove a package test');
  expectRefused(await scene.guard(), `a deletion of ${IN_PACKAGE_TESTS}, with no tag,`, IN_PACKAGE_TESTS);
});

test('#2487.1131a9b0 a change naming #9044 that weakens the assertion of a test tagged for #9350 in a file colocated with a package\'s source, with no approval tag, fails the guard, naming the file', LONG, async (t) => {
  const scene = sceneWithTestsElsewhere(t);
  scene.commit({ [COLOCATED]: vitestWeakened }, 'Loosen a colocated test');
  expectRefused(await scene.guard(), `a changed tagged test of ${COLOCATED}, with no tag,`, COLOCATED);
});

test('#2487.1131a9b0 a change naming #9044 that deletes one of two tests tagged for #9350 from a file at the top of tests/, with no approval tag, fails the guard, naming the file', LONG, async (t) => {
  const scene = sceneWithTestsElsewhere(t);
  scene.commit({ [TOP_OF_TESTS]: nodeOneDeleted }, 'Drop a test');
  expectRefused(await scene.guard(), `a tagged test deleted from ${TOP_OF_TESTS}, with no tag,`, TOP_OF_TESTS);
});
