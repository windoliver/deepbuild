// Helpers for #3567's acceptance tests (README). A sandbox with its own HOME, throttle table (DEEP_THROTTLE_TABLE, so
// the machine's ~/.deepbuild/throttle/ is never read or written) and TMPDIR; the scratch git repository this checkout's
// real scripts/affected.mjs runs in, with cargo and npm stubbed first on PATH and the lint lane's own scripts stubbed;
// a run under the test's own limit; the process table; and the throttle's table and log. Nothing here imports the code
// under test: affected.mjs is reached by running it, and read through its output, its exit status and what it leaves.
// Written here, never imported from another suite.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
/** The bound a test gives a run through DEEP_AFFECTED_MIN, in minutes: "set to seconds", half a minute. */
export const BOUND_MIN = 0.5;
export const BOUND_MS = BOUND_MIN * 60_000;
/** The first criterion's "and 15 s more". */
export const AFTER_MS = 15_000;
/** The longest a bounded run may take, from its start to its exit. */
export const END_MS = BOUND_MS + AFTER_MS;
/** How long past END_MS a test lets a late run go on, to say how late it was, before it stops the run's process group. */
const GRACE_MS = 20_000;
/** A bounded run's test: its tree, its run to END_MS and the grace, and its checks, on a loaded machine. */
export const BOUNDED = { timeout: END_MS + GRACE_MS + 120_000 };
/** How long a run that should end by itself, inside its bound, is given on a loaded machine before it is stopped. */
export const WHOLE_MS = 240_000;
export const WHOLE = { timeout: WHOLE_MS + 120_000 };

const ENV_OUT = ['DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'NODE_TEST_CONTEXT', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES', 'CARGO_TARGET_DIR', 'DEEP_PROOF_ISSUES', 'DEEP_APPROVERS',
  'DEEP_PROOF_VITEST_REPORT', 'DEEP_TEST_GRANT_WAIT', 'DEEP_TEST_GRANT_STALL', 'DEEP_LEASE_WAIT', 'DEEP_SHARDS', 'DEEP_JOB_IDLE_MIN', 'DEEP_AFFECTED_MIN', 'DEEP_AFFECTED_HELD',
  'DEEP_THROTTLE_READINGS', 'DEEP_THROTTLE_RUN', 'DEEP_BIN_DIR', 'DEEP_WINDOW', 'DEEP_HUB_PLANT', 'CARGO_MAKEFLAGS', 'MAKEFLAGS', 'MFLAGS', 'NODE_OPTIONS'];
// The home folder of whoever runs the suite, which no message may hold.
const HOME = homedir();
// ps prints a start in its own zone and language, so every reader asks for the same ones.
const PS_ENV = { TZ: 'UTC', LC_ALL: 'C' };

/**
 * A sandbox removed after the test: a HOME, a throttle table folder (DEEP_THROTTLE_TABLE), a TMPDIR for the run's logs
 * and a file the fixtures note their processes in. After the test, every process group it started and every process a
 * fixture noted (by PID, while its start still matches) is stopped; nothing is stopped by name or port.
 */
