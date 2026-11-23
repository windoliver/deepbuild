// #3018, criterion 2: a train whose PRs conflict stops before any test runs and names the PR that didn't merge.
// Written blind from issue #3018 and docs/parallel-proof.md section 6a at base b8056599c (README).
import assert from 'node:assert/strict';
import test from 'node:test';
import { affectedRuns, ALPHA, evidence, fixture, granted, lib, notes, recordFiles, sandbox, TEST, train } from './helpers.mjs';

test('#3018.3731c052 a train whose second PR conflicts with its first stops BLOCKED naming the second, before any test runs, and leaves no record', TEST, async (t) => {
  const box = sandbox(t);
  const fx = fixture(box);
  // Both PRs rewrite the same lines of the same file, each its own way: either merges alone, the second not after the first.
  const first = fx.pr(21, { [ALPHA.lib]: lib(true, 'PR 21') });
  const second = fx.pr(22, { [ALPHA.lib]: lib(true, 'PR 22') });
  const before = fx.where();

  const run = await train(box, fx, `21@${first}`, `22@${second}`);
  const all = evidence(box, fx, run);

  const blocked = run.stdout.split('\n').filter((line) => line.startsWith('BLOCKED train: '));
  assert.equal(blocked.length, 1, `the train printed ${blocked.length} "BLOCKED train:" lines, not the one naming the PR that didn't merge\n${all}`);
  const [, after, paths] = blocked[0].match(/^BLOCKED train: #22 doesn't merge after (.+): conflict in (.+)$/) ?? [];
  assert.ok(after, `the line doesn't read "BLOCKED train: #22 doesn't merge after <what was merged before it>: conflict in <paths>": ${blocked[0]}\n${all}`);
  assert.match(after, /\b21\b/, `the line doesn't name #21 as merged before it: ${blocked[0]}\n${all}`);
  assert.ok(paths.includes(ALPHA.lib), `the line doesn't name the conflicting path ${ALPHA.lib}: ${blocked[0]}\n${all}`);
  assert.equal(run.status, 3, `the train exited ${run.status}, not 3\n${all}`);
  // Nothing ran, nothing was asked of the table, nothing was checked out and no record was written.
  assert.deepEqual(notes(fx), [], `a planted test ran\n${all}`);
  assert.deepEqual(affectedRuns(fx), [], `affected.mjs ran\n${all}`);
  assert.deepEqual(granted(box), [], `a grant was taken\n${all}`);
  assert.ok(!run.stdout.split('\n').some((line) => /^RECORD\b/.test(line)), `the train printed a RECORD line\n${all}`);
  assert.deepEqual(recordFiles(box), [], `the train left a record\n${all}`);
  assert.deepEqual(fx.where(), before, `the checkout is not where it was\n${all}`);
});
