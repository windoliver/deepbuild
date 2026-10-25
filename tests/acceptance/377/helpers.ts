// Test-side tools for the #377 acceptance tests: `deep-gpu` built per Cargo feature set (as #305's and
// #387's suites build `deep-show`), driven by JSON lines; the scenes under fixtures/parity/gpu and the
// exact bytes their frames hold, computed here from the scene alone; PNG reading and writing; the
// checks the criteria's planted programs must fail, each returning its failures as sentences that name
// what failed; and #305's reference-Mac gate with the design's judge for timing results. Nothing here
// stands in for the GPU layer, the handoff, the fences or the blank guard under test.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect, type TestContext } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/377 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const BIN_NAME = 'deep-gpu';
const UPLIFTED = join(REPO, 'target', 'debug', process.platform === 'win32' ? `${BIN_NAME}.exe` : BIN_NAME);
/** A startup the binary refuses (an unknown argument or planted name) exits with this status after one line. */
export const REFUSED_EXIT = 2;

/** The criteria's numbers. */
export const HANDOFF_P95_MS = 1;
export const UI_MS = 0.1;
export const COMPILE_STALL_MS = 2;
export const BLANK_LUMA = 0.06;
export const BLANK_COVERAGE = 0.98;

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
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
export function strs(value: JsonValue | undefined, what: string): string[] {
  return arr(value, what).map((v, i) => str(v, `${what}[${i}]`));
}
export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export const SHA = /^[0-9a-f]{64}$/;

/** Every number anywhere in a JSON value, with its path: a BLOCKED comparison must hold none. */
export function numbersIn(value: JsonValue | undefined, path = ''): string[] {
  if (typeof value === 'number') return [`${path || '(root)'} = ${value}`];
  if (Array.isArray(value)) return value.flatMap((v, i) => numbersIn(v, `${path}[${i}]`));
  if (isObject(value)) return Object.entries(value).flatMap(([k, v]) => numbersIn(v, path ? `${path}.${k}` : k));
  return [];
}

// ---------------------------------------------------------------------------------------------------
// Builds: one `deep-gpu` per Cargo feature set, built once per file, each kept under its own name.

/** `default` is the shipped build; `test-pool` adds the test encode pool (README: Builds). */
export type Build = 'default' | 'test-pool';
const featuresOf = (build: Build): string[] => (build === 'default' ? [] : [build]);

function cargoBuild(build: Build): string {
  const args = ['build', '--locked', '--bin', BIN_NAME, ...(featuresOf(build).length ? ['--features', featuresOf(build).join(',')] : [])];
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}

export interface Builds { bin: (build?: Build) => string }

/** Builds every listed set once, before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useBuilds(builds: readonly Build[] = ['default']): Builds {
  let dir = '';
  const made = new Map<Build, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-377-bins-'));
    for (const build of builds) {
      if (made.has(build)) continue;
      const error = cargoBuild(build);
      const bin = join(dir, `${BIN_NAME}-${build}`);
      if (error === '') copyFileSync(UPLIFTED, bin);
      made.set(build, { bin, error });
    }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(build: Build = 'default'): string {
      const entry = made.get(build);
      if (!entry) throw Error(`the file didn't list the build ${build} in useBuilds`);
      expect(entry.error, `the binary builds: cargo build --locked --bin ${BIN_NAME}${featuresOf(build).length ? ` --features ${featuresOf(build).join(',')}` : ''}`).toBe('');
      return entry.bin;
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// Starting the binary: `deep-gpu run [--backend noop] [--planted <name>]`, one scenario line in, one line out.

export interface Started { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string; ms: number }

export function start(bin: string, args: string[], inputs: (JsonValue | string)[], timeoutMs = 1_800_000): Started {
  const text = inputs.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n');
  const began = performance.now();
  const run = spawnSync(bin, args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const ms = performance.now() - began;
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${BIN_NAME} ${args.join(' ')}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  const lines = stdout.split('\n').filter((line) => line !== '').map((line) => {
    try { return JSON.parse(line) as JsonValue; } catch { return line; }
  });
  return { status: run.status, signal: run.signal, timedOut, lines, stdout, stderr: run.stderr ?? '', ms };
}

export interface Startup { backend?: 'noop'; planted?: Planted }
/** The wrong programs, each reachable only through `--planted` (README: Planted programs). */
export type Planted = 'divides_alpha' | 'draws_surfaces_after_scene' | 'submits_on_completion' | 'releases_before_completion' | 'waits_on_gpu' | 'compiles_on_ui_thread' | 'exposes_gpu_to_panels';

