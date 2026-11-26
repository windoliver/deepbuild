// Helpers for #3221's acceptance tests (README). Every throttle.mjs process gets DEEP_THROTTLE_TABLE pointed at a
// folder of the sandbox's own and a temporary HOME, with DEEP_THROTTLE, DEEP_PERF_LOCK, NODE_TEST_CONTEXT,
// DEEP_PROOF_VITEST_REPORT, DEEP_THROTTLE_READINGS, DEEP_THROTTLE_RUN and the jobserver variables unset unless a test
// sets one, so the machine's ~/.deepbuild/throttle/ is never read or written. throttle.mjs is run as a process, never
// imported. A run is `DEEP_THROTTLE_RUN=<bytes> node scripts/throttle.mjs test -- node run.mjs <name> <config>`, and
// each of its jobs is `node scripts/throttle.mjs <class> [--wait <min>] -- node job.mjs <run> <k> <mode...>`.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const THROTTLE = join(CHECKOUT, 'scripts/throttle.mjs');
export const GiB = 2 ** 30;

// node run.mjs <name> <config.json>: a stub run. It notes its start with the DEEP_THROTTLE it was given (its grant), then
// starts its jobs through the throttle, at most `concurrency` at once, each as soon as the one before it has been
// started or a running one has ended, and notes its end with each job's exit. DEEP_THROTTLE_RUN is the run's own
// marker, so its jobs never carry it, whatever the throttle does with it.
const RUN = `import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
const [name, file] = process.argv.slice(2);
const config = JSON.parse(readFileSync(file, 'utf8'));
const note = (fields) => appendFileSync(process.env.T3221_EVENTS, JSON.stringify({ run: name, at: Date.now(), ...fields }) + '\\n');
note({ event: 'run-start', pid: process.pid, throttle: process.env.DEEP_THROTTLE ?? null });
const env = { ...process.env };
delete env.DEEP_THROTTLE_RUN;
const queue = config.jobs.map((job, k) => ({ ...job, k }));
const statuses = [];
let live = 0;
await new Promise((done) => {
  const next = () => {
    while (live < config.concurrency && queue.length) {
      const job = queue.shift();
      live += 1;
      const argv = [process.env.T3221_THROTTLE, job.cls ?? 'test', ...(job.wait ? ['--wait', job.wait] : []), '--', process.execPath, process.env.T3221_JOB, name, String(job.k), ...job.mode];
      const child = spawn(process.execPath, argv, { env, stdio: 'inherit' });
      note({ event: 'job-asked', job: job.k, pid: child.pid });
      child.on('close', (status, signal) => { statuses[job.k] = status ?? signal; live -= 1; next(); });
    }
    if (!live && !queue.length) done();
  };
  next();
});
note({ event: 'run-end', statuses });
process.exit(statuses.every((status) => status === 0) ? 0 : 1);
`;

// node job.mjs <run> <k> <mode> [arg]: a stub job. It notes its start, with the DEEP_THROTTLE and CARGO_MAKEFLAGS it
// was given, then: exit, sleep <s>, hold until <dir>/<run>-<k>.stop appears, or cargo <workspace> (a build of the
// planted binary there, noting its status and how many planted crates cargo compiled). It notes its end before it exits.
const JOB = `import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const [run, k, mode, arg] = process.argv.slice(2);
const note = (fields) => appendFileSync(process.env.T3221_EVENTS, JSON.stringify({ run, job: Number(k), at: Date.now(), pid: process.pid, ...fields }) + '\\n');
note({ event: 'start', throttle: process.env.DEEP_THROTTLE ?? null, makeflags: process.env.CARGO_MAKEFLAGS ?? null });
const end = (fields = {}, status = 0) => { note({ event: 'end', ...fields }); process.exit(status); };
if (mode === 'exit') end();
else if (mode === 'sleep') setTimeout(end, Number(arg) * 1000);
else if (mode === 'hold') {
  const stop = join(process.env.T3221_DIR, run + '-' + k + '.stop');
  setInterval(() => { if (existsSync(stop)) end(); }, 50);
} else if (mode === 'cargo') {
  const result = spawnSync('cargo', ['build', '--offline', '-p', 'u3221-bin'], { cwd: arg, encoding: 'utf8', maxBuffer: 1 << 26 });
  const compiled = (result.stderr ?? '').match(/^\\s*Compiling u3221-/gm)?.length ?? 0;
  end({ status: result.status, compiled, error: result.error?.message ?? null, tail: (result.stderr ?? '').trim().split('\\n').slice(-3).join('\\n') }, result.status === 0 ? 0 : 1);
} else end({ error: 'unknown mode ' + mode }, 2);
`;

