// Test-side tools for the #419 acceptance tests: the base's `deep-gpu` binary (#377's GPU layer with #378's `view3d`
// and #421-#425's renderer), built once per file and driven by JSON lines; the calls, fields and fixture kinds this
// suite adds (README: Assumed surfaces); the fixtures the criteria name and the taste test shares (the slider whose
// move and reading hold AC1 judges, the still scene AC2 and AC7 settle, the walker AC4 blurs, the car over its lines
// AC8 tracks); and the reviewed references the criteria are held to: an orthographic projection, a bone pose's shutter
// coverage, the energy-weighted width of a band, sRGB codes, PNG reading and writing and a minimal glTF writer (copied
// in part from #424's helpers, since suites don't import each other). Nothing here stands in for the renderer, the
// samples, the motion blur or the settle under test.

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
/** The checkout root (tests/acceptance/419 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text (README: Criteria to tests). */
export const AC = {
  1: 'AC1 #419.f32101aa',
  2: 'AC2 #419.a8380bef',
  3: 'AC3 #419.209b85be',
  4: 'AC4 #419.b5c57ec8',
  5: 'AC5 #419.a7e27e24',
  6: 'AC6 #419.fe6b20a9',
  7: 'AC7 #419.06b9bdd4',
  8: 'AC8 #419.ef726005',
  9: 'AC9 #419.fc4ea214',
} as const;

// ---------------------------------------------------------------------------------------------------
// JSON and verdict helpers

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
/** Writes `value` as JSON under `dir` and returns its absolute path. */
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

// ---------------------------------------------------------------------------------------------------
// The machine and the build

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** The GPU layer draws these pixels on macOS's Metal device, the reference platform. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these pixels on macOS's Metal device; this is ${process.platform}`);
}

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
    dir = mkdtempSync(join(tmpdir(), 'deep-419-bin-'));
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
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-419-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one JSON line in, one JSON line out (#377).

/** `deep-gpu --planted` names this suite adds, each a wrong program reachable only there (README: Assumed surfaces). */
export type GpuPlanted = 'velocity_from_transform' | 'sampler_steps_world' | 'velocity_pairs_by_index' | 'settle_resets_each_frame' | 'sampler_holds_camera';

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
// Looks: #424's plain physical look (tone map none at the exposure whose scale is 1, so the final target is the sRGB
// encoding of the linear target), with this suite's samples and motion blur (README: Assumed surfaces 1 and 2).

const STATUS: JsonObject = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
const PLAIN_LOOK: JsonObject = {
  id: 'look-419-plain', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'A #419 acceptance look.',
  palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', stone: '#d9dde3' },
  roles: { ground: 'night', ink: 'graphite', muted: 'slate', stone: 'stone' },
  themes: { light: {}, dark: {} },
  fonts: {
    body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
    mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  },
  tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ground_3d: { kind: 'none' },
  status: { ...STATUS }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: 0.1,
  attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
};

/** Motion blur's fields (Motion blur; Motion blur: velocity), the design's defaults beside what's given. */
export function blur(method: 'samples' | 'velocity', samples = 8, extra: JsonObject = {}): JsonObject {
  return {
    scope: 'declared_moves', method, shutter_angle: 180, phase: 'centred', samples, adaptive: true, exclude: [],
    velocity: { taps: 16, max: 32, tile: 20 }, ...extra,
  };
}
export interface LookOpts {
  live?: number; export?: number; atRest?: 'none' | 'settle';
  filter?: 'box' | 'blackman_harris'; filterPx?: number; vary?: string[];
  motionBlur?: JsonObject | 'none';
}
/** The plain look with `samples`, `filter`, `filter_px`, `vary`, `sequence` and `motion_blur` (README: Assumed
 * surfaces 1). By default one sample, a 1 px box filter and no motion blur, so a test turns on only what it judges. */
export function look(o: LookOpts = {}): JsonObject {
  return {
    ...PLAIN_LOOK,
    samples: { live: o.live ?? 1, export: o.export ?? 1, at_rest: o.atRest ?? 'none' },
    filter: o.filter ?? 'box', filter_px: o.filterPx ?? 1, vary: o.vary ?? ['pixel'], sequence: 'r2',
    motion_blur: o.motionBlur ?? 'none',
  };
}

// ---------------------------------------------------------------------------------------------------
// Documents

export const AGENT = 'agent:sess-alpha';
/** A scene document as a session holds it (#378): an `id`, one writer layer, every item in it. */
export function sessionDoc(id: string, size: [number, number], items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(4, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #419 acceptance fixture.`, size, camera: 'cam', transport: { span: '10s' },
    requires: { modules: { scene3d: '^1' } }, layers: { main: { writer: AGENT, title: 'main', order: 'a0' } }, ...extra, items: withIds,
  };
}