export const startArgs = (startup: Startup = {}): string[] =>
  ['run', ...(startup.backend ? ['--backend', startup.backend] : []), ...(startup.planted ? ['--planted', startup.planted] : [])];

/** One scenario, accepted, with one reply per call. */
export function run(bin: string, sc: JsonObject, startup: Startup = {}, timeoutMs?: number): JsonObject[] {
  const args = startArgs(startup);
  const s = start(bin, args, [sc], timeoutMs);
  const shown = `${BIN_NAME} ${args.join(' ')}`;
  expect(s.timedOut, `${shown} finished within its timeout`).toBe(false);
  expect(s.status, `${shown} exited 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-3000)}`).toBe(0);
  expect(s.lines.length, `${shown}: one output line per input line`).toBe(1);
  const out = obj(s.lines[0], `${shown}: the answer`);
  expect(out['ok'], `${shown} refused the scenario: ${JSON.stringify(out).slice(0, 2000)}`).toBe(true);
  const replies = arr(out['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(arr(sc['calls'], 'the scenario\'s calls').length);
  return replies;
}

/** A fresh output folder per test (captures are written there), deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-377-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

export const scenario = (out: string, calls: JsonObject[]): JsonObject => ({ out, calls });

// ---------------------------------------------------------------------------------------------------
// Scenes (README: The scene format)

export type Px = [number, number, number, number];
export interface Fill {
  color?: Px;
  ramp?: { step: number; channels: 'bgra' | 'bgr'; alpha?: number };
  stamp?: { bits: number; cell: number; one: Px; zero: Px };
  texture?: { w: number; h: number; pattern: 'xor' };
  pipeline?: number;
}
export interface Region { name: string; rect: [number, number, number | null, number | null]; fill: Fill; moves?: { dx: number; dy: number; period: number } }
export interface Scene {
  scene: string; format: string; color_space: string; size: [number, number]; frames: number;
  fence_frames?: number; stale_frames?: number; resize?: { every: number; sizes: [number, number][] } | null; device_loss_at?: number | null;
  window: [number, number]; view: [number, number]; page: { cell: number; colors: [number, number, number][] }; background: Px;
  regions?: Region[]; layers?: Region[]; budget_class?: { upload_bytes_per_frame: number };
}
export const SCENES = {
  handoff: 'surface-handoff.scene', encode: 'encode-layers.scene', settling: 'settling.scene', pipelines: 'pipelines.scene', blank: 'blank.scene',
} as const;
/** A scene's absolute path, as the calls take it. */
export const scenePath = (file: string): string => join(HERE, 'fixtures', 'parity', 'gpu', file);
export const loadScene = (file: string): Scene => JSON.parse(readFileSync(scenePath(file), 'utf8')) as Scene;

/** The surface size scheduled for frame n: the scene's, or with `resize` on, the size its schedule gives. */
export function sizeAt(scene: Scene, n: number, resize: boolean): [number, number] {
  if (!resize || !scene.resize) return scene.size;
  const { every, sizes } = scene.resize;
  return sizes[Math.floor(n / every) % sizes.length]!;
}

/** A region's rect in frame px for frame n at size [w, h], unclipped (null w or h runs to the frame's edge). */
export function rectAt(region: Region, n: number, [w, h]: [number, number]): [number, number, number, number] {
  const [x0, y0, rw, rh] = region.rect;
  const k = region.moves ? n % region.moves.period : 0;
  const x = x0 + (region.moves ? region.moves.dx * k : 0);
  const y = y0 + (region.moves ? region.moves.dy * k : 0);
  return [x, y, rw ?? w - x, rh ?? h - y];
}

