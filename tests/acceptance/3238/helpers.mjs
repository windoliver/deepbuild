// Helpers for #3238's acceptance tests (README): a sandbox whose every process gets a temporary HOME, a PATH with
// `node` and no `deep`, and DEEP_THROTTLE_TABLE pointed at a table folder of the sandbox's own, so the machine's
// ~/.deepbuild/throttle/ is never read or written; a copy of the whole scripts/ folder (no packages/ beside it, so no
// built CLI); stub commands that note their start, the DEEP_THROTTLE they see and their end; and waits on events (the
// sandbox's files changing, a child's output or exit), each bounded by one deadline. Nothing here imports the code
// under test: scripts/lease and scripts/throttle.mjs are run as processes.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, watch, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
// docs/parallel-proof.md sections 6 and 13: build is 1 on the Mac and 2 on the Spark (Linux).
export const BUILD_SLOTS = process.platform === 'darwin' ? 1 : 2;

// The criterion IDs, as scripts/proof-change.mjs computes them from the issue's `- [ ]` lines.
export const AC1 = '#3238.52168c75';
export const AC2 = '#3238.664c776d';
export const AC3 = '#3238.4febe21a';
export const AC4 = '#3238.f2323033';
export const AC6 = '#3238.b9ec371a';

// A stub command: node stub.mjs <name> [exit]. It appends {name, event: 'start', at, pid, ppid, throttle} to
// $T3238_DIR/events.jsonl and prints `started <name>`; then it holds until <name>.stop or all.stop appears in $T3238_DIR
// (or at once with `exit`), notes {event: 'end'} and exits 0.
const STUB = `import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const [name, mode] = process.argv.slice(2);
const dir = process.env.T3238_DIR;
const note = (event) => appendFileSync(join(dir, 'events.jsonl'), JSON.stringify({ name, event, at: Date.now(), pid: process.pid, ppid: process.ppid, throttle: process.env.DEEP_THROTTLE ?? null }) + '\\n');
note('start');
process.stdout.write('started ' + name + '\\n');
const end = () => { note('end'); process.exit(0); };
if (mode === 'exit') end();
setInterval(() => { if (existsSync(join(dir, name + '.stop')) || existsSync(join(dir, 'all.stop'))) end(); }, 50);
`;

/** The test's environment less every DEEP_ setting, a test runner's own and an agent's markers, with `extra` on top. */
function cleanEnv(extra) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|CLAUDE|CODEX|NODE_TEST_CONTEXT$|NODE_OPTIONS$|GIT_)/.test(key)) continue;
    env[key] = value;
  }
  return { ...env, ...extra };
}

/**
 * A sandbox removed after the test: a HOME, a table folder, a bin folder holding only `node`, the stub and its events
 * file. Every process it starts is in a process group of its own, stopped after the test by that group's ID, and every
 * stub it noted is stopped by its PID; nothing by name or port.
 */
export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3238-')));
  const home = join(dir, 'home'), table = join(dir, 'table'), bin = join(dir, 'bin');
  for (const folder of [home, table, bin]) mkdirSync(folder);
  symlinkSync(process.execPath, join(bin, 'node'));
  writeFileSync(join(dir, 'stub.mjs'), STUB);
  writeFileSync(join(dir, 'events.jsonl'), '');
  const env = cleanEnv({ HOME: home, PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`, DEEP_THROTTLE_TABLE: table, T3238_DIR: dir });
  const box = { dir, home, table, env, stub: join(dir, 'stub.mjs'), scripts: null, children: [], looks: new Set() };
  t.after(() => stopAll(box));
  return box;
}

/**
 * A copy of the checkout's whole scripts/ folder at <sandbox>/checkout/scripts, with no packages/ beside it, so the
 * script finds no built CLI; returns the copy's `lease`. The sandbox's PATH must find no `deep` (else BLOCKED).
 */
export function copyScripts(box) {
  const scripts = join(box.dir, 'checkout', 'scripts');
  cpSync(join(CHECKOUT, 'scripts'), scripts, { recursive: true });
  box.scripts = scripts;
  const found = spawnSync('/bin/sh', ['-c', 'command -v deep'], { env: box.env, encoding: 'utf8' });
  if (found.status === 0) throw Error(`BLOCKED: the sandbox's PATH finds a deep at ${found.stdout.trim()}`);
  if (existsSync(join(box.dir, 'checkout', 'packages'))) throw Error('BLOCKED: the copy has a packages/ folder');
  return join(scripts, 'lease');
}

/** `argv` in a process group of its own, with the sandbox's environment and `extra`; `done` resolves at its close. */
export function start(box, argv, label, extra = {}) {
  const child = spawn(argv[0], argv.slice(1), { cwd: box.dir, env: { ...box.env, ...extra }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  child.label = label;
  child.command = argv.join(' ');
  let stdout = '', stderr = '';
  const look = () => { for (const each of box.looks) each(); };
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; look(); });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; look(); });
  child.done = new Promise((resolve) => child.on('close', (status, signal) => { look(); resolve({ status, signal, stdout, stderr }); }));
  child.on('exit', look);
  child.output = () => `${stdout}${stderr}`;
  return child;
}
export const running = (child) => child.exitCode === null && child.signalCode === null;

