// #824 AC4's test-side tools: the per-session benchmark as a process, its one JSON line, and the per-session growth
// recomputed from its raw per-process readings, never taken from its verdict. Temp homes, cleanup by PID, the record
// through `events.read`, the reference-Mac gate and the size parser are the parent suite's (../helpers.ts), used as is.
// The README (Defined here) states what the benchmark has to meet.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect } from 'vitest';
import { makeHome, MINUTE, REPO } from '../helpers.ts';

export const AC4 = 'AC4 #824.85ef3d40';
export const CRITERION = "On the reference Mac, compared with the merge base, each session added past the first raises the summed memory of DeepBuild's own processes by under 25 MB. A planted MCP server that loads the whole hub package for each session fails, and so does a waiter that keeps a copy of its session's transcript, each naming the per-session growth and the process that grew";

export const BENCH_PATH = 'benchmarks/hub-sessions.mjs';
export const BENCH = join(REPO, BENCH_PATH);
const NODE = process.execPath;

/** The issue's limit: under 25 MB per session added past the first (1 MB = 10^6 bytes, as #16's suite reads it). */
export const LIMIT = 25_000_000;
/** The issue's session counts, in the order they are reached. */
export const COUNTS = [1, 10, 30];
/** The processes DeepBuild runs: the hub once, and per session its two MCP server entries and its waiter. */
export const PER_SESSION_ROLES = ['deep mcp', 'deep mcp actions', 'waiter'] as const;
export const ROLES = ['hub', ...PER_SESSION_ROLES] as const;
export type Role = (typeof ROLES)[number];
/** Bytes each scripted session's transcript holds before its first hook: 32 MiB (README, Defined here, 4). */
export const TRANSCRIPT_BYTES = 32 * 2 ** 20;

/** This environment with HOME moved to the test's home, and no agent markers, billing keys or DEEP_ settings. */
function childEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|CLAUDE|ANTHROPIC|OPENAI|CODEX|XDG_)/.test(key) || key === 'NODE_OPTIONS') continue;
    env[key] = value;
  }
  return { ...env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, ...extra };
}

// ---- The benchmark's line (README, Defined here, 2).
export interface Proc { pid: number; ppid: number; role: Role; child: boolean; command: string; bytes: number }
export interface Reading { sessions: number; at: number; totalBytes: number; processes: Proc[] }
export interface Line {
  bench: string; platform: string; method: string; limitBytes: number;
  readings: Reading[]; perSessionBytes: number; grew: { role: Role; perSessionBytes: number };
  mergeBase?: { commit: string; perSessionBytes?: number; initial?: string };
}
export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; home: string; line: Line | undefined; words: string }

/** Runs `node benchmarks/hub-sessions.mjs --home <temp home>`, and asserts first that the benchmark is there. */
export function bench(o: { plant?: string; args?: string[]; timeoutMs?: number } = {}): Promise<Ran> {
  expect(existsSync(BENCH), `${BENCH_PATH} exists: the per-session reading of #824's Scope`).toBe(true);
  const home = makeHome();
  return new Promise((resolve) => {
    const child = spawn(NODE, [BENCH, '--home', home, ...(o.args ?? [])], { cwd: REPO, env: childEnv(home, o.plant ? { DEEP_HUB_PLANT: o.plant } : {}), stdio: ['ignore', 'pipe', 'pipe'] });
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

// ---- The growth, recomputed here from the raw per-process readings.
/** The bytes of every process of a role at one reading, its children included. */
export const roleBytes = (reading: Reading, role: Role) => reading.processes.filter((p) => p.role === role).reduce((sum, p) => sum + p.bytes, 0);
/** The most any step between consecutive counts added per session: "each session added past the first". */
function perSession(line: Line, bytesAt: (r: Reading) => number): number {
  let most = -Infinity;
  for (let i = 1; i < line.readings.length; i++) {
    const [a, b] = [line.readings[i - 1]!, line.readings[i]!];
    most = Math.max(most, (bytesAt(b) - bytesAt(a)) / (b.sessions - a.sessions));
  }
  return most;
}
/** The summed memory's growth per added session, from the processes' own readings. */
export const perSessionGrowth = (line: Line) => perSession(line, (r) => r.processes.reduce((sum, p) => sum + p.bytes, 0));
export const roleGrowth = (line: Line, role: Role) => perSession(line, (r) => roleBytes(r, role));
/** The role whose memory grew most per added session: the process that grew. */
export const grewMost = (line: Line): Role => [...ROLES].sort((a, b) => roleGrowth(line, b) - roleGrowth(line, a))[0]!;
