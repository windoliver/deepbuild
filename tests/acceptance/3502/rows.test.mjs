// #3502, first criterion, its fourth clause, and the second criterion's run: every remaining row's test passes on the
// new pin, and each removed row's test still passes without our change. One run serves both: each test file a cell
// names is run once, with every test the two lists need from it (README: Every row's test). A row whose test can't
// run reads BLOCKED and one whose test can't decide here INCONCLUSIVE, each naming the row; neither passes.
//
// The rows' tests build the app's binaries, show windows and hold the GPU; some take an hour. This file is run by a
// person, on a Mac with a display, its screen on and unlocked (README: How to run).
// Run: node --test tests/acceptance/3502/rows.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blocked, carriedRows, mergeBase, read, REPO, requireNewPin, retiredRows, showAt, TABLE } from './common.mjs';
import { judgeRetired, judgeRows, runCells } from './rows.mjs';

const table = () => {
  const rows = carriedRows(read(REPO, TABLE));
  if (!rows) blocked(`${TABLE} holds no carried-patch table under "## Carried patches"`);
  return rows;
};

test('AC1 #3502.46a47d8c every remaining row\'s test passes on the new pin, each row with its own outcome; a row whose test can\'t run reads BLOCKED, naming it, never PASS', { timeout: 48 * 3_600_000 }, () => {
  requireNewPin();
  const rows = table();
  const { lines, failures } = judgeRows(rows, runCells(REPO, rows.map((row) => row.test)));
  console.log(lines.join('\n'));
  assert.deepEqual(failures, [], `${rows.length - failures.length} of ${rows.length} rows read PASS`);
});

test('AC2 #3502.e03d1e0d each row that was removed: its test still passes without our change', { timeout: 48 * 3_600_000 }, () => {
  const base = carriedRows(showAt(REPO, mergeBase(), TABLE));
  if (!base) blocked(`the merge base's ${TABLE} holds no carried-patch table`);
  const { removed, failures: unnamed } = judgeRetired(base, table(), retiredRows(read(REPO, TABLE)));
  assert.deepEqual(unnamed, [], 'each removed row has its retired row');
  const retired = removed.map((row) => row.retired);
  const { lines, failures } = judgeRows(retired, runCells(REPO, retired.map((row) => row.test)));
  console.log(lines.join('\n') || 'no row of the merge base was removed');
  assert.deepEqual(failures, [], `${retired.length - failures.length} of ${retired.length} removed rows' tests pass without our change`);
});
