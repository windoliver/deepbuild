// Blind redraft of #2649 AC1. Run: node --test tests/acceptance/2649/redraft/ac1.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRecord, tableProblems } from './validate.mjs';

test('AC1 a table lists every process start of one sandboxed command check and of one hour-long idle run, by caller, with count and instructions that the kept counter output recomputes', () => {
  const { record, problems } = loadRecord();
  assert.deepEqual(problems, [], `\n${problems.join('\n')}`);
  const found = tableProblems(record);
  assert.deepEqual(found, [], `\n${found.join('\n')}`);
});
