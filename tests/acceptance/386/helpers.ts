// Test-side tools for the #386 acceptance tests: `deep-gpu` (#377's binary) built per Cargo feature set and driven by
// JSON lines, with the GPU surface fields this suite adds to #378's `view3d` and #379's `live` (README: The surface
// under test); the documents and looks the scenarios draw, generated here so every item is readable; PNG and
// object-ID target reading (copied from #382's helpers, since suites don't import each other); the reference-Mac
// gate and the design's judge for timing results (copied from #379's); and this suite's own measures: PSNR, relative
// luminance, the flicker check's flash count, an outline's width from its coverage, and the ring around an item's
// silhouette. Each check a criterion's wrong program must fail returns its failures as sentences naming what failed.
// Nothing here stands in for the upscale, the sharpen, the status colors, the outlines or the meter under test.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/386 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const BIN = 'deep-gpu';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);

// ---------------------------------------------------------------------------------------------------
// The criteria's numbers and the design's names.

export const MB = 1_000_000;
/** "GPU memory stays under 256 MB per window" (MB as the design writes it: 10^6 bytes). */
export const WINDOW_CAP_BYTES = 256 * MB;
/** The upscale's two passes, as the GPU layer names them (crates/deep-gpu-layer/src/liveview.rs at the base). */
export const UPSCALE_PASS = 'surface.upscale';
export const SHARPEN_PASS = 'surface.sharpen';
/** The status passes (crates/deep-scene3d-render/src/status.rs at the base). */
export const GUARD_PASS = 'status.guard';
export const COLORS_PASS = 'status.colors';
/** The look's fail color, the clean look's (#382's fixture look repeats it). */
export const FAIL: Rgb = [0xbf, 0x23, 0x2b];

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

// ---------------------------------------------------------------------------------------------------
// The machine: macOS's Metal device for pixels and device readings, a reference Mac for budgets.

/** A test that can't be judged here fails with this, never passes: off macOS, off a reference Mac, or unsupported. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
/** The reference Macs and their built-in displays in device px (technical design: The reference Macs). */
export const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', display: [3456, 2234] as [number, number] },
  { model: 'Mac15,12', chip: 'Apple M3', display: [2560, 1664] as [number, number] },
];
export function machineModel(): string | null {
  if (process.platform !== 'darwin') return null;
  try { return sh('sysctl', '-n', 'hw.model'); } catch { return null; }
}
/** The GPU layer draws these pixels on macOS's Metal device, the reference platform. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these pixels on macOS's Metal device; this is ${process.platform}`);
}
/** The reference Mac this is, or INCONCLUSIVE. Power, Low Power Mode and load are not gated (the owner's rule, as #379's suite). */
export function requireReferenceMac(): (typeof REFERENCE_MACS)[number] {
  requireMetal();
  const model = machineModel();
  const mac = REFERENCE_MACS.find((m) => m.model === model);
  if (!mac) inconclusive(`not a reference Mac (Mac15,7 or Mac15,12): hw.model is ${model}`);
  return mac;
}

const marginOf = (runs: number[], limit: number): number => Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / limit);
/**
 * The design's judge for a budget (Every task carries its own budgets): five runs after warm-up, on a reference Mac;
 * PASS when all five are within the limit, FAIL when all five are over it by more than the margin (the larger of 5%
 * and their spread), else INCONCLUSIVE, which fails here with that word.
 */
export function judge(name: string, runs: number[], limit: number): void {
  requireReferenceMac();
  expect(runs.length, `${name}: five runs`).toBe(5);
  const margin = marginOf(runs, limit);
  const line = `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(line);
  if (runs.every((r) => r < limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${line}`).toBe(false);
  inconclusive(line);
}
export function p95(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]!;
}
export const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };

// ---------------------------------------------------------------------------------------------------
// Builds: `deep-gpu` per Cargo feature set, each built once per file and kept under its own name.

/** `default` is the shipped build; `test-meter` is #379's, which adds the counting allocator's `allocs` report. */
export type Build = 'default' | 'test-meter';
const featuresOf = (build: Build): string[] => (build === 'default' ? [] : [build]);

function cargoBuild(features: string[]): string {
  const args = ['build', '--locked', '--bin', BIN, ...(features.length ? ['--features', features.join(',')] : [])];
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' } });
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
    dir = mkdtempSync(join(tmpdir(), 'deep-386-bins-'));
    for (const build of builds) {
      if (made.has(build)) continue;
      const error = cargoBuild(featuresOf(build));
      const bin = join(dir, `${BIN}-${build}`);
      if (error === '') copyFileSync(join(REPO, 'target', 'debug', exe(BIN)), bin);
      made.set(build, { bin, error });
    }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(build: Build = 'default'): string {
      const entry = made.get(build);
      if (!entry) throw Error(`the file didn't list the build ${build} in useBuilds`);
      expect(entry.error, `the binary builds: cargo build --locked --bin ${BIN}${featuresOf(build).length ? ` --features ${featuresOf(build).join(',')}` : ''}`).toBe('');
      return entry.bin;
    },
  };
}

/** A fresh output folder per test (documents, targets), deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-386-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one scenario per line in, one line out (#377).

/**
 * The wrong programs this suite reaches, each only through `--planted` (README: Planted programs); the last is
 * #379's, reused.
 */
