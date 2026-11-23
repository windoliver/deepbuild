// Helpers for #3066's acceptance tests, written for this suite only (README). A scene is a scratch git repository
// holding a copy of this checkout's scripts/ on origin/main; a plant is a commit on top that appends statements to its
// scripts/lanes.mjs. The lint lane's commands, `lanes.mjs alone --by-reason` and affected.mjs run there as they do in a
// worktree. Nothing here imports the code under test: lanes.mjs is read by a child (lanes-read.mjs), so a missing
// export reads as an assertion failure, never as an import error.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, appendFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const READ = fileURLToPath(new URL('./lanes-read.mjs', import.meta.url));
export const REASONS = ['binary', 'timing', 'shared'];
/** A scene's runs are seconds on an idle machine; the Mac may be loaded, and a hang still ends. */
export const LONG = { timeout: 15 * 60_000 };
const RUN_MS = 10 * 60_000;

// Nothing of the caller's run reaches a scene: no grant, no binaries, no issue list, no cargo or jobserver setting.
const ENV_OUT = /^(?:DEEP_|CARGO_(?!BUILD_JOBS$)|RUSTC|RUSTUP_TOOLCHAIN$|MAKEFLAGS$|MFLAGS$|NODE_TEST_CONTEXT$|__STRYKER_ACTIVE_MUTANT__$)/;

export function write(cwd, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
}

const tail = (text = '', size = 6_000) => (text.length > size ? `…${text.slice(-size)}` : text);
const ran = (result) => ({ status: result.status, signal: result.signal, stdout: result.stdout ?? '', stderr: result.stderr ?? '', all: `exit ${result.status}${result.signal ? ` (${result.signal})` : ''}${result.error ? ` (${result.error.message})` : ''}\nstdout:\n${tail(result.stdout)}\nstderr:\n${tail(result.stderr, 2_000)}` });

/**
 * A scratch repository, removed with the test: origin/main holds this checkout's scripts/ (node_modules linked to this
 * checkout's, ignored by git) and `files`. Its env has a HOME, a TMPDIR and a throttle table of the scene's own.
 * commit() writes files and commits them; every process a scene started is stopped by its process group's PID.
 */
export function scene(t, files = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3066-')));
  const cwd = join(dir, 'scene'), home = join(dir, 'home'), tmp = join(dir, 'tmp');
  for (const folder of [cwd, home, tmp]) mkdirSync(folder);
  const children = [];
  t.after(() => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true });
  });
  const env = { ...process.env, HOME: home, XDG_CACHE_HOME: join(home, '.cache'), TMPDIR: tmp, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  for (const name of Object.keys(env)) if (ENV_OUT.test(name)) delete env[name];
  // Read only inside a test run, which a scene's runs are: they descend from this node --test.
  env.DEEP_THROTTLE_TABLE = join(dir, 'throttle');
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, env, stdio: 'pipe', encoding: 'utf8' });
  cpSync(join(CHECKOUT, 'scripts'), join(cwd, 'scripts'), { recursive: true });
  symlinkSync(join(CHECKOUT, 'node_modules'), join(cwd, 'node_modules'));
  write(cwd, { '.gitignore': 'node_modules\n/target\n', ...files });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('checkout', '-q', '-b', 'change');
  const commit = (subject, more = {}) => {
    write(cwd, more);
    git('add', '-A');
    git('commit', '-qm', `${subject}\n\nPart of #9366`);
  };
  return { dir, cwd, home, env, git, commit, children };
}

// A plant is statements appended to the scene's scripts/lanes.mjs, each in a block of its own. It needs `alone` to be
// the exported array, and writes a reason only where lanes.mjs holds `aloneReasons` (README: The shapes); on a lanes.mjs
// with no reasons an entry is planted bare, so the module still loads.
const reasonOf = (entry, reason) => `if (typeof aloneReasons !== 'undefined') { if (aloneReasons instanceof Map) aloneReasons.${reason === null ? `delete(${JSON.stringify(entry)})` : `set(${JSON.stringify(entry)}, ${JSON.stringify(reason)})`}; else ${reason === null ? `delete aloneReasons[${JSON.stringify(entry)}]` : `aloneReasons[${JSON.stringify(entry)}] = ${JSON.stringify(reason)}`}; }`;
/** Statements that add `entry` to `alone`, with `reason` when one is given. */
export const adds = (entry, reason) => `{ alone.push(${JSON.stringify(entry)}); ${reason === undefined ? '' : reasonOf(entry, reason)} }`;
/** Statements that move `entry` out of `alone`, as a commit that takes its line out does: the entry and its reason. */
export const moves = (entry) => `{ const at = alone.indexOf(${JSON.stringify(entry)}); if (at >= 0) alone.splice(at, 1); ${reasonOf(entry, null)} }`;
/** Commits `statements` appended to the scene's scripts/lanes.mjs, with `files`. */
export function plant(box, subject, statements, files = {}) {
  appendFileSync(join(box.cwd, 'scripts/lanes.mjs'), `\n// Planted by tests/acceptance/3066: ${subject}.\n${statements.join('\n')}\n`);
  box.commit(subject, files);
}

