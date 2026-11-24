// Shared by #689's blind redraft (README.md beside this file). The tests reach the work only through the surfaces the
// issue names: rustc and cargo through rustup at the checkout's root, which read its rust-toolchain.toml, and
// scripts/preflight with the check lanes of scripts/lanes.mjs. Nothing here imports the code under test.
//
// A box is one test's folder under the system temporary folder. The preflight fixture in it is this checkout's own
// scripts/ (every file at its top level) and benchmarks/budgets.json, with three changes a test makes there and never in
// the checkout: lanes.mjs is moved to lanes-689.mjs behind a module that keeps all its exports and gives the check
// workload the lanes the test chose (the real lane objects, their commands swapped), and perf.mjs and agent-harness.mjs
// are stand-ins, so a check workload that passes never goes on to measure perf or start an agent.
import { spawnSync } from 'node:child_process';
import { chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { delimiter, dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The checkout these tests are in: the change, a twin laid over it, or the base with these tests. */
export const ROOT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const NODE = process.execPath;
export const MINUTE = 60_000;
/** The release the issue pins. */
export const PIN = '1.99.1';

// Each criterion's tag: `#689.<first 8 hex digits of the SHA-256 of its text, trimmed, white space collapsed>`.
export const AC1 = 'AC1 #689.6c214cc8';
export const AC2 = 'AC2 #689.aa1fa756';
export const AC3 = 'AC3 #689.4283cde6';
export const AC4 = 'AC4 #689.a5c89962';

/** The user's home as the password database has it, so a HOME a run gives itself never moves it. */
export const USER_HOME = userInfo().homedir;
/** The user's own rustup and Cargo homes: the caller's when set, else ~/.rustup and ~/.cargo. */
export const userRustupHome = () => process.env.RUSTUP_HOME || join(USER_HOME, '.rustup');
export const userCargoHome = () => process.env.CARGO_HOME || join(USER_HOME, '.cargo');

/** A reason of the machine, not the work: the test reads INCONCLUSIVE, never PASS and never a failure of the work. */
export function inconclusive(why) {
  throw new Error(`INCONCLUSIVE ${why}`);
}

/** The folder of rustup's proxies (rustup, rustc and cargo): on PATH first, then Homebrew's rustup and ~/.cargo/bin. */
export function rustupBin() {
  const folders = [...(process.env.PATH ?? '').split(delimiter), '/opt/homebrew/opt/rustup/bin', '/usr/local/opt/rustup/bin', join(USER_HOME, '.cargo/bin')];
  const found = folders.find((folder) => folder && ['rustup', 'rustc', 'cargo'].every((name) => existsSync(join(folder, name))));
  return found ?? inconclusive('no rustup: no folder on PATH, in /opt/homebrew/opt/rustup/bin or in ~/.cargo/bin holds rustup with its rustc and cargo; install rustup');
}

/** The 1.99.1 toolchains installed in the user's rustup home, by folder name (1.99.1-<host>). Nothing here installs one. */
export function pinnedInstalled(rustupHome = userRustupHome()) {
  const folder = join(rustupHome, 'toolchains');
  const names = existsSync(folder) ? readdirSync(folder).filter((name) => name.startsWith(`${PIN}-`)) : [];
  return names.length ? names : inconclusive(`Rust ${PIN} isn't installed in ${folder}, and no test here installs a toolchain; install it yourself: rustup toolchain install ${PIN} --component rustfmt --component clippy`);
}

/** No child of these tests downloads a toolchain or a component: auto-install is off and rustup's servers are a closed port. */
export const NO_DOWNLOAD = { RUSTUP_AUTO_INSTALL: '0', RUSTUP_DIST_SERVER: 'http://127.0.0.1:9', RUSTUP_UPDATE_ROOT: 'http://127.0.0.1:9/rustup' };

/**
 * This process's environment for a child, without the test runner's, git's or DeepBuild's variables and without a
 * forced toolchain (so the checkout decides), never downloading; `extra` sets or, with undefined, removes a variable.
 */
export function childEnv(extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'NODE_TEST_CONTEXT' || key === 'RUSTUP_TOOLCHAIN' || key.startsWith('GIT_') || key.startsWith('DEEP_')) continue;
    env[key] = value;
  }
  Object.assign(env, NO_DOWNLOAD, { CARGO_TERM_COLOR: 'never', NO_COLOR: '1' });
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}
export const withPath = (...folders) => [...folders, process.env.PATH ?? '/usr/bin:/bin'].join(delimiter);

/** A test's own folder under the system temporary folder, removed when the test ends. */
export function makeBox(t, name) {
  const box = realpathSync(mkdtempSync(join(tmpdir(), `deep-689-${name}-`)));
  t.after(() => rmSync(box, { recursive: true, force: true }));
  return box;
}

/**
 * Runs a command to its end in a process group of its own, its output written to `log` as it runs; past `timeout` the
 * whole group is stopped by its PID. `out` is what it printed.
 */
