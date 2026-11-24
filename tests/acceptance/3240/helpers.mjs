// Helpers for #3240's acceptance tests. Every throttle.mjs process gets DEEP_THROTTLE_TABLE pointed at a folder of
// the sandbox's own and a temporary HOME, with DEEP_THROTTLE, DEEP_PERF_LOCK, NODE_TEST_CONTEXT,
// DEEP_PROOF_VITEST_REPORT and DEEP_THROTTLE_READINGS unset, so the live ~/.deepbuild/throttle/ is never read or
// written. throttle.mjs is run as a process, never imported (README: The surface).
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const THROTTLE = join(CHECKOUT, 'scripts/throttle.mjs');
export const CLASSES = ['build', 'bay-pair', 'test', 'timed'];
// The marks a log must never hold: an argument and an environment value every stub is given.
export const ARGUMENT = 'argument-3240-5e8d1b';
export const SECRET = 'environment-3240-a94c07';

// node spin.mjs <name> <cores> [words...]: notes {name, event: 'start', pid, throttle} in $T3240_EVENTS, then uses
// <cores> cores of CPU until it is killed; with <cores> 0 it idles. On a machine whose load is far above its cores one
// spinning thread gets a fraction of a core, so the stub is one process of 24 threads that each spin 2 ms at a time,
// and only while the CPU the whole process has used is behind <cores> seconds a second (as #3067's suite does it).
const SPIN = `import { appendFileSync } from 'node:fs';
import { Worker, isMainThread, workerData } from 'node:worker_threads';
const used = () => { const { user, system } = process.cpuUsage(); return (user + system) / 1e6; };
if (isMainThread) {
  const [name, cores] = process.argv.slice(2);
  appendFileSync(process.env.T3240_EVENTS, JSON.stringify({ name, event: 'start', pid: process.pid, throttle: process.env.DEEP_THROTTLE ?? null }) + '\\n');
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

// gpudraw <name> <seconds> [words...]: notes {name, event: 'start', pid, throttle} in $T3240_EVENTS, keeps the GPU
// busy with a compute kernel for <seconds> (three command buffers in flight), notes {event: 'drawn'} with the GPU time
// Metal's own timestamps give it, then idles with its device open until it is killed, so its accelerator client stays
// listed. The offline Metal compiler isn't installed, so the kernel is compiled from source as it starts.
const GPU = `import Foundation
import Metal

