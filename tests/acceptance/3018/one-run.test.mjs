// #3018, criterion 1: a train of two PRs that touch different packages runs one affected.mjs and takes one test grant,
// and its record lists both PRs with their head SHAs, the main commit and every affected file's result. Written blind
// from issue #3018 and docs/parallel-proof.md section 6a at base b8056599c (README).
import assert from 'node:assert/strict';
import test from 'node:test';
import { affectedRuns, ALPHA, BETA, evidence, fixture, granted, lib, namedBy, notes, prsOf, recordOf, sandbox, statesOf, TEST, train } from './helpers.mjs';

test('#3018.d8181ce1 a train of two PRs that touch different packages runs one affected.mjs under one test grant, and its record lists both PRs with their heads, the main commit and each affected file\'s result', TEST, async (t) => {
  const box = sandbox(t);
  const fx = fixture(box);
  const first = fx.pr(11, { [ALPHA.lib]: lib(true, 'PR 11') });
  const second = fx.pr(12, { [BETA.lib]: lib(true, 'PR 12') });
  const tree = fx.merged(first, second);

  const run = await train(box, fx, `11@${first}`, `12@${second}`);
  const all = evidence(box, fx, run);
  const { record } = recordOf(box, run, all);

  // One affected.mjs, on the train's tree, with every path the train changes from main.
  const runs = affectedRuns(fx);
  assert.equal(runs.length, 1, `the train ran affected.mjs ${runs.length} times, not once\n${all}`);
  assert.equal(runs[0].tree, tree, `affected.mjs ran on the tree ${runs[0].tree}, not on the two PRs merged onto main, ${tree}\n${all}`);
  assert.deepEqual(runs[0].args.filter((arg) => !arg.startsWith('--')).sort(), [ALPHA.lib, BETA.lib], `affected.mjs was not given the paths the train changes from main\n${all}`);
  // Each planted test ran once, in that one run, on both PRs' changes.
  const ran = notes(fx);
  assert.deepEqual(ran.map(({ file }) => file).sort(), [ALPHA.test, BETA.test], `the two packages' tests did not each run once\n${all}`);
  for (const note of ran) assert.equal(note.tree, tree, `${note.file} ran on the tree ${note.tree}, not the train's ${tree}\n${all}`);
  // One test grant, and no other: the run's own; the train takes none.
  const grants = granted(box);
  assert.equal(grants.filter((e) => e.class === 'test').length, 1, `the train took ${grants.filter((e) => e.class === 'test').length} test grants, not one\n${all}`);
  assert.deepEqual(grants.map((e) => `${e.class} ${e.grant}`), ['test top-level'], `the train's grants are not its run's one top-level test grant\n${all}`);

  // The record.
  assert.equal(record.main, fx.main, `the record's main commit is ${record.main}, not origin's ${fx.main}\n${all}`);
  assert.deepEqual(prsOf(record), [{ number: 11, head: first }, { number: 12, head: second }], `the record does not list both PRs with their heads, in train order\n${all}`);
  assert.equal(record.tree, tree, `the record's tree is not the train's\n${all}`);
  assert.deepEqual(statesOf(record.files), [{ file: ALPHA.test, state: 'PASS' }, { file: BETA.test, state: 'PASS' }], `the record does not hold each affected file's result\n${all}`);
  assert.equal(record.state, 'PASS', `the record's state is ${record.state}\n${all}`);
  assert.deepEqual([namedBy(record, ALPHA.test), namedBy(record, BETA.test)], [[11], [12]], `the record's files do not each name the PR whose change selected them\n${all}`);
});
