// Test-side tools for the #424 acceptance tests: the base's `deep-gpu` binary (#377's GPU layer, with #378's `view3d`,
// #421's shading core, #422's light and sky and #423's maps), built once per file and driven by JSON lines; the calls
// and fields this suite adds (README: Assumed surfaces); the fixtures the criteria name (the nested shells in a
// cutaway, the engine block over its crankshaft, the crossing beams, the half-section box, the saddle and the
// self-crossing surface), shared with the taste test so its screenshots are the same scenes; the five-run timing rule;
// and the reviewed references the criteria are held to: #378's pinhole and the orthographic view, ray-sphere,
// ray-box and ray-triangle hits, an f64 per-pixel composite, sRGB coding, PNG reading and writing, a minimal glTF
// writer (copied in part from #422's and #423's helpers, since suites don't import each other). Nothing here stands
// in for the renderer, the cutaway, the resolve or the picks under test.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/424 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text (README: Criteria to tests). */
export const AC = {
  1: 'AC1 #424.599f5fc2',
  2: 'AC2 #424.a28f3c85',
  3: 'AC3 #424.649ef843',
  4: 'AC4 #424.69a7a811',
  5: 'AC5 #424.b9bc25e9',
  6: 'AC6 #424.ba7f5708',
  7: 'AC7 #424.f29789a6',
  8: 'AC8 #424.73418e8a',
  9: 'AC9 #424.d0c14cb2',
  10: 'AC10 #424.6c2f640a',
  11: 'AC11 #424.d1e2b251',
} as const;

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
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const SHA = /^[0-9a-f]{64}$/;
export const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
export const clone = <T extends JsonValue>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** At least one failure, and one that names each of `names`: what a planted program must give. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  for (const name of names) {
    expect(failures.some((f) => f.includes(name)), `${what}: a failure names ${name}; the failures were:\n  ${failures.slice(0, 40).join('\n  ')}`).toBe(true);
  }
}
/** At least one failure, and every failure names a pixel `(x, y)`: the criteria's "each failing, naming the pixel". */
export function failsNamingPixels(failures: readonly string[], what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  const bare = failures.filter((f) => !/\(\d+, \d+\)/.test(f));
  expect(bare, `${what}: every failure names its pixel`).toEqual([]);
}

/** Writes `value` as JSON under `dir` and returns its absolute path. */
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

// ---------------------------------------------------------------------------------------------------
// The machine

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** The reference Macs and their built-in displays (technical design: The reference Macs). */
export const REFERENCE_MACS: Record<string, [number, number]> = { 'Mac15,7': [3456, 2234], 'Mac15,12': [2560, 1664] };
/** The GPU layer draws these pixels on macOS's Metal device, the reference platform. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these pixels on macOS's Metal device; this is ${process.platform}`);
}
/** GPU budgets count only on a reference Mac: off one, INCONCLUSIVE. Power and load are not gated (the owner's rule). */
export function requireReferenceMac(): void {
  requireMetal();
  let model: string | null = null;
  try { model = execFileSync('sysctl', ['-n', 'hw.model'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { model = null; }
  if (!model || !REFERENCE_MACS[model]) inconclusive(`not a reference Mac (${Object.keys(REFERENCE_MACS).join(' or ')}): hw.model is ${model}`);
}

// ---------------------------------------------------------------------------------------------------
// The build: deep-gpu built once per file and copied out of the target folder.

const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetDir = (): string => process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');
const CARGO_ARGS = ['build', '--locked', '--bin', 'deep-gpu'];
function cargoBuild(): string {
  const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const run = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${CARGO_ARGS.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
/** Builds deep-gpu before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useGpu(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-424-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(targetDir(), 'debug', exe('deep-gpu')), join(dir, exe('deep-gpu')));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo ${CARGO_ARGS.join(' ')}`).toBe('');
    return join(dir, exe('deep-gpu'));
  };
}
/** A fresh temporary folder per test (documents, assets, outputs), deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-424-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one JSON line in, one JSON line out (#377).

/** `deep-gpu --planted` names this suite adds, each a wrong program reachable only there (README: Planted programs). */
export type GpuPlanted =
  | 'ids_by_draw_position' | 'ids_ignore_mask' | 'add_writes_depth' | 'add_skips_depth_test' | 'cut_color_only' | 'single_pixel_pick';

/** One process: the calls in order, a reply per call. */
export function runGpu(bin: string, out: string, calls: JsonObject[], planted?: GpuPlanted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const name = `deep-gpu ${args.join(' ')}`;
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${name}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  expect(timedOut, `${name} finished within its timeout`).toBe(false);
  expect(run.status, `${name} exited 0 (${run.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(run.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  expect(lines.length, `${name}: one output line per input line`).toBe(1);
  const answer = obj(lines[0], `${name}: the answer`);
  expect(answer['ok'], `${name} refused the scenario: ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], `${name}: replies`).map((r, i) => obj(r, `${name}: replies[${i}]`));
  expect(replies.length, `${name}: one reply per call`).toBe(calls.length);
  return replies;
}
/** A reply that holds no refusal `code`; INCONCLUSIVE when the platform can't draw it. */
export function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  return reply;
}

// ---------------------------------------------------------------------------------------------------
// Looks and documents

/** The status colors (Look `look@1`: status), as #382's looks carry them. */
export const STATUS: Record<string, string> = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
/** A physical-basis `look@1` with tone map none at the exposure whose scale 1 ÷ (1.2 × 2^EV100) is 1, so the final
 * target is the sRGB encoding of the linear target (#378's and #421's acceptance look), no bloom, no deband. */
export const PLAIN_LOOK: JsonObject = {
  id: 'look-424-plain', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'A #424 acceptance look.',
  palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', stone: '#d9dde3', sand: '#e6d3a3' },
  roles: { ground: 'night', ink: 'graphite', muted: 'slate', stone: 'stone', sand: 'sand' },
  themes: { light: {}, dark: {} },
  fonts: {
    body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
    mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  },
  tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ground_3d: { kind: 'none' },
  status: { ...STATUS }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: 0.1,
  attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
};
/** The look's `sand` role, the cap's in AC9: #e6d3a3. */
export const SAND: [number, number, number] = [0xe6, 0xd3, 0xa3];

export const AGENT = 'agent:sess-alpha';
/** A scene document as a session holds it (#378): an `id`, one writer layer, every item in it. */
export function sessionDoc(id: string, size: [number, number], items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #424 acceptance fixture.`, size, camera: 'cam', transport: { span: '10s' },
    requires: { modules: { scene3d: '^1' } }, layers: { main: { writer: AGENT, title: 'main', order: 'a0' } }, ...extra, items: withIds,
  };
}

export type V3 = [number, number, number];
export type Rgb = [number, number, number];
export const box = (size: V3, pos: V3, extra: JsonObject = {}): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos }, ...extra });
export const camera = (position: V3, target: V3, fov: number, extra: JsonObject = {}): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov, near: 0.1, far: 100, ...extra } });
/** An orthographic `camera@1` looking along −Z at `target`, `view_width` m across the frame (Camera `camera@1`). */
export const ortho = (target: V3, viewWidth: number): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'orthographic', position: [target[0], target[1], target[2] + 20], target, view_width: viewWidth, near: 0.1, far: 100 } });
export const material = (params: JsonObject): JsonObject => ({ kind: 'material@1', params });
/** An unlit material of linear `color` (Material: `unlit`), see-through when `mode` says so. */
export const unlit = (color: Rgb, mode: 'opaque' | 'blend' | 'add' = 'opaque', alpha = 1, extra: JsonObject = {}): JsonObject =>
  material({ base_color: [...color, 1], unlit: true, alpha_mode: mode, alpha, ...extra });
