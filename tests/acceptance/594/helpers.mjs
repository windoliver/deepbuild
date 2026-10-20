// Shared fixture for the #594 acceptance tests. Each test gets a sandbox of its own under the system
// temporary folder (realpathed):
//
//   <sandbox>/home, <sandbox>/tmp   HOME, XDG_CACHE_HOME and TMPDIR for every process the test starts,
//                                   so a build directory perf keeps between runs lands in the sandbox
//   <sandbox>/cargo-home            CARGO_HOME, empty: no user cargo config or wrapper applies
//   <sandbox>/vendor                the fixture's "registry" crates, a vendored directory source
//   <sandbox>/compiles.jsonl        one line per rustc compile of a probed crate, plus the check
//                                   workload's begin and end marks
//   <sandbox>/repo                  the fixture repository: this checkout's scripts/, a Cargo workspace
//                                   with one member, crates/app, and a check workload in scripts/checks.mjs
//
// The vendored crates are real crates built by the real cargo and rustc. probe-macro is a proc macro
// that every probed crate invokes once, so each time rustc compiles that crate (in check mode for
// clippy, or with codegen for a build or a test build) the macro appends a line naming the crate, its
// --emit and the realpath of its --out-dir. A crate cargo finds fresh is not compiled, so it writes
// nothing. That is how the tests see which builds ran, where their output went, and whether a build
// directory was reused.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
// The crates that stand for the dependency tree. app is the workspace's own member.
export const dependencies = ['dep_a', 'dep_b'];

const write = (directory, files) => {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), content);
  }
};

// A crate in a vendored directory source, with the checksum file cargo requires.
function vendorCrate(vendor, name, { manifest = '', lib }) {
  const directory = join(vendor, name);
  const files = {
    'Cargo.toml': `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2021"\n${manifest}`,
    'src/lib.rs': lib,
  };
  write(directory, files);
  const sums = Object.fromEntries(Object.entries(files).map(([path, content]) => [path, createHash('sha256').update(content).digest('hex')]));
  writeFileSync(join(directory, '.cargo-checksum.json'), JSON.stringify({ files: sums, package: createHash('sha256').update(JSON.stringify(sums)).digest('hex') }));
}

const probeMacro = (log) => `use proc_macro::TokenStream;
use std::io::Write;

// Runs inside rustc each time a crate that invokes it is compiled.
#[proc_macro]
pub fn mark(_input: TokenStream) -> TokenStream {
    let args: Vec<String> = std::env::args().collect();
    let out = args.iter().position(|a| a == "--out-dir").and_then(|i| args.get(i + 1)).cloned().unwrap_or_default();
    let real = std::fs::canonicalize(&out).map(|p| p.display().to_string()).unwrap_or(out);
    let emit = args.iter().find(|a| a.starts_with("--emit=")).cloned().unwrap_or_default();
    let name = std::env::var("CARGO_CRATE_NAME").unwrap_or_default();
    let line = format!("{{\\"crate\\":{:?},\\"emit\\":{:?},\\"outDir\\":{:?}}}\\n", name, emit, real);
    let mut log = std::fs::OpenOptions::new().create(true).append(true).open(${JSON.stringify(log)}).unwrap();
    log.write_all(line.as_bytes()).unwrap();
    TokenStream::new()
}
`;

// dep_b is the heavy one: 6000 generic functions, type-checked by clippy (about 2 s of CPU in check
// mode) but never instantiated, so a build of it costs about the same again.
const heavy = () => {
  let source = 'probe_macro::mark!();\n';
  for (let i = 0; i < 6000; i++) source += `pub fn f${i}<T: Into<u64> + Copy>(x: T) -> u64 { let v: Vec<u64> = (0..x.into()).map(|k| k.wrapping_mul(${i})).collect(); v.iter().copied().fold(0u64, |a, b| a.wrapping_add(b)) }\n`;
  return source;
};

// Top-level code that spends `ms` of this process's CPU.
export const spin = (ms) => `{ const start = process.cpuUsage(); for (let used; (used = process.cpuUsage(start)).user + used.system < ${ms * 1000};); }`;

