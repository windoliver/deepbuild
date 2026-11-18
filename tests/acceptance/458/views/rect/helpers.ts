// Test-side tools for #458's view-rectangle criteria (15 and 16): `deep-gpu` (#377's binary) built once per file and
// driven by one JSON scenario on stdin, #378's `view3d` as it is, this suite's `view_rectangle` call, the readers of
// the files both write, and the two comparisons the criteria state: every pixel of the rectangle against the view
// drawn alone, and every pixel outside it against the noise. Nothing here stands in for the renderer, the noise or
// the rectangle: each is read from what `deep-gpu` answers. README: The surface under test.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, beforeAll, expect } from 'vitest';
import { AT, FPS, FRAME, TARGET, VIEW, type JsonObject, type JsonValue, type Size } from './fixture.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/458/views/rect is five levels down). */
export const REPO = join(HERE, '..', '..', '..', '..', '..');
export const BIN = 'deep-gpu';
const targetOf = (): string => (process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target'));

/** Every `it` passes this: a first cargo build can take many minutes. */
export const TIMEOUT = 3_600_000;

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  15: 'AC15 #458.fd784061',
  16: 'AC16 #458.c54b3af2',
} as const;

// ---------------------------------------------------------------------------------------------------
// JSON and verdict prefixes

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: JsonValue | undefined, n = 1500): string => JSON.stringify(v)?.slice(0, n) ?? 'undefined';
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v, 600)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v, 600)}`).toBe(true);
  return v as JsonValue[];
}
export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
const SHA = /^[0-9a-f]{64}$/;

/** The criterion stays open, whatever the reason: never a pass (AGENTS.md: the four invariants). */
export function inconclusive(reason: string): never {
  return expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** A platform need is missing here: never a pass. */
export function blocked(reason: string): never {
  return expect.fail(`BLOCKED: ${reason}; this is not a pass`);
}
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}: ${failures.slice(0, 8).join(' | ')}`).toEqual([]);
}
/** A planted program's run: this suite's own check must fail on it, and some failure must name `named`. */
export function failsNaming(failures: readonly string[], named: RegExp, what: string): void {
  expect(failures.length, `${what}: the check fails the planted program`).toBeGreaterThan(0);
  expect(failures.some((f) => named.test(f)), `${what}: a failure names ${named}; the failures: ${failures.slice(0, 8).join(' | ')}`).toBe(true);
}
/** The GPU legs draw on this Mac's Metal device; anywhere else the criterion is BLOCKED, never a pass. */
export function requireGpu(): void {
  if (process.platform !== 'darwin') blocked(`view-rectangle invariance draws on the reference Mac's Metal GPU; this is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// The binary: `cargo build --locked --bin deep-gpu` once per file, with incremental builds and debug info off, copied
// out of the target folder; a test whose build failed fails with cargo's error.

function cargoBuild(to: string): string {
  const args = ['build', '--locked', '--bin', BIN];
  const env = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
  const r = spawnSync('cargo', args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download/.test(l)).join('\n').slice(-4000)}`;
  copyFileSync(join(targetOf(), 'debug', process.platform === 'win32' ? `${BIN}.exe` : BIN), to);
  return '';
}
/** `deep-gpu`, built once for the file, and the folder its runs write into; both deleted after the file. */
export function useGpu(): { bin: () => string; out: () => string } {
  let dir = '';
  let error = 'the build did not run';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-458-rect-'));
    error = cargoBuild(join(dir, BIN));
  }, TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(): string {
      expect(error, `the binary builds: cargo build --locked --bin ${BIN}`).toBe('');
      return join(dir, BIN);
    },
    out: () => dir,
  };
}
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(value));
  return p;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one scenario `{"out", "calls"}` per line in, one line out (#377).

/** The wrong programs this suite adds, each reachable only through `--planted` (README: Planted programs). */
export type Planted = 'bloom_clamps_to_target' | 'ao_scales_by_target' | 'clears_whole_target';

export function run(bin: string, out: string, calls: JsonObject[], planted?: Planted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const name = `${BIN} ${args.join(' ')}`;
  const r = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${name}: ${r.error.message}`);
  expect(timedOut, `${name} finished within its timeout`).toBe(false);
  const stdout = r.stdout ?? '';
  expect(r.status, `${name} exits 0 (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${name}: one answer line`).toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, `${name}: the answer`);
  expect(answer['ok'], `${name} answers the scenario ok; got ${show(answer)}`).toBe(true);
  const replies = arr(answer['replies'], `${name}: replies`).map((v, i) => obj(v, `${name}: replies[${i}]`));
  expect(replies.length, `${name}: one reply per call`).toBe(calls.length);
  return replies;
}
/** A reply the binary answered, not refused; BLOCKED when it says this machine has no GPU to draw on. */
export function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform' || (typeof reply['code'] === 'string' && /gpu|adapter/.test(reply['code']))) blocked(`${what}: no GPU to draw on here: ${show(reply)}`);
  expect(reply['code'], `${what} is answered, not refused: ${show(reply)}`).toBeUndefined();
  return reply;
}

/** #378's `view3d` as it is: the one frame FRAME of the view drawn alone, its final, linear and ID targets kept. */
export const view3d = (doc: string, look: JsonObject): JsonObject =>
  ({ call: 'view3d', doc, look, size: [...VIEW], fps: FPS, from: FRAME, frames: 1, capture: [FRAME], targets: ['final', 'linear', 'ids'] });
/** The one frame a `view3d` reply captured. */
export function frameOf(reply: JsonObject, what: string): JsonObject {
  const frames = arr(answered(reply, what)['frames'], `${what}: frames`).map((f, i) => obj(f, `${what}: frames[${i}]`));
  const frame = frames.find((f) => f['frame'] === FRAME);
  expect(frame !== undefined, `${what}: frame ${FRAME} is captured: ${show(reply, 600)}`).toBe(true);
  return frame!;
}
/** This suite's `view_rectangle` (README: The surface under test): the same frame both ways, the issue's numbers. */
export const viewRectangle = (doc: string, look: JsonObject, seed: number): JsonObject =>
  ({ call: 'view_rectangle', doc, look, size: [...VIEW], fps: FPS, from: FRAME, target: [...TARGET], at: [...AT], seed });

// ---------------------------------------------------------------------------------------------------
// The targets: files under `out`, each named by its SHA-256 (README: The files).

/** The targets a draw returns, in the order every check walks them. */
export const TARGETS = ['final', 'linear', 'ids', 'normal', 'depth', 'velocity'] as const;
export type TargetName = (typeof TARGETS)[number];
/** How a target's file holds a pixel: 8-bit channels of a PNG (4 after decoding) or little-endian f32 lanes. */
const LAYOUT: Record<TargetName, { ext: 'png' | 'f32'; lanes: number; bytes: number }> = {
  final: { ext: 'png', lanes: 4, bytes: 4 },
  linear: { ext: 'f32', lanes: 4, bytes: 16 },
  ids: { ext: 'png', lanes: 4, bytes: 4 },
  normal: { ext: 'f32', lanes: 3, bytes: 12 },
  depth: { ext: 'f32', lanes: 1, bytes: 4 },
  velocity: { ext: 'f32', lanes: 2, bytes: 8 },
};
/** One target read back: `size[0] × size[1]` pixels of `bytes` bytes each, rows top-down, no padding. */
export interface Pixels { name: TargetName; size: Size; bytes: number; lanes: number; float: boolean; data: Buffer; sha: string }
export type Drawn = Record<TargetName, Pixels>;

function readNamed(out: string, hash: JsonValue | undefined, ext: string, what: string): Buffer {
  expect(typeof hash === 'string' && SHA.test(hash), `${what} is written, named by a SHA-256; got ${show(hash)}`).toBe(true);
  const file = readFileSync(join(out, `${hash as string}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};
/** An 8-bit RGB or RGBA PNG, not interlaced, as RGBA bytes (alpha 255 where the file has none). */
function decodePng(file: Buffer, size: Size, what: string): Buffer {
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
  expect([w, h], `${what}: the PNG's size`).toEqual(size);
  const ch = type === 6 ? 4 : 3; const stride = w * ch;
  const raw = inflateSync(Buffer.concat(idat)); const px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!; const row = y * (stride + 1) + 1; const at = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[at + x - ch]! : 0; const b = y > 0 ? px[at - stride + x]! : 0;
      const c = x >= ch && y > 0 ? px[at - stride + x - ch]! : 0; const v = raw[row + x]!;
      px[at + x] = (f === 0 ? v : f === 1 ? v + a : f === 2 ? v + b : f === 3 ? v + ((a + b) >> 1) : v + paeth(a, b, c)) & 0xff;
    }
  }
  if (ch === 4) return px;
  const rgba = Buffer.alloc(w * h * 4, 255);
  for (let i = 0; i < w * h; i++) px.copy(rgba, i * 4, i * 3, i * 3 + 3);
  return rgba;
}
/** One draw's six targets (`alone`, `seeded` or `rectangle` of a `view_rectangle` reply), each `size` px. */
export function targetsOf(out: string, v: JsonValue | undefined, size: Size, what: string): Drawn {
  const o = obj(v, what);
  const read = (name: TargetName): Pixels => {
    const l = LAYOUT[name]; const tag = `${what}.${name}`;
    const file = readNamed(out, o[name], l.ext, tag);
    const data = l.ext === 'png' ? decodePng(file, size, tag) : file;
    expect(data.length, `${tag} holds ${size[0]} × ${size[1]} pixels of ${l.bytes} bytes`).toBe(size[0] * size[1] * l.bytes);
    return { name, size, bytes: l.bytes, lanes: l.lanes, float: l.ext === 'f32', data, sha: o[name] as string };
  };
  return { final: read('final'), linear: read('linear'), ids: read('ids'), normal: read('normal'), depth: read('depth'), velocity: read('velocity') };
}
/** One of `view3d`'s targets as this suite's readers hold a target, so `equalPixels` can judge it. */
export function view3dTarget(out: string, frame: JsonObject, name: 'final' | 'linear' | 'ids', what: string): Pixels {
  const l = LAYOUT[name]; const tag = `${what}.${name}`;
  const file = readNamed(out, frame[name], l.ext, tag);
  const data = l.ext === 'png' ? decodePng(file, VIEW, tag) : file;
  expect(data.length, `${tag} holds ${VIEW[0]} × ${VIEW[1]} pixels of ${l.bytes} bytes`).toBe(VIEW[0] * VIEW[1] * l.bytes);
  return { name, size: VIEW, bytes: l.bytes, lanes: l.lanes, float: l.ext === 'f32', data, sha: frame[name] as string };
}
/** A `view_rectangle` reply's three draws, read back. */
export interface Rectangle { alone: Drawn; seeded: Drawn; rectangle: Drawn }
export function rectangleOf(out: string, reply: JsonObject, what: string): Rectangle {
  answered(reply, what);
  return {
    alone: targetsOf(out, reply['alone'], VIEW, `${what}: alone`),
    seeded: targetsOf(out, reply['seeded'], TARGET, `${what}: seeded`),
    rectangle: targetsOf(out, reply['rectangle'], TARGET, `${what}: rectangle`),
  };
}

