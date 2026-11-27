// Helpers for #3549's acceptance tests (README). Every process a test starts gets DEEP_THROTTLE_TABLE pointed at a
// folder of the sandbox's own, a temporary HOME and TMPDIR there, and no DEEP_ setting, NODE_TEST_CONTEXT or jobserver
// variable of the test run's unless the test sets one, so the machine's ~/.deepbuild/throttle/ is never read or
// written. scripts/throttle.mjs and scripts/lease run as processes, found from this file's own place in the tree, and
// are never imported. A request is `node scripts/throttle.mjs <class> [options] -- node stub.mjs <name> <mode>`.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const THROTTLE = join(CHECKOUT, 'scripts/throttle.mjs');
export const GiB = 2 ** 30;
const MAC = process.platform === 'darwin';
// The owner's answer (a), as drafted: a ceiling of 4 builds on the Mac and 6 on the Linux machine, and a build's
// memory at a run's, 8 GiB on the Mac and 24 GiB on the Linux machine.
export const CEILING = MAC ? 4 : 6;
export const BUILD_MEMORY = (MAC ? 8 : 24) * GiB;

// node stub.mjs <name> <mode> [arg]: a stub command. It notes its start, with the DEEP_THROTTLE and CARGO_MAKEFLAGS it
// was given and whether the jobserver those name is a named pipe, then: `exit` ends at once; `hold` ends once
// <name>.stop or all.stop appears in the sandbox; `sleep <s>` ends after <s> seconds, or at a stop file; `cargo <dir>`
// runs a real `cargo build --offline` of the planted binary there and notes its status and how many planted crates
// cargo compiled; `drive <steps.json>` starts each step's command, once <go>.go appears when the step names one, notes
// its asking and its answer, and ends at a stop file once no step runs. It notes its end before it exits.
const STUB = `import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const [name, mode, arg] = process.argv.slice(2);
const dir = process.env.T3549_DIR;
const note = (event, more = {}) => appendFileSync(join(dir, 'events.jsonl'), JSON.stringify({ name, event, at: Date.now(), pid: process.pid, ...more }) + '\\n');
const makeflags = process.env.CARGO_MAKEFLAGS ?? null;
const pipe = makeflags?.match(/--jobserver-auth=fifo:(\\S+)/)?.[1] ?? null;
let fifo = null;
try { fifo = pipe === null ? null : statSync(pipe).isFIFO(); } catch { fifo = false; }
note('start', { throttle: process.env.DEEP_THROTTLE ?? null, makeflags, fifo, window: process.env.DEEP_WINDOW ?? null });
const end = (more = {}, status = 0) => { note('end', more); process.exit(status); };
const stopped = () => existsSync(join(dir, name + '.stop')) || existsSync(join(dir, 'all.stop'));
if (mode === 'exit') end();
else if (mode === 'hold') setInterval(() => { if (stopped()) end(); }, 50);
else if (mode === 'sleep') {
  const over = Date.now() + Number(arg) * 1000;
  setInterval(() => { if (Date.now() >= over || stopped()) end({ slept: Date.now() >= over }); }, 50);
} else if (mode === 'cargo') {
  const result = spawnSync('cargo', ['build', '--offline', '-p', 'u3549-bin'], { cwd: arg, encoding: 'utf8', maxBuffer: 1 << 26 });
  const compiled = (result.stderr ?? '').match(/^\\s*Compiling u3549-/gm)?.length ?? 0;
  end({ status: result.status, compiled, error: result.error?.message ?? null, tail: (result.stderr ?? '').trim().split('\\n').slice(-3).join('\\n') }, result.status === 0 ? 0 : 1);
} else if (mode === 'drive') {
  const steps = JSON.parse(readFileSync(arg, 'utf8')).map((step, k) => ({ ...step, k, asked: false }));
  const env = { ...process.env };
  delete env.DEEP_THROTTLE_RUN;
  let live = 0;
  setInterval(() => {
    for (const step of steps) {
      if (step.asked || (step.go && !existsSync(join(dir, step.go + '.go')))) continue;
      step.asked = true;
      live += 1;
      const child = spawn(step.argv[0], step.argv.slice(1), { env: { ...env, ...step.env }, stdio: 'inherit' });
      note('asked', { step: step.k, child: child.pid ?? null });
      let over = false;
      const answer = (status) => { if (!over) { over = true; live -= 1; note('answered', { step: step.k, status }); } };
      child.on('error', (error) => answer('could not start: ' + error.message));
      child.on('exit', (status, signal) => answer(status ?? signal));
    }
    if (stopped() && !live) end();
  }, 25);
} else end({ error: 'unknown mode ' + mode }, 2);
`;