/** A smooth `ball@1` of 256 segments. */
export const ball = (radius: number, pos: V3, mat: string, extra: JsonObject = {}): JsonObject => ({ kind: 'ball@1', params: { radius, segments: 256 }, at: { pos }, material: mat, ...extra });
/** A sun (`light.sun@1`), shining along its own −Z, aimed by `at.rot` (R = Rz·Ry·Rx, degrees). */
export const sun = (illuminance: number, rot: V3, shadow: boolean): JsonObject =>
  ({ kind: 'light.sun@1', params: { illuminance, color: [1, 1, 1], shadow }, at: { rot } });
/** A black sky with no ambient and no environment: the suns are the only light, the background reads 0. */
export const DARK_SKY: JsonObject = { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } };
/** A `cutaway@1` (Cutaway `cutaway@1`): its params, the design's defaults beside what's given. */
export interface Plane { normal: V3; offset: number }
export const cutawayParams = (planes: Plane[], extra: JsonObject = {}): JsonObject => ({ planes: planes.map((p) => ({ normal: p.normal, offset: p.offset })), ...extra });
/** A linear channel on `path` from `a` at 0 s to `b` at `span` s. */
export const linearChannel = (path: string, a: number, b: number, span: number): JsonObject =>
  ({ target: path, type: 'f32', keys: { k0: { t: '0s', value: a, interp: 'linear' }, k1: { t: `${span}s`, value: b, interp: 'linear' } } });

// ---------------------------------------------------------------------------------------------------
// view3d (#378) and what this suite adds to it

