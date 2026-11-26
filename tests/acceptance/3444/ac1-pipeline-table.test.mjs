// Acceptance test for issue #3444 (spike: what the GPU backend adds that nothing of ours declares), criterion 1, on
// what the spike keeps: docs/spikes/3444/record.json, the output of main's cold run of the every-pass scene that the
// record cites, and the pipeline table of the report, docs/spikes/3444/README.md. Nothing is run or timed here: the
// table is held to the run's own rows.
// Run: node --test tests/acceptance/3444/ac1-pipeline-table.test.mjs
import test from 'node:test';
import { holds, loadRecord, pipelineTableProblems } from './validate.mjs';

const AC1 = 'AC1 #3444.2cc7fe69';

test(`${AC1} the report's pipeline table lists every pipeline the every-pass scene makes on a cold start, and its times sum to within 10% of the time the same run spends inside pipeline creation, read around the calls; a pipeline left out is named`, () => {
  const { record, problems } = loadRecord();
  holds(AC1, problems);
  holds(AC1, pipelineTableProblems(record));
});
