import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { CHECKOUT, LONG, gitHere, coveredBy, listedIn, mergeBase, movesOfCheckout, movesOfPlant, movesSinceMergeBase, scratchFolder, scratchRepo, sendsToByHand, shownLines, testFilesAt, unlistedSuite } from './helpers.mjs';

const REDRAFT = 'tests/acceptance/3066-redraft-3699/';

function subjectsOf(t) {
  const { was, is, lists, redrafted } = movesSinceMergeBase(t);
  const steady = Object.keys(is).filter((file) => file.startsWith('tests/acceptance/') && !file.startsWith(REDRAFT) && is[file]?.startsWith('parallel/') && was[file] === is[file] && !Object.keys(redrafted).some((key) => coveredBy(key, file))).sort();
  const lone = lists.alone.filter((entry) => !entry.endsWith('/') && is[entry]?.startsWith('alone/') && was[entry] === is[entry] && !listedIn(lists.exclusive, entry) && !lists.alone.some((other) => other !== entry && listedIn([other], entry))).sort();
  const byHandFiles = lists.byHand.filter((entry) => !entry.endsWith('/') && testFilesAt(CHECKOUT, entry).length).sort();
  const byHandFolders = lists.byHand.filter((entry) => entry.endsWith('/') && testFilesAt(CHECKOUT, entry).length).sort();
  assert.ok(steady.length >= 5 && lone.length && byHandFiles.length && byHandFolders.length, `this checkout's lanes hold too few subjects to plant: ${steady.length} steady parallel files, ${lone.length} lone alone files, ${byHandFiles.length} by-hand files, ${byHandFolders.length} by-hand folders`);
  const [STAYS, TO_ALONE, TO_BY_HAND, TO_NO_TEST, TO_NO_TEST_FOLDER] = steady;
  return { STAYS, TO_ALONE, TO_BY_HAND, UNMAPPED: TO_BY_HAND, TO_MISSING: TO_BY_HAND, TO_NO_TEST, TO_NO_TEST_FOLDER, TO_PARALLEL: lone[0], BY_HAND_FILE: byHandFiles[0], BY_HAND_FOLDER: byHandFolders[0] };
}

const runnerOf = (block) => block.split('/')[1];

test("#3066.4268aebb scripts/known-failures.json names the same failures as on the merge base: the same test IDs, lint findings, timing IDs and skips", () => {
  const ids = (text) => {
    const { failures = {}, lint = {}, timing = [], skips = [] } = JSON.parse(text);
    return { failures: Object.keys(failures).sort(), lint: Object.entries(lint).map(([key, count]) => `${key} (${count})`).sort(), timing: [...timing].sort(), skips: skips.map(({ id }) => id).sort() };
  };
  const before = ids(gitHere('show', `${mergeBase()}:scripts/known-failures.json`));
  const after = ids(readFileSync(join(CHECKOUT, 'scripts/known-failures.json'), 'utf8'));
  assert.ok(before.failures.length + before.lint.length > 0, "the merge base's scripts/known-failures.json names no failure, so the comparison is empty");
  assert.deepEqual(after, before, "scripts/known-failures.json does not name the failures the merge base's names");
});

test("#3066.4268aebb #3699.c037e2f6 every test file of the merge base still runs where it ran, moved only between the alone and parallel blocks or to by hand in the place of a blind redraft that redrafted maps it to and this checkout holds", LONG, (t) => {
  const { was, moves } = movesSinceMergeBase(t);
  const counted = Object.values(was);
  assert.ok(counted.length > 1000 && counted.some((block) => block?.startsWith('alone/')) && counted.some((block) => block?.startsWith('parallel/')), `the merge base's lanes place too few files to compare: ${counted.length}`);
  assert.deepEqual(moves.map(({ line }) => line), [], `${moves.length} test files of the merge base no longer run where they ran\n${shownLines(moves)}`);

  const { STAYS, TO_ALONE, TO_BY_HAND, TO_PARALLEL } = subjectsOf(t);
  const plant = movesOfPlant(t, [STAYS, TO_ALONE, TO_BY_HAND, TO_PARALLEL], [
    `alone.push(${JSON.stringify(TO_ALONE)});`,
    `if (alone.includes(${JSON.stringify(TO_PARALLEL)})) alone.splice(alone.indexOf(${JSON.stringify(TO_PARALLEL)}), 1);`,
    ...sendsToByHand(TO_BY_HAND, REDRAFT),
  ]);
  const moved = (file) => `${plant.was[file]} -> ${plant.is[file]}`;
  assert.deepEqual([STAYS, TO_ALONE, TO_PARALLEL, TO_BY_HAND].map((file) => `${file}: ${moved(file)}`), [
    `${STAYS}: ${plant.was[STAYS]} -> ${plant.was[STAYS]}`,
    `${TO_ALONE}: ${plant.was[TO_ALONE]} -> alone/${runnerOf(plant.was[TO_ALONE])}`,
    `${TO_PARALLEL}: ${plant.was[TO_PARALLEL]} -> parallel/${runnerOf(plant.was[TO_PARALLEL])}`,
    `${TO_BY_HAND}: ${plant.was[TO_BY_HAND]} -> skipped/by hand`,
  ], 'the planted moves did not place the files as planted, so the check was not given the moves it is for');
  assert.deepEqual(plant.moves.map(({ line }) => line), [], `the check refused a move it allows\n${shownLines(plant.moves)}`);
});

