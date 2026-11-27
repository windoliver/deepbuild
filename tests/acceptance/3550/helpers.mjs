// Helpers for #3550's acceptance tests. Every throttle.mjs process gets DEEP_THROTTLE_TABLE pointed at a folder of
// the sandbox's own and a temporary HOME, with DEEP_THROTTLE, DEEP_THROTTLE_RUN, DEEP_PERF_LOCK, NODE_TEST_CONTEXT,
// DEEP_PROOF_VITEST_REPORT and DEEP_THROTTLE_READINGS unset, so the machine's ~/.deepbuild/throttle/ is never read or
// written. throttle.mjs is run as a process, never imported (README: The surface).
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const THROTTLE = join(CHECKOUT, 'scripts/throttle.mjs');
export const CLASSES = ['build', 'bay-pair', 'test', 'timed'];
// The marks a log must never hold: an argument and an environment value every stub is given, and the text the
// sandbox's failing ps prints.
export const ARGUMENT = 'argument-3550-9c4e17';
export const SECRET = 'environment-3550-b2a6f3';
export const PS_MARK = 'ps-stub-3550-error';
// The first line of a thread listing, as /bin/ps prints it: it names no thread.
const HEADER = 'USER               PID   TT   %CPU STAT PRI     STIME     UTIME COMMAND           ';

// node spin.mjs <name> <threads> [words...]: notes {name, pid, throttle} in $T3550_EVENTS, starts <threads> threads
// that each spin, and ends by itself 45 s after its start, whatever became of the test that started it. A thread that
// spins is runnable for as long as it spins, running or waiting for a core, whatever the machine's load; the process
// runs at the lowest priority, so on a busy machine it waits rather than takes a neighbour's core. With <threads> 0
// it idles until it is killed.
const SPIN = `import { appendFileSync } from 'node:fs';
import { setPriority } from 'node:os';
import { Worker, isMainThread, workerData } from 'node:worker_threads';
const LIFE_MS = 45_000;
if (isMainThread) {
  const [name, threads] = process.argv.slice(2);
  const end = Date.now() + LIFE_MS;
  appendFileSync(process.env.T3550_EVENTS, JSON.stringify({ name, pid: process.pid, throttle: process.env.DEEP_THROTTLE ?? null }) + '\\n');
  try { setPriority(19); } catch {}
  for (let k = 0; k < Number(threads); k++) new Worker(new URL(import.meta.url), { workerData: { end } });
  if (Number(threads) > 0) setTimeout(() => process.exit(0), LIFE_MS);
  else setInterval(() => {}, 60_000);
} else {
  for (;;) {
    for (let k = 0; k < 5e6; k++);
    if (Date.now() >= workerData.end) break;
  }
}
`;

/**
 * A sandbox: a table folder and a HOME of its own under the temp folder. `close` stops each process it started, by
 * the process group the process was started in, never by name, and removes the folder; with `t` it runs after the test.
 */
export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3550-')));
  const table = join(dir, 'table');
  const home = join(dir, 'home');
  mkdirSync(table);
  // The stub lives under the sandbox's HOME, so its command line carries a path under a home folder.
  mkdirSync(join(home, 'work'), { recursive: true });
  const stub = join(home, 'work', 'spin.mjs');
  writeFileSync(stub, SPIN);
  const env = { ...process.env, T3550_EVENTS: join(dir, 'events.jsonl'), T3550_SECRET: SECRET, DEEP_THROTTLE_TABLE: table, HOME: home, XDG_CACHE_HOME: join(home, '.cache') };
  for (const name of ['DEEP_THROTTLE', 'DEEP_THROTTLE_RUN', 'DEEP_PERF_LOCK', 'NODE_TEST_CONTEXT', 'DEEP_PROOF_VITEST_REPORT', 'DEEP_THROTTLE_READINGS']) delete env[name];
  const box = { dir, table, home, env, stub, children: [] };
  box.stop = () => {
    for (const child of box.children) {
      // A negative pid signals the child's own group (it was started detached); pid > 1 guards against kill(-1).
      if (Number.isInteger(child.pid) && child.pid > 1) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }
  };
  box.close = () => {
    box.stop();
    // A process killed a moment ago may still be writing: the removal is tried again.
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  };
  t?.after(box.close);
  return box;
}

/** `text` as a message may hold it: the sandbox as <sandbox>, this checkout as <checkout> and a home folder as ~. */
export const redact = (box, text) => [[box.dir, '<sandbox>'], [CHECKOUT, '<checkout>'], [userInfo().homedir, '~'], [homedir(), '~']].reduce((all, [from, to]) => all.replaceAll(from, to), String(text));

