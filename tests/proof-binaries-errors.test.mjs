// Build prerequisites are real failures, never a passing test block with a missing executable.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { cargoRepo, commit, consumer, dump, git, observations, run, sandbox, write } from './acceptance/1123/helpers.mjs';

test('affected stops before starting consumers when its required binary cannot build', (t) => {
  const box = sandbox(t);
  cargoRepo(box);
  write(box.repo, 'crates/deep-hook/src/main.rs', 'fn main() { compile_error!("cannot build selected binary"); }');
  write(box.repo, 'tests/binary.test.mjs', consumer('node', 'must not run'));
  commit(box, 'fixture'); git(box, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  const result = run(box, process.execPath, ['scripts/affected.mjs', 'tests/binary.test.mjs']);
  assert.notEqual(result.status, 0, dump(result));
  assert.match(result.stdout, /BLOCKED test binaries: cargo build failed/);
  assert.deepEqual(observations(box), [], 'no consumer may start without its required build');
});
