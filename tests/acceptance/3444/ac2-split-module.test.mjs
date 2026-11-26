// Acceptance test for issue #3444, criterion 2, on what the spike keeps: docs/spikes/3444/record.json, the outputs of
// main's and the split-module branch's cold runs of the every-pass scene, the patch that is the branch, and the report.
// No frame is drawn here: the two runs' own pixel hashes are compared, and the report's split-module column is held to
// its run. A column whose frame differs is INCONCLUSIVE when the report heads it as a reading and fails when the report
// takes it as the result.
// Run: node --test tests/acceptance/3444/ac2-split-module.test.mjs
import test from 'node:test';
import { holds, loadRecord, splitModuleBranchProblems } from './validate.mjs';

const AC2 = 'AC2 #3444.441f7ad4';

test(`${AC2} the split-module branch draws the every-pass scene to the same pixel hashes as main, and the report gives both columns; a branch whose frame differs is a reading, never the result`, () => {
  const { record, problems } = loadRecord();
  holds(AC2, problems);
  holds(AC2, splitModuleBranchProblems(record));
});