/** Starts `argv` in its own process group, its output kept; stopped with the sandbox. */
export function start(box, argv, { env = {}, label = argv.join(' ') } = {}) {
  const child = spawn(argv[0], argv.slice(1), { cwd: box.dir, env: { ...box.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let out = '';
  let stdout = '';
  child.stdout.on('data', (chunk) => { out += chunk; stdout += chunk; });
  child.stderr.on('data', (chunk) => { out += chunk; });
  // A command that can't be started says so in its output, and counts as ended.
  child.on('error', (error) => { out += `could not start: ${error.message}\n`; child.unstarted = true; });
  child.label = label;
  child.output = () => out;
  child.printed = () => stdout;
  child.done = new Promise((resolve) => child.on('close', (status) => resolve(status)));
  return child;
}
export const running = (child) => !child.unstarted && child.exitCode === null && child.signalCode === null;

/** The command of a stub, `node spin.mjs <name> <threads> --note=<ARGUMENT>`. */
const spin = (box, name, threads) => [process.execPath, box.stub, name, String(threads), `--note=${ARGUMENT}`];
/**
 * `node scripts/throttle.mjs <cls> --wait 1 -- node spin.mjs <name> <threads>`: a stub grant whose child spins
 * <threads> threads. With `inner`, the command is itself `node scripts/throttle.mjs <inner> --wait 1 -- node spin.mjs
 * ...`, a grant nested in the first.
 */
export function hold(box, name, threads, { cls = 'test', inner } = {}) {
  const command = inner ? [process.execPath, THROTTLE, inner, '--wait', '1', '--', ...spin(box, name, threads)] : spin(box, name, threads);
  return start(box, [process.execPath, THROTTLE, cls, '--wait', '1', '--', ...command], { label: name });
}
/** `node spin.mjs <name> <threads>` under no grant. */
export const loose = (box, name, threads) => start(box, spin(box, name, threads), { label: name });
/** `node scripts/throttle.mjs load [words...]`. */
export const load = (box, words = [], env = {}) => start(box, [process.execPath, THROTTLE, 'load', ...words], { env, label: `load ${words.join(' ')}`.trim() });

const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
const events = (box) => lines(box.env.T3550_EVENTS);
/** What stub `name` noted when it started: its pid and the DEEP_THROTTLE it saw. */
const noted = (box, name) => events(box).find((entry) => entry.name === name);
/** The table's own log, `<table folder>/log`. */
export const tableLog = (box) => lines(join(box.table, 'log'));
/** `load.log` in the table's folder: its text, and its lines as samples (a line that isn't JSON reads as {unparsed}). */
export const logText = (box) => (existsSync(join(box.table, 'load.log')) ? readFileSync(join(box.table, 'load.log'), 'utf8') : '');
export const samples = (box) => logText(box).split('\n').filter(Boolean).map((line) => {
  try {
    return JSON.parse(line);
  } catch {
    return { unparsed: line };
  }
});

// deadline: each caller says what its pause bounds.
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
/** Looks every `step` ms until `predicate` holds (true) or `ms` have passed (false). */
export async function until(predicate, ms, step = 100) {
  const end = Date.now() + ms;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() > end) return false;
    // deadline: one look every `step` ms until the caller's `ms` run out.
    await pause(step);
  }
}

/** Waits for stub `run` to note its start; with `cls`, the grant's ID from the DEEP_THROTTLE it saw. */
export async function begun(box, run, cls) {
  // deadline: a stub notes its start within seconds; 60 s bound a machine too busy to start it.
  await until(() => noted(box, run.label) || !running(run), 60_000);
  const note = noted(box, run.label);
  assert.ok(note, `stub ${run.label} never started\n${dump(box, run)}`);
  if (!cls) return note;
  const [, id] = String(note.throttle).match(new RegExp(`^${cls}:(\\S+)$`)) ?? [];
  assert.ok(id, `stub ${run.label} ran under no ${cls} grant: ${note.throttle}\n${dump(box, run)}`);
  return { ...note, id };
}

/**
 * A ps for `load` to find first on its PATH (section 6: its listings are run by name from the PATH). Every call is
 * handed to /bin/ps but a thread listing, one with `-M` among its options, whose words it notes and which it
 *   - `record`: hands to /bin/ps too, keeping what it printed, byte for byte, for the test to read;
 *   - `fail`: fails, printing a marked error that names a path under the sandbox's HOME;
 *   - `empty`: answers with the listing's first line alone, which names no thread.
 * Returns the PATH.
 */
export function psStub(box, mode) {
  const bin = join(box.dir, 'bin');
  const kept = join(box.dir, 'listings');
  mkdirSync(bin);
  mkdirSync(kept);
  const act = {
    record: `n=0\n[ -f '${kept}/count' ] && read n < '${kept}/count'\nn=$((n + 1))\necho "$n" > '${kept}/count'\n/bin/ps "$@" > '${kept}/'"$n"\nstatus=$?\n/bin/cat '${kept}/'"$n"\nexit $status`,
    fail: `echo '${PS_MARK}: ${box.home}/threads could not be listed' >&2\nexit 1`,
    empty: `echo '${HEADER}'\nexit 0`,
  }[mode];
  writeFileSync(join(bin, 'ps'), `#!/bin/sh\nthreads=0\nfor word in "$@"; do case "$word" in -*M*) threads=1 ;; esac; done\n[ "$threads" = 1 ] || exec /bin/ps "$@"\necho "$*" >> '${kept}/calls'\n${act}\n`);
  chmodSync(join(bin, 'ps'), 0o755);
  return `${bin}:${process.env.PATH}`;
}
/** The words of each thread listing `load` asked the sandbox's ps for. */
export const psCalls = (box) => (existsSync(join(box.dir, 'listings', 'calls')) ? readFileSync(join(box.dir, 'listings', 'calls'), 'utf8').split('\n').filter(Boolean) : []);
/** What /bin/ps printed for each thread listing the recording ps handed on, in order. */
export function psListings(box) {
  const kept = join(box.dir, 'listings');
  const count = existsSync(join(kept, 'count')) ? Number(readFileSync(join(kept, 'count'), 'utf8')) : 0;
  return Array.from({ length: count }, (_, k) => readFileSync(join(kept, String(k + 1)), 'utf8'));
}

/**
 * A thread listing (`ps -A -M -o pid=,state=`) by process: section 6 has each line a thread, ending with its
 * process's pid and the thread's state, runnable when the state starts with `R`. The first line names no thread.
 */
export function threadsOf(text) {
  const byPid = new Map();
  for (const line of text.split('\n')) {
    const [, pid, state] = line.match(/(?:^|\s)(\d+)\s+(\S+)\s*$/) ?? [];
    if (!pid) continue;
    const entry = byPid.get(Number(pid)) ?? { threads: 0, runnable: 0 };
    entry.threads += 1;
    if (state.startsWith('R')) entry.runnable += 1;
    byPid.set(Number(pid), entry);
  }
  return byPid;
}
/** The processes, threads and runnable threads `threads` (threadsOf) shows for `pids`, and for every other process. */
export function split(threads, pids) {
  const under = { procs: 0, threads: 0, runnable: 0 };
  const rest = { procs: 0, threads: 0, runnable: 0 };
  for (const [pid, entry] of threads) {
    const to = pids.includes(pid) ? under : rest;
    to.procs += 1;
    to.threads += entry.threads;
    to.runnable += entry.runnable;
  }
  return { under, rest };
}

const PS = { encoding: 'utf8', maxBuffer: 1 << 26, env: { PATH: '/bin:/usr/bin', LC_ALL: 'C' } };
/**
 * The test's own reading of the machine, by /bin/ps: every process's parent and command name (`ucomm`), and the
 * listing section 6 names, every thread's process and state.
 */
function reading() {
  const listed = spawnSync('/bin/ps', ['-A', '-o', 'pid=,ppid=,ucomm='], PS);
  if (listed.status !== 0) throw Error(`the test's own /bin/ps failed: ${listed.error?.message ?? listed.stderr}`);
  const procs = new Map();
  for (const line of listed.stdout.split('\n')) {
    const [, pid, ppid, command] = line.match(/^\s*(\d+)\s+(\d+)\s+(.*?)\s*$/) ?? [];
    if (pid) procs.set(Number(pid), { ppid: Number(ppid), command });
  }
  const threads = spawnSync('/bin/ps', ['-A', '-M', '-o', 'pid=,state='], PS);
  if (threads.status !== 0) throw Error(`the test's own /bin/ps -M failed: ${threads.error?.message ?? threads.stderr}`);
  return { procs, threads: threadsOf(threads.stdout) };
}
/** Whether `pid` is `root` or under it in `procs`. */
function under(procs, pid, root) {
  const seen = new Set();
  for (let at = pid; procs.has(at) && !seen.has(at); at = procs.get(at).ppid) {
    if (at === root) return true;
    seen.add(at);
  }
  return false;
}
/** `root` and every process under it, in one reading. */
export const tree = ({ procs }, root) => [...procs.keys()].filter((pid) => under(procs, pid, root));
/** The runnable threads one reading shows for `root`'s tree. */
export const runnable = (read, root) => split(read.threads, tree(read, root)).under.runnable;
/** The least and most of `measure` over the test's `readings`. */
export const span = (readings, measure) => {
  const values = readings.map(measure);
  return { lo: Math.min(...values), hi: Math.max(...values) };
};

/**
 * Reads the machine until each of `wants` ({pid, threads}) has shown that many runnable threads under its pid, or
 * more, in four readings running, or `ms` pass. Returns those last four: what the stubs read just before a sample.
 */
export async function warm(wants, ms) {
  const readings = [];
  // deadline: a stub's threads spin within a second of its start; `ms` bound a machine that never shows them.
  await until(() => {
    readings.push(reading());
    const last = readings.slice(-4);
    return last.length === 4 && last.every((read) => wants.every(({ pid, threads }) => runnable(read, pid) >= threads));
  }, ms, 150);
  return readings.slice(-4);
}

/**
 * Runs `load`, with `path` as its PATH, until its first sample is in the log, reading the machine with the test's own
 * listings before it starts (after `before`, warm's readings), a few times a second while it runs and once after, so
 * the sample's own listing falls between two of the test's. Returns the sample (undefined when none came within `ms`
 * or `load` ended first), the readings, and the run, stopped by its PID.
 */
export async function firstSample(box, before, path, ms = 60_000) {
  const readings = [...before, reading()];
  const run = load(box, [], { PATH: path });
  // deadline: a sample takes a second and its listings; `ms` bound a sampler that writes none.
  await until(() => {
    readings.push(reading());
    return samples(box).length > 0 || !running(run);
  }, ms, 150);
  // deadline: a sample is appended after its listings; half a second more, for one written as its process ended.
  if (!samples(box).length) await until(() => samples(box).length > 0, 500);
  readings.push(reading());
  if (running(run)) run.kill('SIGTERM');
  return { sample: samples(box)[0], readings, run };
}

/** `load --report` over `fixture`, copied to `load.log` in a sandbox's table folder: what it printed, by line. */
export async function report(t, fixture) {
  const box = sandbox(t);
  copyFileSync(new URL(`fixtures/${fixture}`, import.meta.url), join(box.table, 'load.log'));
  return reported(box);
}
/** `load --report` over the sandbox's own `load.log`: what it printed, by line. */
export async function reported(box) {
  const run = load(box, ['--report']);
  // deadline: the report is a read of one file; 60 s bound one that never ends.
  await until(() => !running(run), 60_000);
  assert.ok(!running(run), `load --report was still running after 60 s\n${redact(box, run.output())}`);
  await run.done;
  const out = redact(box, run.printed());
  return { out, lines: out.split('\n').map((line) => line.trimEnd()), all: redact(box, run.output()) };
}
/** The lines #3550 adds to the report, by kind; a line that starts as one and isn't in its form is `odd`. */
export function threadLines(lines) {
  const found = { read: [], runnable: [], held: [], top: [], odd: [] };
  lines.forEach((line, index) => {
    const read = line.match(/^threads read in (\d+) of (\d+) samples$/);
    const share = line.match(/^runnable (\S+) (\d+\.\d{2}), (\d+\.\d)%$/);
    const held = line.match(/^held (.+): (\d+) of (\d+) minutes, (\d+\.\d)%, (median load \d+\.\d{2}, cores busy \d+\.\d{2}, idle \d+\.\d{2}, under grants \d+\.\d{2}, runnable threads under grants \d+\.\d{2}, outside \d+\.\d{2})$/);
    const top = line.match(/^top commands under no grant, mean runnable threads: (.+)$/);
    if (read) found.read.push({ index, line, read: Number(read[1]), of: Number(read[2]) });
    else if (share) found.runnable.push({ index, line, name: share[1], mean: share[2], share: Number(share[3]) });
    else if (held) found.held.push({ index, line, what: held[1], minutes: Number(held[2]), of: Number(held[3]), share: Number(held[4]), rest: held[5] });
    else if (top) found.top.push({ index, line, commands: top[1].split(', ').map((entry) => ({ command: entry.slice(0, entry.lastIndexOf(' ')), mean: Number(entry.slice(entry.lastIndexOf(' ') + 1)) })) });
    else if (/^(threads read|runnable |held |top commands under no grant, mean runnable)/.test(line)) found.odd.push({ index, line });
  });
  return found;
}

export const dump = (box, ...runs) => redact(box, [
  `load.log:\n${logText(box)}`,
  `events:\n${events(box).map((event) => JSON.stringify(event)).join('\n')}`,
  `the table's log:\n${tableLog(box).map((entry) => JSON.stringify(entry)).join('\n')}`,
  `thread listings load asked the sandbox's ps for: ${JSON.stringify(psCalls(box))}`,
  ...runs.map((run) => `${run.label}: ${running(run) ? 'still running' : `exit ${run.exitCode ?? run.signalCode}`}\n${run.output()}`),
].join('\n'));
