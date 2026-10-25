// Test-side tools for the #378 acceptance tests: `deep-gpu` (#377's binary) and `deep-show` (#393's)
// built once per file and driven by JSON lines; the `view3d` call and its reply; the fixtures under
// fixtures/ and the one this suite generates (the 2,000-box orbit); PNG and f32 target reading; the
// object-ID target; the CPU references the criteria compare against (sRGB encoding, the look's
// exposure and its four tone maps, a pinhole projection); and the checks each criterion's planted
// program must fail, each returning its failures as sentences that name what failed. Nothing here
// stands in for the GPU layer, scene3d, the render worker or the compositor under test.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/378 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const GPU_BIN = 'deep-gpu';
export const SHOW_BIN = 'deep-show';
type BinName = typeof GPU_BIN | typeof SHOW_BIN;
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);

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
export const clone = <T extends JsonValue>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** A fixture file's absolute path, as the calls take it. */
export const fixturePath = (name: string): string => join(HERE, 'fixtures', name);
export function fixture(name: string): JsonObject {
  const value = JSON.parse(readFileSync(fixturePath(name), 'utf8')) as JsonValue;
  if (!isObject(value)) throw Error(`fixture ${name} is not a JSON object`);
  return value;
}

// ---------------------------------------------------------------------------------------------------
// Builds: each binary built once per file with `cargo build --locked --bin <name>`, copied out of
// target/debug under its own name, as #377's suite does; a test that uses a build that failed fails.

function cargoBuild(name: BinName): string {
  const args = ['build', '--locked', '--bin', name];
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}

export interface Bins { bin: (name: BinName) => string }

export function useBins(names: readonly BinName[]): Bins {
  let dir = '';
  const made = new Map<BinName, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-378-bins-'));
    for (const name of names) {
      const error = cargoBuild(name);
      const bin = join(dir, exe(name));
      if (error === '') copyFileSync(join(REPO, 'target', 'debug', exe(name)), bin);
      made.set(name, { bin, error });
    }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(name: BinName): string {
      const entry = made.get(name);
      if (!entry) throw Error(`the file didn't list ${name} in useBins`);
      expect(entry.error, `the binary builds: cargo build --locked --bin ${name}`).toBe('');
      return entry.bin;
    },
  };
}

/** A fresh output folder per test (targets, captures, generated documents), deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-378-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

export interface Started { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }

export function start(bin: string, args: string[], inputs: (JsonValue | string)[], env: NodeJS.ProcessEnv = {}, timeoutMs = 1_800_000): Started {
  const text = inputs.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n');
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(bin, args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 2 * 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${bin} ${args.join(' ')}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  const lines = stdout.split('\n').filter((line) => line !== '').map((line) => {
    try { return JSON.parse(line) as JsonValue; } catch { return line; }
  });
  return { status: run.status, signal: run.signal, timedOut, lines, stdout, stderr: run.stderr ?? '' };
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--backend noop] [--planted <name>]` (#377): one scenario per line, one line out.

/** The wrong programs this suite adds to `deep-gpu`, each reachable only through `--planted` (README: Planted programs). */
export type Planted = 'forward_z' | 'encodes_twice' | 'skips_encode' | 'encodes_every_frame' | 'replays_after_add' | 'pairs_newest_slot';
export interface Startup { backend?: 'noop'; planted?: Planted }
export const startArgs = (s: Startup = {}): string[] =>
  ['run', ...(s.backend ? ['--backend', s.backend] : []), ...(s.planted ? ['--planted', s.planted] : [])];

