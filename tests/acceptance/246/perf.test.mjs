// #246 acceptance: `scripts/perf.mjs`, run as a process, and `benchmarks/budgets.json`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { git, root, scratch, show, write } from './helpers.mjs';

test('perf measures a merge base whose checks call git ls-files, in a throwaway repository of its own', (t) => {
  const cwd = scratch(t, 'deep-perf-246-');
  mkdirSync(join(cwd, 'scripts'));
  for (const file of ['perf.mjs', 'benchmark.mjs']) copyFileSync(join(root, 'scripts', file), join(cwd, 'scripts', file));
  const marker = join(cwd, 'base-ran');
  write(cwd, {
    // The merge base's checks need a git repository at the copy's root, as repo-rules does.
    'scripts/checks.mjs': `
      import { execFileSync } from 'node:child_process';
      import { realpathSync, writeFileSync } from 'node:fs';
      writeFileSync(${JSON.stringify(marker)}, process.cwd());
      const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
      if (realpathSync(top) !== realpathSync(process.cwd())) process.exit(2);
      const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\\n');
      if (!files.includes('scripts/checks.mjs') || !files.includes('benchmarks/budgets.json')) process.exit(3);
    `,
    'package.json': JSON.stringify({ name: 'fixture', private: true, scripts: { build: `node -e "require('node:fs').writeFileSync('warm', '')"` } }),
    'package-lock.json': JSON.stringify({ name: 'fixture', lockfileVersion: 3, requires: true, packages: { '': { name: 'fixture' } } }),
    'benchmarks/budgets.json': JSON.stringify({ preflight: { margin: 0.5, limits: { elapsedMs: 300_000 }, initialReason: 'Fixture base.' }, tasks: [] }),
    '.gitignore': 'warm\nnode_modules/\nbase-ran\n',
  });
  git(cwd, 'init', '-q');
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-qm', 'base');
  git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');

  // A user's git config whose hooks and signing would leave traces if the throwaway commit ran them.
  const home = scratch(t, 'deep-perf-246-config-');
  const trace = (name) => `#!/bin/sh\necho ran >> ${JSON.stringify(join(home, name))}\nexit 1\n`;
  write(home, { 'hooks/pre-commit': trace('hook-ran'), 'hooks/commit-msg': trace('hook-ran'), 'hooks/post-commit': trace('hook-ran'), 'sign': trace('sign-ran') });
  for (const file of ['hooks/pre-commit', 'hooks/commit-msg', 'hooks/post-commit', 'sign']) chmodSync(join(home, file), 0o755);
  writeFileSync(join(home, 'gitconfig'), `[user]\n\tname = Someone\n\temail = someone@example.invalid\n[core]\n\thooksPath = ${join(home, 'hooks')}\n[commit]\n\tgpgsign = true\n[gpg]\n\tprogram = ${join(home, 'sign')}\n`);

  const worktrees = git(cwd, 'worktree', 'list', '--porcelain');
  const refs = git(cwd, 'for-each-ref');
  const result = spawnSync(process.execPath, ['scripts/perf.mjs', JSON.stringify({ status: 0, elapsedMs: 1, cpuMs: 1, peakBytes: 1 })], {
    cwd, encoding: 'utf8', timeout: 120_000, env: { ...process.env, GIT_CONFIG_GLOBAL: join(home, 'gitconfig') },
  });
  assert.doesNotMatch(result.stdout, /BLOCKED perf: merge-base checks exited/, show(result));
  assert.equal(result.status, 0, show(result));
  assert.match(result.stdout, /^PASS perf \(/m, show(result));
  const line = result.stdout.split('\n').find((text) => text.startsWith('{') && text.includes('"task":"preflight"'));
  assert.ok(line, show(result));
  const verdict = JSON.parse(line);
  assert.equal(verdict.status, 'PASS', line);
  assert.ok(verdict.base, `the merge base was not measured: ${line}`);

  assert.ok(existsSync(marker), 'the merge base checks never ran');
  const copy = readFileSync(marker, 'utf8');
  assert.notEqual(copy, cwd);
  assert.ok(!copy.startsWith(`${cwd}/`), `the merge-base copy was inside the checkout: ${copy}`);
  assert.equal(existsSync(copy), false, `the throwaway repository was left at ${copy}`);
  assert.equal(git(cwd, 'worktree', 'list', '--porcelain'), worktrees);
  assert.equal(git(cwd, 'for-each-ref'), refs);
  assert.equal(existsSync(join(home, 'hook-ran')), false, "the user's git hooks ran");
  assert.equal(existsSync(join(home, 'sign-ran')), false, "the user's signing ran");
});

test('benchmarks/budgets.json gains the repo-rules task with its limits, margin and first-measurement reason', () => {
  const budgets = JSON.parse(readFileSync(join(root, 'benchmarks/budgets.json'), 'utf8'));
  const task = budgets.tasks.find(({ id }) => id === 'repo-rules');
  assert.ok(task, 'no repo-rules task in benchmarks/budgets.json');
  assert.deepEqual(task.command, ['node', 'scripts/repo-rules.mjs']);
  assert.equal(task.margin, 0.5);
  assert.deepEqual(task.limits, { p50Ms: 1000, p95Ms: 2000, peakBytes: 128_000_000 });
  assert.equal(typeof task.initialReason, 'string');
  assert.ok(task.initialReason.trim().length > 0, 'empty initialReason');
});
