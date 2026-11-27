// Acceptance test for issue #3444, criterion 3, on what the spike keeps: docs/spikes/3444/record.json and the outputs
// of the ten runs of the forest it cites, five with indirect-call validation on and five with it off. No run is taken
// again and no time is judged here: the runs' own times order the rounds, and each run's instance flags, as it read
// them back, are held to the column the record puts it in.
// Run: node --test tests/acceptance/3444/ac3-indirect.test.mjs
import test from 'node:test';
import { holds, indirectProblems, loadRecord } from './validate.mjs';

const AC3 = 'AC3 #3444.f25f18de';

test(`${AC3} the indirect readings are from five runs a side in alternated rounds on one Mac, with the flag's state read back from the instance in each run; a side whose flag was not what its column says fails, naming the run`, () => {
  const { record, problems } = loadRecord();
  holds(AC3, problems);
  holds(AC3, indirectProblems(record));
});
