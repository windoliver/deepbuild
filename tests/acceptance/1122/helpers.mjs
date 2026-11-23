// Helpers for #1122's acceptance tests: a sandbox with two HOMEs (the session's machine and the far one), stand-ins for
// the boundaries this repository doesn't own (ssh and scp to another machine, npm's registry, cargo where a scene has
// no crate), the scratch repositories the real scripts run in, and planted evidence records. Nothing here imports the
// code under test: every surface is reached by running it, so a missing script or export reads as a failed assertion,
// never as an import error (README: The surfaces).
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statfsSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir, userInfo } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
/** The name the stand-in ssh answers to; any other host fails as an unknown one does. */
export const HOST = 'far-1122';
/** A lane run takes seconds on an idle machine and minutes on a loaded one; a hang still ends. */
export const LONG = { timeout: 900_000 };
/** The scene that builds deep-hook's tests cold, twice more warm. */
export const BUILD = { timeout: 3_600_000 };
export const STATES = ['FAIL', 'INVALID', 'BLOCKED', 'INCONCLUSIVE'];
export const worst = (states) => STATES.find((state) => states.includes(state)) ?? 'PASS';
/** The exit status the design gives a state (section 8): 0 PASS, 1 FAIL, 2 INCONCLUSIVE, 3 BLOCKED or INVALID. */
export const EXIT = { PASS: 0, FAIL: 1, INCONCLUSIVE: 2, BLOCKED: 3, INVALID: 3 };
const ENV_OUT = ['DEEP_THROTTLE', 'DEEP_THROTTLE_TABLE', 'DEEP_THROTTLE_READINGS', 'DEEP_PERF_LOCK', 'NODE_TEST_CONTEXT', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES', 'CARGO_TARGET_DIR',
  'DEEP_PROOF_ISSUES', 'DEEP_APPROVERS', 'DEEP_PROOF_VITEST_REPORT', 'DEEP_BIN_DIR', 'GIT_CONFIG_PARAMETERS', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_SSH', 'GIT_SSH_COMMAND'];

/** A test's id, as the lanes' records write it: the repo path, then each name, joined by ` › `. */
export const idOf = (file, ...names) => [file, ...names].join(' › ');
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// ssh, at the boundary to another machine: the command runs here, as the far machine's user, with the far HOME and a
// fresh environment, in that HOME. Each call is logged. A host other than HOST is unknown.
const SSH = `#!/bin/sh
printf '%s\\n' "$*" >> "$T1122_LOG/ssh"
while [ $# -gt 0 ]; do
  case "$1" in
    -[bcDEeFIiJLlmOopQRSWw]) shift 2 ;;
    -*) shift ;;
    *) break ;;
  esac
done
host="\${1#*@}"
shift
if [ "$host" != "$T1122_HOST" ]; then echo "ssh: Could not resolve hostname $host: nodename nor servname provided, or not known" >&2; exit 255; fi
if [ $# -eq 0 ]; then echo "ssh stand-in: no command, and no terminal to give" >&2; exit 255; fi
cd "$T1122_FAR_HOME" || exit 255
exec /usr/bin/env -i HOME="$T1122_FAR_HOME" PATH="$T1122_FAR_PATH" USER="\${USER:-fixture}" LOGNAME="\${USER:-fixture}" SHELL=/bin/sh LANG=C TMPDIR="$T1122_FAR_TMP" \\
  T1122_LOG="$T1122_LOG" T1122_NODE_MODULES="$T1122_NODE_MODULES" /bin/sh -c "$*"
`;
// scp, likewise: `host:path` is a path in the far HOME.
const SCP = `#!/bin/sh
printf '%s\\n' "$*" >> "$T1122_LOG/scp"
recursive=
set_args=
for arg in "$@"; do
  case "$arg" in
    -r|-rp|-pr|-rq|-qr) recursive=-R ;;
    -*) ;;
    "$T1122_HOST":*|*@"$T1122_HOST":*)
      path="\${arg#*:}"
      case "$path" in "~/"*) path="$T1122_FAR_HOME/\${path#\\~/}" ;; /*) ;; *) path="$T1122_FAR_HOME/$path" ;; esac
      set_args="$set_args
$path" ;;
    *) set_args="$set_args
$arg" ;;
  esac
done
IFS='
'
set -- $set_args
exec /bin/cp $recursive "$@"
`;
// npm, at the boundary to its registry: \`npm ci\` installs by linking this checkout's installed packages, and a
// package build has nothing to build in a fixture. Each call is logged with its folder.
const NPM = `#!/bin/sh
printf '%s\\t%s\\n' "$PWD" "$*" >> "$T1122_LOG/npm"
if [ "$1" = ci ] || [ "$1" = install ]; then
  mkdir -p node_modules
  for entry in "$T1122_NODE_MODULES"/* "$T1122_NODE_MODULES"/.bin; do
    name=$(basename "$entry")
    [ -e "node_modules/$name" ] || ln -s "$entry" "node_modules/$name"
  done
fi
exit 0
`;
// cargo, for a scene with no crate: \`metadata\` reports none, and every other call does nothing.
const CARGO = `#!/bin/sh
printf '%s\\t%s\\n' "$PWD" "$*" >> "$T1122_LOG/cargo"
if [ "$1" = metadata ]; then echo '{"packages":[],"workspace_members":[],"version":1}'; fi
exit 0
`;
const GITCONFIG = '[user]\n\tname = Fixture\n\temail = fixture@example.invalid\n[commit]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n[core]\n\thooksPath = /dev/null\n';

/**
 * A sandbox removed after the test: `home` is the session's machine's HOME and `far` the far machine's, each with a
 * git identity; `log` holds the stand-ins' call logs. Every process a test started is stopped, by its group's PID.
 */
export function sandbox(t, { cargo = 'stub' } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-1122-')));
  const box = { dir, home: join(dir, 'home'), far: join(dir, 'far-home'), log: join(dir, 'log'), children: [] };
  for (const folder of [box.home, box.far, box.log, join(dir, 'far-tmp'), join(dir, 'bin'), join(dir, 'far-bin')]) mkdirSync(folder);
  for (const home of [box.home, box.far]) writeFileSync(join(home, '.gitconfig'), GITCONFIG);
  const tools = { ssh: SSH, scp: SCP, npm: NPM, ...(cargo === 'stub' ? { cargo: CARGO } : {}) };
  for (const [tool, script] of Object.entries(tools)) {
    for (const bin of tool === 'ssh' || tool === 'scp' ? ['bin'] : ['bin', 'far-bin']) {
      writeFileSync(join(dir, bin, tool), script);
      chmodSync(join(dir, bin, tool), 0o755);
    }
  }
  const system = '/usr/bin:/bin:/usr/sbin:/sbin';
  const nodeBin = dirname(process.execPath);
  const shared = { T1122_LOG: box.log, T1122_NODE_MODULES: join(CHECKOUT, 'node_modules') };
  box.farEnv = { HOME: box.far, PATH: [join(dir, 'far-bin'), nodeBin, system].join(delimiter), USER: process.env.USER ?? 'fixture', LANG: 'C', TMPDIR: join(dir, 'far-tmp'), ...shared };
  box.env = { ...process.env, HOME: box.home, XDG_CACHE_HOME: join(box.home, '.cache'), PATH: [join(dir, 'bin'), process.env.PATH].join(delimiter),
    T1122_HOST: HOST, T1122_FAR_HOME: box.far, T1122_FAR_PATH: box.farEnv.PATH, T1122_FAR_TMP: box.farEnv.TMPDIR, ...shared };
  for (const name of ENV_OUT) delete box.env[name];
  // The real cargo keeps its toolchain and registry in the person's home, as tests/vitest-setup.ts gives them.
  if (cargo === 'real') Object.assign(box.env, { CARGO_HOME: process.env.CARGO_HOME ?? join(userInfo().homedir, '.cargo'), RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(userInfo().homedir, '.rustup') });
  t.after(() => {
    for (const child of box.children) stop(child);
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

/** Stops a process launch started, by its process group's PID. */
export function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try { process.kill(-child.pid, 'SIGKILL'); } catch {}
}

/** Starts `argv` in its own process group; resolves with its status and output. `input` is written to its stdin. */
export function launch(box, argv, { env = box.env, cwd = box.dir, input } = {}) {
  const child = spawn(argv[0], argv.slice(1), { cwd, env, detached: true, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
  box.children.push(child);
  if (input !== undefined) child.stdin.end(input);
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  return new Promise((resolve) => {
    child.on('error', (error) => resolve({ status: null, signal: null, stdout, stderr: `${stderr}\n${error.message}` }));
    child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

// The end of an output, each line cut short: a lane prints its whole vitest command.
const tail = (text, size = 3_000) => {
  const cut = text.split('\n').map((line) => (line.length > 300 ? `${line.slice(0, 300)}…` : line)).join('\n');
  return cut.length > size ? `…${cut.slice(-size)}` : cut;
};
export const dump = (...runs) => runs.map((run) => `exit ${run.status}${run.signal ? ` (${run.signal})` : ''}\nstdout:\n${tail(run.stdout)}\nstderr:\n${tail(run.stderr, 1_500)}`).join('\n');
export const lines = (run) => run.stdout.split('\n').map((line) => line.trimEnd()).filter(Boolean);

export function write(cwd, files) {
  for (const [path, content] of Object.entries(files)) {
    if (content === null) { rmSync(join(cwd, path), { force: true }); continue; }
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
}
/** git in a folder, with a HOME of the sandbox's so no setting of the person's is read. */
export const gitIn = (box, cwd, home = box.home) => (...args) => execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8', env: { ...box.env, HOME: home } }).trim();

/** The lists of the checkout's lanes.mjs, read by a child. */
function aloneFolder() {
  const code = `const lanes = await import(${JSON.stringify(pathToFileURL(join(CHECKOUT, 'scripts/lanes.mjs')).href)}); console.log(JSON.stringify(lanes.alone ?? null));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: CHECKOUT, encoding: 'utf8' });
  assert.equal(result.status, 0, `scripts/lanes.mjs could not be read: ${result.stderr}`);
  const folder = JSON.parse(result.stdout.trim().split('\n').at(-1))?.find((entry) => entry.endsWith('/') && !entry.includes('1122'));
  assert.ok(folder, 'scripts/lanes.mjs exports no alone folder');
  return folder;
}

// A test notes that it ran, where and on what, in its machine's HOME: the session's machine and the far one each keep
// their own list.
const NOTE = "import { appendFileSync as note1122 } from 'node:fs';\nconst ran1122 = (name) => note1122(`${process.env.HOME}/.ran-1122`, `${JSON.stringify({ name, cwd: process.cwd() })}\\n`);\n";
/** A vitest fixture file holding `body`; `ran1122(name)` notes a test's run. */
export const vitestFile = (body) => `import { existsSync } from 'node:fs';\nimport { expect, test } from 'vitest';\n${NOTE}${body}\n`;
/** A node --test fixture file holding `body`. The unit lane's node command reads tests/*.test.mjs. */
export const nodeFile = (body) => `import assert from 'node:assert/strict';\nimport test from 'node:test';\n${NOTE}${body}\n`;
/** The names of the tests that noted a run in a HOME, and where each ran. */
export function ran(home) {
  const file = join(home, '.ran-1122');
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
}
export const forget = (home) => rmSync(join(home, '.ran-1122'), { force: true });

// The repo's config with its include written out: importing it from lanes.mjs needs the workspace packages built.
const VITEST_CONFIG = `import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts', 'packages/**/test/**/*.test.ts', 'packages/**/*.test.ts'] } });
`;
const PACKAGE = { name: 'fixture-1122', version: '0.0.0', private: true, type: 'module', workspaces: ['packages/*'] };
const LOCK = { name: PACKAGE.name, version: PACKAGE.version, lockfileVersion: 3, requires: true, packages: { '': { name: PACKAGE.name, version: PACKAGE.version, workspaces: PACKAGE.workspaces } } };

/**
 * A session's worktree (README: The scratch repositories): a repository at box.dir/<name> holding this checkout's
 * scripts/, a vitest config, a lock file, an empty known-failures list, one passing test for each runner command of
 * the unit lane, and `base`, committed on main, which origin/main names; then `files` committed on the branch
 * `change`, so the merge base is the first commit and HEAD the second. node_modules is a folder of links, ignored.
 * `copy` names real files and folders of this checkout to carry too, and `prepare` runs before the first commit.
 */
export function worktree(box, { base = {}, files = {}, copy = [], prepare, name = 'session' } = {}) {
  const cwd = join(box.dir, name);
  mkdirSync(cwd);
  // Real components of this checkout, as they are on disk, less what git ignores there. Copies, never links: a
  // scene's cargo rewrites its own lock.
  for (const path of ['scripts', ...copy]) cpSync(join(CHECKOUT, path), join(cwd, path), { recursive: true, dereference: true, filter: (from) => !/\/(?:node_modules|target)$/.test(from) });
  writeFileSync(join(cwd, 'scripts/known-failures.json'), `${JSON.stringify({ failures: {}, lint: {}, timing: [], skips: [] }, null, 2)}\n`);
  mkdirSync(join(cwd, 'node_modules'));
  for (const entry of readdirSync(join(CHECKOUT, 'node_modules')).filter((entry) => !entry.startsWith('.vite'))) symlinkSync(join(CHECKOUT, 'node_modules', entry), join(cwd, 'node_modules', entry));
  write(cwd, {
    '.gitignore': 'node_modules\ntarget\ndist\nignored-1122*\n',
    'vitest.config.mjs': VITEST_CONFIG,
    'package.json': `${JSON.stringify(PACKAGE, null, 2)}\n`,
    'package-lock.json': `${JSON.stringify(LOCK, null, 2)}\n`,
    'tsconfig.json': '{ "files": [] }\n',
    'tests/fixture-1122/pass.test.ts': vitestFile("test('a parallel vitest test passes', () => { expect(1).toBe(1); });"),
    [`${aloneFolder()}fixture-1122-pass.test.ts`]: vitestFile("test('an alone vitest test passes', () => { expect(1).toBe(1); });"),
    'tests/fixture-1122-pass.test.mjs': nodeFile("test('a node test passes', () => { assert.equal(1, 1); });"),
    ...base,
  });
  prepare?.(cwd);
  const git = gitIn(box, cwd);
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'The base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('checkout', '-q', '-b', 'change');
  write(cwd, { 'CHANGE.md': 'The change of this session.\n', ...files });
  git('add', '-A');
  git('commit', '-qm', 'The change');
  return { cwd, git, base: git('merge-base', 'HEAD', 'refs/remotes/origin/main'), head: git('rev-parse', 'HEAD') };
}

/** The tree hash of what is on disk, uncommitted and untracked non-ignored files too (design, section 10a). */
export function exactTree(box, cwd) {
  const folder = mkdtempSync(join(box.dir, 'index-'));
  const index = join(folder, 'index'), source = join(cwd, '.git/index');
  copyFileSync(source, index);
  utimesSync(index, statSync(source).atime, statSync(source).mtime);
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...box.env, GIT_INDEX_FILE: index } }).trim();
  git('add', '-A');
  const tree = git('write-tree');
  rmSync(folder, { recursive: true, force: true });
  return tree;
}

/** A driver that runs the real unit lane of a tree's lanes.mjs, whole, through the real runLanes: a full run. */
const DRIVER = `import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const tree = process.argv[2];
const { checks, runLanes } = await import(pathToFileURL(join(tree, 'scripts/lanes.mjs')).href);
process.exitCode = runLanes(checks.filter(({ name }) => name === 'unit'), { cwd: tree });
`;
export function fullRun(box, cwd, env = box.env) {
  const driver = join(box.dir, 'driver.mjs');
  writeFileSync(driver, DRIVER);
  return launch(box, [process.execPath, driver, cwd], { cwd, env });
}
/** `node scripts/lane-remote.mjs ...args` in a tree: the script under test, as the design starts it. */
export const laneRemote = (box, cwd, args, options = {}) => launch(box, [process.execPath, 'scripts/lane-remote.mjs', ...args], { cwd, ...options });

/** The folder a machine's lanes write their evidence records into. */
export const lanesFolder = (home) => join(home, '.deepbuild', 'lanes');
/** A record read from a HOME by its file name, or null. */
export function record(home, name) {
  const file = join(lanesFolder(home), name);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}
export const recordNames = (home) => (existsSync(lanesFolder(home)) ? readdirSync(lanesFolder(home)).sort() : []);
/** Writes an evidence record where the lanes write them: <tree>-<lane>.json, or <tree>-<lane>-<host>.json for a fetched one. */
export function plant(home, { fetched = false, ...fields }) {
  mkdirSync(lanesFolder(home), { recursive: true });
  const file = join(lanesFolder(home), `${fields.tree}-${fields.lane}${fetched ? `-${fields.host}` : ''}.json`);
  writeFileSync(file, `${JSON.stringify(fields, null, 2)}\n`);
  return file;
}
/** A record as the Mac's lane writes it, and one as fetched from the Spark. */
export const macRecord = (tree, lane, state, tests, more = {}) => ({ lane, state, host: 'mac', platform: 'darwin-arm64', tree, tests, ...more });
export const sparkRecord = (tree, lane, state, tests, more = {}) => ({ fetched: true, lane, state, host: 'spark', platform: 'linux-arm64', tree, tests, bundle: sha256(''), recipe: null, ...more });
/** A tree hash no checkout has: 40 hex digits from a label. */
export const madeTree = (label) => createHash('sha1').update(`#1122 ${label}`).digest('hex');

/** mergeRecords(tree) of this checkout's lanes.mjs, called in a child with the sandbox's HOME. */
export function mergeOf(box, tree) {
  const code = `const lanes = await import(${JSON.stringify(pathToFileURL(join(CHECKOUT, 'scripts/lanes.mjs')).href)});
    if (typeof lanes.mergeRecords !== 'function') { console.log(JSON.stringify({ missing: true })); } else console.log(JSON.stringify({ merged: lanes.mergeRecords(${JSON.stringify(tree)}) }));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: box.dir, env: box.env, encoding: 'utf8' });
  let out = {};
  try { out = JSON.parse(result.stdout.trim().split('\n').at(-1)); } catch {}
  assert.ok(result.status === 0 && out.merged && typeof out.merged === 'object', `mergeRecords(tree) of scripts/lanes.mjs gave no merge: exit ${result.status}\n${result.stdout}\n${tail(result.stderr, 1_500)}`);
  return out.merged;
}

/** The last line `<STATE> <lane><rest>` of a run, as `{ state }`, or null: `rest` is ` on <host>` or ` (merged)`. */
export function verdictLine(run, lane, rest) {
  const found = lines(run).map((line) => (line.endsWith(` ${lane}${rest}`) ? line.slice(0, -` ${lane}${rest}`.length) : null)).filter((state) => ['PASS', ...STATES].includes(state));
  return found.at(-1) ?? null;
}
/** The path of the run's last `RECORD <path>` line, or null. */
export const recordLine = (run) => lines(run).filter((line) => line.startsWith('RECORD ')).at(-1)?.slice('RECORD '.length) ?? null;
/** Every string a record's `only` holds, however it groups its files and crates. */
export function onlyNames(only) {
  const names = [];
  const walk = (value) => {
    if (typeof value === 'string') names.push(value);
    else if (value && typeof value === 'object') for (const inner of Object.values(value)) walk(inner);
  };
  walk(only);
  return names;
}

/** The one worktree the far machine holds for the session, under the folder the design names. */
export function farWorktree(box, run) {
  const folder = join(box.far, 'deepbuild', '.claude', 'worktrees');
  const found = existsSync(folder) ? readdirSync(folder) : [];
  assert.equal(found.length, 1, `the far machine holds one worktree for the session under ~/deepbuild/.claude/worktrees/: ${JSON.stringify(found)}\n${run ? dump(run) : ''}`);
  return join(folder, found[0]);
}

/** A skip's note when a test can't run here, or undefined (invariant 2: unrun is never PASS). */
export function notOnMac() {
  return process.platform === 'darwin' ? undefined : `INCONCLUSIVE: the Mac's --only run and the macOS branches it proves need a Mac, and this is ${process.platform}`;
}
export function noRoom(gigabytes) {
  const { bavail, bsize } = statfsSync(tmpdir());
  const free = (bavail * bsize) / 2 ** 30;
  return free >= gigabytes ? undefined : `INCONCLUSIVE: ${free.toFixed(1)} GB free under ${tmpdir()}, and this scene's build needs ${gigabytes} GB`;
}
export function noCargo() {
  return spawnSync('cargo', ['--version'], { encoding: 'utf8' }).status === 0 ? undefined : 'BLOCKED: cargo is not on PATH, and this scene builds and tests the real deep-hook';
}
/** The packages a scene's real tests import must be built (npm run build --workspaces). */
export function notBuilt(...files) {
  const missing = files.filter((file) => !existsSync(join(CHECKOUT, file)));
  return missing.length ? `BLOCKED: ${missing.join(', ')} is not built here; run npm run build --workspaces first` : undefined;
}
/** Replaces the one place `from` stands in a file with `to`: a planted bug. */
export function plantBug(cwd, file, from, to) {
  const text = readFileSync(join(cwd, file), 'utf8');
  assert.equal(text.split(from).length, 2, `${file} holds the code the plant replaces, once: ${from}`);
  writeFileSync(join(cwd, file), text.replace(from, to));
}
export const here = hostname();
