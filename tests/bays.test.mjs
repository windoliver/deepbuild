// The bays' scope beyond #1117's criteria: a base bay holds the merge base's tree, the install is keyed on the lock's
// bytes, and undoBuild in a bay leaves its builds and packages be and rewrites only files whose bytes differ. A proof's
// pair (#1118) keeps the command line's guarantees beyond #1118's criteria: what a dead proof left running in a bay is
// stopped, its commands get no CARGO_TARGET_DIR, and a use's backdated mutant never survives into the next use.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, closeSync, cpSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, symlinkSync, utimesSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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

// A proof as it holds its pair: claimPair from the fixture's own bays.mjs, a use per entry of `uses` (a list of
// commands for the change bay, or { role, commands, root, lay }, root a command run first in the worktree, lay files
// [to, from] laid over the bay as the proof lays an overlay), each running its commands through the pair, then close.
// Prints each command's result as a RUN line, a use that throws as USE-ERROR.
const PROOF = `import { execFileSync } from 'node:child_process';
const [script, uses] = process.argv.slice(1);
const { claimPair } = await import(script);
const { lay: layOver } = await import(script.replace(/bays\\.mjs$/, 'proof-runs.mjs'));
const pair = claimPair(process.cwd(), (line) => console.log(line));
for (const [at, entry] of JSON.parse(uses).entries()) {
  const { role = 'change', commands = [], root = null, lay = [] } = Array.isArray(entry) ? { commands: entry } : entry;
  if (root) execFileSync(root[0], root.slice(1), { stdio: 'ignore' });
  let bay;
  try {
    ({ bay } = pair.use(role, 'use ' + at));
    layOver(bay, new Map(lay));
  } catch (error) {
    console.log('USE-ERROR ' + error.message.split('\\n')[0]);
    continue;
  }
  for (const argv of commands) {
    const result = pair.run(argv[0], argv.slice(1), { cwd: bay, encoding: 'utf8' });
    console.log('RUN ' + JSON.stringify({ status: result.status, signal: result.signal, stdout: result.stdout.trim() }));
  }
}
pair.close();
`;
function proof(box, repo, uses, env = {}) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', PROOF, pathToFileURL(repo.bays).href, JSON.stringify(uses)], { cwd: repo.worktree, env: { ...box.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const lines = (word) => stdout.split('\n').filter((line) => line.startsWith(`${word} `)).map((line) => line.slice(word.length + 1));
  child.done = new Promise((resolve) => child.on('close', (status) => resolve({ status, stdout, stderr, runs: lines('RUN').map((line) => JSON.parse(line)), claims: lines('BAY claim').map((line) => JSON.parse(line)), releases: lines('BAY release').map((line) => JSON.parse(line)), errors: lines('USE-ERROR') })));
  return child;
}
const probeArgv = (box, name, steps) => [process.execPath, box.probe, JSON.stringify({ name, out: join(box.dir, 'probes', `${name}.json`), refs: join(box.dir, 'refs'), steps })];

test('a proof\'s death stops the command it left running in its bay before the next claim replaces the bay', { timeout: 300_000 }, async (t) => {
  const box = sandbox(t);
  const repo = machineRepo(box);
  const pidFile = join(box.dir, 'left.pid');
  const holder = proof(box, repo, [[['sh', '-c', 'echo $$ > "$0"; exec sleep 600', pidFile]]]);
  assert.ok(await until(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim(), 60_000), 'the proof\'s command never started');
  const left = Number(readFileSync(pidFile, 'utf8'));
  box.pids = [left];
  process.kill(holder.pid, 'SIGKILL');
  const next = await finished(bays(box, { script: repo.bays, cwd: repo.worktree, steps: [] }), 120_000);
  assert.equal(claimOf(next)?.stopped, true, `the claim did not report the proof's command stopped\n${next.stdout}`);
  assert.ok(await until(() => { try { process.kill(left, 0); return false; } catch { return true; } }, 5_000), 'the dead proof\'s command still runs in the bay');
});

test('a proof\'s bay commands write the bay\'s own target, whatever CARGO_TARGET_DIR the proof was given', { timeout: 300_000 }, async (t) => {
  const box = sandbox(t);
  const repo = machineRepo(box);
  const result = await proof(box, repo, [[['sh', '-c', 'echo "${CARGO_TARGET_DIR-unset} ${CARGO_BUILD_TARGET_DIR-unset}"']]], { CARGO_TARGET_DIR: join(box.dir, 'elsewhere'), CARGO_BUILD_TARGET_DIR: join(box.dir, 'elsewhere') }).done;
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.runs[0]?.stdout, 'unset unset', 'a bay command was handed the proof\'s target folder');
});