export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3567-')));
  // The HOME's folder is named `user`: the secrets lint reads `/home/<name>/` in a line as a home path.
  const home = join(dir, 'user'), table = join(dir, 'table'), tmp = join(dir, 'tmp');
  for (const folder of [home, table, tmp]) mkdirSync(folder);
  const env = { ...process.env, HOME: home, XDG_CACHE_HOME: join(home, '.cache'), DEEP_THROTTLE_TABLE: table, TMPDIR: tmp };
  for (const name of ENV_OUT) delete env[name];
  const box = { dir, home, table, tmp, env, notes: join(dir, 'notes.jsonl'), groups: [] };
  t.after(() => {
    // A negative pid signals a group this test started detached; pid > 1 guards against kill(-1).
    for (const pgid of box.groups) if (Number.isInteger(pgid) && pgid > 1) try { process.kill(-pgid, 'SIGKILL'); } catch {}
    for (const { pid, start } of noted(box)) if (start && alive(pid, start)) try { process.kill(pid, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

// What a fixture runs to note a process of its own: its role, PID and start, as `ps -o lstart=` reads it.
const NOTE = (box) => `const note = (role, pid) => appendFileSync(${JSON.stringify(box.notes)}, JSON.stringify({ role, pid, at: Date.now(), start: execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' } }).trim() }) + '\\n');`;
// A child the stuck file starts and never waits for. It ignores SIGTERM, so only a SIGKILL by its PID ends it.
const CHILD = `spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);'], { stdio: 'ignore' })`;

/** A node --test file that never ends: its one test never settles, and it has started a child that ignores SIGTERM. */
export const stuck = (box) => `import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import test from 'node:test';
${NOTE(box)}
test('it never ends', () => new Promise(() => {
  const child = ${CHILD};
  note('stuck', process.pid);
  note('stuck-child', child.pid);
  setInterval(() => {}, 1000);
}));
`;
/** A node --test file that notes it started, then passes its two tests: a file that must never start. */
export const unstarted = (box) => `import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import test from 'node:test';
${NOTE(box)}
note('unstarted', process.pid);
test('it would pass', () => { assert.equal(1, 1); });
test('it would pass too', () => { assert.equal(2, 2); });
`;
/** The name of the failing file's one test. */
export const FAILING = 'it fails before the bound';
/** A node --test file whose one test fails at once, having noted that it ran. */
export const failing = (box) => `import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import test from 'node:test';
${NOTE(box)}
test(${JSON.stringify(FAILING)}, () => {
  note('failing', process.pid);
  assert.equal(1, 2, 'planted failure');
});
`;
/** A node --test file whose one test passes after `ms` of real time. */
export const lasting = (ms) => `import test from 'node:test';
test('it passes in time', () => new Promise((done) => setTimeout(done, ${ms})));
`;
export const nodePass = `import assert from 'node:assert/strict';
import test from 'node:test';
test('it passes', () => { assert.equal(1, 1); });
`;

// cargo is a stub (a boundary #3567 doesn't own): `metadata` prints the fixture's, `test` prints what libtest would
// for it and exits 101 when a test of it FAILED, as cargo does, and anything else, as fmt and clippy, exits 0. npm is
// a stub too: `npm run build --workspaces` exits 0.
const STUB = (metadata, tests) => `#!/bin/sh
case "$1" in
  metadata) cat ${JSON.stringify(metadata)} ;;
  test) cat ${JSON.stringify(tests)}; if grep -q FAILED ${JSON.stringify(tests)}; then exit 101; fi ;;
esac
exit 0
`;
// The repo's own config imports lanes.mjs, which needs the workspace packages built; this one names the fixtures' paths.
const VITEST_CONFIG = `import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts', 'packages/**/test/**/*.test.ts'] } });
`;
// The lint lane's scripts and the timed list, read from the tree's lanes.mjs by a child, so nothing is imported here.
const LISTS = `const { checks, timed } = await import('./scripts/lanes.mjs');
console.log(JSON.stringify({ timed, lint: checks.find(({ name }) => name === 'lint').commands.map(([, script]) => script).filter((script) => /^scripts\\/[^/]+\\.mjs$/.test(script ?? '')) }));`;

/** git in a scratch repository, with no hooks, no signing and no configuration but the sandbox's. */
export const gitIn = (box, cwd) => (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
  { cwd, env: { ...box.env, GIT_CONFIG_NOSYSTEM: '1' }, stdio: 'pipe', encoding: 'utf8' });

/**
 * The scratch tree: a copy of this checkout's scripts/ with the lint lane's own scripts stubbed, an empty
 * known-failures baseline (or `known`), a vitest config, a folder of links to node_modules (so vitest's cache lands
 * here) and `files`, committed in a fresh repository whose origin/main is that commit, with cargo and npm stubs first
 * on PATH. `crates` is what the cargo stub's `metadata` reports, each { name, bins } a library crate under crates/
 * with the binaries it builds, and `cargoTest` what its `test` prints. Returns the tree's folder, the PATH for its
 * runs, its git and the timed list its lanes.mjs holds.
 */
export function tree(box, files, { known = {}, crates = [], cargoTest = '' } = {}) {
  const cwd = join(box.dir, 'tree');
  mkdirSync(cwd);
  cpSync(join(CHECKOUT, 'scripts'), join(cwd, 'scripts'), { recursive: true });
  const lists = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', LISTS], { cwd, env: box.env, encoding: 'utf8' }).trim().split('\n').at(-1));
  for (const script of lists.lint) writeFileSync(join(cwd, script), '// a lint stub for #3567\n');
  writeFileSync(join(cwd, 'scripts', 'known-failures.json'), `${JSON.stringify({ failures: known, lint: {}, timing: [] }, null, 2)}\n`);
  mkdirSync(join(cwd, 'node_modules'));
  for (const entry of readdirSync(join(CHECKOUT, 'node_modules')).filter((entry) => !entry.startsWith('.vite'))) symlinkSync(join(CHECKOUT, 'node_modules', entry), join(cwd, 'node_modules', entry));
  for (const [path, content] of Object.entries({ '.gitignore': 'node_modules\n', 'vitest.config.mjs': VITEST_CONFIG, ...files })) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
  const git = gitIn(box, cwd);
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'fixture');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const bin = join(box.dir, 'bin');
  mkdirSync(bin);
  const packages = crates.map(({ name, bins = [] }) => ({
    name, manifest_path: join(cwd, 'crates', name, 'Cargo.toml'), dependencies: [],
    targets: [{ name: name.replaceAll('-', '_'), kind: ['lib'], src_path: join(cwd, 'crates', name, 'src/lib.rs') },
      ...bins.map((binary) => ({ name: binary, kind: ['bin'], src_path: join(cwd, 'crates', name, 'src/bin', `${binary}.rs`) }))],
  }));
  writeFileSync(join(bin, 'metadata.json'), `${JSON.stringify({ packages, workspace_members: packages.map(({ name }) => name), version: 1 })}\n`);
  writeFileSync(join(bin, 'test.txt'), cargoTest);
  for (const name of ['cargo', 'npm']) {
    writeFileSync(join(bin, name), STUB(join(bin, 'metadata.json'), name === 'cargo' ? join(bin, 'test.txt') : '/dev/null'));
    chmodSync(join(bin, name), 0o755);
  }
  return { cwd, git, timed: lists.timed, env: { PATH: `${bin}${delimiter}${box.env.PATH}` } };
}

// deadline: each caller says what its pause bounds.
export const pause = (ms) => new Promise((done) => setTimeout(done, ms));
export async function until(predicate, ms) {
  const end = Date.now() + ms;
  for (;;) {
    if (predicate()) return true;
    if (Date.now() > end) return false;
    // deadline: a look every 100 ms until `ms` runs out.
    await pause(100);
  }
}

/**
 * Starts `node scripts/affected.mjs ...args` in the tree, in a process group of its own, with `env` over the
 * sandbox's. Its start is the moment its process exists. `done` resolves once it exits, with its status, its output and
 * the time from its start to its exit; or, at `limit`, its whole group is SIGKILLed and `done` resolves with
 * `limited: true`, so a run nothing ends fails at its limit and never hangs.
 */
export function start(box, { cwd, env }, args = [], { env: extra = {}, limit = END_MS + GRACE_MS } = {}) {
  const child = spawn(process.execPath, ['scripts/affected.mjs', ...args], { cwd, env: { ...box.env, ...env, ...extra }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const began = Date.now();
  box.groups.push(child.pid);
  let stdout = '', stderr = '', limited = false;
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  // deadline: a run still going at its limit is stopped, by its own process group, so a hang reads as a failure.
  const timer = setTimeout(() => {
    limited = true;
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  }, limit);
  const closed = new Promise((resolve) => child.on('close', resolve));
  const done = new Promise((resolve) => child.on('exit', (status, signal) => {
    clearTimeout(timer);
    const ended = Date.now();
    // Its end is its exit: a process it left running may hold the pipes open.
    // deadline: the pipes' close is waited for at most 1 s.
    Promise.race([closed, pause(1_000)]).then(() => resolve({ pid: child.pid, status, signal, stdout, stderr, began, ms: ended - began, limited, limit }));
  }));
  return { pid: child.pid, began, done };
}
/** A run from its start to its exit (start, above). */
export const affected = (box, fixture, args, options) => start(box, fixture, args, options).done;

const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return { unparsed: line }; } }) : []);
/** The processes the fixtures noted: { role, pid, start, at }. */
export const noted = (box) => lines(box.notes);

/** Whether the process `pid` that started at `start` still runs, by the process table (a zombie runs nothing). */
export function alive(pid, start) {
  let row;
  try {
    row = execFileSync('ps', ['-o', 'stat=', '-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, ...PS_ENV } }).trim();
  } catch {
    return false;
  }
  const [stat, ...rest] = row.split(/\s+/);
  return rest.join(' ') === start.split(/\s+/).join(' ') && !stat.startsWith('Z');
}

/** The processes still in the process group a run was started as (its own PID), zombies apart: [{ pid, command }]. */
export function inGroup(pgid) {
  const listing = execFileSync('ps', ['-A', '-ww', '-o', 'pid=,pgid=,stat=,args='], { encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, ...PS_ENV } });
  return listing.split('\n').map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/)).filter((row) => row && Number(row[2]) === pgid && !row[3].startsWith('Z')).map((row) => ({ pid: Number(row[1]), command: row[4] }));
}

