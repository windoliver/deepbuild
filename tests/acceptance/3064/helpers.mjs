// Helpers for #3064's acceptance tests: a sandboxed HOME and TMPDIR, stand-ins for what the repo doesn't own (gh and
// GitHub, the hub's `deep lease`, cargo), the fixture repository affected.mjs runs in, the settled list a test writes
// for it, and the watched repository: a bare origin, a clone the tests land in, and a clone the job runs in. Nothing
// here imports the code under test: every surface is reached by running it (README: The surfaces).
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const JOB = join(CHECKOUT, 'scripts/main-watch.mjs');
const GH = fileURLToPath(new URL('./gh.mjs', import.meta.url));
/** Minutes, for a machine at a load many times its cores; a hang still ends. */
export const LONG = { timeout: 2_700_000 };
/** The schedule's landings between two runs of the watch, and the clean runs that settle a suite (the issue's). */
export const LANDINGS = 5, CLEAN_RUNS = 10;
/** The change every scene makes unless it says otherwise: package a's entry, which the suites start as a process. */
export const CHANGE = 'packages/a/src/main.mjs';
/** A suite: the folder of its issue, and the one test file the fixture gives it. */
export const folderOf = (issue) => `tests/acceptance/${issue}/`;
export const fileOf = (issue) => `tests/acceptance/${issue}/started.test.mjs`;
/** The fixture's test outside every suite, which reads the changed file itself. */
export const NEAR = 'tests/near.test.mjs';

const script = (path, content) => {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
};
const jsonLines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
const write = (cwd, files) => {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
};

/**
 * A sandbox removed after the test: its own HOME (so ~/.deepbuild/main-watch/, the throttle table and the lane records
 * are the sandbox's), TMPDIR and git identity, the stand-ins first on PATH, and the fixture tests' events file. Every
 * process it started is stopped by its process group's PID.
 */
