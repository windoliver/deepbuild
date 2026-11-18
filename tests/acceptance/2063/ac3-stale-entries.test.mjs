// Criterion 3: a planted list entry whose issue is closed, and one whose issue no longer names it, each fail the lane,
// naming the entry.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LISTED, cleanBody, naming, runLane, tracker } from './helpers.mjs';

// The clean twin both tests start from: `move.feel #9608` with #9608 open and naming `move.feel`.
function passesClean(t) {
  const clean = runLane(t, { docs: 'planted', issues: tracker(), list: LISTED });
  assert.deepEqual(clean.verdicts, ['PASS'], `the lane's verdict is PASS while every entry's issue is open and names it (move.feel #9608 among them):\n${clean.output}`);
  assert.equal(clean.status, 0, `runLanes didn't return 0 while every entry's issue is open and names it:\n${clean.output}`);
}

test('#2063.0ccaf9ec criterion 3: the entry `move.feel #9608` fails the lane once #9608 is closed, naming move.feel, though the closed issue still names it and no open issue does', (t) => {
  passesClean(t);
  const run = runLane(t, { docs: 'planted', issues: tracker({ closed: [9608] }), list: LISTED });
  // A lane that never reads its list against the tracker, or reads a closed issue's body as an open one's, passes here.
  assert.deepEqual(run.verdicts, ['FAIL'], `the lane's verdict with move.feel listed under the closed #9608 is FAIL:\n${run.output}`);
  assert.notEqual(run.status, 0, `runLanes returned 0 with move.feel listed under the closed #9608:\n${run.output}`);
  assert.ok(naming(run, 'move.feel'), `no output line names the entry move.feel:\n${run.output}`);
});

test('#2063.0ccaf9ec criterion 3: the entry `move.feel #9608` fails the lane once #9608, still open, no longer names move.feel, naming move.feel', (t) => {
  passesClean(t);
  const reworded = { 9608: cleanBody(9608, ['- The kit\'s checks: a course check (a fixture course\'s jump peak, coyote window and step up against the brief\'s values).']) };
  const run = runLane(t, { docs: 'planted', issues: tracker({ bodies: reworded }), list: LISTED });
  // A lane that checks only that an entry's issue is open passes here.
  assert.deepEqual(run.verdicts, ['FAIL'], `the lane's verdict with move.feel listed under #9608, which no longer names it, is FAIL:\n${run.output}`);
  assert.notEqual(run.status, 0, `runLanes returned 0 with move.feel listed under #9608, which no longer names it:\n${run.output}`);
  assert.ok(naming(run, 'move.feel'), `no output line names the entry move.feel:\n${run.output}`);
});
