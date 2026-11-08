// Test-side tools for the #426 acceptance tests: the base's `deep-gpu` binary (#377's GPU layer with #378's `view3d`, #422's sky and
// environment), built once per file and driven by JSON lines; the fixtures the criteria name (a Radiance HDR written
// here: a grid of flat 10 degree cells, a two-level horizon, a red-over-blue horizon; the product fixture; the backdrop
// and its shadow catcher; the fog spheres), shared with the taste test so its screenshots are the same scenes; and the
// reviewed references the criteria are held to: #378's pinhole, ray-sphere hits, sRGB coding, the equirectangular
// lookup, the dome of a background ground, a GGX prefilter by quadrature, PNG reading. Copied in part from #422's and
// #424's helpers, since suites don't import each other. Nothing here stands in for the renderer, the backdrop, the
// blur or the fog under test.

import { spawnSync } from 'node:child_process';
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
/** The checkout root (tests/acceptance/426 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text (README: Criteria to tests). */
export const AC = {
  1: 'AC1 #426.354a52a7',
  2: 'AC2 #426.f893b6e0',
  3: 'AC3 #426.c90d2152',
  4: 'AC4 #426.46bdf631',
  5: 'AC5 #426.45886847',
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
/** The GPU layer draws these pixels on macOS's Metal device, the reference platform. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these pixels on macOS's Metal device; this is ${process.platform}`);
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
    dir = mkdtempSync(join(tmpdir(), 'deep-426-bin-'));
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
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-426-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run`: one JSON line in, one JSON line out (#377). This suite plants no renderer flag (README: Assumed surfaces).

/** One process: the calls in order, a reply per call. */
export function runGpu(bin: string, out: string, calls: JsonObject[]): JsonObject[] {
  const args = ['run'];
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
  id: 'look-426-plain', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'A #426 acceptance look.',
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
export const AGENT = 'agent:sess-alpha';
/** A scene document as a session holds it (#378): an `id`, one writer layer, every item in it. */
export function sessionDoc(id: string, size: [number, number], items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #426 acceptance fixture.`, size, camera: 'cam', transport: { span: '10s' },
    requires: { modules: { scene3d: '^1' } }, layers: { main: { writer: AGENT, title: 'main', order: 'a0' } }, ...extra, items: withIds,
  };
}

export type V3 = [number, number, number];
export type Rgb = [number, number, number];
export const box = (size: V3, pos: V3, extra: JsonObject = {}): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos }, ...extra });
export const camera = (position: V3, target: V3, fov: number, extra: JsonObject = {}): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov, near: 0.1, far: 100, ...extra } });
export const material = (params: JsonObject): JsonObject => ({ kind: 'material@1', params });
/** A smooth `ball@1` of 256 segments. */
export const ball = (radius: number, pos: V3, mat: string, extra: JsonObject = {}): JsonObject => ({ kind: 'ball@1', params: { radius, segments: 256 }, at: { pos }, material: mat, ...extra });
/** A sun (`light.sun@1`), shining along its own −Z, aimed by `at.rot` (R = Rz·Ry·Rx, degrees). */
export const sun = (illuminance: number, rot: V3, shadow: boolean): JsonObject =>
  ({ kind: 'light.sun@1', params: { illuminance, color: [1, 1, 1], shadow }, at: { rot } });
/** A black sky with no ambient and no environment: the suns are the only light, the background reads 0. */
export const DARK_SKY: JsonObject = { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } };
// ---------------------------------------------------------------------------------------------------
// view3d (#378) and what this suite adds to it