export type Planted =
  | 'bilinear_only' | 'upscale_reads_previous_frame' | 'exports_live_surface' | 'slow_upscale'
  | 'status_before_upscale' | 'status_without_depth' | 'outlines_before_upscale'
  | 'allocates_per_frame';
export interface Startup { planted?: Planted }
export const startArgs = (s: Startup = {}): string[] => ['run', ...(s.planted ? ['--planted', s.planted] : [])];

export interface Started { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string; ms: number }
export function start(bin: string, args: string[], inputs: (JsonValue | string)[], timeoutMs = 3_600_000): Started {
  const text = inputs.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n');
  const began = performance.now();
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(bin, args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const ms = performance.now() - began;
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${bin} ${args.join(' ')}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  const lines = stdout.split('\n').filter((line) => line !== '').map((line) => {
    try { return JSON.parse(line) as JsonValue; } catch { return line; }
  });
  return { status: run.status, signal: run.signal, timedOut, lines, stdout, stderr: run.stderr ?? '', ms };
}

/** One scenario `{out, calls}`, accepted, with one reply per call. */
export function run(bin: string, out: string, calls: JsonObject[], startup: Startup = {}, timeoutMs?: number): JsonObject[] {
  const args = startArgs(startup);
  const s = start(bin, args, [{ out, calls }], timeoutMs);
  const name = `${BIN} ${args.join(' ')}`;
  expect(s.timedOut, `${name} finished within its timeout`).toBe(false);
  expect(s.status, `${name} exited 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-3000)}`).toBe(0);
  expect(s.lines.length, `${name}: one output line per input line`).toBe(1);
  const answer = obj(s.lines[0], `${name}: the answer`);
  expect(answer['ok'], `${name} refused the scenario: ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(calls.length);
  return replies;
}
export const run1 = (bin: string, out: string, call: JsonObject, startup: Startup = {}, timeoutMs?: number): JsonObject =>
  run(bin, out, [call], startup, timeoutMs)[0]!;

/** A reply the binary answered, not refused (any `code`); INCONCLUSIVE when it says the platform can't draw it. */
export function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} answered unsupported_platform`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  return reply;
}

// ---------------------------------------------------------------------------------------------------
// Color and images

export type Rgb = [number, number, number];
export const hex = (c: Rgb): string => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
export function fromHex(h: string): Rgb {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h);
  if (!m) throw Error(`${h} is not #rrggbb`);
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}
const decode = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
/** Each 8-bit sRGB code's linear value. */
export const LINEAR = Float64Array.from({ length: 256 }, (_, i) => decode(i / 255));
/** Relative luminance (linear, WCAG's, the flicker check's) of an 8-bit sRGB color. */
export const luminance = (c: Rgb): number => 0.2126 * LINEAR[c[0]]! + 0.7152 * LINEAR[c[1]]! + 0.0722 * LINEAR[c[2]]!;

/** Björn Ottosson's OKLab of an 8-bit sRGB color (his published matrices). */
export function oklab8(c: Rgb): Rgb {
  const [r, g, b] = [LINEAR[c[0]]!, LINEAR[c[1]]!, LINEAR[c[2]]!];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
export const deltaEOk = (a: Rgb, b: Rgb): number => { const p = oklab8(a); const q = oklab8(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };

export interface Image { width: number; height: number; /** RGBA, row-major. */ rgba: Uint8Array }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** Reads an 8-bit RGB or RGBA PNG with no interlace; `channels` is the file's own (3 or 4). */
export function decodePng(file: Buffer): Image & { channels: number } {
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
  return { width, height, rgba, channels };
}
function readNamed(out: string, hash: string | null, ext: string, what: string): Buffer {
  expect(hash, `${what} is written`).not.toBeNull();
  expect(hash, `${what} is named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${hash}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}
export const readPng = (out: string, hash: string | null, what: string): Image => decodePng(readNamed(out, hash, 'png', what));
export function pixel(image: Image, x: number, y: number): Rgb {
  const o = (y * image.width + x) * 4;
  return [image.rgba[o]!, image.rgba[o + 1]!, image.rgba[o + 2]!];
}
/** The slot's bytes as `pixel_hash` hashes them (#377's): BGRA8, rows top-down, no padding. */
export function slotHashOf(image: Image): string {
  const bgra = Buffer.alloc(image.rgba.length);
  for (let i = 0; i < image.rgba.length; i += 4) { bgra[i] = image.rgba[i + 2]!; bgra[i + 1] = image.rgba[i + 1]!; bgra[i + 2] = image.rgba[i]!; bgra[i + 3] = image.rgba[i + 3]!; }
  return sha256(bgra);
}
/** Each pixel's relative luminance. */
export function lumaOf(image: Image): Float32Array {
  const out = new Float32Array(image.width * image.height);
  for (let i = 0; i < out.length; i++) out[i] = luminance([image.rgba[i * 4]!, image.rgba[i * 4 + 1]!, image.rgba[i * 4 + 2]!]);
  return out;
}
/** PSNR in dB of `test` against `reference` over every pixel's R, G and B (8-bit, peak 255); Infinity when they're equal. */
export function psnr(reference: Image, test: Image): number {
  expect([test.width, test.height], 'the two frames are the same size').toEqual([reference.width, reference.height]);
  let sum = 0;
  for (let i = 0; i < reference.rgba.length; i += 4) {
    for (let c = 0; c < 3; c++) { const d = reference.rgba[i + c]! - test.rgba[i + c]!; sum += d * d; }
  }
  const mse = sum / (reference.width * reference.height * 3);
  return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
}

/** The object-ID target (#378's): an 8-bit RGBA PNG whose pixel holds pick ID r + 2^8 g + 2^16 b + 2^24 a (0: nothing drawn). */
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
    const id = pick === 0 ? null : f.picks!.get(pick) ?? null;
    items[i] = id;
    if (id) count.set(id, (count.get(id) ?? 0) + 1);
  }
  return { width: png.width, height: png.height, count, at: (x, y) => (x < 0 || y < 0 || x >= png.width || y >= png.height ? null : items[Math.floor(y) * png.width + Math.floor(x)]!) };
}

// ---------------------------------------------------------------------------------------------------
// Looks

const FONTS: JsonObject = {
  body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
};
/** The clean look's status map (crates/deep-canvas-marks/looks/clean.json at the base, as #382's suite has it). */
export const STATUS: Record<string, string> = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };

/** A physical-basis `look@1` for a 3D writer layer: tone map none at the exposure whose scale is 1, the finish at identity. */
function look(id: string, basis: 'physical' | 'drawing', palette: Record<string, string>, roles: Record<string, string>, status: boolean): JsonObject {
  return {
    id, format: 1, basis, license: 'Apache-2.0', description: `The #386 acceptance look ${id}.`,
    palette, roles, themes: { light: {}, dark: {} }, fonts: FONTS,
    tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ground_3d: { kind: 'none' },
    ...(status ? {
      status: { ...STATUS }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: 0.1,
      attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
    } : {}),
  };
}
/** C1 and C2: dark ink on a light ground, no status map. */
export const PLAIN_LOOK = look('plain-386', 'physical', { paper: '#f7f6f2', ink: '#16181d', slate: '#8b8f97', teal: '#2a7f86' }, { ground: 'paper', ink: 'ink', muted: 'slate', accent: 'teal' }, false);
/** C3: the clean status map; the buildings in light roles far from every status color, on a night ground. */
export const STATUS_LOOK = look('status-386', 'physical',
  { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', stone: '#d9dde3', sand: '#e6d3a3', floor: '#c8ccd2' },
  { ground: 'night', ink: 'graphite', muted: 'slate', tower: 'stone', hall: 'sand', floor: 'floor' }, true);
/** C4: an ink look (as the shipped `drawing_ink` is: drawing basis, no tone map), ink strokes on paper. */
export const INK: Rgb = [0x14, 0x14, 0x18];
export const INK_LOOK = look('ink-386', 'drawing', { paper: '#f4f1e8', ink: hex(INK) }, { ground: 'paper', paper: 'paper', ink: 'ink' }, false);

// ---------------------------------------------------------------------------------------------------
// Documents. view3d takes #378's shape (an `id`, writer layers, each item in a layer); a `live` session takes the
// writer's payload (#393's deep_show document: no `id`, no `layers`, no item `layer`), made by `payload`.

export const WRITER = 'agent-a';
export const LIVE_WRITER = 'agent:alpha';
const box = (id: string, order: string, size: [number, number, number], pos: [number, number, number], paint: JsonObject, name: string): JsonObject =>
  ({ id, kind: 'mark.box@1', name, order, layer: 'main', params: { size, paint }, at: { pos } });
function envelope(id: string, title: string, description: string, size: [number, number], span: string, items: JsonObject, extra: JsonObject = {}): JsonObject {
  return {
    format: 1, id, profile: 'scene', title, description, size, camera: 'cam', transport: { span },
    requires: { modules: { scene3d: '^1' } }, layers: { main: { writer: WRITER, title: 'Main', order: 'a0' } }, items, ...extra,
  };
}
const linear = (target: string, from: number, to: number, span: string): JsonObject =>
  ({ target, type: 'f32', keys: { k0: { t: '0s', value: from, interp: 'linear' }, k1: { t: span, value: to, interp: 'linear' } } });

/** C1's frame size: 1080p. */
export const HD: [number, number] = [1920, 1080];
const WORDS = ['Throughput', 'Latency p95', 'Queue depth', 'Cache hits', 'Retries', 'Shard 7 lag', 'Writes/s', 'GC pause'];
/**
 * C1's frame: under an orthographic camera looking along −Z (32 m across 1920 px), 48 labels of 12 px text in ink
 * (`mark.text@1`, screen-size, facing the camera) on a 6 × 8 grid, and 24 thin diagonal lines in ink, 2 device px wide
 * (wider than the 1 px that the issue's scope draws after the upscale, so they pass through it), at angles from 15°
 * to 75°. Label `t-00` and line `l-00` move by channels over the 2 s span, so frames differ and a seek is a seek.
 */
export function typeDoc(): JsonObject {
  const items: JsonObject = {
    cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', layer: 'main', params: { projection: 'orthographic', target: [0, 0, 0], orbit: { azimuth: 0, elevation: 0, distance: 20 }, view_width: 32 } },
  };
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 6; c++) {
      const id = `t-${r}${c}`;
      items[id] = {
        id, kind: 'mark.text@1', name: `Label ${r}.${c}`, order: `b${r}${c}`, layer: 'main',
        params: { text: `${WORDS[(r + c) % WORDS.length]} ${(r * 37 + c * 11) % 100}.${(r + c) % 10} ms`, size: 12, font: 'body', paint: { fill: { role: 'ink' } } },
        at: { pos: [-13.5 + c * 5.4, 7.2 - r * 2.05, 0] },
      };
    }
  }
  for (let i = 0; i < 24; i++) {
    const id = `l-${String(i).padStart(2, '0')}`;
    const angle = ((15 + (i * 60) / 23) * Math.PI) / 180;
    const len = 4 + (i % 5);
    const x = -14 + (i % 8) * 4; const y = -6.5 + Math.floor(i / 8) * 5.5;
    const dir = i % 2 === 0 ? 1 : -1;
    items[id] = {
      id, kind: 'mark.line@1', name: `Line ${i}`, order: `c${String(i).padStart(2, '0')}`, layer: 'main',
      params: { points: [[0, 0, 0], [dir * len * Math.cos(angle), len * Math.sin(angle), 0]], width: 2, paint: { fill: { role: 'ink' } } },
      at: { pos: [x, y, 0] },
    };
  }
  return envelope('type-386', 'Labels and diagonals', 'Forty-eight 12 px labels and twenty-four thin diagonal lines, two of them moving.', HD, '2s', items, {
    channels: { slide: linear('items/l-00/at/pos/0', -14, -10, '2s'), lift: linear('items/t-00/at/pos/1', 7.2, 6.2, '2s') },
  });
}

/** The verdict handle the tower's status binding reads, and its state. */
export const VERDICT = 'verdict:01JB3860000000000000000386';
/**
 * C3's street: a tower (`tower`, 1.4 × 3 × 1.4 m) behind a hall (`hall`, 2.05 × 2.8 × 1 m) that hides its lower left half
 * from a perspective camera on +Z (azimuth 0, elevation 12°), on a floor slab, under a sun shining along −Z. With
 * `binding`, the tower's stroke slot is bound to the verdict: a 3D object's status binding drawn as an outline around
 * it (Status binding). Without `hall`, the same street with the hall left out.
 */
export const STREET: [number, number] = [960, 540];
export function streetDoc(opts: { hall: boolean; binding: boolean }): JsonObject {
  const items: JsonObject = {
    cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', layer: 'main', params: { projection: 'perspective', target: [0, 1.2, 0], orbit: { azimuth: 0, elevation: 12, distance: 11 }, fov: 40, near: 0.1 } },
    floor: box('floor', 'a1', [14, 0.1, 14], [0, -0.05, 0], { fill: { role: 'floor' } }, 'Floor'),
    tower: box('tower', 'a2', [1.4, 3, 1.4], [0.7, 1.5, -1.5], { fill: { role: 'tower' } }, 'Tower'),
    sun: { id: 'sun', kind: 'light.sun@1', name: 'Sun', order: 'a9', layer: 'main', params: { illuminance: Math.PI, shadow: false, angle: 0.53 }, at: { rot: [0, 0, 0] } },
  };
  if (opts.hall) items['hall'] = box('hall', 'a3', [2.05, 2.8, 1], [-0.375, 1.4, 1.2], { fill: { role: 'hall' } }, 'Hall');
  const doc = envelope(`street-386-${opts.hall ? 'hall' : 'open'}`, 'A tower behind a hall', 'A tower whose lower left half a nearer hall hides.', STREET, '1s', items);
  if (opts.binding) doc['status_bindings'] = { 'b-tower': { target: 'items/tower/params/paint/stroke', source: VERDICT } };
  return doc;
}

/** C4's view: 960 × 540 px. */
export const CUBE_VIEW: [number, number] = [960, 540];
export const ORBIT = { frames: 120, fps: 60, from: 30, degPerSecond: 10 };
/**
 * C4's cube: a 1.6 m paper cube (`cube`) with, when `outline`, its 1 px ink outline (its stroke slot, `paint.stroke
 * {role: ink, width: 1}`: a 3D object's stroke is drawn as an outline around it), under a perspective camera whose
 * azimuth a linear channel turns at 10° a second (30° at t 0, 50° at t 2 s); no sun.
 */
export function cubeDoc(outline: boolean): JsonObject {
  const paint: JsonObject = { fill: { role: 'paper' }, ...(outline ? { stroke: { role: 'ink', width: 1 } } : {}) };
  const items: JsonObject = {
    cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', layer: 'main', params: { projection: 'perspective', target: [0, 0.8, 0], orbit: { azimuth: ORBIT.from, elevation: 25, distance: 8 }, fov: 40, near: 0.1 } },
    cube: box('cube', 'a1', [1.6, 1.6, 1.6], [0, 0.8, 0], paint, 'Cube'),
  };
  return envelope(`cube-386-${outline ? 'inked' : 'bare'}`, 'An inked cube', 'A paper cube with a 1 px ink outline under a camera orbiting at 10 degrees a second.', CUBE_VIEW, '2s', items, {
    channels: { orbit: linear('items/cam/params/orbit/azimuth', ORBIT.from, ORBIT.from + (ORBIT.degPerSecond * 2), '2s') },
  });
}

/**
 * C2's 10,000-item document: a 100 × 100 grid of 1 m boxes (`b-0000` … `b-9999`) on a 1.5 m pitch under a perspective
 * camera (elevation 50°, distance 190 m) whose azimuth a channel turns at 10° a second, box `b-0000` sliding along x,
 * so every frame evaluates and draws.
 */
export function cityDoc(n = 10_000): JsonObject {
  const items: JsonObject = {
    cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', layer: 'main', params: { projection: 'perspective', target: [0, 0, 0], orbit: { azimuth: 30, elevation: 50, distance: 190 }, fov: 40 } },
  };
  const side = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i++) {
    const id = `b-${String(i).padStart(4, '0')}`;
    items[id] = box(id, `b${String(i).padStart(5, '0')}`, [1, 1 + (i % 7) * 0.5, 1], [((i % side) - side / 2) * 1.5, 0.5, (Math.floor(i / side) - side / 2) * 1.5], { fill: { role: i % 3 === 0 ? 'accent' : 'muted' } }, `Box ${i}`);
  }
  return envelope('city-386', 'Ten thousand boxes', 'A 100 by 100 grid of boxes under an orbiting camera, one box sliding.', HD, '60s', items, {
    channels: { orbit: linear('items/cam/params/orbit/azimuth', 30, 630, '60s'), slide: linear('items/b-0000/at/pos/0', -75, 75, '60s') },
  });
}

/** The writer's payload of a view3d document, as a `live` session takes it, in budget class `cls`. */
export function payload(doc: JsonObject, cls: string): JsonObject {
  const out = clone(doc);
  delete out['id'];
  delete out['layers'];
  for (const item of Object.values(obj(out['items'], 'items'))) delete (item as JsonObject)['layer'];
  out['budget'] = { class: cls };
  return out;
}

/** Writes `value` as JSON under `dir` and returns its absolute path. */
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

// ---------------------------------------------------------------------------------------------------
// The GPU surface fields (README: The surface under test): `surface` on a view3d call and on a live session.

export type Upscale = 'edge_adaptive' | 'bilinear';
export interface SurfaceSpec { internal_scale: number; upscale?: Upscale; sharpen?: number }
export interface SurfaceReport { internal_scale: number; upscale: string; sharpen: number; size_px: [number, number]; internal_px: [number, number] }
function pairOf(v: JsonValue | undefined, what: string): [number, number] {
  const a = arr(v, what);
  expect(a.length, `${what} is [w, h]`).toBe(2);
  return [num(a[0], `${what}[0]`), num(a[1], `${what}[1]`)];
}
/** A view3d reply's `surface`: what the view drew at. */
export function surfaceOf(reply: JsonObject, what: string): SurfaceReport {
  const s = obj(reply['surface'], `${what}: surface (the GPU surface the view drew through)`);
  return {
    internal_scale: num(s['internal_scale'], `${what}: surface.internal_scale`), upscale: str(s['upscale'], `${what}: surface.upscale`),
    sharpen: num(s['sharpen'], `${what}: surface.sharpen`), size_px: pairOf(s['size_px'], `${what}: surface.size_px`), internal_px: pairOf(s['internal_px'], `${what}: surface.internal_px`),
  };
}
/** The view drew at `want` on a view of `size`: its internal size, its upscale (none at scale 1) and its sharpen. */
export function surfaceProblems(got: SurfaceReport, want: SurfaceSpec, size: [number, number], what: string): string[] {
  const out: string[] = [];
  if (got.internal_scale !== want.internal_scale) out.push(`${what}: drew at internal scale ${got.internal_scale}, not ${want.internal_scale}`);
  if (got.size_px[0] !== size[0] || got.size_px[1] !== size[1]) out.push(`${what}: its slots are ${got.size_px.join(' × ')}, not ${size.join(' × ')}`);
  for (const k of [0, 1] as const) {
    if (Math.abs(got.internal_px[k] - size[k] * want.internal_scale) > 1) out.push(`${what}: its internal size is ${got.internal_px.join(' × ')}, not ${size[0] * want.internal_scale} × ${size[1] * want.internal_scale} within 1 px`);
  }
  const upscale = want.internal_scale < 1 ? want.upscale ?? 'edge_adaptive' : 'none';
  if (got.upscale !== upscale) out.push(`${what}: upscaled by ${got.upscale}, not ${upscale}`);
  if (want.internal_scale < 1 && upscale === 'edge_adaptive' && Math.abs(got.sharpen - (want.sharpen ?? 0.2)) > 1e-9) out.push(`${what}: sharpened by ${got.sharpen}, not ${want.sharpen ?? 0.2}`);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// view3d (#378's call, with #380's and #382's fields and this suite's `surface`)

export interface View3d {
  doc: string; look: JsonObject; size: [number, number]; frames?: number; fps?: number; from?: number;
  capture?: 'every' | number[]; targets?: ('final' | 'ids')[]; surface?: SurfaceSpec; states?: Record<string, string>;
}
export const view3dCall = (v: View3d): JsonObject => ({ call: 'view3d', ...(v as unknown as JsonObject) });

export interface ViewFrame { frame: number; pixel_hash: string | null; final: string | null; ids: string | null; picks: Map<number, string> | null }
const optStr = (v: JsonValue | undefined, what: string): string | null => (v === undefined || v === null ? null : str(v, what));
export function framesOf(reply: JsonObject, what: string): ViewFrame[] {
  return arr(reply['frames'], `${what}: frames`).map((v, i): ViewFrame => {
    const f = obj(v, `${what}: frames[${i}]`); const at = `${what}: frames[${i}]`;
    let picks: Map<number, string> | null = null;
    if (isObject(f['picks'])) picks = new Map(Object.entries(f['picks']).map(([k, id]) => [Number(k), str(id, `${at}.picks[${k}]`)]));
    return { frame: num(f['frame'], `${at}.frame`), pixel_hash: optStr(f['pixel_hash'], `${at}.pixel_hash`), final: optStr(f['final'], `${at}.final`), ids: optStr(f['ids'], `${at}.ids`), picks };
  });
}
export function frameAt(frames: ViewFrame[], n: number, what: string): ViewFrame {
  const f = frames.find((x) => x.frame === n);
  expect(f, `${what}: frame ${n} is in the reply (frames ${frames.map((x) => x.frame).slice(0, 20).join(', ')})`).toBeDefined();
  return f!;
}
export interface PassRow { name: string; reads: string[]; writes: string[] }
/** A view3d reply's `passes`: the frame's passes in order, each with the targets it reads and writes. */
export function passesOf(reply: JsonObject, what: string): PassRow[] {
  return arr(reply['passes'], `${what}: passes`).map((p, i) => {
    const o = obj(p, `${what}: passes[${i}]`);
    return {
      name: str(o['name'], `${what}: passes[${i}].name`),
      reads: arr(o['reads'] ?? [], `${what}: passes[${i}].reads`).map((r) => str(r, 'a target read')),
      writes: arr(o['writes'] ?? [], `${what}: passes[${i}].writes`).map((r) => str(r, 'a target written')),
    };
  });
}
export interface Mark { item: string; slot: string; state: string; color: Rgb }
export interface StatusReport { marks: Mark[]; boxes: [number, number, number, number][] }
/** A view3d reply's status marks (#382's report) and the boxes its legend and mark labels own, which aren't the outline's. */
export function statusOf(reply: JsonObject, what: string): StatusReport {
  const s = obj(reply['status'], `${what}: status`);
  const boxOf = (v: JsonValue | undefined, w: string): [number, number, number, number] => {
    const a = arr(v, w); expect(a.length, `${w} is [x, y, w, h]`).toBe(4);
    return a.map((x, i) => num(x, `${w}[${i}]`)) as [number, number, number, number];
  };
  const boxes: [number, number, number, number][] = [];
  const marks = arr(s['marks'], `${what}: status.marks`).map((v, i): Mark => {
    const m = obj(v, `${what}: status.marks[${i}]`);
    if (m['label'] !== undefined && m['label'] !== null) boxes.push(boxOf(m['label'], `${what}: status.marks[${i}].label`));
    const c = arr(m['color'], `${what}: status.marks[${i}].color`).map((x) => num(x, 'a color channel'));
    return { item: str(m['item'], `${what}: status.marks[${i}].item`), slot: str(m['slot'], `${what}: status.marks[${i}].slot`), state: str(m['state'], `${what}: status.marks[${i}].state`), color: c as Rgb };
  });
  for (const [i, v] of arr(s['legend'] ?? [], `${what}: status.legend`).entries()) {
    const e = obj(v, `${what}: status.legend[${i}]`);
    boxes.push(boxOf(e['swatch'], `${what}: status.legend[${i}].swatch`), boxOf(e['label'], `${what}: status.legend[${i}].label`));
  }
  return { marks, boxes };
}

// ---------------------------------------------------------------------------------------------------
// live (#379's call, with this suite's `surface` on a session)

export interface Open { session: string; writer: string; doc: string; size?: [number, number]; surface?: SurfaceSpec }
export type LiveEvent = { frame: number; canonical: { session: string; purpose: 'render_back' | 'export' | 'frame_budget'; frame: number; size: [number, number] } };
export interface LiveSpec { look: JsonObject; frames: number; fps?: number; sessions: Open[]; events?: LiveEvent[]; report?: ('passes' | 'hashes' | 'memory' | 'allocs')[] }
export const liveCall = (spec: LiveSpec): JsonObject => ({ call: 'live', ...(spec as unknown as JsonObject) });

export interface LiveView { session: string; rung: string; drawn: boolean; internal_scale: number; upscale: string | null }
export interface LivePass { name: string; source: string; start_ns: number; end_ns: number }
export interface LiveFrame { frame: number; cpu_ms: number; views: LiveView[]; passes: LivePass[] | null; allocs: number | null; device_bytes: number | null }
export interface LiveCanonical { frame: number; purpose: string; pixel_hash: string | null; rung: string; internal_scale: number; upscale: string | null }
export interface LiveRevision { rev: number; outcome: string; check_ms: number | null }
export interface Live { frames: LiveFrame[]; canonicals: LiveCanonical[]; sessions: { session: string; state: string; revisions: LiveRevision[] }[]; device_before: number | null }
export function canonicalOf(o: JsonObject, at: string): LiveCanonical {
  answered(o, at);
  return {
    frame: num(o['frame'], `${at}.frame`), purpose: str(o['purpose'], `${at}.purpose`), pixel_hash: optStr(o['pixel_hash'], `${at}.pixel_hash`),
    rung: str(o['rung'], `${at}.rung`), internal_scale: num(o['internal_scale'], `${at}.internal_scale`), upscale: optStr(o['upscale'], `${at}.upscale`),
  };
}
/** Parses a `live` reply, failing at the first missing or mistyped field it reads. */
export function liveOf(reply: JsonObject, what = 'the live call'): Live {
  answered(reply, what);
  const frames = arr(reply['frames'], `${what}: frames`).map((f, i): LiveFrame => {
    const o = obj(f, `${what}: frames[${i}]`); const at = `${what}: frame ${o['frame']}`;
    return {
      frame: num(o['frame'], `${what}: frames[${i}].frame`), cpu_ms: num(o['cpu_ms'], `${at}: cpu_ms`),
      views: arr(o['views'], `${at}: views`).map((v, j) => {
        const w = obj(v, `${at}: views[${j}]`);
        return { session: str(w['session'], `${at}: views[${j}].session`), rung: str(w['rung'], `${at}: views[${j}].rung`), drawn: w['drawn'] === true, internal_scale: num(w['internal_scale'], `${at}: views[${j}].internal_scale`), upscale: optStr(w['upscale'], `${at}: views[${j}].upscale`) };
      }),
      passes: o['passes'] === undefined ? null : arr(o['passes'], `${at}: passes`).map((p, j) => {
        const q = obj(p, `${at}: passes[${j}]`);
        return { name: str(q['name'], `${at}: passes[${j}].name`), source: str(q['source'], `${at}: passes[${j}].source`), start_ns: num(q['start_ns'], `${at}: passes[${j}].start_ns`), end_ns: num(q['end_ns'], `${at}: passes[${j}].end_ns`) };
      }),
      allocs: o['allocs'] === undefined ? null : num(o['allocs'], `${at}: allocs`),
      device_bytes: o['device_bytes'] === undefined || o['device_bytes'] === null ? null : num(o['device_bytes'], `${at}: device_bytes`),
    };
  });
  const canonicals = arr(reply['canonicals'] ?? [], `${what}: canonicals`).map((c, i) => canonicalOf(obj(c, `${what}: canonicals[${i}]`), `${what}: canonicals[${i}]`));
  const sessions = arr(reply['sessions'], `${what}: sessions`).map((s, i) => {
    const o = obj(s, `${what}: sessions[${i}]`);
    return {
      session: str(o['session'], `${what}: sessions[${i}].session`), state: str(o['state'], `${what}: sessions[${i}].state`),
      revisions: arr(o['revisions'], `${what}: sessions[${i}].revisions`).map((r, j) => {
        const q = obj(r, `${what}: sessions[${i}].revisions[${j}]`);
        return { rev: num(q['rev'], 'rev'), outcome: str(q['outcome'], 'outcome'), check_ms: q['check_ms'] === undefined || q['check_ms'] === null ? null : num(q['check_ms'], `${what}: sessions[${i}].revisions[${j}].check_ms`) };
      }),
    };
  });
  return { frames, canonicals, sessions, device_before: reply['device_before'] === undefined || reply['device_before'] === null ? null : num(reply['device_before'], `${what}: device_before`) };
}
/** Every frame drew `session` at `want` (its internal scale and upscale as the frame reports them): one sentence per frame that didn't, at most five. */
export function liveSurfaceProblems(live: Live, session: string, want: SurfaceSpec): string[] {
  const out: string[] = [];
  const upscale = want.internal_scale < 1 ? want.upscale ?? 'edge_adaptive' : 'none';
  for (const f of live.frames) {
    const v = f.views.find((x) => x.session === session);
    if (!v) out.push(`frame ${f.frame}: no view of ${session}`);
    else if (!v.drawn) out.push(`frame ${f.frame}: ${session} wasn't drawn`);
    else if (v.internal_scale !== want.internal_scale || v.upscale !== upscale) out.push(`frame ${f.frame}: ${session} drew at internal scale ${v.internal_scale} upscaled by ${v.upscale}, not ${want.internal_scale} by ${upscale}`);
    if (out.length >= 5) break;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The measures

/** Pixels within `r` px (Chebyshev) of a pixel where `inside` holds and of one where it doesn't: the band along the region's edge. */
export function band(width: number, height: number, inside: (x: number, y: number) => boolean, r: number): Uint8Array {
  const inMask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) inMask[y * width + x] = inside(x, y) ? 1 : 0;
  const edge = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const v = inMask[y * width + x]!;
    const differs = (x > 0 && inMask[y * width + x - 1] !== v) || (x + 1 < width && inMask[y * width + x + 1] !== v) || (y > 0 && inMask[(y - 1) * width + x] !== v) || (y + 1 < height && inMask[(y + 1) * width + x] !== v);
    if (differs && v === 1) edge[y * width + x] = 1;
  }
  return grow(edge, width, height, r);
}
/** The mask grown by `r` px (Chebyshev). */
export function grow(mask: Uint8Array, width: number, height: number, r: number): Uint8Array {
  const rows = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    let last = -Infinity;
    for (let x = 0; x < width; x++) { if (mask[y * width + x]) last = x; if (x - last <= r) rows[y * width + x] = 1; }
    last = Infinity;
    for (let x = width - 1; x >= 0; x--) { if (mask[y * width + x]) last = x; if (last - x <= r) rows[y * width + x] = 1; }
  }
  const out = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) {
    let last = -Infinity;
    for (let y = 0; y < height; y++) { if (rows[y * width + x]) last = y; if (y - last <= r) out[y * width + x] = 1; }
    last = Infinity;
    for (let y = height - 1; y >= 0; y--) { if (rows[y * width + x]) last = y; if (last - y <= r) out[y * width + x] = 1; }
  }
  return out;
}
/** The perimeter, in px, of the convex hull of the pixels where `inside` holds (each pixel's four corners). */
export function hullPerimeter(width: number, height: number, inside: (x: number, y: number) => boolean): number {
  const pts: [number, number][] = [];
  for (let y = 0; y < height; y++) {
    let first = -1; let last = -1;
    for (let x = 0; x < width; x++) if (inside(x, y)) { if (first < 0) first = x; last = x; }
    if (first >= 0) pts.push([first, y], [first, y + 1], [last + 1, y], [last + 1, y + 1]);
  }
  if (pts.length < 3) return 0;
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = []; const upper: [number, number][] = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop(); lower.push(p); }
  for (const p of [...pts].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop(); upper.push(p); }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  let perimeter = 0;
  for (let i = 0; i < hull.length; i++) { const a = hull[i]!; const b = hull[(i + 1) % hull.length]!; perimeter += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  return perimeter;
}
/**
 * An outline's area in px from its coverage: each pixel's share of ink, read against the same frame drawn without the
 * outline, (Y_bare − Y_inked) ÷ (Y_bare − Y_ink), clamped to [0, 1], summed (pixels whose bare luminance is within 0.05
 * of the ink's can't be read and count 0). Divided by the silhouette's length, it is the outline's width in device px.
 */
