// Helpers for #1114's acceptance tests: a sandboxed HOME (so the lock table is never the real
// ~/.deepbuild/throttle/), probe test files that note when they ran and under which grant, the throttle log,
// the grep for the timed list, and the scratch trees affected.mjs and the proof lanes run in. Nothing here imports
// the code under test: every surface is reached by running it, and lanes.mjs's lists are read by a child process,
// so a missing export reads as an assertion failure, never as an import error (README: The surface).
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const THROTTLE = join(CHECKOUT, 'scripts/throttle.mjs');
const ENV_OUT = ['DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'NODE_TEST_CONTEXT', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES', 'CARGO_TARGET_DIR', 'DEEP_PROOF_ISSUES', 'DEEP_APPROVERS'];

/**
 * A top-level timed grant waits for the one-minute load to fall below the cores (section 6). On a machine already
 * that loaded, a test that needs one is skipped as INCONCLUSIVE, which is never a pass.
 */
export function loaded() {
  const [one] = loadavg();
  return one >= cpus().length ? `INCONCLUSIVE: the load ${one.toFixed(1)} is at or above the ${cpus().length} cores, so no top-level timed grant can start` : null;
}

// The helper names the issue's third criterion lists. A file calls one when its own code, parsed by TypeScript, holds
// a call whose callee is that name or a property of that name (`helpers.name(...)`); a name in a comment or inside a
// string, such as the code of a fixture the test writes out, is no call site of its own (README: The grep).
export const NAMES = ['environment' + 'Problem', 'judge' + 'Timing', 'judge' + 'Limit', 'referenceMac' + 'Problem', 'not' + 'Reference'];
const calls = (path, text) => {
  let found = false;
  const visit = (node) => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
      if (NAMES.includes(name)) return void (found = true);
    }
    ts.forEachChild(node, visit);
  };
  // A cheap filter first: most files name none of them.
  if (NAMES.some((name) => text.includes(name))) visit(ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, path.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS));
  return found;
};
// A test file as the repo declares them (lanes.mjs testPaths, proof-change.mjs isTestFile).
const isTest = (path) => /\.test\.(?:mjs|js|ts)$/.test(path) && !path.split('/').includes('node_modules')
  && (/^tests\//.test(path) || /^packages\/.*\/test\//.test(path) || /^packages\/.*\.test\.ts$/.test(path) || /^crates\/[^/]+\/tests\//.test(path));

/** The files git lists in `root`, tracked and untracked but not ignored. */
export function trackedFiles(root) {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 })
    .split('\0').filter(Boolean).filter((path) => existsSync(join(root, path)));
}

/** Every test file in `root` that calls one of the helpers at its own call site, sorted. */
export function mustBeTimed(root = CHECKOUT) {
  return trackedFiles(root).filter(isTest).filter((path) => {
    let text;
    try { text = readFileSync(join(root, path), 'utf8'); } catch { return false; }
    return calls(path, text);
  }).sort();
}

/** Whether a list of files and folders (ending in /) covers a file, as lanes.mjs's other lists do. */
export const covers = (list, file) => list.some((entry) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry));

/**
 * The check the grep test makes: every file that must be timed is in `list`. It fails at its assertion, naming each
 * file the list misses; it takes the list, so a planted one can be checked the same way.
 */
export function assertTimed(list, root = CHECKOUT) {
  assert.ok(Array.isArray(list) && list.every((entry) => typeof entry === 'string'), `scripts/lanes.mjs exports no timed list of files and folders (got ${JSON.stringify(list)})`);
  const missing = mustBeTimed(root).filter((file) => !covers(list, file));
  assert.deepEqual(missing, [], `files that call ${NAMES.join(', ')} but are not in lanes.mjs's timed list:\n${missing.join('\n')}`);
}

