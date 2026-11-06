// Helpers for #1119's acceptance tests: a sandbox (HOME, so the throttle table is <HOME>/.deepbuild/throttle/, and
// XDG_CACHE_HOME, so perf's kept copies are <cache>/deepbuild-perf/, never the real ones), "a machine's repository"
// with two worktrees of one commit, the workload its scripts/checks.mjs runs in each kept copy, and readers for what
// that workload saw and what perf printed. Nothing here imports the code under test: perf.mjs is reached only by
// running it (README: The surface).
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { cpus, homedir, loadavg, tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const REAL_HOME = homedir();
export const LEDGER = 'crates/deep-show/kit-ledger.json';
// The observation perf compares: a passing current run that is cheaper than any base, so the verdict is PASS.
const OBSERVED = JSON.stringify({ status: 0, elapsedMs: 1, cpuMs: 1, peakBytes: 1 });
// How long a perf run may wait for its timed grant, and run in all, before the test gives up on it.
const GRANT_MS = 10 * 60_000;
const RUN_MS = 15 * 60_000;

const GIT = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'init.defaultBranch=main'];
export const git = (cwd, ...args) => execFileSync('git', [...GIT, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_DATE: '2001-09-09T01:46:40Z', GIT_COMMITTER_DATE: '2001-09-09T01:46:40Z' } });

