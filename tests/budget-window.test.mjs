// #1116, beside the blind suite: what a real window runs into that its scene doesn't. A window outlasts a caller's
// grant wait, and two commits of one issue can land in one window. The scene's helpers are reused, not its tests.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import test from 'node:test';
import { dump, ended, fileIssue, fixture, followUps, fullWindow, hold, holder, issue, logLines, LONG, marked, openWindow, recordOf, REGRESSED, sandbox, until } from './acceptance/1116/helpers.mjs';

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
