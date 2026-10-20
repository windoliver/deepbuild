// #594 acceptance: warm() in scripts/benchmark.mjs also warms the lint lane's clippy, so a measured
// run that lints compares warm with warm. warm() is called in a child process, from the fixture's
// copy of this checkout's scripts/, with the sandbox's environment.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { describe, fixture, isDependency } from './helpers.mjs';

const compiles = (log) => readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)).filter((line) => line.crate);

function warmed(t) {
  const repo = fixture(t);
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import { warm } from ${JSON.stringify(join(repo.repo, 'scripts/benchmark.mjs'))}; warm(process.cwd());`], { cwd: repo.repo, env: repo.env, encoding: 'utf8', timeout: 600_000 });
  assert.equal(result.status, 0, `warm() threw: ${result.stdout}${result.stderr}`);
  const during = compiles(repo.log);
  assert.ok(during.some(isDependency), `fixture bug: warm() compiled no dependency at all (${describe(during)})`);
  writeFileSync(repo.log, '');
  const clippy = (...extra) => {
    const run = spawnSync('cargo', ['clippy', '--workspace', '--all-targets', '--locked', ...extra], { cwd: repo.repo, env: repo.env, encoding: 'utf8', timeout: 600_000 });
    assert.equal(run.status, 0, `fixture bug: clippy failed after warm(): ${run.stderr}`);
    return compiles(repo.log);
  };
  return { during, clippy };
}

test('after warm(), the lint lane\'s cargo clippy --workspace --all-targets --locked compiles no dependency, and warm() linted the workspace itself', (t) => {
  // Two fresh copies of the fixture, each warmed once: one is then linted with the issue's command,
  // the other with the lint lane's own (which adds -- -D warnings). A clippy run with other arguments
  // lints the workspace's members again, so the member is fresh after whichever of the two warm() ran.
  const plain = warmed(t);
  const lane = warmed(t);
  // Catches today's warm(), which builds and test-builds but never checks: clippy check-compiles every
  // dependency cold, the work #594 found charged to the measured run.
  assert.ok(plain.during.some((line) => isDependency(line) && /^--emit=dep-info,metadata$/.test(line.emit)), `warm() never check-compiled a dependency, as clippy does; it compiled: ${describe(plain.during)}`);
  const afterPlain = plain.clippy();
  const afterLane = lane.clippy('--', '-D', 'warnings');
  assert.deepEqual(afterPlain.filter(isDependency), [], `cargo clippy --workspace --all-targets --locked compiled dependencies after warm(): ${describe(afterPlain)}`);
  assert.deepEqual(afterLane.filter(isDependency), [], `the lint lane's clippy compiled dependencies after warm(): ${describe(afterLane)}`);
  // Catches a warm() that runs cargo check, or clippy without --all-targets: the dependencies' check
  // output is shared, but clippy still lints the member (and its test target) cold under both commands.
  assert.ok(
    !afterPlain.some(({ crate }) => crate === 'app') || !afterLane.some(({ crate }) => crate === 'app'),
    `warm() did not run clippy over the workspace's own targets: clippy linted app again under both commands (${describe(afterPlain)} | ${describe(afterLane)})`,
  );
});