const UNSET = /^(?:DEEP_|NODE_TEST_CONTEXT$|CARGO_MAKEFLAGS$|MAKEFLAGS$|MFLAGS$)/;

/**
 * A sandbox removed after the test, with a table, a HOME and a TMPDIR of its own. With `cores` it has readings of its
 * own too (section 6), so its pool is `cores - 1` tokens. Every process it starts is in a process group of its own: at
 * the end each stub is told to stop by a file, and what is left is stopped by its group's ID, never by name or port.
 */
export function sandbox(t, { cores, memory = 1024 * GiB, load = 0 } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3549-')));
  const table = join(dir, 'table'), home = join(dir, 'home');
  for (const folder of [table, home, join(dir, 'tmp')]) mkdirSync(folder);
  writeFileSync(join(dir, 'stub.mjs'), STUB);
  writeFileSync(join(dir, 'events.jsonl'), '');
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !UNSET.test(name)));
  Object.assign(env, { HOME: home, XDG_CACHE_HOME: join(home, '.cache'), TMPDIR: join(dir, 'tmp'), DEEP_THROTTLE_TABLE: table, T3549_DIR: dir });
  const box = { dir, table, home, env, stub: join(dir, 'stub.mjs'), children: [], probes: 0 };
  if (cores !== undefined) readings(box, { memory, load, cores });
  t.after(async () => {
    try { writeFileSync(join(dir, 'all.stop'), ''); } catch {}
    // deadline: 5 s for every stub to end at its stop file, before what is left is stopped by its group's ID.
    await until(() => box.children.every((child) => !running(child)), 5_000);
    for (const child of box.children) stop(child);
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

/** The readings the sandbox's table decides by, written whole; every process started afterwards is given the file. */
export function readings(box, value) {
  const file = join(box.dir, 'readings.json');
  writeFileSync(`${file}.tmp`, JSON.stringify(value));
  renameSync(`${file}.tmp`, file);
  box.env.DEEP_THROTTLE_READINGS = file;
}

/** SIGKILL to the process group `child` leads: it was started detached; a pid above 1 guards against kill(-1). */
export function stop(child) {
  if (Number.isInteger(child.pid) && child.pid > 1) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
}

/** `argv` as a failure message names it: no folder of this machine. */
const words = (box, argv) => argv.map((word) => (word === process.execPath ? 'node' : word === THROTTLE ? 'throttle.mjs' : word === box.stub ? 'stub.mjs' : clean(box, word))).join(' ');

/** Starts `argv` in a process group of its own, with the sandbox's environment and `env` over it; its output is kept. */
export function start(box, argv, { env = {}, label = words(box, argv) } = {}) {
  const asked = Date.now();
  const child = spawn(argv[0], argv.slice(1), { cwd: box.dir, env: { ...box.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let out = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.stderr.on('data', (chunk) => { out += chunk; });
  // A request has ended once its output is closed too: `status` is its exit status or signal, `ended` the moment.
  child.on('error', (error) => { out += `could not start: ${error.message}\n`; child.status ??= 'no start'; child.ended ??= Date.now(); });
  child.on('close', (status, signal) => { child.status = status ?? signal; child.ended = Date.now(); });
  return Object.assign(child, { label, asked, output: () => out, named: `\`${label}\` (throttle pid ${child.pid})` });
}
export const running = (child) => child.ended === undefined;

/** The stub's command line. */
export const stub = (box, name, ...mode) => [process.execPath, box.stub, name, ...mode];
/** `node scripts/throttle.mjs <cls> <options...> -- <command...>`. */
export const throttle = (box, cls, options, command, extra) => start(box, [process.execPath, THROTTLE, cls, ...options, '--', ...command], extra);
/** A top-level build request: `throttle.mjs build --wait <min> -- node stub.mjs <name> <mode...>`. */
export const build = (box, name, mode = ['hold'], wait = '10') => throttle(box, 'build', ['--wait', wait], stub(box, name, ...mode));
/** A driving stub's steps file: each step is { argv, go?, env? }. */
export function steps(box, name, list) {
  const file = join(box.dir, `${name}.steps.json`);
  writeFileSync(file, JSON.stringify(list));
  return file;
}
/** Lets a holding stub end, or a driving stub's step start. */
export const finish = (box, name) => writeFileSync(join(box.dir, `${name}.stop`), '');
export const go = (box, name) => writeFileSync(join(box.dir, `${name}.go`), '');

const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
  try { return [JSON.parse(line)]; } catch { return []; }
}) : []);
/** What the stubs noted, in order. */
export const events = (box) => lines(join(box.dir, 'events.jsonl'));
export const startOf = (box, name) => events(box).find((e) => e.name === name && e.event === 'start');
export const endOf = (box, name) => events(box).find((e) => e.name === name && e.event === 'end');
/** A driving stub's note of a step: `asked` (with the child's pid) or `answered` (with its exit status). */
export const stepOf = (box, name, step, event) => events(box).find((e) => e.name === name && e.step === step && e.event === event);
/** The table's log, `<table folder>/log`, and its entry of one event for the request `child` made. */
export const log = (box) => lines(join(box.table, 'log'));
export const entryOf = (box, child, event) => log(box).find((e) => e.event === event && e.pid === child.pid);

/** `check()`'s first truthy value, looked for every 25 ms, or false once `ms` have passed. */
export async function until(check, ms) {
  const over = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > over) return false;
    // deadline: one look every 25 ms; each caller says what its wait is bounded by.
    await new Promise((done) => setTimeout(done, 25));
  }
}
/** Waits for the moment `at` on this process's clock: a schedule a criterion names. */
export const clock = (at) => until(() => Date.now() >= at, at - Date.now() + 1_000);
/** `child`'s exit status once it has ended, or null when it still runs after `ms`. */
export async function ended(child, ms) {
  await until(() => !running(child), ms);
  return running(child) ? null : child.status;
}
/** Whether `child` ended as a request that got no grant does (section 6): the INCONCLUSIVE line first, and exit 3. */
export const refused = (child) => child.status === 3 && /^INCONCLUSIVE no grant: /m.test(child.output());

