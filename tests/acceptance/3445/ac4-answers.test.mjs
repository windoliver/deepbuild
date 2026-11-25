// Acceptance test for issue #3445, criterion 4, on what the spike keeps: docs/spikes/3445/record.json, the runs its
// three answers rest on and the report (README.md). Each answer is worked out here from the kept runs' own rows and
// held against what the record and the report say; each threshold a reading passes names its task. A test can't read
// GitHub: that the task is filed there is the reviewer's to see (README.md of this suite, "What isn't asserted").
// Run: node --test tests/acceptance/3445/ac4-answers.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { answersProblems, loadRecord } from './validate.mjs';

const AC4 = 'AC4 #3445.4cbba77d';
const holds = (problems) => assert.deepEqual(problems, [], `${AC4}:\n${problems.join('\n')}`);

test(`${AC4} the report states, with its readings, whether the first reply waits more than 1 s on compiling, whether the checks cost a live step more than 5%, and whether a step that mostly writes costs more than twice the record's ns per fuel unit, and a task is filed for each that does`, () => {
  const { record, problems } = loadRecord();
  holds(problems);
  holds(answersProblems(record));
});