export function inkArea(bare: Image, inked: Image, inkY: number): number {
  expect([inked.width, inked.height], 'the inked and bare frames are the same size').toEqual([bare.width, bare.height]);
  let area = 0;
  for (let i = 0; i < bare.width * bare.height; i++) {
    const o = i * 4;
    const yb = luminance([bare.rgba[o]!, bare.rgba[o + 1]!, bare.rgba[o + 2]!]);
    if (yb - inkY < 0.05) continue;
    const yi = luminance([inked.rgba[o]!, inked.rgba[o + 1]!, inked.rgba[o + 2]!]);
    area += Math.min(1, Math.max(0, (yb - yi) / (yb - inkY)));
  }
  return area;
}

/**
 * The flicker check's measure (Flicker check: `max_flashes` 3 per s, `area` 0.25 of the view, `luminance_delta` 0.1,
 * `darker_max` 0.80): at each pixel, a change between consecutive frames counts when its relative luminance moves by
 * more than 0.1 and the darker of the two frames is below 0.80; a flash is a pair of opposing counted changes; flashes
 * are counted in every one-second sliding window. For each window, `share` is the combined share of the view whose
 * pixels make a flash in it (the quantity the check compares with `area`), and `most` the most flashes one pixel
 * makes in it (compared with `max_flashes`). Feed frames in order; read `windows()` at the end.
 */
