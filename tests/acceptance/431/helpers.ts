// Test-side tools for the #431 acceptance tests: `deep-gpu` (#377's binary, with #378's `view3d`, #379's `live`,
// #380's and #429's `check_operator`, #483's operator frames and reads, #484's `seeks`) built once per file and driven
// by JSON lines; the fixtures these tests draw, generated here so every step is readable; the CPU references the
// criteria name where the design lets a test write them (the ring's lookup, the luminance step, the opaque copy's
// level 3, the cells' distances; Fritsch–Carlson and the homography's corners live in their test file); PNG and f32
// file readers. Nothing here stands in for the operator check, the emitter, the GPU layer, the meter or the renderer.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/431 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const BIN = 'deep-gpu';

/** Each criterion's ID: the first 8 hex digits of SHA-256 of its text (README: Criteria to tests). */
export const AC = {
  1: 'AC1 #431.304e73e1', 2: 'AC2 #431.a160b5c5', 3: 'AC3 #431.bedb0727', 4: 'AC4 #431.a1c2e028', 5: 'AC5 #431.b452b8cc',
  6: 'AC6 #431.84a91586', 7: 'AC7 #431.4f967b2e', 8: 'AC8 #431.800494a1', 9: 'AC9 #431.6cd4c5b0',
} as const;

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${shown(v)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${shown(v)}`).toBe(true);
  return v as JsonValue[];
}
export const objs = (v: JsonValue | undefined, what: string): JsonObject[] => arr(v, what).map((x, i) => obj(x, `${what}[${i}]`));
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${shown(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${shown(v)}`).toBe('string');
  return v as string;
}
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const SHA = /^[0-9a-f]{64}$/;

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}

// ---------------------------------------------------------------------------------------------------
// The binary: built once per file, copied out of target/debug.

function cargoBuild(): string {
  const args = ['build', '--locked', '--bin', BIN];
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' } });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
/** `deep-gpu`, built once for the file; each test that calls it fails if the build did. */
export function useBin(): () => string {
  let dir = '';
  let bin = '';
  let error = 'the build did not run';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-431-bin-'));
    error = cargoBuild();
    bin = join(dir, BIN);
    if (error === '') copyFileSync(join(REPO, 'target', 'debug', BIN), bin);
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo build --locked --bin ${BIN}`).toBe('');
    return bin;
  };
}
/** A fresh output folder per test, deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-431-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one scenario `{"out", "calls"}` per line in, one line out (#377).

/** The wrong programs this suite adds, each reachable only through `--planted` (README: Planted programs). */
export type Planted =
  | 'velocity_from_previous_frame' | 'emission_thresholds_color' | 'builds_unread_targets' | 'sample_grad_implicit'
  | 'no_divergence_rule' | 'backdrop_after_see_through' | 'period_first_octave';

export function run(bin: string, out: string, calls: JsonObject[], planted?: Planted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const r = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 3_000_000, killSignal: 'SIGKILL' });
  const name = `${BIN} ${args.join(' ')}`;
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${name}: ${r.error.message}`);
  expect(timedOut, `${name} finished within its timeout`).toBe(false);
  const stdout = r.stdout ?? '';
  expect(r.status, `${name} exited 0 (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, `${name}: the answer`);
  expect(answer['ok'], `${name} refused the scenario: ${shown(answer)}`).toBe(true);
  const replies = objs(answer['replies'], 'run: replies');
  expect(replies.length, 'run: one reply per call').toBe(calls.length);
  return replies;
}
export const run1 = (bin: string, out: string, call: JsonObject, planted?: Planted): JsonObject => run(bin, out, [call], planted)[0]!;
/** A reply the binary answered, not refused; INCONCLUSIVE when it says the platform can't draw it. */
export function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  return reply;
}
/** Anything the GPU draws runs on macOS's Metal device; elsewhere a test is INCONCLUSIVE, never a pass. */
export function requireGpu(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer runs on macOS's Metal device, the reference platform; this is ${process.platform}`);
}
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(value));
  return p;
}
/** Little-endian f32 words, as `check_operator`'s `data` reads storage (#483). */
export function writeF32(dir: string, name: string, values: readonly number[]): string {
  const b = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => b.writeFloatLE(v, i * 4));
  const p = join(dir, name);
  writeFileSync(p, b);
  return p;
}

