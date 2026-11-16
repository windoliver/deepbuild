// Criterion 2: a planted issue body that names an uncatalogued event kind, "ask.ghosted", still fails the lane, naming
// the kind and the issue; listing it under an issue that does not name it fails too.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LISTED, cleanBody, naming, runLane, tracker } from './helpers.mjs';

// #9605 names `ask.ghosted`: no catalogued kind, in the family of the catalogued `ask.created`.
const GHOSTED = { 9605: cleanBody(9605, ['- When nobody answers in time, the hub appends `ask.ghosted` and the ask closes by its default.']) };

// The clean twin both tests start from: every listed name beside the open issue that defines it, and no other name.
function passesClean(t) {
  const clean = runLane(t, { docs: 'planted', issues: tracker(), list: LISTED });
  assert.deepEqual(clean.verdicts, ['PASS'], `the lane's verdict is PASS on 40 open issues whose only uncatalogued names are plan.overlay, process.conserve, archive.scene, stack.slot and move.feel, each listed beside the open issue that names it:\n${clean.output}`);
  assert.equal(clean.status, 0, `runLanes didn't return 0 on the clean tracker:\n${clean.output}`);
}

test('#2063.d47f7c6f criterion 2: with the five listed names passing, an open issue (9605, the 36th of 40) that names the uncatalogued event kind ask.ghosted fails the lane, naming the kind and the issue', (t) => {
  passesClean(t);
  const run = runLane(t, { docs: 'planted', issues: tracker({ bodies: GHOSTED }), list: LISTED });
  // A lane that passes every name once a list exists, ignores issue bodies or reads only gh's default 30 issues passes here.
  assert.deepEqual(run.verdicts, ['FAIL'], `the lane's verdict on an open issue naming ask.ghosted is FAIL:\n${run.output}`);
  assert.notEqual(run.status, 0, `runLanes returned 0 on an open issue naming ask.ghosted:\n${run.output}`);
  assert.ok(naming(run, 'ask.ghosted', 9605), `no output line names ask.ghosted and issue 9605:\n${run.output}`);
});

test('#2063.d47f7c6f criterion 2: listing ask.ghosted under #9606, an open issue that does not name it, while #9605 names it, fails the lane too, naming ask.ghosted', (t) => {
  passesClean(t);
  const run = runLane(t, { docs: 'planted', issues: tracker({ bodies: GHOSTED }), list: [...LISTED, ['ask.ghosted', 9606]] });
  // A lane that passes a listed name without reading the entry's issue passes here.
  assert.deepEqual(run.verdicts, ['FAIL'], `the lane's verdict with ask.ghosted listed under #9606, which does not name it, is FAIL:\n${run.output}`);
  assert.notEqual(run.status, 0, `runLanes returned 0 with ask.ghosted listed under #9606, which does not name it:\n${run.output}`);
  assert.ok(naming(run, 'ask.ghosted'), `no output line names ask.ghosted:\n${run.output}`);
});