export class Flicker {
  private last: Float32Array | null = null;
  private sign: Int8Array;
  /** Per change frame k (1 …), the pixels that completed a flash at k. */
  private events: Int32Array[] = [];
  private frames = 0;
  constructor(private readonly width: number, private readonly height: number, private readonly fps: number) {
    this.sign = new Int8Array(width * height);
  }
  push(luma: Float32Array): void {
    expect(luma.length, 'every frame is the view\'s size').toBe(this.width * this.height);
    this.frames++;
    if (this.last) {
      const done: number[] = [];
      for (let i = 0; i < luma.length; i++) {
        const a = this.last[i]!; const b = luma[i]!; const d = b - a;
        if (Math.abs(d) <= 0.1 || Math.min(a, b) >= 0.8) continue;
        const s = d > 0 ? 1 : -1;
        if (this.sign[i] === -s) { done.push(i); this.sign[i] = 0; } else this.sign[i] = s;
      }
      this.events.push(Int32Array.from(done));
    }
    this.last = luma;
  }
  /** One row per one-second window of change frames [s, s + fps − 1], s from 1 to the last start that fits (1 for a short run). */
  windows(): { from: number; share: number; most: number }[] {
    const out: { from: number; share: number; most: number }[] = [];
    const n = this.width * this.height;
    const changes = this.events.length;
    const lastStart = Math.max(1, changes - this.fps + 1);
    const count = new Uint16Array(n);
    let flashing = 0;
    const add = (k: number, by: 1 | -1): void => {
      for (const i of this.events[k - 1] ?? []) {
        if (by > 0 && count[i] === 0) flashing++;
        count[i] = count[i]! + by;
        if (by < 0 && count[i] === 0) flashing--;
      }
    };
    for (let k = 1; k <= Math.min(this.fps, changes); k++) add(k, 1);
    for (let s = 1; s <= lastStart; s++) {
      if (s > 1) { add(s - 1, -1); if (s + this.fps - 1 <= changes) add(s + this.fps - 1, 1); }
      let most = 0;
      for (let i = 0; i < n; i++) if (count[i]! > most) most = count[i]!;
      out.push({ from: s, share: flashing / n, most });
    }
    return out;
  }
}
