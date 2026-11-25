// Acceptance test for issue #3445, criterion 3, on what the spike keeps: docs/spikes/3445/record.json, the patch that
// takes the epoch checks out, the metering benchmark's output with them out, and the golden each logic golden's piece
// records with them out. Nothing is built or timed here: a build with the checks out is no shipped build, so the kept
// replays are held, step for step, to the step hashes the goldens hold in this checkout's history at the record's main.
// Run: node --test tests/acceptance/3445/ac3-epochs-out.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { epochsOutProblems, loadRecord } from './validate.mjs';

const AC3 = 'AC3 #3445.6abdd2ef';
const holds = (problems) => assert.deepEqual(problems, [], `${AC3}:\n${problems.join('\n')}`);

test(`${AC3} the ns per fuel unit with the epoch checks out is read by the metering benchmark as the record's was, 20 steps and 5 runs, and every golden of the logic kit keeps its step hashes with them out`, () => {
  const { record, problems } = loadRecord();
  holds(problems);
  holds(epochsOutProblems(record));
});
