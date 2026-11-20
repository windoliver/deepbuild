// Acceptance tests for issue #2649, the sandboxed-run process-start spike, on its public record alone
// (docs/spikes/2649/record.json and the counter output it cites). Nothing here runs code under test.
// Run: node --test tests/acceptance/2649/spike.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { cutProblems, latencyProblems, loadRecord, recommendationProblems, tableProblems } from './validate.mjs';

const holds = (problems) => assert.deepEqual(problems, [], `\n${problems.join('\n')}`);
const need = (check) => () => {
  const { record, problems } = loadRecord();
  holds(problems);
  holds(check(record));
};

test('AC1 a table lists every process start of one sandboxed command check and of one hour-long idle run, by caller, with count and instructions that the kept counter output recomputes', need(tableProblems));
test('AC2 each start is needed, repeated or replaceable; a replaceable one names its replacement and what a person or test would see change', need((r) => tableProblems(r).filter((p) => /no rows|verdict|heldBy|replac|change|use /.test(p))));
test('AC3 each cut tried is measured on sandbox-setup, runner-job and command-check-count: 15 alternated rounds a side against the merge base, with the command', need(cutProblems));
test('AC4 the time from a fork to its process.tracked event is read at p50 and p95 from the kept samples', need(latencyProblems));
test('AC5 the recommendation names cuts, each with a drafted criterion, or says none is worth one', need(recommendationProblems));
