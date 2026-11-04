// Helpers for #1117's acceptance tests: a sandboxed HOME (so bays are <HOME>/deepbuild-bays/<k>/ and the throttle
// table is <HOME>/.deepbuild/throttle/, never the real ones), "the machine's repository" as a fixture git repository
// with a worktree, a probe command that runs inside a bay, and readers for bays.mjs's record lines and the throttle
// log. Nothing here imports the code under test: bays.mjs is reached only by running it (README: The surface).
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const MAC = process.platform === 'darwin';
// Section 6's table: one bay pair on the Mac, three on the Spark (and anywhere else).
export const PAIRS = MAC ? 1 : 3;
const REAL_HOME = homedir();

export const GIT = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'init.defaultBranch=main'];
export const git = (cwd, ...args) => execFileSync('git', [...GIT, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// The probe: the command a test hands bays.mjs. It runs with its cwd in the bay, works through spec.steps and writes
// what it saw to spec.out after every step, so an aborted run leaves what it got to. It prints nothing.
const PROBE = `import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const spec = JSON.parse(process.argv[2]);
const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;
const out = { name: spec.name, pid: process.pid, cwd: realpathSync(process.cwd()), cargoTargetDir: process.env.CARGO_TARGET_DIR ?? null, steps: [] };
const save = () => writeFileSync(spec.out, JSON.stringify(out));
save();
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
const run = (argv, options = {}) => {
  const result = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', maxBuffer: 1 << 28, env, ...options });
  return { status: result.status, signal: result.signal, stdout: result.stdout ?? '', stderr: (result.stderr ?? '') + (result.error ? String(result.error) : '') };
};
const compiling = (text) => text.split('\\n').filter((line) => /^\\s*Compiling\\s/.test(line));
const touchRef = (from, to) => { const r = spawnSync('touch', ['-r', from, to]); if (r.status !== 0) throw Error('touch -r ' + from + ' ' + to + ' failed'); };
for (const step of spec.steps) {
  const done = { do: step.do };
  if (step.do === 'snapshot') {
    done.files = files();
    done.exists = Object.fromEntries((step.paths ?? []).map((path) => [path, existsSync(path)]));
    done.mtimeMs = Object.fromEntries((step.mtimes ?? []).map((path) => [path, existsSync(path) ? statSync(path).mtimeMs : null]));
    done.at = Date.now();
  } else if (step.do === 'build') {
    const build = run(['cargo', 'build', '--workspace', '--all-targets', '--offline', '--locked', '--message-format=json']);
    done.build = { status: build.status, compiling: compiling(build.stderr), stderr: build.stderr.slice(-4000) };
    done.artifacts = build.stdout.split('\\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line)).filter((m) => m.reason === 'compiler-artifact').map((m) => ({ name: m.target.name, kind: m.target.kind, fresh: m.fresh }));
    const test = run(['cargo', 'test', '--workspace', '--offline', '--locked']);
    done.test = { status: test.status, compiling: compiling(test.stderr), output: (test.stdout + test.stderr).slice(-4000) };
    const greet = run([join(process.cwd(), 'target/debug/greet')]);
    done.greet = greet.status === 0 ? greet.stdout.trim() : null;
    done.greetError = greet.status === 0 ? null : greet.stderr.slice(-1000);
  } else if (step.do === 'stamp') {
    // Keeps each file's atime and mtime on a reference file, for restamp to put back.
    for (const path of step.paths) touchRef(path, join(spec.refs, createHash('sha256').update(path).digest('hex')));
  } else if (step.do === 'restamp') {
    for (const path of step.paths) touchRef(join(spec.refs, createHash('sha256').update(path).digest('hex')), path);
  } else if (step.do === 'write') {
    // Writes in place (the same inode); null deletes.
    for (const [path, content] of Object.entries(step.files)) {
      if (content === null) rmSync(path, { force: true });
      else { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }
    }
  } else if (step.do === 'run') {
    Object.assign(done, run(step.argv, { cwd: step.cwd, timeout: step.timeout ?? 600000 }));
    done.stdout = done.stdout.slice(-20000);
    done.stderr = done.stderr.slice(-20000);
  } else if (step.do === 'hold') {
    out.ready = true;
    out.steps.push(done);
    save();
    for (;;) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
  }
  out.steps.push(done);
  save();
}
out.finished = true;
save();
`;

/** A sandbox removed after the test, with its own HOME; every process it started is stopped, by its group's PID. */
export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-1117-')));
  const home = join(dir, 'home');
  for (const folder of [home, join(dir, 'probes'), join(dir, 'refs')]) mkdirSync(folder);
  writeFileSync(join(dir, 'probe.mjs'), PROBE);
  const env = {
    ...process.env,
    HOME: home,
    // cargo and rustup stay the machine's, so no toolchain is downloaded into the sandbox HOME.
    RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(REAL_HOME, '.rustup'),
    CARGO_HOME: process.env.CARGO_HOME ?? join(REAL_HOME, '.cargo'),
    PATH: `${join(process.env.CARGO_HOME ?? join(REAL_HOME, '.cargo'), 'bin')}${delimiter}${dirname(process.execPath)}${delimiter}${process.env.PATH}`,
  };
  for (const name of ['DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'CARGO_TARGET_DIR', 'NODE_TEST_CONTEXT', 'CARGO_BUILD_TARGET_DIR', 'RUSTC_WRAPPER', 'CARGO_BUILD_RUSTC_WRAPPER']) delete env[name];
  const box = { dir, home, env, bays: join(home, 'deepbuild-bays'), probe: join(dir, 'probe.mjs'), children: [], probes: 0 };
  t.after(() => {
    for (const child of box.children) if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    for (const pid of box.pids ?? []) try { process.kill(pid, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

const write = (cwd, files) => {
  for (const [path, content] of Object.entries(files)) {
    if (content === null) rmSync(join(cwd, path), { force: true });
    else {
      mkdirSync(dirname(join(cwd, path)), { recursive: true });
      writeFileSync(join(cwd, path), content);
    }
  }
};
export { write };

// The fixture's sources: a two-crate cargo workspace whose binary prints a word, a ledger and a greeting, and an
// integration test that runs the binary through CARGO_BIN_EXE_greet and checks CARGO_MANIFEST_DIR is where it runs.
export const lib = (word) => `pub const WORD: &str = "${word}";\npub const LEDGER: &str = include_str!("../kit-ledger.json");\n`;
const FIXTURE = {
  '.gitignore': 'target/\nnode_modules/\ndist/\n*.log\n.claude/\n',
  'Cargo.toml': '[workspace]\nmembers = ["crates/word", "crates/greet"]\nresolver = "2"\n',
  'Cargo.lock': '# This file is automatically @generated by Cargo.\n# It is not intended for manual editing.\nversion = 4\n\n[[package]]\nname = "greet"\nversion = "0.1.0"\ndependencies = [\n "word",\n]\n\n[[package]]\nname = "word"\nversion = "0.1.0"\n',
  'package.json': '{\n  "name": "bay-fixture",\n  "version": "0.0.0",\n  "private": true\n}\n',
  'package-lock.json': '{\n  "name": "bay-fixture",\n  "version": "0.0.0",\n  "lockfileVersion": 3,\n  "requires": true,\n  "packages": {\n    "": {\n      "name": "bay-fixture",\n      "version": "0.0.0"\n    }\n  }\n}\n',
  'packages/p/index.mjs': 'export const p = 1;\n',
  'crates/word/Cargo.toml': '[package]\nname = "word"\nversion = "0.1.0"\nedition = "2021"\n',
  'crates/word/src/lib.rs': lib('tree-word'),
  'crates/word/kit-ledger.json': '{"kit":"tree"}\n',
  'crates/greet/Cargo.toml': '[package]\nname = "greet"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nword = { path = "../word" }\n',
  'crates/greet/src/main.rs': 'fn main() {\n    println!("{}|{}|{}", word::WORD, word::LEDGER.trim(), include_str!("../greeting.txt").trim());\n}\n',
  'crates/greet/tests/bin.rs': `use std::path::Path;

#[test]
fn the_binary_and_the_manifest_are_this_trees() {
    let here = std::env::current_dir().unwrap().canonicalize().unwrap();
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR")).canonicalize().unwrap();
    assert_eq!(manifest, here, "CARGO_MANIFEST_DIR was baked at another path");
    let bin = Path::new(env!("CARGO_BIN_EXE_greet")).canonicalize().unwrap();
    let target = here.join("../../target").canonicalize().unwrap();
    assert!(bin.starts_with(&target), "CARGO_BIN_EXE_greet {} lies outside {}", bin.display(), target.display());
    let out = std::process::Command::new(&bin).output().unwrap();
    let expected = format!("{}|{}|{}", word::WORD, word::LEDGER.trim(), include_str!("../greeting.txt").trim());
    assert_eq!(String::from_utf8(out.stdout).unwrap().trim(), expected);
}
`,
};

/**
 * The machine's repository and a worktree of it (README: The machine's repository). The repository is
 * <HOME>/deepbuild, holding this checkout's scripts/ (so bays.mjs runs from its own repository) and the fixture,
 * with origin at this project's URL; the worktree is <HOME>/deepbuild/.claude/worktrees/w, made by `git worktree
 * add`, with an uncommitted edit, an untracked file and an ignored file.
 */
export function machineRepo(box) {
  const main = join(box.home, 'deepbuild');
  mkdirSync(main);
  cpSync(join(CHECKOUT, 'scripts'), join(main, 'scripts'), { recursive: true });
  write(main, FIXTURE);
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'remote', 'add', 'origin', 'https://github.com/windoliver/deepbuild.git');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'fixture');
  git(main, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  // The scripts' own packages (proof-change.mjs imports typescript), where node finds them from the worktree.
  symlinkSync(join(CHECKOUT, 'node_modules'), join(main, 'node_modules'));
  const worktree = join(main, '.claude', 'worktrees', 'w');
  git(main, 'worktree', 'add', '-q', '-b', 'work', worktree);
  write(worktree, {
    'crates/word/src/lib.rs': lib('work-word'), // uncommitted
    'crates/greet/greeting.txt': 'hello from an untracked file\n', // untracked, not ignored
    'crates/word/notes.log': 'ignored, never in a bay\n', // ignored
  });
  return { main, worktree, bays: join(worktree, 'scripts', 'bays.mjs') };
}

/** A repository as tests/proof.test.mjs and the #569 scenes make one: `git init` in a temporary folder, outside the machine's repository. */
export function sceneRepo(box) {
  const cwd = join(box.dir, 'scene');
  mkdirSync(cwd);
  write(cwd, { 'a.txt': 'scene\n' });
  git(cwd, 'init', '-q', '-b', 'main');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', 'base');
  git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(cwd, 'checkout', '-q', '-b', 'change');
  return cwd;
}

/** What `listFiles` lists for a worktree (tracked and untracked non-ignored files that exist), each to its bytes' sha256. */
export function treeFiles(worktree) {
  const paths = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: worktree, encoding: 'utf8' }).split('\0').filter(Boolean))];
  const found = {};
  for (const path of paths) {
    let stat;
    try { stat = lstatSync(join(worktree, path)); } catch { continue; }
    if (stat.isDirectory()) continue;
    found[path] = createHash('sha256').update(readFileSync(join(worktree, path))).digest('hex');
  }
  return found;
}

/** What the fixture's binary prints for the tree the worktree holds. */
export function expectedGreeting(worktree) {
  const word = readFileSync(join(worktree, 'crates/word/src/lib.rs'), 'utf8').match(/WORD: &str = "([^"]*)"/)[1];
  return `${word}|${readFileSync(join(worktree, 'crates/word/kit-ledger.json'), 'utf8').trim()}|${readFileSync(join(worktree, 'crates/greet/greeting.txt'), 'utf8').trim()}`;
}

/**
 * Starts `node <script> change -- node probe.mjs <spec>` with its cwd at `cwd`, in its own process group.
 * Returns the child, with `out` (the probe's result file) and `done` (status, stdout, stderr, record lines).
 */
export function bays(box, { script, cwd, steps = [], env = {}, role = 'change', name = `probe-${++box.probes}` }) {
  const out = join(box.dir, 'probes', `${name}.json`);
  const spec = { name, out, refs: join(box.dir, 'refs'), steps };
  const argv = [process.execPath, script, role, '--', process.execPath, box.probe, JSON.stringify(spec)];
  const child = spawn(argv[0], argv.slice(1), { cwd, env: { ...box.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.out = out;
  child.started = Date.now();
  child.stdoutNow = () => stdout;
  child.done = new Promise((resolve) => child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr, records: records(stdout), ended: Date.now() })));
  return child;
}

/** Waits for a run to end, at most `ms`; an overdue run is stopped by its group's PID and fails at the assertion. */
export async function finished(run, ms = 300_000) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  const result = await Promise.race([run.done, late]);
  clearTimeout(timer);
  if (!result) {
    try { process.kill(-run.pid, 'SIGKILL'); } catch {}
    const after = await run.done;
    assert.fail(`bays.mjs did not end within ${ms / 1000} s\n${show(after)}`);
  }
  return result;
}

/** The record lines bays.mjs prints: `BAY claim <json>` and `BAY release <json>`. */
export function records(stdout) {
  const found = [];
  for (const line of String(stdout).split('\n')) {
    const match = line.match(/^BAY (claim|release) (\{.*\})\s*$/);
    if (!match) continue;
    let fields;
    try { fields = JSON.parse(match[2]); } catch { continue; }
    found.push({ event: match[1], ...fields });
  }
  return found;
}
export const claimOf = (result) => result.records.find((record) => record.event === 'claim');
export const releaseOf = (result) => result.records.find((record) => record.event === 'release');

/** The probe's result file, or null when the command never ran. */
export function probe(run) {
  if (!existsSync(run.out)) return null;
  try { return JSON.parse(readFileSync(run.out, 'utf8')); } catch { return null; }
}
export const step = (result, kind, index = 0) => result?.steps.filter((s) => s.do === kind)[index];

export const show = (result, extra) => [
  `exit ${result.status}${result.signal ? ` (${result.signal})` : ''}`,
  `stdout:\n${result.stdout}`,
  `stderr:\n${result.stderr}`,
  ...(extra ? [`probe:\n${JSON.stringify(extra, null, 1).slice(0, 12000)}`] : []),
].join('\n');

/**
 * A run that completed in a bay: exit 0, a claim record with a numeric index whose bay lies in
 * <HOME>/deepbuild-bays/<index>/, and the probe ran there to its end. Returns { claim, release, probe }.
 */
export function inBay(box, result, run) {
  const seen = probe(run);
  const claim = claimOf(result);
  assert.ok(claim, `bays.mjs printed no "BAY claim {…}" line\n${show(result, seen)}`);
  assert.ok(Number.isInteger(claim.index) && claim.index >= 1 && claim.index <= PAIRS, `the claim's index ${claim.index} is not a grant index 1..${PAIRS}\n${show(result)}`);
  assert.equal(typeof claim.bay, 'string', `the claim names no bay\n${show(result)}`);
  const pair = join(realpathSync(box.bays), String(claim.index));
  const bay = existsSync(claim.bay) ? realpathSync(claim.bay) : claim.bay;
  const rel = relative(pair, bay);
  assert.ok(rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)), `the bay ${bay} lies outside ${pair}\n${show(result)}`);
  assert.equal(result.status, 0, `bays.mjs exited ${result.status}, not the command's 0\n${show(result, seen)}`);
  assert.ok(seen?.finished, `the command never finished in the bay\n${show(result, seen)}`);
  assert.equal(seen.cwd, bay, `the command ran in ${seen?.cwd}, not in the bay ${bay}`);
  return { claim, release: releaseOf(result), probe: seen, bay };
}

