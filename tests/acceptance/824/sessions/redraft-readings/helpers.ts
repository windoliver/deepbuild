// #824 AC4's per-session reading, test-side tools: a temp home per run, `node benchmarks/hub-sessions.mjs` as a process,
// its one JSON line and words, and a sampler that watches the OS's own process table (and, on Linux, each process's
// Pss) while the benchmark runs, so its readings are checked against what really ran, never taken on its word.
// README.md states the surface these drive.
import { execFile, execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { expect } from 'vitest';
import { holders, REPO } from '../../helpers.ts';

export { MINUTE, recorded, REPO, sizesNamed } from '../../helpers.ts';

export const AC4 = 'AC4 #824.85ef3d40';
export const BENCH_PATH = 'benchmarks/hub-sessions.mjs';
const BENCH = join(REPO, BENCH_PATH);
const NODE = process.execPath;
/** The issue's limit, 25 MB a session, in bytes (1 MB = 10^6 bytes, as #16's suite reads it). */
export const LIMIT = 25_000_000;
/** The surface's transcript: at least 32 MiB of Claude Code transcript lines. */
export const TRANSCRIPT_BYTES = 33_554_432;
export const COUNTS = [1, 10, 30] as const;
export const ROLES = ['hub', 'deep mcp', 'deep mcp actions', 'waiter'] as const;
export type Role = (typeof ROLES)[number];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const run = promisify(execFile);

// ---- Temp homes, each cleaned on its own: a run's home is never removed by another test's cleanup.
/** A home under /tmp (a Unix socket path must fit in 104 bytes on macOS). */
function makeHome(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh824s-'));
  const home = join(dir, 'h');
  mkdirSync(home);
  return home;
}
const alive = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};
/** The command a live PID runs now, or undefined: a PID is stopped only while it still runs what the run saw. */
function commandOf(pid: number): string | undefined {
  try { return execFileSync('ps', ['-ww', '-o', 'args=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return undefined; }
}
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** This environment with HOME moved to the run's home, and no agent markers, billing keys or DEEP_ settings. */
function childEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|CLAUDE|ANTHROPIC|OPENAI|CODEX|XDG_)/.test(key) || key === 'NODE_OPTIONS') continue;
    env[key] = value;
  }
  return { ...env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, ...extra };
}

// ---- The OS's own view while the benchmark runs.
export interface Seen { ppid: number; args: string; pss?: number | undefined }
/** One look at the process table: started at `t0`, done at `t1` (epoch ms). `procs` holds every process then running. */
export interface Sample { t0: number; t1: number; procs: Map<number, Seen> }

