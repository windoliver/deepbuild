// Helpers for #2136's acceptance tests: a sandbox with a HOME of its own (so the throttle's table is the test's),
// processes in their own groups stopped by PID, lanes.mjs read by a child process, and the scratch tree
// scripts/affected.mjs runs in (README: The affected.mjs tree). Nothing here imports the code under test.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const ENV_OUT = ['NODE_TEST_CONTEXT', 'NODE_OPTIONS', 'CARGO_TARGET_DIR', 'CARGO_MAKEFLAGS', 'MAKEFLAGS'];

/** A sandbox removed after the test, with its own HOME; every process it started is stopped by its group's PID. */
export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2136-')));
  const home = join(dir, 'home'), tmp = join(dir, 'tmp');
  mkdirSync(home);
  mkdirSync(tmp);
  // What a run leaves in its temporary folder, as affected.mjs's logs, goes with the sandbox.
  const env = { ...process.env, HOME: home, XDG_CACHE_HOME: join(home, '.cache'), TMPDIR: tmp };
  for (const name of Object.keys(env)) if (ENV_OUT.includes(name) || name.startsWith('DEEP_')) delete env[name];
  const box = { dir, env, children: [] };
  t.after(() => {
    for (const child of box.children) if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

/** Runs argv in the sandbox in its own process group; resolves with its status and output. */
export function launch(box, argv, { cwd, env = {} }) {
  const child = spawn(argv[0], argv.slice(1), { cwd, env: { ...box.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  return new Promise((resolve) => child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr })));
}

/**
 * What scripts/lanes.mjs at `root` exports, read by a child process: the `alone` and `byHand` lists, the unit lane's
 * commands without their first word (the node that runs them), and the lint lane's the same.
 */
export function lanesOf(root) {
  const code = `const lanes = await import(${JSON.stringify(pathToFileURL(join(root, 'scripts/lanes.mjs')).href)});
    const commands = (name) => lanes.checks.find((check) => check.name === name).commands.map(([, ...args]) => args);
    console.log(JSON.stringify({ alone: lanes.alone, byHand: lanes.byHand, unit: commands('unit'), lint: commands('lint') }));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: root, env: cleanEnv(), encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.equal(result.status, 0, `scripts/lanes.mjs could not be read: ${result.stderr}`);
  return JSON.parse(result.stdout.trim().split('\n').at(-1));
}

function cleanEnv() {
  const env = { ...process.env };
  for (const name of ENV_OUT) delete env[name];
  return env;
}

/** The lint lane's commands affected.mjs runs as scripts: each `[script, ...arguments]` whose script is under scripts/. */
export const lintScripts = (root) => lanesOf(root).lint.filter(([script]) => script?.startsWith('scripts/'));

/**
 * The repository's files in `root`: those git lists there, tracked or not yet, less those it ignores and those the
 * disk no longer holds, as the proof lanes list them.
 */
export function repoFiles(root) {
  const listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 }).split('\0').filter(Boolean);
  return [...new Set(listed)].filter((path) => existsSync(join(root, path))).sort();
}

/** A lint stand-in that prints nothing and passes. */
export const QUIET = '// a lint stand-in for #2136: it finds nothing\n';

/**
 * The tree affected.mjs runs in: a copy of this checkout's scripts/ with each script of the lint lane replaced by a
 * stand-in (`lint(script)` gives its text; by default one that prints nothing and passes) and an empty known-failures
 * baseline, this checkout's node_modules linked, `files`, all committed in a fresh git repository, and a cargo
 * stand-in on PATH whose metadata reports no crates.
 */
export function affectedTree(box, files, { lint = () => QUIET } = {}) {
  const tree = join(box.dir, 'tree');
  mkdirSync(tree);
  cpSync(join(CHECKOUT, 'scripts'), join(tree, 'scripts'), { recursive: true });
  for (const script of new Set(lintScripts(tree).map(([script]) => script))) writeFileSync(join(tree, script), lint(script));
  writeFileSync(join(tree, 'scripts/known-failures.json'), `${JSON.stringify({ failures: {}, lint: {}, timing: [] }, null, 2)}\n`);
  symlinkSync(join(CHECKOUT, 'node_modules'), join(tree, 'node_modules'));
  for (const [path, content] of Object.entries({ '.gitignore': 'node_modules\n', ...files })) {
    mkdirSync(dirname(join(tree, path)), { recursive: true });
    writeFileSync(join(tree, path), content);
  }
  const git = gitIn(tree);
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'fixture');
  const bin = join(box.dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'cargo'), '#!/bin/sh\nif [ "$1" = metadata ]; then echo \'{"packages":[],"workspace_members":[],"version":1}\'; exit 0; fi\necho "cargo stand-in: $*" >&2\nexit 0\n');
  chmodSync(join(bin, 'cargo'), 0o755);
  return { tree, env: { PATH: `${bin}${delimiter}${box.env.PATH}` } };
}

/** git in `cwd`, as a fixture's author, with no signing and no hooks. */
export const gitIn = (cwd, env = process.env) => (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, env, stdio: 'pipe', encoding: 'utf8' });

/** `node scripts/affected.mjs ...args` in the tree. */
export const affected = (box, { tree, env }, args) => launch(box, [process.execPath, 'scripts/affected.mjs', ...args], { cwd: tree, env });

/** A run's last line: the last line of its stdout that isn't empty. */
export const lastLine = (stdout) => stdout.split('\n').filter((line) => line.trim()).at(-1) ?? '';

/** Every file under `folder`, as paths from it. */
export function filesUnder(folder) {
  return readdirSync(folder, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
}

/** This checkout's file at `path`, as text. */
export const real = (path) => readFileSync(join(CHECKOUT, path), 'utf8');

// The TIMED line lists the whole timed list, so it is cut short; the sandbox's own path reads as <sandbox>.
export const dump = (box, run) => `exit ${run.status}${run.signal ? ` (${run.signal})` : ''}\nstdout:\n${run.stdout.replace(/^(TIMED .{0,60}).*$/m, '$1 …')}\nstderr:\n${run.stderr}`.split(box.dir).join('<sandbox>');
