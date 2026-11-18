// Test-side tools for the #2569 acceptance tests: the issue's numbers and this job's stated times, the process table
// (`ps`), a child this suite started with its output lines and its exit, and the cover (cover.swift) that keeps frames
// from a real window. The bench is #1477's, built by #1477's own helpers; nothing here stands in for it, for its
// window, or for scripts/affected.mjs.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

export { BENCH, REPO, inconclusive, isObject, laneProblem, requireMac, useBench, useDir, type JsonObject, type JsonValue } from '../1477/helpers.ts';

/** This suite's folder. */
export const SUITE = dirname(fileURLToPath(import.meta.url));

/** The criteria, by the ID of their text (design: Criteria to tests, both ways). */
export const AC1 = '#2569.aedf09ed';
export const AC2 = '#2569.b4a750e6';
export const AC3 = '#2569.97a55309';

// ---------------------------------------------------------------------------------------------------
// The stated times. The issue names none; each is this job's choice (README).

/** "gets no frame for a stated time": an arm waiting for its window's next frame gives up after this long. */
export const STALL_S = 10;
/** How long after the stated time the arm's line and exit may take to arrive, on a loaded Mac too. */
export const STALL_SLACK_S = 10;
/** The cover goes up this long after the window is first on screen: past the 60 warm-up frames, inside the 8 counted seconds. */
export const COVER_AFTER_S = 3;
/** "No `lists_1477` process outlives the test run that started it": gone this long after its starter died. */
export const GRACE_S = 5;

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------------------------------
// The process table.

export interface Proc { pid: number; ppid: number; started: string; command: string }

/** Every process `ps` lists: its PID, its parent's, when it started and its command line. */
export function processTable(): Proc[] {
  const run = spawnSync('ps', ['-axww', '-o', 'pid=,ppid=,lstart=,command='], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 30_000, killSignal: 'SIGKILL' });
  if (run.error || run.status !== 0) expect.fail(`BLOCKED: the process table can't be read: ps ${run.error?.message ?? `exited ${run.status}: ${run.stderr}`}`);
  const out: Proc[] = [];
  for (const line of run.stdout.split('\n')) {
    // lstart reads `Tue Nov 17 09:12:33 2026`.
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+[\d:]+\s+\d+)\s+(.*)$/.exec(line);
    if (m) out.push({ pid: Number(m[1]), ppid: Number(m[2]), started: m[3]!.replace(/\s+/g, ' '), command: m[4]! });
  }
  return out;
}
/** Whether the table still holds this very process: the same PID, start and command, so a reused PID isn't it. */
export const holds = (table: Proc[], p: Proc): boolean => table.some((q) => q.pid === p.pid && q.started === p.started && q.command === p.command);
/** The processes under `root` in the table, near or far. */
export function descendants(table: Proc[], root: number): Proc[] {
  const out: Proc[] = [];
  const seen = new Set([root]);
  for (let grew = true; grew;) {
    grew = false;
    for (const p of table) if (seen.has(p.ppid) && !seen.has(p.pid)) { seen.add(p.pid); out.push(p); grew = true; }
  }
  return out;
}
export const shown = (procs: Proc[]): string => procs.map((p) => `pid ${p.pid} (${p.command.slice(0, 200)})`).join('; ') || 'none';

/** Waits until none of `procs` is in the table, at most `ms`; returns those still there. */
export async function leftAfter(procs: Proc[], ms: number): Promise<Proc[]> {
  const end = performance.now() + ms;
  for (;;) {
    const table = processTable();
    const left = procs.filter((p) => holds(table, p));
    if (!left.length || performance.now() >= end) return left;
    await sleep(100);
  }
}
/** Stops processes this suite's own children started, each by its PID, and waits up to 10 s for them to go. */
export async function stop(procs: Proc[]): Promise<void> {
  const table = processTable();
  for (const p of procs.filter((q) => holds(table, q))) { try { process.kill(p.pid, 'SIGKILL'); } catch { /* gone since the table was read */ } }
  await leftAfter(procs, 10_000);
}

// ---------------------------------------------------------------------------------------------------
// A child of this suite: its output lines as they come, and its exit.

export class Child {
  readonly child: ChildProcess;
  readonly lines: string[] = [];
  stderr = '';
  exit: { code: number | null; signal: string | null; at: number } | null = null;
  private readonly waiters: (() => void)[] = [];
  constructor(command: string, args: string[], options: { cwd: string; stdin?: 'pipe' | 'ignore' }) {
    this.child = spawn(command, args, { cwd: options.cwd, stdio: [options.stdin ?? 'ignore', 'pipe', 'pipe'] });
    let buffer = '';
    this.child.stdout!.setEncoding('utf8');
    this.child.stdout!.on('data', (data: string) => {
      buffer += data;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        if (line.trim() !== '') this.lines.push(line);
      }
      this.wake();
    });
    this.child.stderr!.setEncoding('utf8');
    this.child.stderr!.on('data', (data: string) => { this.stderr = (this.stderr + data).slice(-20_000); });
    this.child.stdin?.on('error', () => undefined);
    this.child.on('error', (error) => { this.stderr += String(error); this.exit ??= { code: null, signal: null, at: performance.now() }; this.wake(); });
    this.child.on('exit', (code, signal) => { this.exit = { code, signal, at: performance.now() }; this.wake(); });
  }
  private wake(): void { for (const w of this.waiters.splice(0)) w(); }
  get pid(): number { return this.child.pid ?? -1; }
  /** Waits until `done()` holds or `ms` have passed; says which. */
  async until(done: () => boolean, ms: number): Promise<boolean> {
    const end = performance.now() + ms;
    while (!done()) {
      const left = end - performance.now();
      if (left <= 0) return false;
      await new Promise<void>((resolve) => { const t = setTimeout(resolve, Math.min(left, 250)); this.waiters.push(() => { clearTimeout(t); resolve(); }); });
    }
    return true;
  }
  /** Stops this suite's own child, by its PID, and waits up to 10 s for it to go. */
  async stop(): Promise<void> {
    if (!this.exit) this.child.kill('SIGKILL');
    await this.until(() => this.exit !== null, 10_000);
  }
}

// ---------------------------------------------------------------------------------------------------
// The cover.

/** cover.swift, compiled into `dir`. */
export function compileCover(dir: string): string {
  const out = join(dir, 'cover');
  const c = spawnSync('swiftc', ['-O', '-module-cache-path', join(dir, 'swift-cache'), join(SUITE, 'cover.swift'), '-o', out], { encoding: 'utf8', timeout: 600_000, killSignal: 'SIGKILL' });
  if (c.error || c.status !== 0) expect.fail(`BLOCKED: swiftc can't compile cover.swift: ${c.error?.message ?? c.stderr}`);
  return out;
}
