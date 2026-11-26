// #1116, beside the blind suite: what a real window runs into that its scene doesn't. A window outlasts a caller's
// grant wait, and two commits of one issue can land in one window. The scene's helpers are reused, not its tests.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { dump, ended, fileIssue, fixture, followUps, fullWindow, hold, holder, issue, logLines, LONG, marked, openWindow, recordOf, REGRESSED, sandbox, started, until } from './acceptance/1116/helpers.mjs';

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

// #3551: a window is asked each hour, so one is asked while another still drains or runs.
test('a window asked while another waits for its grant, or is open, leaves and joins no line', LONG, async (t) => {
  const box = sandbox(t);
  const repo = fixture(box);
  const requests = () => JSON.parse(readFileSync(join(box.home, '.deepbuild', 'throttle', 'table.json'), 'utf8')).requests;
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