/** What the lanes.mjs of `root` exports (lanes-read.mjs), and with `files` the blocks of `scripts` over them, read in `root`. */
export function lanesOf(root, { env = process.env, files, scripts = join(root, 'scripts'), dir } = {}) {
  let list = [];
  if (files) {
    list = [join(dir, `files-${Math.random().toString(36).slice(2)}.json`)];
    writeFileSync(list[0], JSON.stringify(files));
  }
  const result = ran(spawnSync(process.execPath, [READ, scripts, ...list], { cwd: root, env, encoding: 'utf8', timeout: RUN_MS, maxBuffer: 256 * 1024 * 1024 }));
  assert.equal(result.status, 0, `scripts/lanes.mjs of ${root} could not be read\n${result.all}`);
  return JSON.parse(result.stdout);
}

/** `node scripts/lanes.mjs alone --by-reason` in `root`. */
export const byReason = (root, env = process.env) => ran(spawnSync(process.execPath, ['scripts/lanes.mjs', 'alone', '--by-reason'], { cwd: root, env, encoding: 'utf8', timeout: RUN_MS }));

/**
 * The count per reason that `--by-reason` printed: a count line starts with the reason (after any table bar, bullet or
 * space) and ends with its count (before any table bar or space). A reason printed on several such lines, as `shared`
 * once per resource, counts their sum; a reason with no count line is missing (README: The shapes).
 */
