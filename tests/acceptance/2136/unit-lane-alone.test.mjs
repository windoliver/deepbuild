// #2136, criterion 2: the unit lane's one-at-a-time block runs no file the by-hand list names. Read from what
// scripts/lanes.mjs exports: its `alone` and `byHand` lists and the unit lane's second command, against the
// repository's files.
import assert from 'node:assert/strict';
import test from 'node:test';
import { CHECKOUT, lanesOf, repoFiles } from './helpers.mjs';

/** Whether a list of files and of folders ending in `/` covers a file, as lanes.mjs writes its lists. */
const covers = (list, file) => list.some((entry) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry));

test('#2136.2bc42651 every by-hand file under an alone folder is the value of an --exclude in the unit lane\'s second command', () => {
  const { alone, byHand, unit } = lanesOf(CHECKOUT);
  const second = unit[1];
  assert.ok(second?.includes('--no-file-parallelism') && second.some((arg) => arg.endsWith('vitest.mjs')), `the unit lane's second command is not its one-at-a-time vitest block: ${JSON.stringify(second?.slice(0, 6))}`);
  // The files vitest runs, *.test.ts, that the by-hand list names and an alone entry holds: 21 when the issue was written.
  const files = repoFiles(CHECKOUT).filter((file) => file.endsWith('.test.ts') && covers(byHand, file) && covers(alone, file));
  assert.ok(files.length > 0, 'no by-hand test file is under an alone folder, so the lists give the command nothing to exclude');
  const excludes = second.flatMap((arg, index) => (arg === '--exclude' ? [second[index + 1]] : []));
  // The value is the file itself, or its folder as the lane writes one for vitest: `<folder>/**`.
  const excluded = (file) => excludes.some((value) => value === file || (value?.endsWith('/**') && file.startsWith(value.slice(0, -2))));
  const run = files.filter((file) => !excluded(file));
  assert.deepEqual(run, [], `${run.length} of the ${files.length} by-hand files under an alone folder are the value of no --exclude in the unit lane's second command, so the block runs them`);
});
