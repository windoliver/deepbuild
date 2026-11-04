// AC7: a bay build with CARGO_TARGET_DIR set in the parent environment still writes to <bay>/target.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { bays, expectedGreeting, finished, inBay, machineRepo, sandbox, step } from './helpers.mjs';

test('#1117.029c15e6 a bay build with CARGO_TARGET_DIR set in the parent environment still writes to <bay>/target, and nothing to that folder', { timeout: 600_000 }, async (t) => {
  const box = sandbox(t);
  const { worktree, bays: script } = machineRepo(box);
  const elsewhere = join(box.dir, 'elsewhere-target');
  mkdirSync(elsewhere);
  const launched = Date.now();
  const run = bays(box, { script, cwd: worktree, steps: [{ do: 'build' }], env: { CARGO_TARGET_DIR: elsewhere } });
  const { probe, bay } = inBay(box, await finished(run), run);
  const built = step(probe, 'build');
  assert.equal(built.build.status, 0, `the build failed in the bay\n${built.build.stderr}`);
  assert.deepEqual(readdirSync(elsewhere), [], 'the bay build wrote to the parent\'s CARGO_TARGET_DIR');
  const greet = join(bay, 'target/debug/greet');
  assert.ok(existsSync(greet) && statSync(greet).mtimeMs >= launched - 1000, `the bay build did not write ${greet}`);
  assert.equal(built.greet, expectedGreeting(worktree), 'the binary in <bay>/target is not the tree\'s');
  // The integration test checks CARGO_BIN_EXE_greet lies in <bay>/target.
  assert.equal(built.test.status, 0, `cargo test failed in the bay\n${built.test.output}`);
});