export interface View3d {
  doc: string; look?: JsonObject; size: [number, number]; frames?: number; fps?: number;
  capture?: 'every' | number[]; targets?: ('final' | 'linear' | 'ids')[];
  assets?: Record<string, string>; clicks?: { frame: number; at: [number, number] }[];
  /** Open a session at this frame (a seek): every patch up to it applies, nothing before it is drawn (#378). */
  from?: number;
}
export const view3dCall = (v: View3d): JsonObject => ({ call: 'view3d', look: PLAIN_LOOK, frames: 1, capture: [0], ...(v as unknown as JsonObject) });
export interface Click { at: [number, number]; pick: string | null }
export interface ViewFrame {
  frame: number; final: string | null; linear: string | null; ids: string | null; picks: Map<number, string> | null; notices: JsonObject[]; clicks: Click[];
}
const optStr = (v: JsonValue | undefined, what: string): string | null => (v === undefined || v === null ? null : str(v, what));
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
    return {
      frame: num(f['frame'], `${at}.frame`), final: optStr(f['final'], `${at}.final`), linear: optStr(f['linear'], `${at}.linear`), ids: optStr(f['ids'], `${at}.ids`), picks,
      notices: arr(f['notices'] ?? [], `${at}.notices`).map((n, j) => obj(n, `${at}.notices[${j}]`)), clicks,
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
/** Where a ray from `o` along unit `d` first meets the sphere at `c` of radius `r` from outside, or null. */
export function hitSphere(o: V3, d: V3, c: V3, r: number): V3 | null {
  const oc = sub(o, c); const b = dot(oc, d); const disc = b * b - (dot(oc, oc) - r * r);
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? add(o, scale(d, t)) : null;
}

// ---------------------------------------------------------------------------------------------------
// Radiance HDRs written here (README: Assumed surfaces 1). The renderer reads `#?` RGBE, `-Y h +X w`, flat; a pixel's
// value is m × 2^(e − 136) per channel, so with e = 128 every channel is m ÷ 256 exactly and the CPU references read
// the very numbers the file holds. The suite never uses a pixel whose first two mantissas are (2, 2) at a line's start
// (a flat line that begins so would be taken for a run-length one).

export const HDR_SIZE: [number, number] = [720, 360];
export interface HdrFile { path: string; sha: string }
/** The file for `pixel(x, y)`, each channel a mantissa 0–255 (the value m ÷ 256); `dir` gets `<sha>.hdr`. */
export function writeHdr(dir: string, size: [number, number], pixel: (x: number, y: number) => [number, number, number]): HdrFile {
  const [w, h] = size;
  const head = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`, 'latin1');
  const body = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const m = pixel(x, y); const o = (y * w + x) * 4;
      body[o] = m[0]; body[o + 1] = m[1]; body[o + 2] = m[2]; body[o + 3] = m[0] + m[1] + m[2] === 0 ? 0 : 128;
    }
    if (body[y * w * 4] === 2 && body[y * w * 4 + 1] === 2) throw Error(`HDR line ${y} would be read as run-length encoded`);
  }
  const bytes = Buffer.concat([head, body]);
  const sha = sha256(bytes);
  const path = join(dir, `${sha}.hdr`);
  writeFileSync(path, bytes);
  return { path, sha };
}
export const mant = (m: [number, number, number]): Rgb => [m[0] / 256, m[1] / 256, m[2] / 256];

// The equirectangular lookup (the base's convention, README: Assumed surfaces 2): u from −Z turning toward +X, v from
// the zenith; rotation turns the environment about +Y, right-handed, so the background at `d` shows the HDR at
// R_y(−rotation)·d.
export const equirectUv = (d: V3): [number, number] => [Math.atan2(d[0], -d[2]) / (2 * Math.PI) + 0.5, Math.acos(Math.min(1, Math.max(-1, d[1]))) / Math.PI];
export function rotateY(d: V3, deg: number): V3 {
  const c = Math.cos(rad(deg)); const s = Math.sin(rad(deg));
  return [d[0] * c + d[2] * s, d[1], -d[0] * s + d[2] * c];
}

// ---- The grid HDR: the lower half is 36 × 9 flat cells of 10°, the upper half one dark flat color.
const LEVELS = [70, 90, 110, 130, 150, 170, 190];
const mantOfCode = (code: number): number => Math.round(decode8(code) * 256);
/** The mantissas of the cell with index i (row-major from the horizon down, 36 per row): 324 of the 343 lattice colors, in a scrambled order. */
export function cellMant(i: number): [number, number, number] {
  const k = (i * 37) % 343;
  return [mantOfCode(LEVELS[k % 7]!), mantOfCode(LEVELS[Math.floor(k / 7) % 7]!), mantOfCode(LEVELS[Math.floor(k / 49)]!)];
}
export const GRID_SKY_MANT: [number, number, number] = [8, 8, 12];
export const gridPixel = (x: number, y: number): [number, number, number] =>
  y < 180 ? GRID_SKY_MANT : cellMant(Math.floor((y - 180) / 20) * 36 + Math.floor(x / 20));
/** Pixels closer than this to a cell edge (degrees of arc) are left out: the cube's filtering blends there (a cube texel is about 0.35°). */
export const GRID_MARGIN = 0.8;
export interface Cell { index: number; color: Rgb; margin: number }
/** The grid cell holding direction `d` (below the horizon), its linear color, and how far (degrees of arc) `d` lies from the nearest cell edge. */
export function gridCell(d: V3): Cell {
  const [u, v] = equirectUv(unit(d));
  const azDeg = u * 360; const elDeg = 90 - v * 180;
  if (elDeg > -0.05) return { index: -1, color: [0, 0, 0], margin: -1 }; // the upper half is not a cell           // elDeg is the elevation: v counts from the zenith, so the lower half is v ≥ 0.5, elDeg ≤ 0
  const col = Math.min(35, Math.floor(azDeg / 10)); const row = Math.min(8, Math.floor((-elDeg) / 10));
  const fa = azDeg - col * 10; const fe = -elDeg - row * 10;
  const edgeAz = Math.min(fa, 10 - fa) * Math.cos(rad(elDeg)); const edgeEl = Math.min(fe, 10 - fe);
  const index = row * 36 + col;
  return { index, color: mant(cellMant(index)), margin: Math.min(edgeAz, edgeEl) };
}
/** All 324 cells are at least 4 code values from each other (criterion 2's HDR); the pairs that aren't. */
export function gridDistinctness(): string[] {
  const bad: string[] = [];
  const c = Array.from({ length: 324 }, (_, i) => codes(mant(cellMant(i))));
  for (let i = 0; i < 324; i++) for (let j = i + 1; j < 324; j++) if (codeOff(c[i]!, c[j]!) < 4) bad.push(`cells ${i} and ${j} are ${codeOff(c[i]!, c[j]!)} codes apart`);
  return bad;
}

// ---- The two-level HDR (criterion 3): upper half U, lower half L.
export const STEP = { upper: [192, 128, 64] as [number, number, number], lower: [32, 64, 128] as [number, number, number] };
export const stepPixel = (_x: number, y: number): [number, number, number] => (y < 180 ? STEP.upper : STEP.lower);
/** The share of the prefilter's weight above the horizon for a reflection direction `deltaDeg` above it, as a GGX split-sum prefilter
 * at roughness `rough` weighs it by quadrature (n = v = r, α = roughness², weight D(h)·(n·l), README: Assumed surfaces 4). */
export function upperShare(deltaDeg: number, rough: number): number {
  const a = rough * rough; const a2 = a * a; const tanD = Math.tan(rad(deltaDeg));
  const N = 9000; let num = 0; let den = 0;
  for (let i = 0; i < N; i++) {
    const th = ((i + 0.5) / N) * (Math.PI / 2); const nh = Math.cos(th / 2);
    const dd = a2 / (Math.PI * (nh * nh * (a2 - 1) + 1) ** 2);
    const wgt = dd * Math.cos(th) * Math.sin(th);
    const c = Math.min(1, Math.max(-1, -tanD / Math.tan(th)));
    num += wgt * (Math.acos(c) / Math.PI); den += wgt;
  }
  return num / den;
}
/** `upperShare` at `rough` as a table over −30°…30° every 0.1°, read by linear interpolation. */
export function shareTable(rough: number): (deltaDeg: number) => number {
  const t = Array.from({ length: 601 }, (_, i) => upperShare(-30 + i / 10, rough));
  return (deg) => { const p = (Math.min(30, Math.max(-30, deg)) + 30) * 10; const i = Math.min(599, Math.floor(p)); return t[i]! + (t[i + 1]! - t[i]!) * (p - i); };
}
/** The step HDR with its prefilter applied on the CPU at `rough`: each row the mix by `upperShare` of the row's elevation (a blurred environment, for the planted blur that feeds lighting). */
export function blurredStepPixel(rough: number): (x: number, y: number) => [number, number, number] {
  const share = shareTable(rough);
  return (_x, y) => {
    const el = 90 - (y + 0.5) / 2; const w = share(el);
    return [0, 1, 2].map((k) => Math.round(STEP.lower[k]! + (STEP.upper[k]! - STEP.lower[k]!) * w)) as [number, number, number];
  };
}

// ---- The red-over-blue HDR (criterion 4).
export const RED_M: [number, number, number] = [204, 26, 26];
export const BLUE_M: [number, number, number] = [26, 52, 204];
export const redBluePixel = (_x: number, y: number): [number, number, number] => (y < 180 ? RED_M : BLUE_M);

// ---------------------------------------------------------------------------------------------------
// Documents

/** A `sky@1` item. */
export const sky = (params: JsonObject): JsonObject => ({ kind: 'sky@1', params });
/** `sky@1` params for an HDR environment at `sha`, no ambient gradient, the rest as given. */
export const hdrSky = (sha: string, extra: JsonObject = {}, env: JsonObject = {}): JsonObject =>
  sky({ ambient_top: [0, 0, 0], ambient_low: [0, 0, 0], environment: { from: sha, intensity: 1, ...env }, ...extra });
/** A linear channel on `path`: `a` at 0 s to `b` at 1 s. */
export const sweep = (path: string, a: number, b: number): JsonObject =>
  ({ target: path, type: 'f32', keys: { k0: { t: '0s', value: a, interp: 'linear' }, k1: { t: '1s', value: b, interp: 'linear' } } });
/** The camera's position moving from `a` at 0 s to `b` at 1 s, its target held. */
export const moving = (a: V3, b: V3): JsonObject => ({
  cam_x: sweep('items/cam/params/position/0', a[0], b[0]), cam_y: sweep('items/cam/params/position/1', a[1], b[1]), cam_z: sweep('items/cam/params/position/2', a[2], b[2]),
});
export const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Whether any pixel within `r` px of (x, y) is non-empty in the ID target (a pixel near an item, to leave out). */
export function nearItem(ids: Ids, x: number, y: number, r: number): boolean {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (ids.at(x + dx, y + dy) !== null) return true;
  return false;
}
/** Linear target values as final 8-bit codes. */
export const linCodes = (c: Rgb): Rgb => codes(c);
/** The failure line for a pixel: names it, with what it reads and what it should. */
export function pixelLine(x: number, y: number, what: string, got: Rgb, want: Rgb): string {
  return `(${x}, ${y}) ${what}: reads ${got.join(', ')}, should read ${want.join(', ')} (${codeOff(got, want)} codes off)`;
}
/** The judge every pixel check here uses: null when `got` is within `tol` codes of `want`, else the failure line naming the pixel. */
export function judgePixel(x: number, y: number, what: string, got: Rgb, want: Rgb, tol = 1): string | null {
  return codeOff(got, want) <= tol ? null : pixelLine(x, y, what, got, want);
}
/** A written HDR and a clean reply's frames, for the calls most tests make. */
export const finalOf = (out: string, reply: JsonObject, what: string, n = 0): Image => readPng(out, frameAt(framesOf(reply, what), n, what).final, `${what}, frame ${n}`);

// ---------------------------------------------------------------------------------------------------
// The fixtures the criteria name, shared with the taste test so its screenshots are the same scenes.

/** A dark sky gradient: `top` at the zenith, `low` at the horizon. */
export const DARK_GRADIENT: JsonObject = { top: [0.01, 0.015, 0.03, 1], low: [0.05, 0.05, 0.06, 1] };
/** A uniform dark "gradient" (top = low): its background is one known color whatever a gradient's shape is. */
export const FLAT_DARK: Rgb = [0.04, 0.05, 0.07];
export const FLAT_GRADIENT: JsonObject = { top: [...FLAT_DARK, 1], low: [...FLAT_DARK, 1] };
const NO_AMBIENT: JsonObject = { ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] };

// ---- Criterion 1: the product fixture, a chrome ball on a dark stage.
export const PRODUCT_SIZE: [number, number] = [320, 240];
export const PRODUCT_CAM: Pinhole = { position: [0, 0.6, 3.2], target: [0, 0.4, 0], fov: 40, size: PRODUCT_SIZE };
/** The product fixture under a sky given by its params (a gradient, an environment, a background). */
export function productDoc(skyParams: JsonObject): JsonObject {
  return sessionDoc('product', PRODUCT_SIZE, {
    cam: camera(PRODUCT_CAM.position, PRODUCT_CAM.target, PRODUCT_CAM.fov),
    sky: sky({ ...NO_AMBIENT, ...skyParams }),
    chrome: material({ base_color: [0.9, 0.9, 0.9, 1], metallic: 1, roughness: 0.15 }),
    product: ball(0.5, [0, 0.5, 0], 'chrome'),
  });
}
export const STUDIO: JsonObject = { environment: { from: 'studio', intensity: 1 } };
/** The HDR-rotation fixture: a camera at the origin pitched 45° down over the grid HDR's cells, nothing else but the sky. */
export const ROT_SIZE: [number, number] = [400, 300];
export const ROT_CAM: Pinhole = { position: [0, 0, 0], target: [0, -1, -1], fov: 70, size: ROT_SIZE };
export function rotationDoc(sha: string, rotation: number): JsonObject {
  return sessionDoc('rotation', ROT_SIZE, { cam: camera(ROT_CAM.position, ROT_CAM.target, ROT_CAM.fov), sky: hdrSky(sha, {}, { rotation }) });
}

// ---- Criterion 2: the backdrop on its own ground.
export const GROUND_SIZE: [number, number] = [480, 360];
export const GROUND = { height: 1.7, radius: 20, from: [0, 1.5, 5] as V3, to: [3, 1, 4] as V3, fov: 60, reach: 15 };
export const groundCam = (position: V3): Pinhole => ({ position, target: [0, 0, 0], fov: GROUND.fov, size: GROUND_SIZE });
/** The catcher scene is seen from behind-above so the box's shadow, which falls toward −Z, is in view (the criterion fixes no camera for it). */
export const CATCH_SIZE: [number, number] = [400, 300];
export const CATCH_CAM: Pinhole = { position: [0, 6, -6], target: [0, 0, -0.8], fov: 50, size: CATCH_SIZE };
export const GROUND_FRAMES = 11; // t = n ÷ 10 s: the camera is at `from` at frame 0 and at `to` at frame 10
/** The ground fixture: the grid HDR as the background on its ground, a 0.5 m box at the origin; `catcher` adds the floor that catches
 * shadows on y = 0 under a casting key sun and a non-casting fill sun; `moves` sweeps the camera from `from` to `to` over 1 s. */
export function groundDoc(sha: string, o: { catcher: boolean; moves: boolean }): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: o.catcher ? camera(CATCH_CAM.position, CATCH_CAM.target, CATCH_CAM.fov) : camera(GROUND.from, [0, 0, 0], GROUND.fov),
    sky: hdrSky(sha, { background_ground: { height: GROUND.height, radius: GROUND.radius } }),
    box_mat: material({ base_color: [0.6, 0.2, 0.2, 1], roughness: 0.8 }),
    product: box([0.5, 0.5, 0.5], [0, 0.25, 0], { material: 'box_mat' }),
  };
  if (o.catcher) {
    items['catch_mat'] = material({ base_color: [0.8, 0.8, 0.8, 1], roughness: 1, catch: 'shadow' });
    items['floor'] = box([8, 0.1, 8], [0, -0.05, 0], { material: 'catch_mat' });
    items['key'] = sun(KEY.lx, KEY.rot, true);
    items['fill'] = sun(FILL_LX, [-90, 0, 0], false);
  }
  return sessionDoc(o.catcher ? 'ground-catcher' : 'ground', o.catcher ? CATCH_SIZE : GROUND_SIZE, items, o.moves ? { channels: moving(GROUND.from, GROUND.to) } : {});
}
/** The key sun shines at 45° toward −Z, as #424's catcher fixture's does (its shadow falls behind the box, in view of CATCH_CAM); with the fill straight down
 * it gives the floor π·K lx casting and 3π·K lx not casting, so a shadow removes a quarter of the light (K = 100 makes the environment's own few lx
 * ≤ 0.2% of it). */
export const KEY = { lx: 100 * Math.PI * Math.SQRT2, rot: [-45, 0, 0] as V3 };
export const FILL_LX = 300 * Math.PI;
export const CATCHER_ALPHA = 0.25;
/** Where the ray `d` from `p` meets the ground y = 0 within `reach` m of the vertical axis through the ground's center, or null. */
export function groundHit(p: V3, d: V3, reach: number): V3 | null {
  if (d[1] >= -1e-9) return null;
  const g = add(p, scale(d, -p[1] / d[1]));
  return Math.hypot(g[0], g[2]) <= reach ? g : null;
}
/** The direction the backdrop looks up in the HDR for ground point `g`: from the photo's camera (0, height, 0) to `g`. */
export const backdropDir = (g: V3): V3 => sub(g, [0, GROUND.height, 0]);
/** The planted backdrop: its dome centered above the camera (at the camera's x and z), not above the origin. */
export const plantedBackdropDir = (cam: V3, g: V3): V3 => sub(g, [cam[0], GROUND.height, cam[2]]);
/** The pixel holding world point `p` for `cam`. */
export function pixelOf(cam: Pinhole, p: V3): [number, number] { const [sx, sy] = project(cam, p); return [Math.floor(sx), Math.floor(sy)]; }

// ---- Criterion 3: the blurred background and the product in front of it.
export const BLUR_SIZE: [number, number] = [480, 360];
export const BLUR_CAM: Pinhole = { position: [0, 0, 0], target: [0, 0, -1], fov: 60, size: BLUR_SIZE };
export const BLUR_ROUGHNESS = 0.5;
export function blurDoc(sha: string, blur: number): JsonObject {
  return sessionDoc('blur', BLUR_SIZE, {
    cam: camera(BLUR_CAM.position, BLUR_CAM.target, BLUR_CAM.fov),
    sky: hdrSky(sha, blur > 0 ? { background_blur: blur } : {}),
    rough_metal: material({ base_color: [0.9, 0.9, 0.9, 1], metallic: 1, roughness: 0.35 }),
    product: ball(0.6, [0, 0, -3], 'rough_metal'),
  });
}

// ---- Criterion 4: fog that takes the background's color.
export const FOG_SIZE: [number, number] = [321, 241];
export const FOG = { density: 0.02, nearSurface: 50, nearRadius: 2, farSurface: 1000, farRadius: 30, farAzimuth: 6, bgAzimuth: 10, fov: 30 };
/** Camera at the eye (the origin) aimed at the near sphere, whose centre is `nearSurface + nearRadius` m away `elev`° above the horizon (below, when negative). */
export function fogCam(elev: number): Pinhole {
  return { position: [0, 0, 0], target: [0, Math.sin(rad(elev)), -Math.cos(rad(elev))], fov: FOG.fov, size: FOG_SIZE };
}
/** The direction `az`° to the right of straight ahead, `elev`° above the horizon. */
export const fogDir = (az: number, elev: number): V3 => [Math.cos(rad(elev)) * Math.sin(rad(az)), Math.sin(rad(elev)), -Math.cos(rad(elev)) * Math.cos(rad(az))];
export function fogSpheres(elev: number): { near: V3; far: V3 } {
  return { near: scale(fogDir(0, elev), FOG.nearSurface + FOG.nearRadius), far: scale(fogDir(FOG.farAzimuth, elev), FOG.farSurface + FOG.farRadius) };
}
/** The two spheres, the fog's density as given, the HDR (red above the horizon, blue below) behind them. */
export function fogDoc(sha: string, elev: number, density: number, skyExtra: JsonObject = {}): JsonObject {
  const { near, far } = fogSpheres(elev); const cam = fogCam(elev);
  return sessionDoc('fog', FOG_SIZE, {
    cam: camera(cam.position, cam.target, cam.fov, { near: 1, far: 5000 }),
    sky: hdrSky(sha, { fog: 'background', fog_curve: 'exp', fog_density: density, ...skyExtra }),
    grey: material({ base_color: [0.6, 0.6, 0.6, 1], metallic: 0, roughness: 0.6 }),
    near: ball(FOG.nearRadius, near, 'grey'),
    far: ball(FOG.farRadius, far, 'grey'),
  });
}
export interface FogPixels { near: [number, number]; far: [number, number]; bg: [number, number] }
/** The pixels the criterion reads: each sphere's centre pixel, and the background pixel next to the far one (`bgAzimuth`° right, same elevation). */
export function fogPixels(elev: number): FogPixels {
  const cam = fogCam(elev); const { near, far } = fogSpheres(elev);
  return { near: pixelOf(cam, near), far: pixelOf(cam, far), bg: pixelOf(cam, scale(fogDir(FOG.bgAzimuth, elev), 100)) };
}
export const RED = mant(RED_M);
export const BLUE = mant(BLUE_M);
/** The environment's mean radiance over the sphere (half red, half blue by solid angle): the planted fog's color. */
export const MEAN_ENV: Rgb = [0, 1, 2].map((k) => (RED[k]! + BLUE[k]!) / 2) as Rgb;
export const mix3 = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map((k) => a[k]! + (b[k]! - a[k]!) * t) as Rgb;
export const linOff = (a: Rgb, b: Rgb): number => Math.max(...[0, 1, 2].map((k) => Math.abs(a[k]! - b[k]!))) * 255;
