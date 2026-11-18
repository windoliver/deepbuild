// Test-side tools for the #2742 acceptance tests (README: The surface under test). `deep-gpu` (#377's binary, with
// #417's `film2d`) is built once per file with the pinned toolchain and driven by one JSON line. This file adds the
// criterion IDs, AC1's two documents (the composited side and its twin), the reader of `film2d`'s rows and the median.
// Nothing here stands in for the compositor or the meter: every reading a test judges comes from the binary.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/2742 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** Each criterion's ID (scripts/proof-change.mjs, `criterionId`: `#2742.` and the first 8 hex of SHA-256 of its text). */
export const AC = {
  1: 'AC1 #2742.f2fad73c',
  2: 'AC2 #2742.fbe6114c',
} as const;

// ---------------------------------------------------------------------------------------------------
// JSON and verdict words

const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const shown = (v: JsonValue | undefined, n = 1500): string => JSON.stringify(v)?.slice(0, n) ?? 'undefined';
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${shown(v)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${shown(v)}`).toBe(true);
  return v as JsonValue[];
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${shown(v)}`).toBe(true);
  return v as number;
}
/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** `film2d` draws in the app's window on macOS's Metal device; anywhere else the test is INCONCLUSIVE. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`film2d draws through the GPU layer on macOS's Metal device; this is ${process.platform}`);
}
/** The median: the mean of the two middle readings of an even count. */
export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

// ---------------------------------------------------------------------------------------------------
// The build: deep-gpu built once per file with the pinned toolchain first on PATH, and copied out of the target folder.

const TOOLCHAIN = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
/** The environment every build and child run here gets: the pinned toolchain first on PATH, no incremental build, no
 * debug info (the flags the other suites build with, so their builds are reused). */