test('a mutant one use of a proof built and put back, bytes and mtime, never survives into the role\'s next use', { timeout: 300_000 }, async (t) => {
  const box = sandbox(t);
  const repo = machineRepo(box);
  const tree = readFileSync(join(repo.worktree, LIB), 'utf8');
  const result = await proof(box, repo, [
    [probeArgv(box, 'mutant', [{ do: 'stamp', paths: [LIB] }, { do: 'write', files: { [LIB]: mutant(tree) } }, { do: 'build' }, { do: 'write', files: { [LIB]: tree } }, { do: 'restamp', paths: [LIB] }])],
    [probeArgv(box, 'next', [{ do: 'build' }])],
  ]).done;
  assert.equal(result.status, 0, result.stderr);
  const seen = (name) => JSON.parse(readFileSync(join(box.dir, 'probes', `${name}.json`), 'utf8'));
  assert.match(step(seen('mutant'), 'build').greet ?? '', /^M+\|/, 'the first use did not build its mutant');
  assert.equal(step(seen('next'), 'build').greet, expectedGreeting(repo.worktree), 'the mutant the previous use built survived into this use\'s binary');
});

test('a bay command killed by a signal Node lives through, as SIGPIPE, never reads as having exited 0', { timeout: 300_000 }, async (t) => {
  const box = sandbox(t);
  const repo = machineRepo(box);
  const result = await proof(box, repo, [[['sh', '-c', 'kill -PIPE $$'], ['sh', '-c', 'kill -USR1 $$']]]).done;
  assert.equal(result.status, 0, result.stderr);
  for (const run of result.runs) assert.ok(run.status !== 0 || run.signal, `a command killed by a signal read as exit 0: ${JSON.stringify(run)}`);
});

test('the record names a crate whose manifest reads a file a use wrote outside crates/, as a test target under the test paths', { timeout: 300_000 }, async (t) => {
  const box = sandbox(t);
  const repo = machineRepo(box);
  write(repo.worktree, { 'crates/greet/Cargo.toml': `${readFileSync(join(repo.worktree, 'crates/greet/Cargo.toml'), 'utf8')}\n[[test]]\nname = "outside"\npath = "../../tests/rust/outside.rs"\n`, 'tests/rust/outside.rs': '#[test]\nfn one() {}\n' });
  const outside = join(repo.worktree, 'tests/rust/outside.rs');
  const result = await proof(box, repo, [[], { root: ['sh', '-c', 'printf "#[test]\\nfn two() {}\\n" > "$0"', outside] }]).done;
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.claims[1]?.crates, ['greet'], `the use that wrote tests/rust/outside.rs did not name greet\n${result.stdout}`);
});

test('a use that fails leaves its role usable: the next use of it runs, and every bay used is sealed', { timeout: 300_000 }, async (t) => {
  const box = sandbox(t);
  const repo = machineRepo(box);
  const main = git(repo.worktree, 'rev-parse', 'origin/main').trim();
  const result = await proof(box, repo, [
    { role: 'base', root: ['git', '-C', repo.worktree, 'update-ref', '-d', 'refs/remotes/origin/main'] },
    { role: 'base', root: ['git', '-C', repo.worktree, 'update-ref', 'refs/remotes/origin/main', main] },
    [],
  ]).done;
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.errors.length, 1, `the first base use did not fail, or a later one did too\n${result.stdout}`);
  assert.deepEqual(result.claims.map(({ role }) => role), ['base', 'change'], result.stdout);
  assert.deepEqual(result.releases.map(({ role }) => role).sort(), ['base', 'change'], `a bay used was not sealed\n${result.stdout}\n${result.stderr}`);
});

test('the record names the crates that depend on a crate a use wrote, which cargo rebuilds too', { timeout: 300_000 }, async (t) => {
  const box = sandbox(t);
  const repo = machineRepo(box);
  const result = await proof(box, repo, [[], { root: ['sh', '-c', 'printf "%s" "$1" > "$0"', join(repo.worktree, LIB), mutant(readFileSync(join(repo.worktree, LIB), 'utf8'))] }]).done;
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.claims[1]?.crates, ['greet', 'word'], `the use that wrote word's source did not name greet, which depends on it\n${result.stdout}`);
});