/** lanes.mjs's `timed` export (undefined when it has none) and the scripts its lint lane runs, read by a child. */
export function lanesLists(root = CHECKOUT) {
  const code = `const lanes = await import(${JSON.stringify(pathToFileURL(join(root, 'scripts/lanes.mjs')).href)});
    const lint = lanes.checks.find(({ name }) => name === 'lint').commands.map(([, script]) => script).filter((script) => /^scripts\\/[^/]+\\.mjs$/.test(script ?? ''));
    console.log(JSON.stringify({ timed: lanes.timed ?? null, lint }));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `scripts/lanes.mjs could not be read: ${result.stderr}`);
  const { timed, lint } = JSON.parse(result.stdout.trim().split('\n').at(-1));
  return { timed: timed ?? undefined, lint };
}

/**
 * Where the tests put their timed probe: a .mjs test file the grep says must be timed, so a correct `timed` list
 * covers it whether it names the file or a folder holding it. node --test runs it, so no vitest is needed.
 */
export function timedPath() {
  const path = mustBeTimed().find((file) => file.endsWith('.test.mjs') && !file.startsWith('tests/acceptance/1114/'));
  assert.ok(path, 'the tree holds no .test.mjs file that calls a timing helper, so no probe path can be chosen');
  return path;
}

/** A sandbox removed after the test, with its own HOME and events file; every process it started is stopped. */
export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-1114-')));
  const home = join(dir, 'home');
  mkdirSync(home);
  const env = { ...process.env, HOME: home, XDG_CACHE_HOME: join(home, '.cache'), T1114_EVENTS: join(dir, 'events.jsonl') };
  for (const name of ENV_OUT) delete env[name];
  writeFileSync(join(dir, 'stub.mjs'), STUB);
  const box = { dir, home, env, stub: join(dir, 'stub.mjs'), children: [] };
  t.after(() => {
    // Only the processes this test started, by their process group's PID.
    for (const child of box.children) if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

/** Starts `argv` in the sandbox in its own process group; `done` resolves with its status, output and times. */
export function launch(box, argv, { env = {}, cwd = box.dir } = {}) {
  const child = spawn(argv[0], argv.slice(1), { cwd, env: { ...box.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const started = Date.now();
  child.done = new Promise((resolve) => child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr, started, ended: Date.now() })));
  return child;
}

// A holder from outside every run under test: node stub.mjs <name> <ms> notes start, holds, notes end.
const STUB = `import { appendFileSync } from 'node:fs';
const [name, ms] = process.argv.slice(2);
const note = (event) => appendFileSync(process.env.T1114_EVENTS, JSON.stringify({ name, event, t: Date.now(), throttle: process.env.DEEP_THROTTLE ?? null, pid: process.pid }) + '\\n');
note('start');
await new Promise((done) => setTimeout(done, Number(ms)));
note('end');
`;
/** `throttle.mjs <class> --wait 1 -- node stub.mjs <name> <ms>`: another session's grant. */
export const hold = (box, kind, name, ms) => launch(box, [process.execPath, THROTTLE, kind, '--wait', '1', '--', process.execPath, box.stub, name, String(ms)]);

export function events(box) {
  const file = box.env.T1114_EVENTS;
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
}
export const runsOf = (box, name, kind = 'start') => events(box).filter((e) => e.name === name && e.event === kind);

export async function until(predicate, ms) {
  const end = Date.now() + ms;
  for (;;) {
    if (predicate()) return true;
    if (Date.now() > end) return false;
    await new Promise((done) => setTimeout(done, 25));
  }
}

/**
 * A probe test file: one test, named `title`, that notes `start` (with its DEEP_THROTTLE and its ancestors' pids and
 * commands, from ps) and, after 300 ms, `end`, around `body`.
 */
export const probe = (name, title, { imports = '', body = '' } = {}) => `import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
${imports}
const ancestors = () => {
  const table = new Map(spawnSync('ps', ['-A', '-o', 'pid=,ppid=,command='], { encoding: 'utf8', maxBuffer: 1 << 26 }).stdout.split('\\n')
    .map((line) => line.match(/^\\s*(\\d+)\\s+(\\d+)\\s+(.*)$/)).filter(Boolean).map(([, pid, ppid, command]) => [Number(pid), { ppid: Number(ppid), command }]));
  const chain = [];
  for (let at = process.ppid; table.has(at) && chain.length < 64; at = table.get(at).ppid) chain.push({ pid: at, command: table.get(at).command });
  return chain;
};
const note = (event, extra = {}) => appendFileSync(process.env.T1114_EVENTS, JSON.stringify({ name: ${JSON.stringify(name)}, event, t: Date.now(), throttle: process.env.DEEP_THROTTLE ?? null, pid: process.pid, cwd: process.cwd(), ...extra }) + '\\n');
test(${JSON.stringify(title)}, async () => {
  note('start', { ancestors: ancestors() });
  await new Promise((done) => setTimeout(done, 300));
  ${body}
  note('end');
});
`;

/**
 * The throttle log (T5's, as the base writes it): JSON lines under ~/.deepbuild/throttle/log, each with `at` (ISO
 * time), `event` (granted, released, passed, timeout), `class` and the grant's `id`.
 */
export function logLines(box) {
  const folder = join(box.home, '.deepbuild', 'throttle');
  if (!existsSync(folder)) return [];
  const lines = [];
  for (const name of readdirSync(folder).filter((n) => /log/i.test(n))) {
    for (const text of readFileSync(join(folder, name), 'utf8').split('\n').filter((line) => line.trim())) {
      try { lines.push({ ...JSON.parse(text), text }); } catch { lines.push({ text }); }
    }
  }
  return lines;
}
export const logText = (box) => logLines(box).map(({ text }) => text).join('\n');

/**
 * The timed grant a run noted inside of: its DEEP_THROTTLE names a timed grant the log shows granted at or before
 * the run's start and released at or after its end. Returns the reason it isn't, or null.
 */
export function outsideTimedGrant(box, run, end) {
  const [, kind, id] = String(run.throttle).match(/^([a-z-]+):(\S+)$/) ?? [];
  if (kind !== 'timed') return `it ran under DEEP_THROTTLE=${run.throttle}, not a timed grant`;
  const lines = logLines(box).filter((line) => line.id === id && line.class === 'timed');
  const granted = lines.find((line) => line.event === 'granted'), released = lines.find((line) => line.event === 'released');
  if (!granted) return `the throttle log shows no timed grant ${id}`;
  if (Date.parse(granted.at) > run.t) return `its timed grant ${id} was logged at ${granted.at}, ${Date.parse(granted.at) - run.t} ms after the run started`;
  if (!released) return `the throttle log never shows timed grant ${id} released`;
  if (end && Date.parse(released.at) < end.t) return `its timed grant ${id} was released ${end.t - Date.parse(released.at)} ms before the run ended`;
  return null;
}

export const dump = (box, ...runs) => [
  `events:\n${events(box).map((e) => JSON.stringify({ ...e, ancestors: e.ancestors?.slice(0, 4).map(({ command }) => command.slice(0, 120)) })).join('\n')}`,
  `log:\n${logText(box)}`,
  ...runs.map((run) => `exit ${run.status}${run.signal ? ` (${run.signal})` : ''}\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`),
].join('\n');

export function write(cwd, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
}
export const gitIn = (cwd) => (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, stdio: 'pipe' });

/**
 * The tree affected.mjs runs in (README: The affected.mjs tree): a copy of `scripts` (this checkout's by default), the
 * lint lane's own scripts replaced by stubs that pass, a known-failures baseline (empty by default), this checkout's
 * node_modules linked, a cargo stub on PATH that reports no crates, and `files`, all committed in a fresh git
 * repository at box.dir/<name>.
 */
export function affectedTree(box, files, { scripts = join(CHECKOUT, 'scripts'), name = 'tree', failures = {} } = {}) {
  const tree = join(box.dir, name);
  mkdirSync(tree);
  cpSync(scripts, join(tree, 'scripts'), { recursive: true });
  const { lint } = lanesLists(tree);
  for (const script of lint) writeFileSync(join(tree, script), '// a lint stub for #1114\n');
  writeFileSync(join(tree, 'scripts/known-failures.json'), `${JSON.stringify({ failures, lint: {}, timing: [] }, null, 2)}\n`);
  symlinkSync(join(CHECKOUT, 'node_modules'), join(tree, 'node_modules'));
  write(tree, { '.gitignore': 'node_modules\n', ...files });
  const git = gitIn(tree);
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'fixture');
  const bin = join(box.dir, `bin-${name}`);
  mkdirSync(bin);
  writeFileSync(join(bin, 'cargo'), '#!/bin/sh\nif [ "$1" = metadata ]; then echo \'{"packages":[],"workspace_members":[],"version":1}\'; exit 0; fi\necho "cargo stub: $*" >&2\nexit 0\n');
  chmodSync(join(bin, 'cargo'), 0o755);
  return { tree, env: { PATH: `${bin}${delimiter}${box.env.PATH}` } };
}

/** The merge base's scripts/, as `git archive <merge-base> scripts` holds it, extracted into box.dir/<name>. */
export function mergeBaseScripts(box, name = 'merge-base') {
  const base = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: CHECKOUT, encoding: 'utf8' });
  assert.equal(base.status, 0, `this checkout has no merge base with origin/main, so there is no "before": ${base.stderr}`);
  const rev = base.stdout.trim();
  const folder = join(box.dir, name);
  mkdirSync(folder);
  const result = spawnSync('sh', ['-c', 'git -C "$1" archive "$2" scripts | tar -xf - -C "$3"', 'sh', CHECKOUT, rev, folder], { encoding: 'utf8' });
  assert.equal(result.status, 0, `git archive ${rev} scripts failed: ${result.stderr}`);
  return { rev, scripts: join(folder, 'scripts') };
}

/** The failure ids of an affected.mjs run: each `NEW FAIL`, `KNOWN` and `FAIL` line's id (`<file> › <test>`), sorted. */
export const failIds = (stdout) => stdout.split('\n')
  .map((line) => line.match(/^(?:NEW FAIL|KNOWN|FAIL) (.+? › [^:]+)/)?.[1]).filter(Boolean).sort();

/** `node scripts/affected.mjs ...args` in the tree; resolves with its result. */
export const affected = (box, { tree, env }, args) => launch(box, [process.execPath, 'scripts/affected.mjs', ...args], { cwd: tree, env }).done;

/** The summary line affected.mjs ends on: `<STATE> affected: ...`. */
export const summary = (stdout) => stdout.split('\n').filter((line) => / affected: /.test(line)).at(-1) ?? '';
