// Helpers for #2744's acceptance tests: a sandbox whose every throttle.mjs process gets a temporary HOME and
// DEEP_THROTTLE_TABLE pointed at a folder of the sandbox's own (so the live ~/.deepbuild/throttle/ is never read
// or written), stub commands that note when they start, and the table's log. Nothing here imports the code under
// test: throttle.mjs is reached by running it (README: The surface).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const THROTTLE = join(CHECKOUT, 'scripts/throttle.mjs');
// Section 6's table: the Mac's test limit on macOS, the Spark's elsewhere.
export const TEST_LIMIT = process.platform === 'darwin' ? 2 : 4;

// A stub command: node stub.mjs <name> [term] [child] [exit]. It appends {name, event: 'start', t, pid, ppid,
// throttle} to $T2744_EVENTS, then holds until <sandbox>/<name>.stop appears (or exits at once with `exit`).
// `term` ignores SIGTERM, so only a SIGKILL ends it; `child` first starts a grandchild, <name>-child, that also
// ignores SIGTERM and holds, in the same process group.
const STUB = `import { spawn } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
const [name, ...flags] = process.argv.slice(2);
if (flags.includes('term')) process.on('SIGTERM', () => {});
if (flags.includes('child')) spawn(process.execPath, [process.argv[1], name + '-child', 'term'], { stdio: 'ignore' });
appendFileSync(process.env.T2744_EVENTS, JSON.stringify({ name, event: 'start', t: Date.now(), pid: process.pid, ppid: process.ppid, throttle: process.env.DEEP_THROTTLE ?? null }) + '\\n');
if (flags.includes('exit')) process.exit(0);
const stop = join(dirname(process.argv[1]), name + '.stop');
setInterval(() => { if (existsSync(stop)) process.exit(0); }, 50);
`;

/**
 * A sandbox removed after the test: a table folder of its own, HOMEs made on demand, and an events file. Every
 * process it started is stopped after the test by its process group's PID, never by name.
 */
export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2744-')));
  const table = join(dir, 'table');
  mkdirSync(table);
  writeFileSync(join(dir, 'stub.mjs'), STUB);
  const env = { ...process.env, T2744_EVENTS: join(dir, 'events.jsonl'), DEEP_THROTTLE_TABLE: table };
  for (const name of ['DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'NODE_TEST_CONTEXT', 'DEEP_PROOF_VITEST_REPORT']) delete env[name];
  let homes = 0;
  const box = {
    dir, table, env, stub: join(dir, 'stub.mjs'), children: [],
    /** A fresh temporary HOME inside the sandbox. */
    home() {
      const home = join(dir, `home-${++homes}`);
      mkdirSync(home);
      return home;
    },
  };
  box.defaultHome = box.home();
  t.after(() => {
    for (const child of box.children) {
      if (Number.isInteger(child.pid) && child.pid > 1) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

/**
 * `node scripts/throttle.mjs <args> -- node stub.mjs <name> <flags>` in its own process group, with the sandbox's
 * table and `home` (the sandbox's first HOME unless given). `done` resolves with its status, output and end time.
 */
export function throttle(box, args, name, flags = [], { home = box.defaultHome } = {}) {
  const argv = [THROTTLE, ...args, '--', process.execPath, box.stub, name, ...flags];
  const child = spawn(process.execPath, argv, { cwd: box.dir, env: { ...box.env, HOME: home, XDG_CACHE_HOME: join(home, '.cache') }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.started = Date.now();
  child.label = name;
  // Its end is its exit: a command it left running holds the output pipes open, so their close waits at most 1 s.
  const closed = new Promise((resolve) => child.on('close', resolve));
  child.done = new Promise((resolve) => child.on('exit', (status, signal) => {
    const ended = Date.now();
    Promise.race([closed, pause(1_000)]).then(() => resolve({ status, signal, stdout, stderr, ended }));
  }));
  child.output = () => `${stdout}${stderr}`;
  return child;
}
export const running = (child) => child.exitCode === null && child.signalCode === null;

/** Writes the stop file a holding stub watches for, so it exits 0 by itself. */
export const finish = (box, name) => writeFileSync(join(box.dir, `${name}.stop`), '');

export function events(box) {
  const file = box.env.T2744_EVENTS;
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
}
export const startOf = (box, name) => events(box).find((e) => e.name === name && e.event === 'start');

/** The table's log, `<table folder>/log`: one JSON object per line, each with an `event` key. */
export function log(box) {
  const file = join(box.table, 'log');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter((line) => line.trim()).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { unparsed: line };
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

/**
 * Waits for `run`'s stub to start under a grant of `cls`, failing at the assertion when it doesn't within `ms` or
 * `run` ends first; `context` is the other runs to show in the message.
 */
export async function started(box, run, cls, ms, ...context) {
  const name = run.label;
  await until(() => startOf(box, name) || !running(run), ms);
  // A run that ended may have started its stub just before.
  await until(() => startOf(box, name), running(run) ? 0 : 500);
  assert.ok(startOf(box, name), `${name} never ran its command under the throttle (its throttle.mjs ended first, or ${ms} ms passed)\n${dump(box, run, ...context)}`);
  const start = startOf(box, name);
  assert.match(String(start.throttle), new RegExp(`^${cls}:\\S+$`), `${name} ran under no ${cls} grant\n${dump(box, run, ...context)}`);
  return { ...start, id: start.throttle.slice(cls.length + 1) };
}

/** Whether a process, by PID, is gone (or a zombie no one has reaped yet, which runs nothing). */
export function gone(pid) {
  try {
    process.kill(pid, 0);
  } catch (error) {
    return error.code === 'ESRCH';
  }
  try {
    return /^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, 'utf8'));
  } catch {
    return false;
  }
}

export const dump = (box, ...runs) => [
  `events:\n${events(box).map((e) => JSON.stringify(e)).join('\n')}`,
  `log (${join(box.table, 'log')}):\n${log(box).map((e) => JSON.stringify(e)).join('\n')}`,
  ...runs.map((run) => `${run.label}: ${running(run) ? 'still running' : `exit ${run.exitCode}${run.signalCode ? ` (${run.signalCode})` : ''}`}\n${run.output()}`),
].join('\n');
