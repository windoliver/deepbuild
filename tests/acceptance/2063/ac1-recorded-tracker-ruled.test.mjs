// Criterion 1, redrafted on the owner's ruling that `brief.uncited` is a recorded event kind. It supersedes
// ac1-recorded-tracker.test.mjs and fixtures/not-event-kinds-2026-11-14.txt, whose list held brief.uncited as a name
// that is no event kind and so hid it. The list recorded here, fixtures/not-event-kinds-2026-11-14-ruled.txt, holds the
// day's check, kind-rule, fixture, asset, field and lease names, each beside a recorded issue that names it, and not
// brief.uncited. On the recorded tracker the lane then reads brief.uncited as the event kind it is: it passes if the
// catalogue holds it, and otherwise fails naming brief.uncited (#1193) and no listed name.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { CHECKOUT, RECORD, listEntries, naming, runLane } from './helpers.mjs';

const RULED_LIST = join(CHECKOUT, 'tests/acceptance/2063/fixtures/not-event-kinds-2026-11-14-ruled.txt');
// The names #2063 gives as no event kinds that the recorded tracker still holds, each with the recorded issue that
// defines it.
const TODAY = [['plan.overlay', 1260], ['move.feel', 274], ['process.conserve', 980], ['archive.scene', 2036], ['stack.slot', 335]];
const KIND = 'brief.uncited';

test('#2063.1fc4ef66 criterion 1 (on the ruling that brief.uncited is an event kind): on the recorded tracker copy the lane fails with an empty list, naming the five names with their issues; with the day\'s list, which holds every other recorded name that is no event kind and not brief.uncited, it names no listed name, and it passes if the catalogue holds brief.uncited, else fails naming brief.uncited and #1193 alone', async (t) => {
  const issues = JSON.parse(readFileSync(RECORD, 'utf8'));
  const list = readFileSync(RULED_LIST, 'utf8');
  const { catalogue } = await import(pathToFileURL(join(CHECKOUT, 'packages/contracts/dist/index.js')).href);
  const catalogued = catalogue().some((entry) => entry.kind === KIND);

  // Before, as on main: no listed name, so the lane reads each as an event kind the catalogue lacks.
  const before = runLane(t, { docs: 'planted', issues, list: '' });
  assert.deepEqual(before.verdicts, ['FAIL'], `with an empty list the lane's verdict on the recorded tracker is FAIL:\n${before.output}`);
  assert.notEqual(before.status, 0, `runLanes returned 0 with an empty list:\n${before.output}`);
  for (const [name, issue] of TODAY) assert.ok(naming(before, name, issue), `with an empty list, no output line names ${name} and issue ${issue}:\n${before.output}`);

  // The day's list: `<name> #<issue>` a line, each beside a recorded open issue whose body holds the name in
  // backticks, the five beside the issues that define them, and brief.uncited not among them.
  const entries = listEntries(list);
  for (const entry of entries) {
    assert.ok(entry.name, `the recorded list holds a line that isn't \`<name> #<issue>\`: ${JSON.stringify(entry.line)}`);
    assert.ok(issues.find((issue) => issue.number === entry.issue)?.body.includes(`\`${entry.name}\``), `the recorded list holds ${entry.name} beside #${entry.issue}, which is not a recorded open issue that names \`${entry.name}\``);
  }
  for (const [name, issue] of TODAY) assert.ok(entries.some((entry) => entry.name === name && entry.issue === issue), `the recorded list doesn't hold ${name} #${issue}`);
  assert.ok(!entries.some((entry) => entry.name === KIND), `the recorded list holds ${KIND}, which the owner ruled an event kind`);

  // After: the same recorded issues, with the day's list planted as the copy's scripts/not-event-kinds.txt.
  const after = runLane(t, { docs: 'planted', issues, list });
  // A lane that reads the list but still flags a name it holds, or flags it in an issue other than its entry's, fails here.
  for (const entry of entries) assert.equal(naming(after, entry.name), undefined, `with the day's list the lane still names ${entry.name}, which the list holds beside #${entry.issue}:\n${after.output}`);
  if (catalogued) {
    assert.deepEqual(after.verdicts, ['PASS'], `${KIND} is catalogued, so with the day's list the lane's verdict on the recorded tracker is PASS:\n${after.output}`);
    assert.equal(after.status, 0, `runLanes didn't return 0 with the day's list and ${KIND} catalogued:\n${after.output}`);
  } else {
    // A list that hides brief.uncited, or a lane that passes every name once a list exists, passes here.
    assert.deepEqual(after.verdicts, ['FAIL'], `${KIND} is an event kind the catalogue lacks, so with the day's list the lane's verdict on the recorded tracker is FAIL:\n${after.output}`);
    assert.notEqual(after.status, 0, `runLanes returned 0 with ${KIND} an uncatalogued event kind:\n${after.output}`);
    assert.ok(naming(after, KIND, 1193), `no output line names ${KIND} and issue 1193:\n${after.output}`);
  }
});
