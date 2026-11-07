// #1116: what a wrong program would get wrong around the criteria, each on one merged commit in its own sandbox. A
// commit not yet measured leaves its issue open; a reading never closes one; the budget under judgement isn't the
// commit's to move; and a window is the only way in. These carry no criterion's tag: each holds a line of the issue's
// Scope or of the design's invariants (README).
import assert from 'node:assert/strict';
import { cpus } from 'node:os';
import test from 'node:test';
import { budgets, dump, ended, fullWindow, hold, issue, launch, LONG, oneMerged, openWindow, recordOf, records, REGRESSED, samples, sandbox, started, until } from './helpers.mjs';

const firstLine = (run) => (run.stdout || run.stderr).split('\n').find((line) => line.trim()) ?? '';
function closedByAWindow(box, commit, number, run) {
  assert.equal(recordOf(box, commit)?.state, 'PASS', `the next window didn't measure ${commit}\n${dump(box, run)}`);
  assert.equal(issue(box, number).state, 'CLOSED', `the next window's pass didn't close #${number}\n${dump(box, run)}`);
}

test('a window off the reference Macs is a reading: its record is INCONCLUSIVE and its issue stays open', LONG, async (t) => {
  const box = sandbox(t, { model: 'Mac17,10' });
  const { repo, commit } = await oneMerged(box, 9201);
  const run = await fullWindow(box, repo);
  assert.equal(recordOf(box, commit)?.state, 'INCONCLUSIVE', `the record off the reference Macs\n${dump(box, run)}`);
  assert.equal(issue(box, 9201).state, 'OPEN', `a reading closed the issue\n${dump(box, run)}`);
});

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

test('a commit that raises its own margin to hide a 2× regression doesn\'t pass: budget numbers stay unchanged', LONG, async (t) => {
  const box = sandbox(t);
  const { repo, commit } = await oneMerged(box, 9205, { files: { 'work.sh': REGRESSED, 'benchmarks/budgets.json': budgets(10) } });
  const run = await fullWindow(box, repo);
  const record = recordOf(box, commit);
  assert.ok(record, `no record for the commit\n${dump(box, run)}`);
  assert.notEqual(record.state, 'PASS', `the commit's own margin passed it\n${dump(box, run)}`);
  assert.equal(issue(box, 9205).state, 'OPEN', dump(box, run));
});
