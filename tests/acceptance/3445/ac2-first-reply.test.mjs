// Acceptance test for issue #3445, criterion 2, on what the spike keeps: docs/spikes/3445/record.json and the run
// output its `firstReply` cites. No canvas core is started here: the five readings the record takes as the result are
// held to the kept rows, each a fresh process's first reply and a release build's, on a reference Mac with no other
// job holding a lease.
// Run: node --test tests/acceptance/3445/ac2-first-reply.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { firstReplyProblems, loadRecord } from './validate.mjs';

const AC2 = 'AC2 #3445.13016257';
const holds = (problems) => assert.deepEqual(problems, [], `${AC2}:\n${problems.join('\n')}`);

test(`${AC2} the first reply's time is read five times, each from a fresh process of a release build, and no reading from a dev build or a warm process is taken as the result`, () => {
  const { record, problems } = loadRecord();
  holds(problems);
  holds(firstReplyProblems(record));
});
