// Issue #2635: scripts/affected.mjs names a missing cargo instead of throwing a TypeError on a null stderr.
// Written blind from the issue, the design and base commit 1e3b798c5. Reached through `crates(cwd)` exported from
// scripts/affected.mjs and through `node scripts/affected.mjs` run in a scratch git repository holding this checkout's
// scripts, with a sandboxed HOME and a PATH of symlinks to node, git, ps and sh only, so no cargo is found.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const { crates } = await import(join(CHECKOUT, 'scripts/affected.mjs'));
const TOOLS = ['node', 'git', 'ps', 'sh'];
const RUN_MS = 120_000;

// Finds a tool on the caller's PATH, so the restricted PATH can link to it.
function which(name) {
  return execFileSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).trim();
}

// A scratch git repository with a Cargo.toml and a copy of this checkout's scripts, a sandboxed HOME, and a bin
// folder of symlinks to node, git, ps and sh (and, when given, a cargo stub).
function scene(t, cargo) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2635-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = join(dir, 'home'), tree = join(dir, 'tree'), bin = join(dir, 'bin');
  for (const folder of [home, tree, bin]) mkdirSync(folder);
  for (const name of TOOLS) symlinkSync(which(name), join(bin, name));
  if (cargo) {
    writeFileSync(join(bin, 'cargo'), cargo);
    chmodSync(join(bin, 'cargo'), 0o755);
  }
  cpSync(join(CHECKOUT, 'scripts'), join(tree, 'scripts'), { recursive: true });
  symlinkSync(join(CHECKOUT, 'node_modules'), join(tree, 'node_modules'));
  writeFileSync(join(tree, '.gitignore'), 'node_modules\n');
  writeFileSync(join(tree, 'Cargo.toml'), '[workspace]\nmembers = []\nresolver = "2"\n');
  writeFileSync(join(tree, 'README.md'), 'fixture\n');
  const git = (...args) => execFileSync(which('git'), ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: tree, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'fixture');
  const env = { HOME: home, PATH: bin, LANG: 'C' };
  return { tree, bin, env };
}

// crates(cwd) under a PATH of the scene's bin only, restored after.
function cratesWithPath(path, cwd) {
  const saved = process.env.PATH;
  process.env.PATH = path;
  try { return crates(cwd); } finally { process.env.PATH = saved; }
}

// `node scripts/affected.mjs README.md` in the scene, bounded: on timeout its process group is killed by its PID.
function affected(t, s) {
  return new Promise((done) => {
    const child = spawn(join(s.bin, 'node'), ['scripts/affected.mjs', 'README.md'], { cwd: s.tree, env: s.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let out = '', timedOut = false;
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { out += chunk; });
    const kill = () => { if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
    const timer = setTimeout(() => { timedOut = true; kill(); }, RUN_MS);
    t.after(kill);
    child.on('close', (status, signal) => { clearTimeout(timer); done({ status, signal, out, timedOut }); });
  });
}

test('AC1: crates(cwd) with no cargo on PATH throws an Error starting "cargo metadata failed:" naming the spawn code', (t) => {
  const s = scene(t);
  let thrown;
  try { cratesWithPath(s.bin, s.tree); } catch (error) { thrown = error; }
  assert.ok(thrown, 'crates(cwd) returned with no cargo on PATH');
  assert.ok(thrown instanceof Error, `crates(cwd) threw a non-Error: ${thrown}`);
  assert.ok(!(thrown instanceof TypeError), `crates(cwd) threw a TypeError: ${thrown.stack}`);
  assert.match(thrown.message, /^cargo metadata failed:/, `message: ${thrown.message}`);
  assert.match(thrown.message, /ENOENT/, `the message names no spawn error code: ${thrown.message}`);
});

test('AC1: node scripts/affected.mjs with no cargo on PATH names cargo and that it could not start, with no TypeError', async (t) => {
  const s = scene(t);
  const run = await affected(t, s);
  assert.equal(run.timedOut, false, `the run did not end within ${RUN_MS} ms\n${run.out}`);
  assert.doesNotMatch(run.out, /TypeError/, run.out);
  assert.doesNotMatch(run.out, /reading 'trim'/, run.out);
  assert.match(run.out, /cargo/, `the output does not name cargo\n${run.out}`);
  assert.match(run.out, /ENOENT|not found|could(?:n't| not) (?:be )?start/i, `the output does not say cargo could not be started\n${run.out}`);
});

test('AC2: a cargo that writes "error: boom" to stderr and exits 101 makes crates(cwd) throw "cargo metadata failed: error: boom"', (t) => {
  const s = scene(t, '#!/bin/sh\necho "error: boom" >&2\nexit 101\n');
  assert.throws(() => cratesWithPath(s.bin, s.tree), (error) => error instanceof Error && error.message === 'cargo metadata failed: error: boom');
});

test('AC3: with no cargo on PATH, node scripts/affected.mjs exits non-zero and prints no PASS affected summary', async (t) => {
  const s = scene(t);
  const run = await affected(t, s);
  assert.equal(run.timedOut, false, `the run did not end within ${RUN_MS} ms\n${run.out}`);
  assert.ok(run.status !== 0, `exited ${run.status} (signal ${run.signal})\n${run.out}`);
  assert.equal(run.signal, null, `ended by signal ${run.signal}, not by its own exit\n${run.out}`);
  assert.doesNotMatch(run.out, /^PASS affected/m, run.out);
});