// ---------------------------------------------------------------------------------------------------
// The two comparisons (README: Readings, "one code value" and "the first pixel")

/** A pixel's values as text: 8-bit channels, or f32 lanes. */
function pixelAt(p: Pixels, x: number, y: number): string {
  const o = (y * p.size[0] + x) * p.bytes;
  const lanes = Array.from({ length: p.lanes }, (_, k) => (p.float ? p.data.readFloatLE(o + k * 4) : p.data[o + k]!));
  return `[${lanes.join(', ')}]`;
}
/** One 8-bit step of a channel's unit. */
export const CODE = 1 / 255;
/** The step between neighbouring half floats at magnitude `v`. */
const halfStep = (v: number): number => (v >= 2 ** -14 ? 2 ** (Math.floor(Math.log2(v)) - 10) : 2 ** -24);
/** Whether two f32 lanes are within one code value: 1/255, or one half-float step where that is coarser; a value
 * that isn't finite matches only its own bits. */
function lanesWithin(a: Buffer, ao: number, b: Buffer, bo: number): boolean {
  const x = a.readFloatLE(ao); const y = b.readFloatLE(bo);
  if (x === y) return true;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return a.readUInt32LE(ao) === b.readUInt32LE(bo);
  return Math.abs(x - y) <= Math.max(CODE, halfStep(Math.max(Math.abs(x), Math.abs(y))));
}
/** Whether pixel `i` of `a` and pixel `j` of `b` are equal bit for bit (`exact`) or within one code value. */
function pixelWithin(a: Pixels, i: number, b: Pixels, j: number, exact: boolean): boolean {
  const ao = i * a.bytes; const bo = j * b.bytes;
  if (exact) return a.data.compare(b.data, bo, bo + b.bytes, ao, ao + a.bytes) === 0;
  for (let k = 0; k < a.lanes; k++) {
    if (a.float ? !lanesWithin(a.data, ao + k * 4, b.data, bo + k * 4) : Math.abs(a.data[ao + k]! - b.data[bo + k]!) > 1) return false;
  }
  return true;
}
/** A target the criterion holds bit for bit inside the rectangle: the ID target. Every other is within one code value. */
const exactInside = (name: TargetName): boolean => name === 'ids';

