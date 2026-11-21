// #2820 regression: a run builds its tests' binaries before its test grant (docs/parallel-proof.md, section 6), so the
// worktree can change between the builds and the grant. The run's test-grant child then ends BLOCKED and runs nothing,
// since what was built is not what its tests would build. The tree is hashed once the builds end, since a build may
// write the tree itself (a Cargo.lock), so it changes here once the run's build grant is released, while every test
// slot is held by another process: after the builds and before the test grant.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { evidence, finalState, fixture, prints, record, sandbox, selfBuilding, start, TEST, throttleLog, until, workspace } from './acceptance/2820/helpers.mjs';
import { stop } from './acceptance/2574/helpers.mjs';
import { fill } from './acceptance/2574-redraft-2833/helpers.mjs';

const FILE = 'tests/fixture-2820/self-build.test.mjs';

test('a worktree changed while the run waits for its test grant ends the run BLOCKED with nothing run', TEST, async (t) => {
  const box = sandbox(t);
  const fx = fixture(box, {
    ...workspace(box, { 'fixture-a': prints('fixture-a') }),
    [FILE]: selfBuilding(FILE, 'fixture-a'),
  });
  const holders = await fill(box, 9 * 60_000);
  const child = start(box, { cwd: fx.cwd, env: fx.env }, [FILE]);
  const built = await until(() => /^BINARIES /m.test(child.out()) && throttleLog(box).some((e) => e.event === 'released' && e.class === 'build'), 5 * 60_000);
  writeFileSync(join(fx.cwd, 'changed-while-waiting.txt'), 'a file the run never built for\n');
  for (const holder of holders) stop(holder);
  const run = await child.done;
  const all = evidence(run, box, fx);
  assert.ok(built, `the run never built its binaries or gave back its build grant\n${all}`);
  assert.match(run.stdout, /^BLOCKED affected: the worktree or the files it selects changed while the run waited for its test grant/m, `no stale-tree line\n${all}`);
  assert.equal(finalState(run.stdout), 'BLOCKED', `the run read otherwise\n${all}`);
  assert.deepEqual(record(fx).filter((e) => e.event === 'start'), [], `the planted test ran on a tree its binaries were not built for\n${all}`);
});