export function run(command, args, { cwd = ROOT, env, timeout = 10 * MINUTE, log }) {
  mkdirSync(dirname(log), { recursive: true });
  const descriptor = openSync(log, 'w');
  const started = performance.now();
  let result;
  try {
    result = spawnSync(command, args, { cwd, env, stdio: ['ignore', descriptor, descriptor], timeout, killSignal: 'SIGKILL', detached: true });
  } finally {
    closeSync(descriptor);
  }
  if (result.pid) {
    try {
      process.kill(-result.pid, 'SIGKILL');
    } catch { /* the group has ended */ }
  }
  const out = readFileSync(log, 'utf8');
  return { status: result.status, signal: result.signal, error: result.error, out, ms: performance.now() - started, timedOut: result.error?.code === 'ETIMEDOUT' };
}
export const tail = (text, characters = 4000) => (text.length > characters ? `…${text.slice(-characters)}` : text);
export const shown = (ran) => `exit ${ran.status}${ran.signal ? ` (${ran.signal})` : ''} after ${(ran.ms / 1000).toFixed(1)} s; output:\n${tail(ran.out)}`;

/** A heavy command at the checkout under its lease script (a cpu.slot when a hub runs) at a lower priority. */
export function leased(args, options) {
  const lease = join(ROOT, 'scripts/lease');
  return existsSync(lease) ? run(lease, ['nice', '-n', '10', ...args], options) : run('nice', ['-n', '10', ...args], options);
}

/** Whether `path` is `folder` or inside it. */
export function inside(path, folder) {
  const rest = relative(resolve(folder), resolve(path));
  return rest === '' || (!rest.startsWith('..') && !isAbsolute(rest));
}

/** The JSON lines a probe or stand-in appended to `file`. */
export const records = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);

// ---- The preflight fixture

const WRAPPER = (select) => `// #689's preflight fixture (tests/acceptance/689-redraft-2047/helpers.mjs): this checkout's lanes.mjs, moved to
// lanes-689.mjs with every export kept, and the check lanes the test chose: the real lane objects, their commands swapped.
export * from './lanes-689.mjs';
import { checks as all } from './lanes-689.mjs';
export const checks = (${select})(all);
`;
const STAND_IN = (name) => `// #689's preflight fixture: ${name} stands in, so the fixture measures nothing and starts no agent.
console.log('fixture: ${name} stands in and ran nothing');
process.exitCode = 1;
`;

/**
 * Runs `scripts/preflight` in a fixture under `box`: this checkout's scripts/ and benchmarks/budgets.json, its check
 * workload given the lanes `select` (the source of a function from scripts/lanes.mjs's check lanes to the lanes to run).
 * The fixture is no git repository and git looks for none above it, so no lane writes an evidence record.
 */
export function fixturePreflight(box, name, { select, env, timeout = 20 * MINUTE }) {
  const repo = join(box, name);
  mkdirSync(join(repo, 'scripts'), { recursive: true });
  mkdirSync(join(repo, 'benchmarks'), { recursive: true });
  for (const entry of readdirSync(join(ROOT, 'scripts'), { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const from = join(ROOT, 'scripts', entry.name), to = join(repo, 'scripts', entry.name);
    copyFileSync(from, to);
    chmodSync(to, statSync(from).mode & 0o777);
  }
  copyFileSync(join(ROOT, 'benchmarks/budgets.json'), join(repo, 'benchmarks/budgets.json'));
  renameSync(join(repo, 'scripts/lanes.mjs'), join(repo, 'scripts/lanes-689.mjs'));
  writeFileSync(join(repo, 'scripts/lanes.mjs'), WRAPPER(select));
  for (const stood of ['perf.mjs', 'agent-harness.mjs']) writeFileSync(join(repo, 'scripts', stood), STAND_IN(stood));
  const throttle = join(box, `${name}-throttle`), temporary = join(box, `${name}-tmp`);
  mkdirSync(temporary, { recursive: true });
  // Under a build grant of its own throttle table (which the throttle reads only inside a test run), so the preflight's
  // timed request is nested and starts at any load, and never waits on or holds up this machine's builds; no git
  // repository above the fixture.
  const ran = run(NODE, [join(repo, 'scripts/throttle.mjs'), 'build', '--wait', '5', '--', join(repo, 'scripts/preflight')], {
    cwd: repo,
    env: { ...env, DEEP_THROTTLE_TABLE: throttle, GIT_CEILING_DIRECTORIES: box, TMPDIR: temporary },
    timeout,
    log: join(box, `${name}.log`),
  });
  if (/DEEP_THROTTLE_TABLE is read only inside a test run/.test(ran.out)) inconclusive('the preflight fixture runs only under node --test, which keeps its throttle table its own: node --test tests/acceptance/689-redraft-2047/');
  if (/^INCONCLUSIVE no grant\b/m.test(ran.out)) inconclusive(`the fixture's preflight got no timed grant: ${tail(ran.out, 600)}`);
  return ran;
}
