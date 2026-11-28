import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const THROTTLE = join(CHECKOUT, 'scripts/throttle.mjs');
export const MATCHED = '3697a1c0ffee5eed';
export const UNMATCHED = '3697b2deadbeef42';
export const OUT_FOLDER = 'deps-3697-f00d';
const UNSET = ['DEEP_THROTTLE', 'DEEP_THROTTLE_RUN', 'DEEP_PERF_LOCK', 'NODE_TEST_CONTEXT', 'DEEP_PROOF_VITEST_REPORT', 'DEEP_THROTTLE_READINGS'];

const NOTE = `import { appendFileSync } from 'node:fs';
export const note = (name) => appendFileSync(process.env.T3697_EVENTS, JSON.stringify({ name, pid: process.pid, throttle: process.env.DEEP_THROTTLE ?? null }) + '\\n');
export const LIFE_MS = 45_000;
`;

const SPIN = `import { setPriority } from 'node:os';
import { Worker, isMainThread, workerData } from 'node:worker_threads';
import { note, LIFE_MS } from './note.mjs';
const used = () => { const { user, system } = process.cpuUsage(); return (user + system) / 1e6; };
if (isMainThread) {
  const [name, cores] = process.argv.slice(2);
  note(name);
  try { setPriority(19); } catch {}
  const line = new Float64Array(new SharedArrayBuffer(16));
  line[0] = used();
  line[1] = Date.now();
  const end = Date.now() + LIFE_MS;
  for (let k = 0; k < 24; k++) new Worker(new URL(import.meta.url), { workerData: { want: Number(cores), line, end } });
  setTimeout(() => process.exit(0), LIFE_MS);
} else {
  const { want, line, end } = workerData;
  const idle = new Int32Array(new SharedArrayBuffer(4));
  while (Date.now() < end) {
    const ahead = used() - (line[0] + (want * (Date.now() - line[1])) / 1000);
    if (ahead >= 0) Atomics.wait(idle, 0, 0, 2);
    else {
      if (ahead < -0.2) { line[0] = used(); line[1] = Date.now(); }
      for (const stop = performance.now() + 2; performance.now() < stop;);
    }
  }
}
`;

const IDLE = `import { note, LIFE_MS } from './note.mjs';
note(process.argv[2]);
setTimeout(() => process.exit(0), LIFE_MS);
`;

const SERVER = `import { spawn } from 'node:child_process';
import { note, LIFE_MS } from './note.mjs';
const [rustc, spin, ...children] = process.argv.slice(2);
note('server');
for (const child of children) {
  const { name, cores, metadata, outDir } = JSON.parse(child);
  spawn(rustc, [spin, name, String(cores), '--crate-name', 'x', '--edition=2021', '--error-format', 'json', '-C', 'metadata=' + metadata, '--out-dir', outDir], { stdio: 'ignore' });
}
setTimeout(() => process.exit(0), LIFE_MS);
`;

function nodeNamed(bin, name) {
  const real = realpathSync(process.execPath);
  copyFileSync(real, join(bin, name));
  const lib = join(dirname(real), '..', 'lib');
  if (!existsSync(lib)) return;
  for (const file of readdirSync(lib).filter((entry) => /^libnode.*\.dylib$/.test(entry))) {
    if (!existsSync(join(bin, file))) symlinkSync(join(lib, file), join(bin, file));
  }
}

export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3697-')));
  const table = join(dir, 'table');
  const home = join(dir, 'home');
  const work = join(home, 'work');
  const bin = join(dir, 'bin');
  const outDir = join(dir, 'target-3697', 'debug', OUT_FOLDER);
  for (const folder of [table, work, bin, outDir]) mkdirSync(folder, { recursive: true });
  writeFileSync(join(work, 'note.mjs'), NOTE);
  writeFileSync(join(work, 'spin.mjs'), SPIN);
  writeFileSync(join(work, 'idle.mjs'), IDLE);
  writeFileSync(join(work, 'server.mjs'), SERVER);
  nodeNamed(bin, 'sccache');
  nodeNamed(bin, 'rustc');
  const env = { ...process.env, T3697_EVENTS: join(dir, 'events.jsonl'), DEEP_THROTTLE_TABLE: table, HOME: home, XDG_CACHE_HOME: join(home, '.cache') };
  for (const name of UNSET) delete env[name];
  const box = { dir, table, home, work, bin, outDir, env, children: [] };
  box.stop = () => {
    for (const child of box.children) {
      if (Number.isInteger(child.pid) && child.pid > 1) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }
  };
  box.close = () => {
    box.stop();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  };
  t?.after(box.close);
  return box;
}

export const redact = (box, text) => [[box.dir, '<sandbox>'], [CHECKOUT, '<checkout>'], [userInfo().homedir, '~'], [homedir(), '~']].reduce((all, [from, to]) => all.replaceAll(from, to), String(text));