// ---------------------------------------------------------------------------------------------------
// `check_operator` (#380, #429's reply, #483's frames, this suite's `assets`, `packs` and `reference`: README).

export interface Checked { outcome: string; issues: JsonObject[]; reached: string[]; raw: JsonObject }
export function checked(reply: JsonObject, what: string): Checked {
  answered(reply, what);
  const r = isObject(reply['reached']) ? reply['reached'] : {};
  return {
    outcome: str(reply['outcome'], `${what}: outcome`), issues: objs(reply['issues'] ?? [], `${what}: issues`),
    reached: ['naga', 'pipeline', 'gpu'].filter((k) => r[k] === true), raw: reply,
  };
}
export const errors = (c: Checked, code?: string): JsonObject[] => c.issues.filter((i) => i['severity'] === 'error' && (code === undefined || i['code'] === code));
/** Whether an issue names step `id`: by its ID, or by a path ending in it (a step inside a repeat's body). */
export function names(issue: JsonObject, id: string): boolean {
  const s = issue['step'];
  return typeof s === 'string' && (s === id || s.endsWith(`/${id}`) || s.endsWith(`.${id}`));
}
/** The result of an operator frame (#483): the check, then each dispatch's reads and, with `reference`, the f64 interpreter's. */
export interface Dispatch { read: JsonObject; reference: JsonObject }
export function frameOf(reply: JsonObject, what: string): { check: Checked; dispatches: Dispatch[] } {
  const check = checked(reply, what);
  const dispatches = check.outcome === 'accepted'
    ? objs(reply['dispatches'], `${what}: dispatches`).map((d, i) => ({ read: obj(d['read'], `${what}: dispatches[${i}].read`), reference: isObject(d['reference']) ? d['reference'] : {} }))
    : [];
  return { check, dispatches };
}

// ---------------------------------------------------------------------------------------------------
// Files the binary wrote under `out`, each named by its SHA-256.