/**
 * The requests in line, by the throttle's own reading (section 6, #3240): `throttle.mjs load` appends a sample to
 * load.log in the table's folder, whose `waiting` counts the table's requests in line by class. A sampler is started,
 * and with `every` another each `every` ms while fewer than four run, until a sample's `waiting` meets `want`: then
 * { at }, this clock's time on reading it. `stopped()` true ends the wait with { stopped }, and `ms` passing with {}.
 * Each sampler is stopped by its PID once a sample is in.
 */
export async function inLine(box, want, { ms = 120_000, stopped = () => false, every = 0 } = {}) {
  const file = join(box.table, 'load.log');
  const alive = [];
  let read = lines(file).length, last = 0;
  const over = Date.now() + ms;
  try {
    for (;;) {
      const why = stopped();
      if (why) return { stopped: why };
      for (const sample of lines(file).slice(read)) {
        read += 1;
        const done = alive.shift();
        if (done) stop(done);
        if (sample.waiting && want(sample.waiting)) return { at: Date.now(), waiting: sample.waiting };
      }
      if (Date.now() > over) return {};
      if (alive.length < (every ? 4 : 1) && Date.now() >= last + every) {
        alive.push(start(box, [process.execPath, THROTTLE, 'load'], { label: 'throttle.mjs load' }));
        last = Date.now();
      }
      // deadline: one look every 25 ms at the samples written, inside the caller's bound.
      await new Promise((done) => setTimeout(done, 25));
    }
  } finally {
    for (const child of alive) stop(child);
  }
}

