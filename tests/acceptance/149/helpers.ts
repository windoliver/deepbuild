// Test-side tools for the #149 acceptance tests: the base's `deep-gpu` binary, built once per file and driven by JSON
// lines; `deep-canvas-render check` and `deep-canvas parse`; the fields this suite adds (README: The surface under
// test); the fixtures; PNG, f32 and APNG reading and writing; and the reprojection a dolly and a zoom are judged by.
// Nothing here stands in for the renderer: answers come from the issue's formulas, computed in the tests.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from 'vitest';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
export type JsonObject = { [k: string]: JsonValue };

// Vitest's 5 s default stays out, under any root: every test here spawns the GPU or a build.
vi.setConfig({ testTimeout: 3_600_000, hookTimeout: 3_600_000 });

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/149 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const FIXTURES = join(HERE, 'fixtures');
export const GOLDENS = join(HERE, 'goldens');

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text (README: Criteria to tests). */
export const AC = {
  1: 'AC1 #149.71fb5e48',
  2: 'AC2 #149.c0138bef',
  3: 'AC3 #149.92bebcd4',
  4: 'AC4 #149.fc5501aa',
  5: 'AC5 #149.75d75ba2',
  6: 'AC6 #149.9ffe6b6a',
  7: 'AC7 #149.f455f94d',
  8: 'AC8 #149.1c3a3068',
  9: 'AC9 #149.e2b5abff',
  10: 'AC10 #149.affd8de8',
  11: 'AC11 #149.c911c0df',
  12: 'AC12 #149.583b9b35',
} as const;

// ---------------------------------------------------------------------------------------------------
// JSON and judging

