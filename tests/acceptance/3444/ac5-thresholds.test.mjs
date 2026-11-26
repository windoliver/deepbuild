// Acceptance test for issue #3444, criterion 5, on what the spike keeps: docs/spikes/3444/record.json, the run outputs
// it cites, and the threshold table of the report, docs/spikes/3444/README.md. Each of the issue's three thresholds is
// worked out here from the runs' own rows and compared with what the report states; none is a budget, and no time is
// judged. A test can't reach GitHub: that each task the record names is filed there is the Proof's to show (README.md
// of this suite, "What isn't asserted").
// Run: node --test tests/acceptance/3444/ac5-thresholds.test.mjs
import test from 'node:test';
import { holds, loadRecord, thresholdProblems } from './validate.mjs';

const AC5 = 'AC5 #3444.f6f69d8c';

test(`${AC5} the report states, with its readings, whether translation is more than a fifth of the time to the first settled frame, whether validation is more than 5% of the geometry pass on the forest, and whether any state holds more than 16 live sets, and a task is filed for each that does`, () => {
  const { record, problems } = loadRecord();
  holds(AC5, problems);
  holds(AC5, thresholdProblems(record));
});
