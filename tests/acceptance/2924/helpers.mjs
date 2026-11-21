// Helpers for #2924's acceptance tests. Every throttle.mjs process gets DEEP_THROTTLE_TABLE pointed at a folder of
// the sandbox's own and a temporary HOME, with DEEP_THROTTLE, DEEP_PERF_LOCK, NODE_TEST_CONTEXT,
// DEEP_PROOF_VITEST_REPORT and DEEP_THROTTLE_READINGS unset unless a test sets one, so the live ~/.deepbuild/throttle/
// is never read or written. throttle.mjs is run as a process, never imported (README: The surface).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const THROTTLE = join(CHECKOUT, 'scripts/throttle.mjs');
export const GiB = 2 ** 30;
export const CEILING = process.platform === 'darwin' ? 2 : 6;

// node stub.mjs <name> [exit]: appends {name, throttle} to $T2924_EVENTS when it starts, then holds until
// <sandbox>/<name>.stop appears, or exits at once with `exit`.
const STUB = `import { appendFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
const [name, ...flags] = process.argv.slice(2);
appendFileSync(process.env.T2924_EVENTS, JSON.stringify({ name, throttle: process.env.DEEP_THROTTLE ?? null }) + '\\n');
if (flags.includes('exit')) process.exit(0);
const stop = join(dirname(process.argv[1]), name + '.stop');
setInterval(() => { if (existsSync(stop)) process.exit(0); }, 50);
`;

/** A sandbox removed after the test; each process it started is stopped by its own process group, never by name. */
export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2924-')));
  const table = join(dir, 'table');
  const home = join(dir, 'home');
  mkdirSync(table);
  mkdirSync(home);
  writeFileSync(join(dir, 'stub.mjs'), STUB);
  const env = { ...process.env, T2924_EVENTS: join(dir, 'events.jsonl'), DEEP_THROTTLE_TABLE: table, HOME: home, XDG_CACHE_HOME: join(home, '.cache') };
  for (const name of ['DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'NODE_TEST_CONTEXT', 'DEEP_PROOF_VITEST_REPORT', 'DEEP_THROTTLE_READINGS']) delete env[name];
  const box = { dir, table, env, stub: join(dir, 'stub.mjs'), children: [] };
  t.after(() => {
    for (const child of box.children) {
      // A negative pid signals the child's own group (it was started detached); pid > 1 guards against kill(-1).
      if (Number.isInteger(child.pid) && child.pid > 1) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

/** Writes a readings file whole (by rename, so a waiting reader never sees half of it); returns its path. */
export function readings(box, name, value) {
  const file = join(box.dir, `${name}.json`);
  writeFileSync(`${file}.tmp`, typeof value === 'string' ? value : JSON.stringify(value));
  renameSync(`${file}.tmp`, file);
  return file;
}

/**
 * `node scripts/throttle.mjs <cls> --wait <wait> -- node stub.mjs <name> [exit]`, in its own process group.
 * `env` is merged over the sandbox's (a value of undefined unsets); `prefix` wraps the command (bwrap).
 */
export function request(box, name, { cls = 'test', wait = '1', exit = false, env = {}, prefix = [] } = {}) {
  const merged = { ...box.env, ...env };
  for (const [key, value] of Object.entries(merged)) if (value === undefined) delete merged[key];
  const argv = [...prefix, process.execPath, THROTTLE, cls, '--wait', wait, '--', process.execPath, box.stub, name, ...(exit ? ['exit'] : [])];
  const child = spawn(argv[0], argv.slice(1), { cwd: box.dir, env: merged, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let out = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.stderr.on('data', (chunk) => { out += chunk; });
  child.label = name;
  child.output = () => out;
  child.done = new Promise((resolve) => child.on('close', (status) => resolve(status)));
  return child;
}
export const running = (child) => child.exitCode === null && child.signalCode === null;
export const finish = (box, name) => writeFileSync(join(box.dir, `${name}.stop`), '');

export function events(box) {
  const file = box.env.T2924_EVENTS;
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
}
export const startOf = (box, name) => events(box).find((e) => e.name === name);

/** The table's log, `<table folder>/log`, as JSON lines. */
export function log(box) {
  const file = join(box.table, 'log');
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
}

export async function until(predicate, ms) {
  const end = Date.now() + ms;
  for (;;) {
    if (predicate()) return true;
    if (Date.now() > end) return false;
    await pause(25);
  }
}
export const pause = (ms) => new Promise((done) => setTimeout(done, ms));

export const dump = (box, ...runs) => [
  `events:\n${events(box).map((e) => JSON.stringify(e)).join('\n')}`,
  `log:\n${log(box).map((e) => JSON.stringify(e)).join('\n')}`,
  ...runs.map((run) => `${run.label}: ${running(run) ? 'still running' : `exit ${run.exitCode}`}\n${run.output()}`),
].join('\n');

/** Waits for `run`'s stub to start under a grant of `cls`, failing when it doesn't within `ms`. */
export async function started(box, run, ms, others = [], cls = 'test') {
  await until(() => startOf(box, run.label) || !running(run), ms);
  await until(() => startOf(box, run.label), running(run) ? 0 : 500);
  const start = startOf(box, run.label);
  assert.ok(start, `${run.label} never ran its command under the throttle (its throttle.mjs ended first, or ${ms} ms passed)\n${dump(box, run, ...others)}`);
  assert.match(String(start.throttle), new RegExp(`^${cls}:\\S+$`), `${run.label} ran under no ${cls} grant\n${dump(box, run, ...others)}`);
  return start;
}

/** Asserts that `run` is still waiting `ms` later, its command not started. */
export async function waits(box, run, ms, others = [], why = '') {
  await pause(ms);
  assert.equal(startOf(box, run.label), undefined, `${run.label}'s command started ${why}\n${dump(box, run, ...others)}`);
  assert.ok(running(run), `${run.label} ended instead of waiting ${why}\n${dump(box, run, ...others)}`);
}
