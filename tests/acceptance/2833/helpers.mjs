// Helpers for #2833's acceptance tests: a sandbox whose every throttle.mjs process gets a temporary HOME and
// DEEP_THROTTLE_TABLE pointed at a folder of the sandbox's own, so the live ~/.deepbuild/throttle/ is never read or
// written, and stub commands that note when they start. Nothing here imports the code under test: throttle.mjs is
// run as a process (README: The surface).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const THROTTLE = join(CHECKOUT, 'scripts/throttle.mjs');

// node stub.mjs <name> [exit]: appends {name, t, throttle} to $T2833_EVENTS, then holds until <sandbox>/<name>.stop
// appears (or exits at once with `exit`).
const STUB = `import { appendFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
const [name, ...flags] = process.argv.slice(2);
appendFileSync(process.env.T2833_EVENTS, JSON.stringify({ name, t: Date.now(), throttle: process.env.DEEP_THROTTLE ?? null }) + '\\n');
if (flags.includes('exit')) process.exit(0);
const stop = join(dirname(process.argv[1]), name + '.stop');
setInterval(() => { if (existsSync(stop)) process.exit(0); }, 50);
`;

/** A sandbox removed after the test; every process it started is stopped by its process group's PID, never by name. */
export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2833-')));
  const table = join(dir, 'table');
  const home = join(dir, 'home');
  mkdirSync(table);
  mkdirSync(home);
  writeFileSync(join(dir, 'stub.mjs'), STUB);
  const env = { ...process.env, T2833_EVENTS: join(dir, 'events.jsonl'), DEEP_THROTTLE_TABLE: table, HOME: home, XDG_CACHE_HOME: join(home, '.cache') };
  for (const name of ['DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'NODE_TEST_CONTEXT', 'DEEP_PROOF_VITEST_REPORT']) delete env[name];
  const box = { dir, table, env, stub: join(dir, 'stub.mjs'), children: [] };
  t.after(() => {
    for (const child of box.children) {
      if (Number.isInteger(child.pid) && child.pid > 1) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

/** `node scripts/throttle.mjs test --wait <min> -- node stub.mjs <name> <flags>` in its own process group. */
export function request(box, name, flags = [], wait = '2') {
  const child = spawn(process.execPath, [THROTTLE, 'test', '--wait', wait, '--', process.execPath, box.stub, name, ...flags], { cwd: box.dir, env: box.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let out = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.stderr.on('data', (chunk) => { out += chunk; });
  child.label = name;
  child.output = () => out;
  child.done = new Promise((resolve) => child.on('exit', (status) => resolve(status)));
  return child;
}
export const running = (child) => child.exitCode === null && child.signalCode === null;
export const finish = (box, name) => writeFileSync(join(box.dir, `${name}.stop`), '');

export function events(box) {
  const file = box.env.T2833_EVENTS;
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
}
export const startOf = (box, name) => events(box).find((e) => e.name === name);

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
  ...runs.map((run) => `${run.label}: ${running(run) ? 'still running' : `exit ${run.exitCode}`}\n${run.output()}`),
].join('\n');

/** Waits for `run`'s stub to start under a test grant, failing at the assertion when it doesn't within `ms`. */
export async function started(box, run, ms, ...others) {
  const context = others.filter((other) => other !== run);
  await until(() => startOf(box, run.label) || !running(run), ms);
  await until(() => startOf(box, run.label), running(run) ? 0 : 500);
  const start = startOf(box, run.label);
  assert.ok(start, `${run.label} never ran its command under the throttle (its throttle.mjs ended first, or ${ms} ms passed)\n${dump(box, run, ...context)}`);
  assert.match(String(start.throttle), /^test:\S+$/, `${run.label} ran under no test grant\n${dump(box, run, ...context)}`);
  return start;
}