let args = CommandLine.arguments
let name = args[1]
let seconds = Double(args[2])!
func note(_ fields: [String: Any]) {
  guard let path = ProcessInfo.processInfo.environment["T3240_EVENTS"] else { return }
  var all = fields
  all["name"] = name
  all["pid"] = Int(getpid())
  let data = try! JSONSerialization.data(withJSONObject: all, options: [.sortedKeys])
  let file = fopen(path, "a")!
  fputs(String(data: data, encoding: .utf8)! + "\\n", file)
  fclose(file)
}
guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue() else {
  note(["event": "no-device"])
  exit(1)
}
let source = """
#include <metal_stdlib>
using namespace metal;
kernel void draw(device float *out [[buffer(0)]], uint id [[thread_position_in_grid]]) {
  float x = float(id) * 0.001f;
  for (uint k = 0; k < 16384; k++) x = fma(x, 1.000001f, 0.5f) * 0.999999f;
  out[id] = x;
}
"""
let library = try! device.makeLibrary(source: source, options: nil)
let pipeline = try! device.makeComputePipelineState(function: library.makeFunction(name: "draw")!)
let count = 1 << 20
let buffer = device.makeBuffer(length: count * 4, options: .storageModePrivate)!
note(["event": "start", "throttle": ProcessInfo.processInfo.environment["DEEP_THROTTLE"] ?? NSNull()])
var gpu = 0.0
let slots = DispatchSemaphore(value: 3)
let lock = NSLock()
let end = Date().addingTimeInterval(seconds)
while Date() < end {
  slots.wait()
  let commands = queue.makeCommandBuffer()!
  let encoder = commands.makeComputeCommandEncoder()!
  encoder.setComputePipelineState(pipeline)
  encoder.setBuffer(buffer, offset: 0, index: 0)
  encoder.dispatchThreads(MTLSize(width: count, height: 1, depth: 1), threadsPerThreadgroup: MTLSize(width: 256, height: 1, depth: 1))
  encoder.endEncoding()
  commands.addCompletedHandler { done in lock.lock(); gpu += done.gpuEndTime - done.gpuStartTime; lock.unlock(); slots.signal() }
  commands.commit()
}
for _ in 0..<3 { slots.wait() }
note(["event": "drawn", "metal": gpu])
while true { sleep(3600) }
`;

/** A sandbox removed after the test; each process it started is stopped by its own process group, never by name. */
export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3240-')));
  const table = join(dir, 'table');
  const home = join(dir, 'home');
  mkdirSync(table);
  // The stubs live under the sandbox's HOME, so their command lines carry a path under a home folder.
  mkdirSync(join(home, 'work'), { recursive: true });
  const stub = join(home, 'work', 'spin.mjs');
  writeFileSync(stub, SPIN);
  const env = { ...process.env, T3240_EVENTS: join(dir, 'events.jsonl'), T3240_SECRET: SECRET, DEEP_THROTTLE_TABLE: table, HOME: home, XDG_CACHE_HOME: join(home, '.cache') };
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

/**
 * Compiles the GPU stub to `<sandbox HOME>/work/gpudraw` with the Command Line Tools' swiftc. Its module cache is the
 * user's own, so swiftc runs with the test's environment, not the sandbox's.
 */
export function gpuStub(box) {
  const source = join(box.home, 'work', 'gpudraw.swift');
  const binary = join(box.home, 'work', 'gpudraw');
  writeFileSync(source, GPU);
  const built = spawnSync('swiftc', ['-O', source, '-o', binary], { encoding: 'utf8', timeout: 300_000 });
  if (built.status !== 0) throw Error(`BLOCKED: swiftc could not build the GPU stub (${built.error?.message ?? `exit ${built.status}`}): ${built.stderr}`);
  box.gpu = binary;
  return binary;
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

/** The command of a CPU stub, `node spin.mjs <name> <cores> --note=<ARGUMENT>`. */
export const spin = (box, name, cores) => [process.execPath, box.stub, name, String(cores), `--note=${ARGUMENT}`];
/** The command of a GPU stub, `gpudraw <name> <seconds> --note=<ARGUMENT>`; gpuStub(box) builds it first. */
export const draw = (box, name, seconds) => [box.gpu, name, String(seconds), `--note=${ARGUMENT}`];
/** `node scripts/throttle.mjs <cls> --wait <wait> -- <command>`: a stub grant, or a request that waits for one. */
export const hold = (box, name, command, { cls = 'test', wait = 1 } = {}) => start(box, [process.execPath, THROTTLE, cls, '--wait', String(wait), '--', ...command], { label: name });
/** `<command>` under no grant. */
export const loose = (box, name, command) => start(box, command, { label: name });
/** `node scripts/throttle.mjs load [words...]`. */
export const load = (box, words = [], env = {}) => start(box, [process.execPath, THROTTLE, 'load', ...words], { env, label: `load ${words.join(' ')}`.trim() });

const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
export const events = (box) => lines(box.env.T3240_EVENTS);
/** What stub `name` noted at `event` ('start' or 'drawn'): its pid, the DEEP_THROTTLE it saw, Metal's GPU time. */
export const noted = (box, name, event = 'start') => events(box).find((entry) => entry.name === name && entry.event === event);
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

/** Waits for stub `run` to note its start; with `cls`, the grant's ID from the DEEP_THROTTLE it saw. */
export async function begun(box, run, cls) {
  await until(() => noted(box, run.label) || !running(run), 60_000);
  const note = noted(box, run.label);
  assert.ok(note, `stub ${run.label} never started\n${dump(box, run)}`);
  if (!cls) return note;
  const [, id] = String(note.throttle).match(new RegExp(`^${cls}:(\\S+)$`)) ?? [];
  assert.ok(id, `stub ${run.label} ran under no ${cls} grant: ${note.throttle}\n${dump(box, run)}`);
  return { ...note, id };
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
/** The least and most of `measure` over the test's `readings`. */
export const span = (readings, measure) => {
  const values = readings.map(measure);
  return { lo: Math.min(...values), hi: Math.max(...values) };
};

/**
 * The test's own GPU reading, the listing section 6 names (`/usr/sbin/ioreg -r -l -d 2 -w 0 -c IOAccelerator`): for
 * each pid an accelerator client's `IOUserClientCreator` names, the sum of its clients' `AppUsage` entries'
 * `accumulatedGPUTime`, in nanoseconds, and the name the creator gives.
 */
export function gpuTimes() {
  const read = spawnSync('/usr/sbin/ioreg', ['-r', '-l', '-d', '2', '-w', '0', '-c', 'IOAccelerator'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (read.status !== 0) throw Error(`the test's own ioreg failed: ${read.error?.message ?? read.stderr}`);
  const byPid = new Map();
  let usage = 0;
  for (const line of read.stdout.split('\n')) {
    // Each client is an entry of its own (`+-o`); its properties follow it.
    if (line.includes('+-o ')) usage = 0;
    const [, entries] = line.match(/"AppUsage" = \((.*)\)\s*$/) ?? [];
    if (entries !== undefined) usage = [...entries.matchAll(/"accumulatedGPUTime"=(\d+)/g)].reduce((sum, [, ns]) => sum + Number(ns), 0);
    const [, pid, name] = line.match(/"IOUserClientCreator" = "pid (\d+), (.*)"\s*$/) ?? [];
    if (pid) {
      const was = byPid.get(Number(pid)) ?? { ns: 0, name };
      byPid.set(Number(pid), { ns: was.ns + usage, name });
    }
  }
  return byPid;
}
/** Each pid's GPU time between two of the test's readings, in seconds: a pid new in `after` counts whole. */
export const gpuBetween = (before, after) => new Map([...after].map(([pid, { ns, name }]) => [pid, { s: (ns - (before.get(pid)?.ns ?? 0)) / 1e9, name }]));