export function readNamed(out: string, hash: JsonValue | undefined, ext: string, what: string): Buffer {
  expect(hash, `${what} is written, named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${hash as string}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}
/** An f32 RGBA image, rows top-down, `w × h × 16` bytes (#378's linear target, #418's pre_tone, #483's reads). */
export interface F32Image { width: number; height: number; at: (x: number, y: number) => [number, number, number, number] }
export function f32Image(file: Buffer, size: readonly [number, number], what: string): F32Image {
  expect(file.length, `${what} holds ${size[0]} × ${size[1]} f32 RGBA pixels`).toBe(size[0] * size[1] * 16);
  const o = (x: number, y: number): number => (y * size[0] + x) * 16;
  return {
    width: size[0], height: size[1],
    at: (x, y) => [file.readFloatLE(o(x, y)), file.readFloatLE(o(x, y) + 4), file.readFloatLE(o(x, y) + 8), file.readFloatLE(o(x, y) + 12)],
  };
}
export const readF32Image = (out: string, hash: JsonValue | undefined, size: readonly [number, number], what: string): F32Image =>
  f32Image(readNamed(out, hash, 'f32', what), size, what);
function sizeOf(v: JsonValue | undefined, what: string): [number, number] {
  const s = arr(v, `${what}: size`);
  return [num(s[0], `${what}: width`), num(s[1], `${what}: height`)];
}
/** A texture Read (#483): `{format, size, file}`, `file` naming `<sha>.f32`; its `levels` when it has mips. */
export function readTexture(out: string, read: JsonValue | undefined, what: string): F32Image {
  const r = obj(read, what);
  return readF32Image(out, r['file'], sizeOf(r['size'], what), what);
}
export function readLevels(out: string, read: JsonValue | undefined, what: string): F32Image[] {
  const r = obj(read, what);
  return objs(r['levels'], `${what}: levels`).map((l, k) => readF32Image(out, l['file'], sizeOf(l['size'], `${what}: level ${k}`), `${what}: level ${k}`));
}
/** A storage Read (#483): `{type, count, file}`, `file` naming `<sha>.u32`, little-endian 32-bit words; here f32 bits. */
export function readStorageF32(out: string, read: JsonValue | undefined, what: string): Float32Array {
  const r = obj(read, what);
  const count = num(r['count'], `${what}: count`);
  const file = readNamed(out, r['file'], 'u32', what);
  expect(file.length, `${what}: ${count} 32-bit words`).toBe(count * 4);
  const values = new Float32Array(count);
  for (let i = 0; i < count; i++) values[i] = file.readFloatLE(i * 4);
  return values;
}

// PNG: what the binary's final targets are and what these tests hand it as textures.
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC = ((): Uint32Array => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** An 8-bit RGBA PNG with no colour chunks. */
export function encodePng(w: number, h: number, rgba: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.subarray(y * w * 4, (y + 1) * w * 4)).copy(raw, y * (w * 4 + 1) + 1);
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))]);
}
/** A texture asset: the PNG written to `dir`, named by its SHA-256, for `view3d`'s and `check_operator`'s `assets`. */
export function writePngAsset(dir: string, w: number, h: number, rgba: Uint8Array): { sha: string; path: string } {
  const png = encodePng(w, h, rgba);
  const sha = sha256(png);
  const path = join(dir, `${sha}.texture.png`);
  writeFileSync(path, png);
  return { sha, path };
}
export interface Image { width: number; height: number; rgba: Uint8Array }
const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};
/** An 8-bit RGB or RGBA PNG, not interlaced, as RGBA. */
export function readPng(out: string, hash: JsonValue | undefined, what: string): Image {
  const file = readNamed(out, hash, 'png', what);
  expect(file.subarray(0, 8).equals(SIG), `${what} is a PNG`).toBe(true);
  let o = 8; let w = 0; let h = 0; let depth = 0; let type = 0; let interlace = 0;
  const idat: Buffer[] = [];
  while (o < file.length) {
    const len = file.readUInt32BE(o); const t = file.toString('ascii', o + 4, o + 8); const d = file.subarray(o + 8, o + 8 + len);
    if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]!; type = d[9]!; interlace = d[12]!; }
    if (t === 'IDAT') idat.push(d);
    if (t === 'IEND') break;
    o += 12 + len;
  }
  expect(depth === 8 && (type === 6 || type === 2) && interlace === 0, `${what}: an 8-bit RGB or RGBA PNG, not interlaced (depth ${depth}, type ${type})`).toBe(true);
  const ch = type === 6 ? 4 : 3; const stride = w * ch;
  const raw = inflateSync(Buffer.concat(idat)); const px = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[y * stride + x - ch]! : 0; const b = y > 0 ? px[(y - 1) * stride + x]! : 0;
      const c = x >= ch && y > 0 ? px[(y - 1) * stride + x - ch]! : 0; const v = raw[y * (stride + 1) + 1 + x]!;
      const p = f === 0 ? v : f === 1 ? v + a : f === 2 ? v + b : f === 3 ? v + ((a + b) >> 1) : v + paeth(a, b, c);
      px[y * stride + x] = p & 0xff;
    }
  }
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) for (let k = 0; k < 4; k++) rgba[i * 4 + k] = k < ch ? px[i * ch + k]! : 255;
  return { width: w, height: h, rgba };
}
export const pngAt = (im: Image, x: number, y: number): [number, number, number] => {
  const o = (y * im.width + x) * 4;
  return [im.rgba[o]!, im.rgba[o + 1]!, im.rgba[o + 2]!];
};

// ---------------------------------------------------------------------------------------------------
// Numbers

/** The luminance step's CPU reference (Every public step: Color): Rec. 709 weights on linear light. */
export const lum = (c: readonly number[]): number => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
/** One 10-bit code of a reference value: 1/1023 of max(1, |reference|), #429's reading. */
export function codes10(gpu: number, cpu: number): number {
  if (!Number.isFinite(gpu) || !Number.isFinite(cpu)) return gpu === cpu ? 0 : Infinity;
  return (Math.abs(gpu - cpu) * 1023) / Math.max(1, Math.abs(cpu));
}
/** A seeded generator in [0, 1) (mulberry32), so every point set is the same on every run. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Bilinear filtering at texel coordinates (s, t) = (u × w − 0.5, v × h − 0.5), wrapping in x and clamping in y. */
export function bilinear(w: number, h: number, texel: (i: number, j: number) => number, s: number, t: number, wrapX: boolean): number {
  const i0 = Math.floor(s); const j0 = Math.floor(t); const fs = s - i0; const ft = t - j0;
  const ix = (i: number): number => (wrapX ? ((i % w) + w) % w : Math.min(w - 1, Math.max(0, i)));
  const jy = (j: number): number => Math.min(h - 1, Math.max(0, j));
  const a = texel(ix(i0), jy(j0)); const b = texel(ix(i0 + 1), jy(j0)); const c = texel(ix(i0), jy(j0 + 1)); const d = texel(ix(i0 + 1), jy(j0 + 1));
  return (a * (1 - fs) + b * fs) * (1 - ft) + (c * (1 - fs) + d * fs) * ft;
}

// ---------------------------------------------------------------------------------------------------
// Looks and documents

const STATUS: JsonObject = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
/** #424's plain physical look: tone map none at the exposure whose scale is 1, so the final target is the sRGB encoding
 * of the linear target; no bloom, no deband, no motion blur (so the shutter is 180°, the design's default). */
export const PLAIN_LOOK: JsonObject = {
  id: 'look-431-plain', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'A #431 acceptance look.',
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

export const WRITER = 'agent:sess-alpha';
export type V3 = [number, number, number];
export type Size = [number, number];
/** A scene document as a session holds it (#378): an `id`, one writer layer, every item in it; it requires effects. */
export function sceneDoc(id: string, size: Size, items: Record<string, JsonObject>, cls: 'figure' | 'showpiece' = 'showpiece', extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #431 acceptance fixture.`, size, camera: 'cam', transport: { span: '10s' },
    requires: { modules: { scene3d: '^1', effects: '^1' } }, budget: { class: cls },
    layers: { main: { writer: WRITER, title: 'main', order: 'a0' } }, ...extra, items: withIds,
  };
}
/** The document as a `live` session takes it (#393's payload): no `id`, no `layers`, no item `layer`. */
export function payload(doc: JsonObject): JsonObject {
  const out = JSON.parse(JSON.stringify(doc)) as JsonObject;
  delete out['id'];
  delete out['layers'];
  for (const item of Object.values(obj(out['items'], 'items'))) delete (item as JsonObject)['layer'];
  return out;
}
export const box = (size: V3, pos: V3, extra: JsonObject = {}): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos }, ...extra });
/** An orthographic camera looking along −Z at the origin, `pxPerM` device px to the metre across a view `width` px wide. */
export const ortho = (width: number, pxPerM: number): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'orthographic', position: [0, 0, 20], target: [0, 0, 0], view_width: width / pxPerM, near: 0.1, far: 100 } });
export const material = (params: JsonObject): JsonObject => ({ kind: 'material@1', params });
export const unlit = (color: V3, extra: JsonObject = {}): JsonObject => material({ base_color: [...color, 1], unlit: true, ...extra });
/** A black sky with no ambient and no environment: the background reads 0. */
export const DARK_SKY: JsonObject = { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } };
/** A rectangle in device px, [x0, y0, x1, y1), as a box of `depth` m centred at z under an `ortho` camera. */
export function rectBox(rect: readonly [number, number, number, number], view: Size, pxPerM: number, z: number, extra: JsonObject = {}): JsonObject {
  const [x0, y0, x1, y1] = rect;
  const cx = ((x0 + x1) / 2 - view[0] / 2) / pxPerM; const cy = (view[1] / 2 - (y0 + y1) / 2) / pxPerM;
  return box([(x1 - x0) / pxPerM, (y1 - y0) / pxPerM, 0.02], [cx, cy, z], extra);
}
export const inRect = (r: readonly [number, number, number, number], x: number, y: number, margin = 0): boolean =>
  x >= r[0] + margin && x < r[2] - margin && y >= r[1] + margin && y < r[3] - margin;