export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3064-')));
  const home = join(dir, 'home'), bin = join(dir, 'bin'), gh = join(dir, 'gh'), temp = join(dir, 'tmp');
  for (const folder of [home, bin, gh, temp]) mkdirSync(folder);
  writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = Fixture\n\temail = fixture@example.invalid\n[commit]\n\tgpgsign = false\n[tag]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n[core]\n\thooksPath = /dev/null\n');
  script(join(bin, 'gh'), `#!/bin/sh\nT3064_GH=${JSON.stringify(gh)} exec ${JSON.stringify(process.execPath)} ${JSON.stringify(GH)} "$@"\n`);
  // The hub's `deep lease` (#1015), which scripts/lease calls first: it runs the command.
  script(join(bin, 'deep'), '#!/bin/sh\nif [ "$1" = lease ] && [ "$2" = -- ]; then shift 2; exec "$@"; fi\necho "stand-in deep: no $*" >&2\nexit 1\n');
  // cargo: `metadata` names the crates of the file T3064_CARGO points at, none without it; nothing is built.
  writeFileSync(join(dir, 'no-crates.json'), '{"packages":[],"workspace_members":[],"version":1}\n');
  script(join(bin, 'cargo'), `#!/bin/sh\nif [ "$1" = metadata ]; then cat "\${T3064_CARGO:-${join(dir, 'no-crates.json')}}"; exit 0; fi\nexit 0\n`);
  const env = {
    ...process.env,
    HOME: home, TMPDIR: temp, XDG_CACHE_HOME: join(home, '.cache'), XDG_CONFIG_HOME: join(home, '.config'),
    PATH: `${bin}${delimiter}${process.env.PATH}`, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', TZ: 'UTC',
    npm_config_offline: 'true', npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false',
    T3064_EVENTS: join(dir, 'events.jsonl'), T3064_FLAKY: join(dir, 'flaky'),
  };
  for (const name of Object.keys(env)) {
    if (/^(DEEP_|CLAUDE|ANTHROPIC_API|OPENAI_API|CODEX_|GH_|GITHUB_)/.test(name) || ['NODE_TEST_CONTEXT', 'NODE_OPTIONS', 'CARGO_TARGET_DIR', 'AI_AGENT'].includes(name)) delete env[name];
  }
  const box = { dir, home, env, gh, children: [] };
  t.after(() => {
    // Only the processes this test started, by their process group's PID.
    for (const child of box.children) if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

/**
 * Runs `argv` in the sandbox in its own process group and resolves with its status and output. Its group is stopped by
 * its PID after `ms`, so a wrong program that never ends fails at an assertion on what it printed.
 */
export function run(box, argv, { env = {}, cwd = box.dir, ms = 1_500_000 } = {}) {
  const child = spawn(argv[0], argv.slice(1), { cwd, env: { ...box.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const stop = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, ms); // deadline: a program that never ends is stopped, and the test fails on what it printed
  return new Promise((resolve) => {
    child.on('error', (error) => { clearTimeout(stop); resolve({ argv, status: null, signal: null, stdout, stderr: `${stderr}\n${error}` }); });
    child.on('close', (status, signal) => { clearTimeout(stop); resolve({ argv, status, signal, stdout, stderr }); });
  });
}

// The fixture's files (README: The fixture repository).

// Package a's entry. Its build, packages/a/dist/main.js, is the process the suites start.
const MAIN = "console.log('hello from a');\n";
const UTIL = 'export const shout = (text) => text.toUpperCase();\n';
const PACKAGE = `${JSON.stringify({ name: '@fixture/a', version: '0.0.0', private: true, type: 'module', scripts: { build: 'mkdir -p dist && cp src/main.mjs dist/main.js' } }, null, 2)}\n`;
const ROOT_PACKAGE = `${JSON.stringify({ name: 'fixture-3064', private: true, workspaces: ['packages/*'] }, null, 2)}\n`;
const NOTE = (who) => `const note = (ok) => { if (process.env.T3064_EVENTS) appendFileSync(process.env.T3064_EVENTS, JSON.stringify({ suite: ${JSON.stringify(who)}, ok, t: Date.now(), pid: process.pid }) + '\\n'); };`;

/** The name node --test gives a suite's one test. */
export const testName = (issue) => `issue ${issue}: the build of package a greets`;
/** That test's ID in a lane's evidence record and in affected.mjs's lines. */
export const testId = (issue) => `${fileOf(issue)} › ${testName(issue)}`;

/**
 * A suite's test file. It reaches the product only by starting package a's build as a process, and notes its run in
 * the events file. With `own` it also imports a file of package a itself, with no process between, which makes
 * package a the suite's own package. With `flaky` it fails once when the flaky file reads `armed`, and passes after.
 */
export const suite = (issue, { own = false, flaky = false } = {}) => `// The suite of fixture issue #${issue} (tests/acceptance/3064/README.md, The fixture repository).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync${flaky ? ', existsSync, readFileSync, writeFileSync' : ''} } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
${own ? "import { shout } from '../../../packages/a/src/util.mjs';\n" : ''}
${NOTE(issue)}

test(${JSON.stringify(testName(issue))}, () => {
  const started = spawnSync(process.execPath, [fileURLToPath(new URL('../../../packages/a/dist/main.js', import.meta.url))], { encoding: 'utf8' });
  let ok = started.status === 0 && started.stdout.trim() === 'hello from a'${own ? " && shout('a') === 'A'" : ''};
${flaky ? `  const flaky = process.env.T3064_FLAKY;
  const armed = Boolean(flaky) && existsSync(flaky) && readFileSync(flaky, 'utf8') === 'armed';
  if (armed) writeFileSync(flaky, 'fired');
  ok = ok && !armed;
` : ''}  note(ok);
  assert.ok(ok, \`package a's build didn't greet: exit \${started.status}, \${JSON.stringify(started.stdout)}\${started.stderr}\`);
});
`;

/** A suite's test file that reaches the product only through a Rust binary, deep-fix, which it starts. */
const binarySuite = (issue) => `// The suite of fixture issue #${issue}: it starts the Rust binary deep-fix.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test(${JSON.stringify(`issue ${issue}: deep-fix says fixed`)}, () => {
  const started = spawnSync(join(process.env.DEEP_BIN_DIR ?? fileURLToPath(new URL('../../../target/debug', import.meta.url)), 'deep-fix'), [], { encoding: 'utf8' });
  assert.equal(started.stdout, 'fixed\\n');
});
`;

const NEAR_TEST = `// The fixture's test outside every suite: it reads the changed file itself, with no process between.
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync } from 'node:fs';
import test from 'node:test';

${NOTE('near')}

test("package a's entry says hello", () => {
  const ok = readFileSync(new URL('../packages/a/src/main.mjs', import.meta.url), 'utf8').includes('hello from a');
  note(ok);
  assert.ok(ok);
});
`;

/**
 * The fixture's scripts/lanes.mjs: this checkout's lanes.mjs whole, with its `checks` cut to the fixture: the unit lane
 * is node --test on the suites, as the real unit lane's node command is on its files, and the lint lane the real lint
 * lane's known-failures command.
 */
const LANES = `// The fixture's lanes (tests/acceptance/3064/README.md, The fixture repository).
export * from ${JSON.stringify(pathToFileURL(join(CHECKOUT, 'scripts', 'lanes.mjs')).href)};
export const checks = [
  { name: 'unit', commands: [[process.execPath, '--test', 'tests/acceptance/*/*.test.mjs']], fix: 'Repair the behavior named by the failing test.' },
  { name: 'lint', commands: [[process.execPath, 'scripts/known-failures-check.mjs']], fix: 'Give each entry named above an open issue and a date within 14 days.' },
];
`;
const KNOWN = `${JSON.stringify({ failures: {}, lint: {}, timing: [], skips: [] }, null, 2)}\n`;

/** This checkout's scripts/ copied into `cwd`, with the fixture's lanes and an empty known-failures.json. */
function copyScripts(cwd) {
  cpSync(join(CHECKOUT, 'scripts'), join(cwd, 'scripts'), { recursive: true });
  write(cwd, { 'scripts/lanes.mjs': LANES, 'scripts/known-failures.json': KNOWN });
}
/** A folder of links to this checkout's node_modules, which affected.mjs imports typescript from; git ignores it. */
function linkModules(cwd) {
  mkdirSync(join(cwd, 'node_modules'));
  for (const entry of readdirSync(join(CHECKOUT, 'node_modules')).filter((entry) => !entry.startsWith('.vite'))) symlinkSync(join(CHECKOUT, 'node_modules', entry), join(cwd, 'node_modules', entry));
}
const gitAs = (box, cwd) => (...args) => execFileSync('git', args, { cwd, env: box.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/**
 * The fixture repository affected.mjs runs in: this checkout's scripts/ with the fixture's lanes, a workspace package
 * `packages/a` whose build the run makes, `suites` (issue number to its test file's source; by default three that
 * start the build), the near test, and `files`; committed on main, with origin/main at that commit. With `crate`, a
 * workspace crate `deep-fix` with a binary of that name, which the cargo stand-in's metadata names.
 * `tree` is the commit's tree and `id(issue)` git's ID of a suite's folder at HEAD, as the settled list names them.
 */
export function fixture(box, { suites = { 90001: suite(90001), 90002: suite(90002), 90003: suite(90003) }, files = {}, crate = false } = {}) {
  const cwd = join(box.dir, 'repo');
  mkdirSync(cwd);
  copyScripts(cwd);
  linkModules(cwd);
  write(cwd, {
    '.gitignore': 'node_modules\ndist\n',
    'package.json': ROOT_PACKAGE,
    'packages/a/package.json': PACKAGE,
    [CHANGE]: MAIN,
    'packages/a/src/util.mjs': UTIL,
    [NEAR]: NEAR_TEST,
    ...Object.fromEntries(Object.entries(suites).map(([issue, source]) => [fileOf(issue), source])),
    ...(crate ? { 'crates/deep-fix/Cargo.toml': '[package]\nname = "deep-fix"\nversion = "0.0.0"\nedition = "2021"\n', 'crates/deep-fix/src/main.rs': 'fn main() {\n    println!("fixed");\n}\n' } : {}),
    ...files,
  });
  const env = {};
  if (crate) {
    env.T3064_CARGO = join(box.dir, 'crates.json');
    writeFileSync(env.T3064_CARGO, `${JSON.stringify({ packages: [{ name: 'deep-fix', manifest_path: join(cwd, 'crates/deep-fix/Cargo.toml'), dependencies: [], targets: [{ kind: ['bin'], crate_types: ['bin'], name: 'deep-fix', src_path: join(cwd, 'crates/deep-fix/src/main.rs') }] }], workspace_members: [], version: 1 })}\n`);
  }
  const git = gitAs(box, cwd);
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'r0: the fixture repository');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  return { cwd, env, git, write: (more) => write(cwd, more), tree: () => git('rev-parse', 'HEAD^{tree}'), id: (issue) => git('rev-parse', `HEAD:tests/acceptance/${issue}`) };
}
export const binaryFixture = (box) => fixture(box, { suites: { 90001: binarySuite(90001) }, crate: true });

/** Where the run reads the settled list: ~/.deepbuild/main-watch/settled.json, under the HOME it was given. */
export const settledFile = (box) => join(box.home, '.deepbuild', 'main-watch', 'settled.json');
/** Writes the settled list: an object as the watch writes it (the design's shape), or a string as it is. */
export function writeList(box, list) {
  mkdirSync(dirname(settledFile(box)), { recursive: true });
  writeFileSync(settledFile(box), typeof list === 'string' ? list : `${JSON.stringify(list, null, 2)}\n`);
}
/** The list the watch would write for the fixture's HEAD with these suites settled. */
export const listOf = (fx, issues) => ({ tree: fx.tree(), suites: Object.fromEntries(issues.map((issue) => [folderOf(issue), fx.id(issue)])) });

/** `node scripts/affected.mjs ...args` in the fixture repository, with the fixture's own copy of scripts/. */
export const affected = (box, fx, args) => run(box, [process.execPath, 'scripts/affected.mjs', ...args], { cwd: fx.cwd, env: fx.env });

// What a run of affected.mjs printed (README: The surfaces).
const linesOf = (out) => out.stdout.split('\n');
/** The `SETTLED <n> …` lines: the count of suites left to the watch, and the line. */
export const left = (out) => linesOf(out).flatMap((line) => { const count = line.match(/^SETTLED (\d+)(?=\s|$)/)?.[1]; return count === undefined ? [] : [{ count: Number(count), line }]; });
/** The `SETTLED no list: …` lines. */
export const noList = (out) => linesOf(out).filter((line) => line.startsWith('SETTLED no list:'));
/** Whether a line names a suite's folder. */
export const names = (line, issue) => RegExp(`(?<![\\w./-])tests/acceptance/${issue}(?!\\d)`).test(line);
/** Whether a `SETTLED <n>` line names the suite. */
export const leftNames = (out, issue) => left(out).some(({ line }) => names(line, issue));
/** Whether the selection the run printed holds the test file, in any of its blocks. */
export const selects = (out, file) => linesOf(out).some((line) => /^(?:parallel|alone|timed|slow) (?:vitest|node): /.test(line) && line.replace(/^\S+ \S+: /, '').split(' ').includes(file));
/** The summary line affected.mjs ends on: `<STATE> affected: …`. */
export const summary = (out) => linesOf(out).filter((line) => / affected: /.test(line)).at(-1) ?? '';

/** The fixture tests that ran, by their notes in the events file. */
export const events = (box) => jsonLines(box.env.T3064_EVENTS);
export const ranOf = (box, who) => events(box).filter((event) => String(event.suite) === String(who));

// The watched repository (README: The watched repository).

/** An issue in the stand-in's state: open, or closed with the reason GitHub gives. */
export function fileIssue(box, number, { state = 'OPEN', stateReason = null } = {}) {
  writeFileSync(join(box.gh, `issue-${number}.json`), JSON.stringify({ number, title: `Fixture issue ${number}`, body: 'A fixture issue.\n\n### Acceptance criteria\n\n- [x] Package a greets.\n', state, stateReason, comments: [], labels: [] }, null, 2));
}
export const closed = (box, number) => fileIssue(box, number, { state: 'CLOSED', stateReason: 'COMPLETED' });

/**
 * The watched repository: `origin.git`, a bare repository standing for GitHub's; `work`, the clone the tests land in,
 * which can also run affected.mjs; and `mac`, the clone the job runs in, left at the first commit. Main's first commit
 * holds this checkout's scripts/ with the fixture's lanes, package a with its build committed, and `suites`.
 */
export function watched(box, suites) {
  const origin = join(box.dir, 'origin.git'), work = join(box.dir, 'work'), mac = join(box.dir, 'mac');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { env: box.env });
  writeFileSync(join(box.gh, 'origin.txt'), origin);
  mkdirSync(work);
  copyScripts(work);
  linkModules(work);
  write(work, {
    '.gitignore': 'node_modules\n',
    'packages/a/package.json': PACKAGE,
    [CHANGE]: MAIN,
    'packages/a/dist/main.js': MAIN,
    'tags/base': 'base\n',
    'README.md': "The repository the main watch watches in #3064's acceptance tests.\n",
    ...Object.fromEntries(Object.entries(suites).map(([issue, source]) => [fileOf(issue), source])),
  });
  const git = gitAs(box, work);
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'r0: the watched repository');
  git('remote', 'add', 'origin', origin);
  git('push', '-q', 'origin', 'main');
  gitAs(box, box.dir)('clone', '-q', origin, mac);
  return { origin, work, mac, cwd: work, env: {}, git, landed: 0 };
}

/** `count` landings on origin's main, each a commit of its own on the first-parent line; the first also adds `files`. */
export function land(fx, count = LANDINGS, files = {}) {
  for (let i = 0; i < count; i++) {
    const k = ++fx.landed;
    write(fx.work, { ...(i === 0 ? files : {}), [`tags/l${k}`]: `l${k}\n` });
    fx.git('add', '-A');
    fx.git('commit', '-qm', `Landing ${k} (Part of #${91000 + k})`);
  }
  fx.git('push', '-q', 'origin', 'main');
  return fx.git('rev-parse', 'HEAD');
}

/** One scheduled tick: `node scripts/main-watch.mjs tick` in the job's clone. */
export const tick = (box, fx) => run(box, [process.execPath, JOB, 'tick'], { cwd: fx.mac, ms: 1_200_000 });

/** The settled list as the sandbox's HOME holds it now: its text and what it parses to, or null when there is none. */
export function readList(box) {
  if (!existsSync(settledFile(box))) return null;
  const text = readFileSync(settledFile(box), 'utf8');
  try { return { text, list: JSON.parse(text) }; } catch { return { text, list: null }; }
}
/** Whether a list the watch wrote holds the suite: its folder as a key of `suites`. */
export const lists = (read, issue) => Boolean(read?.list?.suites) && typeof read.list.suites === 'object' && Object.hasOwn(read.list.suites, folderOf(issue));
/** What a commit of the watched repository holds: its tree, and git's ID of a suite's folder in it. */
export const treeAt = (fx, commit) => fx.git('rev-parse', `${commit}^{tree}`);
export const idAt = (fx, commit, issue) => fx.git('rev-parse', `${commit}:tests/acceptance/${issue}`);

export const ghCalls = (box) => jsonLines(join(box.gh, 'calls.jsonl'));

const tail = (text, size) => (text.length > size ? `…${text.slice(-size)}` : text);
/** What a person reads at a failed assertion. */
export const dump = (box, ...runs) => [
  `settled.json: ${readList(box)?.text ?? '(none)'}`,
  `fixture tests that ran: ${events(box).map(({ suite: who, ok }) => `${who} ${ok ? 'ok' : 'FAILED'}`).join(', ') || '(none)'}`,
  `gh calls: ${ghCalls(box).map(({ args }) => args.join(' ')).join(' | ') || '(none)'}`,
  ...runs.filter(Boolean).map((out) => `$ ${out.argv.slice(1).join(' ')}\nexit ${out.status}${out.signal ? ` (${out.signal})` : ''}\nstdout:\n${tail(out.stdout.split('\n').filter((line) => !line.startsWith('TIMED ')).join('\n'), 5000)}\nstderr:\n${tail(out.stderr, 2000)}`),
].join('\n');

export { assert };