async function processTable(): Promise<Map<number, Seen>> {
  const { stdout } = await run('ps', ['-ww', '-A', '-o', 'pid=,ppid=,args='], { maxBuffer: 64 * 1024 * 1024 });
  const procs = new Map<number, Seen>();
  for (const line of stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s(.*)$/.exec(line);
    if (m) procs.set(Number(m[1]), { ppid: Number(m[2]), args: squash(m[3]!) });
  }
  return procs;
}
/** The processes under `root`, by the table's parent links. */
export function descendants(procs: Map<number, Seen>, root: number): Set<number> {
  const out = new Set<number>([root]);
  for (let grew = true; grew;) {
    grew = false;
    for (const [pid, p] of procs) if (!out.has(pid) && out.has(p.ppid)) { out.add(pid); grew = true; }
  }
  out.delete(root);
  return out;
}
/** Linux's proportional set size of a process, in bytes, read by the test itself. */
function pssOf(pid: number): number | undefined {
  try {
    const m = /^Pss:\s+(\d+)\s+kB/m.exec(readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8'));
    return m ? Number(m[1]) * 1024 : undefined;
  } catch { return undefined; }
}

// ---- The benchmark (README, The surface under test).
export interface Proc { pid: number; ppid: number; role: Role; child: boolean; command: string; bytes: number }
export interface Reading { sessions: number; at: number; totalBytes: number; processes: Proc[] }
export interface Line {
  bench: string; platform: string; method: string; limitBytes: number; readings: Reading[];
  perSessionBytes: number; grew: { role: Role; perSessionBytes: number };
  mergeBase?: { commit: string; perSessionBytes?: number; initial?: string };
}
export interface Ran {
  code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; home: string; pid: number;
  line: Line | undefined; words: string; samples: Sample[]; tracked: Map<number, string>;
}

/**
 * Runs `node benchmarks/hub-sessions.mjs --home <temp>` and samples the process table until it exits. A process is
 * tracked (its Pss read, on Linux, and stopped by PID at cleanup if it outlives the run) when it runs under the
 * benchmark, or runs this checkout's code and wasn't running before the benchmark started.
 */
export async function bench(o: { plant?: string; args?: string[]; timeoutMs?: number } = {}): Promise<Ran> {
  expect(existsSync(BENCH), `${BENCH_PATH} exists: the per-session reading in the local preflight`).toBe(true);
  const home = makeHome();
  const before = new Set((await processTable()).keys());
  const child = spawn(NODE, [BENCH, '--home', home, ...(o.args ?? [])], { cwd: REPO, env: childEnv(home, o.plant ? { DEEP_HUB_PLANT: o.plant } : {}), stdio: ['ignore', 'pipe', 'pipe'] });
  const pid = child.pid!;
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
  child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
  const samples: Sample[] = [];
  const tracked = new Map<number, string>();
  let done = false;
  const exited = new Promise<[number | null, NodeJS.Signals | null]>((resolve) => child.on('close', (code, signal) => { done = true; resolve([code, signal]); }));
  const timer = setTimeout(() => child.kill('SIGKILL'), o.timeoutMs ?? 40 * 60_000);
  const sampling = (async () => {
    while (!done) {
      const t0 = Date.now();
      const procs = await processTable().catch(() => undefined);
      if (procs) {
        const ours = descendants(procs, pid);
        for (const [p, seen] of procs) if (!before.has(p) && seen.args.includes(REPO)) ours.add(p);
        for (const p of ours) {
          tracked.set(p, procs.get(p)!.args);
          if (process.platform === 'linux') procs.get(p)!.pss = pssOf(p);
        }
        samples.push({ t0, t1: Date.now(), procs });
      }
      await sleep(100);
    }
  })();
  const [code, signal] = await exited;
  clearTimeout(timer);
  await sampling;
  return { code, signal, stdout, stderr, home, pid, line: lineOf(stdout), words: `${stdout}\n${stderr}`, samples, tracked };
}
function lineOf(stdout: string): Line | undefined {
  for (const text of stdout.split('\n').reverse()) {
    if (!text.startsWith('{')) continue;
    try {
      const value = JSON.parse(text) as Line;
      if (value.bench === 'hub-sessions') return value;
    } catch { /* not its line */ }
  }
  return undefined;
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` ${r.signal}` : ''}; stdout: ${r.stdout.slice(-1500)}; stderr: ${r.stderr.slice(-1500)}`;
export const lineFrom = (r: Ran): Line => {
  expect(r.line, `the benchmark prints its readings as one JSON line with "bench": "hub-sessions": ${shown(r)}`).toBeDefined();
  return r.line!;
};
/** The first line of the benchmark's output that starts with this word, as scripts/preflight.mjs prints them. */
export const worded = (r: Ran, word: 'FAIL' | 'BLOCKED' | 'PASS') => r.words.split('\n').find((l) => new RegExp(`^${word}\\b`).test(l));

/** Stops by PID what this run started and still runs (the processes it tracked, and what holds its home), then removes the home. */
export async function cleanupRun(r: Ran | undefined): Promise<void> {
  if (!r) return;
  const dir = dirname(r.home);
  const pids = new Set<number>();
  for (const [pid, args] of r.tracked) {
    const now = commandOf(pid);
    if (pid !== process.pid && now !== undefined && squash(now) === args) pids.add(pid);
  }
  for (const pid of holders(dir)) if (pid !== process.pid) pids.add(pid);
  for (const pid of pids) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 3000;
  while ([...pids].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of pids) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  rmSync(dir, { recursive: true, force: true });
}

/**
 * The growth per added session by the surface's rule: the larger of (at 10 - at 1) / 9 and (at 30 - at 10) / 20, so
 * "each session added past the first" holds for both steps.
 */
export function perSession(at: (n: number) => number): number {
  return Math.max((at(10) - at(1)) / 9, (at(30) - at(10)) / 20);
}

/** The merge base the benchmark compares with, as the surface names it. */
export const mergeBase = () => execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
