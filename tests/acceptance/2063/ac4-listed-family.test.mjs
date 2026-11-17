// Criterion 4: a planted lane that passes every name whose family the list holds lets "plan.ghost" through and fails
// this test, naming it. The planted lane is twins/passes-listed-families (twins.json).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LISTED, cleanBody, naming, runLane, tracker } from './helpers.mjs';

test('#2063.0d14edf8 criterion 4: with plan.overlay listed, an open issue (9605) that names plan.ghost, an unlisted name in the same family, fails the lane, naming plan.ghost and the issue', (t) => {
  const clean = runLane(t, { docs: 'planted', issues: tracker(), list: LISTED });
  assert.deepEqual(clean.verdicts, ['PASS'], `the lane's verdict is PASS while the only name in the plan family is the listed plan.overlay:\n${clean.output}`);
  assert.equal(clean.status, 0, `runLanes didn't return 0 while the only name in the plan family is the listed plan.overlay:\n${clean.output}`);

  const ghost = { 9605: cleanBody(9605, ['- The terminal also passes `plan.ghost` on the plan and the section.']) };
  const run = runLane(t, { docs: 'planted', issues: tracker({ bodies: ghost }), list: LISTED });
  // A lane that passes every name whose family the list holds (plan, from plan.overlay) lets plan.ghost through here.
  assert.deepEqual(run.verdicts, ['FAIL'], `the lane let plan.ghost through: its verdict on an open issue naming plan.ghost, with only plan.overlay listed, is FAIL:\n${run.output}`);
  assert.notEqual(run.status, 0, `the lane let plan.ghost through: runLanes returned 0:\n${run.output}`);
  assert.ok(naming(run, 'plan.ghost', 9605), `no output line names plan.ghost and issue 9605:\n${run.output}`);
});
