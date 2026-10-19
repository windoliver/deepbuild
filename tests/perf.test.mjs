import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const scripts = new URL('../scripts/', import.meta.url);

// A throwaway repository whose merge base already has budgets, so perf measures a real base.
function repository(t, checks) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'deep-perf-test-')));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  for (const directory of ['scripts', 'benchmarks']) mkdirSync(join(cwd, directory));
  for (const file of ['perf.mjs', 'benchmark.mjs', 'lanes.mjs']) copyFileSync(new URL(file, scripts), join(cwd, 'scripts', file));
  const files = {
    'scripts/checks.mjs': checks(cwd),
    'package.json': JSON.stringify({ name: 'fixture', private: true, scripts: { build: `node -e "require('node:fs').writeFileSync('warm', '')"` } }),
    'package-lock.json': JSON.stringify({ name: 'fixture', lockfileVersion: 3, requires: true, packages: { '': { name: 'fixture' } } }),
    'benchmarks/budgets.json': JSON.stringify({ preflight: { margin: 0.5, limits: { elapsedMs: 300_000 }, initialReason: 'Fixture base.' }, tasks: [] }),
    '.gitignore': 'warm\nnode_modules/\n',
  };
  for (const [path, content] of Object.entries(files)) writeFileSync(join(cwd, path), content);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd });
  git('init', '-q');
  git('add', '.');
  git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const perf = (observation) => spawnSync(process.execPath, ['scripts/perf.mjs', JSON.stringify(observation)], { cwd, encoding: 'utf8' });
  return { cwd, git, perf };
}

test('the merge base is timed warm, so a slower checkout cannot hide behind its cold build', (t) => {
  // Cold, the merge base's checks burn 3 s of CPU; warm, they take one process start.
  const { perf } = repository(t, () => `
    import { existsSync } from 'node:fs';
    const start = process.cpuUsage();
    if (!existsSync('warm')) for (let used; (used = process.cpuUsage(start)).user + used.system < 3_000_000;);
  `);
  const result = perf({ status: 0, elapsedMs: 1500, cpuMs: 1500, peakBytes: 1 });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /FAIL perf: preflight: cpuMs 1500 regressed/);
});

test('wall time that only machine load stretched is not a regression', (t) => {
  const { perf } = repository(t, () => '');
  const result = perf({ status: 0, elapsedMs: 60_000, cpuMs: 1, peakBytes: 1 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /"task":"preflight"[^\n]*"status":"PASS"/);
});

test('a checkout without origin/main is blocked with the fetch that fixes it', (t) => {
  const { git, perf } = repository(t, () => '');
  git('update-ref', '-d', 'refs/remotes/origin/main');
  const result = perf({ status: 0, elapsedMs: 1, peakBytes: 1 });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /BLOCKED perf: .*origin\/main.*\n\s+Fix: .*git fetch origin main/);
});

test('a failed checkout is blocked without building the merge base', (t) => {
  const { cwd, perf } = repository(t, (root) => `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(join(root, 'base-ran'))}, '');`);
  const result = perf({ status: 1 });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /BLOCKED perf: .+\n\s+Fix: .+/);
  assert.equal(existsSync(join(cwd, 'base-ran')), false);
});

test('the full run with the change\'s own tests is still held to the peak-memory cap', (t) => {
  const { cwd, git, perf } = repository(t, () => '');
  writeFileSync(join(cwd, 'benchmarks/budgets.json'), JSON.stringify({ preflight: { margin: 0.5, limits: { elapsedMs: 300_000, peakBytes: 1e9 }, initialReason: 'Fixture base.' }, tasks: [] }));
  git('commit', '-qam', 'cap');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  mkdirSync(join(cwd, 'tests'));
  writeFileSync(join(cwd, 'tests/added.test.mjs'), '');
  const result = perf({ status: 0, elapsedMs: 1, cpuMs: 1, peakBytes: 2e9 });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /FAIL perf: preflight: peakBytes 2000000000 reached cap 1000000000/);
});