// Operators: #429's form, as items of the writer's layer (kind `gpu.<kind>@1`, every other field in `params`).
export function asItem(op: JsonObject): JsonObject {
  const params = JSON.parse(JSON.stringify(op)) as JsonObject;
  delete params['id'];
  delete params['kind'];
  return { kind: `gpu.${op['kind'] as string}@1`, name: `Operator ${op['id'] as string}`, params };
}
/** One of the core's targets as a texture input (Operator input: `texture: target {op: core, output}`). */
export const coreTarget = (output: 'color' | 'velocity' | 'emission'): JsonObject => ({ type: 'texture', from: { texture: { target: { op: 'core', output } } } });
/** A texture by hash, loaded from the call's `assets`. */
export const textureAsset = (sha: string): JsonObject => ({ type: 'texture', from: { texture: sha } });
/** A composed pass in the effects chain at full resolution, its color replacing the frame's. */
export function passOp(id: string, inputs: JsonObject, steps: JsonObject, out: string, extra: JsonObject = {}): JsonObject {
  return {
    id, kind: 'pass', origin: 'composed', about: `The #431 fixture ${id}.`, inputs, steps, outputs: { color: out, blend: 'replace' },
    chain: 'effects', order: 'a0', resolution: 'full', cost: { ns_per_px: 50 }, fallback: 'look', ...extra,
  };
}
/** A composed material operator. */
export function materialOp(id: string, inputs: JsonObject, steps: JsonObject, extra: JsonObject = {}): JsonObject {
  return { id, kind: 'material', origin: 'composed', about: `The #431 fixture ${id}.`, inputs, steps, outputs: { base_color: 'base' }, cost: { ns_per_px: 50 }, ...extra };
}
/** A composed compute operator over `elements`, its storage outputs f32. */
export function computeOp(id: string, inputs: JsonObject, steps: JsonObject, outputs: string[], elements: number, extra: JsonObject = {}): JsonObject {
  const o: JsonObject = {};
  for (const name of outputs) o[name] = { storage: { type: 'f32', count: elements } };
  return { id, kind: 'compute', origin: 'composed', about: `The #431 fixture ${id}.`, inputs, steps, outputs: o, elements, workgroup: 64, cost: { ns_per_element: 5 }, ...extra };
}
/** A storage input `count` f32 words long that `check_operator`'s `data` fills (#483: `{op: core, output: name}`). */
export const dataInput = (name: string, count: number): JsonObject => ({ type: 'f32', count, from: { storage: { op: 'core', output: name } } });
/** Steps that pick lanes x, y, z of `v` and compose them into a vec3 named `to`. */
export function rgbOf(v: string, to: string): JsonObject {
  return {
    [`${to}_r`]: { op: 'split@1', args: { x: v, pick: 'x' } }, [`${to}_g`]: { op: 'split@1', args: { x: v, pick: 'y' } }, [`${to}_b`]: { op: 'split@1', args: { x: v, pick: 'z' } },
    [to]: { op: 'compose@1', args: { x: `${to}_r`, y: `${to}_g`, z: `${to}_b` } },
  };
}

