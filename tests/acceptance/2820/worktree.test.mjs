// #2820 AC1: a selected test that runs `cargo build --locked --bin <name>` itself in its checkout (the worktree) finds
// the binary built by the run before its test grant. Written blind from issue #2820 at base f17fa347c (README).
import assert from 'node:assert/strict';
import test from 'node:test';
import { affected, buildBeforeTest, compiledNothing, evidence, fixture, prints, record, sandbox, selfBuilding, TEST, throttleLog, workspace } from './helpers.mjs';

const FILE = 'tests/fixture-2820/self-build.test.mjs';

test('#2820.AC1 a selected test that runs cargo build --locked --bin <name> in the worktree: the run\'s build grant is granted and released before its test grant, and the test\'s own cargo build compiles no crate', TEST, async (t) => {
  const box = sandbox(t);
  const fx = fixture(box, {
    ...workspace(box, { 'fixture-a': prints('fixture-a'), 'fixture-b': prints('fixture-b') }),
    [FILE]: selfBuilding(FILE, 'fixture-a'),
  });
  const run = await affected(box, fx, [FILE]);
  const all = evidence(run, box, fx);
  const started = record(fx).filter((e) => e.event === 'start');
  assert.ok(started.length >= 1, `the planted test never ran, so the run proves nothing\n${all}`);
  assert.ok(started.every((e) => e.root === fx.cwd), `the planted test ran outside the worktree ${fx.cwd}\n${all}`);
  buildBeforeTest(throttleLog(box), all);
  compiledNothing(fx, fx.cwd, all);
});
