// Shared test-side tools for #2650's benchmark tests (AC1, AC2, AC6): the criterion IDs, temp homes, the churn
// benchmark as a process, its one JSON line and its words, the record its cycles left (read through the hub's
// events.read), and the reference-Mac gate. The benchmark is reached only as `node benchmarks/hub-churn.mjs`; the
// README says what it has to meet. The host's and the runner's tests have their own worlds: host.ts and runner.ts.
//
// Safety: every home is under /tmp/dh2650-* (a Unix socket path must fit in 104 bytes on macOS); the benchmark gets no
// agent markers, billing keys or DEEP_* settings of this process; cleanup stops by PID only what still holds a test's
// temp home (lsof +D), never by name or port.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

// Each ID is `#2650.` and the first 8 hex digits of the SHA-256 of the criterion's text, trimmed and white space
// collapsed (scripts/proof-change.mjs, criterionId).
export const AC1 = 'AC1 #2650.20a03964';
export const AC2 = 'AC2 #2650.d1b5373c';
export const AC3 = 'AC3 #2650.59fe85c2';
export const AC4 = 'AC4 #2650.4fd94bca';
export const AC5 = 'AC5 #2650.c258f1dd';
export const AC6 = 'AC6 #2650.324460fd';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const BENCH_PATH = 'benchmarks/hub-churn.mjs';
const BENCH = join(REPO, BENCH_PATH);
const CLI = join(REPO, 'packages/cli/dist/main.js');
const NODE = process.execPath;
export const MINUTE = 60_000;

/** The issue's limit over 5,000 cycles, in bytes (1 MB = 10^6 bytes), and so per 1,000 cycles. */
export const HEAP_LIMIT = 1_000_000;
export const HEAP_LIMIT_PER_1000 = HEAP_LIMIT / 5;
/** The four stores, by the keys the benchmark's `stores` reading names them (the issue's first comment). */
export const STORES = ['answers', 'results', 'jobs', 'names'] as const;
export type Store = (typeof STORES)[number];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function makeHome(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh2650-'));
  made.push(dir);
  const home = join(dir, 'h');
  mkdirSync(home);
  return home;
}
/** The PIDs with a file open under a folder. Only this suite's benchmark, its hub and their children touch a test's home. */
function holders(folder: string): number[] {
  const lsof = existsSync('/usr/sbin/lsof') ? '/usr/sbin/lsof' : 'lsof';
  let out = '';
  try {
    out = execFileSync(lsof, ['-t', '+D', folder], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (error) {
    // lsof exits 1 when nothing holds the folder; anything else means it couldn't look.
    const e = error as NodeJS.ErrnoException & { stdout?: string };
    if (e.code === 'ENOENT') throw Error(`BLOCKED: no lsof to see what holds ${folder}`);
    out = e.stdout ?? '';
  }
  return out.split('\n').map(Number).filter((pid) => Number.isInteger(pid) && pid > 0);
}
const alive = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};
/** Stops by PID whatever this suite started and still holds its temp homes, and removes them. */
export async function cleanup(): Promise<void> {
  for (const dir of made.splice(0)) {
    const pids = holders(dir).filter((pid) => pid !== process.pid);
    for (const pid of pids) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
    const deadline = Date.now() + 5000;
    while (pids.some(alive) && Date.now() < deadline) await sleep(50);
    for (const pid of pids) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
    rmSync(dir, { recursive: true, force: true });
  }
}

/** This environment with HOME moved to the test's home, and no agent markers, billing keys or DEEP_ settings. */
function childEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|CLAUDE|ANTHROPIC|OPENAI|CODEX|XDG_|AI_AGENT)/.test(key) || key === 'NODE_OPTIONS') continue;
    env[key] = value;
  }
  return { ...env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, ...extra };
}

// ---- The benchmark (README, The surface under test).
export interface Reading { cycle: number; heapBytes: number; rssBytes: number }
export interface Line {
  bench: string; cycles: number; warmup: number; every: number; readings: Reading[];
  heapGrowthBytes: number; rssGrowthBytes: number; heapGrowthPer1000Bytes: number; rssGrowthPer1000Bytes: number;
  /** Each store's growth per 1,000 cycles, in bytes, by its key (README, Readings). */
  stores?: Record<string, number>;
  mergeBase?: { commit: string; heapGrowthPer1000Bytes?: number; rssGrowthPer1000Bytes?: number; initial?: string; stores?: Record<string, number> };
}
export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; home: string; line: Line | undefined; words: string }

