// #3551, criterion 2 and the Scope's "Empty": a window asked while the table holds no grant opens at once when the
// last window closed the apart span ago or more, and leaves when it closed less than that ago. The real
// `node scripts/throttle.mjs window` runs in a fixture checkout on a table of the test's own with no grant held, the
// spans at 6 and 12 minutes, and the newest `window-close` of the table's log 7 minutes old in one scene and 5 in the
// other (an older window's lies before it in both). Each scene is played once, on the turn of the first test to read it.
import test, { after } from 'node:test';
import { askWindow, firstLine, how, logWindow, named, none, recordProblems, running, sandbox, seconds, watched, wholeFile, windowIn, windowRecords } from './helpers.mjs';

const LONG = { timeout: 300_000 };
// The scene outlives the test that plays it: its sandbox is removed once the file's tests have all ended.
const FILE = wholeFile(after);

/** No grant held, and the last window closed `closedMinAgo` minutes ago: the window, asked and watched to its end. */
async function play(closedMinAgo) {
  const box = sandbox(FILE);
  logWindow(box, 40);
  logWindow(box, closedMinAgo);
  const window = askWindow(box);
  // deadline: a window that opens marks main and closes within seconds, and one that leaves does at once; 120 s bound a machine too busy for that.
  await watched(box, window, 120_000);
  return { box, window };
}
const scenes = new Map();
const scene = (closedMinAgo) => scenes.get(closedMinAgo) ?? scenes.set(closedMinAgo, play(closedMinAgo)).get(closedMinAgo);

test('#3551.6d0f6876 with no grant held and a window-close 7 minutes old, the window opens at once and the log holds window-open', LONG, async () => {
  const { box, window } = await scene(7);
  const { open, close, id } = windowIn(box, window);
  const first = firstLine(window);
  const problems = [];
  if (open < 0) problems.push(`the window didn't open: the log holds no window-open since it was asked (${how(window)}${first ? `, its first line ${JSON.stringify(first)}` : ', having printed nothing'})`);
  else {
    // "As now" (Scope, Empty): the window's script ran inside it, and it closed.
    if (close < 0) problems.push(`the log holds no window-close for the window's grant ${id}`);
    if (!windowRecords(box).some((record) => record.grant === id)) problems.push(`the opened window's script left no record of its own for grant ${id}`);
  }
  none(box, problems, 'with no grant held and the last window closed 7 minutes ago, past the 6 of DEEP_WINDOW_APART_MIN, the window is due, but', window);
});

test('#3551.6d0f6876 with no grant held and a window-close 5 minutes old, the window leaves: it opens nothing, joins no line and reads INCONCLUSIVE', LONG, async () => {
  const { box, window } = await scene(5);
  const { open, id } = windowIn(box, window);
  const first = firstLine(window);
  const problems = [];
  if (open >= 0) problems.push(`the window opened 5 minutes after the last window closed, less than the 6 of DEEP_WINDOW_APART_MIN: the log holds a window-open for grant ${id}`);
  if (running(window) || !window.run) problems.push(`the window didn't leave: it was still there ${seconds(window.asked)} after it was asked, and the test stopped it`);
  if (window.own) problems.push(`the window joined a line: the table held its ${named(window.own)}, first seen ${seconds(window.asked, window.own.seen)} after it was asked`);
  if (windowRecords(box).length) problems.push('a window that left wrote a record of its own');
  // A window that didn't run never reads as one that did (invariant 2), and no run that prints nothing passes.
  if (window.run && window.run.status === 0) problems.push('a window that didn\'t open exited 0');
  if (!first.startsWith('INCONCLUSIVE')) problems.push(`the window's first line doesn't read INCONCLUSIVE: ${first ? JSON.stringify(first) : 'it printed nothing'}`);
  none(box, problems, 'with no grant held and the last window closed 5 minutes ago, the window is not yet due, but', window);
});

test('#3551.84e18eb8 the record of a window that opened at once holds drain within 1 s of the time the test read from its request to its grant', LONG, async () => {
  const { box, window } = await scene(7);
  none(box, recordProblems(box, window, {}), 'the record of the window that opened on an empty table doesn\'t hold what criterion 5 names', window);
});
