// Test-side tools for the #3617 acceptance tests: `deep-gpu` built once per file (debug, honoring CARGO_TARGET_DIR) and
// driven by #377's JSON-lines protocol; the one-pass and surface-handoff scenes and the exact bytes their frames hold,
// computed here from the scene alone; the checks the criteria's planted programs must fail; the fence audit; and the
// lane's judge (`node benchmarks/canvas.mjs judge`) for the draw-and-finish task. Nothing here stands in for the
// GPU layer, its timing report or the judge under test.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/3617 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const BIN_NAME = 'deep-gpu';
const TARGET = process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');
const UPLIFTED = join(TARGET, 'debug', process.platform === 'win32' ? `${BIN_NAME}.exe` : BIN_NAME);

/** The issue's numbers. */
export const DRAW_P95_MS = 0.5;
export const PARTS_TOLERANCE = 0.05;
export const PART_NAMES = ['encode', 'submit', 'gpu', 'wait'] as const;
export type PartName = (typeof PART_NAMES)[number];
export const TASK = 'canvas-gpu-draw-finish';
export const TARGET_NAME = 'draw_finish_p95_ms';
export const CRITERIA = { parts: '#3617.ac333e6b', onePass: '#3617.ff2c540d', planted: '#3617.55464991', pixels: '#3617.00965c72', inconclusive: '#3617.e5d2f1f1' } as const;

// ---------------------------------------------------------------------------------------------------
// JSON

export const isObject = (value: JsonValue | undefined): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonValue[];
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export const SHA = /^[0-9a-f]{64}$/;
export function p95(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]!;
}
export const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
export const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

// ---------------------------------------------------------------------------------------------------
// The build: one debug `deep-gpu` per file, copied out of the target folder so a later build can't change it.