/** Runs `node benchmarks/hub-churn.mjs` with a temp home, `DEEP_HUB_PLANT` when a plant is named. */
export function bench(o: { cycles?: number; plant?: string; args?: string[]; timeoutMs?: number } = {}): Promise<Ran> {
  expect(existsSync(BENCH), `${BENCH_PATH} exists: the churn benchmark (#824)`).toBe(true);
  const home = makeHome();
  const args = [BENCH, '--home', home, ...(o.cycles === undefined ? [] : ['--cycles', String(o.cycles)]), ...(o.args ?? [])];
  return new Promise((resolve) => {
    const child = spawn(NODE, args, { cwd: REPO, env: childEnv(home, o.plant ? { DEEP_HUB_PLANT: o.plant } : {}), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), o.timeoutMs ?? 60 * MINUTE);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, home, line: lineOf(stdout), words: `${stdout}\n${stderr}` });
    });
  });
}
function lineOf(stdout: string): Line | undefined {
  for (const text of stdout.split('\n').reverse()) {
    if (!text.startsWith('{')) continue;
    try {
      const value = JSON.parse(text) as Line;
      if (value.bench === 'hub-churn') return value;
    } catch { /* not its line */ }
  }
  return undefined;
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` ${r.signal}` : ''}; stdout: ${r.stdout.slice(-1500)}; stderr: ${r.stderr.slice(-1500)}`;
export const lineFrom = (r: Ran): Line => {
  expect(r.line, `the benchmark prints its readings as one JSON line with "bench": "hub-churn": ${shown(r)}`).toBeDefined();
  return r.line!;
};
/** Every line of the benchmark's output that starts with this word, as scripts/preflight.mjs prints them. */
export const worded = (r: Ran, word: 'FAIL' | 'BLOCKED' | 'PASS') => r.words.split('\n').filter((l) => new RegExp(`^${word}\\b`).test(l));

/** A size in a line of words, in bytes: "1.2 MB", "1,024 KB", "850 bytes". Every one it names. */
export function sizesNamed(text: string): number[] {
  const units: Record<string, number> = { b: 1, byte: 1, bytes: 1, kb: 1e3, kib: 1024, mb: 1e6, mib: 2 ** 20, gb: 1e9, gib: 2 ** 30 };
  return [...text.matchAll(/(-?\d[\d,]*(?:\.\d+)?)\s*(bytes?|gib|gb|mib|mb|kib|kb|b)\b/gi)].map((m) => Number(m[1]!.replace(/,/g, '')) * units[m[2]!.toLowerCase()]!);
}
/** Whether a size named is the reading's own, within 15%, as #824's suite reads a growth named in words. */
export const near = (named: number, reading: number): boolean => Math.abs(named - reading) <= Math.max(Math.abs(reading) * 0.15, 1);

/** The store whose growth per 1,000 cycles is the largest, by its key. */
export function grewMost(stores: Record<string, number>): string {
  return Object.entries(stores).sort((a, b) => b[1] - a[1])[0]![0];
}
/** A reading's `stores`: exactly the four keys, each a number of bytes per 1,000 cycles. */
export function storesOf(given: Record<string, number> | undefined, side = 'the reading'): Record<Store, number> {
  const stores = given ?? {};
  expect(Object.keys(stores).sort(), `${side} names each store's growth per 1,000 cycles, keyed answers, results, jobs and names: ${JSON.stringify(given)}`).toEqual([...STORES].sort());
  for (const key of STORES) expect(Number.isFinite(stores[key]), `${side}'s ${key} is a number of bytes per 1,000 cycles: ${JSON.stringify(stores)}`).toBe(true);
  return stores as Record<Store, number>;
}

// ---- AC2: a planted store's run (README, Wrong programs).
/** Cycles after warm-up in each planted run: each plant must fail the benchmark at this count. */
export const PLANTED_CYCLES = 100;
/**
 * The planted hub runs the benchmark: it fails, exit non-zero, and its FAIL on heap growth names the cycle count, the
 * growth and, by its key, the store that grew most with its growth; that store is the planted one, by the reading's
 * own numbers, and its growth per 1,000 cycles is at least `floor`.
 */
export async function plantedFails(plant: string, key: Store, floor: number): Promise<void> {
  const r = await bench({ cycles: PLANTED_CYCLES, plant });
  const line = lineFrom(r);
  const stores = storesOf(line.stores);
  console.log(`#2650 ${plant}: heap ${line.heapGrowthBytes} B over ${PLANTED_CYCLES} cycles, ${line.heapGrowthPer1000Bytes} B per 1,000; stores per 1,000 ${JSON.stringify(stores)}`);
  expect(r.code, `a planted hub fails the benchmark, exit non-zero: ${shown(r)}`).not.toBe(0);
  expect(worded(r, 'BLOCKED'), 'a planted run is measured, never BLOCKED').toEqual([]);
  expect(line.heapGrowthPer1000Bytes, `the hub's retained heap grows past the limit per 1,000 cycles: ${shown(r)}`).toBeGreaterThanOrEqual(HEAP_LIMIT_PER_1000);
  expect(grewMost(stores), `the store that grew most is the planted one, by the reading's numbers: ${JSON.stringify(stores)}`).toBe(key);
  expect(stores[key], `${plant} keeps what it names: ${key} grows at least ${floor} bytes per 1,000 cycles`).toBeGreaterThanOrEqual(floor);
  const fails = worded(r, 'FAIL');
  const fail = fails.find((l) => new RegExp(`\\b${key}\\b`).test(l));
  expect(fail, `a FAIL line on heap growth names the store that grew most by its key, ${key}: ${fails.join(' | ') || shown(r)}`).toBeDefined();
  expect(fail, 'the line names the cycle count').toMatch(new RegExp(`\\b${PLANTED_CYCLES} cycles\\b`));
  const named = sizesNamed(fail!);
  const heap = [line.heapGrowthBytes, line.heapGrowthPer1000Bytes];
  expect(named.some((n) => heap.some((g) => near(n, g))), `the line names the heap's growth it read, ${JSON.stringify(heap)}: ${fail}`).toBe(true);
  const store = [stores[key], (stores[key] * PLANTED_CYCLES) / 1000];
  expect(named.some((n) => store.some((g) => near(n, g))), `the line names ${key}'s growth it read, ${JSON.stringify(store)}: ${fail}`).toBe(true);
}

