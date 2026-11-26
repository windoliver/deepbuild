// Helpers for #3587's blind acceptance suite: a scratch entry (a copy of scripts/, a stub scripts/checks.mjs and
// scripts/perf.mjs, a benchmarks/budgets.json with a budget of seconds), a preflight started in it on a throttle table
// of the entry's own, and what the run leaves: its output, its exit, its throttle log and table, and which of the
// processes it started are still alive.
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scripts = fileURLToPath(new URL('../../../scripts/', import.meta.url));
export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Whether process `pid` is alive, by kill(pid, 0). */
export function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/** Every process under `root` now, by ps. */
function descendants(root) {
  const listing = spawnSync('/bin/ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' });
  const children = new Map();
  for (const line of listing.stdout.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (!pid) continue;
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid).push(pid);
  }
  const found = [];
  const walk = (pid) => { for (const child of children.get(pid) ?? []) if (!found.includes(child)) { found.push(child); walk(child); } };
  walk(root);
  return found;
}

// A check that never ends, with a child that never ends; both record their pids.
export const HUNG_CHECKS = `
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
writeFileSync('pids.json', JSON.stringify({ check: process.pid, child: child.pid }));
console.log('check started');
setInterval(() => {}, 1000);
`;

/**
 * A scratch entry. `limit` is the preflight budget in ms and `margin` its margin; `lease`, when given, replaces
 * scripts/lease with that shell body. Removed after the test, once every process the test started is stopped.
 */
export function entry(t, { checks, perf = 'console.log("perf ran");', limit, margin, lease }) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3587-entry-')));
  cpSync(scripts, join(cwd, 'scripts'), { recursive: true });
  mkdirSync(join(cwd, 'benchmarks'));
  mkdirSync(join(cwd, 'home'));
  writeFileSync(join(cwd, 'scripts/checks.mjs'), checks);
  writeFileSync(join(cwd, 'scripts/perf.mjs'), perf);
  if (lease !== undefined) {
    writeFileSync(join(cwd, 'scripts/lease'), lease);
    chmodSync(join(cwd, 'scripts/lease'), 0o755);
  }
  writeFileSync(join(cwd, 'benchmarks/budgets.json'), JSON.stringify({ preflight: { margin, limits: { elapsedMs: limit }, initialReason: 'Fixture for #3587.' }, tasks: [] }));
  writeFileSync(join(cwd, 'package.json'), '{ "private": true }');
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}

/**
 * Starts the preflight in `cwd`: scripts/preflight.mjs, or with `wrapper` the scripts/preflight shell entry that
 * execs it. `detached` puts it at the head of a process group of its own, as a terminal's foreground job is. Its
 * table is the entry's own (DEEP_THROTTLE_TABLE, read inside this test run), and HOME is the entry's too. Every
 * process it starts is tracked while it runs and stopped, by PID and by its group, after the test.
 */
export function start(t, cwd, { wrapper = false, detached = true } = {}) {
  const env = { ...process.env, PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: join(cwd, 'home'), DEEP_THROTTLE_TABLE: join(cwd, 'throttle'), DEEP_LEASE_WAIT: '1' };
  for (const name of ['NODE_TEST_CONTEXT', 'DEEP_THROTTLE', 'DEEP_PREFLIGHT', 'DEEP_THROTTLE_READINGS', 'CARGO_TARGET_DIR', 'DEEP_PROOF_VITEST_REPORT']) delete env[name];
  const [command, args] = wrapper ? [join(cwd, 'scripts/preflight'), []] : [process.execPath, [join(cwd, 'scripts/preflight.mjs')]];
  const child = spawn(command, args, { cwd, env, detached, stdio: ['ignore', 'pipe', 'pipe'] });
  const run = { cwd, child, pid: child.pid, out: '', exit: null, tracked: new Set(), started: performance.now() };
  for (const stream of [child.stdout, child.stderr]) stream.setEncoding('utf8').on('data', (chunk) => { run.out += chunk; });
  run.exited = new Promise((done) => child.on('exit', (code, signal) => { run.exit = { code, signal, at: performance.now() }; done(run.exit); }));
  const look = () => { for (const pid of descendants(run.pid)) run.tracked.add(pid); };
  const watch = setInterval(look, 200);
  run.look = look;
  run.stopWatch = () => clearInterval(watch);
  run.kill = () => {
    clearInterval(watch);
    if (run.exit === null) look();
    const pids = readPids(cwd);
    for (const pid of [...run.tracked, pids.check, pids.child, run.pid]) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch {}
    if (detached) try { process.kill(-run.pid, 'SIGKILL'); } catch {}
  };
  t.after(() => run.kill());
  return run;
}

/** The pids the stub check recorded, or {} before it ran. */
export function readPids(cwd) {
  try {
    return JSON.parse(readFileSync(join(cwd, 'pids.json'), 'utf8'));
  } catch {
    return {};
  }
}

/** The throttle log of the entry's table, one object per line. */
export function throttleLog(cwd) {
  const file = join(cwd, 'throttle', 'log');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}
/** The entry's throttle table, as written. */
export function throttleTable(cwd) {
  const file = join(cwd, 'throttle', 'table.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { grants: [], requests: [] };
}

/** Waits at most `ms` for `ready()`; true once it holds. */
export async function until(ready, ms, step = 100) {
  const by = performance.now() + ms;
  for (;;) {
    if (ready()) return true;
    if (performance.now() >= by) return false;
    await sleep(step);
  }
}

/**
 * Waits for the run's timed grant on its own table, at most two minutes (a top-level timed grant waits for the load
 * to fall below the cores), and returns when this test saw it, or null.
 */
export async function timedGrant(run) {
  const granted = () => throttleLog(run.cwd).find((line) => line.event === 'granted' && line.class === 'timed');
  return (await until(() => granted() || run.exit, 120_000)) && granted() ? performance.now() : null;
}

/** Waits for the run to exit, at most until `by` (a performance.now() time); its exit, or null if it still runs. */
export async function exitBy(run, by) {
  const left = by - performance.now();
  if (run.exit) return run.exit;
  if (left <= 0) return null;
  return Promise.race([run.exited, sleep(left).then(() => null)]);
}

/** The output's lines matching `pattern`. */
export const lines = (out, pattern) => out.split('\n').filter((line) => pattern.test(line));
/** How a run's output is shown in a failure. */
export const shown = (run) => `exit ${JSON.stringify(run.exit)}; output:\n${run.out.slice(-4000)}`;
