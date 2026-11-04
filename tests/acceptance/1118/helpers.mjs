// Helpers for #1118's acceptance tests: a sandboxed HOME (so bays are <HOME>/deepbuild-bays/<k>/ and the throttle
// table is <HOME>/.deepbuild/throttle/, never the real ones), "the machine's repository" as a fixture git repository
// with a worktree whose change calls for the before lane, a twin, crash and replay, a probe that every use runs in its
// copy, an npm shim that logs each npm command, and readers for the proof's record lines. Nothing here imports the
// code under test: the proof is reached only by running `node scripts/proof.mjs` (README: The surface).
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, chmodSync, constants, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const MAC = process.platform === 'darwin';
// Section 6's table: one bay pair on the Mac, three on the Spark (and anywhere else).
export const PAIRS = MAC ? 1 : 3;
const REAL_HOME = homedir();

export const GIT = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'init.defaultBranch=main', '-c', 'merge.ff=false'];
export const git = (cwd, ...args) => execFileSync('git', [...GIT, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// The planted issue the fixture's change names. Its tags are built here from its criteria's text, as
// scripts/proof-change.mjs builds a criterion's ID, so no file of this suite carries a tag of it.
export const ISSUE = 9118;
const criterionId = (issue, text) => `#${issue}.${createHash('sha256').update(text.trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 8)}`;
const GREETS = 'The binary greets and p is one';
const UNTRACKED = 'An untracked test runs';
export const C1 = criterionId(ISSUE, GREETS);
export const C2 = criterionId(ISSUE, UNTRACKED);

// The probe: what each use runs in its copy. It hashes every file there outside .git, target and node_modules, and
// with `build` runs cargo build (each compiler-artifact message's fresh flag, the Compiling lines) and the binary.
// It writes what it saw to $BAY_PROBE_OUT, outside every copy, and prints the binary's output as one JSON line.
const PROBE = `import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const spec = JSON.parse(process.argv[2] ?? '{}');
const cwd = realpathSync(process.cwd());
const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;
const SKIP = new Set(['.git', 'target', 'node_modules']);
function files(folder = '', found = {}) {
  for (const entry of readdirSync(join(cwd, folder), { withFileTypes: true })) {
    const path = folder ? folder + '/' + entry.name : entry.name;
    if (!folder && SKIP.has(entry.name)) continue;
    if (entry.isSymbolicLink()) found[path] = 'link:' + readlinkSync(join(cwd, path));
    else if (entry.isDirectory()) files(path, found);
    else found[path] = createHash('sha256').update(readFileSync(join(cwd, path))).digest('hex');
  }
  return found;
}
const out = { label: spec.label, cwd, pid: process.pid, at: Date.now(), files: files() };
if (spec.build) {
  const build = spawnSync('cargo', ['build', '--workspace', '--all-targets', '--offline', '--locked', '--message-format=json'], { cwd, env, encoding: 'utf8', maxBuffer: 1 << 28 });
  out.build = { status: build.status, stderr: String(build.stderr ?? build.error).slice(-4000), compiling: String(build.stderr ?? '').split('\\n').filter((line) => /^\\s*Compiling\\s/.test(line)) };
  out.artifacts = String(build.stdout ?? '').split('\\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line)).filter((m) => m.reason === 'compiler-artifact').map((m) => ({ name: m.target.name, kind: m.target.kind, fresh: m.fresh }));
  const greet = spawnSync(join(cwd, 'target/debug/greet'), [], { encoding: 'utf8' });
  out.greet = greet.status === 0 ? greet.stdout.trim() : null;
}
mkdirSync(process.env.BAY_PROBE_OUT, { recursive: true });
writeFileSync(join(process.env.BAY_PROBE_OUT, spec.label + '-' + process.pid + '-' + Date.now() + '.json'), JSON.stringify(out));
process.stdout.write(JSON.stringify({ greet: out.greet ?? null }) + '\\n');
`;

// A call of the probe from a fixture file: its path and output folder come from the environment the proof hands on.
const callProbe = (label, build) => `spawnSync(process.execPath, [process.env.BAY_PROBE, JSON.stringify({ label: '${label}', build: ${build} })], { encoding: 'utf8' })`;

/** Where npm really is, outside the sandbox's shim. */
function realNpm() {
  for (const folder of String(process.env.PATH).split(delimiter)) {
    const candidate = join(folder, 'npm');
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  throw Error('npm is not on PATH');
}

/** A sandbox removed after the test, with its own HOME; every process it started is stopped, by its group's PID. */
export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-1118-')));
  const home = join(dir, 'home');
  for (const folder of [home, join(dir, 'probes'), join(dir, 'shim'), join(dir, 'issues')]) mkdirSync(folder);
  writeFileSync(join(dir, 'probe.mjs'), PROBE);
  // npm is a boundary this project doesn't own: a shim logs each call (its folder and arguments) and runs the real one.
  const npmLog = join(dir, 'npm.log');
  writeFileSync(join(dir, 'shim', 'npm'), `#!/bin/sh\nprintf '%s\\t%s\\n' "$(pwd -P)" "$*" >> '${npmLog}'\nexec '${realNpm()}' "$@"\n`);
  chmodSync(join(dir, 'shim', 'npm'), 0o755);
  writeFileSync(join(dir, 'issues', `${ISSUE}.md`), `Planted for the #1118 acceptance tests.\n\n### Acceptance criteria\n- [ ] ${GREETS}\n- [ ] ${UNTRACKED}\n\n### Proof\nNone.\n`);
  const cargoHome = process.env.CARGO_HOME ?? join(REAL_HOME, '.cargo');
  const env = {
    ...process.env,
    HOME: home,
    // cargo and rustup stay the machine's, so no toolchain is downloaded into the sandbox HOME.
    RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(REAL_HOME, '.rustup'),
    CARGO_HOME: cargoHome,
    PATH: [join(dir, 'shim'), join(cargoHome, 'bin'), dirname(process.execPath), process.env.PATH].join(delimiter),
    // The fixture's one package is a folder of its own (file:), so npm needs no network; offline makes sure.
    npm_config_offline: 'true',
    npm_config_update_notifier: 'false',
    DEEP_PROOF_ISSUES: join(dir, 'issues'),
    BAY_PROBE: join(dir, 'probe.mjs'),
  };
  for (const name of ['DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'CARGO_TARGET_DIR', 'NODE_TEST_CONTEXT', 'CARGO_BUILD_TARGET_DIR', 'RUSTC_WRAPPER', 'CARGO_BUILD_RUSTC_WRAPPER', 'DEEP_BIN_DIR', 'DEEP_APPROVERS', '__STRYKER_ACTIVE_MUTANT__']) delete env[name];
  for (const name of Object.keys(env)) if (/^npm_(?!config_offline$|config_update_notifier$)/i.test(name)) delete env[name];
  const box = { dir, home, env, npmLog, bays: join(home, 'deepbuild-bays'), children: [], runs: 0 };
  t.after(() => {
    for (const child of box.children) if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

export const write = (cwd, files) => {
  for (const [path, content] of Object.entries(files)) {
    if (content === null) rmSync(join(cwd, path), { force: true });
    else {
      mkdirSync(dirname(join(cwd, path)), { recursive: true });
      writeFileSync(join(cwd, path), content);
    }
  }
};

export const pkg = (version) => `{\n  "name": "bay-fixture",\n  "version": "${version}",\n  "private": true,\n  "devDependencies": {\n    "vitest": "file:vendor/vitest"\n  }\n}\n`;
export const lock = (version) => `{\n  "name": "bay-fixture",\n  "version": "${version}",\n  "lockfileVersion": 3,\n  "requires": true,\n  "packages": {\n    "": {\n      "name": "bay-fixture",\n      "version": "${version}",\n      "devDependencies": {\n        "vitest": "file:vendor/vitest"\n      }\n    },\n    "node_modules/vitest": {\n      "resolved": "vendor/vitest",\n      "link": true\n    },\n    "vendor/vitest": {\n      "version": "0.0.0",\n      "dev": true\n    }\n  }\n}\n`;

// The merge base: a two-crate cargo workspace (greet prints word's WORD), an npm lock whose one package is the
// folder vendor/vitest (a stand-in vitest that runs the probe and reports one passing test), the verdict engine
// (packages/verdicts, which runs the probe as it loads), the storage code crash watches, main's crash suite, one
// seeded false-done case, and a helper under the test paths that the change deletes.
const BASE = {
  '.gitignore': 'target\nnode_modules\n.claude\n*.log\n',
  'Cargo.toml': '[workspace]\nmembers = ["crates/word", "crates/greet"]\nresolver = "2"\n',
  'Cargo.lock': '# This file is automatically @generated by Cargo.\n# It is not intended for manual editing.\nversion = 4\n\n[[package]]\nname = "greet"\nversion = "0.1.0"\ndependencies = [\n "word",\n]\n\n[[package]]\nname = "word"\nversion = "0.1.0"\n',
  'crates/word/Cargo.toml': '[package]\nname = "word"\nversion = "0.1.0"\nedition = "2021"\n',
  'crates/word/src/lib.rs': 'pub const WORD: &str = "hello";\n',
  'crates/greet/Cargo.toml': '[package]\nname = "greet"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nword = { path = "../word" }\n',
  'crates/greet/src/main.rs': 'fn main() {\n    println!("{}", word::WORD);\n}\n',
  'package.json': pkg('0.0.0'),
  'package-lock.json': lock('0.0.0'),
  'vendor/vitest/package.json': '{\n  "name": "vitest",\n  "version": "0.0.0",\n  "private": true\n}\n',
  'vendor/vitest/vitest.mjs': `// A stand-in for vitest: runs the probe in the copy, then reports each file given as one passing test.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
${callProbe('crash', true)};
const args = process.argv.slice(2);
const report = args.find((arg) => arg.startsWith('--outputFile='))?.slice('--outputFile='.length);
const files = args.filter((arg) => arg !== 'run' && !arg.startsWith('-'));
const results = files.map((file) => ({ name: join(process.cwd(), file), status: 'passed', message: '', assertionResults: [{ status: 'passed', fullName: 'crash ok', failureMessages: [] }] }));
if (report) writeFileSync(report, JSON.stringify({ numPassedTests: files.length, testResults: results }));
`,
  'packages/p/index.mjs': 'export const p = 1;\n',
  'packages/verdicts/package.json': '{\n  "name": "verdicts",\n  "private": true,\n  "type": "module",\n  "exports": "./src/index.mjs"\n}\n',
  'packages/verdicts/src/index.mjs': `import { spawnSync } from 'node:child_process';\n\n${callProbe('replay', true)};\n\nexport const verdict = () => ({ outcome: 'blocked' });\n`,
  'packages/record/src/store.ts': 'export const store = 1;\n',
  'tests/acceptance/16/crash.test.ts': "// main's crash suite (the stand-in vitest runs none of it)\n",
  'tests/fixtures/false-done/one.json': '{ "claim": { "says": "done" }, "expected": "blocked" }\n',
  'tests/helpers/main-only.mjs': 'export const mainOnly = true;\n',
};

const tagged = `import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { p } from '../../../packages/p/index.mjs';

test('${C1} the binary greets and p is one', () => {
  const { greet } = JSON.parse(${callProbe('test', true)}.stdout.trim().split('\\n').pop());
  assert.equal(greet, 'hello');
  assert.equal(p, 1);
});
`;
export const UNTRACKED_TEST = `tests/acceptance/${ISSUE}/u.test.mjs`;
const untracked = `import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('${C2} an untracked tagged test runs', () => {
  assert.equal(${callProbe('untracked', false)}.status, 0);
});
`;

/** The planted wrong programs of the fixture's issue: `js` touches no Rust, `rust` touches the greet crate alone. */
export const TWINS = {
  js: { name: 'js-twin', path: 'packages/p/index.mjs', content: 'export const p = 2;\n' },
  rust: { name: 'rust-twin', path: 'crates/greet/src/main.rs', content: 'fn main() {\n    println!("{}", word::WORD.to_uppercase());\n}\n' },
};

/**
 * The machine's repository and a worktree of it (README: The machine's repository). The repository is
 * <HOME>/deepbuild, holding this checkout's scripts/ and the merge base above, with origin at this project's URL and
 * origin/main pinned at the base (never fetched); the worktree is <HOME>/deepbuild/.claude/worktrees/w, made by
 * `git worktree add`. Its change, one commit naming the planted issue: edits the storage code (crash runs), the
 * verdict engine (replay runs) and main's crash suite, deletes tests/helpers/main-only.mjs, adds
 * tests/helpers/change-only.mjs and the tagged test with its twin; `lockEdit` also edits the lock. The untracked tagged
 * test is left untracked.
 */
export function machineRepo(box, { twin = TWINS.js, lockEdit = false } = {}) {
  const main = join(box.home, 'deepbuild');
  mkdirSync(main);
  cpSync(join(CHECKOUT, 'scripts'), join(main, 'scripts'), { recursive: true });
  write(main, BASE);
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'remote', 'add', 'origin', 'https://github.com/windoliver/deepbuild.git');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'fixture');
  git(main, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  // The scripts' own packages (proof-change.mjs imports typescript), where node finds them from the worktree.
  symlinkSync(join(CHECKOUT, 'node_modules'), join(main, 'node_modules'));
  const worktree = join(main, '.claude', 'worktrees', 'w');
  git(main, 'worktree', 'add', '-q', '-b', 'work', worktree);
  const dir = `tests/acceptance/${ISSUE}`;
  write(worktree, {
    'packages/record/src/store.ts': 'export const store = 2;\n',
    'packages/verdicts/src/index.mjs': `${BASE['packages/verdicts/src/index.mjs']}// the change's edit\n`,
    'tests/acceptance/16/crash.test.ts': "// the change's crash suite\n",
    'tests/helpers/main-only.mjs': null,
    'tests/helpers/change-only.mjs': 'export const changeOnly = true;\n',
    [`${dir}/a.test.mjs`]: tagged,
    [`${dir}/twins.json`]: `${JSON.stringify({ [C1]: [twin.name] }, null, 2)}\n`,
    [`${dir}/twins/${twin.name}/${twin.path}`]: twin.content,
    ...(lockEdit ? { 'package.json': pkg('0.0.1'), 'package-lock.json': lock('0.0.1') } : {}),
  });
  git(worktree, 'add', '-A');
  git(worktree, 'commit', '-q', '-m', `The change\n\nPart of #${ISSUE}`);
  write(worktree, { [UNTRACKED_TEST]: untracked });
  return { main, worktree, twin };
}

/** Commits `files` on main, moves origin/main there (as a fetch would) and merges it into the worktree's branch. */
export function mainMoves(fixture, files, message) {
  write(fixture.main, files);
  git(fixture.main, 'add', '-A');
  git(fixture.main, 'commit', '-q', '-m', message);
  git(fixture.main, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(fixture.worktree, 'merge', '-q', '--no-edit', '-m', `Merge main: ${message}`, 'origin/main');
}

/** The files of a commit, each to its bytes' sha256. */
export function commitFiles(cwd, rev) {
  const found = {};
  for (const entry of git(cwd, 'ls-tree', '-r', '-z', rev).split('\0').filter(Boolean)) {
    const [, type, blob] = entry.split('\t')[0].split(' ');
    if (type !== 'blob') continue;
    const bytes = execFileSync('git', ['cat-file', 'blob', blob], { cwd, maxBuffer: 1 << 28 });
    found[entry.split('\t')[1]] = createHash('sha256').update(bytes).digest('hex');
  }
  return found;
}

/** What listFiles lists for a worktree (tracked and untracked non-ignored files that exist), each to its bytes' sha256. */
export function treeFiles(worktree) {
  const found = {};
  for (const path of new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: worktree, encoding: 'utf8' }).split('\0').filter(Boolean))) {
    let stat;
    try { stat = lstatSync(join(worktree, path)); } catch { continue; }
    if (stat.isDirectory()) continue;
    found[path] = createHash('sha256').update(readFileSync(join(worktree, path))).digest('hex');
  }
  return found;
}
export const sha = (text) => createHash('sha256').update(text).digest('hex');

/**
 * The exact tree of each use the fixture's proof makes (README: Readings): the merge base with the change's files under
 * tests/ laid over it (the before lane's base), the change, the change with the twin's file, the change with main's
 * files under tests/ laid over it (crash), and the merge base and the change alone (replay).
 */
export function recipes(fixture) {
  const base = commitFiles(fixture.worktree, git(fixture.worktree, 'merge-base', 'HEAD', 'origin/main').trim());
  const change = treeFiles(fixture.worktree);
  const under = (files) => Object.fromEntries(Object.entries(files).filter(([path]) => path.startsWith('tests/')));
  return {
    'before-base': { ...base, ...under(change) },
    'before-change': change,
    twin: { ...change, [fixture.twin.path]: sha(fixture.twin.content) },
    crash: { ...change, ...under(base) },
    'replay-base': base,
    'replay-change': change,
  };
}

/**
 * Runs `node scripts/proof.mjs before crash replay` in the worktree, its own process group, with the probe writing
 * under probes/<run>/ and the npm log emptied first. Returns its status, output, record lines, probe results, npm
 * calls and wall time, as the test measured it.
 */
export async function proof(box, fixture, lanes = ['before', 'crash', 'replay'], ms = 600_000) {
  const run = `run-${++box.runs}`;
  const out = join(box.dir, 'probes', run);
  rmSync(box.npmLog, { force: true });
  const started = Date.now();
  const child = spawn(process.execPath, [join(fixture.worktree, 'scripts/proof.mjs'), ...lanes], { cwd: fixture.worktree, env: { ...box.env, BAY_PROBE_OUT: out }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  let timer;
  const ended = await Promise.race([
    new Promise((resolve) => child.on('close', (status, signal) => resolve({ status, signal }))),
    new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); }),
  ]);
  clearTimeout(timer);
  if (!ended) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    assert.fail(`the proof did not end within ${ms / 1000} s\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }
  const wall = (Date.now() - started) / 1000;
  const npm = existsSync(box.npmLog) ? readFileSync(box.npmLog, 'utf8').split('\n').filter(Boolean).map((line) => ({ cwd: line.split('\t')[0], args: line.split('\t').slice(1).join('\t') })) : [];
  const probes = existsSync(out) ? readdirSync(out).filter((name) => name.endsWith('.json')).map((name) => JSON.parse(readFileSync(join(out, name), 'utf8'))).sort((a, b) => a.at - b.at) : [];
  return { run, ...ended, stdout, stderr, wall, npm, probes, records: records(stdout) };
}

/** npm ci calls, as the shim logged them. */
export const npmCi = (result) => result.npm.filter(({ args }) => /^ci(\s|$)/.test(args));

/** The record lines: `BAY <event> <one-line JSON object>`. */
export function records(stdout) {
  const found = [];
  for (const line of String(stdout).split('\n')) {
    const match = line.match(/^BAY (\S+) (\{.*\})\s*$/);
    if (!match) continue;
    let fields;
    try { fields = JSON.parse(match[2]); } catch { continue; }
    found.push({ event: match[1], line, ...fields });
  }
  return found;
}

/** The record lines of uses: any but release, with a role (base or change) and a bay path. */
export const useRecords = (result) => result.records.filter((record) => record.event !== 'release' && ['base', 'change'].includes(record.role) && typeof record.bay === 'string');

/** Which use a record is of, by its `use` (README: The record): crash, replay, the twin, else the before lane. */
export function recordUse(record, twin) {
  const use = JSON.stringify(record.use ?? '');
  const kind = /crash/i.test(use) ? 'crash' : /replay/i.test(use) ? 'replay' : /twin/i.test(use) || use.includes(twin.name) ? 'twin' : 'before';
  return kind === 'crash' || kind === 'twin' ? kind : `${kind}-${record.role}`;
}

/**
 * Which use a probe ran in, by who called it and what its copy held: the tagged test runs on the base, the change and
 * the twin; the stand-in vitest under crash; the verdict engine under replay, on both sides. The side is read from
 * packages/record/src/store.ts, which the change edits.
 */
export function probeUse(found, twin) {
  const side = found.files['packages/record/src/store.ts'] === sha('export const store = 2;\n') ? 'change' : 'base';
  if (found.label === 'crash') return 'crash';
  if (found.label === 'replay') return `replay-${side}`;
  if (found.label === 'untracked') return `untracked-${side}`;
  if (found.files[twin.path] === sha(twin.content)) return 'twin';
  return `before-${side}`;
}
export const USES = ['before-base', 'before-change', 'twin', 'crash', 'replay-base', 'replay-change'];

/** The probe results of a run by use; fails at the assertion when a use never ran its probe. */
export function byUse(result, twin, uses = USES) {
  const found = {};
  for (const seen of result.probes) (found[probeUse(seen, twin)] ??= []).push(seen);
  const missing = uses.filter((use) => !found[use]);
  assert.deepEqual(missing, [], `these uses never ran their probe in ${result.run}\n${show(result)}`);
  return found;
}

export const show = (result) => [
  `${result.run}: exit ${result.status}${result.signal ? ` (${result.signal})` : ''}, ${result.wall} s`,
  `stdout:\n${result.stdout.slice(-12000)}`,
  `stderr:\n${result.stderr.slice(-4000)}`,
  `npm calls:\n${result.npm.map(({ cwd, args }) => `  ${args} (in ${cwd})`).join('\n')}`,
  `probes:\n${result.probes.map((seen) => `  ${seen.label} in ${seen.cwd}${seen.build ? `: compiled ${JSON.stringify(compiled(seen))}` : ''}`).join('\n')}`,
].join('\n');

/** The crates cargo compiled in a probe's build: artifacts not fresh, by name. */
export const compiled = (seen) => [...new Set((seen.artifacts ?? []).filter((artifact) => !artifact.fresh).map(({ name }) => name))].sort();

/** Whether `path` lies in <HOME>/deepbuild-bays/<k>/ for a grant index k. */
export function inPair(box, path) {
  const bays = existsSync(box.bays) ? realpathSync(box.bays) : box.bays;
  const rel = relative(bays, path);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  const index = Number(rel.split('/')[0]);
  return Number.isInteger(index) && index >= 1 && index <= PAIRS ? index : null;
}

/**
 * The run's two bays: the bay path of every use record of each role, which must be one per role, two apart, in one
 * pair under <HOME>/deepbuild-bays/<k>/; and every probe of a side ran in its role's bay. Returns { base, change }.
 */
export function theBays(box, result, twin) {
  const uses = useRecords(result);
  assert.ok(uses.length, `the proof printed no record of a use in a bay ("BAY <event> {…}" with a role and a bay)\n${show(result)}`);
  const real = (path) => (existsSync(path) ? realpathSync(path) : path);
  const paths = Object.fromEntries(['base', 'change'].map((role) => [role, [...new Set(uses.filter((record) => record.role === role).map((record) => real(record.bay)))]]));
  for (const role of ['base', 'change']) assert.equal(paths[role].length, 1, `the ${role} uses' records name ${paths[role].length} bay paths, not one: ${paths[role].join(', ')}\n${show(result)}`);
  const bays = { base: paths.base[0], change: paths.change[0] };
  assert.notEqual(bays.base, bays.change, 'the base and the change share one bay');
  const pairs = [inPair(box, bays.base), inPair(box, bays.change)];
  assert.ok(pairs[0] && pairs[0] === pairs[1], `the bays ${bays.base} and ${bays.change} are not one pair under ${box.bays}/<k>/`);
  for (const seen of result.probes) {
    const use = probeUse(seen, twin);
    const role = /base$/.test(use) ? 'base' : 'change';
    assert.equal(seen.cwd, bays[role], `the ${use} use ran in ${seen.cwd}, not in the ${role} bay ${bays[role]}\n${show(result)}`);
  }
  return bays;
}

/** Every string value in a record, however deep. */
export function strings(value, found = []) {
  if (typeof value === 'string') found.push(value);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) strings(item, found);
  return found;
}