function cargoBuild(): string {
  const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const run = spawnSync('cargo', ['build', '--locked', '--bin', BIN_NAME], { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo build --locked --bin ${BIN_NAME} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}

export function useBuild(): () => string {
  let dir = '';
  let bin = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-3617-bin-'));
    error = cargoBuild();
    bin = join(dir, BIN_NAME);
    if (error === '') copyFileSync(UPLIFTED, bin);
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo build --locked --bin ${BIN_NAME}`).toBe('');
    return bin;
  };
}

/** A fresh output folder per test (captures are written there), deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-3617-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// Starting the binary: `deep-gpu run [--planted <name>]`, one scenario line in, one line out (#377's protocol).

/** The wrong programs this suite reaches, each only through `--planted` (README: Planted programs). */
export type Planted = 'leaves_out_part' | 'sleeps_in_encode';

export function run(bin: string, sc: JsonObject, planted?: Planted, timeoutMs = 1_800_000): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const text = `${JSON.stringify(sc)}\n`;
  const r = spawnSync(bin, args, { cwd: REPO, input: text, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const shown = `${BIN_NAME} ${args.join(' ')}`;
  if (r.error) throw Error(`${shown}: ${r.error.message}`);
  expect(r.status, `${shown} exited 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${shown}: one output line per input line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${shown}: the answer`);
  expect(out['ok'], `${shown} refused the scenario: ${JSON.stringify(out).slice(0, 2000)}`).toBe(true);
  const replies = arr(out['replies'], 'run: replies').map((x, i) => obj(x, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(arr(sc['calls'], 'the scenario\'s calls').length);
  return replies;
}
export const scenario = (out: string, calls: JsonObject[]): JsonObject => ({ out, calls });

// ---------------------------------------------------------------------------------------------------
// Scenes (#377's format: README, The scene format)

export type Px = [number, number, number, number];
export interface Fill { color?: Px; ramp?: { step: number; channels: 'bgra' | 'bgr'; alpha?: number }; stamp?: { bits: number; cell: number; one: Px; zero: Px } }
export interface Region { name: string; rect: [number, number, number | null, number | null]; fill: Fill; moves?: { dx: number; dy: number; period: number } }
export interface Scene {
  scene: string; format: string; size: [number, number]; frames: number; fence_frames?: number; background: Px; regions?: Region[]; layers?: Region[]; pipelines?: unknown;
}
export const SCENES = { onePass: 'one-pass.scene', handoff: 'surface-handoff.scene' } as const;
export const scenePath = (file: string): string => join(HERE, 'fixtures', 'parity', 'gpu', file);
export const loadScene = (file: string): Scene => JSON.parse(readFileSync(scenePath(file), 'utf8')) as Scene;

function paint(buf: Buffer, w: number, h: number, region: Region, n: number): void {
  const [x0r, y0r, rw0, rh0] = region.rect;
  const k = region.moves ? n % region.moves.period : 0;
  const rx = x0r + (region.moves ? region.moves.dx * k : 0);
  const ry = y0r + (region.moves ? region.moves.dy * k : 0);
  const x0 = Math.max(0, rx); const y0 = Math.max(0, ry);
  const x1 = Math.min(w, rx + (rw0 ?? w - rx)); const y1 = Math.min(h, ry + (rh0 ?? h - ry));
  if (x1 <= x0 || y1 <= y0) return;
  const f = region.fill;
  const row = Buffer.alloc((x1 - x0) * 4);
  for (let x = x0; x < x1; x++) {
    let px: Px;
    if (f.color) px = f.color;
    else if (f.ramp) {
      const v = Math.min(255, Math.floor((x - rx) / f.ramp.step));
      px = f.ramp.channels === 'bgra' ? [v, v, v, v] : [v, v, v, f.ramp.alpha ?? 255];
    } else if (f.stamp) {
      const c = Math.floor((x - rx) / f.stamp.cell);
      const value = n % 2 ** f.stamp.bits;
      px = c < f.stamp.bits && ((value >> (f.stamp.bits - 1 - c)) & 1) === 1 ? f.stamp.one : f.stamp.zero;
    } else throw Error(`region ${region.name}: a fill the test-side generator can't draw`);
    row.set(px, (x - x0) * 4);
  }
  for (let y = y0; y < y1; y++) row.copy(buf, (y * w + x0) * 4);
}

const bases = new Map<string, Buffer>();
const isVarying = (r: Region): boolean => r.moves !== undefined || r.fill.stamp !== undefined;
/** The exact bytes frame n of a scene holds: BGRA8, premultiplied, rows top-down with no padding, regions painted in order (a varying region comes after every fixed one). */
export function slotHash(scene: Scene, n: number): string {
  const [w, h] = scene.size;
  const regions = scene.regions ?? [];
  let base = bases.get(scene.scene);
  if (!base) {
    base = Buffer.alloc(w * h * 4);
    base.fill(Buffer.from(scene.background));
    const firstVarying = regions.findIndex(isVarying);
    if (firstVarying >= 0 && regions.slice(firstVarying).some((r) => !isVarying(r))) throw Error(`scene ${scene.scene}: a fixed region follows a varying one`);
    for (const r of regions.filter((x) => !isVarying(x))) paint(base, w, h, r, 0);
    bases.set(scene.scene, base);
  }
  const out = Buffer.from(base);
  for (const r of regions.filter(isVarying)) paint(out, w, h, r, n);
  return sha256(out);
}

// ---------------------------------------------------------------------------------------------------
// The `frames` call with `timings` (README: The timing report)

export interface Frame {
  frame: number; drawn: boolean; size: [number, number]; path: string; pixel_hash: string | null;
  handoff_ms: number | null; draw_ms: number | null; parts: Partial<Record<PartName, number>> | null;
}
export interface FramesReply { frames: Frame[]; fences: JsonObject[] | null }
export const framesCall = (c: { scene: string; count?: number; path?: 'zero_copy' | 'copy'; fences?: boolean; timings?: boolean }): JsonObject =>
  ({ call: 'frames', ...(c as unknown as JsonObject), scene: scenePath(c.scene) });

const optNum = (v: JsonValue | undefined, what: string): number | null => (v === undefined || v === null ? null : num(v, what));

export function framesReply(reply: JsonObject, what: string): FramesReply {
  expect(reply['code'], `${what} was answered, not refused: ${JSON.stringify(reply).slice(0, 1500)}`).toBeUndefined();
  const frames = arr(reply['frames'], `${what}: frames`).map((v, i): Frame => {
    const f = obj(v, `${what}: frames[${i}]`);
    const hash = f['pixel_hash'] === undefined || f['pixel_hash'] === null ? null : str(f['pixel_hash'], `${what}: frames[${i}].pixel_hash`);
    let parts: Frame['parts'] = null;
    if (f['draw_parts_ms'] !== undefined && f['draw_parts_ms'] !== null) {
      const p = obj(f['draw_parts_ms'], `${what}: frames[${i}].draw_parts_ms`);
      parts = {};
      for (const [k, x] of Object.entries(p)) {
        expect(PART_NAMES as readonly string[], `${what}: frames[${i}].draw_parts_ms names only the parts ${PART_NAMES.join(', ')}, got ${k}`).toContain(k);
        parts[k as PartName] = num(x, `${what}: frames[${i}].draw_parts_ms.${k}`);
      }
    }
    return {
      frame: num(f['frame'], `${what}: frames[${i}].frame`), drawn: f['drawn'] === true,
      size: arr(f['size'], `${what}: frames[${i}].size`).map((s) => num(s, 'size')) as [number, number], path: str(f['path'], `${what}: frames[${i}].path`),
      pixel_hash: hash, handoff_ms: optNum(f['handoff_ms'], `${what}: frames[${i}].handoff_ms`), draw_ms: optNum(f['draw_ms'], `${what}: frames[${i}].draw_ms`), parts,
    };
  });
  const fences = reply['fences'] === undefined ? null : arr(reply['fences'], `${what}: fences`).map((e, i) => obj(e, `${what}: fences[${i}]`));
  return { frames, fences };
}

/** Every frame carries its draw-and-finish time and all four parts, as finite numbers at or above zero. */
export function expectReported(frames: Frame[], what: string): void {
  for (const f of frames) {
    expect(f.draw_ms !== null && f.draw_ms > 0, `${what}: frame ${f.frame} reports draw_ms above 0, got ${f.draw_ms}`).toBe(true);
    expect(f.handoff_ms, `${what}: frame ${f.frame} still reports handoff_ms beside draw_ms`).not.toBeNull();
    expect(f.parts, `${what}: frame ${f.frame} reports draw_parts_ms`).not.toBeNull();
    for (const p of PART_NAMES) expect(typeof f.parts![p] === 'number' && f.parts![p]! >= 0, `${what}: frame ${f.frame}'s draw_parts_ms.${p} is a number at or above 0, got ${f.parts![p]}`).toBe(true);
  }
}

/** Each frame whose parts (a part left out counts as nothing) don't add up to its whole within 5%, named by frame. */
export function partsProblems(frames: Frame[], what: string): string[] {
  const out: string[] = [];
  for (const f of frames) {
    if (f.draw_ms === null || f.parts === null) { out.push(`${what}: frame ${f.frame} reports no draw_ms or no draw_parts_ms`); continue; }
    const sum = PART_NAMES.reduce((s, p) => s + (f.parts![p] ?? 0), 0);
    if (Math.abs(sum - f.draw_ms) > PARTS_TOLERANCE * f.draw_ms) out.push(`${what}: frame ${f.frame}: its parts add to ${sum.toFixed(4)} ms, its draw-and-finish time is ${f.draw_ms.toFixed(4)} ms, more than 5% apart`);
  }
  return out;
}

/** The part each frame's time went to, over the run: the part with the largest mean (ties: the first in encode, submit, gpu, wait order). */
export function largestPart(frames: Frame[]): PartName {
  const means = PART_NAMES.map((p) => [p, mean(frames.map((f) => f.parts?.[p] ?? 0))] as const);
  return means.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
}

/** The timing check on a run's frames, test side: the sentences it fails with, naming the part, or none when p95 is within the limit. */
export function timingProblems(frames: Frame[], what: string, limit = DRAW_P95_MS): string[] {
  const at = p95(frames.map((f) => f.draw_ms ?? Infinity));
  return at > limit ? [`${what}: draw-and-finish p95 ${at.toFixed(3)} ms is over ${limit} ms; the time went to ${largestPart(frames)}`] : [];
}

// ---------------------------------------------------------------------------------------------------
// The fence record (#377's README, Fences): replays each slot's states; each problem names the slot, the frame and the event.

export function fenceProblems(events: JsonObject[], slotCount: number, what: string): string[] {
  const problems: string[] = [];
  const state = new Map<number, { state: string; frame: number | null; cbs: Set<string> }>();
  const done = new Set<string>();
  let last = -Infinity;
  for (const e of events) {
    const seq = num(e['seq'], 'fence seq');
    const event = str(e['event'], 'fence event');
    if (!(seq > last)) problems.push(`${what}: fence event ${seq} isn't after ${last}`);
    last = seq;
    const cb = e['cb'] === undefined || e['cb'] === null ? null : String(e['cb']);
    if (event === 'gpui_done') { if (cb === null) problems.push(`${what}: gpui_done at ${seq} names no command buffer`); else done.add(cb); continue; }
    const slot = e['slot'] as number;
    const frame = (e['frame'] ?? null) as number | null;
    if (!Number.isInteger(slot) || slot < 0 || slot >= slotCount) { problems.push(`${what}: ${event} at ${seq} names slot ${slot}, not one of ${slotCount}`); continue; }
    const s = state.get(slot) ?? { state: 'free', frame: null, cbs: new Set<string>() };
    const at = `slot ${slot}, frame ${frame}, event ${seq}`;
    if (event === 'render') {
      if (s.state !== 'free') problems.push(`${what}: rendered into a slot that is ${s.state} (${at})`);
      state.set(slot, { state: 'rendering', frame, cbs: new Set() });
    } else if (event === 'gpu_done') {
      if (s.state !== 'rendering' || s.frame !== frame) problems.push(`${what}: gpu_done for a slot not rendering that frame (${at})`);
      state.set(slot, { ...s, state: 'ready' });
    } else if (event === 'show') {
      if (s.state !== 'ready' && s.state !== 'on_screen') problems.push(`${what}: shown before its gpu_done (${at})`);
      if (s.frame !== frame) problems.push(`${what}: shown as frame ${frame} but holds frame ${s.frame} (${at})`);
      if (cb === null) problems.push(`${what}: show names no command buffer (${at})`); else s.cbs.add(cb);
      state.set(slot, { ...s, state: 'on_screen' });
    } else if (event === 'release') {
      if (s.state !== 'on_screen') problems.push(`${what}: released a slot that isn't on screen (${at})`);
      const pending = [...s.cbs].filter((c) => !done.has(c));
      if (pending.length) problems.push(`${what}: released before GPUI's command buffer ${pending.join(', ')} completed (${at})`);
      state.set(slot, { state: 'free', frame: null, cbs: new Set() });
    } else problems.push(`${what}: unknown fence event ${event} at ${seq}`);
  }
  return problems;
}
/** Each of `count` frames is rendered once, in order, and shown. */
export function fenceCoverage(events: JsonObject[], count: number, what: string): string[] {
  const rendered = events.filter((e) => e['event'] === 'render').map((e) => e['frame']);
  const shown = new Set(events.filter((e) => e['event'] === 'show').map((e) => e['frame']));
  const want = Array.from({ length: count }, (_, i) => i);
  const problems: string[] = [];
  if (JSON.stringify(rendered) !== JSON.stringify(want)) problems.push(`${what}: the record renders ${rendered.length} frames, not each of the ${count} once in order`);
  const missing = want.filter((n) => !shown.has(n));
  if (missing.length) problems.push(`${what}: ${missing.length} frames are never shown (first ${missing[0]})`);
  return problems;
}

// ---------------------------------------------------------------------------------------------------
// The lane's judge: `node benchmarks/canvas.mjs judge`, a report on stdin, a verdict on its last stdout line.

export const REFERENCE_FINGERPRINT: JsonObject = {
  model: 'Mac17,10', chip: 'Apple M5 Max', memoryBytes: 64 * 2 ** 30, power: 'ac', lowPowerMode: false, thermalState: 'nominal', macosBuild: '26B8119',
  build: { profile: 'release', toolchain: 'rustc 1.99.1' },
};
export const CORES = availableParallelism();

export interface Reading { draw: number; parts?: Partial<Record<PartName, number>>; load?: [number, number] }
/** A report the way the bench prints it: `{task, fingerprint, runs}`, one run per reading (README: The report and the judge). */
export function report(readings: Reading[], fingerprint: JsonObject = REFERENCE_FINGERPRINT): JsonObject {
  return {
    task: TASK, fingerprint,
    runs: readings.map((r) => ({ [TARGET_NAME]: r.draw, parts_mean_ms: r.parts ?? { encode: r.draw * 0.25, submit: r.draw * 0.25, gpu: r.draw * 0.25, wait: r.draw * 0.25 }, loadStart: (r.load ?? [1, 1])[0], loadEnd: (r.load ?? [1, 1])[1] })),
  };
}
export function judgeReport(current: JsonObject): JsonObject {
  const r = spawnSync(process.execPath, [join(REPO, 'benchmarks', 'canvas.mjs'), 'judge'], { cwd: REPO, input: JSON.stringify({ current, base: null }), encoding: 'utf8', timeout: 120_000 });
  expect(r.status, `node benchmarks/canvas.mjs judge answered the report: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const last = (r.stdout ?? '').trim().split('\n').at(-1) ?? '';
  return obj(JSON.parse(last) as JsonValue, 'the judge\'s verdict');
}

/** Why a timing can't count on this machine now ('' when it can): the lane's own judge on five empty readings, the load read now. */
export function machineProblem(): string {
  const script = `import * as b from ${JSON.stringify(join(REPO, 'scripts', 'benchmark.mjs'))};import { loadavg } from 'node:os';const now = loadavg()[0];` +
    'const v = b.judgeLimit({ limit: 1, runs: [0, 0, 0, 0, 0], fingerprint: b.fingerprint(), loads: Array.from({ length: 5 }, () => ({ start: now, end: now })) });process.stdout.write(JSON.stringify(v));';
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: REPO, encoding: 'utf8', timeout: 120_000 });
  expect(r.status, `scripts/benchmark.mjs ran: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const v = JSON.parse(r.stdout) as JsonObject;
  return v['status'] === 'PASS' ? '' : String(v['reason'] ?? v['status']);
}
