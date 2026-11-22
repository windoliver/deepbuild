// Helpers for #3067's acceptance tests. Every throttle.mjs process gets DEEP_THROTTLE_TABLE pointed at a folder of
// the sandbox's own and a temporary HOME, with DEEP_THROTTLE, DEEP_PERF_LOCK, NODE_TEST_CONTEXT,
// DEEP_PROOF_VITEST_REPORT and DEEP_THROTTLE_READINGS unset, so the live ~/.deepbuild/throttle/ is never read or
// written. throttle.mjs is run as a process, never imported (README: The surface).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const THROTTLE = join(CHECKOUT, 'scripts/throttle.mjs');
export const CLASSES = ['build', 'bay-pair', 'test', 'timed'];
// The marks a log must never hold: an argument and an environment value every stub is given.
export const ARGUMENT = 'argument-3067-c1f0a9';
export const SECRET = 'environment-3067-7be42d';

// node spin.mjs <name> <cores> [words...]: appends {name, pid, throttle} to $T3067_EVENTS when it starts, then uses
// <cores> cores of CPU until it is killed; with <cores> 0 it idles. On a machine whose load is far above its cores one
// spinning thread gets a fraction of a core, and how much changes by the second. So the stub is one process of 24
// threads that each spin 2 ms at a time, and only while the CPU the whole process has used (process.cpuUsage) is
// behind <cores> seconds a second; a process starved for 0.2 s of CPU starts its count again, and never bursts.
const SPIN = `import { appendFileSync } from 'node:fs';
import { Worker, isMainThread, workerData } from 'node:worker_threads';
const used = () => { const { user, system } = process.cpuUsage(); return (user + system) / 1e6; };
if (isMainThread) {
  const [name, cores] = process.argv.slice(2);
  appendFileSync(process.env.T3067_EVENTS, JSON.stringify({ name, pid: process.pid, throttle: process.env.DEEP_THROTTLE ?? null }) + '\\n');
  const line = new Float64Array(new SharedArrayBuffer(16));
  line[0] = used();
  line[1] = Date.now();
  if (Number(cores) > 0) for (let k = 0; k < 24; k++) new Worker(new URL(import.meta.url), { workerData: { want: Number(cores), line } });
  setInterval(() => {}, 1000);
} else {
  const { want, line } = workerData;
  const idle = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    const ahead = used() - (line[0] + (want * (Date.now() - line[1])) / 1000);
    if (ahead >= 0) Atomics.wait(idle, 0, 0, 2);
    else {
      if (ahead < -0.2) { line[0] = used(); line[1] = Date.now(); }
      for (const end = performance.now() + 2; performance.now() < end;);
    }
  }
}
`;

