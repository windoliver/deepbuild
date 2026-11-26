// Acceptance test for issue #3539, criterion 5, on what the spike keeps: docs/spikes/3539/record.json and the
// spike's report. A test can't read GitHub: that the follow-up is filed, or that the paragraph is on the issue, is
// the Proof's and the reviewer's (README.md, "What isn't asserted").
// Run: node --test tests/acceptance/3539/ac5-follow-up.test.mjs
import test from 'node:test';
import { followUpProblems, holds, loadRecord } from './validate.mjs';

const AC5 = 'AC5 #3539.f207836e';

test('AC5 #3539.f207836e a follow-up is filed for what the table justifies, with its own criteria, or one paragraph says why the order stays as it is', () => {
  const { record, problems } = loadRecord();
  holds(AC5, problems);
  holds(AC5, followUpProblems(record));
});
