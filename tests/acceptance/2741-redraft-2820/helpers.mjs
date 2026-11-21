// Helpers for the #2741 redraft (README): the parts of #1115's helpers (a sandboxed HOME, the scratch tree the real
// scripts run in) and #2574's start() that the original #2741 test imported, copied here so this folder stands alone
// once tests/acceptance/2741/ is retired. Nothing here imports the code under test: lanes.mjs's lists are read by a
// child process, and affected.mjs is reached only by running it.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const KNOWN = 'scripts/known-failures.json';
const ENV_OUT = ['DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'NODE_TEST_CONTEXT', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES', 'CARGO_TARGET_DIR', 'DEEP_PROOF_ISSUES', 'DEEP_APPROVERS',
  'DEEP_880_TOUCH_ID', 'DEEP_PI_CLI', 'DEEPBUILD_M1_RECORD', 'DEEP_PROOF_VITEST_REPORT', 'DEEP_THROTTLE_TABLE'];

/** A sandbox removed after the test, with its own HOME; every process it started is stopped by its group's PID. */
export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2741r-')));
  const home = join(dir, 'home');
  mkdirSync(home);
  const env = { ...process.env, HOME: home, XDG_CACHE_HOME: join(home, '.cache') };
  for (const name of ENV_OUT) delete env[name];
  const box = { dir, home, env, children: [] };
  t.after(() => {
    for (const child of box.children) stop(child);
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

/** Stops a process this test started, by its process group's PID. */
function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try { process.kill(-child.pid, 'SIGKILL'); } catch {}
}

function write(cwd, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
}
const gitIn = (cwd) => (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, stdio: 'pipe', encoding: 'utf8' });

/** The lists of a tree's lanes.mjs, read by a child. */
function lanesLists(root) {
  const code = `const lanes = await import(${JSON.stringify(pathToFileURL(join(root, 'scripts/lanes.mjs')).href)});
    const lint = lanes.checks.find(({ name }) => name === 'lint').commands.map(([, script]) => script).filter((script) => /^scripts\\/[^/]+\\.mjs$/.test(script ?? ''));
    console.log(JSON.stringify({ alone: lanes.alone ?? null, lint }));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `scripts/lanes.mjs could not be read: ${result.stderr}`);
  return JSON.parse(result.stdout.trim().split('\n').at(-1));
}

const vitestFile = (body) => `import { expect, test } from 'vitest';\n${body}\n`;
const nodeFile = (body) => `import assert from 'node:assert/strict';\nimport test from 'node:test';\n${body}\n`;

// One passing test per command of the unit lane, since each runner fails on a pattern that finds no file.
function passing() {
  const folder = lanesLists(CHECKOUT).alone?.find((entry) => entry.endsWith('/'));
  assert.ok(folder, 'scripts/lanes.mjs exports no alone folder');
  return {
    'tests/fixture-1115/pass.test.ts': vitestFile("test('a parallel vitest test passes', () => { expect(1).toBe(1); });"),
    [`${folder}fixture-1115-pass.test.ts`]: vitestFile("test('an alone vitest test passes', () => { expect(1).toBe(1); });"),
    'tests/fixture-1115-pass.test.mjs': nodeFile("test('a node test passes', () => { assert.equal(1, 1); });"),
  };
}

// cargo is stubbed on the tree's own PATH; a caller that wants the real one passes its own PATH, as this test does.
const CARGO = `#!/bin/sh
if [ "$1" = metadata ]; then echo '{"packages":[],"workspace_members":[],"version":1}'; exit 0; fi
exit 0
`;
const VITEST_CONFIG = `import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts', 'packages/**/test/**/*.test.ts', 'packages/**/*.test.ts'] } });
`;

/**
 * The scratch tree the real scripts run in: a copy of this checkout's `scripts` with the lint lane's scripts stubbed, a
 * vitest config, a folder of links to node_modules, an empty known-failures baseline, the unit lane's passing files
 * and `files`, all committed in a fresh repository at box.dir/tree.
 */
export function tree(box, files) {
  const cwd = join(box.dir, 'tree');
  mkdirSync(cwd);
  cpSync(join(CHECKOUT, 'scripts'), join(cwd, 'scripts'), { recursive: true });
  for (const script of lanesLists(cwd).lint) writeFileSync(join(cwd, script), '// a lint stub for #1115\n');
  writeFileSync(join(cwd, KNOWN), `${JSON.stringify({ failures: {}, lint: {}, timing: [] }, null, 2)}\n`);
  // A folder of links, so a tool's cache (vitest's .vite) lands here, never in this checkout's node_modules.
  mkdirSync(join(cwd, 'node_modules'));
  for (const entry of readdirSync(join(CHECKOUT, 'node_modules')).filter((entry) => !entry.startsWith('.vite'))) symlinkSync(join(CHECKOUT, 'node_modules', entry), join(cwd, 'node_modules', entry));
  write(cwd, { '.gitignore': 'node_modules\n', 'vitest.config.mjs': VITEST_CONFIG, ...passing(), ...files });
  const git = gitIn(cwd);
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'fixture');
  const bin = join(box.dir, 'bin-tree');
  mkdirSync(bin);
  writeFileSync(join(bin, 'cargo'), CARGO);
  chmodSync(join(bin, 'cargo'), 0o755);
  return { cwd, env: { PATH: `${bin}${delimiter}${box.env.PATH}` } };
}

/** `node scripts/affected.mjs ...args` in the tree, in its own process group; out() reads its output so far. */
export function start(box, { cwd, env }, args) {
  const child = spawn(process.execPath, ['scripts/affected.mjs', ...args], { cwd, env: { ...box.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.out = () => stdout;
  child.done = new Promise((resolve) => child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr })));
  return child;
}

const tail = (text, size = 2_500) => (text.length > size ? `…${text.slice(-size)}` : text);
export const dump = (run) => `exit ${run.status}${run.signal ? ` (${run.signal})` : ''}\nstdout:\n${tail(run.stdout)}\nstderr:\n${tail(run.stderr, 800)}`;