/** A sandbox removed after the test; each process it started is stopped by its own process group, never by name. */
export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3067-')));
  const table = join(dir, 'table');
  const home = join(dir, 'home');
  mkdirSync(table);
  // The stub lives under the sandbox's HOME, so its command line carries a path under a home folder.
  mkdirSync(join(home, 'work'), { recursive: true });
  const stub = join(home, 'work', 'spin.mjs');
  writeFileSync(stub, SPIN);
  const env = { ...process.env, T3067_EVENTS: join(dir, 'events.jsonl'), T3067_SECRET: SECRET, DEEP_THROTTLE_TABLE: table, HOME: home, XDG_CACHE_HOME: join(home, '.cache') };
  for (const name of ['DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'NODE_TEST_CONTEXT', 'DEEP_PROOF_VITEST_REPORT', 'DEEP_THROTTLE_READINGS']) delete env[name];
  const box = { dir, table, home, env, stub, children: [] };
  t.after(() => {
    for (const child of box.children) {
      // A negative pid signals the child's own group (it was started detached); pid > 1 guards against kill(-1).
      if (Number.isInteger(child.pid) && child.pid > 1) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

/** Starts `argv` in its own process group, its output kept; stopped with the sandbox. */
export function start(box, argv, { env = {}, label = argv.join(' ') } = {}) {
  const child = spawn(argv[0], argv.slice(1), { cwd: box.dir, env: { ...box.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let out = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.stderr.on('data', (chunk) => { out += chunk; });
  child.label = label;
  child.output = () => out;
  child.done = new Promise((resolve) => child.on('close', (status) => resolve(status)));
  return child;
}
export const running = (child) => child.exitCode === null && child.signalCode === null;

const spin = (box, name, cores) => [process.execPath, box.stub, name, String(cores), `--note=${ARGUMENT}`];
/**
 * `node scripts/throttle.mjs <cls> --wait 1 -- node spin.mjs <name> <cores>`: a stub grant whose child uses <cores>.
 * With `inner`, the command is itself `node scripts/throttle.mjs <inner> --wait 1 -- node spin.mjs ...`, a grant
 * nested in the first.
 */
export function hold(box, name, { cls = 'test', cores = 0, inner } = {}) {
  const command = inner ? [process.execPath, THROTTLE, inner, '--wait', '1', '--', ...spin(box, name, cores)] : spin(box, name, cores);
  return start(box, [process.execPath, THROTTLE, cls, '--wait', '1', '--', ...command], { label: name });
}
/** `node spin.mjs <name> <cores>` under no grant. */
export const loose = (box, name, cores) => start(box, spin(box, name, cores), { label: name });
/** `node scripts/throttle.mjs load [words...]`. */
export const load = (box, words = [], env = {}) => start(box, [process.execPath, THROTTLE, 'load', ...words], { env, label: `load ${words.join(' ')}` });

const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
export const events = (box) => lines(box.env.T3067_EVENTS);
/** What stub `name` noted when it started: its pid and the DEEP_THROTTLE it saw. */
export const startOf = (box, name) => events(box).find((event) => event.name === name);
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

export const pause = (ms) => new Promise((done) => setTimeout(done, ms));
export async function until(predicate, ms, step = 50) {
  const end = Date.now() + ms;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() > end) return false;
    await pause(step);
  }
}

/**
 * The test's own reading of the machine, the listing section 6 names: every process's pid, parent, CPU in cores
 * (`%cpu` over 100) and command name (`ucomm`), from /bin/ps.
 */
export function listing() {
  const read = spawnSync('/bin/ps', ['-A', '-o', 'pid=,ppid=,%cpu=,ucomm='], { encoding: 'utf8', maxBuffer: 1 << 26, env: { PATH: '/bin:/usr/bin', LC_ALL: 'C' } });
  if (read.status !== 0) throw Error(`the test's own /bin/ps failed: ${read.error?.message ?? read.stderr}`);
  const procs = new Map();
  for (const line of read.stdout.split('\n')) {
    const [, pid, ppid, cpu, command] = line.match(/^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(.*?)\s*$/) ?? [];
    if (pid) procs.set(Number(pid), { ppid: Number(ppid), cpu: Number(cpu) / 100, command });
  }
  return procs;
}
/** Whether `pid` is `root` or under it in `procs`. */
export function under(procs, pid, root) {
  const seen = new Set();
  for (let at = pid; procs.has(at) && !seen.has(at); at = procs.get(at).ppid) {
    if (at === root) return true;
    seen.add(at);
  }
  return false;
}
/** The CPU, in cores, of `root` and every process under it. */
export const tree = (procs, root) => [...procs].reduce((sum, [pid, proc]) => sum + (under(procs, pid, root) ? proc.cpu : 0), 0);
export const total = (procs) => [...procs.values()].reduce((sum, proc) => sum + proc.cpu, 0);
/** The least and most of `measure` over the test's `readings`. */
export const span = (readings, measure) => {
  const values = readings.map(measure);
  return { lo: Math.min(...values), hi: Math.max(...values) };
};

/**
 * Reads the machine with the test's own ps four times a second until each of `roots`' trees has read within 0.3 of
 * `cores` for 2 s, or `ms` pass. Returns those last 2 s of listings: what the trees read just before a sample.
 */
export async function warm(roots, cores, ms) {
  const end = Date.now() + ms;
  const readings = [];
  for (;;) {
    readings.push(listing());
    const last = readings.slice(-8);
    if (Date.now() > end || (last.length === 8 && last.every((procs) => roots.every((root) => Math.abs(tree(procs, root) - cores) <= 0.3)))) return last;
    await pause(250);
  }
}

/**
 * Runs `load` until its first sample, reading the machine with the test's own ps before it starts (after `before`,
 * warm's readings), four times a second while it runs and once after, so the sample's own listing falls between two
 * of the test's. Returns the
 * sample (undefined when none came within `ms` or `load` ended first), the readings, and the run, stopped by its PID.
 */
export async function firstSample(box, before = [], ms = 30_000) {
  const readings = [...before, listing()];
  const run = load(box);
  await until(() => {
    readings.push(listing());
    return samples(box).length > 0 || !running(run);
  }, ms, 250);
  // A sample is appended after its listing; a moment more, for one written as its process ended.
  if (!samples(box).length) await until(() => samples(box).length > 0, 500);
  readings.push(listing());
  if (running(run)) run.kill('SIGTERM');
  return { sample: samples(box)[0], readings, run };
}

export const dump = (box, ...runs) => [
  `load.log:\n${logText(box)}`,
  `events:\n${events(box).map((event) => JSON.stringify(event)).join('\n')}`,
  `the table's log:\n${tableLog(box).map((entry) => JSON.stringify(entry)).join('\n')}`,
  ...runs.map((run) => `${run.label}: ${running(run) ? 'still running' : `exit ${run.exitCode ?? run.signalCode}`}\n${run.output()}`),
].join('\n');