// ---------------------------------------------------------------------------------------------------
// `view3d` (#378's, with #419's `class`, #483's `read`, #484's `seeks`, and this suite's `backdrop` target: README).

export interface View3d {
  doc: string; size: Size; look?: JsonObject; frames?: number; fps?: number; from?: number; seeks?: { after: number; to: number }[];
  capture?: number[]; targets?: ('final' | 'linear' | 'pre_tone' | 'backdrop')[]; read?: string[]; assets?: Record<string, string>;
}
export const view3dCall = (v: View3d): JsonObject => ({ call: 'view3d', look: PLAIN_LOOK, frames: 1, capture: [0], ...(v as unknown as JsonObject) });
export interface V3Frame { frame: number; final: JsonValue | undefined; linear: JsonValue | undefined; pre_tone: JsonValue | undefined; backdrop: JsonValue | undefined; read: JsonObject }
export function frameAt(reply: JsonObject, n: number, what: string): V3Frame {
  answered(reply, what);
  const f = objs(reply['frames'], `${what}: frames`).find((x) => x['frame'] === n);
  expect(f, `${what}: frame ${n} is in the reply`).toBeDefined();
  return { frame: n, final: f!['final'], linear: f!['linear'], pre_tone: f!['pre_tone'], backdrop: f!['backdrop'], read: isObject(f!['read']) ? f!['read'] : {} };
}

