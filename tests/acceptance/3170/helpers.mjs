// Helpers for #3170's acceptance tests: which machine this is, a sandboxed HOME (so the real ~/.deepbuild is never
// read or written), running a process, the probe of a folder's reflink copy, a one-crate workspace whose test writes
// down the DEEP_TEST_COW_DIR it runs with, and the driver that reaches lanes.mjs by running it. Nothing here imports
// the code under test: a missing lane or export reads as an assertion failure, never as an import error.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
/** This machine, as an evidence record names one (lanes.mjs, writeRecord). */
export const PLATFORM = `${process.platform}-${process.arch}`;
/** The Spark is Linux on aarch64 (docs/parallel-proof.md, section 3). */
export const SPARK = 'linux-arm64';
/** The note a test skips with on a machine that can't prove its criterion: unrun, so never PASS (AGENTS.md, invariant 2). */
export const elsewhere = (needs) => `INCONCLUSIVE (platform): this needs ${needs}, and this machine is ${PLATFORM}; it is unrun here`;
/** A cold build of deep-hook's cli target takes minutes; a hang still ends. */
export const MINUTES = { timeout: 60 * 60_000 };

/** The test the issue names, in `crates/deep-hook/tests/cli.rs`. */
export const COW_TEST = 'a_folder_is_cloned_copy_on_write_where_the_file_system_can_and_exits_3_where_it_cannot';
/** The issue's command. */
export const CLI_TARGET = ['cargo', 'test', '-p', 'deep-hook', '--test', 'cli', '--locked'];

/**
 * A sandbox removed after the test, with its own HOME; rustup and cargo keep the machine's own homes, so the machine's
 * cargo config is read as a lane's cargo reads it. DEEP_TEST_COW_DIR is taken out of what the caller's shell gave: the
 * lane, or the machine's cargo, must supply it (README: The surface).
 */
export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3170-')));
  const home = join(dir, 'home');
  mkdirSync(home);
  const env = {
    ...process.env, HOME: home, XDG_CACHE_HOME: join(home, '.cache'),
    RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(homedir(), '.rustup'), CARGO_HOME: process.env.CARGO_HOME ?? join(homedir(), '.cargo'),
  };
  for (const name of ['DEEP_TEST_COW_DIR', 'DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES', 'CARGO_TARGET_DIR', 'DEEP_PROOF_ISSUES', 'DEEP_APPROVERS', 'DEEP_BIN_DIR', 'DEEP_PROOF_VITEST_REPORT']) delete env[name];
  const box = { dir, home, env, children: [] };
  t.after(() => {
    // Only the processes this test started, by their process group's PID.
    for (const child of box.children) if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

/** Runs `argv` in its own process group to its end: its status, and stdout with stderr in the order written. */
export function run(argv, { cwd = CHECKOUT, env = process.env, box } = {}) {
  const child = spawn('/bin/sh', ['-c', 'exec "$@" 2>&1', 'sh', ...argv], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box?.children.push(child);
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (status, signal) => resolve({ status, signal, output }));
  });
}

/** The last lines of an output, for a failure message. */
export const tail = (output, lines = 60) => output.trim().split('\n').slice(-lines).join('\n');

/**
 * Whether `folder` makes a reflink copy: GNU `cp --reflink=always` of a file written in a fresh folder inside it, as the
 * issue's Proof shows it. Its file system's type as `stat -f` names it, and what cp said.
 */
export async function reflinks(folder) {
  let probe;
  try {
    probe = mkdtempSync(join(folder, '.deep-3170-probe-'));
    writeFileSync(join(probe, 'probe'), 'p');
    const cp = await run(['cp', '--reflink=always', join(probe, 'probe'), join(probe, 'probe.copy')]);
    const type = (await run(['stat', '-f', '-c', '%T', folder])).output.trim();
    return { ok: cp.status === 0, type, said: cp.output.trim() };
  } catch (error) {
    return { ok: false, type: 'unknown', said: error.message };
  } finally {
    if (probe) rmSync(probe, { recursive: true, force: true });
  }
}

/** A fresh folder, removed after the test, on a file system of this machine that can't make a reflink copy, or undefined. */
export async function noReflinkFolder(t) {
  for (const root of ['/var/tmp', tmpdir(), '/dev/shm']) {
    if (!existsSync(root) || (await reflinks(root)).ok) continue;
    const folder = realpathSync(mkdtempSync(join(root, 'deep-3170-plain-')));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
  }
}

const gitIn = (cwd) => (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, stdio: 'pipe', encoding: 'utf8' });

/** What the probe test writes when it runs with no DEEP_TEST_COW_DIR. */
export const UNSET = '<unset>';

/**
 * A workspace of one crate, as a clean, committed repository at box.dir/work, with the checkout's toolchain. Its one
 * test writes the DEEP_TEST_COW_DIR it runs with, or UNSET, to `seen`, and passes either way.
 */
export function probeWorkspace(box) {
  const cwd = join(box.dir, 'work'), seen = join(box.dir, 'seen');
  const files = {
    '.gitignore': '/target\n',
    'Cargo.toml': '[workspace]\nmembers = ["probe"]\nresolver = "2"\n',
    'Cargo.lock': '# This file is automatically @generated by Cargo.\n# It is not intended for manual editing.\nversion = 4\n\n[[package]]\nname = "probe"\nversion = "0.0.0"\n',
    'probe/Cargo.toml': '[package]\nname = "probe"\nversion = "0.0.0"\nedition = "2021"\npublish = false\n\n[lib]\ndoctest = false\n',
    'probe/src/lib.rs': `#[cfg(test)]
mod tests {
    #[test]
    fn writes_down_the_copy_on_write_folder() {
        let folder = std::env::var("DEEP_TEST_COW_DIR").unwrap_or_else(|_| "${UNSET}".into());
        std::fs::write(r#"${seen}"#, folder).unwrap();
    }
}
`,
    'rust-toolchain.toml': readFileSync(join(CHECKOUT, 'rust-toolchain.toml'), 'utf8'),
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
  const git = gitIn(cwd);
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'A test that writes down its copy-on-write folder');
  return { cwd, seen };
}

// lanes.mjs reached by running it. The lane is the one of `checks` whose commands run the workspace's cargo test (the
// unit lane at the base), kept as it is but for its paths and its commands: it runs `command` when one is given, else
// its own `cargo test --workspace …` command alone.
const DRIVER = `import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [checkout, cwd, command] = process.argv.slice(2);
const { checks, runLanes } = await import(pathToFileURL(join(checkout, 'scripts/lanes.mjs')).href);
const cargoTest = (argv) => argv[0] === 'cargo' && argv[1] === 'test' && argv.includes('--workspace');
const lane = (checks ?? []).find(({ commands }) => commands.some(cargoTest));
if (!lane) { console.log('T3170: no lane of checks runs cargo test --workspace'); process.exit(97); }
const { paths, ...rest } = lane;
process.exitCode = runLanes([{ ...rest, commands: [command ? JSON.parse(command) : lane.commands.find(cargoTest)] }], { cwd });
`;

/** The real runLanes on that lane, in `cwd`, with the sandbox's environment: its exit status and what it printed. */
export async function runLane(box, cwd, command) {
  const file = join(box.dir, 'driver.mjs');
  if (!existsSync(file)) writeFileSync(file, DRIVER);
  const ran = await run([process.execPath, file, CHECKOUT, cwd, ...command ? [JSON.stringify(command)] : []], { cwd, env: box.env, box });
  assert.notEqual(ran.status, 97, `scripts/lanes.mjs names no lane that runs cargo test --workspace: ${ran.output}`);
  return ran;
}