/**
 * Resolves with `check()`'s first truthy value, looked at whenever a file of the sandbox or its table changes or a
 * child prints or ends, or with its value at the deadline (falsy when it never held).
 */
export function when(box, check, ms) {
  return new Promise((resolve) => {
    let over = false, timer;
    const watchers = [];
    const finish = (value) => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      for (const watcher of watchers) watcher.close();
      box.looks.delete(look);
      resolve(value);
    };
    const look = () => {
      if (over) return;
      const value = check();
      if (value) finish(value);
    };
    for (const folder of [box.dir, box.table]) watchers.push(watch(folder, look));
    box.looks.add(look);
    // deadline: bounds the wait for an event, so a program that never gets there fails the test instead of hanging it
    timer = setTimeout(() => finish(check()), ms);
    look();
  });
}
/** `promise`'s value, or null once `ms` pass. */
export function within(promise, ms) {
  let timer;
  // deadline: bounds the wait for a process to end, so one that never does fails the test instead of hanging it
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

const lines = (file) => {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
};
export const events = (box) => lines(join(box.dir, 'events.jsonl'));
export const starts = (box, name) => events(box).filter((e) => e.name === name && e.event === 'start');
export const startOf = (box, name) => starts(box, name)[0];
export const endOf = (box, name) => events(box).find((e) => e.name === name && e.event === 'end');
/** The throttle's log in the sandbox's table folder. */
export const log = (box) => lines(join(box.table, 'log'));
/** The table as last written, or null. */
export function table(box) {
  try {
    return JSON.parse(readFileSync(join(box.table, 'table.json'), 'utf8'));
  } catch {
    return null;
  }
}
/** Writes the stop file a holding stub watches for, so it ends by itself. */
export const finish = (box, name) => writeFileSync(join(box.dir, `${name}.stop`), '');

/** `n` stubs holder-1 .. holder-n, each holding a build grant through the copy's throttle.mjs; their grant IDs. */
export async function holdBuild(box, n) {
  const names = Array.from({ length: n }, (_, k) => `holder-${k + 1}`);
  const holders = names.map((name) => start(box, [process.execPath, join(box.scripts, 'throttle.mjs'), 'build', '--wait', '1', '--', 'node', box.stub, name], name));
  const held = await when(box, () => names.every((name) => startOf(box, name)) || holders.some((holder) => !running(holder)) || null, 120_000);
  assert.ok(held && names.every((name) => /^build:/.test(String(startOf(box, name)?.throttle))), `the build holders didn't all start under a build grant\n${dump(box, ...holders)}`);
  return names.map((name) => startOf(box, name).throttle.slice('build:'.length));
}

/** Everything a failure message shows: the stubs' notes, the table, the throttle's log and each run's output. */
export const dump = (box, ...runs) => [
  `events:\n${events(box).map((e) => JSON.stringify(e)).join('\n')}`,
  `table: ${JSON.stringify(table(box))}`,
  `the throttle's log:\n${log(box).map((e) => JSON.stringify(e)).join('\n')}`,
  ...runs.map((run) => `${run.label} (\`${run.command}\`, pid ${run.pid}): ${running(run) ? 'still running' : `exit ${run.exitCode}${run.signalCode ? ` (${run.signalCode})` : ''}`}\n${run.output()}`),
].join('\n');

/** Every stub told to stop, then every process group the sandbox started and every stub still listed killed, by ID. */
async function stopAll(box) {
  try { writeFileSync(join(box.dir, 'all.stop'), ''); } catch {}
  await within(Promise.all(box.children.map((child) => child.done)), 10_000);
  for (const child of box.children) if (Number.isInteger(child.pid) && child.pid > 1) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  const ended = new Set(events(box).filter((e) => e.event === 'end').map((e) => e.pid));
  for (const e of events(box)) if (e.event === 'start' && !ended.has(e.pid) && e.pid > 1) try { process.kill(e.pid, 'SIGKILL'); } catch {}
  rmSync(box.dir, { recursive: true, force: true });
}
