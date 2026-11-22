// #3018, criterion 5: a train of one PR gives the same file results as that PR's own affected.mjs run at the same main
// commit. Written blind from issue #3018 and docs/parallel-proof.md section 6a at base b8056599c (README).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { ALPHA, BETA, evidence, fixture, idOf, lib, node, nodeFile, prsOf, recordOf, sandbox, statesOf, TEST, timedPath, train } from './helpers.mjs';

const KNOWN = 'tests/fixture-3018/known.test.mjs';
const known = (by) => nodeFile(`// written by ${by}\ntest('a failure main already has', () => { assert.equal(1, 2); });`);

test('#3018.b346cfaa a train of one PR records the same result for each file as the PR\'s own affected.mjs --results run at the same main commit: a pass, a new failure, a known failure and an unrun timed file', TEST, async (t) => {
  const box = sandbox(t);
  const TIMED = timedPath('mjs');
  const fx = fixture(box, {
    files: { [KNOWN]: known('main'), [TIMED]: nodeFile("// written by main\ntest('a timed test', () => { assert.equal(1, 1); });") },
    failures: { [idOf(KNOWN, 'a failure main already has')]: 'planted for #3018' },
  });
  // One PR whose files read four ways: alpha's test passes, beta's fails anew, one fails as on main, one is left to --timed.
  const head = fx.pr(51, {
    [ALPHA.lib]: lib(true, 'PR 51'),
    [BETA.lib]: lib(false, 'PR 51'),
    [KNOWN]: known('PR 51'),
    [TIMED]: nodeFile("// written by PR 51\ntest('a timed test', () => { assert.equal(1, 1); });"),
  });
  const expected = [{ file: ALPHA.test, state: 'PASS' }, { file: BETA.test, state: 'FAIL' }, { file: KNOWN, state: 'KNOWN' }, { file: TIMED, state: 'INCONCLUSIVE' }].sort((a, b) => a.file.localeCompare(b.file));

  // The PR's own run: its head, which sits on the main commit, checked out, and affected.mjs on its change from origin/main.
  const results = join(box.dir, 'own-results.json');
  fx.git('fetch', '-q', 'origin', 'refs/pull/51/head');
  fx.git('checkout', '-q', '--detach', head);
  const own = await node(box, fx, ['scripts/affected.mjs', `--results=${results}`]);
  fx.git('checkout', '-q', 'main');
  const first = evidence(box, fx, own);
  assert.ok(existsSync(results), `the PR's own affected.mjs --results=<file> run wrote no results file\n${first}`);
  const ownResults = JSON.parse(readFileSync(results, 'utf8'));
  assert.deepEqual(statesOf(ownResults.files), expected, `the PR's own run did not read its four files as a pass, a new failure, a known failure and an unrun timed file\n${first}`);
  assert.equal(ownResults.state, 'FAIL', `the PR's own run's state is ${ownResults.state}\n${first}`);

  const run = await train(box, fx, `51@${head}`);
  const all = evidence(box, fx, own, run);
  const { record } = recordOf(box, run, all);
  assert.equal(record.main, fx.main, `the train was not built on the main commit the PR's own run had\n${all}`);
  assert.deepEqual(prsOf(record), [{ number: 51, head }], `the record's PRs are not the one PR at its head\n${all}`);
  assert.deepEqual(statesOf(record.files), statesOf(ownResults.files), `the train's file results differ from the PR's own run's\n${all}`);
  assert.equal(record.state, ownResults.state, `the train's state differs from the PR's own run's\n${all}`);
});
