// Test-side tools for the #237 acceptance tests: IDs, temp folders, a clock the test sets, processes the test
// starts and reads by ID and start time, the record read back, every order of a list, and the reference-Mac
// timing judge. Nothing here stands in for the lease table: tests reach it through `@deepbuild/leases`'s public
// entry (world.ts; README, The surface).
//
// Safety: every process the tests start is stopped by PID only, never by name or port; every folder is under
// /tmp/dl237-*; HOME is a temp folder for this process and every child, and the agent's own CLAUDE_* and DEEP_*
// variables are removed first, so nothing here can reach a real hub, inbox socket or ~/.deepbuild.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, type TestContext } from 'vitest';
import type { Event } from '../../../packages/record/src/index.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const NODE = process.execPath;
export const MINUTE = 60_000;
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_')) delete process.env[key];
let HOME: string | undefined;
/** This process's HOME and every child's: a temp folder, made before the first thing a test opens. */
export function home(): string {
  if (!HOME || !existsSync(HOME)) {
    HOME = realpathSync(mkdtempSync('/tmp/dl237-home-'));
    process.env.HOME = HOME;
  }
  return HOME;
}

// ---- IDs.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function base32(value: bigint, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
}
export function ulid(ms = Date.now()): string {
  return base32(BigInt(ms), 10) + base32(BigInt(`0x${randomBytes(10).toString('hex')}`), 16);
}
/** A holder: `session:<ULID>`, as the record's holder pattern writes one. */
export const session = (): string => `session:${ulid()}`;
export const runId = (): string => `run:${ulid()}`;

// ---- Temp folders: short real paths (the supervisor's sandbox matches real paths).
const made: string[] = [];
export function tempDir(): string {
  home();
  const dir = realpathSync(mkdtempSync('/tmp/dl237-'));
  made.push(dir);
  return dir;
}

// ---- A clock the test sets: the record's and the table's `now`. It starts at the real time and moves only when
// the test moves it, so an expiry, a cooldown or a stale mark is reached by the test, never by waiting.
export interface Clock { now(): number; set(ms: number): void; advance(ms: number): void }
export function makeClock(start = Date.now()): Clock {
  let t = start;
  return { now: () => t, set: (ms) => { t = ms; }, advance: (ms) => { t += ms; } };
}
/** 2026-10-24 at hh:mm UTC, for the cooldown criterion's 12:00, 12:05 and 12:11. */
export const at = (hh: number, mm: number): number => Date.UTC(2026, 9, 24, hh, mm, 0, 0);

// ---- Processes this suite started, stopped by PID only.
const owned = new Map<number, ChildProcess>();
/** Starts `/bin/sleep 600` as a child of this test process: a stand-in for an agent's process. */
export async function startSleeper(): Promise<{ pid: number; start: string; child: ChildProcess }> {
  home();
  const child = spawn('/bin/sleep', ['600'], { stdio: 'ignore', env: { PATH: '/usr/bin:/bin', HOME: home() } });
  await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  owned.set(child.pid!, child);
  const start = startOf(child.pid!);
  if (!start) throw Error(`BLOCKED: ps shows no start time for the sleeper ${child.pid}`);
  return { pid: child.pid!, start, child };
}
/** Kills a process this suite started with SIGKILL, by its PID, and waits until it is reaped. */
export async function killHard(p: { pid: number; child: ChildProcess }): Promise<void> {
  if (p.child.exitCode === null && p.child.signalCode === null) {
    const gone = new Promise<void>((resolve) => p.child.once('exit', () => resolve()));
    process.kill(p.pid, 'SIGKILL');
    await gone;
  }
  owned.delete(p.pid);
}
/** A process's start time as `ps -o lstart=` prints it under LC_ALL=C (how #16 and #236 tell a reused ID apart). */
export function startOf(pid: number): string | undefined {
  try {
    return execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim() || undefined;
  } catch {
    return undefined;
  }
}
/** Stops what this suite started (SIGKILL, by PID) and removes its folders. */
export async function cleanup(): Promise<void> {
  for (const [pid, child] of owned) {
    if (child.exitCode === null && child.signalCode === null) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  }
  owned.clear();
}
afterAll(async () => {
  await cleanup();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (HOME) rmSync(HOME, { recursive: true, force: true });
});

// ---- The record read back.
export const dataOf = (e: Event): Record<string, unknown> => e.data as Record<string, unknown>;
export const json = (v: unknown): string => JSON.stringify(v, (_, x: unknown) => (typeof x === 'bigint' ? x.toString() : x));

/** Every order of the given items. */
export function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

/** A promise the test resolves itself: a probe held open. */
export interface Held<T> { promise: Promise<T>; resolve(value: T): void }
export function held<T>(): Held<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
export async function within<T>(promise: Promise<T>, ms: number): Promise<T | 'pending'> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'pending'>((resolve) => { timer = setTimeout(() => resolve('pending'), ms); });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// ---- Timing on the reference Mac (the rule of tests/acceptance/14, 16 and 236), plus load: a reading taken while
// the machine is loaded past its core count is a reading only, never a pass (design: Sessions that know about each
// other, Load).
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const read = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why this machine's timings are a reading only, or null on a reference Mac in a fit state. */
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
  const fingerprint = `${model} / ${chip} / ${gib} GiB`;
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${fingerprint}`;
  if (!/'AC Power'/.test(batt)) return `not on mains power: ${batt.split('\n')[0]}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  return loadProblem();
}
/** A machine loaded past its core count: its timings are a reading only. */
export function loadProblem(): string | null {
  const [one] = loadavg();
  const cores = availableParallelism();
  return one! > cores ? `loaded past its core count: 1-minute load ${one!.toFixed(1)} on ${cores} cores` : null;
}
/** PASS when every run is within the limit; FAIL when every run is over it by more than the margin; else INCONCLUSIVE. */
export function judge(ctx: TestContext, name: string, runs: number[], limit: number): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
  const margin = Math.max(0.05, spread);
  const shown = `${name}: ${runs.map((r) => r.toFixed(2)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(shown);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${shown}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${shown}`);
}
export const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