export const shown = (v: unknown): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${shown(v)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${shown(v)}`).toBe(true);
  return v as JsonValue[];
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${shown(v)}`).toBe('string');
  return v as string;
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v, `${what} is a number, got ${shown(v)}`).toBe('number');
  return v as number;
}
export const clone = <T extends JsonValue>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** At least one failure, and one that names `name`: what a planted program must give. */
export function failsNaming(failures: readonly string[], name: string, what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  expect(failures.some((f) => f.includes(name)), `${what}: a failure names "${name}"; the failures were:\n  ${failures.slice(0, 40).join('\n  ')}`).toBe(true);
}
/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** The GPU layer draws these pixels on macOS's Metal device; anywhere else the test is INCONCLUSIVE. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these pixels on macOS's Metal device; this is ${process.platform}`);
}
export const REFERENCE_MACS = ['Mac15,7', 'Mac15,12'];
export const hardwareModel = (): string => {
  const r = spawnSync('sysctl', ['-n', 'hw.model'], { encoding: 'utf8' });
  return (r.stdout ?? '').trim();
};
/** Whether this machine is a reference Mac; a golden is recorded only on one. */
export const onReferenceMac = (): boolean => process.platform === 'darwin' && REFERENCE_MACS.includes(hardwareModel());
/** The one-minute load per CPU core: over 1 the machine is loaded, and a timing reads INCONCLUSIVE. */
export const loadPerCore = (): number => loadavg()[0]! / cpus().length;

// ---------------------------------------------------------------------------------------------------
// The build: each binary built once per file and copied out of the target folder.

const targetDir = (): string => process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');
function cargoBuild(bin: string): string {
  const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const args = ['build', '--locked', '--bin', bin];
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
/** `bin` built once for this file; the returned function gives its path, failing the test if the build failed. */
export function useBin(bin: string): () => string {
  let dir = ''; let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-149-bin-'));
    error = cargoBuild(bin);
    if (error === '') copyFileSync(join(targetDir(), 'debug', bin), join(dir, bin));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => { expect(error, `the binary builds: cargo build --locked --bin ${bin}`).toBe(''); return join(dir, bin); };
}
export const useGpu = (): (() => string) => useBin('deep-gpu');
/** A fresh temporary folder per test, deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-149-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one JSON line in, one JSON line out (#377). Each runGpu is a fresh process.

/** The wrong programs this suite plants, each reachable only through `--planted` (README: Planted programs). */
export type Planted = 'ink_fill_flat' | 'draws_black' | 'rim_keeps_first';
export function runGpu(bin: string, out: string, calls: JsonObject[], planted?: Planted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const name = `deep-gpu ${args.join(' ')}`;
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${name}: ${run.error.message}`);
  expect(timedOut, `${name} finished within its timeout`).toBe(false);
  const stdout = run.stdout ?? '';
  expect(run.status, `${name} exited 0 (${run.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(run.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, `${name}: the answer`);
  expect(answer['ok'], `${name} refused the scenario: ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], `${name}: replies`).map((r, i) => obj(r, `${name}: replies[${i}]`));
  expect(replies.length, `${name}: one reply per call`).toBe(calls.length);
  return replies;
}
export function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  return reply;
}
/** A one-line binary on JSON lines (`deep-canvas-render check`, `deep-canvas parse unit`). */
export function oneLine(bin: string, args: string[], input: JsonValue): JsonObject {
  const run = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify(input)}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 600_000, killSignal: 'SIGKILL' });
  if (run.error) throw Error(`${args.join(' ')}: ${run.error.message}`);
  const lines = (run.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${args.join(' ')}: one output line; stderr: ${(run.stderr ?? '').slice(-2000)}`).toBe(1);
  return obj(JSON.parse(lines[0]!) as JsonValue, `${args.join(' ')}: the answer`);
}
export interface Issue { code: string; severity: string; ids: string[]; path: string }
export function errorsOf(answer: JsonObject): Issue[] {
  return (Array.isArray(answer['issues']) ? answer['issues'] : []).map((v) => {
    const i = v as JsonObject;
    return { code: String(i['code']), severity: String(i['severity']), path: String(i['path']), ids: Array.isArray(i['ids']) ? i['ids'].map(String) : [] };
  }).filter((i) => i.severity === 'error');
}

// ---------------------------------------------------------------------------------------------------
// Pictures: 8-bit PNG (straight alpha) and f32 files (RGBA, premultiplied, sRGB-encoded in a 2D layer).

export interface Image { width: number; height: number; rgba: Uint8Array }
export interface Floats { width: number; height: number; data: Float32Array }
/** Channel `c` of (x, y). */
export const at = (im: Floats, x: number, y: number, c: number): number => im.data[(y * im.width + x) * 4 + c]!;
export const alphaAt = (im: Floats, x: number, y: number): number => at(im, x, y, 3);
export const hasFile = (out: string, hash: JsonValue | undefined, ext: string, what: string): Buffer => {
  const name = str(hash, `${what}: its file's SHA-256`);
  const bytes = readFileSync(join(out, `${name}.${ext}`));
  expect(sha256(bytes), `${what}: the file is named by its SHA-256`).toBe(name);
  return bytes;
};
export const dropFile = (out: string, hash: JsonValue | undefined, ext: string): void => { if (typeof hash === 'string') rmSync(join(out, `${hash}.${ext}`), { force: true }); };
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(SIGNATURE)) throw Error('not a PNG');
  let pos = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (pos < file.length) {
    const length = file.readUInt32BE(pos);
    const type = file.toString('latin1', pos + 4, pos + 8);
    const body = file.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    pos += 12 + length;
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
      const a = i >= channels ? line[i - channels]! : 0; const b = previous[i]!; const c = i >= channels ? previous[i - channels]! : 0;
      const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter];
      if (pred === undefined) throw Error(`PNG filter ${filter}`);
      line[i] = (line[i]! + pred) & 255;
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
export function readFloats(out: string, hash: JsonValue | undefined, size: readonly [number, number], what: string): Floats {
  const bytes = hasFile(out, hash, 'f32', what);
  const [width, height] = size;
  expect(bytes.length, `${what}: an f32 file holds width × height × 16 bytes`).toBe(width * height * 16);
  const data = new Float32Array(bytes.length / 4);
  for (let i = 0; i < data.length; i++) data[i] = bytes.readFloatLE(i * 4);
  return { width, height, data };
}
function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}
/** An 8-bit gray PNG written by the suite, for a tooth's `from`. */
export function encodeGrayPng(width: number, height: number, value: (x: number, y: number) => number): Buffer {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw[y * (width + 1) + 1 + x] = value(x, y);
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))]);
}
/** An animated PNG of equal-sized frames at `fps`, looping, written by the suite: the dolly and zoom recording. */
export function encodeApng(frames: Image[], fps: number): Buffer {
  const { width, height } = frames[0]!;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const actl = Buffer.alloc(8); actl.writeUInt32BE(frames.length, 0);
  const parts: Buffer[] = [SIGNATURE, chunk('IHDR', ihdr), chunk('acTL', actl)];
  let seq = 0;
  frames.forEach((f, i) => {
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(seq++, 0); fctl.writeUInt32BE(width, 4); fctl.writeUInt32BE(height, 8); fctl.writeUInt16BE(1, 20); fctl.writeUInt16BE(fps, 22);
    parts.push(chunk('fcTL', fctl));
    const raw = Buffer.alloc((width * 3 + 1) * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4; const r = y * (width * 3 + 1) + 1 + x * 3;
      raw[r] = f.rgba[o]!; raw[r + 1] = f.rgba[o + 1]!; raw[r + 2] = f.rgba[o + 2]!;
    }
    const data = deflateSync(raw, { level: 9 });
    if (i === 0) parts.push(chunk('IDAT', data));
    else { const s = Buffer.alloc(4); s.writeUInt32BE(seq++, 0); parts.push(chunk('fdAT', Buffer.concat([s, data]))); }
  });
  parts.push(chunk('IEND', new Uint8Array(0)));
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------------------------------
// The calls: `layers` (#385, #430), `film2d` (#417, #430), `view3d` (#378), `golden` (#380, #422), with this suite's
// additions (README: The surface under test).

const FLICKS_PER_SECOND = 705_600_000;
export const flickOf = (n: number, fps: number): number => Math.round((n * FLICKS_PER_SECOND) / fps);

export const layersCall = (doc: JsonObject, look: JsonValue, extra: JsonObject = {}): JsonObject => ({ call: 'layers', doc, look, by: ['gpu_layer'], float: true, ...extra });
/** One writer layer's (or the `ground` row's) GPU-layer side: its f32 file, read; the file is deleted once read. */
export function layerFloats(out: string, reply: JsonObject, layer: string, size: readonly [number, number], what: string): Floats {
  answered(reply, what);
  const rows = arr(reply['layers'], `${what}: layers`).map((v) => obj(v, `${what}: layers[]`));
  const row = rows.find((r) => r['layer'] === layer);
  expect(row, `${what}: the reply lists layer ${layer}; it lists ${rows.map((r) => String(r['layer'])).join(', ')}`).toBeDefined();
  const side = answered(obj(obj(row!['drawn'], `${layer}: drawn`)['gpu_layer'], `${layer}: drawn.gpu_layer`), `${what}: layer ${layer} on the GPU layer`);
  const floats = readFloats(out, side['f32'], size, `${what}: ${layer}`);
  dropFile(out, side['f32'], 'f32');
  return floats;
}
export const film2dCall = (doc: JsonObject, look: JsonValue, extra: JsonObject): JsonObject => ({ call: 'film2d', doc, look, hash: true, ...extra });
export const view3dCall = (doc: string, look: JsonValue, size: readonly [number, number], extra: JsonObject): JsonObject => ({ call: 'view3d', doc, look, size: [...size], ...extra });
export interface Row { frame: number; hash: string; png: string | null }
/** Each frame of a `film2d` or `view3d` reply: its pixel hash, and its captured frame's PNG hash where it was captured. */
export function rows(reply: JsonObject, what: string): Row[] {
  answered(reply, what);
  return arr(reply['frames'], `${what}: frames`).map((f) => {
    const r = obj(f, `${what}: frames[]`);
    const frame = num(r['frame'], `${what}: frame`);
    return { frame, hash: str(r['pixel_hash'], `${what}: frame ${frame}'s pixel_hash`), png: typeof r['final'] === 'string' ? r['final'] : null };
  });
}
export const pngOf = (out: string, row: Row, what: string): Buffer => {
  expect(row.png, `${what}: frame ${row.frame} was captured`).not.toBeNull();
  return hasFile(out, row.png, 'png', what);
};

// ---------------------------------------------------------------------------------------------------
// Fixtures

export const FAMILIES = ['light', 'paper', 'profiles', 'ink', 'wash', 'spatter', 'offset', 'hatch', 'noise', 'targets', 'strokes'] as const;
export type Family = (typeof FAMILIES)[number];
export type Dim = '2d' | '3d';
export const DIMS: Dim[] = ['2d', '3d'];
export const fixtureJson = (rel: string): JsonObject => JSON.parse(readFileSync(join(FIXTURES, rel), 'utf8')) as JsonObject;
export const fixtureRel = (rel: string): string => `tests/acceptance/149/fixtures/${rel}`;
export const LOOK: JsonObject = fixtureJson('look.json');
/** A fixture's look: the suite's base look with the fixture's fields over it. */
export const lookOf = (fixture: JsonObject): JsonObject => ({ ...LOOK, ...obj(fixture['look'], 'the fixture\'s look') });
export const look = (fields: JsonObject): JsonObject => ({ ...LOOK, ...fields });
export const familyFixture = (f: Family): JsonObject => fixtureJson(`families/${f}.json`);
/** The golden's name: one file per fixture frame. */
export const goldenName = (f: string, dim: Dim, frame: number): string => `${f}.${dim}.f${frame}`;
/** Every family fixture is 1920 × 1080; these frames, at 30 fps, are the frames each is held to. */
export const FAMILY_SIZE = [1920, 1080] as const;
export const FAMILY_FPS = 30;
export const FAMILY_FRAMES = [0, 30, 60];

/** The tiny document most figures draw: one writer layer `main`, with `extra` beside it. */
export function figure(id: string, size: readonly [number, number], items: JsonObject, extra: JsonObject = {}): JsonObject {
  return {
    format: 1, id, profile: 'figure', title: id, description: `${id}: a #149 acceptance figure.`, size: [...size], transport: { span: '4s' },
    requires: { modules: { effects: '^1' } }, budget: { class: 'figure' }, layers: { main: { writer: 'agent-a', title: 'Main', order: 'a1' } }, ...extra, items,
  };
}
export const mark = (id: string, kind: string, order: string, params: JsonObject, extra: JsonObject = {}): JsonObject => ({ id, kind, layer: 'main', name: id, order, params, ...extra });

// Whether a fixture's own names reached the program: the "no film-specific code" half of AC1 and AC9.
export function namedInCode(names: readonly string[]): string[] {
  const found: string[] = [];
  for (const name of names) {
    const r = spawnSync('grep', ['-rlF', '--include=*.rs', '--include=*.wgsl', '--include=*.json', '--include=*.ts', '-e', name, 'crates', 'packs'], { cwd: REPO, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if ((r.stdout ?? '').trim() !== '') found.push(`${name} in ${r.stdout.trim().split('\n').slice(0, 3).join(', ')}`);
  }
  return found;
}

// ---------------------------------------------------------------------------------------------------
// Reprojection. A 2D document's camera (README: the camera in 2D) maps world u to screen px: the target at the frame's
// center, W / view_width px to the u. A pixel (i, j) has its center at (i + 0.5, j + 0.5).

export interface Pose { x: number; y: number; vw: number }
export interface Gray { width: number; height: number; v: Float64Array }
export const toGray = (im: Floats): Gray => {
  const v = new Float64Array(im.width * im.height);
  for (let i = 0; i < v.length; i++) v[i] = (im.data[i * 4]! + im.data[i * 4 + 1]! + im.data[i * 4 + 2]!) / 3;
  return { width: im.width, height: im.height, v };
};
/** Bilinear at a continuous screen position, in a picture's own px. */
export function sampleAt(g: Gray, sx: number, sy: number): number {
  const x = sx - 0.5; const y = sy - 0.5;
  const x0 = Math.max(0, Math.min(g.width - 2, Math.floor(x))); const y0 = Math.max(0, Math.min(g.height - 2, Math.floor(y)));
  const fx = x - x0; const fy = y - y0; const o = y0 * g.width + x0;
  return (g.v[o]! * (1 - fx) + g.v[o + 1]! * fx) * (1 - fy) + (g.v[o + g.width]! * (1 - fx) + g.v[o + g.width + 1]! * fx) * fy;
}
/** Where a point at screen (sx, sy) under pose `b` falls on the screen under pose `a`, for a W × H frame. */
export function reproject(b: Pose, a: Pose, W: number, H: number, sx: number, sy: number): [number, number] {
  const wx = (sx - W / 2) * (b.vw / W) + b.x; const wy = (sy - H / 2) * (b.vw / W) + b.y;
  return [(wx - a.x) * (W / a.vw) + W / 2, (wy - a.y) * (W / a.vw) + H / 2];
}
export interface Residual { cx: number; cy: number; dx: number; dy: number; ncc: number; peaked: boolean }
const PATCH = 44;
const REACH = 3;
/** Normalized cross-correlation of a patch of `b` with `a` reprojected, at an offset of (ox, oy) px of `b`. */
function ncc(a: Gray, poseA: Pose, b: Gray, poseB: Pose, cx: number, cy: number, ox: number, oy: number): number {
  let sa = 0; let sb = 0; let saa = 0; let sbb = 0; let sab = 0; let n = 0;
  for (let j = -PATCH / 2; j < PATCH / 2; j += 2) for (let i = -PATCH / 2; i < PATCH / 2; i += 2) {
    const px = cx + i; const py = cy + j;
    const vb = sampleAt(b, px + 0.5, py + 0.5);
    const [qx, qy] = reproject(poseB, poseA, b.width, b.height, px + 0.5 + ox, py + 0.5 + oy);
    const va = sampleAt(a, qx, qy);
    sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb; n++;
  }
  const cov = sab - (sa * sb) / n;
  return cov / Math.sqrt(Math.max(1e-18, (saa - (sa * sa) / n) * (sbb - (sb * sb) / n)));
}
/**
 * Where `b`'s content lies against `a` reprojected to `b`'s pose, on a 5 × 3 grid of patches: the offset, in `b`'s px,
 * that best aligns them (0 when the content stays on its reprojected place), refined by a parabola through the peak.
 * The grid spans the part of `b` that `a` also shows.
 */
export function residuals(a: Gray, poseA: Pose, b: Gray, poseB: Pose): Residual[] {
  const out: Residual[] = [];
  const m = PATCH / 2 + REACH + 2;
  const [x0, y0] = reproject(poseA, poseB, b.width, b.height, 0, 0);
  const [x1, y1] = reproject(poseA, poseB, b.width, b.height, a.width, a.height);
  const [left, top] = [Math.max(0, x0) + m, Math.max(0, y0) + m];
  const [right, bottom] = [Math.min(b.width, x1) - m, Math.min(b.height, y1) - m];
  expect(right > left && bottom > top, `the two frames overlap past a patch: ${left} to ${right}, ${top} to ${bottom}`).toBe(true);
  for (let gy = 0; gy < 3; gy++) for (let gx = 0; gx < 5; gx++) {
    const cx = Math.round(left + (gx * (right - left)) / 4); const cy = Math.round(top + (gy * (bottom - top)) / 2);
    let best = -2; let bx = 0; let by = 0;
    for (let oy = -REACH; oy <= REACH; oy++) for (let ox = -REACH; ox <= REACH; ox++) {
      const c = ncc(a, poseA, b, poseB, cx, cy, ox, oy);
      if (c > best) { best = c; bx = ox; by = oy; }
    }
    const peaked = Math.abs(bx) < REACH && Math.abs(by) < REACH;
    const parabola = (l: number, m0: number, r: number): number => { const d = l - 2 * m0 + r; return Math.abs(d) < 1e-12 ? 0 : Math.max(-0.5, Math.min(0.5, (l - r) / (2 * d))); };
    const fx = peaked ? parabola(ncc(a, poseA, b, poseB, cx, cy, bx - 1, by), best, ncc(a, poseA, b, poseB, cx, cy, bx + 1, by)) : 0;
    const fy = peaked ? parabola(ncc(a, poseA, b, poseB, cx, cy, bx, by - 1), best, ncc(a, poseA, b, poseB, cx, cy, bx, by + 1)) : 0;
    out.push({ cx, cy, dx: bx + fx, dy: by + fy, ncc: best, peaked });
  }
  return out;
}
/** Each way a chain of frames, each against the last, fails to stay within `limit` px of its reprojected place. */
export function chainProblems(what: string, links: { label: string; found: Residual[] }[], W: number, H: number, limit: number): { problems: string[]; worst: number; drift: number } {
  const problems: string[] = [];
  let worst = 0; let sumX = 0; let sumY = 0; let sumR = 0;
  for (const { label, found } of links) {
    for (const r of found) {
      const e = Math.hypot(r.dx, r.dy);
      worst = Math.max(worst, e);
      if (!r.peaked || r.ncc < 0.4) problems.push(`${what} ${label}: the patch at (${r.cx}, ${r.cy}) isn't on its reprojected place (best offset (${r.dx.toFixed(2)}, ${r.dy.toFixed(2)}) px at correlation ${r.ncc.toFixed(2)})`);
      else if (e > limit) problems.push(`${what} ${label}: the patch at (${r.cx}, ${r.cy}) is ${e.toFixed(3)} px off its reprojected place`);
    }
    sumX += found.reduce((s, r) => s + r.dx, 0) / found.length; sumY += found.reduce((s, r) => s + r.dy, 0) / found.length;
    sumR += found.reduce((s, r) => { const q = Math.hypot(r.cx - W / 2, r.cy - H / 2) || 1; return s + (r.dx * (r.cx - W / 2) + r.dy * (r.cy - H / 2)) / q; }, 0) / found.length;
  }
  const drift = Math.max(Math.hypot(sumX, sumY), Math.abs(sumR));
  if (drift > limit) problems.push(`${what}: the error summed along the chain, its drift from the first frame, is ${drift.toFixed(3)} px`);
  return { problems, worst, drift };
}
// sRGB coding, for AC9's linear light.
export const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** One channel of a float picture, as a Gray, in 8-bit code values. */
export const codesOf = (im: Floats, c: number): Gray => {
  const v = new Float64Array(im.width * im.height);
  for (let i = 0; i < v.length; i++) v[i] = im.data[i * 4 + c]! * 255;
  return { width: im.width, height: im.height, v };
};
