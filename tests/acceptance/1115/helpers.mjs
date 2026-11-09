// Helpers for #1115's acceptance tests: a sandboxed HOME (so the real ~/.deepbuild is never read or written), the
// scratch trees the real lanes.mjs and affected.mjs run in, fixture suites, throwaway SSH keys and signed tags for the
// guard. Nothing here imports the code under test: every surface is reached by running it, and lanes.mjs's lists are
// read by a child process, so a missing export reads as an assertion failure, never as an import error
// (README: The surface).
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { APPROVERS, people, tag } from '../../fixtures/approver.mjs';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const THROTTLE = join(CHECKOUT, 'scripts/throttle.mjs');
export const KNOWN = 'scripts/known-failures.json';
/** A lane run takes seconds on an idle machine and much longer on a loaded one; a hang still ends. */
export const LONG = { timeout: 300_000 };
const ENV_OUT = ['DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'NODE_TEST_CONTEXT', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES', 'CARGO_TARGET_DIR', 'DEEP_PROOF_ISSUES', 'DEEP_APPROVERS',
  'DEEP_880_TOUCH_ID', 'DEEP_PI_CLI', 'DEEPBUILD_M1_RECORD', 'DEEP_PROOF_VITEST_REPORT'];

/** A test's id, as known-failures.json and affected.mjs write it: the repo path, then each name, joined by ` › `. */
export const idOf = (file, ...names) => [file, ...names].join(' › ');