export interface View3d {
  doc: string; look?: JsonObject; size: [number, number]; frames?: number; fps?: number;
  capture?: 'every' | number[]; targets?: ('final' | 'linear' | 'ids')[]; timings?: boolean; counts?: boolean;
  assets?: Record<string, string>; states?: Record<string, string>; clicks?: { frame: number; at: [number, number] }[];
  window?: { size: [number, number]; view: [number, number]; page: Rgb }; cascades?: boolean;
  /** This suite's: a `cutaway@1`'s params as a view input, in session state (README: Assumed surfaces 1). */
  cutaway?: JsonObject;
}
export const view3dCall = (v: View3d): JsonObject => ({ call: 'view3d', look: PLAIN_LOOK, frames: 1, capture: [0], ...(v as unknown as JsonObject) });
export interface Click { at: [number, number]; pick: string | null }
export interface ShadowMap { key: string; texel_m: number }
export interface ViewFrame {
  frame: number; final: string | null; linear: string | null; ids: string | null; window: string | null; picks: Map<number, string> | null;
  gpu_ms: number | null; notices: JsonObject[]; clicks: Click[]; meshes_built: number | null; compiled: string[] | null; maps: ShadowMap[] | null;
}
const optStr = (v: JsonValue | undefined, what: string): string | null => (v === undefined || v === null ? null : str(v, what));
const optNum = (v: JsonValue | undefined, what: string): number | null => (v === undefined || v === null ? null : num(v, what));
export function framesOf(reply: JsonObject, what: string): ViewFrame[] {
  answered(reply, what);
  return arr(reply['frames'], `${what}: frames`).map((v, i): ViewFrame => {
    const f = obj(v, `${what}: frames[${i}]`); const at = `${what}: frames[${i}]`;
    let picks: Map<number, string> | null = null;
    if (isObject(f['picks'])) picks = new Map(Object.entries(f['picks']).map(([k, id]) => [Number(k), str(id, `${at}.picks[${k}]`)]));
    const clicks = arr(f['clicks'] ?? [], `${at}.clicks`).map((c, j): Click => {
      const o = obj(c, `${at}.clicks[${j}]`);
      const p = arr(o['at'], `${at}.clicks[${j}].at`).map((x) => num(x, 'a click coordinate')) as [number, number];
      return { at: p, pick: o['pick'] === null || o['pick'] === undefined ? null : str(o['pick'], `${at}.clicks[${j}].pick`) };
    });
    let maps: ShadowMap[] | null = null;
    if (isObject(f['cascades']) && f['cascades']['maps'] !== undefined) {
      maps = arr(f['cascades']['maps'], `${at}.cascades.maps`).map((m, j) => {
        const o = obj(m, `${at}.cascades.maps[${j}]`);
        return { key: str(o['key'], `${at}.cascades.maps[${j}].key`), texel_m: num(o['texel_m'], `${at}.cascades.maps[${j}].texel_m`) };
      });
    }
    return {
      frame: num(f['frame'], `${at}.frame`), final: optStr(f['final'], `${at}.final`), linear: optStr(f['linear'], `${at}.linear`), ids: optStr(f['ids'], `${at}.ids`),
      window: optStr(f['window'], `${at}.window`), picks, gpu_ms: optNum(f['gpu_ms'], `${at}.gpu_ms`),
      notices: arr(f['notices'] ?? [], `${at}.notices`).map((n, j) => obj(n, `${at}.notices[${j}]`)), clicks,
      meshes_built: optNum(f['meshes_built'], `${at}.meshes_built`),
      compiled: f['compiled'] === undefined ? null : arr(f['compiled'], `${at}.compiled`).map((c) => str(c, `${at}.compiled[]`)), maps,
    };
  });
}
export function frameAt(frames: ViewFrame[], n: number, what: string): ViewFrame {
  const f = frames.find((x) => x.frame === n);
  expect(f, `${what}: frame ${n} is in the reply`).toBeDefined();
  return f!;
}
/** The first captured frame of a one-frame call. */
export const only = (reply: JsonObject, what: string): ViewFrame => frameAt(framesOf(reply, what), 0, what);

// Targets: files the binary wrote, each named by its SHA-256 (#378).
export function readNamed(out: string, hash: string | null, ext: string, what: string): Buffer {
  expect(hash, `${what} is written, named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${hash}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}
/** The linear target as read back (#378): little-endian f32 RGBA, rows top-down, `w × h × 16` bytes. */
export interface Linear { width: number; height: number; at: (x: number, y: number) => Rgb; alpha: (x: number, y: number) => number }
export function readLinear(out: string, f: ViewFrame, size: [number, number], what: string): Linear {
  const file = readNamed(out, f.linear, 'f32', what);
  expect(file.length, `${what} holds ${size[0]} × ${size[1]} f32 RGBA pixels`).toBe(size[0] * size[1] * 16);
  const o = (x: number, y: number): number => (y * size[0] + x) * 16;
  return {
    width: size[0], height: size[1],
    at: (x, y) => [file.readFloatLE(o(x, y)), file.readFloatLE(o(x, y) + 4), file.readFloatLE(o(x, y) + 8)],
    alpha: (x, y) => file.readFloatLE(o(x, y) + 12),
  };
}
export const lum = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

export interface Image { width: number; height: number; rgba: Uint8Array; channels: number }
export const px = (im: Image, x: number, y: number): Rgb => { const o = (y * im.width + x) * 4; return [im.rgba[o]!, im.rgba[o + 1]!, im.rgba[o + 2]!]; };
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** Reads an 8-bit RGB or RGBA PNG with no interlace. */
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let at = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (at < file.length) {
    const len = file.readUInt32BE(at); const type = file.toString('latin1', at + 4, at + 8); const body = file.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}`);
  const channels = color === 6 ? 4 : 3; const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0; const b = previous[i]!; const c = i >= channels ? previous[i - channels]! : 0; const x = line[i]!;
      const v = filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + b : filter === 3 ? x + ((a + b) >> 1) : filter === 4 ? x + paeth(a, b, c) : NaN;
      if (Number.isNaN(v)) throw Error(`PNG filter ${filter}`);
      line[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      rgba[o] = line[x * channels]!; rgba[o + 1] = line[x * channels + 1]!; rgba[o + 2] = line[x * channels + 2]!; rgba[o + 3] = channels === 4 ? line[x * channels + 3]! : 255;
    }
    previous = line;
  }
  return { width, height, rgba, channels };
}
export const readPng = (out: string, hash: string | null, what: string): Image => decodePng(readNamed(out, hash, 'png', what));

