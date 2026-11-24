// AC1 (#3170.f6002c7f): the Spark has a folder on a file system with reflink, and a lane's cargo test there runs with
// DEEP_TEST_COW_DIR naming it. The lane is lanes.mjs's own, run by the real runLanes; its cargo test is the lane's own
// `cargo test --workspace …` command, on a workspace whose one test writes down the variable it runs with.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import test from 'node:test';
import { elsewhere, MINUTES, PLATFORM, probeWorkspace, reflinks, runLane, sandbox, SPARK, tail, UNSET } from './helpers.mjs';

test('#3170.f6002c7f a lane\'s cargo test on the Spark runs with DEEP_TEST_COW_DIR naming a folder that makes a reflink copy', MINUTES, async (t) => {
  if (PLATFORM !== SPARK) return t.skip(elsewhere('the Spark, Linux on aarch64'));
  const box = sandbox(t);
  const { cwd, seen } = probeWorkspace(box);
  const ran = await runLane(box, cwd);
  assert.ok(existsSync(seen), `the lane's cargo test ran the probe test (runLanes exit ${ran.status}):\n${tail(ran.output)}`);
  const folder = readFileSync(seen, 'utf8');
  assert.notEqual(folder, UNSET, 'the lane\'s cargo test runs with no DEEP_TEST_COW_DIR, where the Spark\'s copy-on-write folder must be named');
  assert.ok(isAbsolute(folder) && existsSync(folder) && statSync(folder).isDirectory(), `DEEP_TEST_COW_DIR names ${JSON.stringify(folder)}, which is no folder on this machine`);
  const probe = await reflinks(folder);
  assert.ok(probe.ok, `cp --reflink=always fails in ${folder}, the folder the lane's cargo test is given (file system ${probe.type}): ${probe.said}`);
});