const UNSET = ['DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'NODE_TEST_CONTEXT', 'DEEP_PROOF_VITEST_REPORT', 'DEEP_THROTTLE_READINGS', 'DEEP_THROTTLE_RUN', 'CARGO_MAKEFLAGS', 'MAKEFLAGS', 'MFLAGS'];

/** A sandbox removed after the test; each process it started is stopped by its own process group's PID, never by name. */
export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3221-')));
  const table = join(dir, 'table');
  const home = join(dir, 'home');
  for (const folder of [table, home, join(dir, 'tmp')]) mkdirSync(folder);
  writeFileSync(join(dir, 'run.mjs'), RUN);
  writeFileSync(join(dir, 'job.mjs'), JOB);
  const env = {
    ...process.env, HOME: home, XDG_CACHE_HOME: join(home, '.cache'), TMPDIR: join(dir, 'tmp'), DEEP_THROTTLE_TABLE: table,
    T3221_EVENTS: join(dir, 'events.jsonl'), T3221_DIR: dir, T3221_THROTTLE: THROTTLE, T3221_JOB: join(dir, 'job.mjs'),
  };
  for (const name of UNSET) delete env[name];
  const box = { dir, table, env, children: [] };
  t.after(() => {
    for (const child of box.children) {
      // A negative pid signals the child's own group (it was started detached); pid > 1 guards against kill(-1).
      if (Number.isInteger(child.pid) && child.pid > 1) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

/** The readings a test's own table decides by (section 6): written whole, and named for every process the box starts. */
export function readings(box, value) {
  const file = join(box.dir, 'readings.json');
  writeFileSync(`${file}.tmp`, JSON.stringify(value));
  renameSync(`${file}.tmp`, file);
  box.env.DEEP_THROTTLE_READINGS = file;
}

/** Starts `argv` in its own process group with the box's environment and `env` over it; its output is kept. */
export function start(box, argv, { env = {}, label = argv.join(' ') } = {}) {
  const asked = Date.now();
  const child = spawn(argv[0], argv.slice(1), { cwd: box.dir, env: { ...box.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let out = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.stderr.on('data', (chunk) => { out += chunk; });
  child.label = label;
  child.asked = asked;
  child.output = () => out;
  child.done = new Promise((resolve) => child.on('close', (status, signal) => { child.ended = Date.now(); resolve(status ?? signal); }));
  return child;
}

/**
 * A run: `DEEP_THROTTLE_RUN=<bytes> node scripts/throttle.mjs test [--wait <min>] -- node run.mjs <name> <config>`. Each
 * job is { mode: [...job.mjs words], cls, wait }; `concurrency` is how many the run keeps started at once.
 */
export function run(box, name, { jobs, concurrency = jobs.length, wait = null, bytes = '0' }) {
  const config = join(box.dir, `${name}.json`);
  writeFileSync(config, JSON.stringify({ jobs, concurrency }));
  const argv = [process.execPath, THROTTLE, 'test', ...(wait ? ['--wait', wait] : []), '--', process.execPath, join(box.dir, 'run.mjs'), name, config];
  return start(box, argv, { env: { DEEP_THROTTLE_RUN: bytes }, label: `run ${name}` });
}
export const running = (child) => child.exitCode === null && child.signalCode === null;
export const finish = (box, name) => writeFileSync(join(box.dir, `${name}.stop`), '');

const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
  try { return [JSON.parse(line)]; } catch { return []; }
}) : []);
/** What the stub runs and jobs noted, in order. */
export const events = (box) => lines(box.env.T3221_EVENTS);
/** The table's log, `<table folder>/log`. */
export const log = (box) => lines(join(box.table, 'log'));

/** A run's grant ID, from the DEEP_THROTTLE its command was given (`test:<id>`); null before it started. */
export function grantOf(box, name) {
  const started = events(box).find((e) => e.event === 'run-start' && e.run === name);
  return started?.throttle?.match(/^test:([0-9a-f]+)$/)?.[1] ?? null;
}
/** The log names a run's grant as `run`: its ID, or its `test:<id>` token. */
export const ofRun = (entry, id) => id !== null && (entry.run === id || entry.run === `test:${id}`);
/** The log's `passed` entries through a run's grant: one for each of its jobs that asked. */
export const passedThrough = (box, id) => log(box).filter((e) => e.event === 'passed' && e.through === `test:${id}`);

export const starts = (box, name) => events(box).filter((e) => e.event === 'start' && (name === undefined || e.run === name));
export const ends = (box, name) => events(box).filter((e) => e.event === 'end' && (name === undefined || e.run === name));

export async function until(predicate, ms) {
  const end = Date.now() + ms;
  for (;;) {
    if (predicate()) return true;
    if (Date.now() > end) return false;
    await pause(50);
  }
}
// deadline: each caller says why its pause bounds a wait.
export const pause = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * The most stub jobs running at once, by their own start and end notes: a job runs from its start to its end, or to
 * the last note if it never noted one. Returns the count and the moment it was reached.
 */
export function mostAtOnce(notes) {
  const last = Math.max(0, ...notes.map((e) => e.at));
  const marks = notes.filter((e) => e.event === 'start').flatMap((s) => {
    const end = notes.find((e) => e.event === 'end' && e.run === s.run && e.job === s.job);
    return [{ at: s.at, step: 1 }, { at: end?.at ?? last, step: -1 }];
  }).sort((a, b) => a.at - b.at || a.step - b.step);
  let now = 0, top = { count: 0, at: null };
  for (const mark of marks) {
    now += mark.step;
    if (now > top.count) top = { count: now, at: mark.at };
  }
  return top;
}

/** Seconds from `zero` to `at`, for a timeline a person can read. */
export const since = (zero, at) => (at === undefined || at === null ? 'never' : `+${((at - zero) / 1000).toFixed(1)} s`);

export function dump(box, ...children) {
  const tail = (text, size = 3_000) => (text.length > size ? `…${text.slice(-size)}` : text);
  return [
    `notes:\n${tail(events(box).map((e) => JSON.stringify(e)).join('\n'), 6_000)}`,
    `log:\n${tail(log(box).map((e) => JSON.stringify(e)).join('\n'), 6_000)}`,
    ...children.filter(Boolean).map((child) => `${child.label}: ${running(child) ? 'still running' : `exit ${child.exitCode ?? child.signalCode}`}\n${tail(child.output())}`),
  ].join('\n');
}

/** Asserts `child` ended within `ms`, and returns its status. */
export async function ended(child, ms, all) {
  await until(() => !running(child), ms);
  assert.ok(!running(child), `${child.label} didn't end within ${ms / 1000} s\n${all()}`);
  return child.done;
}