/** The throttle log's lines for the bay-pair class: JSON objects in <HOME>/.deepbuild/throttle/log. */
export function bayPairLog(box) {
  const file = join(box.home, '.deepbuild', 'throttle', 'log');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return {}; } }).filter((line) => line.class === 'bay-pair');
}

/** The bytes of regular files under `folder`, each inode once, not following links. */
export function bytesUnder(folder) {
  const seen = new Set();
  let total = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) {
        const stat = lstatSync(path);
        if (seen.has(stat.ino)) continue;
        seen.add(stat.ino);
        total += stat.size;
      }
    }
  };
  if (existsSync(folder)) walk(folder);
  return total;
}

/** Polls until `predicate` holds or `ms` pass; returns whether it held. */
export async function until(predicate, ms) {
  const end = Date.now() + ms;
  for (;;) {
    if (predicate()) return true;
    if (Date.now() > end) return false;
    await new Promise((done) => setTimeout(done, 50));
  }
}

/** A same-length mutant of a lib.rs: its word's letters each replaced by M. */
export const mutant = (text) => text.replace(/WORD: &str = "([^"]*)"/, (_, word) => `WORD: &str = "${'M'.repeat(word.length)}"`);

/** Runs `touch -r from to`: `to` gets `from`'s atime and mtime, to the nanosecond where the disk keeps them. */
export const stampLike = (from, to) => execFileSync('touch', ['-r', from, to]);

/** Waits until the run's command reaches its `hold` step; fails at the assertion when the run ends or `ms` pass first. */
export async function holding(run, ms = 120_000) {
  let ended = false;
  run.done.then(() => { ended = true; });
  const ready = await until(() => ended || probe(run)?.ready, ms);
  if (ready && !ended) return probe(run);
  if (!ended) try { process.kill(-run.pid, 'SIGKILL'); } catch {}
  assert.fail(`the run never reached its command's hold in a bay\n${show(await run.done, probe(run))}`);
}
