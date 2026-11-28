// #3551, the Scope's "When it closed": the last window's close is read from the throttle's log, and a log that can't
// be read is `BLOCKED throttle`, never a log that holds no window. The real `node scripts/throttle.mjs window` runs in
// a fixture checkout on a table of the test's own with no grant held, whose log holds a `window-close` 7 minutes old
// and can be written but not read (mode 0200). That the newest `window-close` is the one read is held by criteria 1
// and 2, whose logs hold an older window's before it.
import assert from 'node:assert/strict';
import { chmodSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { askWindow, dump, firstLine, logLines, logWindow, sandbox, watched, windowIn, windowRecords } from './helpers.mjs';

// Root reads a file of any mode, so there no log is unreadable.
const ROOT = process.getuid?.() === 0 ? 'INCONCLUSIVE (root): root reads a file of any mode, so no log is one that can\'t be read' : false;

test('Scope, When it closed: with a log that can\'t be read, the window\'s first line is BLOCKED throttle, it exits non-zero and opens nothing', { timeout: 300_000, skip: ROOT }, async (t) => {
  const box = sandbox(t);
  logWindow(box, 40);
  logWindow(box, 7);
  const log = join(box.table, 'log'), mark = logLines(box).length;
  chmodSync(log, 0o200);
  const window = askWindow(box, mark);
  // deadline: a window that can't read its log ends at once, and one that opens closes within seconds; 120 s bound a machine too busy for that.
  await watched(box, window, 120_000);
  chmodSync(log, 0o600);
  const all = () => dump(box, window);
  const first = firstLine(window);
  assert.ok(first.startsWith('BLOCKED throttle'), `with a log it can't read, the window's first line isn't \`BLOCKED throttle\`: ${first ? JSON.stringify(first) : 'it printed nothing'}\n${all()}`);
  assert.ok(window.run && window.run.status !== 0, `a window that can't read its log exits non-zero\n${all()}`);
  const { open, id } = windowIn(box, window);
  assert.equal(open, -1, `a window that couldn't read when the last window closed opened: the log holds a window-open for grant ${id}\n${all()}`);
  assert.deepEqual(windowRecords(box), [], `a window that couldn't read its log wrote a record of its own\n${all()}`);
});
