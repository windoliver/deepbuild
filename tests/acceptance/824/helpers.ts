// Shared test-side tools for #824: temp homes, the benchmark as a process, its one JSON line, the record read through
// the hub's socket, and the reference-Mac gate. Everything goes through `benchmarks/hub-churn.mjs`, `deep hub run` and
// `events.read`; the README states what the benchmark has to meet.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

export const AC1 = 'AC1 #824.5d5b3077';
export const AC2 = 'AC2 #824.00e39b0a';
export const AC3 = 'AC3 #824.d4ee9496';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const BENCH = join(REPO, 'benchmarks/hub-churn.mjs');
export const BENCH_PATH = 'benchmarks/hub-churn.mjs';
const CLI = join(REPO, 'packages/cli/dist/main.js');
const NODE = process.execPath;
export const MINUTE = 60_000;

/** The issue's limits over 5,000 cycles, in bytes (1 MB = 10^6 bytes), and so per 1,000 cycles. */
export const HEAP_LIMIT = 1_000_000;
export const RSS_LIMIT = 10_000_000;
export const HEAP_LIMIT_PER_1000 = HEAP_LIMIT / 5;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function makeHome(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh824-'));
  made.push(dir);
  const home = join(dir, 'h');
  mkdirSync(home);
  return home;
}

/** The PIDs with a file open under a folder. Only this suite's benchmark and hub ever touch a test's temp home. */
export function holders(folder: string): number[] {
  const lsof = existsSync('/usr/sbin/lsof') ? '/usr/sbin/lsof' : 'lsof';
  let out = '';
  try {
    out = execFileSync(lsof, ['-t', '+D', folder], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (error) {
    // lsof exits 1 when nothing holds the folder; anything else means it couldn't look.
    const e = error as NodeJS.ErrnoException & { status?: number; stdout?: string };
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
    const deadline = Date.now() + 3000;
    while (pids.some(alive) && Date.now() < deadline) await sleep(50);
    for (const pid of pids) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
    rmSync(dir, { recursive: true, force: true });
  }
}

/** This environment with HOME moved to the test's home, and no agent markers, billing keys or DEEP_ settings. */
function childEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|CLAUDE|ANTHROPIC|OPENAI|CODEX|XDG_)/.test(key) || key === 'NODE_OPTIONS') continue;
    env[key] = value;
  }
  return { ...env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, ...extra };
}

// ---- The benchmark (README, Defined here, 1 and 2).
export interface Open { sockets: number; timers: number; children: number }
export interface Reading { cycle: number; heapBytes: number; rssBytes: number }
export interface Line {
  bench: string; cycles: number; warmup: number; every: number; readings: Reading[];
  heapGrowthBytes: number; rssGrowthBytes: number; heapGrowthPer1000Bytes: number; rssGrowthPer1000Bytes: number;
  open: { afterWarmup: Open; afterLast: Open };
  mergeBase?: { commit: string; heapGrowthPer1000Bytes?: number; rssGrowthPer1000Bytes?: number; initial?: string };
}
export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; home: string; line: Line | undefined; words: string }

/** Runs `node benchmarks/hub-churn.mjs` with a temp home, and asserts first that the benchmark is there. */
export function bench(o: { cycles?: number; plant?: string; args?: string[]; timeoutMs?: number } = {}): Promise<Ran> {
  expect(existsSync(BENCH), `${BENCH_PATH} exists: the churn benchmark in the local preflight`).toBe(true);
  const home = makeHome();
  const args = [BENCH, '--home', home, ...(o.cycles === undefined ? [] : ['--cycles', String(o.cycles)]), ...(o.args ?? [])];
  return new Promise((resolve) => {
    const child = spawn(NODE, args, { cwd: REPO, env: childEnv(home, o.plant ? { DEEP_HUB_PLANT: o.plant } : {}), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), o.timeoutMs ?? 30 * MINUTE);
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
const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` ${r.signal}` : ''}; stdout: ${r.stdout.slice(-1500)}; stderr: ${r.stderr.slice(-1500)}`;
export const lineFrom = (r: Ran): Line => {
  expect(r.line, `the benchmark prints its readings as one JSON line with "bench": "hub-churn": ${shown(r)}`).toBeDefined();
  return r.line!;
};
/** The first line of the benchmark's output that starts with this word, as scripts/preflight.mjs prints them. */
export const worded = (r: Ran, word: 'FAIL' | 'BLOCKED') => r.words.split('\n').find((l) => new RegExp(`^${word}\\b`).test(l));
export { shown };

/** A size in a line of words, in bytes: "1.2 MB", "1,024 KB", "850 bytes". Every one it names. */
export function sizesNamed(text: string): number[] {
  const units: Record<string, number> = { b: 1, byte: 1, bytes: 1, kb: 1e3, kib: 1024, mb: 1e6, mib: 2 ** 20, gb: 1e9, gib: 2 ** 30 };
  return [...text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(bytes?|gib|gb|mib|mb|kib|kb|b)\b/gi)].map((m) => Number(m[1]!.replace(/,/g, '')) * units[m[2]!.toLowerCase()]!);
}

// ---- The record the cycles left, read through the hub's socket on the benchmark's home.
export interface RecordedEvent { kind: string; session_id?: string; session?: string }
/** `deep hub run` on the home, every event through `events.read` as the app, and the hub stopped by its PID. */
export async function recorded(home: string): Promise<RecordedEvent[]> {
  const hub = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(home), stdio: ['ignore', 'ignore', 'ignore'] });
  const exited = new Promise((resolve) => hub.on('exit', resolve));
  const socket = join(home, '.deepbuild', 'hub.sock');
  try {
    const started = Date.now();
    for (;;) {
      try { return await readAll(home, socket); } catch (error) {
        if (Date.now() - started > 30_000) throw Error(`BLOCKED: the hub on the benchmark's home didn't answer: ${String(error)}`);
        await sleep(100);
      }
    }
  } finally {
    hub.kill('SIGTERM');
    await exited;
  }
}
function readAll(home: string, socket: string): Promise<RecordedEvent[]> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    const events: RecordedEvent[] = [];
    let buffer = '';
    let after = 0;
    const next = () => sock.write(`${JSON.stringify({ v: 1, id: `r${after}`, method: 'events.read', params: { after, limit: 10_000 } })}\n`);
    sock.setEncoding('utf8');
    sock.on('error', reject);
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = JSON.parse(buffer.slice(0, i)) as { hello?: unknown; role?: unknown; error?: unknown; result?: { events: RecordedEvent[]; log_pos: number } };
        buffer = buffer.slice(i + 1);
        if (line.hello) sock.write(`${JSON.stringify({ v: 1, hello: 'app', token: readFileSync(join(home, '.deepbuild', 'control.token'), 'utf8').trim() })}\n`);
        else if (line.role) next();
        else if (line.error) { sock.destroy(); reject(Error(JSON.stringify(line.error))); }
        else if (line.result) {
          if (!line.result.events.length) { sock.destroy(); resolve(events); return; }
          events.push(...line.result.events);
          after = line.result.log_pos;
          next();
        }
      }
    });
  });
}

// ---- The reference Macs (design: The reference Macs).
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const read = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why this machine's memory budget is a reading only, or null on a reference Mac in a fit state. */
export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, batt: string, power: string, therm: string;
  try {
    model = read('sysctl', '-n', 'hw.model');
    chip = read('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(read('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    batt = read('pmset', '-g', 'batt');
    power = read('pmset', '-g');
    therm = read('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
  if (!/'AC Power'/.test(batt)) return `not on mains power: ${batt.split('\n')[0]}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  return null;
}