export function counts(stdout) {
  const found = {};
  for (const line of stdout.split('\n')) {
    const [, reason, count] = line.match(/^[\s|*-]*`?(binary|timing|shared)\b.*?(\d+)[\s|]*$/) ?? [];
    if (reason) found[reason] = (found[reason] ?? 0) + Number(count);
  }
  return found;
}

function start(box, argv, { cwd = box.cwd, env = box.env } = {}) {
  const child = spawn(argv[0], argv.slice(1), { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  let timer;
  return Promise.race([
    new Promise((done) => child.on('close', (status, signal) => done({ status, signal, stdout, stderr }))),
    new Promise((done) => { timer = setTimeout(() => done({ status: null, signal: 'still running', stdout, stderr }), RUN_MS); }),
  ]).then((result) => {
    clearTimeout(timer);
    return ran(result);
  });
}

/**
 * The scene's lint lane: each command of the `lint` entry of its lanes.mjs's `checks` that node runs, run in the scene
 * as runLanes runs it (the same argv, in the checkout), side by side. The cargo commands (fmt, clippy) are left out:
 * they read no lane list and take minutes. Each result holds the command, its status and its output's lines.
 */
export async function lint(box) {
  const commands = lanesOf(box.cwd, { env: box.env }).lint.filter(([command]) => command === '<node>');
  assert.ok(commands.length, "the lint lane holds no command that node runs");
  return Promise.all(commands.map(async ([, ...args]) => {
    const result = await start(box, [process.execPath, ...args]);
    return { command: `node ${args.join(' ')}`, status: result.status, lines: `${result.stdout}\n${result.stderr}`.split('\n').map((line) => line.trimEnd()).filter(Boolean) };
  }));
}
/** The lint lane's commands that failed (exited non-zero) with a line of output holding `text`: each as `command: line`. */
export const failsNaming = (runs, text) => runs.filter(({ status }) => status !== 0).flatMap(({ command, lines }) => lines.filter((line) => line.includes(text)).map((line) => `${command}: ${line}`));
/** How a lint run reads in a failure message: each command's status and its first lines. */
export const shown = (runs) => runs.map(({ command, status, lines }) => `${command}: exit ${status}\n${lines.slice(0, 4).map((line) => `    ${line.slice(0, 300)}`).join('\n')}`).join('\n');

// --- The affected.mjs scene (moved-run.test.mjs) ---

// Where rustup's proxies live when cargo isn't on PATH.
const RUST_BINS = [join(homedir(), '.cargo', 'bin'), '/opt/homebrew/opt/rustup/bin'];

/** The env cargo runs under in a scene: the real toolchains, and a CARGO_HOME of the scene's, so no user config applies. */
export function cargoEnv(box) {
  return { ...box.env, PATH: [box.env.PATH, ...RUST_BINS.filter((bin) => existsSync(join(bin, 'cargo')))].join(delimiter), RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(homedir(), '.rustup'), CARGO_HOME: join(box.dir, 'cargo'), CARGO_NET_OFFLINE: 'true' };
}

/**
 * A Cargo workspace of one bin crate with no dependencies, named as a binary of this repository is (deep-hook), which
 * prints `word`; its Cargo.lock is made by cargo itself, offline, so the scene can commit it and build --locked.
 */
export function workspace(dir, env, word) {
  const files = {
    'Cargo.toml': '[workspace]\nresolver = "2"\nmembers = ["crates/deep-hook"]\n',
    'crates/deep-hook/Cargo.toml': '[package]\nname = "deep-hook"\nversion = "0.1.0"\nedition = "2021"\npublish = false\n',
    'crates/deep-hook/src/main.rs': `fn main() {\n    println!("${word}");\n}\n`,
  };
  const scratch = join(dir, 'lock');
  mkdirSync(scratch);
  write(scratch, files);
  const result = spawnSync('cargo', ['generate-lockfile', '--offline'], { cwd: scratch, env, encoding: 'utf8' });
  assert.equal(result.status, 0, `cargo can't run in the scene, so nothing can build: ${result.error?.message ?? result.stderr}`);
  return { ...files, 'Cargo.lock': readFileSync(join(scratch, 'Cargo.lock'), 'utf8') };
}

// What every planted test starts with: its checkout (the folder up from it that holds Cargo.toml) and a note().
const head = (file) => `import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let root = dirname(fileURLToPath(import.meta.url));
while (!existsSync(join(root, 'Cargo.toml')) && dirname(root) !== root) root = dirname(root);
const note = (fields) => appendFileSync(process.env.T3066_RECORD, JSON.stringify({ file: ${JSON.stringify(file)}, root, ...fields }) + '\\n');
`;
/** A node --test file that still reads its binary from target/debug/deep-hook, under its checkout, and runs it. */
export const readsTarget = (file, word) => `${head(file)}
test('deep-hook runs from target/debug', () => {
  const bin = join(root, 'target/debug/deep-hook');
  const result = spawnSync(bin, [], { encoding: 'utf8' });
  note({ bin, status: result.status, stdout: result.stdout?.trim() ?? null });
  assert.equal(result.status, 0, 'target/debug/deep-hook did not run');
  assert.equal(result.stdout.trim(), ${JSON.stringify(word)});
});
`;
/** The same reader for a folder that stays alone: where a shard holds no build of its own, it only notes that. */
export const readsTargetIfBuilt = (file, word) => `${head(file)}
test('deep-hook runs from target/debug where this checkout has built it', () => {
  const bin = join(root, 'target/debug/deep-hook');
  const result = existsSync(bin) ? spawnSync(bin, [], { encoding: 'utf8' }) : null;
  note({ bin, status: result?.status ?? null, stdout: result?.stdout?.trim() ?? null });
  if (result) assert.equal(result.stdout.trim(), ${JSON.stringify(word)});
});
`;
/** A node --test file that reads deep-hook from DEEP_BIN_DIR and runs it. */
export const readsBinDir = (file, word) => `${head(file)}
test('deep-hook runs from DEEP_BIN_DIR', () => {
  const dir = process.env.DEEP_BIN_DIR ?? null;
  const bin = dir ? join(dir, 'deep-hook') : null;
  const result = bin && existsSync(bin) ? spawnSync(bin, [], { encoding: 'utf8' }) : null;
  note({ bin, status: result?.status ?? null, stdout: result?.stdout?.trim() ?? null });
  assert.ok(result, 'no deep-hook in DEEP_BIN_DIR');
  assert.equal(result.stdout.trim(), ${JSON.stringify(word)});
});
`;
/** A node --test file that touches no binary. */
export const plain = (file) => `${head(file)}
test('a planted test that needs no binary passes', () => {
  note({});
  assert.equal(1, 1);
});
`;

/** `node scripts/affected.mjs <paths>` in the scene, in its own process group, with the planted tests' notes. */
export async function affected(box, paths) {
  const record = join(box.dir, 'record.jsonl');
  // One shard for the alone block, on the scene's own HOME, whatever the machine's disk holds.
  const result = await start(box, [process.execPath, 'scripts/affected.mjs', ...paths], { env: { ...cargoEnv(box), T3066_RECORD: record, DEEP_TEST_SHARD_FLOOR: '0', DEEP_SHARDS: '1' } });
  const notes = existsSync(record) ? readFileSync(record, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
  // A bare scene lacks the crates and docs most lint scripts read, so their findings fill the output: a failure message
  // keeps the run's own lines and every line that names a planted file, and counts the rest. The TIMED line lists the
  // real timed files, so it is left out too.
  const lines = result.stdout.split('\n').filter((line) => !line.startsWith('TIMED '));
  const kept = lines.filter((line) => !line.startsWith('NEW FAIL ') || /tests\/(?:acceptance\/93\d\d|fixture-3066)\//.test(line));
  const all = `exit ${result.status}${result.signal ? ` (${result.signal})` : ''}\nstdout (${lines.length - kept.length} NEW FAIL lines that name no planted file left out):\n${tail(kept.join('\n'), 12_000)}\nstderr:\n${tail(result.stderr, 2_000)}\nplanted tests' notes:\n${notes.map((note) => JSON.stringify(note)).join('\n')}`;
  return { ...result, notes, all };
}

/** `git <args>` in this checkout. */
export const gitHere = (...args) => {
  const result = spawnSync('git', args, { cwd: CHECKOUT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed in this checkout: ${result.stderr}`);
  return result.stdout;
};