test('packages the lock puts under a workspace\'s node_modules, which a use\'s replace removes, are installed again', { timeout: 300_000 }, async (t) => {
  const box = sandbox(t);
  const repo = machineRepo(box);
  const lock = JSON.parse(readFileSync(join(repo.worktree, 'package-lock.json'), 'utf8'));
  lock.packages['packages/p/node_modules/dep'] = { version: '1.0.0' };
  write(repo.worktree, { 'package-lock.json': `${JSON.stringify(lock, null, 2)}\n` });
  // npm is a boundary: a stand-in that logs each install and lays the nested package as npm ci would.
  const shim = join(box.dir, 'shim'), log = join(box.dir, 'npm.log');
  write(shim, { npm: `#!/bin/sh\necho "$*" >> "${log}"\nmkdir -p packages/p/node_modules/dep node_modules\n` });
  chmodSync(join(shim, 'npm'), 0o755);
  const result = await proof(box, repo, [[], []], { PATH: `${shim}:${box.env.PATH}` }).done;
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.claims.map(({ installed }) => installed), [true, true], `the use after the replace removed the nested packages did not install them\n${result.stdout}`);
});

test('a bays folder linked to another disk takes the proof\'s overlays like any bay', { timeout: 300_000 }, async (t) => {
  const box = sandbox(t);
  const repo = machineRepo(box);
  mkdirSync(join(box.dir, 'other-disk'));
  symlinkSync(join(box.dir, 'other-disk'), box.bays);
  const source = join(box.dir, 'overlay.test.mjs');
  writeFileSync(source, 'export {};\n');
  const result = await proof(box, repo, [{ role: 'base', lay: [['tests/overlay.test.mjs', source]] }]).done;
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.errors, [], `laying an overlay over a bay under a linked bays folder failed\n${result.stdout}`);
  assert.ok(existsSync(join(box.dir, 'other-disk', String(result.claims[0].index), 'base', 'tests/overlay.test.mjs')), 'the overlay was not laid');
});

test('a pair folder linked out of the bays folder is refused, never used as a copy whose packages undoBuild relinks', { timeout: 300_000 }, async (t) => {
  const box = sandbox(t);
  const repo = machineRepo(box);
  mkdirSync(join(box.dir, 'other-disk'));
  mkdirSync(box.bays);
  symlinkSync(join(box.dir, 'other-disk'), join(box.bays, '1'));
  const result = await finished(bays(box, { script: repo.bays, cwd: repo.worktree, steps: [] }), 120_000);
  assert.equal(result.status, 2, `a pair linked out of the bays folder was used\n${result.stdout}`);
  assert.match(result.stdout, /^BLOCKED bays: .*links out of/m);
});

test('a package for another platform the lock nests under a workspace never makes every use install again', { timeout: 300_000 }, async (t) => {
  const box = sandbox(t);
  const repo = machineRepo(box);
  const lock = JSON.parse(readFileSync(join(repo.worktree, 'package-lock.json'), 'utf8'));
  lock.packages['packages/p/node_modules/@esbuild/elsewhere'] = { version: '1.0.0', optional: true, os: ['no-such-os'] };
  lock.packages['packages/p/node_modules/@esbuild/everywhere-but'] = { version: '1.0.0', optional: true, os: [`!${process.platform}`] };
  write(repo.worktree, { 'package-lock.json': `${JSON.stringify(lock, null, 2)}\n` });
  const shim = join(box.dir, 'shim');
  write(shim, { npm: '#!/bin/sh\nmkdir -p node_modules\n' });
  chmodSync(join(shim, 'npm'), 0o755);
  const result = await proof(box, repo, [[], []], { PATH: `${shim}:${box.env.PATH}` }).done;
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.claims.map(({ installed }) => installed), [true, false], `npm ci ran again for a package it never installs\n${result.stdout}`);
});

test('an optional package for this platform the lock nests under a workspace is installed again once a replace removes it', { timeout: 300_000 }, async (t) => {
  const box = sandbox(t);
  const repo = machineRepo(box);
  const lock = JSON.parse(readFileSync(join(repo.worktree, 'package-lock.json'), 'utf8'));
  lock.packages['packages/p/node_modules/@esbuild/here'] = { version: '1.0.0', optional: true, os: [process.platform], cpu: [process.arch] };
  write(repo.worktree, { 'package-lock.json': `${JSON.stringify(lock, null, 2)}\n` });
  const shim = join(box.dir, 'shim');
  write(shim, { npm: '#!/bin/sh\nmkdir -p packages/p/node_modules/@esbuild/here node_modules\n' });
  chmodSync(join(shim, 'npm'), 0o755);
  const result = await proof(box, repo, [[], []], { PATH: `${shim}:${box.env.PATH}` }).done;
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.claims.map(({ installed }) => installed), [true, true], `the optional package npm ci installs here was left out\n${result.stdout}`);
});