/** A sandbox removed after the test, with its own HOME and cache; every perf it started is stopped by its group's PID. */
export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-1119-')));
  const box = { dir, home: join(dir, 'home'), cache: join(dir, 'cache'), control: join(dir, 'control.json'), runs: join(dir, 'runs.jsonl'), children: [] };
  for (const folder of [box.home, box.cache]) mkdirSync(folder);
  const cargoHome = process.env.CARGO_HOME ?? join(REAL_HOME, '.cargo');
  box.env = {
    ...process.env,
    HOME: box.home,
    XDG_CACHE_HOME: box.cache,
    // cargo and rustup stay the machine's, so no toolchain is downloaded into the sandbox HOME.
    RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(REAL_HOME, '.rustup'),
    CARGO_HOME: cargoHome,
    PATH: `${join(cargoHome, 'bin')}${delimiter}${dirname(process.execPath)}${delimiter}${process.env.PATH}`,
  };
  for (const name of ['DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'NODE_TEST_CONTEXT', 'CARGO_TARGET_DIR', 'CARGO_BUILD_TARGET_DIR', 'RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER', 'CARGO_BUILD_RUSTC_WRAPPER', 'CARGO_BUILD_RUSTC_WORKSPACE_WRAPPER', 'DEEP_OPEN_ISSUES']) delete box.env[name];
  t.after(() => {
    for (const child of box.children) if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

// The workload: the fixture's scripts/checks.mjs, which perf runs in each kept copy. It reads what to do from the
// sandbox's control file, builds the workspace in release (warm() builds only the dev profile and clippy's check
// artifacts, so a release build is compiled by checks.mjs alone), and appends what it saw to the sandbox's runs file,
// outside the copy. It may rewrite kit-ledger.json (with the same or other bytes, as the canvas kit lane does), plant
// an untracked file, and start a nested perf from another worktree.
const workload = (box) => `import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const CONTROL = ${JSON.stringify(box.control)};
const RUNS = ${JSON.stringify(box.runs)};
const LEDGER = ${JSON.stringify(LEDGER)};
const control = JSON.parse(readFileSync(CONTROL, 'utf8'));
const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const SKIP = new Set(['.git', 'target', 'node_modules']);
function files(folder = '', found = {}) {
  for (const entry of readdirSync(join(process.cwd(), folder), { withFileTypes: true })) {
    const path = folder ? folder + '/' + entry.name : entry.name;
    if (!folder && SKIP.has(entry.name)) continue;
    if (entry.isSymbolicLink()) found[path] = 'link:' + readlinkSync(path);
    else if (entry.isDirectory()) files(path, found);
    else found[path] = hash(path);
  }
  return found;
}
const record = { label: control.label, pid: process.pid, cwd: realpathSync(process.cwd()), target: process.env.CARGO_TARGET_DIR ?? null, startedAt: Date.now(),
  ledger: { sha256: hash(LEDGER), mtimeMs: statSync(LEDGER).mtimeMs }, files: files(), builds: [] };
function build() {
  const run = spawnSync('cargo', ['build', '--release', '--workspace', '--locked', '--offline', '--message-format=json'], { encoding: 'utf8', env, maxBuffer: 1 << 28 });
  const artifacts = (run.stdout ?? '').split('\\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line))
    .filter((message) => message.reason === 'compiler-artifact').map((message) => ({ name: message.target.name, kind: message.target.kind, fresh: message.fresh }));
  const compiling = (run.stderr ?? '').split('\\n').map((line) => line.match(/^\\s*Compiling (\\S+) v/)?.[1]).filter(Boolean);
  record.builds.push({ status: run.status, artifacts, compiling, stderr: (run.stderr ?? '').slice(-4000) + (run.error ? String(run.error) : '') });
}
build();
if (control.ledger === 'same') {
  writeFileSync(LEDGER, readFileSync(LEDGER));
  build();
} else if (control.ledger === 'different') {
  writeFileSync(LEDGER, '{"kit":"rewritten by the canvas kit lane in run ' + control.label + '"}\\n');
  writeFileSync('planted.txt', 'left by run ' + control.label + '\\n');
  build();
}
if (control.nest) {
  // The nested perf's own checks would read this file: they get a label of their own and nest no further.
  writeFileSync(CONTROL, JSON.stringify({ label: control.nest.label }));
  const nestedEnv = { ...env };
  delete nestedEnv.DEEP_PERF_LOCK;
  const nested = spawnSync(process.execPath, ['scripts/perf.mjs', ${JSON.stringify(OBSERVED)}], { cwd: control.nest.cwd, env: nestedEnv, encoding: 'utf8', timeout: 600000 });
  record.nested = { status: nested.status, signal: nested.signal, stdout: nested.stdout ?? '', stderr: (nested.stderr ?? '').slice(-4000) };
  writeFileSync(CONTROL, JSON.stringify(control));
}
appendFileSync(RUNS, JSON.stringify(record) + '\\n');
process.exit(record.builds.every((done) => done.status === 0) ? 0 : 1);
`;

const write = (cwd, files) => {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
};

// The fixture's tree: a three-crate cargo workspace (deep-show reads kit-ledger.json through include_str!; show-panel
// depends on it; plain depends on nothing), budgets with a preflight so perf measures a base side, an npm package
// with no dependencies, the workload and this checkout's scripts/.
const fixture = (box) => ({
  '.gitignore': 'target/\nnode_modules/\n.claude/\n',
  'Cargo.toml': '[workspace]\nmembers = ["crates/deep-show", "crates/show-panel", "crates/plain"]\nresolver = "2"\n',
  'Cargo.lock': '# This file is automatically @generated by Cargo.\n# It is not intended for manual editing.\nversion = 4\n\n[[package]]\nname = "deep-show"\nversion = "0.1.0"\n\n[[package]]\nname = "plain"\nversion = "0.1.0"\n\n[[package]]\nname = "show-panel"\nversion = "0.1.0"\ndependencies = [\n "deep-show",\n]\n',
  'crates/deep-show/Cargo.toml': '[package]\nname = "deep-show"\nversion = "0.1.0"\nedition = "2021"\n',
  'crates/deep-show/src/lib.rs': 'pub const LEDGER: &str = include_str!("../kit-ledger.json");\n',
  [LEDGER]: '{"kit":"tree"}\n',
  'crates/show-panel/Cargo.toml': '[package]\nname = "show-panel"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\ndeep-show = { path = "../deep-show" }\n',
  'crates/show-panel/src/lib.rs': 'pub fn panel() -> usize {\n    deep_show::LEDGER.len()\n}\n',
  'crates/plain/Cargo.toml': '[package]\nname = "plain"\nversion = "0.1.0"\nedition = "2021"\n',
  'crates/plain/src/lib.rs': 'pub fn plain() -> u32 {\n    7\n}\n',
  'benchmarks/budgets.json': JSON.stringify({ preflight: { margin: 0.5, limits: { elapsedMs: 600_000 }, initialReason: 'Fixture base.' }, tasks: [] }),
  'package.json': '{\n  "name": "perf-fixture",\n  "version": "0.0.0",\n  "private": true\n}\n',
  'package-lock.json': '{\n  "name": "perf-fixture",\n  "version": "0.0.0",\n  "lockfileVersion": 3,\n  "requires": true,\n  "packages": {\n    "": {\n      "name": "perf-fixture",\n      "version": "0.0.0"\n    }\n  }\n}\n',
  'scripts/checks.mjs': workload(box),
});

/**
 * The machine's repository, <HOME>/deepbuild, holding this checkout's scripts/ (the workload replaces checks.mjs) and
 * the fixture in one commit, dated 2001, which origin/main names; and two worktrees of that commit,
 * <HOME>/deepbuild/.claude/worktrees/{a,b}, made by `git worktree add`. With `ownTest`, each worktree also holds the
 * same untracked test file, so perf keeps a without-tests side too.
 */
export function machineRepo(box, { ownTest = false } = {}) {
  const main = join(box.home, 'deepbuild');
  mkdirSync(main);
  cpSync(join(CHECKOUT, 'scripts'), join(main, 'scripts'), { recursive: true });
  write(main, fixture(box));
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'remote', 'add', 'origin', 'https://github.com/windoliver/deepbuild.git');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'fixture');
  git(main, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  // The scripts' own packages (proof-change.mjs imports typescript), where node finds them from each worktree.
  symlinkSync(join(CHECKOUT, 'node_modules'), join(main, 'node_modules'));
  const worktrees = {};
  for (const name of ['a', 'b']) {
    worktrees[name] = join(main, '.claude', 'worktrees', name);
    git(main, 'worktree', 'add', '-q', '-b', `work-${name}`, worktrees[name]);
    if (ownTest) write(worktrees[name], { 'tests/added.test.mjs': "import test from 'node:test';\ntest('added', () => {});\n" });
  }
  return { main, commit: git(main, 'rev-parse', 'HEAD').trim(), ...worktrees };
}

/** What the commit's tree holds, each file to its bytes' sha256, read from a worktree with no edits. */
export function treeFiles(worktree) {
  const found = {};
  for (const path of git(worktree, 'ls-files', '-z').split('\0').filter(Boolean)) {
    if (lstatSync(join(worktree, path)).isSymbolicLink()) continue;
    found[path] = createHash('sha256').update(readFileSync(join(worktree, path))).digest('hex');
  }
  return found;
}

/** Sets what the next run's workload does: { label, ledger: 'same' | 'different' | null, nest: { cwd, label } | null }. */
export const control = (box, value) => writeFileSync(box.control, JSON.stringify(value));

/**
 * Runs `node scripts/perf.mjs '<observation>'` with its cwd at `worktree`, in its own process group. A run that gets
 * no timed grant within GRANT_MS (it prints `RUN perf` once granted) is stopped and fails, as perf's own
 * `INCONCLUSIVE no grant` does: the test could not run. Returns { status, stdout, stderr, startedAt, wallSeconds }.
 */
export async function perf(box, worktree) {
  const startedAt = Date.now();
  const child = spawn(process.execPath, ['scripts/perf.mjs', OBSERVED], { cwd: worktree, env: box.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const done = new Promise((resolve) => child.on('close', (status, signal) => resolve({ status, signal })));
  let why = null;
  const watch = setInterval(() => {
    const waited = Date.now() - startedAt;
    if (!/^RUN perf/m.test(stdout) && waited > GRANT_MS) why = `INCONCLUSIVE no grant: perf got no timed grant within ${GRANT_MS / 60_000} min (1-minute load ${loadavg()[0].toFixed(1)}, ${cpus().length} cores), so this test could not run`;
    else if (waited > RUN_MS) why = `perf did not end within ${RUN_MS / 60_000} min`;
    if (why) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  }, 1000);
  const { status, signal } = await done;
  clearInterval(watch);
  const result = { status, signal, stdout, stderr, startedAt, endedAt: Date.now() };
  if (why) assert.fail(`${why}\n${show(result)}`);
  if (/^INCONCLUSIVE no grant/m.test(stdout)) assert.fail(`perf printed INCONCLUSIVE no grant, so this test could not run\n${show(result)}`);
  result.wallSeconds = Number(stdout.match(/^PASS perf \(([\d.]+) s\)/m)?.[1] ?? NaN);
  return result;
}

export const show = (result) => [`exit ${result.status}${result.signal ? ` (${result.signal})` : ''}`, `stdout:\n${result.stdout}`, `stderr:\n${result.stderr.slice(-4000)}`].join('\n');

/** A perf run that passed: exit 0 and its `PASS perf (<s> s)` line. */
export function passed(result, which) {
  assert.equal(result.status, 0, `${which} perf run exited ${result.status}\n${show(result)}`);
  assert.match(result.stdout, /^PASS perf \([\d.]+ s\)$/m, `${which} perf run printed no PASS perf line\n${show(result)}`);
}

/** Every record the workload appended, in order. */
export function runs(box) {
  if (!existsSync(box.runs)) return [];
  return readFileSync(box.runs, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

/** Where a record's kept copy lies under <cache>/deepbuild-perf: [machine, side, ...rest], or null outside it. */
export function keptPath(box, path) {
  const rel = relative(join(realpathSync(box.cache), 'deepbuild-perf'), path ?? '');
  if (!path || rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel.split(sep);
}

/** The one record of a run's checks in the given side's kept copy (`base` or `without-tests`). */
export function sideRecord(box, label, side, result) {
  const found = runs(box).filter((record) => record.label === label && keptPath(box, record.cwd)?.[1] === side);
  assert.equal(found.length, 1, `run ${label}'s checks.mjs ran ${found.length} times in a kept copy <cache>/deepbuild-perf/<machine>/${side}/…, not once; the workload saw: ${JSON.stringify(runs(box).map(({ label, cwd, target }) => ({ label, cwd, target })))}\n${result ? show(result) : ''}`);
  return found[0];
}

/** A build's crates, by package name (cargo reports a lib's target name with underscores). */
export const crate = (artifact) => artifact.name.replace(/_/g, '-');