/**
 * Whether a timed request is pending or a timed grant held on the table, read by what it does (section 6, Drain): a
 * top-level bay-pair request with a wait of 0, a class nothing here holds, is refused only then, and runs otherwise.
 */
export async function probe(box) {
  const name = `probe-${++box.probes}`;
  const child = throttle(box, 'bay-pair', ['--wait', '0'], stub(box, name, 'exit'));
  await ended(child, 120_000);
  return { child, ran: Boolean(startOf(box, name)), refused: refused(child) && !startOf(box, name) };
}
/** Probes one after another until one is refused: true; false once `halted()` is true or `ms` have passed. */
export async function drains(box, { ms = 120_000, halted = () => false } = {}) {
  const over = Date.now() + ms;
  for (;;) {
    if ((await probe(box)).refused) return true;
    if (halted() || Date.now() > over) return false;
  }
}

/**
 * A copy of the checkout's whole scripts/ folder, with nothing beside it: no built CLI for scripts/lease to find, and a
 * `budget-window.mjs` that is the stub named `window`, which `throttle.mjs window` runs. `env` is a PATH that holds
 * node and the system's tools and no `deep`.
 */
export function copyScripts(box) {
  const scripts = join(box.dir, 'copy', 'scripts'), bin = join(box.dir, 'bin');
  cpSync(join(CHECKOUT, 'scripts'), scripts, { recursive: true });
  writeFileSync(join(scripts, 'budget-window.mjs'), `process.argv.splice(2, 0, 'window', 'exit');\nawait import(${JSON.stringify(pathToFileURL(box.stub).href)});\n`);
  mkdirSync(bin);
  symlinkSync(process.execPath, join(bin, 'node'));
  const env = { PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin` };
  const found = spawnSync('/bin/sh', ['-c', 'command -v deep'], { env: { ...box.env, ...env }, encoding: 'utf8' });
  if (found.status === 0) throw Error(`BLOCKED: the sandbox's PATH finds a deep at ${found.stdout.trim()}, so scripts/lease wouldn't run under the throttle alone`);
  return { throttle: join(scripts, 'throttle.mjs'), lease: join(scripts, 'lease'), env };
}

/** `text` with this machine's folders taken out: the sandbox's HOME and the home folder read ~. */
export function clean(box, text) {
  let out = String(text);
  for (const [path, name] of [[box.home, '~'], [box.dir, '<sandbox>'], [CHECKOUT, '<checkout>'], [homedir(), '~']]) {
    if (path.length < 2) continue;
    out = out.replaceAll(`/private${path}`, name).replaceAll(path, name).replaceAll(path.replace(/^\/private/, ''), name);
  }
  return out;
}

/** Seconds from `zero` to `at`, for a timeline a person can read. */
export const since = (zero, at) => (at === undefined || at === null ? 'never' : `+${((at - zero) / 1000).toFixed(1)} s`);

/** Everything a failure message shows: the stubs' notes, the table's log, and each named process's state and output. */
export function dump(box, ...children) {
  const tail = (text, size) => (text.length > size ? `…${text.slice(-size)}` : text);
  return clean(box, [
    `notes:\n${tail(events(box).map((e) => JSON.stringify(e)).join('\n'), 6_000)}`,
    `log:\n${tail(log(box).map((e) => JSON.stringify(e)).join('\n'), 6_000)}`,
    ...children.flat().filter(Boolean).map((child) => `${child.label}: ${running(child) ? 'still running' : `exit ${child.status}`}\n${tail(child.output(), 2_000)}`),
  ].join('\n'));
}