// ---- The record the cycles left, read through the hub's socket on the benchmark's home.
export interface RecordedEvent { kind: string; log_pos: number; data: Record<string, unknown> }
/** `deep hub run` on the home, the events of these kinds through `events.read` as the app, and the hub stopped by its PID. */
export async function recorded(home: string, kinds: string[]): Promise<RecordedEvent[]> {
  const hub = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(home), stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  hub.stderr.setEncoding('utf8').on('data', (d: string) => { stderr = (stderr + d).slice(-4000); });
  const exited = new Promise((resolve) => hub.on('exit', resolve));
  const socket = join(home, '.deepbuild', 'hub.sock');
  try {
    const started = Date.now();
    for (;;) {
      try { return await readAll(home, socket, kinds); } catch (error) {
        if (hub.exitCode !== null || Date.now() - started > 3 * MINUTE) throw Error(`BLOCKED: the hub on the benchmark's home didn't answer: ${String(error)}; ${stderr}`);
        await sleep(200);
      }
    }
  } finally {
    hub.kill('SIGTERM');
    const killing = setTimeout(() => hub.kill('SIGKILL'), 30_000);
    await exited;
    clearTimeout(killing);
  }
}
function readAll(home: string, socket: string, kinds: string[]): Promise<RecordedEvent[]> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    const events: RecordedEvent[] = [];
    let buffer = '';
    let after = 0;
    const next = () => sock.write(`${JSON.stringify({ v: 1, id: `r${after}`, method: 'events.read', params: { after, limit: 1000, kinds } })}\n`);
    const timer = setTimeout(() => { sock.destroy(); reject(Error('events.read gave nothing within 2 minutes')); }, 2 * MINUTE);
    sock.setEncoding('utf8');
    sock.on('error', (e) => { clearTimeout(timer); reject(e); });
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = JSON.parse(buffer.slice(0, i)) as { hello?: unknown; role?: unknown; error?: unknown; result?: { events: RecordedEvent[]; log_pos: number } };
        buffer = buffer.slice(i + 1);
        if (line.hello) sock.write(`${JSON.stringify({ v: 1, hello: 'app', token: readFileSync(join(home, '.deepbuild', 'control.token'), 'utf8').trim() })}\n`);
        else if (line.role) next();
        else if (line.error) { clearTimeout(timer); sock.destroy(); reject(Error(JSON.stringify(line.error))); }
        else if (line.result) {
          if (!line.result.events.length) { clearTimeout(timer); sock.destroy(); resolve(events); return; }
          events.push(...line.result.events);
          after = line.result.log_pos;
          next();
        }
      }
    });
  });
}

// ---- The reference Macs (design: The reference Macs), read through the repo's own fingerprint (scripts/benchmark.mjs).
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', memoryBytes: 36 * 2 ** 30 },
  { model: 'Mac15,12', chip: 'Apple M3', memoryBytes: 16 * 2 ** 30 },
  { model: 'Mac17,10', chip: 'Apple M5 Max', memoryBytes: 64 * 2 ** 30 },
];
interface Fingerprint { model: string | null; chip: string | null; memoryBytes: number | null; power: string | null; lowPowerMode: boolean | null; thermalState: string | null; macosBuild: string | null }
/** Why this machine's memory budget is a reading only, or null on a reference Mac on mains, Low Power Mode off, thermal state nominal. */
export async function environmentProblem(): Promise<string | null> {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  const { fingerprint } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { fingerprint: () => Fingerprint };
  const m = fingerprint();
  const off: string[] = [];
  if (!REFERENCE_MACS.some((r) => r.model === m.model && r.chip === m.chip && r.memoryBytes === m.memoryBytes)) off.push(`not a reference Mac: ${m.model} / ${m.chip} / ${m.memoryBytes} bytes`);
  if (m.power !== 'ac') off.push(`not on mains power: ${m.power}`);
  if (m.lowPowerMode !== false) off.push(`Low Power Mode is ${m.lowPowerMode === null ? 'unknown' : 'on'}`);
  if (m.thermalState !== 'nominal') off.push(`thermal state ${m.thermalState ?? 'unknown'}, not nominal`);
  if (!m.macosBuild) off.push('the macOS build is unknown');
  return off.length ? off.join('; ') : null;
}
