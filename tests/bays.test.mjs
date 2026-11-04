// The bays' scope beyond #1117's criteria: a base bay holds the merge base's tree, the install is keyed on the lock's
// bytes, and undoBuild in a bay leaves its builds and packages be and rewrites only files whose bytes differ.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, cpSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { bays, claimOf, expectedGreeting, finished, git, holding, inBay, machineRepo, mutant, sandbox, stampLike, step, until, write } from './acceptance/1117/helpers.mjs';
import { undoBuild } from '../scripts/proof-runs.mjs';

const snapshot = [{ do: 'snapshot' }];
async function claim(box, repo, role = 'change') {
  const run = bays(box, { script: repo.bays, cwd: repo.worktree, steps: snapshot, role });
  return inBay(box, await finished(run), run);
}

test('a base bay holds the merge base\'s tree, apart from the change bay, and npm ci runs only when the lock\'s bytes change', { timeout: 300_000 }, async (t) => {
  const box = sandbox(t);
  const repo = machineRepo(box);
  const base = await claim(box, repo, 'base');
  assert.equal(base.claim.role, 'base');
  const tree = Object.fromEntries(git(repo.main, 'ls-tree', '-r', '-z', 'origin/main').split('\0').filter(Boolean).map((row) => {
    const [meta, path] = row.split('\t');
    return [path, createHash('sha256').update(execFileSync('git', ['cat-file', 'blob', meta.split(' ')[2]], { cwd: repo.main })).digest('hex')];
  }));
  assert.deepEqual(step(base.probe, 'snapshot').files, tree, 'the base bay does not hold the merge base\'s tree');
  assert.equal(base.claim.installed, true, 'the first claim of the base bay did not install its packages');

  const first = await claim(box, repo);
  assert.notEqual(first.bay, base.bay, 'the change and the base share a bay');
  assert.equal(first.claim.installed, true);
  assert.equal((await claim(box, repo)).claim.installed, false, 'npm ci ran again for the same lock');
  write(repo.worktree, { 'package-lock.json': `${JSON.stringify({ name: 'bay-fixture', version: '0.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'bay-fixture', version: '0.0.0', license: 'MIT' } } }, null, 2)}\n` });
  assert.equal((await claim(box, repo)).claim.installed, true, 'npm ci did not run for a lock with other bytes');
});

test('undoBuild in a bay keeps its target and node_modules and leaves a file holding the change\'s bytes untouched', (t) => {
  const box = sandbox(t);
  const root = join(box.dir, 'repo');
  write(root, { 'a.txt': 'same\n', 'b.txt': 'change\n' });
  git(root, 'init', '-q');
  const bay = join(box.bays, '1', 'change');
  write(bay, { 'a.txt': 'same\n', 'b.txt': 'built over\n', 'target/debug/tool': 'built\n', 'node_modules/pkg/index.js': 'installed\n', 'tests/planted.test.mjs': 'planted\n' });
  utimesSync(join(bay, 'a.txt'), 1_000_000, 1_000_000);
  const home = process.env.HOME;
  process.env.HOME = box.home;
  try {
    undoBuild(root, bay, [], root);
  } finally {
    process.env.HOME = home;
  }
  assert.equal(statSync(join(bay, 'a.txt')).mtimeMs, 1_000_000_000, 'a file already holding the change\'s bytes was written again');
  assert.equal(readFileSync(join(bay, 'b.txt'), 'utf8'), 'change\n', 'a file the build changed was not put back');
  assert.ok(existsSync(join(bay, 'target/debug/tool')), 'undoBuild removed the bay\'s target');
  assert.ok(existsSync(join(bay, 'node_modules/pkg/index.js')), 'undoBuild removed the bay\'s packages');
  assert.ok(!existsSync(join(bay, 'tests/planted.test.mjs')), 'a test the build added survived');
});

const LIB = 'crates/word/src/lib.rs';

test('a mutant a run built and then put back, bytes and mtime, never survives in the target into the next run', { timeout: 300_000 }, async (t) => {
  const box = sandbox(t);
  const repo = machineRepo(box);
  const tree = readFileSync(join(repo.worktree, LIB), 'utf8');
  const previous = bays(box, { script: repo.bays, cwd: repo.worktree, steps: [{ do: 'stamp', paths: [LIB] }, { do: 'write', files: { [LIB]: mutant(tree) } }, { do: 'build' }, { do: 'write', files: { [LIB]: tree } }, { do: 'restamp', paths: [LIB] }] });
  const one = inBay(box, await finished(previous), previous);
  assert.match(step(one.probe, 'build').greet ?? '', /^M+\|/, 'the previous run did not build its mutant');
  const next = bays(box, { script: repo.bays, cwd: repo.worktree, steps: [{ do: 'build' }] });
  const two = inBay(box, await finished(next), next);
  assert.equal(step(two.probe, 'build').greet, expectedGreeting(repo.worktree), 'the mutant built by the previous run survived into this run\'s binary');
});