export interface Off { target: TargetName; count: number; first: [number, number]; text: string }
/**
 * Criterion 15's comparison, one target: every pixel (x, y) of the view drawn alone against pixel (x + AT, y + AT) of
 * the larger target, the ID target bit for bit and every other within one code value. Returns the pixels off and the
 * first of them, rows top-down, left to right, in the view's own coordinates; null when none is off.
 */
export function insideOff(alone: Pixels, rect: Pixels): Off | null {
  const [w, h] = alone.size; const exact = exactInside(alone.name);
  let count = 0; let first: [number, number] | null = null;
  for (let y = 0; y < h; y++) {
    const row = (y + AT[1]) * rect.size[0] + AT[0];
    for (let x = 0; x < w; x++) {
      if (pixelWithin(alone, y * w + x, rect, row + x, exact)) continue;
      count++;
      first ??= [x, y];
    }
  }
  if (first === null) return null;
  const [x, y] = first;
  const text = `the ${alone.name} target: ${count} of ${w * h} pixels of the rectangle are ${exact ? 'not equal bit for bit to' : 'more than one code value from'} the view drawn alone; `
    + `the first pixel is (${x}, ${y}) of the view, (${x + AT[0]}, ${y + AT[1]}) of the target: alone ${pixelAt(alone, x, y)}, in the rectangle ${pixelAt(rect, x + AT[0], y + AT[1])}`;
  return { target: alone.name, count, first, text };
}
/** Criterion 15's check over every target: one failure per target that is off, naming it and its first pixel. */
export function insideFailures(r: Rectangle): string[] {
  return TARGETS.map((name) => insideOff(r.alone[name], r.rectangle[name])).filter((o) => o !== null).map((o) => o.text);
}