function paint(buf: Buffer, w: number, h: number, region: Region, n: number): void {
  const [rx, ry, rw, rh] = rectAt(region, n, [w, h]);
  const x0 = Math.max(0, rx); const y0 = Math.max(0, ry);
  const x1 = Math.min(w, rx + rw); const y1 = Math.min(h, ry + rh);
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
      const k = Math.floor((x - rx) / f.stamp.cell);
      const value = n % 2 ** f.stamp.bits;
      px = k < f.stamp.bits && ((value >> (f.stamp.bits - 1 - k)) & 1) === 1 ? f.stamp.one : f.stamp.zero;
    } else if (f.texture) {
      px = [0, 0, 0, 0]; // per texel, below
    } else throw Error(`region ${region.name} has a fill the test-side generator can't draw: ${JSON.stringify(f)}`);
    row.set(px, (x - x0) * 4);
  }
  for (let y = y0; y < y1; y++) {
    if (f.texture) {
      const ty = y - ry;
      for (let x = x0; x < x1; x++) {
        const tx = x - rx;
        row.set([tx & 255, ty & 255, (tx ^ ty) & 255, 255], (x - x0) * 4);
      }
    }
    row.copy(buf, (y * w + x0) * 4);
  }
}

const baseCache = new Map<string, Buffer>();
/**
 * The exact bytes frame n of a scene holds at size [w, h] (README: The scene format): BGRA8, premultiplied,
 * rows top-down with no padding, regions painted in order, each replacing what's under it. Scenes whose
 * pixels come from GPU blending (`layers`) or pipelines aren't generated here.
 */
export function slotBytes(scene: Scene, n: number, size: [number, number]): Buffer {
  const [w, h] = size;
  const key = `${scene.scene}@${w}x${h}`;
  const regions = scene.regions ?? [];
  const fixed = regions.filter((r) => !r.moves && !r.fill.stamp);
  const varying = regions.filter((r) => r.moves || r.fill.stamp);
  let base = baseCache.get(key);
  if (!base) {
    base = Buffer.alloc(w * h * 4);
    const bg = Buffer.from(scene.background);
    for (let i = 0; i < w * h; i++) bg.copy(base, i * 4);
    // Painting in order means a varying region must not lie under a fixed one painted after it.
    const firstVarying = regions.findIndex((r) => r.moves || r.fill.stamp);
    if (firstVarying >= 0 && regions.slice(firstVarying).some((r) => !r.moves && !r.fill.stamp)) throw Error(`scene ${scene.scene}: a fixed region follows a varying one`);
    for (const r of fixed) paint(base, w, h, r, 0);
    baseCache.set(key, base);
  }
  const out = Buffer.from(base);
  for (const r of varying) paint(out, w, h, r, n);
  return out;
}
export const slotHash = (scene: Scene, n: number, size: [number, number]): string => sha256(slotBytes(scene, n, size));
/** A frame of the scene's background alone, at size: what a frame that drew nothing over it holds. */
export const backgroundHash = (scene: Scene, size: [number, number]): string => {
  const buf = Buffer.alloc(size[0] * size[1] * 4);
  const bg = Buffer.from(scene.background);
  for (let i = 0; i < size[0] * size[1]; i++) bg.copy(buf, i * 4);
  return sha256(buf);
};

// ---------------------------------------------------------------------------------------------------
// Calls (README: Calls)

export interface FramesCall {
  scene: string; from?: number; count?: number; path?: 'zero_copy' | 'copy'; layer?: boolean; card?: JsonObject;
  capture?: 'every' | number[]; window_hash?: boolean; resize?: boolean; lose_device_at?: number; fences?: boolean;
  timings?: boolean; workers?: number; pool?: { order: 'reverse' } | { order: 'seeded'; seed: number };
}
export const framesCall = (c: FramesCall): JsonObject => ({ call: 'frames', ...(c as unknown as JsonObject), scene: scenePath(c.scene) });
export const SURFACE: JsonObject = { call: 'surface' };
export const RESOURCES: JsonObject = { call: 'resources' };
export const HEALTH: JsonObject = { call: 'health' };
export const DECISIONS: JsonObject = { call: 'decisions' };
export const conformanceCall = (file: string): JsonObject => ({ call: 'conformance', scene: scenePath(file) });
export const compileCall = (file: string): JsonObject => ({ call: 'compile', scene: scenePath(file) });
export const renderCall = (file: string, frame: number, purpose: 'canonical' | 'export' | 'snapshot'): JsonObject => ({ call: 'render', scene: scenePath(file), frame, purpose });

