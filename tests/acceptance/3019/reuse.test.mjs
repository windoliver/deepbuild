// AC1: two before runs at the same merge base on one machine build the merge-base tree once, and the second run's log
// says it reused the build, naming the tree hash. The runs are of two worktrees, two changes, at one merge base.
import assert from 'node:assert/strict';
import test from 'node:test';
import { builds, machineRepo, mergeBase, proof, sandbox, show, timesBuilt, TIMEOUT, worktree } from './helpers.mjs';

test('#3019.52ff5ba5 two before runs at one merge base build its tree once, and the second says it reused that build, naming the tree hash', TIMEOUT, async (t) => {
  const box = sandbox(t);
  const fixture = machineRepo(box);
  const other = worktree(fixture, 'w2', { 'docs/w2.txt': 'a second change at the same merge base\n' });
  const base = mergeBase(fixture.worktree);
  assert.equal(mergeBase(other).tree, base.tree, 'the fixture\'s two worktrees are not at one merge base');
  const { base: baseBuild } = builds(fixture.worktree);

  const first = await proof(box, fixture);
  const second = await proof(box, fixture, { cwd: other });
  const times = [first, second].map((result) => timesBuilt(result, baseBuild));
  assert.equal(times[0] + times[1], 1, `the merge-base tree ${base.tree} was built ${times[0]} time(s) in the first run and ${times[1]} in the second, not once in all\n${show(first)}\n${show(second)}`);
  assert.equal(times[0], 1, `the first run, into an empty cache, built the merge-base tree ${times[0]} times, not once\n${show(first)}`);

  const reuse = second.lines.filter((line) => line.role === 'base' && line.reused === true && line.tree === base.tree);
  assert.ok(reuse.length, `the second run printed no line BUILD {"role":"base","reused":true,"tree":"${base.tree}",…}\n${show(second)}`);
  // The reused build is the one the tests read: the second run's verdicts are the first's.
  assert.deepEqual(second.verdicts, first.verdicts, `the second run's verdicts differ from the first's\n${show(first)}\n${show(second)}`);
});
