import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { CHECKOUT, LONG, gitHere, mergeBase, movesOfPlant, movesSinceMergeBase, sendsToByHand, shownLines } from './helpers.mjs';

const REDRAFT = 'tests/acceptance/3066-redraft-3699/';
const STAYS = 'tests/acceptance/3066/moved-run.test.mjs';
const TO_ALONE = 'tests/acceptance/3066/by-reason.test.mjs';
const TO_BY_HAND = 'tests/acceptance/3066/lint-plants.test.mjs';
const UNMAPPED = 'tests/acceptance/3066/lint-plants.test.mjs';
const TO_MISSING = 'tests/acceptance/3066/lint-plants.test.mjs';
const TO_NO_TEST = 'tests/acceptance/3066/by-reason.test.mjs';
const TO_PARALLEL = 'tests/dither-fill.test.ts';

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

  const plant = movesOfPlant(t, [STAYS, TO_ALONE, TO_BY_HAND, TO_PARALLEL], [
    `alone.push(${JSON.stringify(TO_ALONE)});`,
    `if (alone.includes(${JSON.stringify(TO_PARALLEL)})) alone.splice(alone.indexOf(${JSON.stringify(TO_PARALLEL)}), 1);`,
    ...sendsToByHand(TO_BY_HAND, REDRAFT),
  ]);
  const moved = (file) => `${plant.was[file]} -> ${plant.is[file]}`;
  assert.deepEqual([STAYS, TO_ALONE, TO_PARALLEL, TO_BY_HAND].map((file) => `${file}: ${moved(file)}`), [
    `${STAYS}: ${plant.was[STAYS]} -> ${plant.was[STAYS]}`,
    `${TO_ALONE}: parallel/node -> alone/node`,
    `${TO_PARALLEL}: alone/vitest -> parallel/vitest`,
    `${TO_BY_HAND}: ${plant.was[TO_BY_HAND]} -> skipped/by hand`,
  ], 'the planted moves did not place the files as planted, so the check was not given the moves it is for');
  assert.deepEqual(plant.moves.map(({ line }) => line), [], `the check refused a move it allows\n${shownLines(plant.moves)}`);
});

test("#3066.4268aebb #3699.79b40a54 a test file of the merge base that moves to by hand with no redrafted entry fails the check, naming the file", LONG, (t) => {
  const { moves } = movesSinceMergeBase(t);
  const unmapped = moves.filter(({ why }) => why === 'no redrafted entry');
  assert.deepEqual(unmapped.map(({ file }) => file), [], `${unmapped.length} test files of the merge base moved to by hand with no redrafted entry\n${shownLines(unmapped)}`);

  const plant = movesOfPlant(t, [UNMAPPED], sendsToByHand(UNMAPPED));
  assert.equal(plant.is[UNMAPPED], 'skipped/by hand', `the plant did not send ${UNMAPPED} to by hand: ${plant.is[UNMAPPED]}`);
  assert.deepEqual(plant.moves.map(({ file, why }) => `${file}: ${why}`), [`${UNMAPPED}: no redrafted entry`], `the check did not fail ${UNMAPPED}, sent to by hand with no redrafted entry, by name\n${shownLines(plant.moves)}`);
});

test("#3066.4268aebb #3699.f7548a54 a test file of the merge base that moves to by hand while its redrafted entry names a missing path, or a path holding no test file, fails the check, naming the file", LONG, (t) => {
  const { moves } = movesSinceMergeBase(t);
  const misplaced = moves.filter(({ why }) => why === 'redraft missing' || why === 'redraft holds no test file');
  assert.deepEqual(misplaced.map(({ file }) => file), [], `${misplaced.length} test files of the merge base moved to by hand in the place of a redraft this checkout does not hold\n${shownLines(misplaced)}`);

  const missing = 'tests/acceptance/3066-redraft-3699-missing/';
  const noTest = `${REDRAFT}README.md`;
  const plant = movesOfPlant(t, [TO_MISSING, TO_NO_TEST], [...sendsToByHand(TO_MISSING, missing), ...sendsToByHand(TO_NO_TEST, noTest)]);
  assert.deepEqual([TO_MISSING, TO_NO_TEST].map((file) => plant.is[file]), ['skipped/by hand', 'skipped/by hand'], 'the plant did not send both files to by hand');
  assert.deepEqual(plant.moves.map(({ file, why }) => `${file}: ${why}`).sort(), [`${TO_MISSING}: redraft missing`, `${TO_NO_TEST}: redraft holds no test file`].sort(), `the check did not fail by name both files sent to by hand in the place of a redraft this checkout does not hold\n${shownLines(plant.moves)}`);
});
