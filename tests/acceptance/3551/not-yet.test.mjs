// #3551, criterion 1 and the Scope's "Not yet": a window asked while a grant is held, less than the overdue span after
// the last window closed, joins no line and stops no grant. The real `node scripts/throttle.mjs window` runs in a
// fixture checkout on a table of the test's own, with the spans at 6 and 12 minutes, one `test` grant held and a
// `window-close` 7 minutes old in the table's log (an older window's lies before it). One scene, played once, on the
// first test's turn; both tests read it.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { ask, askWindow, commandStart, dump, firstLine, how, logWindow, named, none, running, sandbox, scriptRan, seconds, sight, started, table, until, wholeFile, windowIn, windowRecords } from './helpers.mjs';

const LONG = { timeout: 300_000 };
// The scene outlives the test that plays it: its sandbox is removed once the file's tests have all ended.
const FILE = wholeFile(after);

async function play() {
  const box = sandbox(FILE);
  logWindow(box, 40);
  logWindow(box, 7);
  const holder = ask(box, 'test', 'held-test');
  const held = await started(box, holder);
  const before = table(box);
  const window = askWindow(box);
  // The build request is made beside the window: the moment the test sees the window's request in the table, so that
  // a window that drains has it behind its drain, or the moment the window has left, which joined no line to be seen in.
  // deadline: a request joins the table, or a window leaves, within seconds of its process's start; 60 s bound a machine too busy for that.
  await until(() => sight(box, window) || !running(window), 60_000);
  const build = ask(box, 'build', 'beside-build', ['exit']);
  // deadline: a free build grant is dealt at the request's first look; 30 s bound a machine too busy to start it.
  await until(() => { sight(box, window); return commandStart(box, 'beside-build') || !running(build); }, 30_000);
  sight(box, window);
  return { box, holder, held, window, build, before, now: table(box), left: running(window) ? null : scriptRan(box, window) };
}
let played;
const scene = () => (played ??= play());

test('#3551.8190b19e with the spans at 6 and 12 minutes, one test grant held and a window-close 7 minutes old in the log, a window leaves within 2 s, the table holds no request of its own, a build request made beside it is granted, and its first line is INCONCLUSIVE window:, naming 1 grant', LONG, async () => {
  const { box, holder, held, window, build, now, left } = await scene();
  const problems = [];
  // The test's own reading of the table is a real one: it holds the test grant the scene holds.
  assert.ok(now.grants.some((grant) => grant.class === 'test' && grant.id === held.id), `the scene didn't hold: the table the test reads doesn't hold the test grant ${held.id}\n${dump(box, holder, window, build)}`);

  // "A window leaves within 2 s": from the moment its script starts to run in its process to that process's exit,
  // both on the process's own clock (README: The 2 s).
  // deadline: the criterion's own 2 s.
  if (!left) problems.push(`the window didn't leave: ${running(window) ? `it still waits ${seconds(window.asked)} after it was asked` : 'its process noted no start and exit'}${window.own ? `, its ${named(window.own)} in the table` : ''}`);
  else if (left.ms > 2_000) problems.push(`the window left ${left.ms} ms after its script started to run, not within 2 s`);

  // "The table holds no request of its own": at no look of the test, from its asking to its end, and none left after.
  if (window.own) problems.push(`the table held a request of the window's own: the ${named(window.own)}, first seen ${seconds(window.asked, window.own.seen)} after the window was asked${now.requests.some((request) => request.id === window.own.id) ? ' and still there' : ''}`);

  // "A build request made beside it is granted": its command ran under a build grant.
  const granted = commandStart(box, 'beside-build');
  const waits = now.requests.find((request) => request.pid === build.pid);
  if (!granted) problems.push(`the build request made beside it was not granted: ${seconds(build.asked)} after it was made ${waits ? `its ${named(waits)} still waits in the table${window.own ? `, behind the window's ${named(window.own)}` : ''}` : `its command hasn't run (${how(build)})`}`);
  else if (!/^build:\S+$/.test(String(granted.grant))) problems.push(`the build request's command ran under no build grant: ${granted.grant}`);

  // "The first line is `INCONCLUSIVE window:`, naming 1 grant."
  const first = firstLine(window);
  if (!first.startsWith('INCONCLUSIVE window:')) problems.push(`the window's first line isn't \`INCONCLUSIVE window:\`: ${first ? JSON.stringify(first) : 'it has printed nothing'}`);
  else if (!/\b1 grants?\b/.test(first)) problems.push(`the window's first line doesn't name 1 grant: ${JSON.stringify(first)}`);

  none(box, problems, 'with a test grant held and the last window closed 7 minutes ago, inside the 12 of DEEP_WINDOW_OVERDUE_MIN, the window is not yet due, but', window, build, holder);
});

test('Scope, Not yet: the window prints `INCONCLUSIVE window: 1 grants held; the last window closed <h> h ago`, exits as a window with no grant does today, 3, and stops nothing: the held grant is still held and no window opened', LONG, async () => {
  const { box, holder, held, window, build, before, now } = await scene();
  const all = () => dump(box, window, build, holder);
  assert.ok(!running(window), `the window didn't leave: it still waits ${seconds(window.asked)} after it was asked\n${all()}`);
  const first = firstLine(window);
  const line = first.match(/^INCONCLUSIVE window: 1 grants? held; the last window closed (\d+(?:\.\d+)?) h ago/);
  assert.ok(line, `the window's first line isn't \`INCONCLUSIVE window: <n> grants held; the last window closed <h> h ago\` with 1 grant: ${first ? JSON.stringify(first) : 'it printed nothing'}\n${all()}`);
  // 7 minutes are 0.12 h; however the hours are rounded, they lie from 0 to 1.
  assert.ok(Number(line[1]) >= 0 && Number(line[1]) <= 1, `the window's first line gives ${line[1]} h for a window that closed 7 minutes ago: ${JSON.stringify(first)}\n${all()}`);
  assert.equal(window.exitCode, 3, `a window that leaves exits as a window with no grant does today, 3\n${all()}`);
  const mine = ({ grants }) => grants.find((grant) => grant.id === held.id);
  assert.ok(running(holder) && mine(now), `the window stopped the held test grant ${held.id}: ${how(holder)}\n${all()}`);
  assert.deepEqual(mine(now), mine(before), `the window changed the held test grant ${held.id} in the table\n${all()}`);
  const { log, open, id } = windowIn(box, window);
  assert.equal(open, -1, `a window that left opened: the log holds a window-open for grant ${id} since it was asked\n${all()}`);
  assert.deepEqual(log.filter((line) => line.event === 'granted' && line.class === 'timed'), [], `a window that left was given a timed grant\n${all()}`);
  assert.deepEqual(windowRecords(box), [], `a window that left wrote a record of its own\n${all()}`);
});