test("#3066.4268aebb #3699.79b40a54 a test file of the merge base that moves to by hand with no redrafted entry fails the check, naming the file", LONG, (t) => {
  const { moves } = movesSinceMergeBase(t);
  const unmapped = moves.filter(({ why }) => why === 'no redrafted entry');
  assert.deepEqual(unmapped.map(({ file }) => file), [], `${unmapped.length} test files of the merge base moved to by hand with no redrafted entry\n${shownLines(unmapped)}`);
  const { UNMAPPED } = subjectsOf(t);

  const plant = movesOfPlant(t, [UNMAPPED], sendsToByHand(UNMAPPED));
  assert.equal(plant.is[UNMAPPED], 'skipped/by hand', `the plant did not send ${UNMAPPED} to by hand: ${plant.is[UNMAPPED]}`);
  assert.deepEqual(plant.moves.map(({ file, why }) => `${file}: ${why}`), [`${UNMAPPED}: no redrafted entry`], `the check did not fail ${UNMAPPED}, sent to by hand with no redrafted entry, by name\n${shownLines(plant.moves)}`);
});

test("#3066.4268aebb #3699.f7548a54 a test file of the merge base that moves to by hand while its redrafted entry names a missing path, or a path holding no test file, fails the check, naming the file", LONG, (t) => {
  const { moves } = movesSinceMergeBase(t);
  const misplaced = moves.filter(({ why }) => why === 'redraft missing' || why === 'redraft holds no test file');
  assert.deepEqual(misplaced.map(({ file }) => file), [], `${misplaced.length} test files of the merge base moved to by hand in the place of a redraft this checkout does not hold\n${shownLines(misplaced)}`);

  const { TO_MISSING, TO_NO_TEST, TO_NO_TEST_FOLDER } = subjectsOf(t);
  const missing = 'tests/acceptance/3066-redraft-3699-missing/';
  const noTest = `${REDRAFT}README.md`;
  const noTestFolder = `${REDRAFT}wrong-checks/`;
  const plant = movesOfPlant(t, [TO_MISSING, TO_NO_TEST, TO_NO_TEST_FOLDER], [...sendsToByHand(TO_MISSING, missing), ...sendsToByHand(TO_NO_TEST, noTest), ...sendsToByHand(TO_NO_TEST_FOLDER, noTestFolder)]);
  assert.deepEqual([TO_MISSING, TO_NO_TEST, TO_NO_TEST_FOLDER].map((file) => plant.is[file]), ['skipped/by hand', 'skipped/by hand', 'skipped/by hand'], 'the plant did not send all three files to by hand');
  assert.deepEqual(plant.moves.map(({ file, why }) => `${file}: ${why}`).sort(), [`${TO_MISSING}: redraft missing`, `${TO_NO_TEST}: redraft holds no test file`, `${TO_NO_TEST_FOLDER}: redraft holds no test file`].sort(), `the check did not fail by name each file sent to by hand in the place of a redraft this checkout does not hold\n${shownLines(plant.moves)}`);
});

test("#3066.4268aebb #3699.2b06b98e a checkout equal to its merge base passes the place check when the merge base's lane.json files name timed and slow files", LONG, (t) => {
  const folder = unlistedSuite(movesSinceMergeBase(t));
  const timedFile = `${folder}/budgets.test.ts`, slowFile = `${folder}/build.test.ts`, aloneFile = `${folder}/plain.test.ts`;
  const body = "import { test } from 'vitest';\ntest('runs', () => {});\n";
  const repo = scratchRepo(t, {
    [`${folder}/lane.json`]: `${JSON.stringify({ alone: true, why: 'timing: budgets.test.ts times a run', timed: ['budgets.test.ts'], slow: ['build.test.ts'] })}\n`,
    [timedFile]: body,
    [slowFile]: body,
    [aloneFile]: body,
  });
  const reading = movesOfCheckout(t, repo.root);
  assert.deepEqual([timedFile, slowFile, aloneFile].map((file) => reading.is[file]), ['timed/vitest', 'slow/vitest', 'alone/vitest'], "the checkout's own lane.json did not place its timed, slow and other files as it names them, so the scene is not the one the criterion names");
  assert.deepEqual(reading.moves.map(({ line }) => line), [], `a checkout equal to its merge base failed the place check\n${shownLines(reading.moves)}`);
  assert.deepEqual([timedFile, slowFile, aloneFile].map((file) => reading.was[file]), ['timed/vitest', 'slow/vitest', 'alone/vitest'], "the merge base's lane.json was not read as it names its timed and slow files");
});

