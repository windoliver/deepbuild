// Helpers for #2869's acceptance tests: a sandbox whose every throttle.mjs process gets a temporary HOME and
// DEEP_THROTTLE_TABLE pointed at a folder of the sandbox's own (so the live ~/.deepbuild/throttle/ is never read or
// written), stub commands that note when they start, and a full disk for the waiters: a preload that makes writes into
// the table folder fail while a marker file exists (README: The full disk). Nothing here imports the code under test:
// throttle.mjs is reached by running it.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const THROTTLE = join(CHECKOUT, 'scripts/throttle.mjs');
// docs/parallel-proof.md section 6: the test class's slots, Mac and Spark (Linux).
export const TEST_SLOTS = process.platform === 'darwin' ? 2 : 6;

// A stub command: node stub.mjs <name> [exit]. It appends {name, event: 'start', t, pid, throttle} to $T2869_EVENTS,
// then holds until <sandbox>/<name>.stop appears (or exits 0 at once with `exit`).
const STUB = `import { appendFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
const [name, ...flags] = process.argv.slice(2);
appendFileSync(process.env.T2869_EVENTS, JSON.stringify({ name, event: 'start', t: Date.now(), pid: process.pid, throttle: process.env.DEEP_THROTTLE ?? null }) + '\\n');
if (flags.includes('exit')) process.exit(0);
const stop = join(dirname(process.argv[1]), name + '.stop');
setInterval(() => { if (existsSync(stop)) process.exit(0); }, 50);
`;

// The full disk, loaded with --import into a waiter's throttle.mjs only (never into its command: spawn doesn't pass
// execArgv on). While $T2869_FAULT_MARK exists, every write of data into $T2869_FAULT_DIR fails the way a full disk
// fails it: the file is created and opened, part of the data may land, and the write throws a real-shaped error
// (code, errno, syscall, message). T2869_FAULT_CODE is ENOSPC (the default), EIO, or EACCES (refused at open, nothing
// created). T2869_FAULT_SCOPE `all` fails every such write; `table` only a write whose data is a throttle table (JSON
// with "grants"), so the lock file and the log are written and the table write alone fails. Each injected failure is
// noted in $T2869_FAULT_LOG with this pid. The node:fs functions are patched on the module object and the ESM named
// exports synced, so the script's own named imports see them; removing the marker is the space coming back.
const FAULT = `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { constants } from 'node:os';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = process.env.T2869_FAULT_DIR, mark = process.env.T2869_FAULT_MARK, note = process.env.T2869_FAULT_LOG;
const code = process.env.T2869_FAULT_CODE || 'ENOSPC', scope = process.env.T2869_FAULT_SCOPE || 'all';
const real = { ...fs };
const MESSAGES = { ENOSPC: 'no space left on device', EIO: 'i/o error', EACCES: 'permission denied' };
const pathOf = (file) => typeof file === 'string' ? file : Buffer.isBuffer(file) ? file.toString() : file instanceof URL ? fileURLToPath(file) : null;
const inside = (file) => { const path = pathOf(file); if (path === null) return false; const at = resolve(path); return at === dir || at.startsWith(dir + sep); };
const full = () => real.existsSync(mark);
const text = (data) => typeof data === 'string' ? data : ArrayBuffer.isView(data) ? Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString() : String(data);
const hits = (data) => scope === 'all' || /"grants"/.test(text(data));
const fail = (syscall, path) => {
  real.appendFileSync(note, JSON.stringify({ pid: process.pid, code, syscall, path, t: Date.now() }) + '\\n');
  const message = code + ': ' + MESSAGES[code] + ', ' + syscall + (syscall === 'open' ? " '" + path + "'" : '');
  return Object.assign(new Error(message), { errno: -constants.errno[code], code, syscall, ...(syscall === 'open' ? { path } : {}) });
};
// A full disk lets the create and the open through and fails the write, after part of the data at most.
const half = (data) => { const bytes = Buffer.from(text(data)); return bytes.subarray(0, bytes.length >> 1); };
const fds = new Map();
fs.openSync = function (file, flags, ...rest) {
  const writing = typeof flags === 'number' ? (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT)) !== 0 : /[wa+]/.test(String(flags ?? 'r'));
  if (writing && inside(file) && full() && code === 'EACCES') throw fail('open', resolve(pathOf(file)));
  const fd = real.openSync(file, flags, ...rest);
  if (writing && inside(file)) fds.set(fd, resolve(pathOf(file)));
  return fd;
};
fs.closeSync = function (fd, ...rest) { fds.delete(fd); return real.closeSync(fd, ...rest); };
const writeTo = (path, data, flag) => {
  if (code === 'EACCES') throw fail('open', path);
  const fd = real.openSync(path, flag);
  try { real.writeSync(fd, half(data)); } finally { real.closeSync(fd); }
  throw fail('write', path);
};
fs.writeFileSync = function (file, data, ...rest) {
  if (typeof file === 'number' && fds.has(file) && full() && hits(data)) throw fail('write', fds.get(file));
  if (inside(file) && full() && hits(data)) writeTo(resolve(pathOf(file)), data, 'w');
  return real.writeFileSync(file, data, ...rest);
};
fs.appendFileSync = function (file, data, ...rest) {
  if (typeof file === 'number' && fds.has(file) && full() && hits(data)) throw fail('write', fds.get(file));
  if (inside(file) && full() && hits(data)) writeTo(resolve(pathOf(file)), data, 'a');
  return real.appendFileSync(file, data, ...rest);
};
fs.writeSync = function (fd, data, ...rest) {
  if (fds.has(fd) && full() && hits(data)) throw fail('write', fds.get(fd));
  return real.writeSync(fd, data, ...rest);
};
fs.writevSync = function (fd, buffers, ...rest) {
  if (fds.has(fd) && full() && hits(Buffer.concat(buffers))) throw fail('write', fds.get(fd));
  return real.writevSync(fd, buffers, ...rest);
};
fs.copyFileSync = function (from, to, ...rest) {
  if (inside(to) && full() && (scope === 'all' || hits(real.readFileSync(from)))) writeTo(resolve(pathOf(to)), real.readFileSync(from), 'w');
  return real.copyFileSync(from, to, ...rest);
};
fs.mkdtempSync = function (prefix, ...rest) {
  if (inside(prefix) && full() && scope === 'all') throw fail('mkdtemp', resolve(pathOf(prefix)));
  return real.mkdtempSync(prefix, ...rest);
};
fs.mkdirSync = function (path, ...rest) {
  if (inside(path) && full() && scope === 'all' && !real.existsSync(path)) throw fail('mkdir', resolve(pathOf(path)));
  return real.mkdirSync(path, ...rest);
};
syncBuiltinESMExports();
`;