/**
 * Whether `pid` must be in a `gpuTop` of five: it used more than all but four other processes, each of which used
 * less than four fifths of its time, by the test's own reading `between`.
 */
export const leads = (between, pid) => [...between].filter(([at, { s }]) => at !== pid && s >= 0.8 * (between.get(pid)?.s ?? 0)).length <= 4;

/**
 * Reads the machine with the test's own ps four times a second until each of `roots`' trees has read within 0.3 of
 * `cores` for 2 s, or `ms` pass. Returns those last 2 s of listings.
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

/** Waits until load.log holds `count` samples or `run` ends, reading the machine with the test's own ps meanwhile. */
export async function sampled(box, run, count, ms, readings = []) {
  await until(() => {
    readings.push(listing());
    return samples(box).length >= count || !running(run);
  }, ms, 250);
  // A sample is appended after its listings; a moment more, for one written as its process ended.
  if (samples(box).length < count) await until(() => samples(box).length >= count, 500);
  readings.push(listing());
  return samples(box)[count - 1];
}

export const dump = (box, ...runs) => [
  `load.log:\n${logText(box)}`,
  `events:\n${events(box).map((event) => JSON.stringify(event)).join('\n')}`,
  `the table's log:\n${tableLog(box).map((entry) => JSON.stringify(entry)).join('\n')}`,
  ...runs.map((run) => `${run.label}: ${running(run) ? 'still running' : `exit ${run.exitCode ?? run.signalCode}`}\n${run.output()}`),
].join('\n');