// ---------------------------------------------------------------------------------------------------
// The fixtures the criteria and the taste call share.

// AC5's ring: radii 200 to 250 px in a 512 × 512 view, centred on the pixel corner (256, 257), so the seam on the −x
// side runs through the middle of the 2 × 2 quads of rows 256 and 257. The checker is 256 × 32 texels of 8-texel
// squares, shifted 4 texels on each axis so a square straddles u = 0/1 and each of v's ends: the texels either side of
// the seam and of the ring's edges match, and the lookup's answer doesn't hang on the wrap mode (README: Readings).
export const RING = { size: [512, 512] as Size, cx: 256, cy: 257, r0: 200, r1: 250, tex: [256, 32] as Size, pxPerM: 100 };
export const checkerTexel = (i: number, j: number): number => ((Math.floor((i + 4) / 8) + Math.floor((j + 4) / 8)) % 2 === 1 ? 1 : 0);
export function checkerRgba(): Uint8Array {
  const [w, h] = RING.tex;
  const rgba = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const v = checkerTexel(i, j) * 255; rgba.set([v, v, v, 255], (j * w + i) * 4); }
  return rgba;
}
const TAU_INV = 1 / (2 * Math.PI);
/** The ring's material: u = atan2(y, x) ÷ 2π + 0.5 and v = (r − 200) ÷ 50 from the pixel's centre, sampled by
 * sample_grad with the analytic gradients of the continuous angle (∂u/∂x = −y ÷ 2πr², ∂u/∂y = x ÷ 2πr², ∂v/∂x = x ÷ 50r,
 * ∂v/∂y = y ÷ 50r, in px), black outside the ring. */
export function ringOperator(sha: string): JsonObject {
  return materialOp('ring', { checker: textureAsset(sha) }, {
    px: { op: 'pixel@1', args: {} },
    pxx: { op: 'split@1', args: { x: 'px', pick: 'x' } }, pxy: { op: 'split@1', args: { x: 'px', pick: 'y' } },
    fx: { op: 'convert@1', args: { x: 'pxx', to: 'f32' } }, fy: { op: 'convert@1', args: { x: 'pxy', to: 'f32' } },
    x: { op: 'sub@1', args: { a: 'fx', b: RING.cx - 0.5 } }, y: { op: 'sub@1', args: { a: 'fy', b: RING.cy - 0.5 } },
    xy: { op: 'compose@1', args: { x: 'x', y: 'y' } },
    r2: { op: 'dot@1', args: { a: 'xy', b: 'xy' } }, r: { op: 'sqrt@1', args: { x: 'r2' } },
    ang: { op: 'atan2@1', args: { y: 'y', x: 'x' } },
    u0: { op: 'mul@1', args: { a: 'ang', b: TAU_INV } }, u: { op: 'add@1', args: { a: 'u0', b: 0.5 } },
    rv: { op: 'sub@1', args: { a: 'r', b: RING.r0 } }, v: { op: 'mul@1', args: { a: 'rv', b: 1 / (RING.r1 - RING.r0) } },
    uv: { op: 'compose@1', args: { x: 'u', y: 'v' } },
    k: { op: 'div@1', args: { a: TAU_INV, b: 'r2' } }, ny: { op: 'neg@1', args: { x: 'y' } },
    dux: { op: 'mul@1', args: { a: 'ny', b: 'k' } }, duy: { op: 'mul@1', args: { a: 'x', b: 'k' } },
    rw: { op: 'mul@1', args: { a: 'r', b: RING.r1 - RING.r0 } },
    dvx: { op: 'div@1', args: { a: 'x', b: 'rw' } }, dvy: { op: 'div@1', args: { a: 'y', b: 'rw' } },
    gx: { op: 'compose@1', args: { x: 'dux', y: 'dvx' } }, gy: { op: 'compose@1', args: { x: 'duy', y: 'dvy' } },
    c: { op: 'sample_grad@1', args: { tex: 'checker', uv: 'uv', dx: 'gx', dy: 'gy' } },
    in0: { op: 'ge@1', args: { a: 'r', b: RING.r0 } }, in1: { op: 'le@1', args: { a: 'r', b: RING.r1 } },
    inside: { op: 'and@1', args: { a: 'in0', b: 'in1' } },
    ...rgbOf('c', 'crgb'),
    black: { op: 'const@1', args: { value: [0, 0, 0], type: 'vec3' } },
    base: { op: 'select@1', args: { f: 'black', t: 'crgb', cond: 'inside' } },
  });
}
export function ringDoc(id: string, sha: string): JsonObject {
  return sceneDoc(id, RING.size, {
    cam: ortho(RING.size[0], RING.pxPerM), sky: DARK_SKY, ring: asItem(ringOperator(sha)),
    ringm: unlit([1, 1, 1], { op: 'ring' }),
    plane: box([6, 6, 0.01], [0, 0, 0], { material: 'ringm' }),
  });
}
/** The CPU reference of the ring's lookup at pixel (px, py), in linear light: level 0, bilinear. */
export function ringReference(px: number, py: number): number {
  const x = px + 0.5 - RING.cx; const y = py + 0.5 - RING.cy; const r = Math.hypot(x, y);
  if (r < RING.r0 || r > RING.r1) return 0;
  const u = Math.atan2(y, x) / (2 * Math.PI) + 0.5; const v = (r - RING.r0) / (RING.r1 - RING.r0);
  return bilinear(RING.tex[0], RING.tex[1], checkerTexel, u * RING.tex[0] - 0.5, v * RING.tex[1] - 0.5, true);
}
/** The pixels along the seam on the ring's −x side: rows 255 to 258 (the two 2 × 2 quad rows the seam crosses and
 * their neighbours), from radius 201 to 249 px so the ring's edges decide none. */
