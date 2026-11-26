// #1116, beside the blind suite: what a real window runs into that its scene doesn't. A window outlasts a caller's
// grant wait, and two commits of one issue can land in one window. The scene's helpers are reused, not its tests.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dump, ended, fileIssue, fixture, followUps, fullWindow, hold, holder, issue, launch, logLines, LONG, marked, openWindow, recordOf, REGRESSED, sandbox, started, until } from './acceptance/1116/helpers.mjs';

test('a build whose grant wait is shorter than the window still starts when the window ends', LONG, async (t) => {
  const box = sandbox(t);
  const repo = fixture(box);
  // The throttle is what's under test, so the window only lasts: long past the wait, on a loaded machine too.
  writeFileSync(repo.window, 'setTimeout(() => {}, 15_000);\n');
  const window = openWindow(box, repo);
  assert.ok(await until(() => logLines(box).some(({ event }) => event === 'window-open'), 120_000), dump(box));
  const build = hold(box, repo, 'build', 0.02, { name: 'short' });
  const run = await ended(window, 120_000);
  const asked = await ended(build, 60_000);
  const close = Date.parse(logLines(box).find(({ event }) => event === 'window-close').at);
  assert.ok(holder(box, 'short', 'start')?.t > close, `the wait ran out inside the window, or the build ran in it\n${dump(box, run, asked)}`);
  assert.equal(asked.status, 0, dump(box, run, asked));
});

test('a pass leaves its issue open while a later commit of that issue waits in the same window, and the miss keeps it open', LONG, async (t) => {
  const box = sandbox(t);
  const number = 9302, repo = fixture(box);
  fileIssue(box, number);
  await marked(box, repo);
  repo.branch('first', repo.r1, number);
  const passed = repo.merge('first', number);
  repo.branch('second', passed, number, { 'work.sh': REGRESSED });
  const missed = repo.merge('second', number);
  const run = await fullWindow(box, repo);
  assert.equal(recordOf(box, passed)?.state, 'PASS', dump(box, run));
  assert.equal(recordOf(box, missed)?.state, 'FAIL', dump(box, run));
  assert.equal(issue(box, number).state, 'OPEN', `the first commit's pass closed the issue its second commit missed on\n${dump(box, run)}`);
  assert.equal(followUps(box).length, 1, dump(box, run));
});

// #3551, beside its blind suite: what no test there can wait for, and what its scenes don't play. The spans on the
// machine's table are hours, so their edges are read from the rule. A second window, a run's turns, a bay pair and a
// log line cut short are played on a test's own table, whose spans are minutes.
const SPANS = { DEEP_WINDOW_APART_MIN: '6', DEEP_WINDOW_OVERDUE_MIN: '12' };
const table = (box) => JSON.parse(readFileSync(join(box.home, '.deepbuild', 'throttle', 'table.json'), 'utf8'));
const closed = (minutes) => JSON.stringify({ at: new Date(Date.now() - minutes * 60_000).toISOString(), event: 'window-close', id: 'earlier', pid: 1 });
/** A table whose log holds `text`, before any request. */
function logged(box, text) {
  mkdirSync(join(box.home, '.deepbuild', 'throttle'), { recursive: true });
  writeFileSync(join(box.home, '.deepbuild', 'throttle', 'log'), text);
}

