// Criterion 1: with the list holding today's check, kind-rule, fixture and lease names, each beside its issue, the lane
// passes on the open issues of a recorded copy of the tracker; without the list (as on main) it fails, naming them.
// The tracker and the list are both recorded (fixtures/): the checkout's living list follows the live tracker and is
// never read here.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { RECORD, RECORDED_LIST, listEntries, naming, runLane } from './helpers.mjs';

// The names #2063 gives as no event kinds that the recorded tracker still holds, each with the recorded issue that
// defines it: the planned checks, the kind rule, the fixture and the lease key.
const TODAY = [['plan.overlay', 1260], ['move.feel', 274], ['process.conserve', 980], ['archive.scene', 2036], ['stack.slot', 335]];

// Retired with the owner's approval on #2063 (PR #2572): its recorded list holds brief.uncited, which the owner ruled an
// event kind; ac1-recorded-tracker-exact.test.mjs is criterion 1's test.
test.skip('#2063.1fc4ef66 criterion 1: on the recorded tracker copy (77 open issues of November 14) the lane fails with an empty list, naming plan.overlay, move.feel, process.conserve, archive.scene and stack.slot with their issues, and passes with the list recorded that day, which holds each name beside a recorded issue that names it', (t) => {
  const issues = JSON.parse(readFileSync(RECORD, 'utf8'));
  const list = readFileSync(RECORDED_LIST, 'utf8');

  // Before, as on main: no listed name, so the lane reads each as an event kind the catalogue lacks.
  const before = runLane(t, { docs: 'planted', issues, list: '' });
  assert.deepEqual(before.verdicts, ['FAIL'], `with an empty list the lane's verdict on the recorded tracker is FAIL:\n${before.output}`);
  assert.notEqual(before.status, 0, `runLanes returned 0 with an empty list:\n${before.output}`);
  for (const [name, issue] of TODAY) assert.ok(naming(before, name, issue), `with an empty list, no output line names ${name} and issue ${issue}:\n${before.output}`);

  // The recorded list is what the criterion says it is: `<name> #<issue>` a line, each beside a recorded open issue
  // whose body holds the name in backticks, the issue's five names beside the issues that define them.
  const entries = listEntries(list);
  for (const entry of entries) {
    assert.ok(entry.name, `the recorded list holds a line that isn't \`<name> #<issue>\`: ${JSON.stringify(entry.line)}`);
    assert.ok(issues.find((issue) => issue.number === entry.issue)?.body.includes(`\`${entry.name}\``), `the recorded list holds ${entry.name} beside #${entry.issue}, which is not a recorded open issue that names \`${entry.name}\``);
  }
  for (const [name, issue] of TODAY) assert.ok(entries.some((entry) => entry.name === name && entry.issue === issue), `the recorded list doesn't hold ${name} #${issue}`);

  // After: the same recorded issues, with the recorded list planted as the copy's scripts/not-event-kinds.txt.
  const after = runLane(t, { docs: 'planted', issues, list });
  assert.deepEqual(after.verdicts, ['PASS'], `with the recorded list as scripts/not-event-kinds.txt the lane's verdict on the recorded tracker is PASS:\n${after.output}`);
  assert.equal(after.status, 0, `runLanes didn't return 0 with the recorded list as scripts/not-event-kinds.txt:\n${after.output}`);
});
