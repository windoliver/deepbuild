// Acceptance test for issue #3539 (spike: what a session with a person at it waits behind other sessions' slow
// checks), criterion 1, on what the spike keeps: docs/spikes/3539/record.json, the scripts and the outputs under
// today's order it cites, and the spike's report. Each kept output is held, row for row, to what the gate package's
// own `simulate` at the record's `main` gives for its script (base.mjs), and the table is worked out from those rows.
// Run: node --test tests/acceptance/3539/ac1-table.test.mjs   (needs git and node_modules; builds nothing)
import test from 'node:test';
import { holds, loadRecord, tableProblems } from './validate.mjs';

const AC1 = 'AC1 #3539.c6029842';

test('AC1 #3539.c6029842 for each count of sessions and each pool, the person\'s session\'s wait for a slot and its time to a verdict at the median and the 95th percentile, alone and beside the others, worked out from the kept runs under today\'s order', async () => {
  const { record, problems } = loadRecord();
  holds(AC1, problems);
  holds(AC1, await tableProblems(record, 'today'));
});
