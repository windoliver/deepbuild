// Criterion 3: the text names each word of the States people see table and what a person reads for it on a plain
// surface, or says it reads as it is and why. Offline: it reads docs/technical-design.md here and at the base commit.
// The words are the first column of the section's table as it is now; each has to stand whole in a sentence or a table
// cell the section gained (README.md, The state words). What the text says of each word is the taste call's to judge.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BASE, judgeWords, read } from './helpers.mjs';

const CRITERION = 'AC3 #3472.c86cb9a6';

test(`${CRITERION} what States people see gained since ${BASE.slice(0, 8)} names each word of its table, from queued to running`, () => {
  const { gained, words } = read();
  assert.deepEqual(judgeWords(gained, words), [], 'the new text does not name each word of the States people see table');
});