/**
 * A sandbox removed after the test: a table folder of its own, a HOME, an events file, the full disk's preload and its
 * marker. Every process it started is stopped after the test by its process group's PID, never by name.
 */
export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2869-')));
  const table = join(dir, 'table');
  const home = join(dir, 'home');
  mkdirSync(table);
  mkdirSync(home);
  writeFileSync(join(dir, 'stub.mjs'), STUB);
  writeFileSync(join(dir, 'fault.mjs'), FAULT);
  const env = {
    ...process.env, HOME: home, XDG_CACHE_HOME: join(home, '.cache'), T2869_EVENTS: join(dir, 'events.jsonl'), DEEP_THROTTLE_TABLE: table,
    T2869_FAULT_DIR: table, T2869_FAULT_MARK: join(dir, 'disk-full'), T2869_FAULT_LOG: join(dir, 'faults.jsonl'),
  };
  for (const name of ['DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'NODE_TEST_CONTEXT', 'DEEP_PROOF_VITEST_REPORT', 'NODE_OPTIONS']) delete env[name];
  const box = { dir, table, env, stub: join(dir, 'stub.mjs'), fault: join(dir, 'fault.mjs'), mark: env.T2869_FAULT_MARK, children: [] };
  t.after(() => {
    for (const child of box.children) {
      if (Number.isInteger(child.pid) && child.pid > 1) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

/**
 * `node [--import fault.mjs] scripts/throttle.mjs <args> -- node stub.mjs <name> <flags>` in its own process group.
 * `disk` gives it the full disk: {code, scope}. `done` resolves with its status, output and end time.
 */
export function throttle(box, args, name, flags = [], { disk = null } = {}) {
  const preload = disk ? ['--import', box.fault] : [];
  const argv = [...preload, THROTTLE, ...args, '--', process.execPath, box.stub, name, ...flags];
  const env = disk ? { ...box.env, T2869_FAULT_CODE: disk.code ?? 'ENOSPC', T2869_FAULT_SCOPE: disk.scope ?? 'all' } : box.env;
  const child = spawn(process.execPath, argv, { cwd: box.dir, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.started = Date.now();
  child.label = name;
  const closed = new Promise((resolve) => child.on('close', resolve));
  child.done = new Promise((resolve) => child.on('exit', (status, signal) => {
    const ended = Date.now();
    Promise.race([closed, pause(1_000)]).then(() => resolve({ status, signal, stdout, stderr, ended }));
  }));
  child.output = () => `${stdout}${stderr}`;
  return child;
}
export const running = (child) => child.exitCode === null && child.signalCode === null;

/** The disk fills (the marker appears) or space comes back (it goes). */
export const fill = (box) => writeFileSync(box.mark, '');
export const free = (box) => rmSync(box.mark, { force: true });

/** Writes the stop file a holding stub watches for, so it exits 0 by itself. */
export const finish = (box, name) => writeFileSync(join(box.dir, `${name}.stop`), '');

const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
export const events = (box) => lines(box.env.T2869_EVENTS);
export const startOf = (box, name) => events(box).find((e) => e.name === name && e.event === 'start');
/** The failures the full disk injected into `pid`'s writes. */
export const faults = (box, pid) => lines(box.env.T2869_FAULT_LOG).filter((f) => f.pid === pid);

/** The table as last written, or null; a request is pending while its pid is among its requests. */
export function table(box) {
  try {
    return JSON.parse(readFileSync(join(box.table, 'table.json'), 'utf8'));
  } catch {
    return null;
  }
}
export const pending = (box, run) => (table(box)?.requests ?? []).some((request) => request.pid === run.pid);

/**
 * The table folder's entries that are `run`'s own: a name with its pid as a number in it, or the lock while it names
 * its pid.
 */
export function own(box, run) {
  const names = existsSync(box.table) ? readdirSync(box.table) : [];
  return names.filter((name) => {
    if (new RegExp(`(^|\\D)${run.pid}(\\D|$)`).test(name)) return true;
    if (name !== 'table.lock') return false;
    try {
      return JSON.parse(readFileSync(join(box.table, name), 'utf8')).pid === run.pid;
    } catch {
      return false;
    }
  });
}

/** Polls until `predicate` holds or `ms` pass; returns whether it held. */
export async function until(predicate, ms) {
  const end = Date.now() + ms;
  for (;;) {
    if (predicate()) return true;
    if (Date.now() > end) return false;
    await new Promise((done) => setTimeout(done, 25));
  }
}
export const pause = (ms) => new Promise((done) => setTimeout(done, ms));
/** `promise`'s value, or null once `ms` pass; the timer doesn't keep the test's process alive. */
export const within = (promise, ms) => Promise.race([promise, new Promise((done) => setTimeout(done, ms, null).unref())]);

/** Waits for `run`'s stub to start under a test grant, failing at the assertion when it doesn't within `ms`. */
export async function started(box, run, ms, ...context) {
  const name = run.label;
  await until(() => startOf(box, name) || !running(run), ms);
  await until(() => startOf(box, name), running(run) ? 0 : 500);
  assert.ok(startOf(box, name), `${name} never ran its command under the throttle (its throttle.mjs ended first, or ${ms} ms passed)\n${dump(box, run, ...context)}`);
  assert.match(String(startOf(box, name).throttle), /^test:\S+$/, `${name} ran under no test grant\n${dump(box, run, ...context)}`);
  return startOf(box, name);
}

/** Every test slot held by a stub that holds until finished: holder-1 .. holder-N. */
export async function holdAll(box) {
  const holders = Array.from({ length: TEST_SLOTS }, (_, k) => throttle(box, ['test', '--wait', '1'], `holder-${k + 1}`));
  for (const holder of holders) await started(box, holder, 60_000, ...holders);
  return holders;
}

/** Waits for `run`'s request to be in the table (it waits for a grant), failing at the assertion otherwise. */
export async function queued(box, run, ...context) {
  await until(() => pending(box, run) || !running(run), 60_000);
  assert.ok(pending(box, run), `${run.label}'s request never appeared in the table as waiting\n${dump(box, run, ...context)}`);
}

/** Keeps the disk full until each run has had `n` writes fail and at least `ms` passed; fails if they never did. */
export async function fullFor(box, runs, { n = 2, ms = 3_000 } = {}) {
  const since = Date.now();
  fill(box);
  await until(() => Date.now() - since >= ms && runs.every((run) => faults(box, run.pid).length >= n || !running(run)), 60_000);
  for (const run of runs) assert.ok(faults(box, run.pid).length >= 1, `the full disk never failed a write of ${run.label} (the harness proves nothing)\n${dump(box, ...runs)}`);
}

export const dump = (box, ...runs) => [
  `events:\n${events(box).map((e) => JSON.stringify(e)).join('\n')}`,
  `injected faults:\n${lines(box.env.T2869_FAULT_LOG).map((f) => JSON.stringify(f)).join('\n')}`,
  `table folder: ${existsSync(box.table) ? readdirSync(box.table).join(' ') : '(none)'}`,
  `table requests: ${JSON.stringify(table(box)?.requests ?? null)}`,
  ...runs.map((run) => `${run.label} (pid ${run.pid}): ${running(run) ? 'still running' : `exit ${run.exitCode}${run.signalCode ? ` (${run.signalCode})` : ''}`}\n${run.output()}`),
].join('\n');