export type V3 = [number, number, number];
export type Rgb = [number, number, number];
export const box = (size: V3, pos: V3, extra: JsonObject = {}): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos }, ...extra });
/** An orthographic `camera@1` looking along −Z at `target`, `view_width` m across the frame (Camera `camera@1`). */
export const ortho = (target: V3, viewWidth: number): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'orthographic', position: [target[0], target[1], target[2] + 20], target, view_width: viewWidth, near: 0.1, far: 100 } });
export const material = (params: JsonObject): JsonObject => ({ kind: 'material@1', params });
/** An unlit opaque material of linear `color`, both faces drawn. */
export const unlit = (color: Rgb): JsonObject => material({ base_color: [...color, 1], unlit: true, double_sided: true });
/** A black sky with no ambient and no environment: the background reads 0. */
export const DARK_SKY: JsonObject = { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } };
/** An f32 channel on `path` through `keys` ([seconds, value]), linear between them. */
export function channel(path: string, keys: [number, number][]): JsonObject {
  const k: JsonObject = {};
  keys.forEach(([t, value], i) => { k[`k${i}`] = { t: `${t}s`, value, interp: 'linear' }; });
  return { target: path, type: 'f32', keys: k };
}

// ---------------------------------------------------------------------------------------------------
// view3d (#378) and what this suite adds to it

export interface Viewer { frame: number; pointer?: [number, number]; hover?: string | null; selection?: string[]; readout?: { item: string; text: string } }
export interface View3d {
  doc: string; look: JsonObject; size: [number, number]; frames?: number; fps?: number; from?: number;
  capture?: 'every' | number[]; targets?: ('final' | 'linear' | 'scene')[]; assets?: Record<string, string>;
  /** This suite's (README: Assumed surfaces 3 and 4). */
  class?: 'live' | 'export'; viewer?: Viewer[];
}
export const view3dCall = (v: View3d): JsonObject => ({ call: 'view3d', frames: 1, fps: 24, capture: 'every', ...(v as unknown as JsonObject) });
export interface Samples { drawn: number; settling: boolean }
export interface ViewFrame { frame: number; final: string | null; linear: string | null; scene: string | null; notices: JsonObject[]; samples: Samples | null }
const optStr = (v: JsonValue | undefined, what: string): string | null => (v === undefined || v === null ? null : str(v, what));
export function framesOf(reply: JsonObject, what: string): ViewFrame[] {
  answered(reply, what);
  return arr(reply['frames'], `${what}: frames`).map((v, i): ViewFrame => {
    const f = obj(v, `${what}: frames[${i}]`); const at = `${what}: frames[${i}]`;
    let samples: Samples | null = null;
    if (f['samples'] !== undefined) {
      const s = obj(f['samples'], `${at}.samples`);
      expect(typeof s['settling'], `${at}.samples.settling is a boolean`).toBe('boolean');
      samples = { drawn: num(s['drawn'], `${at}.samples.drawn`), settling: s['settling'] as boolean };
    }
    return {
      frame: num(f['frame'], `${at}.frame`), final: optStr(f['final'], `${at}.final`), linear: optStr(f['linear'], `${at}.linear`),
      scene: optStr(f['scene'], `${at}.scene`), notices: arr(f['notices'] ?? [], `${at}.notices`).map((n, j) => obj(n, `${at}.notices[${j}]`)), samples,
    };
  });
}
export function frameAt(frames: ViewFrame[], n: number, what: string): ViewFrame {
  const f = frames.find((x) => x.frame === n);
  expect(f, `${what}: frame ${n} is in the reply`).toBeDefined();
  return f!;
}
/** The frame's `samples` report (README: Assumed surfaces 5), which every frame carries. */
export function samplesOf(f: ViewFrame, what: string): Samples {
  expect(f.samples, `${what}: frame ${f.frame} reports samples {drawn, settling}`).not.toBeNull();
  return f.samples!;
}