export interface Encode { layer: number; completed: number; submitted: number }
export interface Frame {
  frame: number; size: [number, number]; path: string; pixel_hash: string | null; settling: boolean;
  window: string | null; window_hash: string | null; handoff_ms: number | null; ui_ms: number | null; encodes: Encode[] | null;
}
export interface Fence { seq: number; event: string; slot: number | null; frame: number | null; cb: string | null }
export interface FramesReply { frames: Frame[]; fences: Fence[] | null; device_losses: number; raw: JsonObject }

const optNum = (v: JsonValue | undefined, what: string): number | null => (v === undefined || v === null ? null : num(v, what));
const optStr = (v: JsonValue | undefined, what: string): string | null => (v === undefined || v === null ? null : str(v, what));

export function framesReply(reply: JsonObject, what = 'the frames call'): FramesReply {
  expect(reply['code'], `${what} was answered, not refused: ${JSON.stringify(reply).slice(0, 1500)}`).toBeUndefined();
  const frames = arr(reply['frames'], `${what}: frames`).map((v, i): Frame => {
    const f = obj(v, `${what}: frames[${i}]`);
    const size = arr(f['size'], `${what}: frames[${i}].size`).map((s, j) => num(s, `${what}: frames[${i}].size[${j}]`)) as [number, number];
    const pixel = optStr(f['pixel_hash'], `${what}: frames[${i}].pixel_hash`);
    if (pixel !== null) expect(pixel, `${what}: frames[${i}].pixel_hash is a SHA-256 in lowercase hex`).toMatch(SHA);
    const encodes = f['encodes'] === undefined ? null : arr(f['encodes'], `${what}: frames[${i}].encodes`).map((e, j): Encode => {
      const o = obj(e, `${what}: frames[${i}].encodes[${j}]`);
      return { layer: num(o['layer'], 'encode layer'), completed: num(o['completed'], 'encode completed'), submitted: num(o['submitted'], 'encode submitted') };
    });
    expect(typeof f['settling'], `${what}: frames[${i}].settling is a boolean`).toBe('boolean');
    return {
      frame: num(f['frame'], `${what}: frames[${i}].frame`), size, path: str(f['path'], `${what}: frames[${i}].path`), pixel_hash: pixel,
      settling: f['settling'] as boolean, window: optStr(f['window'], `${what}: frames[${i}].window`), window_hash: optStr(f['window_hash'], `${what}: frames[${i}].window_hash`),
      handoff_ms: optNum(f['handoff_ms'], `${what}: frames[${i}].handoff_ms`), ui_ms: optNum(f['ui_ms'], `${what}: frames[${i}].ui_ms`), encodes,
    };
  });
  const fences = reply['fences'] === undefined ? null : arr(reply['fences'], `${what}: fences`).map((v, i): Fence => {
    const e = obj(v, `${what}: fences[${i}]`);
    return { seq: num(e['seq'], `fences[${i}].seq`), event: str(e['event'], `fences[${i}].event`), slot: optNum(e['slot'], `fences[${i}].slot`), frame: optNum(e['frame'], `fences[${i}].frame`), cb: e['cb'] === undefined || e['cb'] === null ? null : String(e['cb']) };
  });
  return { frames, fences, device_losses: num(reply['device_losses'] ?? 0, `${what}: device_losses`), raw: reply };
}

/** A frames reply that presented every frame in [from, from + count) once, in order. */
export function everyFrame(r: FramesReply, from: number, count: number, what: string): void {
  expect(r.frames.map((f) => f.frame), `${what}: every frame from ${from} presented once, in order`).toEqual(Array.from({ length: count }, (_, i) => from + i));
}

