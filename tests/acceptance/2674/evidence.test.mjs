// #2674, the criteria only the windows' committed records settle: the numbers table beside them, the suites #1830
// lists, and #1009's criterion (evidence.mjs; README: The surface). Each test reads what the repo holds under
// benchmarks/windows/ and fails, naming what is missing, until three real windows' records are there.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { FOLDER, holdings, planted, readTable, ROWS, settled1009, suitesRead, TABLE, tableProblems } from './evidence.mjs';

/** Fails, listing each problem under `what`, unless there are none. */
const none = (problems, what) => assert.ok(!problems.length, `${what}:\n${problems.map((problem) => `  ${problem}`).join('\n')}`);

test('#2674.5e151201 the table beside the windows\' records has one line for each of the thirteen rows, reads a verdict only from a committed record, says when a line is a reading, and a planted table giving a row PASS with no record behind it fails, naming the row', () => {
  const held = holdings();
  const path = join(held.folder, TABLE);
  assert.ok(existsSync(path), `the repo holds no table at ${FOLDER}/${TABLE}, beside the windows' records`);
  assert.ok(held.windows.length, `the table at ${FOLDER}/${TABLE} has no window's records beside it`);
  const table = readTable(path);
  const problems = tableProblems(table, held);
  none(problems, `the table at ${FOLDER}/${TABLE} doesn't hold`);
  for (const name of ROWS) {
    const caught = tableProblems(planted(table, name), held);
    assert.ok(caught.some((problem) => problem.startsWith(`${name}: PASS with no record behind it`)), `a planted table giving ${name} PASS with no record behind it wasn't failed, naming the row: ${JSON.stringify(caught)}`);
  }
});

test('#2674.77d9eb79 each suite #1830 lists reads PASS or FAIL in a window, and none reads INCONCLUSIVE for a missing load', () => {
  const problems = suitesRead(holdings());
  none(problems, `the windows' records don't read every suite #1830 lists PASS or FAIL`);
});

test('#2674.9d468621 #1009\'s criterion is settled PASS or FAIL by a window\'s record, and #1009 says which', () => {
  const problems = settled1009(holdings());
  none(problems, `#1009's criterion isn't settled by a window's record`);
});
