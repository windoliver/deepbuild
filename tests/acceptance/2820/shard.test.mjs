// #2820 AC2: the same holds for selected tests run in shards: each binary is built in the shard before the test grant,
// and the test's own cargo build there compiles no crate. Written blind from issue #2820 at base f17fa347c (README).
import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { affected, aloneFolders, buildBeforeTest, buildingHelper, compiledNothing, evidence, fixture, helperBuilding, prints, record, sandbox, selfBuilding, TEST, throttleLog, workspace } from './helpers.mjs';

const NAME = 'fixture-2820.test';

test('#2820.AC2 selected tests run in shards: the binary is built in each shard before the run\'s test grant, and each test\'s own cargo build there compiles no crate', TEST, async (t) => {
  const box = sandbox(t);
  // Two alone groups and DEEP_SHARDS=2, so the alone block runs in two shards. One file builds its binary itself; the
  // other through a helper it imports (the issue's "a selected test or a helper it reaches").
  const [first, second] = aloneFolders(2, NAME);
  const direct = `${first}${NAME}.mjs`, through = `${second}${NAME}.mjs`;
  const fx = fixture(box, {
    ...workspace(box, { 'fixture-a': prints('fixture-a'), 'fixture-b': prints('fixture-b') }),
    [direct]: selfBuilding(direct, 'fixture-a'),
    [`${second}fixture-2820-helper.mjs`]: buildingHelper('fixture-b'),
    [through]: helperBuilding(through, './fixture-2820-helper.mjs'),
  }, { DEEP_SHARDS: '2' });
  const run = await affected(box, fx, [direct, through]);
  const all = evidence(run, box, fx);
  const shards = join(box.home, 'deepbuild-shards');
  const roots = [...new Set(record(fx).filter((e) => e.event === 'start').map((e) => e.root))];
  for (const file of [direct, through]) assert.ok(record(fx).some((e) => e.event === 'start' && e.file === file), `the planted ${file} never ran, so the run proves nothing\n${all}`);
  assert.ok(roots.length === 2 && roots.every((root) => root.startsWith(`${shards}/`)), `the planted files ran in ${roots.join(', ')}, not each in a shard of its own under ${shards}\n${all}`);
  buildBeforeTest(throttleLog(box), all);
  for (const root of roots) compiledNothing(fx, root, all);
});
