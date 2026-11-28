// Acceptance test for issue #3445 (spike: what a sandboxed program costs that the fuel doesn't count), criterion 1, on
// what the spike keeps: docs/spikes/3445/record.json, the run output its `compile` cites and the report (README.md).
// The compile times are never read again here: the kept run's own rows, one for each call the compile counter counts,
// are summed against the run's own total, and held against the packs main ships.
// Run: node --test tests/acceptance/3445/ac1-compile-table.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { compileTableProblems, loadRecord } from './validate.mjs';

const AC1 = 'AC1 #3445.0424020d';
const holds = (problems) => assert.deepEqual(problems, [], `${AC1}:\n${problems.join('\n')}`);

test(`${AC1} the report gives each shipped pack's programs with their compile times, the times sum to within 5% of the time the same run spends inside the calls the compile counter counts, and no program the run compiled is left out`, () => {
  const { record, problems } = loadRecord();
  holds(problems);
  holds(compileTableProblems(record));
});
