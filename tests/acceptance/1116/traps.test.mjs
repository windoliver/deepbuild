// #1116: what a wrong program would get wrong around the criteria, each on one merged commit in its own sandbox. A
// reading never closes an issue, and the budget under judgement isn't the commit's to move. These carry no
// criterion's tag: each holds a line of the issue's Scope or of the design's invariants (README). The tests of a
// commit not yet measured and of the window as the only way in run from tests/acceptance/1116-redraft-1874/.
import assert from 'node:assert/strict';
import test from 'node:test';
import { budgets, dump, fullWindow, issue, LONG, oneMerged, recordOf, REGRESSED, sandbox } from './helpers.mjs';

test('a window off the reference Macs is a reading: its record is INCONCLUSIVE and its issue stays open', LONG, async (t) => {
  const box = sandbox(t, { model: 'Mac17,10' });
  const { repo, commit } = await oneMerged(box, 9201);
  const run = await fullWindow(box, repo);
  assert.equal(recordOf(box, commit)?.state, 'INCONCLUSIVE', `the record off the reference Macs\n${dump(box, run)}`);
  assert.equal(issue(box, 9201).state, 'OPEN', `a reading closed the issue\n${dump(box, run)}`);
});

test('a commit that raises its own margin to hide a 2× regression doesn\'t pass: budget numbers stay unchanged', LONG, async (t) => {
  const box = sandbox(t);
  const { repo, commit } = await oneMerged(box, 9205, { files: { 'work.sh': REGRESSED, 'benchmarks/budgets.json': budgets(10) } });
  const run = await fullWindow(box, repo);
  const record = recordOf(box, commit);
  assert.ok(record, `no record for the commit\n${dump(box, run)}`);
  assert.notEqual(record.state, 'PASS', `the commit's own margin passed it\n${dump(box, run)}`);
  assert.equal(issue(box, 9205).state, 'OPEN', dump(box, run));
});
