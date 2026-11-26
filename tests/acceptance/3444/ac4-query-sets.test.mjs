// Acceptance test for issue #3444, criterion 4, on what the spike keeps: docs/spikes/3444/record.json and the outputs
// it cites of the three states' runs on the app's device and of the one-more-than-32 run on a device of its own. No
// device is opened here: each state's count is the device's own counters as its run read them, and what the device did
// with one more than 32 is what the run's last attempt shows. A run on the app's own device fails.
// Run: node --test tests/acceptance/3444/ac4-query-sets.test.mjs
import test from 'node:test';
import { holds, loadRecord, querySetProblems } from './validate.mjs';

const AC4 = 'AC4 #3444.05638bf4';

test(`${AC4} the count of live timestamp query sets is read from the device's own counters in each of the three states, and the one-more-than-32 run reports what the device did: created, refused with the device kept, or lost; a run on the app's own device fails the lane`, () => {
  const { record, problems } = loadRecord();
  holds(AC4, problems);
  holds(AC4, querySetProblems(record));
});
