// #1123: disposable repos, unmodified proof scripts, real Cargo binaries and real test runners.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const write = (root, path, bytes) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), bytes);
};
export const source = (word) => `fn main() { println!("${word}"); }\n`;
export const dump = (r) => `exit ${r.status}\n${r.stdout ?? ''}\n${r.stderr ?? r.error ?? ''}`;
export function run(box, command, args, cwd = box.repo, extra = {}) {
  return spawnSync(command, args, { cwd, env: { ...box.env, ...extra }, encoding: 'utf8', timeout: 180_000, maxBuffer: 2 ** 24 });
}
export function ok(r) { assert.equal(r.status, 0, dump(r)); return r.stdout; }
export const git = (box, ...args) => ok(run(box, 'git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args]));
export function commit(box, message) { git(box, 'add', '-A'); git(box, 'commit', '-qm', message); }

export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-1123-')));
  const repo = join(dir, 'repo'), home = join(dir, 'home'), temp = join(dir, 'tmp');
  for (const folder of [repo, home, temp]) mkdirSync(folder);
  const env = { ...process.env, HOME: home, TMPDIR: temp, TMP: temp, TEMP: temp,
    RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(homedir(), '.rustup'), CARGO_HOME: join(home, '.cargo'),
    CARGO_NET_OFFLINE: 'true', npm_config_cache: join(home, '.npm'), npm_config_offline: 'true',
    npm_config_update_notifier: 'false', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    T1123_OBSERVATIONS: join(dir, 'observations.jsonl'), T1123_EXPECTED: 'change-right' };
  for (const key of ['NODE_TEST_CONTEXT', 'DEEP_BIN_DIR', 'CARGO_TARGET_DIR', 'CARGO_BUILD_TARGET_DIR', 'DEEP_THROTTLE',
    'DEEP_PERF_LOCK', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES', 'DEEP_PROOF_ISSUES', 'DEEP_PROOF_VITEST_REPORT',
    'DEEP_HUB_PLANT', 'DEEP_APPROVERS', '__STRYKER_ACTIVE_MUTANT__', 'RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER']) delete env[key];
  cpSync(join(ROOT, 'scripts'), join(repo, 'scripts'), { recursive: true });
  // Imports resolve through the sandbox parent; npm may prune fixture-local links, never our tools.
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
  mkdirSync(join(repo, 'node_modules'));
  symlinkSync(join(ROOT, 'node_modules/vitest'), join(repo, 'node_modules/vitest'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, repo, env };
}

// deep-hook is a real binary name in this repository; the fixture has no registry dependencies.
export function cargoRepo(box, word = 'change-right') {
  write(box.repo, '.gitignore', 'node_modules/\ntarget/\n');
  write(box.repo, 'Cargo.toml', '[workspace]\nmembers = ["crates/deep-hook"]\nresolver = "2"\n');
  write(box.repo, 'crates/deep-hook/Cargo.toml', '[package]\nname = "deep-hook"\nversion = "0.0.0"\nedition = "2021"\n');
  write(box.repo, 'crates/deep-hook/src/main.rs', source(word));
  ok(run(box, 'cargo', ['generate-lockfile', '--offline']));
  git(box, 'init', '-q', '--template=', '-b', 'main');
}

export function decoy(box, word) {
  const bin = join(box.dir, 'shell-bin');
  mkdirSync(bin);
  write(box.dir, 'decoy.rs', source(word));
  ok(run(box, 'rustc', [join(box.dir, 'decoy.rs'), '-o', join(bin, 'deep-hook')]));
  box.env.DEEP_BIN_DIR = bin;
  return bin;
}

// A consumer never builds. Its fallback lets an old runner reach the binary assertion, not crash on an absent env.
// After the node consumer runs, replace target/debug's executable: a symlink or shared target is not a private bin.
export const consumer = (runner, name, poison = false) => `import { spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
${runner === 'vitest' ? "import { test, expect } from 'vitest';" : "import test from 'node:test';\nimport assert from 'node:assert/strict';"}
test(${JSON.stringify(name)}, () => {
  const dir = process.env.DEEP_BIN_DIR;
  const bin = resolve(dir ?? 'target/debug', 'deep-hook');
  const first = spawnSync(bin, [], { encoding: 'utf8' });
  let again = first;
  if (${poison} && first.status === 0) {
    const mutable = join(process.cwd(), 'target/debug/deep-hook');
    mkdirSync(dirname(mutable), { recursive: true });
    rmSync(mutable, { force: true });
    copyFileSync(process.env.T1123_POISON, mutable);
    again = spawnSync(bin, [], { encoding: 'utf8' });
  }
  appendFileSync(process.env.T1123_OBSERVATIONS, JSON.stringify({ name: ${JSON.stringify(name)}, cwd: process.cwd(),
    dir: dir ?? null, bin, status: first.status, word: first.stdout?.trim(), again: again.stdout?.trim() }) + '\\n');
  ${runner === 'vitest' ? "expect(first.status).toBe(0);\n  expect(first.stdout.trim()).toBe(process.env.T1123_EXPECTED);\n  expect(again.stdout.trim()).toBe(process.env.T1123_EXPECTED);" : "assert.equal(first.status, 0, 'binary executes');\n  assert.equal(first.stdout.trim(), process.env.T1123_EXPECTED, 'binary result');\n  assert.equal(again.stdout.trim(), process.env.T1123_EXPECTED, 'private binary survives target rewrite');"}
});
`;
export function observations(box) {
  try { return readFileSync(box.env.T1123_OBSERVATIONS, 'utf8').trim().split('\n').map(JSON.parse); }
  catch { return []; }
}
export function freshObservations(box) { rmSync(box.env.T1123_OBSERVATIONS, { force: true }); }

// Custom driver only calls the existing public entry, using its unchanged real unit definition.
export const laneDriver = `import { checks, runLanes } from './scripts/lanes.mjs';
process.exitCode = runLanes(checks.filter(({ name }) => name === 'unit'));
`;
export function assertOwnBinaries(seen, expected, shell, result) {
  assert.ok(seen.length, `no binary consumer ran\n${dump(result)}`);
  for (const row of seen) {
    assert.equal(row.status, 0, `${row.name}: binary did not execute`);
    assert.equal(row.word, expected, `${row.name}: shell/stale binary, not this run's build`);
    assert.equal(row.again, expected, `${row.name}: target rewrite changed the private binary`);
    assert.ok(row.dir, `${row.name}: DEEP_BIN_DIR is absent`);
    assert.notEqual(row.dir, shell, `${row.name}: inherited shell directory`);
    assert.notEqual(row.bin, join(row.cwd, 'target/debug/deep-hook'), 'mutable target is not run-private');
  }
  assert.equal(new Set(seen.map(({ dir }) => dir)).size, 1, 'one run shares its private binary snapshot among consumers');
  return seen[0].dir;
}