// Targets: files the binary wrote, each named by its SHA-256 (#378).
export function readNamed(out: string, hash: string | null, ext: string, what: string): Buffer {
  expect(hash, `${what} is written, named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${hash}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}
/** The linear target as read back (#378): little-endian f32 RGBA, rows top-down, `w × h × 16` bytes. */
export interface Linear { width: number; height: number; at: (x: number, y: number) => Rgb }
export function readLinear(out: string, f: ViewFrame, size: [number, number], what: string): Linear {
  const file = readNamed(out, f.linear, 'f32', what);
  expect(file.length, `${what} holds ${size[0]} × ${size[1]} f32 RGBA pixels`).toBe(size[0] * size[1] * 16);
  const o = (x: number, y: number): number => (y * size[0] + x) * 16;
  return { width: size[0], height: size[1], at: (x, y) => [file.readFloatLE(o(x, y)), file.readFloatLE(o(x, y) + 4), file.readFloatLE(o(x, y) + 8)] };
}
export const lum = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

export interface Image { width: number; height: number; rgba: Uint8Array }
export const px = (im: Image, x: number, y: number): Rgb => { const o = (y * im.width + x) * 4; return [im.rgba[o]!, im.rgba[o + 1]!, im.rgba[o + 2]!]; };
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** Reads an 8-bit RGB or RGBA PNG with no interlace. */
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(SIGNATURE)) throw Error('not a PNG');
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
  return { width, height, rgba };
}
export const readPng = (out: string, hash: string | null, what: string): Image => decodePng(readNamed(out, hash, 'png', what));

// PNG and APNG written by the suite (no filter, zlib level 9), so the same pixels give the same SHA-256.
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}
const ihdr = (w: number, h: number): Buffer => { const b = Buffer.alloc(13); b.writeUInt32BE(w, 0); b.writeUInt32BE(h, 4); b[8] = 8; b[9] = 2; return b; };
function rows(image: Image): Buffer {
  const raw = Buffer.alloc((image.width * 3 + 1) * image.height);
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const o = (y * image.width + x) * 4; const r = y * (image.width * 3 + 1) + 1 + x * 3;
    raw[r] = image.rgba[o]!; raw[r + 1] = image.rgba[o + 1]!; raw[r + 2] = image.rgba[o + 2]!;
  }
  return deflateSync(raw, { level: 9 });
}
/** An animated PNG of equal-sized frames at `fps`, looping: the recording of a declared move. */
export function encodeApng(frames: Image[], fps: number): Buffer {
  const { width, height } = frames[0]!;
  const actl = Buffer.alloc(8); actl.writeUInt32BE(frames.length, 0); actl.writeUInt32BE(0, 4);
  const parts: Buffer[] = [SIGNATURE, chunk('IHDR', ihdr(width, height)), chunk('acTL', actl)];
  let seq = 0;
  frames.forEach((f, i) => {
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(seq++, 0); fctl.writeUInt32BE(width, 4); fctl.writeUInt32BE(height, 8); fctl.writeUInt32BE(0, 12); fctl.writeUInt32BE(0, 16);
    fctl.writeUInt16BE(1, 20); fctl.writeUInt16BE(fps, 22); fctl[24] = 0; fctl[25] = 0;
    parts.push(chunk('fcTL', fctl));
    const data = rows(f);
    if (i === 0) parts.push(chunk('IDAT', data));
    else { const s = Buffer.alloc(4); s.writeUInt32BE(seq++, 0); parts.push(chunk('fdAT', Buffer.concat([s, data]))); }
  });
  parts.push(chunk('IEND', new Uint8Array(0)));
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------------------------------
// Reviewed references

/** The orthographic view `ortho()` makes: frame px of world point `p`. */
export function orthoProject(target: V3, viewWidth: number, size: [number, number], p: readonly number[]): [number, number] {
  const k = size[0] / viewWidth;
  return [size[0] / 2 + (p[0]! - target[0]) * k, size[1] / 2 - (p[1]! - target[1]) * k];
}
/** Its inverse on the plane z = 0: the world (x, y) at frame point (sx, sy). */
export function orthoUnproject(target: V3, viewWidth: number, size: [number, number], sx: number, sy: number): [number, number] {
  const k = size[0] / viewWidth;
  return [target[0] + (sx - size[0] / 2) / k, target[1] - (sy - size[1] / 2) / k];
}
/** The shutter at frame time `t` (s): 180° at `fps`, centred, as [open, close]. */
export const shutter = (t: number, fps: number, angle = 180): [number, number] => { const s = angle / 360 / fps; return [t - s / 2, t + s / 2]; };
/** The width of a band of energy along a row: the uniform band with the same energy-weighted spread, √(12 σ²), each
 * pixel counted 1 px wide (σ² gains 1/12), so a lone 1 px line reads 1 and a 1 px line swept over L px reads ≈ √(L² + 2). */
export function bandWidth(energy: readonly number[]): { width: number; sum: number } {
  const sum = energy.reduce((s, e) => s + e, 0);
  if (sum <= 0) return { width: 0, sum };
  const mean = energy.reduce((s, e, i) => s + e * i, 0) / sum;
  const variance = energy.reduce((s, e, i) => s + e * (i - mean) ** 2, 0) / sum + 1 / 12;
  return { width: Math.sqrt(12 * variance), sum };
}

// Meshes as glTF: a `mesh.asset@1` (and this suite's `mesh.sequence@1` frames) read a JSON glTF with its buffer inline
// as a data URI (#420).
export interface Mesh { positions: V3[]; triangles: [number, number, number][] }
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
/** A box's 8 corners and 12 triangles, from `lo` to `hi`, its vertices numbered from `base`. */
export function boxMesh(lo: V3, hi: V3, base = 0): Mesh {
  const positions: V3[] = [];
  for (let k = 0; k < 8; k++) positions.push([k & 1 ? hi[0] : lo[0], k & 2 ? hi[1] : lo[1], k & 4 ? hi[2] : lo[2]]);
  const faces = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
  const triangles = faces.flatMap(([a, b, c, d]) => [[a! + base, b! + base, c! + base], [a! + base, c! + base, d! + base]] as [number, number, number][]);
  return { positions, triangles };
}

// ---------------------------------------------------------------------------------------------------
// The slider (AC1, AC3 and the recording): a 1 m white box sliding along x at 8 m/s from −4 m (0 s) to +4 m (1 s),
// still until 2 s, sliding back to −4 m by 3 s; optionally a reading hold (a `hold` marker) over 2–3 s.

export const SLIDER_SIZE: [number, number] = [480, 270];
export const SLIDER = { target: [0, 0, 0] as V3, viewWidth: 8, fps: 24, keys: [[0, -4], [1, 4], [2, 4], [3, -4]] as [number, number][] };
export function sliderDoc(hold: boolean): JsonObject {
  return sessionDoc(`slider-${hold ? 'hold' : 'plain'}`, SLIDER_SIZE, {
    cam: ortho(SLIDER.target, SLIDER.viewWidth), sky: DARK_SKY, white: unlit([1, 1, 1]),
    slider: box([1, 1, 0.2], [-4, 0, 0], { material: 'white' }),
  }, {
    channels: { slide: channel('items/slider/at/pos/0', SLIDER.keys) },
    ...(hold ? { markers: { read: { kind: 'hold', name: 'read', t: '2s', span: '1s' } } } : {}),
  });
}

// ---------------------------------------------------------------------------------------------------
// The still scene (AC2, AC7 and the taste call's still): a lit floor, a block turned 23° and a ball under a casting
// sun, seen in perspective, nothing moving; with `readout`, an `overlay.text@1` readout in its corner.

export const STILL_SIZE: [number, number] = [320, 240];
export function stillDoc(readout: boolean): JsonObject {
  return sessionDoc(`still-${readout ? 'readout' : 'plain'}`, STILL_SIZE, {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [2.5, 2, 4], target: [0, 0.3, 0], fov: 40, near: 0.1, far: 100 } },
    sky: DARK_SKY,
    grey: material({ base_color: [0.6, 0.6, 0.6, 1], roughness: 0.6 }),
    orange: material({ base_color: [0.8, 0.35, 0.1, 1], roughness: 0.4 }),
    floor: box([6, 0.1, 6], [0, -0.05, 0], { material: 'grey' }),
    block: box([0.8, 0.8, 0.8], [-0.5, 0.4, 0], { material: 'orange', at: { pos: [-0.5, 0.4, 0], rot: [0, 23, 0] } }),
    ball: { kind: 'ball@1', params: { radius: 0.35, segments: 64 }, at: { pos: [0.7, 0.35, 0.3] }, material: 'grey' },
    sun: { kind: 'light.sun@1', params: { illuminance: 3, color: [1, 1, 1], shadow: true }, at: { rot: [-50, 30, 0] } },
    ...(readout ? { readout: { kind: 'overlay.text@1', params: { anchor: 'corner', role: 'readout', template: 'x = 0' } } } : {}),
  });
}

// ---------------------------------------------------------------------------------------------------
// The walker (AC4 and the taste call): `fixture.skin@1` (README: Assumed surfaces 9), a torso and two legs skinned to
// a root and two leg bones, the root still; each leg 0.2 m wide and 1.5 m long hangs from its hip at x = ∓0.9 m and
// swings about +Z, the left −30° → +30° → −30° over 0 → 0.5 → 1 s and the right mirrored, so at t = 0.25 s both
// pass upright at 120°/s.

export const WALKER_SIZE: [number, number] = [640, 480];
export const WALKER = { target: [0, -0.55, 0] as V3, viewWidth: 3, fps: 24, frame: 6, hips: { leg_l: -0.9, leg_r: 0.9 }, width: 0.2, length: 1.5 };
const SWING: Record<'leg_l' | 'leg_r', [number, number][]> = { leg_l: [[0, -30], [0.5, 30], [1, -30]], leg_r: [[0, 30], [0.5, -30], [1, 30]] };
/** A leg's angle (degrees about +Z) at `t` s, as its channel keys it. */
export function legAngle(leg: 'leg_l' | 'leg_r', t: number): number {
  const keys = SWING[leg];
  for (let i = 0; i + 1 < keys.length; i++) {
    const [t0, v0] = keys[i]!; const [t1, v1] = keys[i + 1]!;
    if (t >= t0 && t <= t1) return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
  }
  return keys[keys.length - 1]![1];
}
export function walkerDoc(): JsonObject {
  const half = WALKER.width / 2;
  const parts = [
    { mesh: boxMesh([-1, 0, -0.1], [1, 0.4, 0.1]), bone: 0 },
    { mesh: boxMesh([WALKER.hips.leg_l - half, -WALKER.length, -0.1], [WALKER.hips.leg_l + half, 0, 0.1]), bone: 1 },
    { mesh: boxMesh([WALKER.hips.leg_r - half, -WALKER.length, -0.1], [WALKER.hips.leg_r + half, 0, 0.1]), bone: 2 },
  ];
  const positions: JsonValue[] = []; const triangles: JsonValue[] = []; const joints: JsonValue[] = []; const weights: JsonValue[] = [];
  for (const p of parts) {
    const base = positions.length;
    p.mesh.positions.forEach((v) => { positions.push(v); joints.push([p.bone, 0, 0, 0]); weights.push([1, 0, 0, 0]); });
    p.mesh.triangles.forEach((t) => triangles.push(t.map((i) => i + base)));
  }
  return sessionDoc('walker-419', WALKER_SIZE, {
    cam: ortho(WALKER.target, WALKER.viewWidth), sky: DARK_SKY, white: unlit([1, 1, 1]),
    walker: {
      kind: 'fixture.skin@1', at: { pos: [0, 0, 0] }, material: 'white',
      params: {
        positions, triangles, joints, weights,
        bones: [
          { id: 'root', parent: null, pos: [0, 0, 0], rot: [0, 0, 0] },
          { id: 'leg_l', parent: 0, pos: [WALKER.hips.leg_l, 0, 0], rot: [0, 0, 0] },
          { id: 'leg_r', parent: 0, pos: [WALKER.hips.leg_r, 0, 0], rot: [0, 0, 0] },
        ],
      },
    },
  }, {
    channels: {
      swing_l: channel('items/walker/params/bones/1/rot/2', SWING.leg_l),
      swing_r: channel('items/walker/params/bones/2/rot/2', SWING.leg_r),
    },
  });
}
/** Whether world point (x, y) lies on `leg` at angle `deg`. */
function onLeg(leg: 'leg_l' | 'leg_r', deg: number, x: number, y: number): boolean {
  const a = (-deg * Math.PI) / 180; const dx = x - WALKER.hips[leg]; const dy = y;
  const qx = Math.cos(a) * dx - Math.sin(a) * dy; const qy = Math.sin(a) * dx + Math.cos(a) * dy;
  return Math.abs(qx) <= WALKER.width / 2 && qy >= -WALKER.length && qy <= 0;
}
/** Each leg's blur band at the judged frame: pixels below the hips whose centres the leg covers for between 5% and
 * 95% of the 180° shutter (64 times), with that share, and the pixels it covers at the frame's own time. */
export function walkerBands(): Record<'leg_l' | 'leg_r', { x: number; y: number; share: number; sharp: boolean }[]> {
  const t = WALKER.frame / WALKER.fps; const [open, close] = shutter(t, WALKER.fps);
  const out = { leg_l: [] as { x: number; y: number; share: number; sharp: boolean }[], leg_r: [] as { x: number; y: number; share: number; sharp: boolean }[] };
  for (const leg of ['leg_l', 'leg_r'] as const) {
    for (let sy = 0; sy < WALKER_SIZE[1]; sy++) for (let sx = 0; sx < WALKER_SIZE[0]; sx++) {
      const [x, y] = orthoUnproject(WALKER.target, WALKER.viewWidth, WALKER_SIZE, sx + 0.5, sy + 0.5);
      if (y > -0.05) continue;
      let hits = 0;
      for (let k = 0; k < 64; k++) if (onLeg(leg, legAngle(leg, open + ((k + 0.5) / 64) * (close - open)), x, y)) hits++;
      const share = hits / 64;
      if (share > 0.05 && share < 0.95) out[leg].push({ x: sx, y: sy, share, sharp: onLeg(leg, legAngle(leg, t), x, y) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The car (AC8 and the taste call): an orthographic camera 19.2 m across 1920 × 1080 (100 px/m) tracks a red 4 × 1.5 m
// car at 6 m/s (600 px/s across the view) over a still background of 1 px (0.01 m) white vertical lines every 0.64 m
// on black; both from x = 0 at 0 s to 24 m at 4 s, so at t = 2 s the camera is at 12 m.

export const CAR_SIZE: [number, number] = [1920, 1080];
export const CAR = { viewWidth: 19.2, fps: 24, frame: 48, speed: 6, lines: 50, first: -10, pitch: 0.64, half: [2, 0.75] as [number, number], color: [0.8, 0.1, 0.1] as Rgb };
export function carDoc(): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: ortho([0, 0, 0], CAR.viewWidth), sky: DARK_SKY, white: unlit([1, 1, 1]), red: unlit(CAR.color),
    car: box([2 * CAR.half[0], 2 * CAR.half[1], 0.5], [0, 0, 1], { material: 'red' }),
  };
  for (let k = 0; k < CAR.lines; k++) items[`line_${String(k).padStart(2, '0')}`] = box([0.01, 12, 0.01], [CAR.first + CAR.pitch * k + 0.005, 0, 0], { material: 'white' });
  const move: [number, number][] = [[0, 0], [4, 4 * CAR.speed]];
  return sessionDoc('car-419', CAR_SIZE, items, {
    channels: {
      cam_x: channel('items/cam/params/position/0', move),
      aim_x: channel('items/cam/params/target/0', move),
      car_x: channel('items/car/at/pos/0', move),
    },
  });
}
/** The frame-time px column of background line k at the judged frame (t = 2 s, camera at 12 m). */
export const carLineColumn = (k: number): number => (CAR.first + CAR.pitch * k + 0.005 - CAR.speed * (CAR.frame / CAR.fps)) * 100 + CAR_SIZE[0] / 2;
/** The car's whole pixels at the judged frame: [x0, x1) × [y0, y1). */
export const CAR_PIXELS = { x0: CAR_SIZE[0] / 2 - CAR.half[0] * 100, x1: CAR_SIZE[0] / 2 + CAR.half[0] * 100, y0: CAR_SIZE[1] / 2 - CAR.half[1] * 100, y1: CAR_SIZE[1] / 2 + CAR.half[1] * 100 };