/**
 * Criterion 16's comparison, one target: every pixel outside the rectangle, after the view drew, against the noise the
 * target was seeded with, bit for bit. The first pixel is the first in rows top-down, left to right, in the target's
 * coordinates.
 */
export function outsideOff(seeded: Pixels, drawn: Pixels): Off | null {
  const [w, h] = seeded.size; const b = seeded.bytes;
  let count = 0; let first = null as [number, number] | null;
  const span = (y: number, x0: number, x1: number): void => {
    const from = (y * w + x0) * b; const to = (y * w + x1) * b;
    if (x1 <= x0 || seeded.data.compare(drawn.data, from, to, from, to) === 0) return;
    for (let x = x0; x < x1; x++) {
      if (pixelWithin(seeded, y * w + x, drawn, y * w + x, true)) continue;
      count++;
      first ??= [x, y];
    }
  };
  for (let y = 0; y < h; y++) {
    if (y < AT[1] || y >= AT[1] + VIEW[1]) span(y, 0, w);
    else { span(y, 0, AT[0]); span(y, AT[0] + VIEW[0], w); }
  }
  if (first === null) return null;
  const [x, y] = first;
  const text = `the ${seeded.name} target: ${count} of ${w * h - VIEW[0] * VIEW[1]} pixels outside the rectangle lost their noise; `
    + `the first pixel outside is (${x}, ${y}) of the target: seeded ${pixelAt(seeded, x, y)}, after the view drew ${pixelAt(drawn, x, y)}`;
  return { target: seeded.name, count, first, text };
}
/** Criterion 16's check over every target: one failure per target that lost noise, naming it and its first pixel. */
export function outsideFailures(r: Rectangle): string[] {
  return TARGETS.map((name) => outsideOff(r.seeded[name], r.rectangle[name])).filter((o) => o !== null).map((o) => o.text);
}

