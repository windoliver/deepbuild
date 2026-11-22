// #3018, criterion 4: after main moves or a PR's head changes, that PR's train result reads INCONCLUSIVE, not PASS.
// Written blind from issue #3018 and docs/parallel-proof.md section 6a at base b8056599c (README).
import assert from 'node:assert/strict';
import test from 'node:test';
import { ALPHA, BETA, evidence, fixture, lib, moved, prLines, reads, recordOf, sandbox, TEST, train } from './helpers.mjs';

/** A green train of two PRs, read once while nothing has moved: both PRs read PASS and --read exits 0. */
async function green(t, numbers) {
  const box = sandbox(t);
  const fx = fixture(box);
  const heads = [fx.pr(numbers[0], { [ALPHA.lib]: lib(true, `PR ${numbers[0]}`) }), fx.pr(numbers[1], { [BETA.lib]: lib(true, `PR ${numbers[1]}`) })];
  const run = await train(box, fx, `${numbers[0]}@${heads[0]}`, `${numbers[1]}@${heads[1]}`);
  const { path, record } = recordOf(box, run, evidence(box, fx, run));
  const still = await train(box, fx, '--read', path);
  const all = evidence(box, fx, run, still);
  assert.equal(record.state, 'PASS', `the train's record reads ${record.state}, not PASS\n${all}`);
  for (const [index, number] of numbers.entries()) reads(still.stdout, number, 'PASS', heads[index], all);
  assert.equal(still.status, 0, `--read exited ${still.status} while main and both heads were as the train built on them\n${all}`);
  return { box, fx, heads, path, run, still };
}
const noPass = (stdout, all) => assert.deepEqual(stdout.split('\n').filter((line) => /^(?:PASS|NO NEW FAILURES)\b/.test(line)), [], `a line still reads PASS\n${all}`);

test('#3018.e7f2db4e after main moves, each PR of a green train reads INCONCLUSIVE naming main\'s move, not PASS', TEST, async (t) => {
  const { box, fx, heads, path, run, still } = await green(t, [41, 42]);
  const now = fx.moveMain({ 'docs/moved.md': 'main moved\n' });

  const read = await train(box, fx, '--read', path);
  const all = evidence(box, fx, run, still, read);
  for (const [index, number] of [41, 42].entries()) moved(reads(read.stdout, number, 'INCONCLUSIVE', heads[index], all), 'main', fx.main, now, all);
  assert.deepEqual([...prLines(read.stdout).keys()].sort(), [41, 42], `the lines are not one for each PR\n${all}`);
  noPass(read.stdout, all);
  assert.equal(read.status, 2, `--read exited ${read.status}, not 2\n${all}`);
});

test('#3018.e7f2db4e after one PR\'s head changes, that PR and the other PR of the green train read INCONCLUSIVE naming the moved head, not PASS', TEST, async (t) => {
  const { box, fx, heads, path, run, still } = await green(t, [43, 44]);
  const now = fx.pr(44, { [BETA.lib]: lib(true, 'PR 44, pushed again') });

  const read = await train(box, fx, '--read', path);
  const all = evidence(box, fx, run, still, read);
  for (const [index, number] of [43, 44].entries()) moved(reads(read.stdout, number, 'INCONCLUSIVE', heads[index], all), "#44's head", heads[1], now, all);
  assert.deepEqual([...prLines(read.stdout).keys()].sort(), [43, 44], `the lines are not one for each PR\n${all}`);
  noPass(read.stdout, all);
  assert.equal(read.status, 2, `--read exited ${read.status}, not 2\n${all}`);
});
