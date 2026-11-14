import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { assertOwnBinaries, cargoRepo, commit, consumer, decoy, dump, freshObservations, git, laneDriver, observations, ok, run, sandbox, source, write } from './helpers.mjs';

// Real before lane, including its real bay claim/install/build/report path. Shell decoy prints the right
// answer: leaking it makes BOTH sides pass, rather than failing accidentally on a missing executable.
test('#1123.07de86fd before runs the base binary as the wrong program and never shares it with the change', { timeout: 240_000 }, (t) => {
  const box = sandbox(t);
  cargoRepo(box, 'base-wrong');
  write(box.repo, 'package.json', JSON.stringify({ name: 'binary-fixture', private: true, workspaces: ['packages/build'] }));
  write(box.repo, 'packages/build/package.json', JSON.stringify({ name: 'fixture-build', private: true,
    scripts: { build: 'cargo build --manifest-path ../../Cargo.toml --workspace --locked --offline' } }));
  ok(run(box, 'npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund']));
  commit(box, 'base');
  git(box, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  write(box.repo, 'crates/deep-hook/src/main.rs', source('change-right'));
  write(box.repo, 'tests/acceptance/1123/binary.test.mjs', consumer('node', '#1123.07de86fd binary result'));
  commit(box, 'fixture change\n\nPart of #1123');
  write(box.dir, 'issues/1123.md', '### Acceptance criteria\n- [ ] A tagged test that spawns a binary fails on the base side of the before lane when the base\'s binary is the wrong program: base and change never share binaries\n');
  box.env.DEEP_PROOF_ISSUES = join(box.dir, 'issues');
  const shell = decoy(box, 'change-right');
  const result = run(box, process.execPath, ['scripts/proof.mjs', 'before']);
  t.diagnostic(result.stdout);
  const seen = observations(box);
  assert.equal(seen.length, 2, `both sides must execute the tagged consumer\n${dump(result)}`);
  assert.deepEqual(seen.map(({ word }) => word).sort(), ['base-wrong', 'change-right'], 'base and change must execute their own compiler-built binaries');
  assert.ok(seen.every(({ status, dir }) => status === 0 && dir && dir !== shell), 'both binaries run from explicit per-side directories, not the shell');
  assert.equal(new Set(seen.map(({ dir }) => dir)).size, 2, 'base and change never share a binary directory');
  assert.match(result.stdout, /PASS before: .*binary result: .*merge base/, dump(result));
  assert.equal(result.status, 0, dump(result));
});

for (const entry of ['lanes', 'affected']) {
  test(`#1123.cd6b3dd8 ${entry}.mjs uses its own run-private build, not the shell or mutable target`, { timeout: 240_000 }, (t) => {
    const box = sandbox(t);
    cargoRepo(box);
    const parallel = 'tests/parallel.test.ts', alone = 'tests/acceptance/236/resource.test.ts', node = 'tests/binary.test.mjs';
    write(box.repo, parallel, consumer('vitest', 'parallel binary'));
    write(box.repo, alone, consumer('vitest', 'resource-alone binary'));
    write(box.repo, node, consumer('node', 'node binary', true));
    write(box.repo, 'vitest.config.mjs', "export default { test: { include: ['tests/**/*.test.ts'] } };\n");
    write(box.repo, 'lane-driver.mjs', laneDriver);
    commit(box, 'fixture');
    git(box, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    const shell = decoy(box, 'shell-wrong');
    box.env.T1123_POISON = join(shell, 'deep-hook');
    // Deliberately do not prebuild target/debug. The runners must supply their own build.
    const args = entry === 'lanes' ? ['lane-driver.mjs'] : ['scripts/affected.mjs', parallel, alone, node];
    const result = run(box, process.execPath, args);
    // affected's unrelated repository-wide lints run unchanged against the minimal repo: their verdict is
    // not the oracle here. Each real selected consumer must run and observe the right executable.
    if (entry === 'affected') t.diagnostic(result.stdout.split('\n').filter((line) => /^(WIDE|INCONCLUSIVE|FAIL affected)/.test(line)).join('\n'));
    const seen = observations(box);
    assert.deepEqual(seen.map(({ name }) => name).sort(), ['node binary', 'parallel binary', 'resource-alone binary'], dump(result));
    const firstDir = assertOwnBinaries(seen, 'change-right', shell, result);
    if (entry === 'lanes') assert.equal(result.status, 0, dump(result));
    // A second run changes the source without relying on mtimes or sleeping. No stale private snapshot survives.
    write(box.repo, 'crates/deep-hook/src/main.rs', source('second-right'));
    box.env.T1123_EXPECTED = 'second-right';
    freshObservations(box);
    const second = run(box, process.execPath, args);
    const next = observations(box);
    assert.equal(next.length, 3, dump(second));
    const secondDir = assertOwnBinaries(next, 'second-right', shell, second);
    assert.notEqual(secondDir, firstDir, 'binary directories are run-private, not reused across runs');
    // Compiled decoy remains unchanged: ignoring a shell directory also means never building into it.
    assert.equal(ok(run(box, join(shell, 'deep-hook'), [])).trim(), 'shell-wrong');
    if (entry === 'lanes') assert.equal(second.status, 0, dump(second));
  });
}
