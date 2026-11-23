// Shared by #2149's acceptance tests (README.md beside this file). They reach the work only through the surfaces the
// issue names: `cargo fmt` at the checkout's root, and the checkout's git history with `git diff -w
// --ignore-blank-lines`. Nothing here imports the code under test.
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The checkout these tests are in: the change, a twin laid over it, or the base with these tests. */
export const ROOT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const MINUTE = 60_000;

/** A reason of the machine, not the work: the test reads INCONCLUSIVE, never PASS and never a failure of the work. */
export function inconclusive(why) {
  throw new Error(`INCONCLUSIVE ${why}`);
}

/** The folder of rustup's proxies (cargo and rustup): on PATH first, then Homebrew's rustup, then ~/.cargo/bin. */
export function rustupBin() {
  const folders = [...(process.env.PATH ?? '').split(delimiter), '/opt/homebrew/opt/rustup/bin', '/usr/local/opt/rustup/bin', join(userInfo().homedir, '.cargo/bin')];
  const found = folders.find((folder) => folder && ['rustup', 'cargo'].every((name) => existsSync(join(folder, name))));
  return found ?? inconclusive('no rustup: no folder on PATH, in /opt/homebrew/opt/rustup/bin or in ~/.cargo/bin holds rustup and cargo');
}

/**
 * This process's environment for a child: rustup's proxies first on PATH, no forced toolchain (so the folder's
 * rust-toolchain.toml decides), never downloading a toolchain, and none of git's variables (so git finds the
 * repository of the folder it runs in, or none).
 */
export function childEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'NODE_TEST_CONTEXT' || key === 'RUSTUP_TOOLCHAIN' || key.startsWith('GIT_')) continue;
    env[key] = value;
  }
  return Object.assign(env, {
    PATH: [rustupBin(), process.env.PATH ?? '/usr/bin:/bin'].join(delimiter),
    RUSTUP_AUTO_INSTALL: '0',
    RUSTUP_DIST_SERVER: 'http://127.0.0.1:9',
    RUSTUP_UPDATE_ROOT: 'http://127.0.0.1:9/rustup',
    CARGO_TERM_COLOR: 'never',
    NO_COLOR: '1',
  });
}

/** A test's own folder under the system temporary folder, removed when the test ends. */
export function makeBox(t, name) {
  const box = realpathSync(mkdtempSync(join(tmpdir(), `deep-2149-${name}-`)));
  t.after(() => rmSync(box, { recursive: true, force: true }));
  return box;
}

/**
 * Runs a command to its end in a process group of its own, its output written to `log` as it runs; past `timeout` the
 * whole group is stopped by its PID. `out` is what it printed.
 */
export function run(command, args, { cwd, env, timeout = 25 * MINUTE, log }) {
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
  return { status: result.status, signal: result.signal, error: result.error, out: readFileSync(log, 'utf8'), ms: performance.now() - started, timedOut: result.error?.code === 'ETIMEDOUT' };
}

/** cargo under the checkout's lease script, at a lower priority. */
export function cargo(args, options) {
  const lease = join(ROOT, 'scripts/lease');
  return existsSync(lease) ? run(lease, ['nice', '-n', '10', 'cargo', ...args], options) : run('nice', ['-n', '10', 'cargo', ...args], options);
}

export const tail = (text, characters = 4000) => (text.length > characters ? `…${text.slice(-characters)}` : text);
export const shown = (ran) => `exit ${ran.status}${ran.signal ? ` (${ran.signal})` : ''} after ${(ran.ms / 1000).toFixed(1)} s; output:\n${tail(ran.out)}`;

const WORLD = /toolchain '[^']+' is not installed|is not installed for the toolchain|No space left on device|\(signal: 9, SIGKILL: kill\)/;

/** A cargo run the machine, not the code, ended or kept from starting, reads INCONCLUSIVE. */
export function world(name, ran) {
  if (ran.error && !ran.timedOut) inconclusive(`${name} could not start: ${ran.error.message}`);
  if (ran.timedOut) inconclusive(`${name} was stopped at its time limit: ${tail(ran.out, 1500)}`);
  if (ran.signal) inconclusive(`${name} was stopped by ${ran.signal}, not by its own end: ${tail(ran.out, 1500)}`);
  const found = ran.status !== 0 && ran.out.match(WORLD)?.[0];
  if (found) inconclusive(`${name} couldn't run here (${found}): ${tail(ran.out, 1500)}`);
}

/** rustfmt of the toolchain `folder` pins answers there, or the test reads INCONCLUSIVE; nothing is installed. */
export function rustfmtAnswers(folder, box, name) {
  const ran = run('cargo', ['fmt', '--version'], { cwd: folder, env: childEnv(), timeout: 5 * MINUTE, log: join(box, `${name}-version.log`) });
  if (ran.status !== 0 || !/^rustfmt /m.test(ran.out)) inconclusive(`cargo fmt doesn't answer in ${folder === ROOT ? 'the checkout' : 'the commit parent\'s tree'} (is the toolchain its rust-toolchain.toml pins installed with rustfmt? nothing here installs one): ${shown(ran)}`);
}

/** git in the checkout; the result as spawnSync gives it, output as text unless `encoding` says otherwise. */
export const git = (args, { cwd = ROOT, encoding = 'utf8' } = {}) => spawnSync('git', args, { cwd, env: childEnv(), encoding, maxBuffer: 1 << 30 });
