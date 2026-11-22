// Shared by #3100's acceptance tests (README.md beside this file). The tests reach the work only through the surfaces
// the issue names: cargo at the checkout's root, the unit lane's reader of cargo test's output (`cargoResults`, given
// the workspace by its sibling `crates`, in scripts/lanes.mjs) and scripts/known-failures.json. A workspace-wide cargo
// command runs as a lane runs its own: under a build grant of the machine's throttle (scripts/throttle.mjs), then the
// checkout's lease script, at a lower priority.
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The checkout these tests are in: main, the change, or the base with these tests. */
export const ROOT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

// Each criterion's tag: `#3100.<first 8 hex digits of the SHA-256 of its text, trimmed, white space collapsed>`.
export const AC1 = '#3100.18bcb434';
export const AC2 = '#3100.40d22871';
export const AC3 = '#3100.89720c19';

/** A reason of the machine, not the work: the test reads INCONCLUSIVE, never PASS and never a failure of the work. */
export function inconclusive(why) {
  throw new Error(`INCONCLUSIVE ${why}`);
}

const USER_HOME = userInfo().homedir;

/** The folder of rustup's proxies (rustup, rustc and cargo): on PATH first, then Homebrew's rustup and ~/.cargo/bin. */
export function rustupBin() {
  const folders = [...(process.env.PATH ?? '').split(delimiter), '/opt/homebrew/opt/rustup/bin', '/usr/local/opt/rustup/bin', join(USER_HOME, '.cargo/bin')];
  const found = folders.find((folder) => folder && ['rustup', 'rustc', 'cargo'].every((name) => existsSync(join(folder, name))));
  return found ?? inconclusive('no rustup: no folder on PATH, in /opt/homebrew/opt/rustup/bin or in ~/.cargo/bin holds rustup with its rustc and cargo');
}

/**
 * This process's environment for a cargo child: rustup's proxies first on PATH, the user's rustup and Cargo homes (the
 * caller's when set), the toolchain left to the checkout (no RUSTUP_TOOLCHAIN) and the host's own target (no
 * CARGO_BUILD_TARGET), no git or test-runner variables, and rustup never downloading a toolchain or a component.
 * Builds take no incremental state and no debug info, as the repository's scripts build, unless the caller says else.
 */
export function childEnv(bin) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (['NODE_TEST_CONTEXT', 'RUSTUP_TOOLCHAIN', 'CARGO_BUILD_TARGET'].includes(key) || key.startsWith('GIT_')) continue;
    env[key] = value;
  }
  return {
    ...env,
    PATH: [bin, process.env.PATH ?? '/usr/bin:/bin'].join(delimiter),
    RUSTUP_HOME: process.env.RUSTUP_HOME || join(USER_HOME, '.rustup'),
    CARGO_HOME: process.env.CARGO_HOME || join(USER_HOME, '.cargo'),
    RUSTUP_AUTO_INSTALL: '0',
    RUSTUP_DIST_SERVER: 'http://127.0.0.1:9',
    RUSTUP_UPDATE_ROOT: 'http://127.0.0.1:9/rustup',
    CARGO_TERM_COLOR: 'never',
    CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? '0',
    CARGO_PROFILE_DEV_DEBUG: process.env.CARGO_PROFILE_DEV_DEBUG ?? '0',
  };
}

/** A test's own folder under the system temporary folder, removed when the test ends. */
export function makeBox(t, name) {
  const box = realpathSync(mkdtempSync(join(tmpdir(), `deep-3100-${name}-`)));
  t.after(() => rmSync(box, { recursive: true, force: true }));
  return box;
}

/**
 * Runs a command to its end in a process group of its own, its output written to `log` as it runs; past `timeout` the
 * whole group is stopped by its PID. `out` is what it printed.
 */
export function run(command, args, { cwd = ROOT, env, timeout, log }) {
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
  return { status: result.status, signal: result.signal, error: result.error, out: readFileSync(log, 'utf8'), ms: performance.now() - started, timedOut: result.error?.code === 'ETIMEDOUT', log };
}
export const tail = (text, characters = 3000) => (text.length > characters ? `…${text.slice(-characters)}` : text);
// A log in the checkout is kept; one in a test's box goes with it, so only its end is shown.
export const shown = (ran) => `exit ${ran.status}${ran.signal ? ` (${ran.signal})` : ''} after ${(ran.ms / MINUTE).toFixed(1)} min; ${ran.log.startsWith(`${ROOT}/`) ? `whole output in ${ran.log.replace(`${ROOT}/`, '')}; ` : ''}its end:\n${tail(ran.out)}`;

/** How long a test with a workspace-wide cargo run may take: the wait for a grant, then the grant's 12-hour bound. */
export const WORKSPACE_TEST = 24 * HOUR;

/**
 * A workspace-wide cargo command at the checkout, as a lane runs one: a build grant of the machine's throttle (waiting
 * up to 10 hours for one: the machine runs one build at a time, for every session on it), then the lease script, at
 * nice 10. Its output is kept in target/acceptance-3100/<name>.log.
 */
export function workspaceCargo(name, args, env) {
  return run(process.execPath, [join(ROOT, 'scripts/throttle.mjs'), 'build', '--wait', '600', '--', join(ROOT, 'scripts/lease'), 'nice', '-n', '10', ...args], {
    env,
    timeout: 22 * HOUR,
    log: join(ROOT, 'target/acceptance-3100', `${name}.log`),
  });
}

/** Ends the test INCONCLUSIVE when the run didn't come to its own end: never started, stopped, or given no grant. */
export function cameToItsEnd(name, ran) {
  if (ran.error && !ran.timedOut) inconclusive(`${name} could not start: ${ran.error.message}`);
  if (ran.timedOut) inconclusive(`${name} was stopped after ${(ran.ms / HOUR).toFixed(1)} h, its time limit. ${shown(ran)}`);
  if (ran.signal || ran.status >= 128) inconclusive(`${name} was stopped by a signal, not by its own end. ${shown(ran)}`);
  if ((ran.status === 2 || ran.status === 3) && /^(?:INCONCLUSIVE|BLOCKED) (?:no grant|throttle)\b/m.test(ran.out)) inconclusive(`${name} got no build grant from scripts/throttle.mjs, or lost it. ${shown(ran)}`);
}

// What the machine, not the code, does to a cargo run: a toolchain or component missing (nothing downloads one), crates
// that can't be fetched, a full disk, or a compiler or test binary the system killed.
const MACHINE = /toolchain '[^']+' is not installed|is not installed for the toolchain|failed to download|failed to get `[^`]+` as a dependency|Couldn't resolve host|spurious network error|failed to query replaced source|No space left on device|\(signal: 9, SIGKILL: kill\)/;
/** The machine's mark on a failed cargo run's output, if it carries one. */
export const machineMark = (ran) => (ran.status !== 0 ? ran.out.match(MACHINE)?.[0] : undefined);

/**
 * What the unit lane's reader makes of cargo test's output: `cargoResults(output, status, crates(cwd))` of the
 * checkout's scripts/lanes.mjs, as its `testsOf` calls it. crates() asks cargo metadata, which it finds on PATH in this
 * process's environment, so the cargo run's environment stands in for the call.
 */
export async function readCargo(cwd, output, status, env) {
  const { cargoResults, crates } = await import(pathToFileURL(join(ROOT, 'scripts/lanes.mjs')).href);
  const saved = { ...process.env };
  for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
  Object.assign(process.env, env);
  try {
    return cargoResults(output, status, crates(cwd));
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}