/** One scenario, accepted, with one reply per call. */
export function runGpu(bin: string, out: string, calls: JsonObject[], startup: Startup = {}): JsonObject[] {
  const args = startArgs(startup);
  const s = start(bin, args, [{ out, calls }]);
  const shown = `${GPU_BIN} ${args.join(' ')}`;
  expect(s.timedOut, `${shown} finished within its timeout`).toBe(false);
  expect(s.status, `${shown} exited 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-3000)}`).toBe(0);
  expect(s.lines.length, `${shown}: one output line per input line`).toBe(1);
  const answer = obj(s.lines[0], `${shown}: the answer`);
  expect(answer['ok'], `${shown} refused the scenario: ${JSON.stringify(answer).slice(0, 2000)}`).toBe(true);
  const replies = arr(answer['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(calls.length);
  return replies;
}

/** Fails with an INCONCLUSIVE message off macOS: the pixels come from the GPU layer on the reference platform's GPU. */
export function requireGpu(): void {
  expect(process.platform, 'INCONCLUSIVE: the GPU layer draws these pixels on macOS\'s Metal device, the reference platform; this is not a pass').toBe('darwin');
}

// ---------------------------------------------------------------------------------------------------
// The view3d call (README: The surface under test)

export interface View3Call {
  doc: string; look: JsonObject; size: [number, number];
  frames?: number; fps?: number;
  patches?: { frame: number; writer: string; ops: JsonObject[] }[];
  targets?: ('final' | 'linear' | 'ids')[];
  capture?: 'every' | number[];
  window?: { size: [number, number]; view: [number, number]; page: [number, number, number] };
  latency?: number[];
  counts?: boolean;
}
export const view3d = (c: View3Call): JsonObject => ({ call: 'view3d', ...(c as unknown as JsonObject) });

export interface Batch { batch: string; items: string[] }
export interface Frame3 {
  frame: number; frame_seq: number; pixel_hash: string | null;
  final: string | null; linear: string | null; ids: string | null; picks: Map<number, string> | null; window: string | null;
  encoded: Batch[] | null; replayed: number | null; instances_written: number | null; meshes_built: number | null;
}
export interface Pass { name: string; reads: string[]; writes: string[] }
export interface View3 { frames: Frame3[]; passes: Pass[]; raw: JsonObject }

const optStr = (v: JsonValue | undefined, what: string): string | null => (v === undefined || v === null ? null : str(v, what));
const optNum = (v: JsonValue | undefined, what: string): number | null => (v === undefined || v === null ? null : num(v, what));

/** A view3d reply; INCONCLUSIVE when the binary says the platform can't draw it. */
export function view3Reply(reply: JsonObject, what = 'the view3d call'): View3 {
  if (reply['code'] === 'unsupported_platform') expect.fail(`INCONCLUSIVE: ${what} reports unsupported_platform; this is not a pass`);
  expect(reply['code'], `${what} was answered, not refused: ${JSON.stringify(reply).slice(0, 1500)}`).toBeUndefined();
  const frames = arr(reply['frames'], `${what}: frames`).map((v, i): Frame3 => {
    const f = obj(v, `${what}: frames[${i}]`);
    const at = `${what}: frames[${i}]`;
    const pixel = optStr(f['pixel_hash'], `${at}.pixel_hash`);
    if (pixel !== null) expect(pixel, `${at}.pixel_hash is a SHA-256 in lowercase hex`).toMatch(SHA);
    let picks: Map<number, string> | null = null;
    if (f['picks'] !== undefined && f['picks'] !== null) {
      picks = new Map(Object.entries(obj(f['picks'], `${at}.picks`)).map(([k, id]) => {
        expect(k, `${at}.picks keys are pick IDs in decimal`).toMatch(/^[1-9][0-9]*$/);
        return [Number(k), str(id, `${at}.picks[${k}]`)];
      }));
    }
    const encoded = f['encoded'] === undefined ? null : arr(f['encoded'], `${at}.encoded`).map((b, j): Batch => {
      const o = obj(b, `${at}.encoded[${j}]`);
      return { batch: str(o['batch'], `${at}.encoded[${j}].batch`), items: strs(o['items'], `${at}.encoded[${j}].items`) };
    });
    return {
      frame: num(f['frame'], `${at}.frame`), frame_seq: num(f['frame_seq'], `${at}.frame_seq`), pixel_hash: pixel,
      final: optStr(f['final'], `${at}.final`), linear: optStr(f['linear'], `${at}.linear`), ids: optStr(f['ids'], `${at}.ids`), picks,
      window: optStr(f['window'], `${at}.window`), encoded, replayed: optNum(f['replayed'], `${at}.replayed`),
      instances_written: optNum(f['instances_written'], `${at}.instances_written`), meshes_built: optNum(f['meshes_built'], `${at}.meshes_built`),
    };
  });
  const passes = arr(reply['passes'] ?? [], `${what}: passes`).map((v, i): Pass => {
    const p = obj(v, `${what}: passes[${i}]`);
    return { name: str(p['name'], `${what}: passes[${i}].name`), reads: strs(p['reads'], `${what}: passes[${i}].reads`), writes: strs(p['writes'], `${what}: passes[${i}].writes`) };
  });
  return { frames, passes, raw: reply };
}

/** A reply that latched every frame 0 … count − 1 once, in order. */
export function everyFrame(v: View3, count: number, what: string): void {
  expect(v.frames.map((f) => f.frame), `${what}: every frame from 0 to ${count - 1} presented once, in order`).toEqual(Array.from({ length: count }, (_, i) => i));
}

export function frameAt(v: View3, n: number, what: string): Frame3 {
  const f = v.frames.find((x) => x.frame === n);
  expect(f, `${what}: frame ${n} is in the reply`).toBeDefined();
  return f!;
}

// ---------------------------------------------------------------------------------------------------
// Targets read back: PNGs and the linear target's f32 file, each named by the SHA-256 of its bytes.

export interface Image { width: number; height: number; /** RGBA, row-major. */ rgba: Uint8Array }

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Reads an 8-bit RGB or RGBA PNG with no interlace; `channels` is the file's own (3 or 4). */
export function decodePng(file: Buffer): Image & { channels: number } {
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
  return { width, height, rgba, channels };
}

function readNamed(out: string, hash: string | null, ext: string, what: string): Buffer {
  expect(hash, `${what} is written`).not.toBeNull();
  expect(hash, `${what} is named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${hash}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}

/** An 8-bit PNG the binary wrote (`final`, `window`). */
export function readPng(out: string, hash: string | null, what: string): Image {
  return decodePng(readNamed(out, hash, 'png', what));
}

/** The slot's bytes as the frame's `pixel_hash` hashes them: BGRA8, rows top-down, no padding. */
export function slotHashOf(image: Image): string {
  const bgra = Buffer.alloc(image.rgba.length);
  for (let i = 0; i < image.rgba.length; i += 4) {
    bgra[i] = image.rgba[i + 2]!; bgra[i + 1] = image.rgba[i + 1]!; bgra[i + 2] = image.rgba[i]!; bgra[i + 3] = image.rgba[i + 3]!;
  }
  return sha256(bgra);
}

/** The linear target as read back: little-endian f32 RGBA, rows top-down, `w × h × 16` bytes. */
export function readLinear(out: string, hash: string | null, size: [number, number], what: string): Float32Array {
  const file = readNamed(out, hash, 'f32', what);
  expect(file.length, `${what} holds ${size[0]} × ${size[1]} f32 RGBA pixels`).toBe(size[0] * size[1] * 16);
  const values = new Float32Array(size[0] * size[1] * 4);
  for (let i = 0; i < values.length; i++) values[i] = file.readFloatLE(i * 4);
  return values;
}

/** The object-ID target: an 8-bit RGBA PNG whose pixel holds pick ID r + 2^8 g + 2^16 b + 2^24 a (0: nothing drawn). */
export interface Ids { width: number; height: number; at: (x: number, y: number) => string | null; count: Map<string, number> }
export function readIds(out: string, f: Frame3, what: string): Ids {
  const png = decodePng(readNamed(out, f.ids, 'png', what));
  expect(png.channels, `${what} is an RGBA PNG (the pick ID's top byte is its alpha)`).toBe(4);
  expect(f.picks, `${what}: the frame names the item each pick ID stands for`).not.toBeNull();
  const picks = f.picks!;
  const items: (string | null)[] = new Array(png.width * png.height);
  const count = new Map<string, number>();
  const unknown = new Set<number>();
  for (let i = 0; i < items.length; i++) {
    const o = i * 4;
    const pick = (png.rgba[o]! + png.rgba[o + 1]! * 256 + png.rgba[o + 2]! * 65_536 + png.rgba[o + 3]! * 16_777_216) >>> 0;
    if (pick === 0) { items[i] = null; continue; }
    const id = picks.get(pick);
    if (id === undefined) { unknown.add(pick); items[i] = null; continue; }
    items[i] = id;
    count.set(id, (count.get(id) ?? 0) + 1);
  }
  expect([...unknown].slice(0, 5), `${what}: every pick ID in the target names an item in the frame's picks`).toEqual([]);
  return {
    width: png.width, height: png.height, count,
    at: (x: number, y: number) => (x < 0 || y < 0 || x >= png.width || y >= png.height ? null : items[Math.floor(y) * png.width + Math.floor(x)]!),
  };
}

// ---------------------------------------------------------------------------------------------------
// Looks and documents

/** The look these tests draw with (fixtures/look.json), with the fields a test changes. */
export function look(change: JsonObject = {}): JsonObject {
  return { ...fixture('look.json'), ...change };
}

/** Writes a document under the test's output folder and returns its path, as the view3d call takes it. */
export function writeDoc(out: string, name: string, doc: JsonObject): string {
  const path = join(out, name);
  writeFileSync(path, JSON.stringify(doc));
  return path;
}

export const set = (id: string, path: string, value: JsonValue): JsonObject => ({ op: 'set', id, path: `items/${id}/${path}`, value });

// ---------------------------------------------------------------------------------------------------
// The CPU references: sRGB, the look's exposure (EV100) and its tone maps (README: Readings)

export const clamp01 = (x: number): number => (Number.isNaN(x) ? 0 : Math.min(1, Math.max(0, x)));
/** The sRGB transfer function (IEC 61966-2-1), linear to encoded, on [0, 1]. */
export const srgbEncode = (x: number): number => { const v = clamp01(x); return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; };
export const srgbDecode = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
/** An encoded value in [0, 1] as its 8-bit code. */
export const code8 = (v: number): number => Math.round(255 * clamp01(v));
/** The linear scale of the look's exposure: the saturation-based photometric exposure, 1 ÷ (1.2 × 2^EV100). */
export const exposureScale = (ev100: number): number => 1 / (1.2 * 2 ** ev100);
/** The EV100 whose scale is exactly 1. */
export const EV_UNIT = -Math.log2(1.2);

export type ToneMap = 'none' | 'filmic' | 'agx' | 'neutral';
export const TONE_MAPS: readonly ToneMap[] = ['none', 'filmic', 'agx', 'neutral'];

/** agx's analytic curve per channel (Look look@1: tone mapping), contrast 1.25, white 16.29. */
export function agxCurve(x: number, c = 1.25, white = 16.29): number {
  if (!(x > 0)) return 0;
  const a = (1 / 0.18 - 1) * 0.18 ** c;
  if (x <= 0.18) return x ** c / (x ** c + a);
  if (x >= white) return 1;
  const k = (c * 0.18 ** (c - 1) * a) / (0.18 ** c + a) ** 2; // the toe's slope at 0.18
  const w = (k * (white - 0.18) ** 2) / 0.82;
  const d = x - 0.18;
  return 0.18 + (k * d * (1 + d / w)) / (1 + (k * d) / 0.82);
}
/** filmic: the ACES filmic fit (Narkowicz 2015), per channel. */
export const filmicCurve = (x: number): number => { const v = Math.max(0, x); return clamp01((v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14)); };
/** neutral: Khronos PBR Neutral, on an RGB triple. */
export function neutral(rgb: [number, number, number]): [number, number, number] {
  const start = 0.8 - 0.04; const desat = 0.15;
  const x = Math.min(...rgb);
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  let c = rgb.map((v) => v - offset) as [number, number, number];
  const peak = Math.max(...c);
  if (peak < start) return c;
  const d = 1 - start;
  const newPeak = 1 - (d * d) / (peak + d - start);
  c = c.map((v) => (v * newPeak) / peak) as [number, number, number];
  const g = 1 - 1 / (desat * (peak - newPeak) + 1);
  return c.map((v) => v * (1 - g) + newPeak * g) as [number, number, number];
}
/**
 * The tone map on a linear RGB triple after exposure. AgX's inset and outset matrices map grey to grey,
 * so on grey pixels agx is its curve per channel; the fixture for this comparison holds only grey
 * pixels, so the matrices' values never enter it (README: Readings).
 */
export function toneMap(map: ToneMap, rgb: [number, number, number]): [number, number, number] {
  switch (map) {
    case 'none': return rgb.map(clamp01) as [number, number, number];
    case 'filmic': return rgb.map(filmicCurve) as [number, number, number];
    case 'agx': return rgb.map((v) => agxCurve(v)) as [number, number, number];
    case 'neutral': return neutral(rgb).map(clamp01) as [number, number, number];
  }
}
/** The CPU's 8-bit sRGB encoding of the look's exposure and tone map applied to one linear pixel. */
export function cpuEncode(map: ToneMap, ev100: number, rgb: [number, number, number]): [number, number, number] {
  const s = exposureScale(ev100);
  return toneMap(map, [rgb[0] * s, rgb[1] * s, rgb[2] * s]).map((v) => code8(srgbEncode(v))) as [number, number, number];
}

export interface ToneCheck { problems: string[]; checked: number; at188: { x: number; y: number; read: [number, number, number] }[] }
/**
 * Criterion 6: every 8-bit pixel of the final frame equals within one code value the CPU's encoding of
 * the same frame's linear target. A failure names the pass that writes the final frame. `at188` lists
 * the pixels whose tone-mapped linear value is within 0.003 of 0.5 and the CPU gives 188.
 */
export function toneProblems(final: Image, linear: Float32Array, map: ToneMap, ev100: number, pass: string, what: string): ToneCheck {
  let off = 0; let first = '';
  const at188: ToneCheck['at188'] = [];
  const s = exposureScale(ev100);
  const n = final.width * final.height;
  for (let i = 0; i < n; i++) {
    const rgb: [number, number, number] = [linear[i * 4]!, linear[i * 4 + 1]!, linear[i * 4 + 2]!];
    const want = cpuEncode(map, ev100, rgb);
    const read: [number, number, number] = [final.rgba[i * 4]!, final.rgba[i * 4 + 1]!, final.rgba[i * 4 + 2]!];
    if (want.some((w, c) => Math.abs(read[c]! - w) > 1)) {
      off++;
      if (!first) first = `at (${i % final.width}, ${Math.floor(i / final.width)}) the frame reads ${read.join(',')} where the CPU gives ${want.join(',')} from linear ${rgb.map((v) => v.toFixed(5)).join(',')}`;
    }
    const mapped = toneMap(map, [rgb[0] * s, rgb[1] * s, rgb[2] * s]);
    if (want.every((w) => w === 188) && mapped.every((v) => Math.abs(v - 0.5) <= 0.003)) at188.push({ x: i % final.width, y: Math.floor(i / final.width), read });
  }
  const problems = off ? [`${what}: pass ${pass}: ${off} of ${n} pixels are more than one code value from the CPU's sRGB encoding of ${map} at EV100 ${ev100} (first ${first})`] : [];
  return { problems, checked: n, at188 };
}

// ---------------------------------------------------------------------------------------------------
// A pinhole camera (README: Readings): position, target, +Y up, fov across the frame's wider side,
// pixel centres at +0.5, y down; as #372's suite projects.

export type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };

export interface Pinhole { position: V3; target: V3; fov: number; size: [number, number] }
/** A world point to frame px [x, y] and its depth along the view axis. */
export function project(cam: Pinhole, p: V3): [number, number, number] {
  const f = norm(sub(cam.target, cam.position));
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const d = sub(p, cam.position);
  const z = dot(d, f);
  const focal = Math.max(...cam.size) / 2 / Math.tan((cam.fov * Math.PI) / 360);
  return [cam.size[0] / 2 + (focal * dot(d, r)) / z, cam.size[1] / 2 - (focal * dot(d, u)) / z, z];
}
/** The frame rect [x0, y0, x1, y1] of a box's face nearest a camera looking down −Z. */
export function frontFace(cam: Pinhole, center: V3, size: V3): [number, number, number, number] {
  const z = center[2] + size[2] / 2;
  const a = project(cam, [center[0] - size[0] / 2, center[1] + size[1] / 2, z]);
  const b = project(cam, [center[0] + size[0] / 2, center[1] - size[1] / 2, z]);
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

// ---------------------------------------------------------------------------------------------------
// Ink measures on a captured image: weighted pixels of one color family.

export type Weight = (r: number, g: number, b: number) => number;
export const redness: Weight = (r, g, b) => Math.max(0, (r - Math.max(g, b)) / 255);
export const greenness: Weight = (r, g, b) => Math.max(0, (g - Math.max(r, b)) / 255);

export interface Ink { mass: number; cx: number; cy: number; box: [number, number, number, number]; angle: number }
/** Weighted centroid, the box of pixels weighing at least half, and the major axis's angle in degrees (0: horizontal). */
export function ink(image: Image, weight: Weight, region?: [number, number, number, number]): Ink {
  const [x0, y0, x1, y1] = region ?? [0, 0, image.width, image.height];
  let m = 0; let sx = 0; let sy = 0;
  let bx0 = Infinity; let by0 = Infinity; let bx1 = -Infinity; let by1 = -Infinity;
  const ws: [number, number, number][] = [];
  for (let y = Math.max(0, y0); y < Math.min(image.height, y1); y++) for (let x = Math.max(0, x0); x < Math.min(image.width, x1); x++) {
    const o = (y * image.width + x) * 4;
    const w = weight(image.rgba[o]!, image.rgba[o + 1]!, image.rgba[o + 2]!);
    if (w <= 0.02) continue;
    m += w; sx += w * (x + 0.5); sy += w * (y + 0.5);
    ws.push([x + 0.5, y + 0.5, w]);
    if (w >= 0.5) { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x + 1); by1 = Math.max(by1, y + 1); }
  }
  const cx = m ? sx / m : NaN; const cy = m ? sy / m : NaN;
  let xx = 0; let yy = 0; let xy = 0;
  for (const [x, y, w] of ws) { xx += w * (x - cx) ** 2; yy += w * (y - cy) ** 2; xy += w * (x - cx) * (y - cy); }
  const angle = (0.5 * Math.atan2(2 * xy, xx - yy) * 180) / Math.PI;
  return { mass: m, cx, cy, box: [bx0, by0, bx1, by1], angle };
}

// ---------------------------------------------------------------------------------------------------
// The 2,000-box orbit (criterion 7): generated, not a file, so its 2,000 items stay readable here.

export const ORBIT = { layers: 40, perLayer: 50, size: [800, 800] as [number, number], frames: 600, fps: 60 };
export const boxId = (layer: number, i: number): string => `b${String(layer).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
export const layerId = (layer: number): string => `l${String(layer).padStart(2, '0')}`;
export const writerOf = (layer: number): string => `agent-${String(layer).padStart(2, '0')}`;
export const gridPos = (layer: number, i: number): V3 => [(i - 24.5) * 2.5, 0.5, (layer - 19.5) * 2.5];
export function boxItem(layer: number, i: number): JsonObject {
  return {
    id: boxId(layer, i), kind: 'mark.box@1', layer: layerId(layer), name: `Box ${i} of row ${layer}`, order: `a${String(i).padStart(2, '0')}`,
    params: { size: [1, 1, 1], paint: { fill: { role: `c${layer % 8}` } } }, at: { pos: gridPos(layer, i) },
  };
}
/**
 * Forty writer layers, each its own writer's, each holding fifty 1 m boxes of one paint on a 2.5 m grid
 * (125 m × 100 m); a camera layer whose orbit camera (target the grid's centre, elevation 60°, distance
 * 300 m, fov 40) turns at 90° a second through a linear channel on its azimuth, 900° over 10 s.
 */
export function orbitDoc(): JsonObject {
  const layers: JsonObject = { camera: { writer: 'agent-cam', title: 'Camera', order: 'a0' } };
  const items: JsonObject = {
    cam: { id: 'cam', kind: 'camera@1', layer: 'camera', name: 'Camera', order: 'a0', params: { projection: 'perspective', target: [0, 0, 0], orbit: { azimuth: 0, elevation: 60, distance: 300 }, fov: 40 } },
  };
  for (let l = 0; l < ORBIT.layers; l++) {
    layers[layerId(l)] = { writer: writerOf(l), title: `Row ${l}`, order: `a${String(l + 1).padStart(2, '0')}` };
    for (let i = 0; i < ORBIT.perLayer; i++) items[boxId(l, i)] = boxItem(l, i);
  }
  return {
    format: 1, id: 'orbit-2000', profile: 'scene', title: 'Two thousand boxes under an orbiting camera',
    description: 'A static grid of 2,000 boxes in 40 writer layers of 50, all in view while the camera orbits it at 90 degrees a second for 10 seconds.',
    size: ORBIT.size, camera: 'cam', transport: { span: '10s' }, layers, items,
    channels: { spin: { target: 'items/cam/params/orbit/azimuth', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '10s', value: 900, interp: 'linear' } } } },
  };
}

// ---------------------------------------------------------------------------------------------------
// deep-show (#393): the scenario's world, the evidence store, the window.

export interface ShowRun { replies: JsonObject[]; stderr: string }
export function showLines(bin: string, sub: 'run' | 'screen', inputs: JsonValue[], env: NodeJS.ProcessEnv = {}): { lines: JsonValue[]; stderr: string } {
  const s = start(bin, [sub], inputs, env, 600_000);
  const name = `${SHOW_BIN} ${sub}`;
  expect(s.timedOut, `${name} finished within its timeout`).toBe(false);
  expect(s.status, `${name} exited 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-3000)}`).toBe(0);
  expect(s.lines.length, `${name}: one output line per input line`).toBe(inputs.length);
  return { lines: s.lines, stderr: s.stderr };
}
export function showRun(bin: string, scenario: JsonObject, env: NodeJS.ProcessEnv = {}): ShowRun {
  const { lines, stderr } = showLines(bin, 'run', [scenario], env);
  const out = obj(lines[0], `${SHOW_BIN} run: the answer`);
  expect(out['ok'], `${SHOW_BIN} run refused the scenario: ${JSON.stringify(out).slice(0, 2000)}`).toBe(true);
  const replies = arr(out['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(arr(scenario['calls'], 'the scenario\'s calls').length);
  return { replies, stderr };
}
export interface ShowScreen { image: Image; replies: JsonObject[]; items: { id: string; box: [number, number, number, number] }[]; stderr: string }
export function showScreen(bin: string, scenario: JsonObject, png: string, env: NodeJS.ProcessEnv = {}): ShowScreen {
  requireGpu();
  const { lines, stderr } = showLines(bin, 'screen', [{ ...scenario, out: png }], env);
  const answer = obj(lines[0], `${SHOW_BIN} screen: the answer`);
  if (answer['ok'] !== true && answer['code'] === 'unsupported_platform') expect.fail(`INCONCLUSIVE: ${SHOW_BIN} screen reports unsupported_platform; this is not a pass`);
  expect(answer['ok'], `${SHOW_BIN} screen refused: ${JSON.stringify(answer).slice(0, 2000)}`).toBe(true);
  const image = decodePng(readFileSync(png));
  const items = arr(answer['items'], 'screen: items').map((v, i) => {
    const o = obj(v, `screen: items[${i}]`);
    return { id: str(o['id'], `screen: items[${i}].id`), box: arr(o['box'], `screen: items[${i}].box`).map((n) => num(n, 'a box number')) as [number, number, number, number] };
  });
  return { image, replies: arr(answer['replies'], 'screen: replies').map((r, i) => obj(r, `screen: replies[${i}]`)), items, stderr };
}

/** Every dynamic library a process loaded, from dyld's DYLD_PRINT_LIBRARIES lines on its stderr. */
export const DYLD_ENV: NodeJS.ProcessEnv = { DYLD_PRINT_LIBRARIES: '1' };
export function loadedLibraries(stderr: string): string[] {
  return stderr.split('\n').flatMap((l) => { const m = /^dyld\[\d+\]: (?:<[0-9A-F-]+> )?(\/.+)$/.exec(l); return m ? [m[1]!] : []; });
}
/** Web engines by the library a web view loads: WebKit (WKWebView), its engine parts, Chromium's embedders. */
const WEB_ENGINES = /\/(WebKit|WebKitLegacy|WebCore|JavaScriptCore|Chromium Embedded Framework|Electron Framework)\.framework\/|\/lib(cef|webkit2gtk[^/]*|javascriptcoregtk[^/]*|WebView2Loader)\.(dylib|so|dll)/;
/** Criterion 1's runtime check: the process loaded no web engine; each problem names the library. */
export function webEngineProblems(libraries: string[], what: string): string[] {
  const problems = libraries.filter((l) => WEB_ENGINES.test(l)).map((l) => `${what} loaded the web engine ${l}`);
  if (libraries.length < 20) problems.push(`${what}: dyld reported only ${libraries.length} libraries, so the process's loads weren't seen`);
  return problems;
}