test("#3066.4268aebb #3699.e1f9065f a move to by hand passes only when its redrafted target is inside the checkout, is not the original or a folder holding it, and holds a test file that is not itself by hand; each other case fails, naming the file", LONG, (t) => {
  const kinds = ['redraft outside the checkout', 'redraft is the original or holds it', 'redraft holds only by-hand test files'];
  const { moves } = movesSinceMergeBase(t);
  const refused = moves.filter(({ why }) => kinds.includes(why));
  assert.deepEqual(refused.map(({ file }) => file), [], `${refused.length} test files of the merge base moved to by hand in the place of a redraft that is outside this checkout, is the original or holds it, or runs only by hand\n${shownLines(refused)}`);

  const { TO_BY_HAND, BY_HAND_FILE, BY_HAND_FOLDER } = subjectsOf(t);
  const outside = scratchFolder(t);
  mkdirSync(join(outside, 'redraft'));
  writeFileSync(join(outside, 'redraft/outside.test.mjs'), "import test from 'node:test';\ntest('runs', () => {});\n");
  const cases = [
    [TO_BY_HAND, 'redraft is the original or holds it'],
    [`${dirname(TO_BY_HAND)}/`, 'redraft is the original or holds it'],
    [dirname(TO_BY_HAND), 'redraft is the original or holds it'],
    ['tests/', 'redraft is the original or holds it'],
    ['.', 'redraft is the original or holds it'],
    ['./', 'redraft is the original or holds it'],
    [join(outside, 'redraft'), 'redraft outside the checkout'],
    [`${relative(CHECKOUT, join(outside, 'redraft'))}/`, 'redraft outside the checkout'],
    ['../', 'redraft outside the checkout'],
    [BY_HAND_FILE, 'redraft holds only by-hand test files'],
    [BY_HAND_FOLDER, 'redraft holds only by-hand test files'],
  ];
  const found = cases.map(([target]) => {
    const plant = movesOfPlant(t, [TO_BY_HAND], sendsToByHand(TO_BY_HAND, target));
    assert.equal(plant.is[TO_BY_HAND], 'skipped/by hand', `the plant did not send ${TO_BY_HAND} to by hand: ${plant.is[TO_BY_HAND]}`);
    return [target, plant.moves.map(({ file, why }) => `${file}: ${why}`)];
  });
  assert.deepEqual(found, cases.map(([target, why]) => [target, [`${TO_BY_HAND}: ${why}`]]), `the check did not fail by name ${TO_BY_HAND}, sent to by hand in the place of each target it refuses\n${found.map(([target, lines]) => `  ${target}: ${lines.join('; ') || 'passed'}`).join('\n')}`);

  const allowed = [`${REDRAFT}same-failures.test.mjs`, REDRAFT, REDRAFT.slice(0, -1), join(CHECKOUT, REDRAFT)];
  const passed = allowed.map((target) => [target, movesOfPlant(t, [TO_BY_HAND], sendsToByHand(TO_BY_HAND, target)).moves.map(({ line }) => line)]);
  assert.deepEqual(passed, allowed.map((target) => [target, []]), `the check refused a move to by hand in the place of a redraft inside this checkout that holds a test file run in a lane\n${passed.map(([target, lines]) => `  ${target}: ${lines.join('; ') || 'passed'}`).join('\n')}`);
});

test("#3066.4268aebb #3699.4c1cb484 a test file of the merge base that the checkout no longer holds fails the place check, naming the file", LONG, (t) => {
  const { moves } = movesSinceMergeBase(t);
  const gone = moves.filter(({ why }) => why === 'deleted');
  assert.deepEqual(gone.map(({ file }) => file), [], `${gone.length} test files of the merge base are no longer in this checkout\n${shownLines(gone)}`);

  const folder = unlistedSuite(movesSinceMergeBase(t));
  const kept = `${folder}/kept.test.mjs`, deleted = `${folder}/deleted.test.mjs`;
  const body = "import test from 'node:test';\ntest('runs', () => {});\n";
  const repo = scratchRepo(t, { [kept]: body, [deleted]: body });
  repo.deletes(deleted);
  const reading = movesOfCheckout(t, repo.root);
  assert.equal(reading.was[kept], 'parallel/node', `the scratch checkout's kept file was not placed in the parallel block: ${reading.was[kept]}`);
  assert.deepEqual(reading.moves.map(({ file, why }) => `${file}: ${why}`), [`${deleted}: deleted`], `the check did not fail by name ${deleted}, a test file of the merge base this checkout no longer holds\n${shownLines(reading.moves)}`);
});
