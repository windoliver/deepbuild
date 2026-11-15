// Helpers for #1875's acceptance tests: a sandboxed HOME, processes in their own groups stopped by PID, and the
// scratch tree affected.mjs runs in (README: The affected.mjs tree). Nothing here imports the code under test:
// affected.mjs is run as a process, and lanes.mjs's lists are read by a child process.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const ENV_OUT = ['DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'NODE_TEST_CONTEXT', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES', 'CARGO_TARGET_DIR', 'DEEP_PROOF_ISSUES', 'DEEP_APPROVERS'];

/** A sandbox removed after the test, with its own HOME; every process it started is stopped by its group's PID. */
export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-1875-')));
  const home = join(dir, 'home');
  mkdirSync(home);
  const env = { ...process.env, HOME: home, XDG_CACHE_HOME: join(home, '.cache') };
  for (const name of Object.keys(env)) if (ENV_OUT.includes(name) || name.startsWith('DEEP_')) delete env[name];
  const box = { dir, env, children: [] };
  t.after(() => {
    for (const child of box.children) if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

/** Runs argv in the sandbox in its own process group; resolves with its status and output. */
function launch(box, argv, { cwd, env }) {
  const child = spawn(argv[0], argv.slice(1), { cwd, env: { ...box.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  return new Promise((resolve) => child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr })));
}

/** lanes.mjs's `byHand` and `ownLane` lists and the scripts its lint lane runs, read by a child process. */
export function lanesLists(root) {
  const code = `const lanes = await import(${JSON.stringify(pathToFileURL(join(root, 'scripts/lanes.mjs')).href)});
    const lint = lanes.checks.find(({ name }) => name === 'lint').commands.map(([, script]) => script).filter((script) => /^scripts\\/[^/]+\\.mjs$/.test(script ?? ''));
    console.log(JSON.stringify({ byHand: lanes.byHand, ownLane: lanes.ownLane, lint }));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `scripts/lanes.mjs could not be read: ${result.stderr}`);
  return JSON.parse(result.stdout.trim().split('\n').at(-1));
}

/** A test file in a list entry: the entry itself when it names a file, else a probe file inside its folder. */
export const fileIn = (entry, name = 'probe-1875.test.mjs') => (entry.endsWith('/') ? `${entry}${name}` : entry);

/** A node:test file with one passing test. */
export const probe = (title) => `import test from 'node:test';\ntest(${JSON.stringify(title)}, () => {});\n`;

/** The merge base's scripts/ (`git archive $(git merge-base HEAD origin/main) scripts`), extracted into box.dir. */
export function mergeBaseScripts(box) {
  const base = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: CHECKOUT, encoding: 'utf8' });
  assert.equal(base.status, 0, `this checkout has no merge base with origin/main, so there is no "before": ${base.stderr}`);
  const folder = join(box.dir, 'merge-base');
  mkdirSync(folder);
  const result = spawnSync('sh', ['-c', 'git -C "$1" archive "$2" scripts | tar -xf - -C "$3"', 'sh', CHECKOUT, base.stdout.trim(), folder], { encoding: 'utf8' });
  assert.equal(result.status, 0, `git archive scripts failed: ${result.stderr}`);
  return join(folder, 'scripts');
}

/**
 * The tree affected.mjs runs in: a copy of `scripts` (this checkout's by default) with the lint lane's own scripts
 * replaced by stubs that pass and an empty known-failures baseline, this checkout's node_modules linked, `files`,
 * all committed in a fresh git repository, and a cargo stub on PATH whose metadata reports no crates.
 */
export function affectedTree(box, files, { scripts = join(CHECKOUT, 'scripts'), name = 'tree' } = {}) {
  const tree = join(box.dir, name);
  mkdirSync(tree);
  cpSync(scripts, join(tree, 'scripts'), { recursive: true });
  for (const script of lanesLists(tree).lint) writeFileSync(join(tree, script), '// a lint stub for #1875\n');
  writeFileSync(join(tree, 'scripts/known-failures.json'), `${JSON.stringify({ failures: {}, lint: {}, timing: [] }, null, 2)}\n`);
  symlinkSync(join(CHECKOUT, 'node_modules'), join(tree, 'node_modules'));
  for (const [path, content] of Object.entries({ '.gitignore': 'node_modules\n', ...files })) {
    mkdirSync(dirname(join(tree, path)), { recursive: true });
    writeFileSync(join(tree, path), content);
  }
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: tree, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'fixture');
  const bin = join(box.dir, `bin-${name}`);
  mkdirSync(bin);
  writeFileSync(join(bin, 'cargo'), '#!/bin/sh\nif [ "$1" = metadata ]; then echo \'{"packages":[],"workspace_members":[],"version":1}\'; exit 0; fi\necho "cargo stub: $*" >&2\nexit 0\n');
  chmodSync(join(bin, 'cargo'), 0o755);
  return { tree, env: { PATH: `${bin}${delimiter}${box.env.PATH}` } };
}

/** This checkout's file at `path`, as text. */
export const real = (path) => readFileSync(join(CHECKOUT, path), 'utf8');

/** `node scripts/affected.mjs ...args` in the tree. */
export const affected = (box, { tree, env }, args) => launch(box, [process.execPath, 'scripts/affected.mjs', ...args], { cwd: tree, env });

/** The summary line affected.mjs ends on: `<STATE> affected: ...`. */
export const summary = (stdout) => stdout.split('\n').filter((line) => / affected: /.test(line)).at(-1) ?? '';
/** The lines starting INCONCLUSIVE, other than the summary. */
export const inconclusive = (stdout) => stdout.split('\n').filter((line) => /^INCONCLUSIVE\b/.test(line) && !/^INCONCLUSIVE affected: /.test(line));
// The TIMED line lists the whole timed list, so it is cut short.
export const dump = (run) => `exit ${run.status}${run.signal ? ` (${run.signal})` : ''}\nstdout:\n${run.stdout.replace(/^(TIMED .{0,60}).*$/m, '$1 …')}\nstderr:\n${run.stderr}`;