/** A sandbox removed after the test, with its own HOME and events file; every process it started is stopped. */
export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-1115-')));
  const home = join(dir, 'home');
  mkdirSync(home);
  const env = { ...process.env, HOME: home, XDG_CACHE_HOME: join(home, '.cache'), T1115_EVENTS: join(dir, 'events.jsonl') };
  for (const name of ENV_OUT) delete env[name];
  writeFileSync(join(dir, 'stub.mjs'), STUB);
  writeFileSync(join(dir, 'driver.mjs'), DRIVER);
  const box = { dir, home, env, stub: join(dir, 'stub.mjs'), driver: join(dir, 'driver.mjs'), children: [] };
  t.after(() => {
    // Only the processes this test started, by their process group's PID.
    for (const child of box.children) stop(child);
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

/** Stops a process launch started, by its process group's PID. */
export function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try { process.kill(-child.pid, 'SIGKILL'); } catch {}
}

/** Starts `argv` in the sandbox in its own process group; `done` resolves with its status and output. */
export function launch(box, argv, { env = {}, cwd = box.dir } = {}) {
  const child = spawn(argv[0], argv.slice(1), { cwd, env: { ...box.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.done = new Promise((resolve) => child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr })));
  return child;
}

// runLanes reached by running it: the real unit lane of this tree's lanes.mjs, or the lanes given as JSON.
const DRIVER = `import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [tree, lanes] = process.argv.slice(2);
const { checks, runLanes } = await import(pathToFileURL(join(tree, 'scripts/lanes.mjs')).href);
process.exitCode = runLanes(lanes ? JSON.parse(lanes) : checks.filter(({ name }) => name === 'unit'), { cwd: tree });
`;

// A holder from outside every run under test: node stub.mjs <name> <ms> notes that it started, then holds.
const STUB = `import { appendFileSync } from 'node:fs';
const [name, ms] = process.argv.slice(2);
appendFileSync(process.env.T1115_EVENTS, JSON.stringify({ name, throttle: process.env.DEEP_THROTTLE ?? null, pid: process.pid }) + '\\n');
await new Promise((done) => setTimeout(done, Number(ms)));
`;
/** `throttle.mjs <class> --wait 1 -- node stub.mjs <name> <ms>`: another session's grant. */
export const hold = (box, kind, name, ms) => launch(box, [process.execPath, THROTTLE, kind, '--wait', '1', '--', process.execPath, box.stub, name, String(ms)]);
export const started = (box) => (existsSync(box.env.T1115_EVENTS) ? readFileSync(box.env.T1115_EVENTS, 'utf8').split('\n').filter(Boolean).length : 0);

export async function until(predicate, ms) {
  const end = Date.now() + ms;
  for (;;) {
    if (predicate()) return true;
    if (Date.now() > end) return false;
    await new Promise((done) => setTimeout(done, 50));
  }
}

export function write(cwd, files) {
  for (const [path, content] of Object.entries(files)) {
    if (content === null) {
      rmSync(join(cwd, path), { force: true });
      continue;
    }
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
}
export const gitIn = (cwd) => (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, stdio: 'pipe', encoding: 'utf8' });

/** The lists of a tree's lanes.mjs, read by a child; a list it doesn't export reads as undefined. */
export function lanesLists(root = CHECKOUT) {
  const code = `const lanes = await import(${JSON.stringify(pathToFileURL(join(root, 'scripts/lanes.mjs')).href)});
    const lint = lanes.checks.find(({ name }) => name === 'lint').commands.map(([, script]) => script).filter((script) => /^scripts\\/[^/]+\\.mjs$/.test(script ?? ''));
    console.log(JSON.stringify({ timed: lanes.timed ?? null, alone: lanes.alone ?? null, byHand: lanes.byHand ?? null, lint }));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `scripts/lanes.mjs could not be read: ${result.stderr}`);
  return JSON.parse(result.stdout.trim().split('\n').at(-1));
}

const covers = (list, file) => list.some((entry) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry));

/**
 * A file of the real `timed` list with this extension that isn't left to a person, so affected.mjs selects it as
 * timed. A fixture sits at that path, so a correct list covers it however it names the file.
 */
export function timedPath(extension) {
  const { timed, byHand } = lanesLists();
  assert.ok(Array.isArray(timed), 'scripts/lanes.mjs exports no timed list');
  const path = timed.find((file) => file.endsWith(`.test.${extension}`) && !/\.(?:live|long)\.test\./.test(file) && !covers(byHand, file));
  assert.ok(path, `the timed list holds no .test.${extension} file`);
  return path;
}

/** A folder of lanes.mjs's `alone` list: the unit lane's second vitest command fails on finding no file. */
function aloneFolder() {
  const { alone } = lanesLists();
  const folder = alone?.find((entry) => entry.endsWith('/'));
  assert.ok(folder, 'scripts/lanes.mjs exports no alone folder');
  return folder;
}

/** A vitest fixture file holding `body`. */
export const vitestFile = (body) => `import { describe, expect, it, test } from 'vitest';\n${body}\n`;
/** A node --test fixture file holding `body`. The unit lane's node command reads tests/*.test.mjs. */
export const nodeFile = (body) => `import assert from 'node:assert/strict';\nimport test, { describe, it } from 'node:test';\n${body}\n`;

// One passing test per command of the unit lane, since each runner fails on a pattern that finds no file.
const passing = () => ({
  'tests/fixture-1115/pass.test.ts': vitestFile("test('a parallel vitest test passes', () => { expect(1).toBe(1); });"),
  [`${aloneFolder()}fixture-1115-pass.test.ts`]: vitestFile("test('an alone vitest test passes', () => { expect(1).toBe(1); });"),
  'tests/fixture-1115-pass.test.mjs': nodeFile("test('a node test passes', () => { assert.equal(1, 1); });"),
});

// cargo is stubbed: `metadata` reports no crates, and `test` prints what T1115_CARGO names, as a run would.
const CARGO = `#!/bin/sh
if [ "$1" = metadata ]; then echo '{"packages":[],"workspace_members":[],"version":1}'; exit 0; fi
if [ "$1" = test ] && [ -n "$T1115_CARGO" ]; then cat "$T1115_CARGO"; exit "\${T1115_CARGO_STATUS:-0}"; fi
exit 0
`;
// sysctl is stubbed where a test needs a machine that isn't a reference Mac (README: The real 880 entries).
export const NOT_REFERENCE = `#!/bin/sh
if [ "$1" = -n ] && [ "$2" = hw.model ]; then echo Mac00,0; exit 0; fi
exec /usr/sbin/sysctl "$@"
`;
// The throttle shrunk at its one boundary: the real throttle.mjs runs, given a test-class wait of 1.2 s and not 30
// minutes, and optionally after a line of output, as a node warning leaves one (README: No grant).
const THROTTLE_SHIM = `import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export * from './throttle-real.mjs';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const test = args[0] === 'test';
  const wait = args.indexOf('--wait');
  if (test && wait >= 0) args[wait + 1] = '0.02';
  if (test && process.env.T1115_PREAMBLE) console.error('(node:1) Warning: a line before the throttle gets to write');
  const { status } = spawnSync(process.execPath, [fileURLToPath(new URL('./throttle-real.mjs', import.meta.url)), ...args], { stdio: 'inherit' });
  process.exit(status ?? 1);
}
`;

// The repo's config with its include written out: importing it from lanes.mjs needs the workspace packages built.
const VITEST_CONFIG = `import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts', 'packages/**/test/**/*.test.ts', 'packages/**/*.test.ts'] } });
`;

/**
 * The scratch tree the real scripts run in (README: The scratch trees): a copy of `scripts` (this checkout's by
 * default) with the lint lane's scripts stubbed, a vitest config, a folder of links to node_modules,
 * a known-failures baseline, the unit lane's passing files and `files`, all committed in a fresh repository at
 * box.dir/<name>, and a bin folder on PATH with a cargo stub.
 */
export function tree(box, files, { scripts = join(CHECKOUT, 'scripts'), name = 'tree', failures = {}, skips, sysctl, shimThrottle = false } = {}) {
  const cwd = join(box.dir, name);
  mkdirSync(cwd);
  cpSync(scripts, join(cwd, 'scripts'), { recursive: true });
  for (const script of lanesLists(cwd).lint) writeFileSync(join(cwd, script), '// a lint stub for #1115\n');
  writeFileSync(join(cwd, KNOWN), `${JSON.stringify({ failures, lint: {}, timing: [], ...(skips ? { skips } : {}) }, null, 2)}\n`);
  if (shimThrottle) {
    renameSync(join(cwd, 'scripts/throttle.mjs'), join(cwd, 'scripts/throttle-real.mjs'));
    writeFileSync(join(cwd, 'scripts/throttle.mjs'), THROTTLE_SHIM);
  }
  // A folder of links, so a tool's cache (vitest's .vite) lands here, never in this checkout's node_modules.
  mkdirSync(join(cwd, 'node_modules'));
  for (const entry of readdirSync(join(CHECKOUT, 'node_modules')).filter((entry) => !entry.startsWith('.vite'))) symlinkSync(join(CHECKOUT, 'node_modules', entry), join(cwd, 'node_modules', entry));
  write(cwd, { '.gitignore': 'node_modules\n', 'vitest.config.mjs': VITEST_CONFIG, ...passing(), ...files });
  const git = gitIn(cwd);
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'fixture');
  const bin = join(box.dir, `bin-${name}`);
  mkdirSync(bin);
  for (const [tool, script] of Object.entries({ cargo: CARGO, ...(sysctl ? { sysctl } : {}) })) {
    writeFileSync(join(bin, tool), script);
    chmodSync(join(bin, tool), 0o755);
  }
  return { cwd, env: { PATH: `${bin}${delimiter}${box.env.PATH}` } };
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

/** The real unit lane of the tree's lanes.mjs, through the real runLanes; resolves with its status and output. */
export const unit = (box, { cwd, env }, extra = {}) => launch(box, [process.execPath, box.driver, cwd], { cwd, env: { ...env, ...extra } }).done;
/** The given lanes through the tree's runLanes. */
export const lanes = (box, { cwd, env }, list) => launch(box, [process.execPath, box.driver, cwd, JSON.stringify(list)], { cwd, env }).done;
/** `node scripts/affected.mjs ...args` in the tree. */
export const affected = (box, { cwd, env }, args, extra = {}) => launch(box, [process.execPath, 'scripts/affected.mjs', ...args], { cwd, env: { ...env, ...extra } }).done;
/**
 * affected.mjs under a build grant of this sandbox's table. A timed request from that chain is nested, so it waits for
 * no load, and a --timed run reads the same on a loaded machine as on an idle one (docs/parallel-proof.md, section 6).
 */
export const affectedNested = (box, { cwd, env }, args) => launch(box, [process.execPath, 'scripts/throttle.mjs', 'build', '--', process.execPath, 'scripts/affected.mjs', ...args], { cwd, env }).done;

/** The state runLanes reported for a lane: the last line starting with a state and the lane's name. */
export function laneState(stdout, lane = 'unit') {
  const escaped = lane.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return stdout.split('\n').map((line) => line.match(RegExp(`^(PASS|FAIL|BLOCKED|INCONCLUSIVE|INVALID) ${escaped}\\b`))?.[1]).filter(Boolean).at(-1) ?? null;
}
/** The summary line affected.mjs ends on: `<STATE> affected: ...`. */
export const summary = (stdout) => stdout.split('\n').filter((line) => / affected: /.test(line)).at(-1) ?? '';
/** Whether a line of the output names the test's id, and its note when it has one (README: The surface). */
export const lists = (stdout, id, note = '') => stdout.split('\n').some((line) => line.includes(id) && line.includes(note));
/** The failure ids of an affected.mjs run: each `NEW FAIL`, `KNOWN` and `FAIL` line's id (`<file> › <test>`), sorted. */
export const failIds = (stdout) => stdout.split('\n').map((line) => line.match(/^(?:NEW FAIL|KNOWN|FAIL) (.+? › [^:]+)/)?.[1]).filter(Boolean).sort();

const tail = (text, size = 2_500) => (text.length > size ? `…${text.slice(-size)}` : text);
export const dump = (...runs) => runs.map((run) => `exit ${run.status}${run.signal ? ` (${run.signal})` : ''}\nstdout:\n${tail(run.stdout)}\nstderr:\n${tail(run.stderr, 800)}`).join('\n');

/** Every evidence record under the sandbox's ~/.deepbuild/lanes/, any depth (README: The surface). */
export function records(box) {
  const found = [];
  const walk = (folder) => {
    for (const name of readdirSync(folder)) {
      const path = join(folder, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith('.json')) found.push(JSON.parse(readFileSync(path, 'utf8')));
    }
  };
  const folder = join(box.home, '.deepbuild', 'lanes');
  if (existsSync(folder)) walk(folder);
  return found;
}
/** The one record of a lane, failing at an assertion when there's none. */
export function recordOf(box, lane, run) {
  const found = records(box).filter((record) => record.lane === lane);
  assert.ok(found.length, `no evidence record of the lane "${lane}" under ~/.deepbuild/lanes/ (records there: ${records(box).length})\n${dump(run)}`);
  return found.at(-1);
}

const ISSUE = 9115;

/** The issue file and the environment the guard reads, for a planted issue. */
function guardEnv(box) {
  const issues = join(box.dir, 'issues');
  write(issues, { [`${ISSUE}.md`]: 'Planted for #1115.\n\n### Acceptance criteria\n- [ ] Nothing real\n' });
  return { DEEP_PROOF_ISSUES: issues };
}

/**
 * A scratch repository for the guard: `base` committed on main, with the proof lanes on main and origin/main at that
 * commit, on branch `change`. commit() writes files (null deletes one) and commits them naming the planted issue;
 * approve() tags a commit under deep/approved/, SSH-signed by `signer`, or unsigned when it is null; guard() runs this
 * checkout's real `node scripts/proof.mjs guard` there.
 */
export function guardRepo(box, base) {
  const cwd = join(box.dir, 'repo');
  mkdirSync(cwd);
  const git = gitIn(cwd);
  git('init', '-q', '-b', 'main');
  // The maintainer's security key is on the merge base's approvers list; the stranger's isn't.
  const keys = people();
  write(cwd, { 'scripts/proof-guard.mjs': '// the guard\n', [APPROVERS]: keys.list, ...base });
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('checkout', '-q', '-b', 'change');
  const env = guardEnv(box);
  let tags = 0;
  return {
    cwd, git,
    commit(files) {
      write(cwd, files);
      git('add', '-A');
      git('commit', '-qm', `Change the file\n\nPart of #${ISSUE}`);
      return git('rev-parse', 'HEAD').trim();
    },
    approve(commit, items, signer = 'maintainer') {
      tag(cwd, `deep/approved/${++tags}`, commit, items, signer && keys[signer]);
    },
    guard: () => launch(box, [process.execPath, join(CHECKOUT, 'scripts/proof.mjs'), 'guard'], { cwd, env }).done,
  };
}

/** known-failures.json as `affected.mjs --record` writes it. */
export const baseline = (fields) => `${JSON.stringify({ failures: {}, lint: {}, timing: [], ...fields }, null, 2)}\n`;
/** A `skips` entry (README: The surface). */
export const entry = (id, note, extra = {}) => ({ id, note, reason: 'a fixture of #1115', approval: 'deep/approved/fixture', ...extra });
