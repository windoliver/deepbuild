// Blind redraft, under #1874's rule, of the three #1116 trap tests that expect a later window to close the issue
// (REDRAFT.md). Each is the original but for its fixture: the task names the issue's budget criterion by ID, so a
// window that meets #1874 can close it. Names and expected values are #1116's.
import assert from 'node:assert/strict';
import { cpus } from 'node:os';
import test from 'node:test';
import { dump, ended, fullWindow, hold, issue, launch, LONG, openWindow, recordOf, records, samples, sandbox, started, until } from '../1116/helpers.mjs';
import { oneMerged } from './helpers.mjs';

const firstLine = (run) => (run.stdout || run.stderr).split('\n').find((line) => line.trim()) ?? '';
function closedByAWindow(box, commit, number, run) {
  assert.equal(recordOf(box, commit)?.state, 'PASS', `the next window didn't measure ${commit}\n${dump(box, run)}`);
  assert.equal(issue(box, number).state, 'CLOSED', `the next window's pass didn't close #${number}\n${dump(box, run)}`);
}

test('a window that gets no grant at a load above the cores measures nothing, reopens, and leaves its commit for the next', LONG, async (t) => {
  const box = sandbox(t);
  const { repo, commit } = await oneMerged(box, 9202);
  const refused = await fullWindow(box, repo, { wait: 0.05, env: { T1116_LOAD: String(cpus().length + 10) } });
  assert.notEqual(refused.status, 0, dump(box, refused));
  assert.match(firstLine(refused), /^INCONCLUSIVE no grant/, dump(box, refused));
  assert.equal(samples(box).length, 0, `samples were taken with no grant\n${dump(box, refused)}`);
  assert.deepEqual(records(box), [], `a record with no grant\n${dump(box, refused)}`);
  assert.equal(issue(box, 9202).state, 'OPEN', dump(box, refused));
  hold(box, repo, 'build', 1, { name: 'after' });
  await started(box, 'after', 30_000);
  closedByAWindow(box, commit, 9202, await fullWindow(box, repo));
});

test('a window killed mid-sample reopens, closes nothing, and leaves its commit for the next', LONG, async (t) => {
  const box = sandbox(t);
  const { repo, commit } = await oneMerged(box, 9203);
  const window = openWindow(box, repo);
  await until(() => window.exited || samples(box).length > 0, 120_000);
  if (window.exited) assert.fail(`the window ended with no sample to stop it at\n${dump(box, await window.done)}`);
  process.kill(-window.pid, 'SIGKILL');
  const killed = await window.done;
  hold(box, repo, 'build', 1, { name: 'after' });
  await started(box, 'after', 30_000);
  assert.equal(issue(box, 9203).state, 'OPEN', `a killed window closed the issue\n${dump(box, killed)}`);
  assert.notEqual(recordOf(box, commit)?.state, 'PASS', `a killed window left a PASS\n${dump(box, killed)}`);
  closedByAWindow(box, commit, 9203, await fullWindow(box, repo));
});

test('budget-window.mjs run by hand, with a forged DEEP_THROTTLE, measures nothing and closes nothing', LONG, async (t) => {
  const box = sandbox(t);
  const { repo, commit } = await oneMerged(box, 9204);
  const run = await ended(launch(box, [process.execPath, repo.window], { cwd: repo.mac, env: { DEEP_THROTTLE: 'timed:0123456789abcdef' } }), 120_000);
  assert.notEqual(run.status, 0, dump(box, run));
  assert.equal(samples(box).length, 0, `samples outside a window\n${dump(box, run)}`);
  assert.deepEqual(records(box), [], `a record outside a window\n${dump(box, run)}`);
  assert.equal(issue(box, 9204).state, 'OPEN', dump(box, run));
  closedByAWindow(box, commit, 9204, await fullWindow(box, repo));
});
