// Helpers for #1121's acceptance tests: which machine this is, a sandboxed HOME (so the real ~/.deepbuild is never
// read or written), a small cargo workspace the real lanes.mjs runs the real cargo on, and the drivers that reach
// lanes.mjs by running it. Nothing here imports the code under test: a missing export or lane reads as an assertion
// failure, never as an import error (README: The surface).
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
/** This machine, as an evidence record names one (lanes.mjs, writeRecord). */
export const PLATFORM = `${process.platform}-${process.arch}`;
/** The Spark is Linux on aarch64 (docs/parallel-proof.md, section 3). */
export const SPARK = 'linux-arm64';
export const MAC = 'darwin-arm64';
/** The note a test skips with on a machine that can't prove its criterion: unrun, so never PASS (AGENTS.md, invariant 2). */
export const elsewhere = (needs) => `INCONCLUSIVE (platform): this needs ${needs}, and this machine is ${PLATFORM}; it is unrun here`;
/** A whole-workspace build or test takes minutes warm and hours cold; a hang still ends. */
export const HOURS = { timeout: 6 * 3600_000 };
export const MINUTES = { timeout: 20 * 60_000 };

/** A skip that says a platform or GPU is missing, as lanes.mjs reads one (its PLATFORM pattern, section 10a). */
export const namesPlatform = (note) => typeof note === 'string' && !note.startsWith('BLOCKED') && /\b(?:macOS|Linux|darwin|Metal|GPU|platform)\b/i.test(note);