export const buildEnv = (): NodeJS.ProcessEnv => ({
  ...process.env, PATH: [TOOLCHAIN, process.env['PATH'] ?? ''].join(delimiter), CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0',
});
const CARGO_ARGS = ['build', '--locked', '--bin', 'deep-gpu'];
const targetDir = (): string => { const t = process.env['CARGO_TARGET_DIR']; return t ? resolve(REPO, t) : join(REPO, 'target'); };
function cargoBuild(): string {
  const r = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: buildEnv() });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${CARGO_ARGS.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
/** Builds deep-gpu before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useGpu(): () => string {
  let dir = ''; let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-2742-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(targetDir(), 'debug', 'deep-gpu'), join(dir, 'deep-gpu'));
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => { expect(error, `deep-gpu builds: cargo ${CARGO_ARGS.join(' ')}`).toBe(''); return join(dir, 'deep-gpu'); };
}
/** A fresh temporary folder per test, deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-2742-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run`: one scenario line in, one line out (#377).

/** One `deep-gpu run` process: the calls in order, a reply per call. A run that hangs is stopped by spawnSync's own
 * timeout, which signals only this child. */
export function runGpu(bin: string, out: string, calls: JsonObject[]): JsonObject[] {
  const label = 'deep-gpu run';
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${label} did not finish within 1,800 s`);
  if (r.error) throw Error(`${label}: ${r.error.message}`);
  expect(r.status, `${label} exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${label}: one output line`).toBe(1);
  let answer: JsonValue;
  try { answer = JSON.parse(lines[0]!) as JsonValue; } catch { return expect.fail(`${label}: its line is JSON: ${lines[0]!.slice(0, 1500)}`); }
  const a = obj(answer, `${label}: the answer`);
  if (a['code'] === 'unsupported_platform') inconclusive(`${label} reports unsupported_platform`);
  expect(a['ok'], `${label} accepted the scenario: ${shown(a)}`).toBe(true);
  const replies = arr(a['replies'], `${label}: replies`).map((x, i) => obj(x, `${label}: replies[${i}]`));
  expect(replies.length, `${label}: one reply per call`).toBe(calls.length);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// AC1's documents (README: The fixture). One writer layer `main` at 1920 × 1080 in the shipped clean look. In draw order:
// the group `heavy` around WASHES full-frame rects at half opacity (heavy for the GPU to draw, light for the CPU to
// encode), then SPECKS tiny circles in the top-left corner (heavy for the CPU to encode, light for the GPU to draw).
// The composited side's group has `passes` (the shipped blur, so the GPU-layer compositor draws the layer); its twin is
// the same document with the group's `passes` removed.

export const SIZE = [1920, 1080] as const;
export const FRAMES = 60;
export const FPS = 60;
export const LOOK = 'clean';
export const FIXTURE = {
  washes: 64,
  opacity: 0.5,
  specks: 4000,
  /** Specks per row, their pitch and radius in px: a 400 × 160 px patch in the top-left corner. */
  perRow: 100, pitch: 4, r: 1.5,
  passes: [{ op: 'blur@1', params: { radius: 2 } }] as JsonValue[],
};

const item = (id: string, kind: string, order: string, params: JsonObject, extra: JsonObject = {}): JsonObject => ({ id, kind, layer: 'main', name: id, order, params, ...extra });
/** Draw order keys that sort as the items are listed. */
const order = (n: number): string => `a${String(n).padStart(6, '0')}`;

/** The composited side (`composited` true: the group has `passes`) or its twin (the group's `passes` removed). */
export function filmDoc(composited: boolean): JsonObject {
  const items: JsonObject = {};
  let n = 0;
  items['heavy'] = item('heavy', 'group@1', order(n++), composited ? { passes: FIXTURE.passes } : {});
  for (let i = 0; i < FIXTURE.washes; i++) {
    const id = `wash${i}`;
    items[id] = item(id, 'rect@1', order(n++), { box: [0, 0, SIZE[0], SIZE[1]], paint: { fill: { role: i % 2 === 0 ? 'raised' : 'accent', opacity: FIXTURE.opacity } } }, { parent: 'heavy' });
  }
  for (let i = 0; i < FIXTURE.specks; i++) {
    const id = `speck${i}`;
    const x = 20 + (i % FIXTURE.perRow) * FIXTURE.pitch; const y = 20 + Math.floor(i / FIXTURE.perRow) * FIXTURE.pitch;
    items[id] = item(id, 'circle@1', order(n++), { center: [x, y], r: FIXTURE.r, paint: { fill: { role: 'ink' } } });
  }
  return {
    format: 1, id: composited ? 'composited-2742' : 'twin-2742', profile: 'figure', title: composited ? 'Composited' : 'Twin',
    description: 'A #2742 acceptance fixture: GPU-heavy washes in a group, then CPU-heavy specks.', size: [...SIZE], transport: { span: '2s' },
    requires: { modules: { effects: '^1' } }, budget: { class: 'figure' }, layers: { main: { writer: 'agent-a', title: 'Main', order: 'a1' } }, items,
  };
}
/** `film2d` (#417's call) over `doc`: 60 frames at 60 fps in the clean look. */
export const filmCall = (doc: JsonObject): JsonObject => ({ call: 'film2d', doc, look: LOOK, frames: FRAMES, fps: FPS });

/** A `film2d` reply's rows, which must be every frame, 0 to 59 in order, each with a finite `gpu_ms` and `cpu_ms` at
 * or above 0: its `gpu_ms` readings. */
export function gpuReadings(reply: JsonObject, what: string): number[] {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  const rows = arr(reply['frames'], `${what}: frames`).map((v, i) => obj(v, `${what}: frames[${i}]`));
  expect(rows.length, `${what}: one row per frame played`).toBe(FRAMES);
  return rows.map((row, i) => {
    expect(row['frame'], `${what}: row ${i} is frame ${i}`).toBe(i);
    const cpu = num(row['cpu_ms'], `${what}: frame ${i}'s cpu_ms`);
    expect(cpu, `${what}: frame ${i}'s cpu_ms is at or above 0`).toBeGreaterThanOrEqual(0);
    const gpu = num(row['gpu_ms'], `${what}: frame ${i}'s gpu_ms`);
    expect(gpu, `${what}: frame ${i}'s gpu_ms is at or above 0`).toBeGreaterThanOrEqual(0);
    return gpu;
  });
}
/** Readings as the README and BASE-FAILURE.txt show them: median, min and max, then every reading, in ms. */
export function described(xs: readonly number[]): string {
  const f = (v: number): string => v.toFixed(3);
  return `median ${f(median(xs))}, min ${f(Math.min(...xs))}, max ${f(Math.max(...xs))}; every frame: ${xs.map(f).join(' ')}`;
}