test('a holder\'s death stops the command it left running in the pair before the next claim replaces the bay', { timeout: 300_000 }, async (t) => {
  const box = sandbox(t);
  const repo = machineRepo(box);
  const holder = bays(box, { script: repo.bays, cwd: repo.worktree, steps: [{ do: 'hold' }] });
  const seen = await holding(holder);
  box.pids = [seen.pid];
  process.kill(holder.pid, 'SIGKILL');
  // Its command holds the pipes open, so the holder's end is its exit.
  assert.ok(await until(() => holder.exitCode !== null || holder.signalCode !== null, 10_000), 'the holder did not die');
  const next = bays(box, { script: repo.bays, cwd: repo.worktree, steps: [] });
  const result = await finished(next, 120_000);
  inBay(box, result, next);
  assert.equal(claimOf(result).stopped, true, 'the claim did not report the left command stopped');
  assert.ok(await until(() => { try { process.kill(seen.pid, 0); return false; } catch { return true; } }, 5_000), 'the dead holder\'s command still runs in the bay');
});

for (const [name, tamper] of [
  ['a target file rewritten in place, its size, mtime and inode put back', (box, bay) => {
    const deps = join(bay, 'target/debug/deps');
    const rlib = join(deps, readdirSync(deps).find((file) => /^libword-.*\.rlib$/.test(file)));
    const ref = join(box.dir, 'refs', 'rlib');
    writeFileSync(ref, '');
    stampLike(rlib, ref);
    const bytes = readFileSync(rlib);
    bytes[bytes.length >> 1] ^= 0xff;
    const fd = openSync(rlib, 'r+');
    writeSync(fd, bytes, 0, bytes.length, 0);
    closeSync(fd);
    stampLike(ref, rlib);
  }],
]) {
  test(`${name} breaks the seal`, { timeout: 300_000 }, async (t) => {
    const box = sandbox(t);
    const repo = machineRepo(box);
    const first = bays(box, { script: repo.bays, cwd: repo.worktree, steps: [{ do: 'build' }] });
    const one = inBay(box, await finished(first), first);
    tamper(box, one.bay);
    const next = bays(box, { script: repo.bays, cwd: repo.worktree, steps: [] });
    const two = inBay(box, await finished(next), next);
    assert.equal(two.claim.seal, 'broken');
    assert.equal(two.claim.cold, true);
  });
}

test('a target a run linked out of the bay is never taken as sealed, whatever changes where it leads', { timeout: 300_000 }, async (t) => {
  const box = sandbox(t);
  const repo = machineRepo(box);
  const moved = join(box.dir, 'moved-target');
  const first = bays(box, { script: repo.bays, cwd: repo.worktree, steps: [{ do: 'build' }, { do: 'run', argv: ['sh', '-c', 'mv target "$0" && ln -s "$0" target', moved] }] });
  inBay(box, await finished(first), first);
  writeFileSync(join(moved, 'debug', 'planted-tool'), 'planted\n');
  const next = bays(box, { script: repo.bays, cwd: repo.worktree, steps: [] });
  const two = inBay(box, await finished(next), next);
  assert.equal(two.claim.seal, 'broken', 'a sealed link out of the bay was taken as intact');
  assert.equal(two.claim.cold, true);
});

test('packages a run changed are installed anew by the next claim; a tool cache in node_modules is not a change', { timeout: 300_000 }, async (t) => {
  const box = sandbox(t);
  const repo = machineRepo(box);
  const run = async (steps) => {
    const next = bays(box, { script: repo.bays, cwd: repo.worktree, steps });
    return inBay(box, await finished(next), next).claim;
  };
  assert.equal((await run([{ do: 'write', files: { 'node_modules/.vite/results.json': '{}' } }])).installed, true);
  assert.equal((await run([{ do: 'write', files: { 'node_modules/planted/index.js': 'planted\n' } }])).installed, false, 'a cache made the install run again');
  assert.equal((await run([])).installed, true, 'packages the previous run changed were kept');
});

test('a worktree of the repository that holds bays.mjs gets a bay wherever the machine keeps it, and a copy of one doesn\'t', { timeout: 300_000 }, async (t) => {
  const box = sandbox(t);
  const repo = machineRepo(box);
  // The Mac keeps its repository elsewhere than ~/deepbuild: here HOME holds none.
  const elsewhere = join(box.dir, 'other-home');
  mkdirSync(elsewhere);
  const run = bays(box, { script: repo.bays, cwd: repo.worktree, steps: [], env: { HOME: elsewhere } });
  const result = await finished(run, 120_000);
  assert.equal(result.status, 0, `a worktree of the script's repository got no bay\n${result.stdout}`);
  assert.ok(claimOf(result)?.bay.startsWith(join(elsewhere, 'deepbuild-bays')));
  // Beside the worktree, where node finds the scripts' packages as it does from the worktree.
  const copy = join(repo.main, '.claude', 'worktrees', 'copy');
  cpSync(repo.worktree, copy, { recursive: true });
  const refused = await finished(bays(box, { script: join(copy, 'scripts/bays.mjs'), cwd: copy, steps: [] }), 120_000);
  assert.equal(refused.status, 2, `a copy of a worktree got a bay\n${refused.stdout}`);
  assert.match(refused.stdout, /^NO BAY/m);
});