/** The object-ID target (#378): pick ID r + 2^8 g + 2^16 b + 2^24 a, 0 where nothing draws. */
export interface Ids { width: number; height: number; at: (x: number, y: number) => string | null; count: Map<string, number> }
export function readIds(out: string, f: ViewFrame, what: string): Ids {
  const png = decodePng(readNamed(out, f.ids, 'png', what));
  expect(png.channels, `${what} is an RGBA PNG`).toBe(4);
  expect(f.picks, `${what}: the frame names the item each pick ID stands for`).not.toBeNull();
  const items: (string | null)[] = new Array(png.width * png.height);
  const count = new Map<string, number>();
  for (let i = 0; i < items.length; i++) {
    const o = i * 4;
    const pick = (png.rgba[o]! + png.rgba[o + 1]! * 256 + png.rgba[o + 2]! * 65_536 + png.rgba[o + 3]! * 16_777_216) >>> 0;
    const id = pick === 0 ? null : f.picks!.get(pick) ?? `unknown:${pick}`;
    items[i] = id;
    if (id) count.set(id, (count.get(id) ?? 0) + 1);
  }
  return { width: png.width, height: png.height, count, at: (x, y) => (x < 0 || y < 0 || x >= png.width || y >= png.height ? null : items[Math.floor(y) * png.width + Math.floor(x)]!) };
}
/** Whether every pixel within `r` px of (x, y) shows `id` (away from its silhouette). */
export function within(ids: Ids, x: number, y: number, id: string | null, r: number): boolean {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (ids.at(x + dx, y + dy) !== id) return false;
  return true;
}

// sRGB coding (the final target with tone map none is the sRGB encoding of the linear target).
export const encode = (v: number): number => { const c = Math.min(Math.max(v, 0), 1); return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; };
export const code8 = (v: number): number => Math.round(255 * encode(v));
export const decode8 = (c: number): number => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
export const codes = (c: Rgb): Rgb => c.map(code8) as Rgb;
export const codeOff = (a: Rgb, b: Rgb): number => Math.max(...[0, 1, 2].map((k) => Math.abs(a[k]! - b[k]!)));

// PNG written by the suite (no filter, zlib level 9), so the same pixels give the same SHA-256.
function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}
/** An 8-bit RGBA PNG of `width × height` from `rgba` (rows top-down). */
export function encodeRgbaPng(width: number, height: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  const h = Buffer.alloc(13); h.writeUInt32BE(width, 0); h.writeUInt32BE(height, 4); h[8] = 8; h[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', h), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))]);
}

// ---------------------------------------------------------------------------------------------------
// The timing rule (technical design: Every task carries its own budgets): five runs after a warm-up; PASS when all
// five are within the limit, FAIL when all five are over it by more than the margin (the larger of 5% and the runs'
// spread), otherwise INCONCLUSIVE with all five.

export const RUNS = 5;
export const median = (values: number[]): number => { const s = [...values].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]!; };
export function judge(name: string, runs: number[], limit: number): void {
  const margin = Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.abs(Math.min(...runs)), 1e-9));
  const line = `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(line);
  if (runs.every((r) => r < limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${line}`).toBe(false);
  inconclusive(line);
}

// ---------------------------------------------------------------------------------------------------
// Reviewed references: vectors, the transform order (Units and axes), #378's pinhole, the orthographic view, hits.

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
export const rad = (d: number): number => (d * Math.PI) / 180;
/** R = Rz·Ry·Rx (degrees) applied to `v` (Units and axes). */
export function rotate(rot: V3, v: V3): V3 {
  const [cx, sx] = [Math.cos(rad(rot[0])), Math.sin(rad(rot[0]))];
  const [cy, sy] = [Math.cos(rad(rot[1])), Math.sin(rad(rot[1]))];
  const [cz, sz] = [Math.cos(rad(rot[2])), Math.sin(rad(rot[2]))];
  const x1: V3 = [v[0], cx * v[1] - sx * v[2], sx * v[1] + cx * v[2]];
  const y1: V3 = [cy * x1[0] + sy * x1[2], x1[1], -sy * x1[0] + cy * x1[2]];
  return [cz * y1[0] - sz * y1[1], sz * y1[0] + cz * y1[1], y1[2]];
}
/** The unit direction toward a sun aimed by `rot` (it shines along its own −Z). */
export const towardSun = (rot: V3): V3 => scale(rotate(rot, [0, 0, -1]), -1);
/** A camera position on an orbit about `target`: azimuth from +Z toward +X, elevation above the horizon, degrees. */
export const orbitPosition = (target: V3, distance: number, azimuth: number, elevation: number): V3 =>
  add(target, scale([Math.cos(rad(elevation)) * Math.sin(rad(azimuth)), Math.sin(rad(elevation)), Math.cos(rad(elevation)) * Math.cos(rad(azimuth))], distance));