// The fixture's check workload, run the way the lanes run Rust: the lint lane's clippy command, the
// unit lane's test build, and the parity lane's ./target/debug binary. It marks where it begins and
// ends in the compile log, so a compile between the marks is one the measured run paid for.
export const workload = (log, label, spinMs = 0) => `import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const log = ${JSON.stringify(log)};
appendFileSync(log, JSON.stringify({ mark: 'begin', label: ${JSON.stringify(label)}, cwd: process.cwd() }) + '\\n');
let status = 0;
for (const args of [['clippy', '--workspace', '--all-targets', '--locked', '--', '-D', 'warnings'], ['test', '--workspace', '--locked', '--no-run']]) {
  if (spawnSync('cargo', args, { stdio: 'inherit' }).status !== 0) { console.error('error: cargo ' + args.join(' ') + ' failed'); status = 1; }
}
const app = spawnSync('./target/debug/app', { encoding: 'utf8' });
if (app.status !== 0 || app.stdout.trim() !== '1') { console.error('error: ./target/debug/app did not run from the checkout: ' + (app.error?.message ?? app.stderr)); status = 1; }
${spinMs ? spin(spinMs) : ''}
appendFileSync(log, JSON.stringify({ mark: 'end' }) + '\\n');
process.exitCode = status;
`;

const realCargoBin = dirname(execFileSync('sh', ['-c', 'command -v cargo'], { encoding: 'utf8' }).trim());

export function sandbox(t, prefix = 'deep-perf-594-') {
  const box = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => rmSync(box, { recursive: true, force: true }));
  for (const folder of ['home', 'tmp', 'cargo-home', 'vendor', 'repo']) mkdirSync(join(box, folder));
  const log = join(box, 'compiles.jsonl');
  const vendor = join(box, 'vendor');
  vendorCrate(vendor, 'probe-macro', { manifest: '[lib]\nproc-macro = true\n', lib: probeMacro(log) });
  vendorCrate(vendor, 'dep-a', { manifest: '[dependencies]\nprobe-macro = "0.1.0"\n', lib: 'probe_macro::mark!();\npub fn a() -> u32 { 1 }\n' });
  vendorCrate(vendor, 'dep-b', { manifest: '[dependencies]\nprobe-macro = "0.1.0"\n', lib: heavy() });
  // Every process the test starts sees only the sandbox's home, temporary folder and cargo home, and
  // no target directory, build directory or compiler wrapper from the caller's environment.
  const env = { ...process.env };
  for (const name of ['CARGO_TARGET_DIR', 'CARGO_BUILD_TARGET_DIR', 'CARGO_BUILD_BUILD_DIR', 'RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER', 'CARGO_BUILD_RUSTC_WRAPPER', 'CARGO_BUILD_RUSTC_WORKSPACE_WRAPPER', 'CARGO_INCREMENTAL', 'RUSTFLAGS', 'CARGO_ENCODED_RUSTFLAGS']) delete env[name];
  Object.assign(env, {
    HOME: join(box, 'home'),
    XDG_CACHE_HOME: join(box, 'home', '.cache'),
    TMPDIR: join(box, 'tmp'),
    CARGO_HOME: join(box, 'cargo-home'),
    RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(homedir(), '.rustup'),
    PATH: `${realCargoBin}:${process.env.PATH}`,
  });
  return { box, log, vendor, env };
}

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' });

