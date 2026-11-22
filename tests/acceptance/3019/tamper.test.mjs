// AC3: a cached build whose files changed after it was stored is not used; the run builds fresh and says why. After a
// first run stores the merge base's build, every file in the cache holding that build's dist/index.mjs bytes is
// rewritten in place to the bytes the change's value would give, so a run that used it would pass C1 on the base.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import test from 'node:test';
import { builds, cacheOf, holding, machineRepo, mergeBase, proof, rightVerdicts, sandbox, show, timesBuilt, TIMEOUT } from './helpers.mjs';

test('#3019.117a4707 a cached build whose files changed after it was stored is not used: the run builds fresh and says why', TIMEOUT, async (t) => {
  const box = sandbox(t);
  const fixture = machineRepo(box);
  const { tree } = mergeBase(fixture.worktree);
  const { base } = builds(fixture.worktree);
  const first = await proof(box, fixture);
  assert.deepEqual(first.verdicts, rightVerdicts(), `the first run's verdicts are not the fixture's right ones\n${show(first)}`);

  const stored = holding(box, base.index);
  assert.ok(stored.length, `after the first run no file under ${cacheOf(box)} holds the merge base's built packages/w/dist/index.mjs, so no cached build of the merge-base tree is there to change\n${show(first)}`);
  const tampered = Buffer.from(base.index.toString().replace('export const value = 1;', 'export const value = 2;'));
  for (const path of stored) writeFileSync(path, tampered);

  const second = await proof(box, fixture);
  assert.equal(timesBuilt(second, base), 1, `after its cached files changed, the run built the merge-base tree ${tree} ${timesBuilt(second, base)} times, not once (fresh)\n${show(second)}`);
  const said = second.lines.filter((line) => line.role === 'base' && line.tree === tree && line.reused === false);
  assert.ok(said.length, `the run printed no line BUILD {"role":"base","tree":"${tree}","reused":false,"why":…}\n${show(second)}`);
  assert.ok(said.some((line) => typeof line.why === 'string' && /\bchanged\b/i.test(line.why)), `the run's BUILD line for the merge-base tree doesn't say the cached files changed (a "why" with the word "changed"): ${said.map(({ line }) => line).join('\n')}\n${show(second)}`);
  assert.deepEqual(second.verdicts, first.verdicts, `the run after the cached files changed gave other verdicts than the first\n${show(first)}\n${show(second)}`);
});