/** #378's pinhole: position, target, +Y up, fov across the wider side. */
export interface Pinhole { position: V3; target: V3; fov: number; size: [number, number] }
function basis(cam: Pinhole): { f: V3; r: V3; u: V3; focal: number } {
  const f = unit(sub(cam.target, cam.position));
  const r = unit(cross(f, [0, 1, 0]));
  return { f, r, u: cross(r, f), focal: Math.max(...cam.size) / 2 / Math.tan(rad(cam.fov) / 2) };
}
/** The unit ray through frame point (sx, sy) in px, pixel (x, y)'s centre at (x + 0.5, y + 0.5). */
export function rayAt(cam: Pinhole, sx: number, sy: number): V3 {
  const { f, r, u, focal } = basis(cam);
  return unit(add(add(f, scale(r, (sx - cam.size[0] / 2) / focal)), scale(u, -(sy - cam.size[1] / 2) / focal)));
}
/** Where world point `p` lands in the frame, px (the inverse of `rayAt`), and its view depth. */
export function project(cam: Pinhole, p: V3): [number, number, number] {
  const { f, r, u, focal } = basis(cam);
  const d = sub(p, cam.position); const z = dot(d, f);
  return [cam.size[0] / 2 + (focal * dot(d, r)) / z, cam.size[1] / 2 - (focal * dot(d, u)) / z, z];
}
/** The orthographic view `ortho()` makes: frame px of world point `p`. */
export function orthoProject(target: V3, viewWidth: number, size: [number, number], p: readonly number[]): [number, number] {
  const k = size[0] / viewWidth;
  return [size[0] / 2 + (p[0]! - target[0]) * k, size[1] / 2 - (p[1]! - target[1]) * k];
}
/** Where a ray from `o` along unit `d` first meets the sphere at `c` of radius `r` from outside, or null. */
export function hitSphere(o: V3, d: V3, c: V3, r: number): V3 | null {
  const oc = sub(o, c); const b = dot(oc, d); const disc = b * b - (dot(oc, oc) - r * r);
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? add(o, scale(d, t)) : null;
}
/** The entry and exit distances of a ray through a box of `size` centred at `c`, turned by `yaw` degrees about +Y
 * (Units and axes), or null. */
export function hitBox(o: V3, d: V3, c: V3, size: V3, yaw = 0): [number, number] | null {
  const lo = rotate([0, -yaw, 0], sub(o, c)); const ld = rotate([0, -yaw, 0], d);
  let t0 = -Infinity; let t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    const h = size[k]! / 2;
    if (Math.abs(ld[k]!) < 1e-12) { if (Math.abs(lo[k]!) > h) return null; continue; }
    let a = (-h - lo[k]!) / ld[k]!; let b = (h - lo[k]!) / ld[k]!;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
  }
  return t0 <= t1 && t1 > 0 ? [t0, t1] : null;
}
/** The distance along unit `d` from `o` to triangle (a, b, c), either face (Möller–Trumbore, f64), or null. */
export function hitTriangle(o: V3, d: V3, a: V3, b: V3, c: V3): number | null {
  const e1 = sub(b, a); const e2 = sub(c, a); const p = cross(d, e2); const det = dot(e1, p);
  if (Math.abs(det) < 1e-14) return null;
  const inv = 1 / det; const s = sub(o, a); const u = dot(s, p) * inv;
  if (u < 0 || u > 1) return null;
  const q = cross(s, e1); const v = dot(d, q) * inv;
  if (v < 0 || u + v > 1) return null;
  const t = dot(e2, q) * inv;
  return t > 1e-9 ? t : null;
}

// ---------------------------------------------------------------------------------------------------
// Meshes as glTF (a `mesh.asset@1` reads a JSON glTF with its buffer inline as a data URI, #420), and the per-pixel
// reference composite over the same triangles.

export interface Mesh { positions: V3[]; triangles: [number, number, number][] }
/** The f32 positions the file holds, so the reference sees the triangles the renderer reads. */
const f32 = (m: Mesh): Mesh => ({ positions: m.positions.map((p) => p.map(Math.fround) as V3), triangles: m.triangles });
/** A JSON glTF of `m` (positions and u32 indices, one node, no material), its bytes and their SHA-256. */
export function gltf(m: Mesh): { bytes: Buffer; sha: string } {
  const pos = Buffer.alloc(m.positions.length * 12); const idx = Buffer.alloc(m.triangles.length * 12);
  m.positions.forEach((p, i) => p.forEach((v, k) => pos.writeFloatLE(v, i * 12 + k * 4)));
  m.triangles.forEach((t, i) => t.forEach((v, k) => idx.writeUInt32LE(v, i * 12 + k * 4)));
  const lo = [0, 1, 2].map((k) => Math.min(...m.positions.map((p) => Math.fround(p[k]!))));
  const hi = [0, 1, 2].map((k) => Math.max(...m.positions.map((p) => Math.fround(p[k]!))));
  const doc = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: m.positions.length, type: 'VEC3', min: lo, max: hi },
      { bufferView: 1, componentType: 5125, count: m.triangles.length * 3, type: 'SCALAR' },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.length }, { buffer: 0, byteOffset: pos.length, byteLength: idx.length }],
    buffers: [{ byteLength: pos.length + idx.length, uri: `data:application/octet-stream;base64,${Buffer.concat([pos, idx]).toString('base64')}` }],
  };
  const bytes = Buffer.from(JSON.stringify(doc));
  return { bytes, sha: sha256(bytes) };
}
/** A grid of `n × n` cells over [−1, 1]² in (u, v), mapped by `f`. */
export function grid(n: number, nv: number, f: (u: number, v: number) => V3, uRange: [number, number] = [-1, 1], vRange: [number, number] = [-1, 1]): Mesh {
  const positions: V3[] = []; const triangles: [number, number, number][] = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= n; i++) positions.push(f(uRange[0] + ((uRange[1] - uRange[0]) * i) / n, vRange[0] + ((vRange[1] - vRange[0]) * j) / nv));
  for (let j = 0; j < nv; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i; const b = a + 1; const c = a + n + 1; const d = c + 1;
    triangles.push([a, b, d], [a, d, c]);
  }
  return { positions, triangles };
}
/** The saddle y = 0.5 (x² − z²) over [−1, 1]² (AC6, AC8). */
export const SADDLE: Mesh = f32(grid(40, 40, (x, z) => [x, 0.5 * (x * x - z * z), z]));
/** The plane it crosses: y = 0.05 + 0.1 x over [−1.1, 1.1]² (two triangles). */
export const CROSSING_PLANE: Mesh = f32(grid(1, 1, (x, z) => [x, 0.05 + 0.1 * x, z], [-1.1, 1.1], [-1.1, 1.1]));
/** A self-crossing surface: the figure-eight (x, z) = (1.2 sin 2t, sin t), t ∈ [0, 2π], swept along y ∈ [−0.8, 0.8];
 * it crosses itself along the y axis. */
