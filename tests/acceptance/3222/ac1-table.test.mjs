// Acceptance test for issue #3222 (spike: what a deep_show waits behind other sessions' calls), criterion 1, on the
// spike's public record alone: docs/spikes/3222/record.json, the harness output it cites and the spike's README.
// The 1, 4 and 16-session measurement is never rerun here; its kept output is checked instead.
// Run: node --test tests/acceptance/3222/ac1-table.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { AC1, loadRecord, tableProblems } from './validate.mjs';

const holds = (problems) => assert.deepEqual(problems, [], `${AC1}:\n${problems.join('\n')}`);

test(`${AC1} for 1, 4 and 16 sessions, each kind of call's wait and its service time at the median and the 95th percentile, with the machine and its load at the time, recomputed from the harness's kept output`, () => {
  const { record, problems } = loadRecord();
  holds(problems);
  holds(tableProblems(record));
});
