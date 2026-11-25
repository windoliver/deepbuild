// Acceptance test for issue #3222, criterion 2's first sentence, on the spike's public record alone: the planted
// slow call's run and the run of the same 15 patches with no slow call, both kept as harness output and cited by
// docs/spikes/3222/record.json, and the heavy fixture the record names. Neither run is taken again here.
// The criterion's second sentence, the harness against a core this suite holds busy, is ac2-held-busy.test.mjs.
// Run: node --test tests/acceptance/3222/ac2-planted.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { AC2, loadRecord, plantedProblems } from './validate.mjs';

const holds = (problems) => assert.deepEqual(problems, [], `${AC2}:\n${problems.join('\n')}`);

test(`${AC2} with the planted slow call in flight, the 15 patches' waits are recorded beside the same patches' waits with no slow call, recomputed from both kept runs`, () => {
  const { record, problems } = loadRecord();
  holds(problems);
  holds(plantedProblems(record));
});
