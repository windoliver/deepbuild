// AC1's two lock cases: `npm ci` is 1 when the change edits the lock, in the change bay, and 1 more in the base bay
// only when the merge base moved past a lock change. Each case warms a pair with a first proof, which isn't counted.
// npm calls are read from a PATH shim that logs each call's folder and arguments, then runs the real npm.
import assert from 'node:assert/strict';
import test from 'node:test';
import { byUse, git, lock, machineRepo, mainMoves, npmCi, pkg, proof, sandbox, show, theBays, write } from './helpers.mjs';

const TIMEOUT = { timeout: 1_200_000 };
const where = (calls) => calls.map(({ cwd, args }) => `  npm ${args} in ${cwd}`).join('\n');

test('#1118.5a7b1fc3 when the change edits the lock, the next proof runs npm ci once, in the change bay', TIMEOUT, async (t) => {
  const box = sandbox(t);
  const fixture = machineRepo(box);
  await proof(box, fixture);
  write(fixture.worktree, { 'package.json': pkg('0.0.1'), 'package-lock.json': lock('0.0.1') });
  git(fixture.worktree, 'commit', '-q', '-am', 'Edit the lock');
  const result = await proof(box, fixture);
  const calls = npmCi(result);
  assert.equal(calls.length, 1, `npm ci ran ${calls.length} times in the proof after the change edited the lock, not once\n${where(calls)}\n${show(result)}`);
  byUse(result, fixture.twin);
  const bays = theBays(box, result, fixture.twin);
  assert.equal(calls[0].cwd, bays.change, `the one npm ci ran in ${calls[0].cwd}, not in the change bay ${bays.change}`);
});

test('#1118.5a7b1fc3 npm ci runs in the base bay only when the merge base moved past a lock change, and once then', TIMEOUT, async (t) => {
  const box = sandbox(t);
  // The change edits the lock; main later lands the same lock bytes, so the change bay's lock never changes.
  const fixture = machineRepo(box, { lockEdit: true });
  await proof(box, fixture);

  mainMoves(fixture, { 'docs/notes.txt': 'main moves past a commit that leaves the lock alone\n' }, 'Add notes');
  const past = await proof(box, fixture);
  const none = npmCi(past);
  assert.equal(none.length, 0, `npm ci ran ${none.length} times after the merge base moved past a commit that leaves the lock alone, not 0\n${where(none)}\n${show(past)}`);
  byUse(past, fixture.twin);
  theBays(box, past, fixture.twin);

  mainMoves(fixture, { 'package.json': pkg('0.0.1'), 'package-lock.json': lock('0.0.1') }, 'Edit the lock');
  const moved = await proof(box, fixture);
  const calls = npmCi(moved);
  assert.equal(calls.length, 1, `npm ci ran ${calls.length} times after the merge base moved past a lock change the change already held, not once\n${where(calls)}\n${show(moved)}`);
  byUse(moved, fixture.twin);
  const bays = theBays(box, moved, fixture.twin);
  assert.equal(calls[0].cwd, bays.base, `the one npm ci ran in ${calls[0].cwd}, not in the base bay ${bays.base}`);
});