export function seamPixels(): [number, number][] {
  const out: [number, number][] = [];
  for (let py = RING.cy - 2; py <= RING.cy + 1; py++) {
    for (let px = 0; px < RING.cx; px++) {
      const r = Math.hypot(px + 0.5 - RING.cx, py + 0.5 - RING.cy);
      if (r >= RING.r0 + 1 && r <= RING.r1 - 1) out.push([px, py]);
    }
  }
  return out;
}

// AC7's card: a 384 × 192 view at 100 px/m; a wall of six 64 px stripes, red, green, blue, red, green, blue (unlit,
// linear 0.8); a red pane at alpha 0.5 over [32, 224) × [16, 176) px; the card over [64, 320) × [32, 160) px, in front.
export const CARD = {
  size: [384, 192] as Size, pxPerM: 100, card: [64, 32, 320, 160] as const, pane: [32, 16, 224, 176] as const, stripe: 64, level: 0.8,
};
/** The card's material: its base color the luminance of backdrop(screen_uv, lod). */
export function frostOperator(lod: number): JsonObject {
  return materialOp('frost', {}, {
    uv: { op: 'screen_uv@1', args: {} },
    b: { op: 'backdrop@1', args: { uv: 'uv', lod } },
    ...rgbOf('b', 'brgb'),
    l: { op: 'luminance@1', args: { rgb: 'brgb' } },
    base: { op: 'compose@1', args: { x: 'l', y: 'l', z: 'l' } },
  });
}
/** The wall alone (`opaque: true`: the frame's opaque parts), or with the pane and the card at `card` alpha mode. */
export function cardDoc(id: string, o: { lod: number; card: 'blend' | 'opaque'; opaque?: boolean }): JsonObject {
  const items: Record<string, JsonObject> = { cam: ortho(CARD.size[0], CARD.pxPerM), sky: DARK_SKY };
  const colors: V3[] = [[CARD.level, 0, 0], [0, CARD.level, 0], [0, 0, CARD.level]];
  for (let k = 0; k < 3; k++) items[`m${k}`] = unlit(colors[k]!);
  for (let k = 0; k < CARD.size[0] / CARD.stripe; k++) {
    items[`stripe${k}`] = rectBox([k * CARD.stripe, -8, (k + 1) * CARD.stripe, CARD.size[1] + 8], CARD.size, CARD.pxPerM, -1, { material: `m${k % 3}` });
  }
  if (!o.opaque) {
    items['paneglass'] = unlit([1, 0, 0], { alpha_mode: 'blend', alpha: 0.5 });
    items['pane'] = rectBox(CARD.pane, CARD.size, CARD.pxPerM, -0.5, { material: 'paneglass' });
    items['frost'] = asItem(frostOperator(o.lod));
    items['cardm'] = unlit([1, 1, 1], { alpha_mode: o.card, alpha: 1, op: 'frost' });
    items['card'] = rectBox(CARD.card, CARD.size, CARD.pxPerM, 0, { material: 'cardm' });
  }
  return sceneDoc(id, CARD.size, items);
}

