// Test-side tools for the #1551 acceptance tests: the release `deep-show` built once per file and copied out under
// its own name, `deep-show live` driven with the README's `live` options, the still board as an agent sends it, the
// reference-Mac gate and the load reading (#140's, so a timing off the reference Mac reads INCONCLUSIVE), and JSON
// readers. Nothing here stands in for the window, the display link, the frame clock or the lane.

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1551 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** The criteria, by the IDs scripts/proof-change.mjs gives them. */
export const C1 = '#1551.529faaf6';
export const C2 = '#1551.d7b41417';
export const C3 = '#1551.5ed5fd2b';
export const C4 = '#1551.76b01721';

/** The issue's numbers: a 60 s still minute, at least 3,000 callbacks on the merge base, 2 frames from idle. */
export const STILL_MS = 60_000;
export const BASE_LEAST = 3_000;
export const FRAMES = 2;

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonValue[];
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)?.slice(0, 200)}`).toBe(true);
  return value as number;
}
export function int(value: JsonValue | undefined, what: string): number {
  expect(Number.isSafeInteger(value) && (value as number) >= 0, `${what} is a whole number, got ${JSON.stringify(value)?.slice(0, 200)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value === 'string' && value !== '', `${what} is a non-empty string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as string;
}
export const clone = <T extends JsonValue>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A whole number as a message may print it: plain or grouped by threes; never part of a longer number. */
export function mentions(text: string, n: number): boolean {
  const s = String(Math.trunc(n));
  const head = s.length % 3 || 3;
  const groups = [s.slice(0, head)];
  for (let i = head; i < s.length; i += 3) groups.push(s.slice(i, i + 3));
  return RegExp(`(?<![\\d.])${groups.join('[,_ \\u2009\\u202f]?')}(?![\\d])`).test(text);
}

/** The nearest-rank percentile, as the perf lane takes it. */
export function percentile(xs: readonly number[], p: number): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)]!;
}

// ---------------------------------------------------------------------------------------------------
// INCONCLUSIVE, never a pass: the reference-Mac gate and the machine's load (#140's view helpers)

/** Fails the test as INCONCLUSIVE (never a pass, never a skip), with the reason and any readings. */
export function inconclusive(reason: string, readings: string[] = []): never {
  expect.fail(`INCONCLUSIVE: ${reason}${readings.length ? `\n${readings.slice(0, 40).join('\n')}` : ''}`);
}

// The perf lane's reference Macs and conditions (scripts/benchmark.mjs `fingerprint`, `judgeLimit`).
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
  { model: 'Mac17,10', chip: 'Apple M5 Max', gib: 64 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }).trim();
const foundation = (expr: string): string => sh('osascript', '-l', 'JavaScript', '-e', `ObjC.import("Foundation"); $.NSProcessInfo.processInfo.${expr}`);

/** Null on a fit reference Mac (mains power, Low Power Mode off, thermal state nominal); else why not. */
export function referenceMacProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  try {
    const model = sh('sysctl', '-n', 'hw.model');
    const chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
    const gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
    if (!/'AC Power'/.test(sh('pmset', '-g', 'ps'))) return 'not on mains power';
    const lpm = /^\s*lowpowermode\s+([01])\s*$/m.exec(sh('pmset', '-g'))?.[1] ?? { true: '1', false: '0' }[foundation('isLowPowerModeEnabled')];
    if (lpm !== '0') return `Low Power Mode is ${lpm === '1' ? 'on' : 'unknown'}`;
    const thermal = foundation('thermalState');
    if (thermal !== '0') return `thermal state not nominal (NSProcessInfo.thermalState ${thermal})`;
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  return null;
}
/** Null when the machine is quiet enough for a timing reading; else the load (1-minute average above half the cores). */
export function loadProblem(): string | null {
  const [one] = loadavg();
  const cores = availableParallelism();
  return one! > cores / 2 ? `the machine is loaded: 1-minute load average ${one!.toFixed(1)} on ${cores} cores` : null;
}
/** Why a timing reading on this machine doesn't count, or null when it does. */
export const timingProblem = (): string | null => referenceMacProblem() ?? loadProblem();

// ---------------------------------------------------------------------------------------------------
// deep-show: one release build per file, copied out so a later build can't change it under a run

/** The release `deep-show` this file runs; a test that uses it after a failed build fails with cargo's error. */
export function useDeepShow(): () => string {
  let dir = '';
  let bin = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1551-bin-'));
    const args = ['build', '--locked', '--release', '-p', 'deep-show', '--bin', 'deep-show'];
    const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (run.error) error = `cargo could not run: ${run.error.message}`;
    else if (run.status !== 0) error = `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download/.test(l)).join('\n').slice(0, 4000)}`;
    else {
      bin = join(dir, 'deep-show');
      copyFileSync(join(REPO, 'target', 'release', 'deep-show'), bin);
    }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return () => {
    expect(error, 'the release deep-show builds').toBe('');
    return bin;
  };
}

export const SESSION = 's1';
export const PANEL = 'main';
export const DOC = 'still';
/** One second in flicks, and one frame of the virtual clock the scenario's calls are ordered on. */
export const FLICKS = 705_600_000;
export const FRAME = FLICKS / 60;

/** The canvas-idle lane's still document (benchmarks/canvas/still.json), as an agent sends it: no id, layers or item layer. */
export function stillAsAgent(label = 'Q3 revenue'): JsonObject {
  const doc = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'canvas', 'still.json'), 'utf8')) as JsonObject;
  delete doc['id'];
  delete doc['layers'];
  const items = obj(doc['items'], 'still.json items');
  for (const v of Object.values(items)) if (isObject(v)) delete v['layer'];
  const text = obj(obj(items['label'], 'still.json item label')['params'], 'label params');
  text['text'] = label;
  return doc;
}

/**
 * A `deep-show live` scenario (#393, #376, the #140 view README): the still board presented in the main panel at
 * t = 0 on the virtual clock, then `live` and, for a wrong program, `planted`. `liveRun` adds a fresh `evidence`.
 */
export function liveScenario(live: JsonObject, planted?: string): JsonObject {
  const doc = stillAsAgent();
  const size = arr(doc['size'], 'still.json size').map((v) => num(v, 'size'));
  return {
    sessions: { [SESSION]: { thread: 'thread-a', name: 'agent-a', process: { pid: 4100, start: 1_000 } } },
    processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 4100, ppid: 1, start: 1_000 }],
    panels: { [PANEL]: { rect: [0, 0, size[0]!, size[1]!] } },
    docs: { [DOC]: { panel: PANEL } },
    window: [size[0]!, size[1]! + 40],
    clock: { refresh_hz: 60, lead: 0, check: 0 },
    calls: [{ call: 'deep_show', session: SESSION, doc: DOC, document: doc, at: 0 }],
    live,
    ...(planted ? { planted } : {}),
  };
}

/** A hub event: a `deep_show` call that makes a new revision of the still board current, its label changed. */
export const hubEvent = (n: number): JsonObject =>
  ({ call: 'deep_show', session: SESSION, doc: DOC, document: stillAsAgent(`Q3 revenue, take ${n}`), at: (n + 1) * 10 * FRAME });

/**
 * `deep-show live` with the scenario (README): the app's real, shown window, one answer line, exit 0. A machine with
 * no display to show it on answers `no_display`, which is INCONCLUSIVE here. Returns the answer's `live`.
 */
export function liveRun(bin: string, scenario: JsonObject, timeoutMs = 600_000): JsonObject {
  const evidence = mkdtempSync(join(tmpdir(), 'deep-1551-evidence-'));
  try {
    const input = `${JSON.stringify({ ...scenario, evidence })}\n`;
    // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
    const run = spawnSync(bin, ['live'], { cwd: REPO, input, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
    const timedOut = (run.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
    expect(timedOut, `deep-show live finished within ${timeoutMs} ms`).toBe(false);
    expect(run.error, `deep-show live ran: ${run.error?.message}`).toBeUndefined();
    expect(run.status, `deep-show live exited 0 (${run.signal ?? 'no signal'}); stdout: ${(run.stdout ?? '').slice(0, 1500)}; stderr: ${(run.stderr ?? '').slice(-2000)}`).toBe(0);
    const lines = (run.stdout ?? '').split('\n').filter((l) => l.trim() !== '');
    expect(lines.length, `deep-show live answers one line; stdout: ${(run.stdout ?? '').slice(0, 1500)}`).toBe(1);
    let answer: JsonValue = null;
    try { answer = JSON.parse(lines[0]!) as JsonValue; } catch { answer = lines[0]!; }
    const a = obj(answer, 'deep-show live: the answer');
    if (a['ok'] === false && (a['code'] === 'no_display' || a['code'] === 'unsupported_platform')) {
      inconclusive(`deep-show live could not show a window here (${String(a['code'])}); this needs a Mac with a display`);
    }
    expect(a['ok'], `deep-show live answered ok: ${JSON.stringify(a).slice(0, 2000)}`).toBe(true);
    return obj(a['live'], 'deep-show live: live');
  } finally {
    rmSync(evidence, { recursive: true, force: true });
  }
}

/** The window's state over the run (README: `live.window`); a window that wasn't shown throughout is INCONCLUSIVE. */
export function requireShown(live: JsonObject, what: string): void {
  const w = obj(live['window'], `${what}: live.window`);
  const state = str(w['state'], `${what}: live.window.state`);
  const shownMs = num(w['shown_ms'], `${what}: live.window.shown_ms`);
  if (state !== 'shown') inconclusive(`${what}: the window was ${state} during the run (shown ${Math.round(shownMs)} ms), so it says nothing of a shown window`);
}