export interface Surface {
  device: { backend: string; count: number }; path: string; size_px: [number, number]; scale: number; internal_scale: number; format: string;
  color_space: string; slots: { state: string }[]; msaa: string; fps_cap: number | null; raw: JsonObject;
}
export function surfaceReply(reply: JsonObject, what = 'the surface call'): Surface {
  const d = obj(reply['device'], `${what}: device`);
  return {
    device: { backend: str(d['backend'], `${what}: device.backend`), count: num(d['count'], `${what}: device.count`) },
    path: str(reply['path'], `${what}: path`),
    size_px: arr(reply['size_px'], `${what}: size_px`).map((v) => num(v, `${what}: size_px`)) as [number, number],
    scale: num(reply['scale'], `${what}: scale`), internal_scale: num(reply['internal_scale'], `${what}: internal_scale`),
    format: str(reply['format'], `${what}: format`), color_space: str(reply['color_space'], `${what}: color_space`),
    slots: arr(reply['slots'], `${what}: slots`).map((s, i) => ({ state: str(obj(s, `${what}: slots[${i}]`)['state'], `${what}: slots[${i}].state`) })),
    msaa: str(reply['msaa'], `${what}: msaa`), fps_cap: optNum(reply['fps_cap'], `${what}: fps_cap`), raw: reply,
  };
}

export interface Resource { module: string; name: string; kind: string; device_epoch: number }
export function resourcesReply(reply: JsonObject, what = 'the resources call'): { device_epoch: number; resources: Resource[] } {
  return {
    device_epoch: num(reply['device_epoch'], `${what}: device_epoch`),
    resources: arr(reply['resources'], `${what}: resources`).map((v, i) => {
      const r = obj(v, `${what}: resources[${i}]`);
      return { module: str(r['module'], `${what}: resources[${i}].module`), name: str(r['name'], `${what}: resources[${i}].name`), kind: str(r['kind'], `${what}: resources[${i}].kind`), device_epoch: num(r['device_epoch'], `${what}: resources[${i}].device_epoch`) };
    }),
  };
}

export const PARTS = ['identical', 'premultiplied', 'fences', 'stale_or_torn', 'budget'] as const;
export interface Conformance { platform: string; result: string; parts: { part: string; result: string }[]; path: string }
export function conformanceReply(reply: JsonObject, what = 'the conformance call'): Conformance {
  return {
    platform: str(reply['platform'], `${what}: platform`), result: str(reply['result'], `${what}: result`), path: str(reply['path'], `${what}: path`),
    parts: arr(reply['parts'], `${what}: parts`).map((v, i) => { const p = obj(v, `${what}: parts[${i}]`); return { part: str(p['part'], `${what}: parts[${i}].part`), result: str(p['result'], `${what}: parts[${i}].result`) }; }),
  };
}

// ---------------------------------------------------------------------------------------------------
// PNG

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(4); head.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(typed));
  return Buffer.concat([head, typed, tail]);
}

export interface Image { width: number; height: number; /** RGBA, row-major. */ rgba: Uint8Array }

/** An 8-bit RGBA PNG of an image. */
export function encodePng(image: Image): Buffer {
  const { width, height, rgba } = image;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (1 + width * 4) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Reads an 8-bit RGB or RGBA PNG with no interlace. */
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let at = 8;
  let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (at < file.length) {
    const length = file.readUInt32BE(at);
    const type = file.toString('latin1', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!;
    } else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}; the reader takes 8-bit RGB/RGBA, no interlace`);
  const channels = color === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0;
      const b = previous[i]!;
      const c = i >= channels ? previous[i - channels]! : 0;
      const x = line[i]!;
      let v: number;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: v = x + paeth(a, b, c); break;
        default: throw Error(`PNG filter ${filter}`);
      }
      line[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      rgba[o] = line[x * channels]!; rgba[o + 1] = line[x * channels + 1]!; rgba[o + 2] = line[x * channels + 2]!;
      rgba[o + 3] = channels === 4 ? line[x * channels + 3]! : 255;
    }
    previous = line;
  }
  return { width, height, rgba };
}

/** A window capture the binary wrote, read back by its hash (`<out>/<sha256>.png`, the hash of the file's bytes). */
export function readCapture(out: string, hash: string | null, what: string): Image {
  expect(hash, `${what} carries a capture`).not.toBeNull();
  expect(hash, `${what}'s capture is named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${hash}.png`));
  expect(sha256(file), `${what}'s capture file hashes to its name`).toBe(hash);
  return decodePng(file);
}
/** SHA-256 of an image's pixels as RGBA8 rows top-down with no padding: the `window_hash` of a capture. */
export const imageHash = (image: Image): string => sha256(image.rgba);

