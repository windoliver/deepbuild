// Acceptance tests for issue #3539, criterion 2. The first, on what the spike keeps: the same table under the
// changed order, places whose turn a person opened first and then as today, with the other sessions' waits and the
// longest wait of any place, each kept output held to the package's own `simulate` at the record's `main` run in that
// order (validate.mjs, `expectedRows`); and the kept script in which the person's session never stops, which reads
// the same under both orders. The second runs the spike's harness: its planted twin, which reports a gain on that
// script, must fail the check the kept outputs pass, naming the script.
// Run: node --test tests/acceptance/3539/ac2-changed-order.test.mjs
//   (needs git, node_modules and, for the second test, what docs/spikes/3539/harness.mjs needs; builds nothing)
import assert from 'node:assert/strict';
import test from 'node:test';
import { runHarness } from './harness-run.mjs';
import { holds, loadRecord, neverStopsProblems, PLANTS, readNeverStops, sameUnderBothProblems, tableProblems } from './validate.mjs';

const AC2 = 'AC2 #3539.bed90c36';

test('AC2 #3539.bed90c36 the same table under the changed order, with the other sessions\' waits beside it and the longest wait of any place, and a script in which the person\'s session never stops reads the same under both orders', async () => {
  const { record, problems } = loadRecord();
  holds(AC2, problems);
  holds(AC2, [...await tableProblems(record, 'person-first'), ...await neverStopsProblems(record)]);
});

test('AC2 #3539.bed90c36 a harness that reports a gain on the script in which the person\'s session never stops fails, naming the script', () => {
  const { record, problems } = loadRecord();
  holds(AC2, problems);
  const kept = readNeverStops(record);
  holds(AC2, kept.problems);
  const [today, changed] = ['today', 'person-first'].map((order) => runHarness({ file: kept.file, order, plant: PLANTS.gain }));
  holds(AC2, [...today.problems, ...changed.problems]);
  const found = sameUnderBothProblems(kept.name, kept.script, today.out, changed.out);
  assert.ok(found.some((p) => p.includes('reports a gain') && p.includes(kept.name)), `${AC2}: the check passed a harness that reports a gain on ${kept.name}, in which the person's session never stops, or failed it without naming the script:\n${found.join('\n') || '(no problem)'}`);
});
