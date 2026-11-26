// #3551, criteria 4 and 5 and the Scope's "Overdue": with no window in the throttle's log, a window drains as the
// overdue one does. The real `node scripts/throttle.mjs window` runs in a fixture checkout on a table of the test's
// own, with the spans at 6 and 12 minutes, a log that holds no `window-close` (only the held grants' own lines), and
// two `test` grants held, whose commands the test ends 6 s after the window is asked. A `build` request is made once
// the window's request is in the table. The checks are criterion 3's own, by the same function (helpers.mjs,
// drainProblems). One scene, played once, on the first test's turn; the three tests read it.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { drainProblems, dump, logLines, none, playDrain, recordProblems, sandbox, wholeFile, windowIn } from './helpers.mjs';

const LONG = { timeout: 600_000 };
// The scene outlives the test that plays it: its sandbox is removed once the file's tests have all ended.
const FILE = wholeFile(after);
const HELD = [{ cls: 'test', name: 'held-test-1', ends: 6_000 }, { cls: 'test', name: 'held-test-2', ends: 6_000 }];

async function play() {
  const box = sandbox(FILE);
  const s = { box, ...await playDrain(box, { held: HELD, queued: ['build'] }) };
  // The scene's own premise, read from the log as the window found it: no window-close before the window was asked.
  s.before = logLines(box).slice(0, s.window.mark);
  return s;
}
let played;
const scene = () => (played ??= play());
const runs = (s) => [s.window, ...s.holders, ...s.queued];

test('#3551.9147d91b with no window-close in the log, the window drains as the overdue one does: it opens when the last held grant ends, and no top-level grant starts between its request and its close', LONG, async () => {
  const s = await scene();
  assert.ok(s.before.length && !s.before.some((line) => line.event === 'window-close' || line.unparsed), `the scene didn't hold: the log the window found was to hold the held grants' lines and no window-close\n${dump(s.box, ...runs(s))}`);
  none(s.box, drainProblems(s.box, s), 'the log holds no window-close, so the window drains as an overdue one does, but', ...runs(s));
});

test('#3551.84e18eb8 the record of a window that drained with no window-close in the log holds drain within 1 s of the time the test read from its request to its grant, and the grants it waited on, by class: two test', LONG, async () => {
  const s = await scene();
  none(s.box, recordProblems(s.box, s.window, { test: 2 }), 'the record of the window that waited on two test grants doesn\'t hold what criterion 5 names', ...runs(s));
});

test('Scope, Overdue: with no window in the log the window waits with a wait of 720 minutes: the log\'s granted entry of its grant carries wait: 720', LONG, async () => {
  const s = await scene();
  const { log, open, id } = windowIn(s.box, s.window);
  assert.ok(open >= 0, `the window never opened, so the log holds no grant of its own to read\n${dump(s.box, ...runs(s))}`);
  const granted = log.find((line) => line.event === 'granted' && line.id === id);
  assert.equal(granted?.wait, 720, `the log's granted entry of the window's grant ${id} doesn't carry wait: 720, a held grant's own bound: ${JSON.stringify(granted)}\n${dump(s.box, ...runs(s))}`);
});