/** Writes an image as an RGBA PNG under dir; returns its path and the file's SHA-256. */
export function writePng(dir: string, name: string, image: Image): { path: string; sha: string } {
  const bytes = encodePng(image);
  const path = join(dir, `${name}.png`);
  writeFileSync(path, bytes);
  return { path, sha: sha256(bytes) };
}
/** An opaque image of one RGB color, with optional pixels painted over it. */
export function solid(width: number, height: number, rgb: [number, number, number], paint?: (x: number, y: number) => [number, number, number] | null): Image {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const c = paint?.(x, y) ?? rgb;
    rgba.set([c[0], c[1], c[2], 255], (y * width + x) * 4);
  }
  return { width, height, rgba };
}

// ---------------------------------------------------------------------------------------------------
// The test's own blank guard (README: these tests' own comparisons run it too): a frame is blank or
// black when the luma of at least 98% of its pixels is at most 0.06 (Rec. 709 weights on the 8-bit
// encoded values over 255).

export function blankShare(image: Image, region?: [number, number, number, number]): number {
  const [x0, y0, w, h] = region ?? [0, 0, image.width, image.height];
  let dark = 0;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const o = (y * image.width + x) * 4;
    const luma = (0.2126 * image.rgba[o]! + 0.7152 * image.rgba[o + 1]! + 0.0722 * image.rgba[o + 2]!) / 255;
    if (luma <= BLANK_LUMA) dark++;
  }
  return dark / (w * h);
}
export function expectNotBlank(image: Image, what: string, region?: [number, number, number, number]): void {
  const share = blankShare(image, region);
  expect(share < BLANK_COVERAGE, `BLOCKED: ${what} is blank or black (${(share * 100).toFixed(2)}% of its pixels at luma ≤ ${BLANK_LUMA}), so it can't be compared`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// Window checks. The view shows the slot at `scene.view` in window px, at the frame's size.

/** The slot pixel (x, y) of frame bytes as [r, g, b, a] (the slot is BGRA). */
const slotPx = (bytes: Buffer, w: number, x: number, y: number): [number, number, number, number] => {
  const o = (y * w + x) * 4;
  return [bytes[o + 2]!, bytes[o + 1]!, bytes[o]!, bytes[o + 3]!];
};

/**
 * Where the slot is premultiplied (regions `names`), the window must hold the f64 premultiplied over of
 * the slot onto the page: out = slot + page × (1 − alpha), within one code value per channel. Failures
 * name the region and count its pixels off.
 */
export function overProblems(scene: Scene, n: number, size: [number, number], window: Image, page: Image, names: string[], what: string): string[] {
  const bytes = slotBytes(scene, n, size);
  const [vx, vy] = scene.view;
  const problems: string[] = [];
  for (const name of names) {
    const region = (scene.regions ?? []).find((r) => r.name === name);
    if (!region) throw Error(`scene ${scene.scene} has no region ${name}`);
    const [rx, ry, rw, rh] = rectAt(region, n, size);
    let off = 0; let total = 0; let worst = '';
    for (let y = ry; y < Math.min(size[1], ry + rh); y++) for (let x = rx; x < Math.min(size[0], rx + rw); x++) {
      const s = slotPx(bytes, size[0], x, y);
      if (s[3] === 255) continue; // opaque pixels (the object inside the glow) aren't over the page
      total++;
      const o = ((vy + y) * window.width + (vx + x)) * 4;
      for (let c = 0; c < 3; c++) {
        const expected = Math.min(255, s[c]! + page.rgba[o + c]! * (1 - s[3] / 255));
        if (Math.abs(window.rgba[o + c]! - expected) > 1) { off++; if (!worst) worst = `at view (${x}, ${y}) channel ${'rgb'[c]} the window holds ${window.rgba[o + c]}, the over gives ${expected.toFixed(2)}`; break; }
      }
    }
    if (total === 0) problems.push(`${what}: region ${name} has no premultiplied pixel to check`);
    else if (off > 0) problems.push(`${what}: ${name}: ${off} of ${total} pixels are more than one code value from the f64 premultiplied over of the slot onto the page (first ${worst})`);
  }
  return problems;
}

/**
 * Stale or torn: where frame n's slot is opaque, the window shows exactly the slot of frame n at its size;
 * outside the view's rect at that size, the window shows exactly the page. A stale frame (an earlier
 * frame, or one drawn for the old size) or a torn one (rows of two frames) breaks one of these.
 */
export function staleProblems(scene: Scene, n: number, size: [number, number], window: Image, page: Image, what: string): string[] {
  const bytes = slotBytes(scene, n, size);
  const [vx, vy] = scene.view;
  const [w, h] = size;
  let inside = 0; let firstIn = '';
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = slotPx(bytes, w, x, y);
    if (s[3] !== 255) continue;
    const o = ((vy + y) * window.width + (vx + x)) * 4;
    if (window.rgba[o] !== s[0] || window.rgba[o + 1] !== s[1] || window.rgba[o + 2] !== s[2]) {
      inside++;
      if (!firstIn) firstIn = `view (${x}, ${y}) holds ${window.rgba[o]},${window.rgba[o + 1]},${window.rgba[o + 2]}, frame ${n}'s slot ${s.slice(0, 3).join(',')}`;
    }
  }
  let outside = 0; let firstOut = '';
  for (let y = 0; y < window.height; y++) for (let x = 0; x < window.width; x++) {
    if (x >= vx && x < vx + w && y >= vy && y < vy + h) continue;
    const o = (y * window.width + x) * 4;
    if (window.rgba[o] !== page.rgba[o] || window.rgba[o + 1] !== page.rgba[o + 1] || window.rgba[o + 2] !== page.rgba[o + 2]) {
      outside++;
      if (!firstOut) firstOut = `window (${x}, ${y})`;
    }
  }
  const problems: string[] = [];
  if (inside) problems.push(`${what}: frame ${n} at ${w} × ${h}: ${inside} opaque slot pixels differ in the window (first ${firstIn}): a stale or torn frame`);
  if (outside) problems.push(`${what}: frame ${n} at ${w} × ${h}: ${outside} window pixels outside the view's ${w} × ${h} rect differ from the page (first ${firstOut}): a frame of another size`);
  return problems;
}

/** Rows [0, cut) of `top` and the rest of `bottom`: a torn frame, for the stale check's own twin. */
export function tear(top: Image, bottom: Image, cut: number): Image {
  const rgba = new Uint8Array(bottom.rgba);
  rgba.set(top.rgba.subarray(0, cut * top.width * 4), 0);
  return { width: bottom.width, height: bottom.height, rgba };
}

// ---------------------------------------------------------------------------------------------------
// The fence record (README: Fences). Replays the slots' states from the record; each problem names the
// slot, the frame and the event.

export function fenceProblems(events: Fence[], slotCount: number, what: string): string[] {
  const problems: string[] = [];
  const state = new Map<number, { state: 'free' | 'rendering' | 'ready' | 'on_screen'; frame: number | null; cbs: Set<string> }>();
  const done = new Set<string>();
  let last = -Infinity;
  for (const e of events) {
    if (!(e.seq > last)) problems.push(`${what}: fence event ${e.seq} isn't after ${last}: the record isn't one order`);
    last = e.seq;
    if (e.event === 'gpui_done') {
      if (e.cb === null) problems.push(`${what}: gpui_done at ${e.seq} names no command buffer`);
      else done.add(e.cb);
      continue;
    }
    if (e.slot === null || !Number.isInteger(e.slot) || e.slot < 0 || e.slot >= slotCount) { problems.push(`${what}: ${e.event} at ${e.seq} names slot ${e.slot}, not one of the ${slotCount} slots`); continue; }
    const s = state.get(e.slot) ?? { state: 'free' as const, frame: null, cbs: new Set<string>() };
    const at = `slot ${e.slot}, frame ${e.frame}, event ${e.seq}`;
    switch (e.event) {
      case 'render':
        if (s.state === 'on_screen') problems.push(`${what}: drawn into while on screen (${at}; it shows frame ${s.frame})`);
        else if (s.state !== 'free') problems.push(`${what}: rendered into a slot that isn't free (${at}; it is ${s.state} with frame ${s.frame})`);
        state.set(e.slot, { state: 'rendering', frame: e.frame, cbs: new Set() });
        break;
      case 'gpu_done':
        if (s.state !== 'rendering' || s.frame !== e.frame) problems.push(`${what}: gpu_done for a slot not rendering that frame (${at}; it is ${s.state} with frame ${s.frame})`);
        state.set(e.slot, { ...s, state: 'ready' });
        break;
      case 'show':
        if (s.state !== 'ready' && s.state !== 'on_screen') problems.push(`${what}: shown before its gpu_done fence (${at}; it is ${s.state})`);
        if (s.frame !== e.frame) problems.push(`${what}: shown as frame ${e.frame} but holds frame ${s.frame} (${at})`);
        if (e.cb === null) problems.push(`${what}: show names no GPUI command buffer (${at})`);
        else s.cbs.add(e.cb);
        state.set(e.slot, { ...s, state: 'on_screen' });
        break;
      case 'release': {
        if (s.state !== 'on_screen') problems.push(`${what}: released a slot that isn't on screen (${at}; it is ${s.state})`);
        const pending = [...s.cbs].filter((cb) => !done.has(cb));
        if (pending.length) problems.push(`${what}: released before GPUI's command buffer ${pending.join(', ')} completed (${at})`);
        state.set(e.slot, { state: 'free', frame: null, cbs: new Set() });
        break;
      }
      default:
        problems.push(`${what}: unknown fence event ${e.event} at ${e.seq}`);
    }
  }
  return problems;
}

/** Frames the record renders, in order, and those it shows: every frame of the run must be rendered once and shown. */
export function fenceCoverage(events: Fence[], count: number, what: string): string[] {
  const rendered = events.filter((e) => e.event === 'render').map((e) => e.frame);
  const shown = new Set(events.filter((e) => e.event === 'show').map((e) => e.frame));
  const problems: string[] = [];
  const want = Array.from({ length: count }, (_, i) => i);
  if (JSON.stringify(rendered) !== JSON.stringify(want)) problems.push(`${what}: the record renders ${rendered.length} frames, not each of the ${count} once in order`);
  const missing = want.filter((n) => !shown.has(n));
  if (missing.length) problems.push(`${what}: ${missing.length} frames are never shown (first ${missing[0]})`);
  return problems;
}

// ---------------------------------------------------------------------------------------------------
// Timing: #305's reference-Mac gate and the design's judge.

const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, power: string, therm: string;
  try {
    model = sh('sysctl', '-n', 'hw.model');
    chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    power = sh('pmset', '-g');
    therm = sh('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  const fingerprint = `${model} / ${chip} / ${gib} GiB`;
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${fingerprint}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  return null;
}
const marginOf = (runs: number[]): number => Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9));
/** PASS when every run is within the limit; FAIL when every run is over it by more than the margin; else INCONCLUSIVE (a skip). */
export function judge(ctx: TestContext, name: string, runs: number[], limit: number): void {
  const margin = marginOf(runs);
  const shown = `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(shown);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${shown}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${shown}`);
}
/** A planted program's runs must be judged FAIL: every run over the limit by more than the margin. */
export function expectJudgedFail(name: string, runs: number[], limit: number): void {
  const margin = marginOf(runs);
  const shown = `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(shown);
  expect(runs.every((r) => r > limit * (1 + margin)), `the planted program is judged FAIL: ${shown}`).toBe(true);
}
export function p95(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]!;
}