/** Whether two targets of one size hold the same pixels, bit for bit; else the first pixel that differs. */
export function equalPixels(a: Pixels, b: Pixels, what: string): void {
  expect([a.size, a.bytes], `${what}: one size and layout`).toEqual([b.size, b.bytes]);
  if (a.data.equals(b.data)) return;
  let i = 0;
  while (pixelWithin(a, i, b, i, true)) i++;
  const [x, y] = [i % a.size[0], Math.floor(i / a.size[0])];
  expect.fail(`${what}: the first pixel that differs is (${x}, ${y}): ${pixelAt(a, x, y)} against ${pixelAt(b, x, y)}`);
}

/** How many different pixel values the first `n` pixels of a target hold (rows 0 and 1 of the larger target, which
 * lie above the rectangle). */
export function distinctPixels(p: Pixels, n: number): number {
  const seen = new Set<string>();
  for (let i = 0; i < n; i++) seen.add(p.data.toString('latin1', i * p.bytes, (i + 1) * p.bytes));
  return seen.size;
}

/** Whether view pixel (x, y) lies within `px` pixels of the rectangle's edge. */
export const nearEdge = (x: number, y: number, px: number): boolean => x < px || y < px || x >= VIEW[0] - px || y >= VIEW[1] - px;
/**
 * The pixels of the final target, within `px` pixels of the rectangle's edge, that the rectangle draws brighter than
 * the view alone by more than one code value on some channel and darker on none: their count and the first.
 */
export function brighterNearEdge(r: Rectangle, px: number): { count: number; first: string } {
  const a = r.alone.final; const b = r.rectangle.final;
  let count = 0; let first = '';
  for (let y = 0; y < VIEW[1]; y++) for (let x = 0; x < VIEW[0]; x++) {
    if (!nearEdge(x, y, px)) continue;
    const ao = (y * VIEW[0] + x) * 4; const bo = ((y + AT[1]) * TARGET[0] + x + AT[0]) * 4;
    const d = [0, 1, 2].map((k) => b.data[bo + k]! - a.data[ao + k]!);
    if (!d.some((v) => v > 1) || d.some((v) => v < 0)) continue;
    count++;
    if (first === '') first = `(${x}, ${y}): alone ${pixelAt(a, x, y)}, in the rectangle ${pixelAt(b, x + AT[0], y + AT[1])}`;
  }
  return { count, first };
}