/** A sandbox removed after the test, with its own HOME; rustup and cargo keep the machine's own homes. */
export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-1121-')));
  const home = join(dir, 'home');
  mkdirSync(home);
  const env = {
    ...process.env, HOME: home, XDG_CACHE_HOME: join(home, '.cache'),
    RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(homedir(), '.rustup'), CARGO_HOME: process.env.CARGO_HOME ?? join(homedir(), '.cargo'),
  };
  for (const name of ['DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES', 'CARGO_TARGET_DIR', 'DEEP_PROOF_ISSUES', 'DEEP_APPROVERS', 'DEEP_BIN_DIR', 'DEEP_PROOF_VITEST_REPORT', 'DEEP_HUB_PLANT']) delete env[name];
  const box = { dir, home, env, children: [] };
  t.after(() => {
    // Only the processes this test started, by their process group's PID.
    for (const child of box.children) if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

/**
 * Runs `argv` in its own process group to its end: its status and output, stdout and stderr apart, and `merged`, both in
 * the order they were written when `merge` is set (cargo names a test target on stderr and its tests on stdout).
 */
export function run(argv, { cwd = CHECKOUT, env = process.env, box, merge = false, input } = {}) {
  const child = spawn(merge ? '/bin/sh' : argv[0], merge ? ['-c', 'exec "$@" 2>&1', 'sh', ...argv] : argv.slice(1), { cwd, env, detached: true, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
  box?.children.push(child);
  if (input !== undefined) child.stdin.end(input);
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

const gitIn = (cwd) => (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, stdio: 'pipe', encoding: 'utf8' });

const crate = (name) => `[package]\nname = "${name}"\nversion = "0.0.0"\nedition = "2021"\npublish = false\n\n[lib]\ndoctest = false\n`;
const wholeFile = (name) => `// A whole test file that only the Mac has.\n#![cfg(target_os = "macos")]\n\n#[test]\nfn ${name}() {\n    assert_eq!(alpha_or_beta(), 2);\n}\n\nfn alpha_or_beta() -> u32 {\n    1 + 1\n}\n`;
/**
 * The fixture workspace: two crates with no dependency, so cargo runs offline. Of its ten tests the Mac has nine and
 * Linux four. Absent on Linux are four whole test files, gated by `#![cfg(target_os = "macos")]`, and two single tests
 * gated by `#[cfg(target_os = "macos")]`, as the issue counts the real workspace's. One test is Linux's alone.
 */
const WORKSPACE = {
  '.gitignore': '/target\n',
  'Cargo.toml': '[workspace]\nmembers = ["alpha", "beta"]\nresolver = "2"\n',
  'Cargo.lock': '# This file is automatically @generated by Cargo.\n# It is not intended for manual editing.\nversion = 4\n\n[[package]]\nname = "alpha"\nversion = "0.0.0"\n\n[[package]]\nname = "beta"\nversion = "0.0.0"\n',
  'alpha/Cargo.toml': crate('alpha'),
  'alpha/src/lib.rs': `pub fn two() -> u32 {
    2
}

#[cfg(test)]
mod tests {
    #[test]
    fn runs_everywhere() {
        assert_eq!(super::two(), 2);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn single_on_the_mac() {
        assert_eq!(super::two(), 2);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn single_on_linux() {
        assert_eq!(super::two(), 2);
    }
}
`,
  'alpha/tests/mac_one.rs': wholeFile('file_one_on_the_mac'),
  'alpha/tests/mac_two.rs': wholeFile('file_two_on_the_mac'),
  'alpha/tests/mixed.rs': `#[test]
fn runs_on_both() {
    assert_eq!(alpha::two(), 2);
}

#[cfg(target_os = "macos")]
#[test]
fn mixed_single_on_the_mac() {
    assert_eq!(alpha::two(), 2);
}
`,
  'beta/Cargo.toml': crate('beta'),
  'beta/src/lib.rs': '#[cfg(test)]\nmod tests {\n    #[test]\n    fn everywhere() {\n        assert_eq!(1 + 1, 2);\n    }\n}\n',
  'beta/tests/mac_three.rs': wholeFile('file_three_on_the_mac'),
  'beta/tests/mac_four.rs': wholeFile('file_four_on_the_mac'),
};

/** What `cargo test -- --list` names on the Mac, per target, each target as lanes.mjs's test IDs name it. */
export const MAC_LIST = {
  '-p alpha --lib': ['tests::runs_everywhere', 'tests::single_on_the_mac'],
  '-p alpha --test mac_one': ['file_one_on_the_mac'],
  '-p alpha --test mac_two': ['file_two_on_the_mac'],
  '-p alpha --test mixed': ['mixed_single_on_the_mac', 'runs_on_both'],
  '-p beta --lib': ['tests::everywhere'],
  '-p beta --test mac_four': ['file_four_on_the_mac'],
  '-p beta --test mac_three': ['file_three_on_the_mac'],
};
/** What Linux has of them, and its own. */
export const LINUX_LIST = {
  '-p alpha --lib': ['tests::runs_everywhere', 'tests::single_on_linux'],
  '-p alpha --test mixed': ['runs_on_both'],
  '-p beta --lib': ['tests::everywhere'],
};
/** A test's ID, as lanes.mjs's cargoResults writes it. */
export const idOf = (target, name) => `cargo ${target} › ${name}`;
export const idsOf = (list) => Object.entries(list).flatMap(([target, names]) => names.map((name) => idOf(target, name))).sort();
/** The Mac's tests that Linux lacks: the four whole files' and the two gated single tests. */
export const ABSENT = idsOf(MAC_LIST).filter((id) => !idsOf(LINUX_LIST).includes(id));

/** The fixture workspace as a clean, committed repository at box.dir/work, with the checkout's toolchain; its tree hash. */
export function workspace(box) {
  const cwd = join(box.dir, 'work');
  for (const [path, content] of Object.entries({ ...WORKSPACE, 'rust-toolchain.toml': readFileSync(join(CHECKOUT, 'rust-toolchain.toml'), 'utf8') })) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
  const git = gitIn(cwd);
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'A workspace with tests only one platform has');
  return { cwd, tree: git('rev-parse', 'HEAD^{tree}').trim() };
}

// lanes.mjs reached by running it. The lane is the one of `checks` that runs the workspace's cargo test, kept as it is
// but for its other runners' commands and its paths, so it runs whatever the change touched (README: The surface).
const DRIVER = `import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [checkout, cwd, only] = process.argv.slice(2);
const { checks, runLanes } = await import(pathToFileURL(join(checkout, 'scripts/lanes.mjs')).href);
const cargoTest = (command) => command[0] === 'cargo' && command[1] === 'test' && command.includes('--workspace');
const lane = (checks ?? []).find(({ commands }) => commands.some(cargoTest));
if (!lane) { console.log('T1121: no lane of checks runs cargo test --workspace'); process.exit(97); }
if (only === 'name') { console.log(JSON.stringify({ name: lane.name, command: lane.commands.find(cargoTest) })); process.exit(0); }
const { paths, ...rest } = lane;
process.exitCode = runLanes([{ ...rest, commands: lane.commands.filter(cargoTest) }], { cwd });
`;

function driver(box) {
  const file = join(box.dir, 'driver.mjs');
  if (!existsSync(file)) writeFileSync(file, DRIVER);
  return file;
}

/** The name of the lane that runs the workspace's cargo test, and that command. */
export async function cargoLane(box) {
  const { status, stdout, stderr } = await run([process.execPath, driver(box), CHECKOUT, CHECKOUT, 'name'], { env: box.env, box });
  assert.equal(status, 0, `scripts/lanes.mjs names no lane that runs cargo test --workspace: ${stdout}${stderr}`);
  return JSON.parse(stdout.trim().split('\n').at(-1));
}

/** The real runLanes on that lane's cargo test, in `cwd`: its exit status and what it printed. */
export const runCargoLane = (box, cwd) => run([process.execPath, driver(box), CHECKOUT, cwd], { cwd, env: box.env, box, merge: true });

/** The sandbox's lanes folder, where every lane's evidence record lives (section 10a). */
export const lanesFolder = (box) => join(box.home, '.deepbuild', 'lanes');
/** A record's file name, as lanes.mjs's writeRecord names it. */
export const recordFile = (box, tree, lane) => join(lanesFolder(box), `${tree}-${lane.replace(/\W+/g, '-')}.json`);
/** Every evidence record in the sandbox, whatever its file is called. */
export function records(box) {
  const folder = lanesFolder(box);
  return (existsSync(folder) ? readdirSync(folder) : []).filter((name) => name.endsWith('.json')).flatMap((name) => {
    try { return [JSON.parse(readFileSync(join(folder, name), 'utf8'))]; } catch { return []; }
  });
}

/** The Mac's record of the fixture workspace, as the Mac's run of that lane writes it: every test passed, and the list. */
export function macRecord(box, tree, lane) {
  const record = { lane, state: 'PASS', host: 'reference-mac', platform: MAC, tree, tests: idsOf(MAC_LIST).map((id) => ({ id, state: 'PASS' })), list: MAC_LIST };
  mkdirSync(lanesFolder(box), { recursive: true, mode: 0o700 });
  writeFileSync(recordFile(box, tree, lane), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

/** A line of a lane run's output that gives the lane a state, as runLanes prints one: `PASS unit (…)`, `INCONCLUSIVE unit (platform): …`. */
export const laneLines = (output, lane) => output.split('\n').filter((line) => RegExp(`^(?:PASS|FAIL|INVALID|BLOCKED|INCONCLUSIVE) ${lane.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: \\(|:|$)`).test(line));
