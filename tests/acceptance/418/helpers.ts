// Test-side tools for the #418 acceptance tests: `deep-gpu` (#377's binary with #378's `view3d`, #380's effects and
// #382's status report) built once per file and driven by JSON lines; `deep-show` (#185's interfaces, #138's kit)
// built per feature set, debug or release with a kit ledger; the documents and looks these tests draw, generated
// here so every item is readable; PNG, f32 and ID-target reading (after #382's helpers, since suites don't import
// each other) and a PNG writer for the dirt image; and this suite's own f64 references: sRGB, OKLab, the four tone
// curves (none, the ACES filmic fit, AgX as the issue defines it, Khronos PBR Neutral) and the ASC CDL. Nothing
// here stands in for the finish, the tone maps, ambient occlusion, deband, the grade, bloom or the kit under test.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type Rgb = [number, number, number];
export type Box = [number, number, number, number];
export type Lin = [number, number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/418 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const BUILD_ENV = { CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };

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
export function bool(value: JsonValue | undefined, what: string): boolean {
  expect(typeof value, `${what} is a boolean, got ${JSON.stringify(value)}`).toBe('boolean');
  return value as boolean;
}
export function rgb(value: JsonValue | undefined, what: string): Rgb {
  const a = arr(value, what);
  expect(a.length, `${what} is [r, g, b]`).toBe(3);
  return a.map((v, i) => num(v, `${what}[${i}]`)) as Rgb;
}
export function box(value: JsonValue | undefined, what: string): Box {
  const a = arr(value, what);
  expect(a.length, `${what} is [x, y, w, h]`).toBe(4);
  return a.map((v, i) => num(v, `${what}[${i}]`)) as Box;
}
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const SHA = /^[0-9a-f]{64}$/;
export const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';

/** A fresh folder per test (targets, documents, inputs), deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-418-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

/** Fails with an INCONCLUSIVE message off macOS: these pixels come from the GPU layer on the reference platform's Metal device. */
export function requireGpu(): void {
  expect(process.platform, 'INCONCLUSIVE: the GPU layer draws these pixels on macOS\'s Metal device, the reference platform; this is not a pass').toBe('darwin');
}

interface Started { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }
function start(bin: string, args: string[], inputs: JsonValue[], timeoutMs = 1_800_000): Started {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const run = spawnSync(bin, args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${bin} ${args.join(' ')}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  const lines = stdout.split('\n').filter((line) => line !== '').map((line) => {
    try { return JSON.parse(line) as JsonValue; } catch { return line; }
  });
  return { status: run.status, signal: run.signal, timedOut, lines, stdout, stderr: run.stderr ?? '' };
}
function cargo(args: string[], env: NodeJS.ProcessEnv = {}): string {
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...BUILD_ENV, ...env } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
const targetDir = (env: NodeJS.ProcessEnv = {}): string => {
  const t = env['CARGO_TARGET_DIR'] ?? process.env['CARGO_TARGET_DIR'];
  return t ? resolve(REPO, t) : join(REPO, 'target');
};

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one scenario `{out, calls}` per line in, one line out (#377).

const GPU = 'deep-gpu';
export interface Bin { bin: () => string }
/** Builds `deep-gpu` once before the file's tests (`cargo build --locked --bin deep-gpu`); a test that uses a failed build fails with cargo's error. */
export function useGpuBin(): Bin {
  let dir = '';
  let made: { bin: string; error: string } | null = null;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-418-bins-'));
    const error = cargo(['build', '--locked', '--bin', GPU]);
    const bin = join(dir, exe(GPU));
    if (error === '') copyFileSync(join(targetDir(), 'debug', exe(GPU)), bin);
    made = { bin, error };
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(): string {
      expect(made, 'the file built the binary').not.toBeNull();
      expect(made!.error, `the binary builds: cargo build --locked --bin ${GPU}`).toBe('');
      return made!.bin;
    },
  };
}

/** The wrong program this suite adds to `deep-gpu run` (README: Planted programs). */
export type Planted = 'dirt_overlay';
/** One scenario, accepted, with one reply per call, all in one process. */
export function run(bin: string, out: string, calls: JsonObject[], planted?: Planted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const s = start(bin, args, [{ out, calls }]);
  const name = `${GPU} ${args.join(' ')}`;
  expect(s.timedOut, `${name} finished within its timeout`).toBe(false);
  expect(s.status, `${name} exited 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-3000)}`).toBe(0);
  expect(s.lines.length, `${name}: one output line per input line`).toBe(1);
  const answer = obj(s.lines[0], `${name}: the answer`);
  expect(answer['ok'], `${name} refused the scenario: ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(calls.length);
  return replies;
}
/** A reply the binary answered, not refused (any `code`); INCONCLUSIVE when it says the platform can't draw it. */
export function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform') expect.fail(`INCONCLUSIVE: ${what} reports unsupported_platform; this is not a pass`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  return reply;
}

// ---------------------------------------------------------------------------------------------------
// Frames, PNG, f32 targets, the ID target

export interface Frame { frame: number; pixel_hash: string; raw: JsonObject }
export function framesOf(reply: JsonObject, what: string): Frame[] {
  return arr(reply['frames'], `${what}: frames`).map((v, i): Frame => {
    const f = obj(v, `${what}: frames[${i}]`);
    const hash = str(f['pixel_hash'], `${what}: frames[${i}].pixel_hash`);
    expect(hash, `${what}: frames[${i}].pixel_hash is a SHA-256`).toMatch(SHA);
    return { frame: num(f['frame'], `${what}: frames[${i}].frame`), pixel_hash: hash, raw: f };
  });
}
export function frameAt(reply: JsonObject, n: number, what: string): Frame {
  const frames = framesOf(reply, what);
  const f = frames.find((x) => x.frame === n);
  expect(f, `${what}: frame ${n} is in the reply (frames ${frames.map((x) => x.frame).join(', ')})`).toBeDefined();
  return f!;
}
function readNamed(out: string, hash: JsonValue | undefined, ext: string, what: string): Buffer {
  const h = str(hash, `${what} (a file named by its SHA-256)`);
  expect(h, `${what} is named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${h}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(h);
  return file;
}

export interface Image { width: number; height: number; /** RGBA, row-major. */ rgba: Uint8Array }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let at = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (at < file.length) {
    const length = file.readUInt32BE(at); const type = file.toString('latin1', at + 4, at + 8); const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}; the reader takes 8-bit RGB/RGBA, no interlace`);
  const channels = color === 6 ? 4 : 3; const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0; const b = previous[i]!; const c = i >= channels ? previous[i - channels]! : 0; const x = line[i]!;
      let v: number;
      switch (filter) { case 0: v = x; break; case 1: v = x + a; break; case 2: v = x + b; break; case 3: v = x + ((a + b) >> 1); break; case 4: v = x + paeth(a, b, c); break; default: throw Error(`PNG filter ${filter}`); }
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
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes: Buffer): number { let c = 0xffffffff; for (const b of bytes) c = CRC[(c ^ b) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(4); head.writeUInt32BE(body.length);
  const tb = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(tb));
  return Buffer.concat([head, tb, crc]);
}
/** An 8-bit RGB PNG of `width × height` whose pixel (x, y) is `at(x, y)`. */
export function encodePng(width: number, height: number, at: (x: number, y: number) => Rgb): Buffer {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const c = at(x, y); raw.set(c, y * (width * 3 + 1) + 1 + x * 3); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
/** A frame's 8-bit target (`final`) as read back: an RGBA PNG named by its hash. */
export const readPng = (out: string, f: Frame, target: string, what: string): Image => decodePng(readNamed(out, f.raw[target], 'png', `${what}: ${target}`));
export function pixel(image: Image, x: number, y: number): Rgb {
  const o = (y * image.width + x) * 4;
  return [image.rgba[o]!, image.rgba[o + 1]!, image.rgba[o + 2]!];
}

export interface F32 { width: number; height: number; rgba: Float32Array }
/** A float target (`linear`, `pre_tone`, `dirt`) or a `tone` output as read back: little-endian f32 RGBA, rows top-down, `w × h × 16` bytes. */
export function readF32(out: string, hash: JsonValue | undefined, size: [number, number], what: string): F32 {
  const file = readNamed(out, hash, 'f32', what);
  expect(file.length, `${what} holds ${size[0]} × ${size[1]} f32 RGBA pixels`).toBe(size[0] * size[1] * 16);
  const rgba = new Float32Array(size[0] * size[1] * 4);
  for (let i = 0; i < rgba.length; i++) rgba[i] = file.readFloatLE(i * 4);
  return { width: size[0], height: size[1], rgba };
}
export const readTarget = (out: string, f: Frame, target: string, size: [number, number], what: string): F32 => readF32(out, f.raw[target], size, `${what}: ${target}`);
export function writeF32(dir: string, name: string, image: F32): string {
  const buf = Buffer.alloc(image.rgba.length * 4);
  for (let i = 0; i < image.rgba.length; i++) buf.writeFloatLE(image.rgba[i]!, i * 4);
  const path = join(dir, `${name}.f32`);
  writeFileSync(path, buf);
  return path;
}
export function texel(img: F32, x: number, y: number): Lin {
  const o = (y * img.width + x) * 4;
  return [img.rgba[o]!, img.rgba[o + 1]!, img.rgba[o + 2]!];
}
/** Rec. 709 luminance of a linear color. */
export const luma = (c: Lin): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** The object-ID target: an 8-bit RGBA PNG whose pixel holds pick ID r + 2^8 g + 2^16 b + 2^24 a, named by the frame's `picks`. */
export interface Ids { width: number; height: number; at: (x: number, y: number) => string | null }
export function readIds(out: string, f: Frame, what: string): Ids {
  const png = decodePng(readNamed(out, f.raw['ids'], 'png', `${what}: ids`));
  const picks = new Map(Object.entries(obj(f.raw['picks'], `${what}: picks`)).map(([k, id]) => [Number(k), str(id, `${what}: picks[${k}]`)]));
  const items: (string | null)[] = new Array(png.width * png.height);
  for (let i = 0; i < items.length; i++) {
    const o = i * 4;
    const pick = (png.rgba[o]! + png.rgba[o + 1]! * 256 + png.rgba[o + 2]! * 65_536 + png.rgba[o + 3]! * 16_777_216) >>> 0;
    items[i] = pick === 0 ? null : picks.get(pick) ?? null;
  }
  return { width: png.width, height: png.height, at: (x, y) => (x < 0 || y < 0 || x >= png.width || y >= png.height ? null : items[y * png.width + x]!) };
}
/** The most common color among the pixels where `keep` holds, with its count. */
export function mode(image: Image, keep: (x: number, y: number) => boolean): { color: Rgb; count: number; total: number } {
  const counts = new Map<number, number>();
  let best = -1; let bestKey = 0; let total = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    if (!keep(x, y)) continue;
    total++;
    const c = pixel(image, x, y); const key = (c[0] << 16) | (c[1] << 8) | c[2];
    const n = (counts.get(key) ?? 0) + 1; counts.set(key, n);
    if (n > best) { best = n; bestKey = key; }
  }
  if (best < 0) throw Error('mode of no pixels');
  return { color: [(bestKey >> 16) & 255, (bestKey >> 8) & 255, bestKey & 255], count: best, total };
}
export const inBox = ([bx, by, bw, bh]: Box, shrink = 0) => (x: number, y: number): boolean =>
  x + 0.5 >= bx + shrink && x + 0.5 <= bx + bw - shrink && y + 0.5 >= by + shrink && y + 0.5 <= by + bh - shrink;

// ---------------------------------------------------------------------------------------------------
// #382's status report on a `view3d` reply

export const STATES = ['pass', 'fail', 'invalid', 'blocked', 'inconclusive', 'running', 'needs_you', 'stale', 'idle'] as const;
export type State = (typeof STATES)[number];
export interface Mark { item: string; state: string; color: Rgb; bounds: Box }
export interface Entry { state: string; color: Rgb; swatch: Box; label: Box }
export interface Status { shows: boolean; marks: Mark[]; legend: Entry[] }
export function statusOf(reply: JsonObject, what: string): Status {
  const s = obj(reply['status'], `${what}: status`);
  return {
    shows: bool(s['shows'], `${what}: status.shows`),
    marks: arr(s['marks'], `${what}: status.marks`).map((v, i): Mark => {
      const m = obj(v, `${what}: status.marks[${i}]`);
      return { item: str(m['item'], `${what}: status.marks[${i}].item`), state: str(m['state'], `${what}: status.marks[${i}].state`), color: rgb(m['color'], `${what}: status.marks[${i}].color`), bounds: box(m['bounds'], `${what}: status.marks[${i}].bounds`) };
    }),
    legend: arr(s['legend'], `${what}: status.legend`).map((v, i): Entry => {
      const e = obj(v, `${what}: status.legend[${i}]`);
      return { state: str(e['state'], `${what}: status.legend[${i}].state`), color: rgb(e['color'], `${what}: status.legend[${i}].color`), swatch: box(e['swatch'], `${what}: status.legend[${i}].swatch`), label: box(e['label'], `${what}: status.legend[${i}].label`) };
    }),
  };
}
/** The pixels status owns (each mark's bounds and each legend entry's swatch and label, grown by `grow` px). */
export function statusMask(status: Status, width: number, height: number, grow = 2): Uint8Array {
  const mask = new Uint8Array(width * height);
  const fill = ([x, y, w, h]: Box): void => {
    for (let j = Math.max(0, Math.floor(y - grow)); j < Math.min(height, Math.ceil(y + h + grow)); j++)
      for (let i = Math.max(0, Math.floor(x - grow)); i < Math.min(width, Math.ceil(x + w + grow)); i++) mask[j * width + i] = 1;
  };
  for (const m of status.marks) fill(m.bounds);
  for (const e of status.legend) { fill(e.swatch); fill(e.label); }
  return mask;
}
/**
 * Status colors exact (the status-color rule: drawn unlit, after tone mapping and the finish): the fail mark reports
 * the fail color and its bounds' most common pixel is that color, and so is the fail legend entry's swatch. Returns
 * the failures, each naming what differs.
 */
export function statusExact(status: Status, final: Image, fail: Rgb, what: string): string[] {
  const problems: string[] = [];
  if (!status.shows) problems.push(`${what}: status.shows is false for a document with a status binding`);
  const mark = status.marks.find((m) => m.state === 'fail');
  if (!mark) problems.push(`${what}: no fail mark is drawn`);
  else {
    if (hex(mark.color) !== hex(fail)) problems.push(`${what}: the fail mark reports ${hex(mark.color)}, not ${hex(fail)}`);
    const m = mode(final, inBox(mark.bounds, 1));
    if (hex(m.color) !== hex(fail)) problems.push(`${what}: the fail mark's most common pixel is ${hex(m.color)}, not ${hex(fail)}`);
  }
  const entry = status.legend.find((e) => e.state === 'fail');
  if (!entry) problems.push(`${what}: the legend has no fail entry`);
  else {
    if (hex(entry.color) !== hex(fail)) problems.push(`${what}: the legend's fail entry reports ${hex(entry.color)}, not ${hex(fail)}`);
    const m = mode(final, inBox(entry.swatch, 1));
    if (hex(m.color) !== hex(fail)) problems.push(`${what}: the legend's fail swatch draws ${hex(m.color)}, not ${hex(fail)}`);
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------------
// Color in f64: the sRGB curve, OKLab (Ottosson's published matrices), hex

export const clamp01 = (x: number): number => (Number.isNaN(x) ? 0 : Math.min(1, Math.max(0, x)));
export const srgbEncode = (x: number): number => { const v = clamp01(x); return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; };
export const srgbDecode = (v: number): number => { const c = clamp01(v); return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export const decode8 = (c: Rgb): Lin => c.map((v) => srgbDecode(v / 255)) as Lin;
export function linearToOklab([r, g, b]: Lin): Lin {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
export const deltaE = (p: Lin, q: Lin): number => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
/** OKLab ΔE between two linear colors. */
export const deltaELin = (a: Lin, b: Lin): number => deltaE(linearToOklab(a), linearToOklab(b));
export const hex = (c: Rgb): string => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
export function fromHex(h: string): Rgb {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h);
  if (!m) throw Error(`${h} is not #rrggbb`);
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

// ---------------------------------------------------------------------------------------------------
// The tone curves in f64 (README: The references)

/** AgX's inset and outset matrices, as three.js and Filament publish them (column-major, GLSL's `mat3(col, col, col)`). */
const AGX_INSET = [[0.856627153315983, 0.137318972929847, 0.11189821299995], [0.0951212405381588, 0.761241990602591, 0.0767994186031903], [0.0482516061458583, 0.101439036467562, 0.811302368396859]] as const;
const AGX_OUTSET = [[1.1271005818144368, -0.1413297634984383, -0.14132976349843826], [-0.11060664309660323, 1.157823702216272, -0.11060664309660294], [-0.016493938717834573, -0.016493938717834257, 1.2519364065950405]] as const;
const mulColumns = (m: readonly (readonly number[])[], v: Lin): Lin =>
  [0, 1, 2].map((r) => m[0]![r]! * v[0] + m[1]![r]! * v[1] + m[2]![r]! * v[2]) as Lin;

/** The issue's AgX curve, per channel: a toe x^c ÷ (x^c + a) below 0.18 and a shoulder above it meeting it with one slope, 1 at and above white. */
export function agxCurve(x: number, contrast: number, white: number): number {
  if (!(x > 0)) return 0;
  const c = contrast;
  const a = (1 / 0.18 - 1) * 0.18 ** c;
  if (x <= 0.18) { const xc = x ** c; return xc / (xc + a); }
  if (x >= white) return 1;
  const s = 0.18 ** c + a;
  const k = (a * c * 0.18 ** (c - 1)) / (s * s); // the toe's slope at 0.18
  const w = (k * (white - 0.18) ** 2) / 0.82;
  const d = x - 0.18;
  return 0.18 + (k * d * (1 + d / w)) / (1 + (k * d) / 0.82);
}
export type ToneMap = 'none' | 'filmic' | 'neutral' | { agx: { white: number; contrast: number } };
export const AGX = (contrast = 1.25, white = 16.29): ToneMap => ({ agx: { white, contrast } });
/** The ACES filmic fit (Narkowicz 2015), clamped to [0, 1]. */
export const filmicCurve = (x: number): number => { const v = Math.max(x, 0); return clamp01((v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14)); };
/** Khronos PBR Neutral (the reference GLSL: start compression 0.8 − 0.04, desaturation 0.15). */
export function neutral(c: Lin): Lin {
  const start = 0.8 - 0.04; const desat = 0.15;
  const x = Math.min(c[0], c[1], c[2]);
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  let v = c.map((ch) => ch - offset) as Lin;
  const peak = Math.max(v[0], v[1], v[2]);
  if (peak < start) return v;
  const d = 1 - start;
  const newPeak = 1 - (d * d) / (peak + d - start);
  v = v.map((ch) => (ch * newPeak) / peak) as Lin;
  const g = 1 - 1 / (desat * (peak - newPeak) + 1);
  return v.map((ch) => ch * (1 - g) + newPeak * g) as Lin;
}
/** A tone map applied to one linear color (no exposure), in f64, before the sRGB encode. */
export function toneRef(map: ToneMap, c: Lin): Lin {
  const pos = c.map((v) => Math.max(v, 0)) as Lin;
  if (map === 'none') return pos.map(clamp01) as Lin;
  if (map === 'filmic') return pos.map(filmicCurve) as Lin;
  if (map === 'neutral') return neutral(pos).map(clamp01) as Lin;
  const { white, contrast } = map.agx;
  const v = mulColumns(AGX_INSET, pos);
  return mulColumns(AGX_OUTSET, v.map((ch) => agxCurve(ch, contrast, white)) as Lin).map(clamp01) as Lin;
}
/** Each curve's white: the least input it maps to 1 (README: The references). */
export function whiteOf(map: ToneMap): number {
  if (map === 'none') return 1;
  if (map === 'filmic') return (0.56 + Math.sqrt(0.56 ** 2 + 4 * 0.08 * 0.14)) / 0.16; // 2.51x² + 0.03x = 2.43x² + 0.59x + 0.14
  if (map === 'neutral') { const d = 0.24; return (d * d) / (0.5 / 1023) - d + 0.76 + 0.04; } // a grey within half a 10-bit code of 1 (its offset 0.04 added back)
  return map.agx.white;
}
export const nameOf = (map: ToneMap): string => (typeof map === 'string' ? map : `agx(contrast ${map.agx.contrast}, white ${map.agx.white})`);

/** The ASC CDL on a display-linear color: (clamp(in × slope + offset))^power, then saturation about Rec. 709 luma. */
export interface Cdl { slope: Lin; offset: Lin; power: Lin; saturation: number }
export function cdl(c: Lin, g: Cdl): Lin {
  const o = c.map((v, i) => clamp01(v * g.slope[i]! + g.offset[i]!) ** g.power[i]!) as Lin;
  const y = luma(o);
  return o.map((v) => y + g.saturation * (v - y)) as Lin;
}

/** A 32-bit linear congruential generator (Numerical Recipes' constants), uniform in [0, 1). */
export class Lcg {
  private x: number;
  constructor(seed: number) { this.x = seed >>> 0; }
  next(): number { this.x = (Math.imul(1664525, this.x) + 1013904223) >>> 0; return this.x / 4294967296; }
}

// ---------------------------------------------------------------------------------------------------
// Looks and documents (README: Documents and the look)

/** The clean look's status map (crates/deep-canvas-marks/looks/clean.json at the base, as #382's look repeats it). */
export const STATUS: Record<State, string> = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
export const FAIL = fromHex(STATUS.fail);
const GLYPHS: Record<State, string> = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
const FONTS: JsonObject = {
  body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
};
/** The EV100 whose exposure scale (1 ÷ (1.2 × 2^EV100)) is `scale`. */
export const ev100 = (scale: number): number => Math.log2(1 / (1.2 * scale));
/**
 * A physical `look@1` for a 3D writer layer, as #382's: the clean status map, one glyph per state, `min_distance`
 * 0.10, an automatic legend; tone map none at the exposure whose scale is 1; the finish at identity (`finish: []`, no
 * grade), `deband: none`, `bloom: none`, `ao: none`, no ground grid. `roles` maps each data role to its 8-bit color;
 * `ground` defaults to #101114. `change` replaces or adds top-level fields (`tone_map`, `exposure`, `ao`, `deband`,
 * `deband_lsb`, `grade`, `bloom`, `seed`, …).
 */
export function look(id: string, roles: Record<string, Rgb>, change: JsonObject = {}): JsonObject {
  const palette: JsonObject = { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97' };
  const roleMap: JsonObject = { ground: 'night', ink: 'graphite', muted: 'slate' };
  for (const [role, c] of Object.entries(roles)) { palette[`c-${role}`] = hex(c); roleMap[role] = `c-${role}`; }
  return {
    id, format: 1, basis: 'physical', license: 'Apache-2.0', description: `The #418 acceptance look ${id}.`,
    palette, roles: roleMap, themes: { light: {}, dark: {} },
    status: { ...STATUS }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: 0.1,
    attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto', fonts: FONTS,
    tone_map: 'none', exposure: ev100(1), finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' },
    ...change,
  };
}
/** The look@1 `ao` with every field at the issue's default. */
export const AO: JsonObject = { radius: 0.5, strength: 1, samples: 8, resolution: 'half', multi_bounce: true, specular: true };
/** The grade with every field at the issue's default: white balance 6500 K and tint 0, the CDL's identity. */
export const GRADE_DEFAULTS: JsonObject = { white_balance: { temperature: 6500, tint: 0 }, slope: [1, 1, 1], offset: [0, 0, 0], power: [1, 1, 1], saturation: 1 };

/** The verdict handle every status binding of these documents reads, and the state it's pinned to. */
export const VERDICT = 'verdict:01JB4180000000000000000418';
export const FAILED: JsonObject = { [VERDICT]: 'fail' };
export const WRITER = 'agent-a';
const REQUIRES: JsonObject = { modules: { scene3d: '^1', effects: '^1' } };
type V3 = [number, number, number];
export const solid = (id: string, order: string, kind: string, size: V3, pos: V3, role: string, extra: JsonObject = {}): JsonObject =>
  ({ id, kind, name: id[0]!.toUpperCase() + id.slice(1), order, layer: 'main', params: { size, paint: { fill: { role } } }, at: { pos }, ...extra });
const sun = (rot: V3): JsonObject => ({ id: 'sun', kind: 'light.sun@1', name: 'Sun', order: 'z0', layer: 'main', params: { illuminance: Math.PI, shadow: false, angle: 0.53 }, at: { rot } });
/** A `sky@1` giving only ambient light, `ambient` linear RGB from above and below. */
const sky = (ambient: number): JsonObject => ({ id: 'sky', kind: 'sky@1', name: 'Sky', order: 'z1', layer: 'main', params: { ambient_top: [ambient, ambient, ambient], ambient_low: [ambient, ambient, ambient] } });
const perspective = (target: V3, azimuth: number, elevation: number, distance: number): JsonObject =>
  ({ id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', layer: 'main', params: { projection: 'perspective', target, orbit: { azimuth, elevation, distance }, fov: 40, near: 0.1 } });
const ortho = (viewWidth: number): JsonObject =>
  ({ id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', layer: 'main', params: { projection: 'orthographic', position: [0, 0, 10], target: [0, 0, 0], view_width: viewWidth } });
function document(id: string, title: string, description: string, size: [number, number], items: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    format: 1, id, profile: 'scene', title, description, size, camera: 'cam', transport: { span: '2s' }, requires: REQUIRES,
    layers: { main: { writer: WRITER, title: 'Main', order: 'a0' } },
    items: Object.fromEntries(items.map((i) => [i['id'] as string, i])), ...extra,
  };
}
const bound = (item: string): JsonObject => ({ status_bindings: { [`b-${item}`]: { target: `items/${item}/params/paint/badge`, source: VERDICT } } });

/** #382's film: three boxes on a floor under a sun along −Z, seen from +Z (480 × 360). Roles lamp, block, crate, floor. With `binding`, the lamp's badge is bound to the verdict; with `marker`, a 2D writer layer's green dot is anchored to the lamp by an overlay (#378). */
export function film(id: string, opts: { binding?: boolean; marker?: boolean } = {}): JsonObject {
  const items = [
    perspective([0, 0.6, 0], 0, 0, 7),
    solid('floor', 'a1', 'mark.box@1', [12, 0.1, 12], [0, -0.05, 0], 'floor'),
    solid('lamp', 'a2', 'mark.box@1', [1.2, 1.2, 1.2], [0, 0.6, 0], 'lamp'),
    solid('block', 'a3', 'mark.box@1', [0.8, 0.8, 0.8], [-1.8, 0.4, 0.4], 'block'),
    solid('crate', 'a4', 'mark.box@1', [0.8, 0.8, 0.8], [1.8, 0.4, -0.4], 'crate'),
    sun([0, 0, 0]),
  ];
  const doc = document(id, `Film ${id}`, 'Three boxes on a floor under a sun, seen from the front.', [480, 360], items, opts.binding ? bound('lamp') : {});
  if (opts.marker) {
    (doc['layers'] as JsonObject)['marks'] = { writer: 'agent-b', title: 'Marks', order: 'a1' };
    Object.assign(doc['items'] as JsonObject, {
      'tag-frame': { id: 'tag-frame', kind: 'frame@1', layer: 'marks', name: 'Marker frame', order: 'a0', params: { box: [0, 0, 16, 16] } },
      'tag-dot': { id: 'tag-dot', kind: 'circle@1', layer: 'marks', name: 'Marker', order: 'a0', parent: 'tag-frame', params: { center: [8, 8], r: 5, paint: { fill: { role: 'marker' } } } },
      tag: { id: 'tag', kind: 'overlay.frame@1', layer: 'marks', name: 'Marker on the lamp', order: 'a1', params: { frame: 'tag-frame', anchor: { item: 'lamp', point: [0, 0, 0.6] }, offset: [-8, -8] } },
    });
  }
  return doc;
}

/**
 * The room (640 × 480): a floor slab (top at y = 0), a wall whose front face stands at z = −1.9, and a card (1.2 ×
 * 0.8 × 0.04 m) standing on the floor 0.28 m in front of the wall, facing the camera. `light: "direct"` lights it by a
 * sun along (0, −0.5, −0.87) with a sky that gives no ambient light; `"ambient"` by a sky's ambient alone, no sun;
 * `"both"` by both. `spin` turns the camera from azimuth −30° to 0° over the first second, then holds. Roles floor,
 * wall, card.
 */
export function room(id: string, light: 'direct' | 'ambient' | 'both', spin = false): JsonObject {
  const items = [
    perspective([0, 0.4, -1.5], 0, 25, 6),
    solid('floor', 'a1', 'mark.box@1', [8, 0.1, 8], [0, -0.05, 0], 'floor'),
    solid('wall', 'a2', 'mark.box@1', [8, 4, 0.2], [0, 2, -2], 'wall'),
    solid('card', 'a3', 'mark.box@1', [1.2, 0.8, 0.04], [0, 0.4, -1.6], 'card'),
    sky(light === 'direct' ? 0 : 0.6),
    ...(light === 'ambient' ? [] : [sun([-30, 0, 0])]),
  ];
  const extra: JsonObject = spin
    ? { channels: { spin: { target: 'items/cam/params/orbit/azimuth', type: 'f32', keys: { k0: { t: '0s', value: -30, interp: 'linear' }, k1: { t: '1s', value: 0, interp: 'linear' } } } } }
    : {};
  return document(id, `Room ${id}`, 'A card standing on a floor in front of a wall.', [640, 480], items, extra);
}

/**
 * The wall (480 × 360): a wall whose front face is z = 0, lit by a sky's ambient alone, seen square on, and a 1.2 m
 * square sprite card 0.15 m in front of it, or none. `sprite`: `opaque` (a twin that writes depth), `blend` (alpha
 * 0, alpha-blended), `mask` (alpha 0 under an alpha mask, so every fragment is cut) or `zero` (`adjust.opacity` 0).
 */
export type Sprite = 'none' | 'opaque' | 'blend' | 'mask' | 'zero';
export function wall(id: string, sprite: Sprite): JsonObject {
  const items: JsonObject[] = [
    perspective([0, 1, 0], 0, 0, 6),
    solid('wall', 'a1', 'mark.box@1', [6, 4, 0.2], [0, 1, -0.1], 'wall'),
    sky(0.6),
  ];
  if (sprite !== 'none') {
    const extra: JsonObject = sprite === 'zero' ? { adjust: { opacity: 0 } } : sprite === 'opaque' ? {} : { material: 'm-sprite' };
    items.push(solid('sprite', 'a2', 'mark.box@1', [1.2, 1.2, 0.02], [0, 1, 0.16], 'card', extra));
    if (sprite === 'blend' || sprite === 'mask')
      items.push({ id: 'm-sprite', kind: 'material@1', name: 'Sprite material', order: 'a3', layer: 'main', params: { base_color: { role: 'card' }, alpha_mode: sprite, alpha: 0 } });
  }
  return document(id, `Wall ${id}`, 'A wall lit by the sky, with a sprite card in front of it.', [480, 360], items);
}

/** The ball (512 × 512, orthographic, 128 px per m): a 3 m sphere at the origin lit by a sun along −Z, so its shading falls off smoothly from its centre; its badge bound to the verdict. Role ball. */
export function ball(id: string): JsonObject {
  const items = [ortho(4), solid('ball', 'a1', 'mark.sphere@1', [3, 3, 3], [0, 0, 0], 'ball'), sun([0, 0, 0])];
  return document(id, `Ball ${id}`, 'A large sphere lit from the front, a smooth gradient.', [512, 512], items, bound('ball'));
}

/** The dot (512 × 512, orthographic, 51.2 px per m): one emissive sphere 0.12 m across (about 6 px) at the frame's centre, emission 20 in linear light, on a black ground under a sky with no ambient light and no sun; or, without `dot`, the black frame alone. */
export const DOT_SIZE: [number, number] = [512, 512];
export function dot(id: string, withDot = true): JsonObject {
  const items: JsonObject[] = [ortho(10), sky(0)];
  if (withDot) {
    items.push(solid('dot', 'a1', 'mark.sphere@1', [0.12, 0.12, 0.12], [0, 0, 0], 'dot', { material: 'm-glow' }));
    items.push({ id: 'm-glow', kind: 'material@1', name: 'Glow', order: 'a2', layer: 'main', params: { base_color: [0, 0, 0, 1], emission: [1, 1, 1], emission_strength: 20 } });
  }
  return document(id, `Dot ${id}`, 'One emissive dot at the frame\'s centre on black.', DOT_SIZE, items);
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: builds per feature set, the startup refusal, the published plan's interfaces, the kit (#185, #138)

const SHOW = 'deep-show';
/** The planted look implementation this suite adds (README: The look@1 kit). */
export type ShowFeature = 'full' | 'test-look-finish-off';
export interface ShowBuilds { bin: (features: ShowFeature[]) => string }
const showName = (features: ShowFeature[]): string => features.join('+');
function showBuild(features: ShowFeature[], release: boolean, to: string, env: NodeJS.ProcessEnv = {}): string {
  const error = cargo(['build', '--locked', ...(release ? ['--release'] : []), '--bin', SHOW, '--no-default-features', '--features', features.join(',')], env);
  if (error === '') copyFileSync(join(targetDir(env), release ? 'release' : 'debug', exe(SHOW)), to);
  return error;
}
/** Builds each listed feature set once before the file's tests. */
export function useShowBuilds(sets: ShowFeature[][]): ShowBuilds {
  let dir = '';
  const made = new Map<string, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-418-show-'));
    for (const f of sets) {
      const bin = join(dir, `${SHOW}-${showName(f)}`);
      made.set(showName(f), { bin, error: showBuild(f, false, bin) });
    }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(features: ShowFeature[]): string {
      const m = made.get(showName(features));
      if (!m) throw Error(`the file didn't build ${showName(features)}`);
      expect(m.error, `the binary builds: ${SHOW} with features ${features.join(',')}`).toBe('');
      return m.bin;
    },
  };
}
/** A release build embedding the kit ledger at `ledger` (#138: DEEP_KIT_LEDGER at build time). */
export function releaseBuild(features: ShowFeature[], ledger: string, dir: string): { bin: string; error: string } {
  const bin = join(dir, `${SHOW}-release-${showName(features)}`);
  return { bin, error: showBuild(features, true, bin, { DEEP_KIT_LEDGER: ledger }) };
}
const SESSION = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: canvas looks', process: { pid: 4100, start: 1_000 } };
function scenario(evidence: string, calls: JsonObject[]): JsonObject {
  return {
    evidence,
    sessions: { [SESSION.id]: { thread: SESSION.thread, name: SESSION.name, process: SESSION.process } },
    processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }],
    panels: { main: { rect: [0, 0, 800, 600] } },
    docs: { '01JB418000000000000000000A': { panel: 'main' } },
    calls,
  };
}
export function showRun(bin: string, evidence: string, calls: JsonObject[]): JsonObject[] {
  const s = start(bin, ['run'], [scenario(evidence, calls)], 7_200_000);
  expect(s.timedOut, `${SHOW} run finished within its timeout`).toBe(false);
  expect(s.status, `${SHOW} run starts and exits 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(0, 1500)}`).toBe(0);
  expect(s.lines.length, `${SHOW} run: one output line per input line`).toBe(1);
  const out = obj(s.lines[0], `${SHOW} run: the answer`);
  expect(out['ok'], `${SHOW} run refused the scenario: ${shown(out)}`).toBe(true);
  const replies = arr(out['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(calls.length);
  return replies;
}
/** A startup the seal refuses: one `{"ok": false, "code": "seal_refused", …, "interface"?}` line and exit 2 (#305, #185). */
export function startupRefusal(bin: string): JsonObject {
  const s = start(bin, ['run'], [{ evidence: tmpdir(), calls: [{ call: 'registry' }] }]);
  expect(s.status, `${SHOW} refuses to start (exit 2); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(0, 1000)}`).toBe(2);
  expect(s.lines.length, `the refusal is one JSON line: ${s.stdout.slice(0, 1500)}`).toBe(1);
  const raw = obj(s.lines[0], 'the refusal line');
  expect([raw['ok'], raw['code']], `the refusal is the seal's: ${shown(raw)}`).toEqual([false, 'seal_refused']);
  return raw;
}
export interface Interface { digest: string; reference: string; kit: string[]; behavior: string; module: string; implementation: { name: string; equivalence: string; state: string } }
/** Every interface the published plan (`schedule`) names, with #185's fields. */
export function interfacesOf(schedule: JsonObject): Record<string, Interface> {
  const o = obj(schedule['interfaces'], 'schedule: interfaces');
  return Object.fromEntries(Object.entries(o).map(([name, v]) => {
    const i = obj(v, `interfaces["${name}"]`);
    const impl = obj(i['implementation'], `interfaces["${name}"].implementation`);
    return [name, {
      digest: str(i['digest'], `interfaces["${name}"].digest`), reference: str(i['reference'], `interfaces["${name}"].reference`),
      kit: strs(i['kit'], `interfaces["${name}"].kit`), behavior: str(i['behavior'], `interfaces["${name}"].behavior`), module: str(i['module'], `interfaces["${name}"].module`),
      implementation: { name: str(impl['name'], `interfaces["${name}"].implementation.name`), equivalence: str(impl['equivalence'], `interfaces["${name}"].implementation.equivalence`), state: str(impl['state'], `interfaces["${name}"].implementation.state`) },
    }];
  }));
}
export interface KitCase { fixture?: string; verdict: string; raw: JsonObject }
export interface KitPart { part: string; verdict: string; cases: KitCase[]; failures: JsonObject[] }
export interface KitModule { module: string; verdict: string; parts: KitPart[]; failures: JsonObject[] }
/** #138's `kit` call: `{"call": "kit", "sequences", "param_sets", "modules"?, "ledger"?}` → per module its verdict, parts, cases and failures. */
export const kitCall = (options: { modules?: string[]; ledger?: string } = {}): JsonObject => ({
  call: 'kit', sequences: 100, param_sets: 50, ...(options.modules ? { modules: options.modules } : {}), ...(options.ledger ? { ledger: options.ledger } : {}),
});
export function kitModule(reply: JsonObject, name: string): KitModule {
  const list = arr(reply['modules'], 'kit: modules').map((m, i) => obj(m, `kit: modules[${i}]`));
  const o = list.find((m) => m['module'] === name);
  expect(o, `the kit's report holds module ${name}; it holds ${list.map((m) => String(m['module'])).join(', ')}`).toBeDefined();
  const failures = (v: JsonValue | undefined, w: string): JsonObject[] => arr(v ?? [], w).map((f, j) => obj(f, `${w}[${j}]`));
  return {
    module: name, verdict: str(o!['verdict'], `${name}.verdict`), failures: failures(o!['failures'], `${name}.failures`),
    parts: arr(o!['parts'], `${name}.parts`).map((p, j) => {
      const po = obj(p, `${name}.parts[${j}]`);
      const part = str(po['part'], `${name}.parts[${j}].part`);
      return {
        part, verdict: str(po['verdict'], `${name}.${part}.verdict`), failures: failures(po['failures'], `${name}.${part}.failures`),
        cases: arr(po['cases'] ?? [], `${name}.${part}.cases`).map((c, k) => {
          const co = obj(c, `${name}.${part}.cases[${k}]`);
          return { verdict: str(co['verdict'], `${name}.${part}.cases[${k}].verdict`), ...(typeof co['fixture'] === 'string' ? { fixture: co['fixture'] } : {}), raw: co };
        }),
      };
    }),
  };
}
/** Every failure a module's result names: its own, each part's, and each case's `failure`. */
export const kitFailures = (m: KitModule): JsonObject[] =>
  [...m.failures, ...m.parts.flatMap((p) => [...p.failures, ...p.cases.flatMap((c) => (isObject(c.raw['failure']) ? [c.raw['failure'] as JsonObject] : []))])];