export const FIGURE_EIGHT: Mesh = f32(grid(160, 1, (t, y) => [1.2 * Math.sin(2 * t), y, Math.sin(t)], [0, 2 * Math.PI], [-0.8, 0.8]));
/** A square quad 30 m on a side in the xy plane facing +Z (AC7's layers). */
export const QUAD: Mesh = f32({ positions: [[-15, -15, 0], [15, -15, 0], [15, 15, 0], [-15, 15, 0]], triangles: [[0, 1, 2], [0, 2, 3]] });

/** One see-through layer of the reference: a mesh at an offset, its linear color and alpha. */
export interface Layered { id: string; mesh: Mesh; at: V3; color: Rgb; alpha: number }
/** The reference composite through the pinhole `cam`: per pixel every hit of every layer's triangles (both faces),
 * composited back to front in f64 over a black background. A pixel is judged where it has a layer and the rays at
 * its centre and ±0.5 px in x and y meet the same items in the same depth order (no silhouette, crossing or seam
 * inside it). */
export function referenceComposite(cam: Pinhole, layers: Layered[]): { judged: Uint8Array; color: Float64Array } {
  const [w, h] = cam.size; const T = 8; const tw = Math.ceil(w / T); const th = Math.ceil(h / T);
  const tris: { id: number; a: V3; b: V3; c: V3 }[] = [];
  const bins: number[][] = Array.from({ length: tw * th }, () => []);
  layers.forEach((l, li) => {
    for (const [i, j, k] of l.mesh.triangles) {
      const a = add(l.mesh.positions[i]!, l.at); const b = add(l.mesh.positions[j]!, l.at); const c = add(l.mesh.positions[k]!, l.at);
      const p = [a, b, c].map((v) => project(cam, v));
      const n = tris.push({ id: li, a, b, c }) - 1;
      const x0 = Math.max(0, Math.floor((Math.min(...p.map((q) => q[0])) - 2) / T)); const x1 = Math.min(tw - 1, Math.floor((Math.max(...p.map((q) => q[0])) + 2) / T));
      const y0 = Math.max(0, Math.floor((Math.min(...p.map((q) => q[1])) - 2) / T)); const y1 = Math.min(th - 1, Math.floor((Math.max(...p.map((q) => q[1])) + 2) / T));
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) bins[ty * tw + tx]!.push(n);
    }
  });
  const hits = (sx: number, sy: number, bin: number[]): [number, number][] => {
    const d = rayAt(cam, sx, sy); const out: [number, number][] = [];
    for (const n of bin) { const t = tris[n]!; const s = hitTriangle(cam.position, d, t.a, t.b, t.c); if (s !== null) out.push([s, t.id]); }
    return out.sort((p, q) => q[0] - p[0]);
  };
  const judged = new Uint8Array(w * h); const color = new Float64Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const bin = bins[Math.floor(y / T) * tw + Math.floor(x / T)]!;
    const centre = hits(x + 0.5, y + 0.5, bin);
    const c: Rgb = [0, 0, 0];
    for (const [, id] of centre) { const l = layers[id]!; for (let k = 0; k < 3; k++) c[k] = l.alpha * l.color[k]! + (1 - l.alpha) * c[k]!; }
    color.set(c, (y * w + x) * 3);
    if (centre.length === 0) continue;
    const order = centre.map(([, id]) => id).join(',');
    const same = [[0, 0.5], [0, -0.5], [0.5, 0], [-0.5, 0]].every(([dx, dy]) => {
      const sx = x + 0.5 + dx!; const sy = y + 0.5 + dy!;
      const b = bins[Math.min(th - 1, Math.max(0, Math.floor(sy / T))) * tw + Math.min(tw - 1, Math.max(0, Math.floor(sx / T)))]!;
      return hits(sx, sy, b).map(([, id]) => id).join(',') === order;
    });
    if (same) judged[y * w + x] = 1;
  }
  return { judged, color };
}

// ---------------------------------------------------------------------------------------------------
// The fixtures the criteria name, shared with the taste test (README: Fixtures).

