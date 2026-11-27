// #3551, criteria 3 and 5 and the Scope's "Overdue": a window asked the overdue span or more after the last window
// closed stops new grants and waits for every held grant to end. The real `node scripts/throttle.mjs window` runs in a
// fixture checkout on a table of the test's own, with the spans at 6 and 12 minutes, a `window-close` 13 minutes old
// in the table's log (an older window's lies before it), and two grants held, a `build` and a `test`, whose commands
// the test ends 20 s and 40 s after the window is asked. A `build` and a `test` request are made once the window's
// request is in the table. One scene, played once, on the first test's turn; the three tests read it.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { drainProblems, dump, logWindow, none, playDrain, recordProblems, sandbox, wholeFile, windowIn } from './helpers.mjs';

const LONG = { timeout: 600_000 };
// The scene outlives the test that plays it: its sandbox is removed once the file's tests have all ended.
const FILE = wholeFile(after);
const HELD = [{ cls: 'build', name: 'held-build', ends: 20_000 }, { cls: 'test', name: 'held-test', ends: 40_000 }];

async function play() {
  const box = sandbox(FILE);
  logWindow(box, 50);
  logWindow(box, 13);
  return { box, ...await playDrain(box, { held: HELD, queued: ['build', 'test'] }) };
}
let played;
const scene = () => (played ??= play());
const runs = (s) => [s.window, ...s.holders, ...s.queued];

test('#3551.aa2e13ce with a window-close 13 minutes old and two grants held that end 20 s and 40 s on, the window opens when the second ends, and no top-level grant starts between its request and its close', LONG, async () => {
  const s = await scene();
  none(s.box, drainProblems(s.box, s), 'the last window closed 13 minutes ago, past the 12 of DEEP_WINDOW_OVERDUE_MIN, so the window is overdue and drains, but', ...runs(s));
});

test('#3551.84e18eb8 the record of a window that drained for 40 s holds drain within 1 s of the time the test read from its request to its grant, and the grants it waited on, by class: one build and one test', LONG, async () => {
  const s = await scene();
  none(s.box, recordProblems(s.box, s.window, { build: 1, test: 1 }), 'the record of the window that waited on a build and a test grant doesn\'t hold what criterion 5 names', ...runs(s));
});

test('Scope, Overdue: the window that drains waits with a wait of 720 minutes: the log\'s granted entry of its grant carries wait: 720', LONG, async () => {
  const s = await scene();
  const { log, open, id } = windowIn(s.box, s.window);
  assert.ok(open >= 0, `the overdue window never opened, so the log holds no grant of its own to read\n${dump(s.box, ...runs(s))}`);
  const granted = log.find((line) => line.event === 'granted' && line.id === id);
  assert.equal(granted?.wait, 720, `the log's granted entry of the window's grant ${id} doesn't carry wait: 720, a held grant's own bound: ${JSON.stringify(granted)}\n${dump(s.box, ...runs(s))}`);
});
