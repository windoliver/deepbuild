// #1114: failures on main equal today's. The same tree of tests, a failing timed file, a failing untimed one (already
// known to main) and a passing one, runs under the merge base's scripts ("before") and under this checkout's ("after"),
// both as `affected.mjs --timed <paths>`, and the two runs list the same FAIL, NEW FAIL and KNOWN ids
// (README: AC5, before and after).
import assert from 'node:assert/strict';
import test from 'node:test';
import { affected, affectedTree, dump, failIds, loaded, mergeBaseScripts, probe, sandbox, timedPath } from './helpers.mjs';

const FAILS = ['tests', 'fixture-1114', 'fails.test.mjs'].join('/');
const PASSES = ['tests', 'fixture-1114', 'plain.test.mjs'].join('/');
const failing = { imports: "import assert from 'node:assert/strict';", body: 'assert.equal(1, 2);' };

test('#1114.f626edec failures on main equal today\'s: a run with the merge base\'s scripts and one with the change\'s, on the same paths, list the same FAIL ids', async (t) => {
  const problem = loaded();
  if (problem) return t.skip(problem);
  const box = sandbox(t);
  const TIMED = timedPath();
  const files = {
    [TIMED]: probe('timed', 'the timed probe fails', failing),
    [FAILS]: probe('fails', 'the untimed probe fails', failing),
    [PASSES]: probe('plain', 'the plain probe passes'),
  };
  // The untimed failure is one main already has, so it reads KNOWN; the timed one is NEW FAIL.
  const failures = { [`${FAILS} › the untimed probe fails`]: 'fails on main (#1114 fixture)' };
  const { rev, scripts } = mergeBaseScripts(box);
  const beforeTree = affectedTree(box, files, { scripts, name: 'before', failures });
  const afterTree = affectedTree(box, files, { name: 'after', failures });
  const paths = [TIMED, FAILS, PASSES];
  const before = await affected(box, beforeTree, ['--timed', ...paths]);
  const after = await affected(box, afterTree, ['--timed', ...paths]);
  const all = `merge base ${rev}\n--- before\n${dump(box, before)}\n--- after\n${dump(box, after)}`;
  const was = failIds(before.stdout), now = failIds(after.stdout);
  assert.ok(was.includes(`${TIMED} › the timed probe fails`) && was.includes(`${FAILS} › the untimed probe fails`), `the run with the merge base's scripts did not list both planted failures, so it shows nothing to compare\n${all}`);
  assert.deepEqual(now, was, `the change's scripts list other FAIL ids than the merge base's on the same paths\n${all}`);
});
