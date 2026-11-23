// Acceptance test for issue #3222, criterion 4, on the spike's public record: docs/spikes/3222/record.json and the
// spike's README. A test can't read GitHub: that the follow-up is filed, or that the paragraph is on the issue, is
// the reviewer's to see (README.md of this suite, "What this suite could not encode").
// Run: node --test tests/acceptance/3222/ac4-follow-up.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { AC4, followUpProblems, loadRecord } from './validate.mjs';

const holds = (problems) => assert.deepEqual(problems, [], `${AC4}:\n${problems.join('\n')}`);

test(`${AC4} a follow-up is filed for what the table justifies, with its own criteria, or one paragraph says why the line stays as it is`, () => {
  const { record, problems } = loadRecord();
  holds(problems);
  holds(followUpProblems(record));
});