export function start(box, argv, { label = argv.join(' ') } = {}) {
  const child = spawn(argv[0], argv.slice(1), { cwd: box.dir, env: box.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let out = '';
  let stdout = '';
  child.stdout.on('data', (chunk) => { out += chunk; stdout += chunk; });
  child.stderr.on('data', (chunk) => { out += chunk; });
  child.on('error', (error) => { out += `could not start: ${error.message}\n`; child.unstarted = true; });
  child.label = label;
  child.output = () => out;
  child.printed = () => stdout;
  child.done = new Promise((resolve) => child.on('close', (status) => resolve(status)));
  return child;
}
export const running = (child) => !child.unstarted && child.exitCode === null && child.signalCode === null;

export function sccacheClient(box, metadata) {
  const client = [join(box.bin, 'sccache'), join(box.work, 'idle.mjs'), 'client', 'rustc', '--crate-name', 'x', '--edition=2021', '--error-format=json', '-C', `metadata=${metadata}`, '--out-dir', box.outDir];
  return start(box, [process.execPath, THROTTLE, 'build', '--wait', '1', '--', ...client], { label: 'client' });
}

export function sccacheServer(box, children) {
  const specs = children.map((child) => JSON.stringify({ ...child, outDir: box.outDir }));
  return start(box, [join(box.bin, 'sccache'), join(box.work, 'server.mjs'), join(box.bin, 'rustc'), join(box.work, 'spin.mjs'), ...specs], { label: 'server' });
}

export const load = (box, label = 'load') => start(box, [process.execPath, THROTTLE, 'load'], { label });

const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
const events = (box) => lines(box.env.T3697_EVENTS);
export const noted = (box, name) => events(box).find((entry) => entry.name === name);
export const tableLog = (box) => lines(join(box.table, 'log'));
export const logText = (box) => (existsSync(join(box.table, 'load.log')) ? readFileSync(join(box.table, 'load.log'), 'utf8') : '');
export const samples = (box) => logText(box).split('\n').filter(Boolean).map((line) => {
  try {
    return JSON.parse(line);
  } catch {
    return { unparsed: line };
  }
});

// deadline: each caller says what its pause bounds
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
export async function until(predicate, ms, step = 100) {
  const end = Date.now() + ms;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() > end) return false;
    // deadline: one look every `step` ms until the caller's `ms` run out
    await pause(step);
  }
}

export async function begun(box, name, run, cls) {
  // deadline: a process notes its start within seconds; 60 s bound a machine too busy to start it
  await until(() => noted(box, name) || !running(run), 60_000);
  const note = noted(box, name);
  assert.ok(note, `${name} never started\n${dump(box, run)}`);
  if (!cls) return note;
  const [, id] = String(note.throttle).match(new RegExp(`^${cls}:(\\S+)$`)) ?? [];
  assert.ok(id, `${name} ran under no ${cls} grant: ${note.throttle}\n${dump(box, run)}`);
  return { ...note, id };
}

const PS = { encoding: 'utf8', maxBuffer: 1 << 26, env: { PATH: '/bin:/usr/bin', LC_ALL: 'C' } };
export function reading() {
  const listed = spawnSync('/bin/ps', ['-A', '-o', 'pid=,ppid=,%cpu=,ucomm='], PS);
  if (listed.status !== 0) throw Error(`the test's own /bin/ps failed: ${listed.error?.message ?? listed.stderr}`);
  const procs = new Map();
  for (const line of listed.stdout.split('\n')) {
    const [, pid, ppid, cpu, command] = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(.*?)\s*$/) ?? [];
    if (pid) procs.set(Number(pid), { ppid: Number(ppid), cpu: Number(cpu) / 100, command });
  }
  return procs;
}
export function ancestry(procs, pid) {
  const seen = [];
  for (let at = pid; procs.has(at) && !seen.includes(at); at = procs.get(at).ppid) seen.push(at);
  return seen;
}
export const tree = (procs, root) => [...procs.keys()].filter((pid) => ancestry(procs, pid).includes(root));
export const cpuOf = (procs, pids) => pids.reduce((sum, pid) => sum + (procs.get(pid)?.cpu ?? 0), 0);
export const span = (readings, measure) => {
  const values = readings.map(measure);
  return { lo: Math.min(...values), hi: Math.max(...values) };
};
export const ledByMargin = (readings, pid, margin = 0.5) => readings.every((procs) => {
  const mine = procs.get(pid)?.cpu ?? 0;
  return [...procs].filter(([other]) => other !== pid).filter(([, proc]) => proc.cpu > mine - margin).length < 4;
});

export async function warm(pids, cores, ms) {
  const readings = [];
  // deadline: a spinner reaches its cores within seconds of its start; `ms` bound a machine that never gives them
  await until(() => {
    readings.push(reading());
    const last = readings.slice(-4);
    return last.length === 4 && last.every((procs) => pids.every((pid) => (procs.get(pid)?.cpu ?? 0) >= cores));
  }, ms, 250);
  return readings.slice(-4);
}

export async function firstSample(box, before, ms = 60_000) {
  const readings = [...before, reading()];
  const run = load(box);
  // deadline: a sample takes a second and its listings; `ms` bound a sampler that writes none
  await until(() => {
    readings.push(reading());
    return samples(box).length > 0 || !running(run);
  }, ms, 250);
  // deadline: half a second more, for a sample written as its process ended
  if (!samples(box).length) await until(() => samples(box).length > 0, 500);
  readings.push(reading());
  if (running(run)) run.kill('SIGTERM');
  return { sample: samples(box)[0], readings, run };
}

export const dump = (box, ...runs) => redact(box, [
  `load.log:\n${logText(box)}`,
  `events:\n${events(box).map((event) => JSON.stringify(event)).join('\n')}`,
  `the table's log:\n${tableLog(box).map((entry) => JSON.stringify(entry)).join('\n')}`,
  ...runs.map((run) => `${run.label}: ${running(run) ? 'still running' : `exit ${run.exitCode ?? run.signalCode}`}\n${run.output()}`),
].join('\n'));
