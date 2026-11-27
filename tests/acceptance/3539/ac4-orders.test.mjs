// Acceptance test for issue #3539, criterion 4, on what the spike keeps: one script, its output under the package's
// order, held row for row to the package's own `simulate` at the record's `main`, its output under the hub's order,
// the record's list of the places that start at a different time, worked out here from the two outputs, and the
// report's table that names each. A test can't see the hub's run being taken: README.md, "What a test holds of a run".
// Run: node --test tests/acceptance/3539/ac4-orders.test.mjs   (needs git and node_modules; builds nothing)
import test from 'node:test';
import { holds, loadRecord, ordersProblems } from './validate.mjs';

const AC4 = 'AC4 #3539.1c4e0033';

test('AC4 #3539.1c4e0033 one script run through the hub\'s order and the package\'s shows each place\'s start under both, and every place that starts at a different time is named', async () => {
  const { record, problems } = loadRecord();
  holds(AC4, problems);
  holds(AC4, await ordersProblems(record));
});