/** AC1's cutaway fixture: two unlit see-through shells sharing a centre, the outer (radius 1, blue) cut by a plane
 * x = 0.6 that misses the inner (radius 0.5, red); the inner carries sort_bias 1 m so it draws first. The IDs are
 * chosen so that a tie by ID would draw the outer first: only the bias puts the inner before it. */
export const SHELLS_SIZE: [number, number] = [320, 320];
export const SHELLS = { outer: 'shell_a_outer', inner: 'shell_b_inner', blue: [0.1, 0.3, 0.9] as Rgb, red: [0.9, 0.2, 0.1] as Rgb, alpha: 0.5, cut: 0.6, distance: 4, elevation: 20 };
export const shellsCam = (azimuth: number): Pinhole => ({ position: orbitPosition([0, 0, 0], SHELLS.distance, azimuth, SHELLS.elevation), target: [0, 0, 0], fov: 40, size: SHELLS_SIZE });
export function shellsDoc(azimuth: number, bias = 1): JsonObject {
  const cam = shellsCam(azimuth);
  return sessionDoc(`shells-${azimuth}-${bias}`, SHELLS_SIZE, {
    cam: camera(cam.position, cam.target, cam.fov), sky: DARK_SKY,
    outer_mat: unlit(SHELLS.blue, 'blend', SHELLS.alpha), inner_mat: unlit(SHELLS.red, 'blend', SHELLS.alpha),
    [SHELLS.outer]: ball(1, [0, 0, 0], 'outer_mat'),
    [SHELLS.inner]: ball(0.5, [0, 0, 0], 'inner_mat', { sort_bias: bias }),
  });
}
/** The shells' cutaway, a view input: x > 0.6 removed, every item it reaches (applies_to all). */
export const SHELLS_CUT: JsonObject = cutawayParams([{ normal: [1, 0, 0], offset: SHELLS.cut }]);

/** AC3's engine block over its crankshaft: a double-sided closed block (so a back face would draw if nothing kept it
 * out) around a crankshaft that pokes out of both ends, on a ground, under a sun with no shadows. */
export const ENGINE_SIZE: [number, number] = [480, 360];
export function engineDoc(block: 'shown' | 'hidden', opacity: number): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: camera([3.2, 2.4, 5], [0, 0.1, 0], 35), sky: DARK_SKY,
    block_mat: material({ base_color: [0.35, 0.45, 0.6, 1], roughness: 0.6, double_sided: true }),
    crank_mat: material({ base_color: [0.85, 0.55, 0.2, 1], roughness: 0.4 }),
    ground_mat: material({ base_color: [0.3, 0.3, 0.3, 1], roughness: 0.9 }),
    ground: box([20, 0.1, 20], [0, -1.25, 0], { material: 'ground_mat' }),
    crank_shaft: box([3.8, 0.24, 0.24], [0, 0, 0], { material: 'crank_mat' }),
    crank_web1: box([0.18, 0.75, 0.4], [-0.9, 0.18, 0], { material: 'crank_mat' }),
    crank_web2: box([0.18, 0.75, 0.4], [0, -0.18, 0], { material: 'crank_mat' }),
    crank_web3: box([0.18, 0.75, 0.4], [0.9, 0.18, 0], { material: 'crank_mat' }),
    sun: sun(Math.PI, [-40, 30, 0], false),
  };
  if (block === 'shown') items['block'] = box([3, 1.5, 1.5], [0, 0, 0], { material: 'block_mat', adjust: { opacity } });
  return sessionDoc(`engine-${block}-${opacity}`, ENGINE_SIZE, items);
}

/** AC5's beams: two unlit add boxes crossing in an X over a dark floor lit by a sun at 45° elevation, which casts. */
export const BEAMS_SIZE: [number, number] = [320, 240];
export const BEAMS = {
  size: [0.5, 2.4, 5] as V3, centre: [0, 1.2, 0] as V3, yaw: [30, -30] as [number, number],
  colors: [[0.5, 0.5, 1], [1, 0.5, 0.5]] as [Rgb, Rgb], alpha: 0.5, sum: [0.75, 0.5, 0.75] as Rgb,
  target: [0, 0.8, 0] as V3, distance: 8, elevation: 35, floor: 8,
  wall: { size: [7, 4, 0.2] as V3, centre: [0, 2, 3.3] as V3 },
};
export const beamsCam = (azimuth: number): Pinhole => ({ position: orbitPosition(BEAMS.target, BEAMS.distance, azimuth, BEAMS.elevation), target: BEAMS.target, fov: 50, size: BEAMS_SIZE });
export function beamsDoc(azimuth: number, opts: { beams: 'add' | 'opaque' | 'none'; wall: boolean }): JsonObject {
  const cam = beamsCam(azimuth);
  const items: Record<string, JsonObject> = {
    cam: camera(cam.position, cam.target, cam.fov), sky: DARK_SKY,
    floor_mat: material({ base_color: [0.05, 0.05, 0.05, 1], roughness: 1 }),
    floor: box([2 * BEAMS.floor, 0.1, 2 * BEAMS.floor], [0, -0.05, 0], { material: 'floor_mat' }),
    sun: sun(Math.PI * Math.SQRT2, [-45, 40, 0], true),
  };
  if (opts.beams !== 'none') {
    BEAMS.colors.forEach((c, i) => {
      items[`beam${i + 1}_mat`] = opts.beams === 'add' ? unlit(c, 'add', BEAMS.alpha) : unlit(c);
      items[`beam${i + 1}`] = { ...box(BEAMS.size, BEAMS.centre, { material: `beam${i + 1}_mat` }), at: { pos: BEAMS.centre, rot: [0, BEAMS.yaw[i]!, 0] } };
    });
  }
  if (opts.wall) {
    items['wall_mat'] = material({ base_color: [0.4, 0.4, 0.4, 1], roughness: 0.8 });
    items['wall'] = box(BEAMS.wall.size, BEAMS.wall.centre, { material: 'wall_mat' });
  }
  return sessionDoc(`beams-${azimuth}-${opts.beams}${opts.wall ? '-wall' : ''}`, BEAMS_SIZE, items);
}

