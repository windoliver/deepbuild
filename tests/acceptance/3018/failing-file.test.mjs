// #3018, criterion 3: a file that fails in a train names the PR whose changes selected it. Written blind from issue
// #3018 and docs/parallel-proof.md section 6a at base b8056599c (README).
import assert from 'node:assert/strict';
import test from 'node:test';
import { ALPHA, BETA, evidence, fixture, lib, namedBy, notes, prLines, reads, recordOf, sandbox, statesOf, TEST, train } from './helpers.mjs';

test('#3018.ccecaf52 in a train of two PRs, the file that fails names the PR whose change selected it, in the record and in that PR\'s line, and not the other PR', TEST, async (t) => {
  const box = sandbox(t);
  const fx = fixture(box);
  // The first PR's package stays sound; the second breaks its own package, so only alpha's test fails.
  const first = fx.pr(31, { [BETA.lib]: lib(true, 'PR 31') });
  const second = fx.pr(32, { [ALPHA.lib]: lib(false, 'PR 32') });

  const run = await train(box, fx, `31@${first}`, `32@${second}`);
  const all = evidence(box, fx, run);
  const { path, record } = recordOf(box, run, all);

  assert.deepEqual(notes(fx).map(({ file, sound }) => ({ file, sound })).sort((a, b) => a.file.localeCompare(b.file)), [{ file: ALPHA.test, sound: false }, { file: BETA.test, sound: true }], `the two packages' tests did not run on the train's changes\n${all}`);
  assert.deepEqual(statesOf(record.files), [{ file: ALPHA.test, state: 'FAIL' }, { file: BETA.test, state: 'PASS' }], `the record's file results are not alpha's FAIL and beta's PASS\n${all}`);
  assert.equal(record.state, 'FAIL', `the record's state is ${record.state}, not FAIL\n${all}`);
  assert.deepEqual(namedBy(record, ALPHA.test), [32], `the failing file names the PRs ${JSON.stringify(namedBy(record, ALPHA.test))}, not #32, whose change selected it\n${all}`);
  assert.deepEqual(namedBy(record, BETA.test), [31], `the passing file names the PRs ${JSON.stringify(namedBy(record, BETA.test))}, not #31\n${all}`);

  // The run ends with a line for each PR, and --read prints the same: FAIL for the PR the failing file names.
  const read = await train(box, fx, '--read', path);
  const both = evidence(box, fx, run, read);
  for (const [name, output] of [['the run', run.stdout], ['--read', read.stdout]]) {
    const why = reads(output, 32, 'FAIL', second, `${name}:\n${both}`);
    assert.ok(why.includes(ALPHA.test), `${name}: #32's FAIL line doesn't name the failing file ${ALPHA.test}: "${why}"\n${both}`);
    assert.ok(!why.includes(BETA.test), `${name}: #32's FAIL line names ${BETA.test}, which passed\n${both}`);
    assert.equal(reads(output, 31, 'INCONCLUSIVE', first, `${name}:\n${both}`), 'the train read FAIL', `${name}: #31's line doesn't read "the train read FAIL"\n${both}`);
    assert.deepEqual([...prLines(output).keys()].sort(), [31, 32], `${name}: the lines are not one for each PR\n${both}`);
  }
  assert.equal(read.status, 1, `--read exited ${read.status}, not 1\n${both}`);
});