/** `text` as a message may hold it: the sandbox as <sandbox>, this checkout as <checkout> and the home folder as ~. */
export const redact = (box, text) => text.replaceAll(box.dir, '<sandbox>').replaceAll(CHECKOUT, '<checkout>').replaceAll(HOME, '~');

/**
 * What a run left behind, once it has had 5 s to finish dying: the processes the fixtures noted that still run, and
 * the processes still in the run's own process group.
 */
export async function leftBy(box, run) {
  const left = () => ({ noted: noted(box).filter(({ pid, start }) => start && alive(pid, start)), group: inGroup(run.pid).map(({ pid, command }) => ({ pid, command: redact(box, command) })) });
  // deadline: a killed process is given 5 s to leave the process table.
  await until(() => { const now = left(); return !now.noted.length && !now.group.length; }, 5_000);
  return left();
}

/** The sandbox's throttle log, <table>/log, one JSON object a line. */
export const throttleLog = (box) => lines(join(box.table, 'log'));
/** The sandbox's throttle table, <table>/table.json, as its last writer left it. */
export function throttleTable(box) {
  const file = join(box.table, 'table.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { grants: [], requests: [] };
}

// node hold.mjs: another session's command, which notes that its grant came and then holds it until it is stopped.
const HOLD = `import { appendFileSync } from 'node:fs';
appendFileSync(process.argv[2], JSON.stringify({ role: 'holder', pid: process.pid, at: Date.now() }) + '\\n');
setInterval(() => {}, 1000);
`;
/**
 * Another session's grant of `cls` in the sandbox's table: `node scripts/throttle.mjs <cls> --wait 30 -- node hold.mjs`,
 * in a process group of its own, stopped after the test. Returns the PID of its throttle, which its request and its
 * grant carry.
 */
export function hold(box, { cwd, env }, cls) {
  const script = join(box.dir, 'hold.mjs');
  writeFileSync(script, HOLD);
  const child = spawn(process.execPath, ['scripts/throttle.mjs', cls, '--wait', '30', '--', process.execPath, script, box.notes], { cwd, env: { ...box.env, ...env }, detached: true, stdio: 'ignore' });
  box.groups.push(child.pid);
  return child.pid;
}
/** How many holders hold their grant now, by their own notes. */
export const holding = (box) => noted(box).filter(({ role }) => role === 'holder').length;

/** The summary line affected.mjs ends on: `<STATE> affected: ...`. */
export const summary = (stdout) => stdout.split('\n').filter((line) => / affected: /.test(line)).at(-1) ?? '';
const STATE = /^(?:PASS|FAIL|NEW FAIL|KNOWN|BLOCKED|INCONCLUSIVE|INVALID|NO NEW FAILURES)\b/;
/** The lines starting with a state word that name `text`. */
export const stateLines = (stdout, text) => stdout.split('\n').filter((line) => STATE.test(line) && line.includes(text));
/** The lines starting INCONCLUSIVE. */
export const inconclusive = (stdout) => stdout.split('\n').filter((line) => line.startsWith('INCONCLUSIVE'));
/** How many tests the summary counts as passed; null when it names no count. */
export const passedCount = (stdout) => { const count = summary(stdout).match(/\b(\d+) passed\b/)?.[1]; return count === undefined ? null : Number(count); };

/** `line` with each of `texts` taken out: what a line says beside the paths it names. */
export const without = (line, ...texts) => texts.reduce((rest, text) => rest.replaceAll(text, ' '), line);
/** "Not started", in the issue's words and their like: not started, never started, not yet started, didn't start. */
export const NOT_STARTED = /(?:\b(?:not|never)|n['’]t)\s+(?:yet\s+)?(?:been\s+)?start(?:ed)?\b|\bunstarted\b/i;

const tail = (text, size = 3_000) => (text.length > size ? `…${text.slice(-size)}` : text);
// The TIMED line holds the whole timed list, thousands of characters no failure needs.
const brief = (stdout) => stdout.replace(/^(TIMED the timed list, from scripts\/lanes\.mjs \(\d+\)): .*$/m, '$1: …');
/**
 * A run with all a failure needs to be read: how it ended, its output, the noted processes, the table, and its log's
 * grants (each job's turn and pass-through left out: a run has dozens).
 */
export const dump = (box, run) => redact(box, [
  `affected.mjs: ${run.limited ? `still running ${(run.limit / 1000).toFixed(0)} s after its start, so the test stopped its process group` : `exit ${run.status}${run.signal ? ` (${run.signal})` : ''} ${(run.ms / 1000).toFixed(1)} s after its start`}`,
  `stdout:\n${tail(brief(run.stdout))}`,
  `stderr:\n${tail(run.stderr, 1_000)}`,
  `noted processes:\n${noted(box).map((entry) => JSON.stringify(entry)).join('\n')}`,
  `throttle table:\n${JSON.stringify(throttleTable(box))}`,
  `throttle log, turns apart:\n${tail(throttleLog(box).filter((entry) => entry.class !== 'turn' && !['turn', 'passed'].includes(entry.event)).map((entry) => JSON.stringify(entry)).join('\n'))}`,
].join('\n'));

/**
 * What every run that reaches its bound must hold (the Scope's "ends within", criterion 1's "and 15 s more"): it ended
 * by itself, within the bound and 15 s more of its start, and it reads INCONCLUSIVE with an INCONCLUSIVE's exit, 2,
 * or, with `state` FAIL, a FAIL's, 1. `what` says what the run had before it, for the message.
 */
export function expectEnded(box, run, { state = 'INCONCLUSIVE', what }) {
  const all = () => dump(box, run);
  assert.ok(!run.limited, `affected.mjs did not end: with DEEP_AFFECTED_MIN=${BOUND_MIN} (${BOUND_MS / 1000} s) it was still running ${(run.limit / 1000).toFixed(0)} s after its start, ${what}\n${all()}`);
  // deadline: the criterion's own limit, the bound and 15 s more, from the run's start to its exit.
  assert.ok(run.ms <= END_MS, `affected.mjs ended ${(run.ms / 1000).toFixed(1)} s after its start, not within its ${BOUND_MS / 1000} s bound and 15 s more (${END_MS / 1000} s), ${what}\n${all()}`);
  assert.match(summary(run.stdout), new RegExp(`^${state} affected: `), `the run's summary doesn't read ${state}, ${what}\n${all()}`);
  assert.equal(run.status, { INCONCLUSIVE: 2, FAIL: 1 }[state], `the run exited ${run.status}${run.signal ? ` (${run.signal})` : ''}, not ${{ INCONCLUSIVE: "2, an INCONCLUSIVE's exit", FAIL: "1, a FAIL's exit" }[state]}, ${what}\n${all()}`);
}

/**
 * What the run still holds in the sandbox's table once it has ended, the `neighbours` (other sessions' throttles, by
 * PID) apart: its grants and its requests, as the table's last writer left them.
 */
export async function heldBy(box, neighbours = []) {
  const mine = () => { const { grants = [], requests = [] } = throttleTable(box); return { grants: grants.filter(({ pid }) => !neighbours.includes(pid)), requests: requests.filter(({ pid }) => !neighbours.includes(pid)) }; };
  // deadline: the table is given 5 s to show what the run's processes gave back as they ended.
  await until(() => { const now = mine(); return !now.grants.length && !now.requests.length; }, 5_000);
  return mine();
}

/** The readings the sandbox's table decides a test grant by (docs/parallel-proof.md, section 6), for every process of the box. */
export function readings(box, value) {
  const file = join(box.dir, 'readings.json');
  writeFileSync(file, JSON.stringify(value));
  box.env.DEEP_THROTTLE_READINGS = file;
}

// A preload for every node process of one run: each clock a script reads there (Date.now(), new Date(),
// performance.now(), process.hrtime() and process.hrtime.bigint()) runs SCALE times as fast, Date from a moment the
// run's processes share. Timers keep real time. So a file that takes 45 s of the test's time ran 15 minutes by the
// run's clocks (README: Criterion 6).
const CLOCK = `'use strict';
const SCALE = Number(process.env.T3567_CLOCK), ORIGIN = Number(process.env.T3567_ORIGIN);
const RealDate = Date, realNow = Date.now, realPerformance = performance.now.bind(performance), realHrtime = process.hrtime.bigint;
const now = () => Math.round(ORIGIN + (realNow() - ORIGIN) * SCALE);
function ScaledDate(...args) {
  if (!new.target) return new RealDate(now()).toString();
  return Reflect.construct(RealDate, args.length ? args : [now()], new.target);
}
Object.setPrototypeOf(ScaledDate, RealDate);
ScaledDate.prototype = RealDate.prototype;
ScaledDate.now = now;
globalThis.Date = ScaledDate;
Object.defineProperty(performance, 'now', { value: () => realPerformance() * SCALE, configurable: true, writable: true });
const zero = realHrtime();
const bigint = () => zero + BigInt(Math.round(Number(realHrtime() - zero) * SCALE));
const hrtime = (before) => {
  const ns = bigint(), at = [Number(ns / 1000000000n), Number(ns % 1000000000n)];
  if (!before) return at;
  const [seconds, nanos] = [at[0] - before[0], at[1] - before[1]];
  return nanos < 0 ? [seconds - 1, nanos + 1e9] : [seconds, nanos];
};
hrtime.bigint = bigint;
process.hrtime = hrtime;
`;
/** The environment that gives a run's node processes clocks `scale` times as fast as the test's (CLOCK, above). */
export function clock(box, scale) {
  const file = join(box.dir, 'clock.cjs');
  writeFileSync(file, CLOCK);
  return { NODE_OPTIONS: `--require=${file}`, T3567_CLOCK: String(scale), T3567_ORIGIN: String(Date.now()) };
}