// The fixture repository. Its merge base (origin/main) is a workspace whose member depends on dep-a,
// with a check workload labelled "base"; the working tree relabels the workload "checkout". The
// change itself is left to each test: change(...) edits the working tree and commits.
export function fixture(t) {
  const box = sandbox(t);
  const repo = join(box.box, 'repo');
  cpSync(join(root, 'scripts'), join(repo, 'scripts'), { recursive: true });
  const appManifest = (extra = '') => `[package]\nname = "app"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nprobe-macro = "0.1.0"\ndep-a = "0.1.0"\n${extra}`;
  write(repo, {
    'scripts/checks.mjs': workload(box.log, 'base'),
    'Cargo.toml': '[workspace]\nmembers = ["crates/app"]\nresolver = "2"\n',
    'crates/app/Cargo.toml': appManifest(),
    'crates/app/src/main.rs': 'probe_macro::mark!();\n\nfn main() {\n    println!("{}", dep_a::a());\n}\n',
    '.cargo/config.toml': `[source.crates-io]\nreplace-with = "vendored"\n\n[source.vendored]\ndirectory = ${JSON.stringify(box.vendor)}\n`,
    // As in this repo, the build script builds the workspace.
    'package.json': JSON.stringify({ name: 'fixture', private: true, scripts: { build: 'cargo build --workspace --locked' } }),
    'package-lock.json': JSON.stringify({ name: 'fixture', lockfileVersion: 3, requires: true, packages: { '': { name: 'fixture' } } }),
    'benchmarks/budgets.json': JSON.stringify({ preflight: { margin: 0.5, limits: { elapsedMs: 300_000 }, initialReason: 'Fixture base.' }, tasks: [] }),
    '.gitignore': 'target/\nnode_modules/\n',
  });
  const lock = () => execFileSync('cargo', ['generate-lockfile', '--offline'], { cwd: repo, env: box.env, stdio: 'pipe' });
  lock();
  git(repo, 'init', '-q');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  write(repo, { 'scripts/checks.mjs': workload(box.log, 'checkout') });
  const change = ({ addDependency = false, addTest = false, spinMs = 0 } = {}) => {
    if (addDependency) {
      write(repo, { 'crates/app/Cargo.toml': appManifest('dep-b = "0.1.0"\n') });
      lock();
    }
    if (addTest) write(repo, { 'tests/added.test.mjs': '' });
    write(repo, { 'scripts/checks.mjs': workload(box.log, 'checkout', spinMs) });
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'change');
  };
  const preflight = () => {
    writeFileSync(box.log, '');
    const result = spawnSync(process.execPath, ['scripts/preflight.mjs'], { cwd: repo, env: box.env, encoding: 'utf8', timeout: 900_000, maxBuffer: 256 * 1024 * 1024 });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? `\n${result.error.message}` : ''}`;
    return { status: result.status, output, segments: segments(readFileSync(box.log, 'utf8'), repo) };
  };
  return { ...box, repo, change, preflight };
}

// The compile log of one preflight, split by the check workload's marks: each segment holds the
// compiles before its begin mark (that side's untimed warm-up) and those between its marks (its
// measured run). side is "working tree" for the checkout itself, "merge base" for the copy labelled
// base, and "without own tests" for the other copy labelled checkout.
export function segments(text, repo) {
  const lines = text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const result = [];
  let pending = [], current = null;
  for (const line of lines) {
    if (line.mark === 'begin') {
      const side = line.label === 'base' ? 'merge base' : line.cwd === repo ? 'working tree' : 'without own tests';
      current = { side, cwd: line.cwd, warm: pending, measured: [] };
      pending = [];
    } else if (line.mark === 'end') {
      result.push(current);
      current = null;
    } else (current ? current.measured : pending).push(line);
  }
  if (current) result.push(current);
  if (pending.length) result.push({ side: 'after the last measured run', warm: pending, measured: [] });
  return result;
}

export const isDependency = ({ crate }) => dependencies.includes(crate);
export const describe = (compiles) => compiles.map(({ crate, emit, outDir }) => `${crate} ${emit} -> ${outDir}`).join('; ') || 'none';
export const side = (list, name) => {
  const found = list.filter((segment) => segment.side === name);
  assert.equal(found.length, 1, `expected one ${name} run in the compile log, found ${found.length}: ${JSON.stringify(list.map(({ side: s }) => s))}`);
  return found[0];
};
// The build directory a compile's --out-dir lies in: <dir>/debug/deps -> <dir>.
export const buildDir = (outDir) => outDir.replace(/\/debug\/deps$/, '').replace(/\/debug\/build\/[^/]+\/out$/, '');
export const inside = (path, directory) => path === directory || path.startsWith(`${directory}/`);

// The perf verdict line for the preflight workload.
export function verdict(output) {
  const line = output.split('\n').find((text) => text.startsWith('{') && text.includes('"task":"preflight"'));
  return line ? JSON.parse(line) : null;
}
export const failedCpuMs = (output) => {
  const match = output.match(/^FAIL perf: .*?\bcpuMs\D*?(\d+)/m);
  return match ? Number(match[1]) : null;
};
export const tail = (output, lines = 80) => output.split('\n').slice(-lines).join('\n');