// AC3's sign: a 480 × 270 view at 100 px/m; a sign of emission [4, 0, 0] (black base) over [60, 220) × [95, 175) px,
// its right half behind an opaque grey wall over [140, 230) × [65, 205) px nearer the camera; a chrome ball of radius
// 60 px centred at (360, 135) px under a sun, its glint above linear 4.
export const SIGN = {
  size: [480, 270] as Size, pxPerM: 100, sign: [60, 95, 220, 175] as const, visible: [60, 95, 140, 175] as const,
  wall: [140, 65, 230, 205] as const, ball: { cx: 360, cy: 135, r: 60 },
};
/** The pass that adds the core's emission target to the frame's color, each at its own pixel. */
export function glowPass(): JsonObject {
  return passOp('glow', { src: coreTarget('color'), em: coreTarget('emission') }, {
    px: { op: 'pixel@1', args: {} },
    c: { op: 'load@1', args: { tex: 'src', ixy: 'px' } }, e: { op: 'load@1', args: { tex: 'em', ixy: 'px' } },
    cr: { op: 'split@1', args: { x: 'c', pick: 'x' } }, cg: { op: 'split@1', args: { x: 'c', pick: 'y' } },
    cb: { op: 'split@1', args: { x: 'c', pick: 'z' } }, ca: { op: 'split@1', args: { x: 'c', pick: 'w' } },
    er: { op: 'split@1', args: { x: 'e', pick: 'x' } }, eg: { op: 'split@1', args: { x: 'e', pick: 'y' } }, eb: { op: 'split@1', args: { x: 'e', pick: 'z' } },
    sr: { op: 'add@1', args: { a: 'cr', b: 'er' } }, sg: { op: 'add@1', args: { a: 'cg', b: 'eg' } }, sb: { op: 'add@1', args: { a: 'cb', b: 'eb' } },
    out: { op: 'compose@1', args: { x: 'sr', y: 'sg', z: 'sb', w: 'ca' } },
  }, 'out');
}
export function signDoc(id: string, withPass: boolean): JsonObject {
  const s = SIGN;
  const ballPos: V3 = [(s.ball.cx - s.size[0] / 2) / s.pxPerM, (s.size[1] / 2 - s.ball.cy) / s.pxPerM, 0];
  return sceneDoc(id, s.size, {
    cam: ortho(s.size[0], s.pxPerM), sky: DARK_SKY,
    sun: { kind: 'light.sun@1', params: { illuminance: 3, color: [1, 1, 1], shadow: false }, at: { rot: [-20, 20, 0] } },
    neon: material({ base_color: [0, 0, 0, 1], roughness: 1, emission: [1, 0, 0], emission_strength: 4 }),
    grey: material({ base_color: [0.5, 0.5, 0.5, 1], roughness: 0.8 }),
    chrome: material({ base_color: [1, 1, 1, 1], metallic: 1, roughness: 0.2 }),
    sign: rectBox(s.sign, s.size, s.pxPerM, 0, { material: 'neon' }),
    wall: rectBox(s.wall, s.size, s.pxPerM, 0.5, { material: 'grey' }),
    ball: { kind: 'ball@1', params: { radius: s.ball.r / s.pxPerM, segments: 256 }, at: { pos: ballPos }, material: 'chrome' },
    ...(withPass ? { glow: asItem(glowPass()) } : {}),
  });
}