test('the rule: with no grant held a window opens 6 hours after the last closed, and with one held it drains 12 hours after', async () => {
  const { windowCase } = await import(fileURLToPath(new URL('../scripts/throttle.mjs', import.meta.url)));
  assert.equal(typeof windowCase, 'function', 'throttle.mjs has no rule for when a window is due');
  const HOUR = 60;
  assert.equal(windowCase(0, 6 * HOUR), 'empty');
  assert.equal(windowCase(0, 6 * HOUR - 1), 'not yet', 'an empty table opened a window under 6 hours after the last closed');
  assert.equal(windowCase(1, 6 * HOUR), 'not yet', 'a window joined the line behind a held grant, 6 hours after the last closed');
  assert.equal(windowCase(1, 12 * HOUR - 1), 'not yet', 'a window joined the line behind a held grant under 12 hours after the last closed');
  assert.equal(windowCase(1, 12 * HOUR), 'overdue');
  assert.equal(windowCase(0, 12 * HOUR), 'overdue');
  assert.equal(windowCase(3, Infinity), 'overdue', 'a log with no window-close wasn\'t overdue');
  // A test's own table names its spans, and one it doesn't name is none: every window there is overdue.
  assert.equal(windowCase(1, 7, [6, 12]), 'not yet');
  assert.equal(windowCase(0, 5, [6, 12]), 'not yet');
  assert.equal(windowCase(2, 0, [0, 0]), 'overdue');
});

test('a window asked while another waits for its grant, or is open, leaves and joins no line', LONG, async (t) => {
  const box = sandbox(t);
  const repo = fixture(box);
  const requests = () => table(box).requests;
  const opens = () => logLines(box).filter(({ event }) => event === 'window-open').length;
  writeFileSync(repo.window, 'setTimeout(() => {}, 8_000);\n');
  hold(box, repo, 'test', 1, { name: 'held', hold: 12_000 });
  await started(box, 'held');
  const first = openWindow(box, repo);
  assert.ok(await until(() => requests().some((request) => request.pid === first.pid), 30_000), dump(box));
  const beside = await ended(openWindow(box, repo), 30_000);
  assert.match(beside.stdout, /^INCONCLUSIVE window: another window, asked by pid \d+, waits for its grant\n/, dump(box, beside));
  assert.equal(beside.status, 3, dump(box, beside));
  assert.deepEqual(requests().map(({ pid }) => pid), [first.pid], dump(box, beside));
  assert.ok(await until(() => opens() === 1, 60_000), dump(box));
  const inside = await ended(openWindow(box, repo), 30_000);
  assert.match(inside.stdout, /^INCONCLUSIVE window: another window, asked by pid \d+, is open\n/, dump(box, inside));
  assert.equal((await ended(first, 60_000)).status, 0, dump(box));
  assert.equal(opens(), 1, dump(box));
});

test('a window that leaves counts a run\'s grant once, whatever turns its jobs hold, and a bay pair\'s', LONG, async (t) => {
  const box = sandbox(t);
  const repo = fixture(box);
  logged(box, `${closed(7)}\n`);
  // A run admitted on its test grant, whose one job holds a turn, beside a bay pair.
  launch(box, [process.execPath, repo.throttle, 'test', '--', process.execPath, repo.throttle, 'test', '--', process.execPath, box.stub, JSON.stringify({ name: 'job', hold: 60_000 })], { env: { DEEP_THROTTLE_RUN: '0' } });
  hold(box, repo, 'bay-pair', 1, { name: 'pair', hold: 60_000 });
  await started(box, 'job');
  await started(box, 'pair');
  assert.deepEqual(table(box).grants.map((grant) => grant.class).sort(), ['bay-pair', 'test', 'turn'], dump(box));
  const run = await ended(openWindow(box, repo, { env: SPANS }), 30_000);
  assert.match(run.stdout, /^INCONCLUSIVE window: 2 grants held; the last window closed 0\.1 h ago\n/, dump(box, run));
  assert.equal(run.status, 3, dump(box, run));
});

test('a log line a full disk cut short names no close: the window goes by the newest whole one', LONG, async (t) => {
  const box = sandbox(t);
  const repo = fixture(box);
  logged(box, `${closed(5)}\n${closed(0).slice(0, -9)}`);
  const run = await ended(openWindow(box, repo, { env: SPANS }), 30_000);
  // The scene's dump reads every log line as JSON, so the window's own output is shown.
  const said = `exit ${run.status}\n${run.stdout}${run.stderr}`;
  assert.match(run.stdout, /^INCONCLUSIVE window: 0 grants held; the last window closed 0\.1 h ago\n/, said);
  assert.equal(run.status, 3, said);
});
