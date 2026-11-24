// Acceptance test for issue #3222, criterion 3, on the spike's public record: docs/spikes/3222/record.json's list,
// each line of code it cites read from this checkout's history at the commit the record names (git show).
// Run: node --test tests/acceptance/3222/ac3-list.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { AC3, listProblems, loadRecord } from './validate.mjs';

const holds = (problems) => assert.deepEqual(problems, [], `${AC3}:\n${problems.join('\n')}`);

test(`${AC3} the list names, for each kind of call, what it reads and writes and which other kinds it must follow, each with a line of code this checkout holds`, () => {
  const { record, problems } = loadRecord();
  holds(problems);
  holds(listProblems(record));
});