/** AC9's half-section box: a closed room (floor, roof and four walls 0.2 m thick, inside 6 × 2 × 4 m) under a sun at
 * 45° elevation shining from +X, seen from +X; the cutaway x > `offset` opens its +X half, capped in the look's sand
 * role. The sun's illuminance is 0.75 π √2 lx, so a surface at 45° to it (the floor, facing +Y, and the cap, facing
 * +X) receives 0.75 π lx and a matte one of linear albedo c reads 0.75 c: the lit floor 0.6, the dark floor 0. */
export const SECTION_SIZE: [number, number] = [480, 360];
export const SECTION = {
  H: 2, sunRot: [-45, 90, 0] as V3, illuminance: 0.75 * Math.PI * Math.SQRT2, floorAlbedo: 0.8,
  cam: { position: [6, 1.2, 0] as V3, target: [-1.5, 0.3, 0] as V3, fov: 60, size: SECTION_SIZE } as Pinhole,
};
export function sectionDoc(): JsonObject {
  const c = SECTION.cam; const g = SECTION.floorAlbedo;
  const mat = material({ base_color: [g, g, g, 1], roughness: 1, specular_level: 0 });
  return sessionDoc('section', SECTION_SIZE, {
    cam: camera(c.position, c.target, c.fov, { near: 0.1, far: 30 }), sky: DARK_SKY, room_mat: mat,
    floor: box([6.4, 0.2, 4.4], [0, -0.1, 0], { material: 'room_mat' }),
    roof: box([6.4, 0.2, 4.4], [0, 2.1, 0], { material: 'room_mat' }),
    wall_nx: box([0.2, 2, 4.4], [-3.1, 1, 0], { material: 'room_mat' }),
    wall_px: box([0.2, 2, 4.4], [3.1, 1, 0], { material: 'room_mat' }),
    wall_nz: box([6.4, 2, 0.2], [0, 1, -2.1], { material: 'room_mat' }),
    wall_pz: box([6.4, 2, 0.2], [0, 1, 2.1], { material: 'room_mat' }),
    sun: sun(SECTION.illuminance, SECTION.sunRot, true),
  });
}
/** The half-section: x > `offset` removed, capped in sand, lit (cap_light auto in a physical look). */
export const sectionCut = (offset: number): JsonObject => cutawayParams([{ normal: [1, 0, 0], offset }], { cap: 'sand', cap_light: 'auto', shadows: 'cut' });

/** AC6's and AC8's saddle crossing a plane, and the self-crossing surface, each a `mesh.asset@1` of the meshes above
 * with an unlit double-sided see-through material and `resolve`. */
export const SADDLE_CAM: Pinhole = { position: [2.4, 2.0, 3.0], target: [0, 0, 0], fov: 40, size: [480, 360] };
export const SADDLE_LAYERS: Layered[] = [
  { id: 'saddle', mesh: SADDLE, at: [0, 0, 0], color: [0.9, 0.45, 0.1], alpha: 0.5 },
  { id: 'plane', mesh: CROSSING_PLANE, at: [0, 0, 0], color: [0.1, 0.35, 0.9], alpha: 0.5 },
];
export const EIGHT_LAYERS: Layered[] = [{ id: 'eight', mesh: FIGURE_EIGHT, at: [0, 0, 0], color: [0.2, 0.8, 0.4], alpha: 0.4 }];
/** The document of `layers` drawn through `cam` at `size`, each layer resolving as `resolve`, and the assets it reads
 * (written under `dir`). */
export function layeredDoc(dir: string, name: string, cam: Pinhole, size: [number, number], layers: Layered[], resolve: 'sorted' | 'per_pixel', extra: JsonObject = {}): { doc: JsonObject; assets: Record<string, string> } {
  const assets: Record<string, string> = {};
  const items: Record<string, JsonObject> = { cam: camera(cam.position, cam.target, cam.fov), sky: DARK_SKY };
  for (const l of layers) {
    const g = gltf(l.mesh);
    const path = join(dir, `${g.sha}.gltf`); writeFileSync(path, g.bytes); assets[g.sha] = path;
    items[`${l.id}_mat`] = unlit(l.color, 'blend', l.alpha, { double_sided: true });
    items[l.id] = { kind: 'mesh.asset@1', params: { sha256: g.sha, node: 0 }, at: { pos: l.at }, material: `${l.id}_mat`, resolve, ...extra };
  }
  return { doc: sessionDoc(name, size, items), assets };
}
