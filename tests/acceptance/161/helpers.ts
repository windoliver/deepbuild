// Test-side tools for the #161 acceptance tests: the base's two binaries, built once per file and driven by JSON
// lines (`deep-gpu run [--planted <name>]`, `deep-show run`); the fx@1 pack read as the data it is; the documents and
// pictures the tests draw; PNG, f32 and APNG reading and writing; and the perf lane's judge. Nothing here stands in
// for the renderer, the operator check or the pack check: every expected value comes from the issue's numbers, from a
// published method (measures.ts) or from a second draw of the same run.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, loadavg, tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
export type JsonObject = { [k: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/161 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text (README: Criteria to tests). */
export const AC = {
  1: 'AC1 #161.66726728', 2: 'AC2 #161.2bd9eeb2', 3: 'AC3 #161.3c68daec', 4: 'AC4 #161.f2821130', 5: 'AC5 #161.8352d648',
  6: 'AC6 #161.729a03cd', 7: 'AC7 #161.01550f9e', 8: 'AC8 #161.6de2bd55', 9: 'AC9 #161.99d85364', 10: 'AC10 #161.1392976e',
  11: 'AC11 #161.8ed2354e', 12: 'AC12 #161.6c7f6fc1', 13: 'AC13 #161.2dcc0047',
} as const;
/** A criterion's bare ID, `#161.<h8>`, as budgets.json and the taste call name it. */
export const criterion = (n: keyof typeof AC): string => AC[n].split(' ')[1]!;
/** Every test and hook passes a timeout: a first cargo build on a shared Mac takes many minutes. */
export const TIMEOUT = 3_600_000;

// ---------------------------------------------------------------------------------------------------
// JSON and judging

export const shown = (v: JsonValue | undefined, most = 1500): string => JSON.stringify(v)?.slice(0, most) ?? 'undefined';
export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
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
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${shown(v)}`).toBe(true);
  return v as number;
}
export const clone = <T extends JsonValue>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** The GPU layer draws on macOS's GPU device; anywhere else a test is INCONCLUSIVE. */
export function requireGpu(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these pixels on macOS's GPU device; this is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// Builds: each binary built once per file and copied out of the target folder.

const PINNED = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
const CARGO_ENV = (): NodeJS.ProcessEnv => ({
  ...process.env, ...(existsSync(PINNED) ? { PATH: `${PINNED}${delimiter}${process.env['PATH'] ?? ''}` } : {}),
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
});
const BUILDS = {
  'deep-gpu': ['build', '--locked', '--bin', 'deep-gpu'],
  'deep-show': ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'full'],
} as const;
export type Bin = keyof typeof BUILDS;
function cargo(args: readonly string[]): string {
  const r = spawnSync('cargo', [...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: CARGO_ENV() });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${(r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(-4000)}`;
  return '';
}
/** `name`, built once for the file and copied out; the string is cargo's error when the build failed, else ''. */
export function useBin(name: Bin): () => { bin: string; error: string } {
  let dir = ''; let error = 'the build did not run';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-161-bin-'));
    error = cargo(BUILDS[name]);
    if (error === '') copyFileSync(join(process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target'), 'debug', name), join(dir, name));
  }, TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => ({ bin: join(dir, name), error });
}
export const buildLine = (name: Bin): string => `the binary builds: cargo ${BUILDS[name].join(' ')}`;
/** A fresh temporary folder per test, deleted after it. */
export function useDir(): () => string {
  const made: string[] = [];
  beforeEach(() => { made.length = 0; });
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-161-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]` (#377): one scenario `{"out", "calls"}` per line in, one line out.

/** The wrong programs this suite plants, each reachable only through `--planted` (README: Planted programs). */
export type Planted =
  | 'fx_levels_gpu_off_by_two' | 'slice_shift_seeded_by_frame' | 'invert_on_premultiplied' | 'invert_without_alpha_guard'
  | 'twirl_center_from_frame_origin' | 'blur_radius_in_device_px' | 'key_keeps_color_at_alpha_0';

/** What one process answered: its replies, or why it answered none (a refused scenario, a crash, a timeout). */
export interface Ran { replies: JsonObject[]; problem: string }
function ran(name: string, r: ReturnType<typeof spawnSync>, calls: number): Ran {
  const stdout = String(r.stdout ?? ''); const stderr = String(r.stderr ?? '');
  if (r.error) return { replies: [], problem: `${name}: ${(r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT' ? 'timed out' : r.error.message}` };
  if (r.status !== 0) return { replies: [], problem: `${name} exited ${String(r.status)} (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 600)}; stderr: ${stderr.slice(-1500)}` };
  const lines = stdout.split('\n').filter((l) => l !== '');
  if (lines.length !== 1) return { replies: [], problem: `${name}: ${lines.length} output lines for one input line` };
  let answer: JsonValue;
  try { answer = JSON.parse(lines[0]!) as JsonValue; } catch { return { replies: [], problem: `${name}: its answer is not JSON: ${lines[0]!.slice(0, 300)}` }; }
  if (!isObject(answer) || answer['ok'] !== true || !Array.isArray(answer['replies'])) return { replies: [], problem: `${name} refused the scenario: ${shown(answer, 600)}` };
  const replies = answer['replies'].filter(isObject);
  if (replies.length !== calls) return { replies: [], problem: `${name}: ${replies.length} replies for ${calls} calls` };
  return { replies, problem: '' };
}
/** One fresh `deep-gpu` process over `calls`. A scenario the binary doesn't take is a `problem`, never a throw. */
export function runGpu(bin: string, out: string, calls: JsonObject[], planted?: Planted): Ran {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const r = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 3_000_000, killSignal: 'SIGKILL' });
  return ran(`deep-gpu ${args.join(' ')}`, r, calls.length);
}
/** One fresh `deep-show run` process over a scenario (`evidence`, `packs`, `calls`). */
export function runShow(bin: string, scenario: JsonObject): Ran {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 3_000_000, killSignal: 'SIGKILL' });
  return ran('deep-show run', r, Array.isArray(scenario['calls']) ? scenario['calls'].length : 0);
}
/** Why a reply is a refusal, or '' when the call was answered. `unsupported_platform` is INCONCLUSIVE. */
export function refusal(reply: JsonObject | undefined, what: string): string {
  if (reply === undefined) return `${what}: no reply`;
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  return reply['code'] === undefined ? '' : `${what} was refused: ${shown(reply, 400)}`;
}

// ---------------------------------------------------------------------------------------------------
// Pictures: 8-bit PNG (straight alpha) and f32 files (RGBA little-endian f32, rows top-down, w × h × 16 bytes).

export type Rgba = [number, number, number, number];
export interface Image { width: number; height: number; rgba: Uint8Array }
export interface Floats { width: number; height: number; data: Float32Array }
export const px8 = (im: Image, x: number, y: number): Rgba => { const o = (y * im.width + x) * 4; return [im.rgba[o]!, im.rgba[o + 1]!, im.rgba[o + 2]!, im.rgba[o + 3]!]; };
export const fx = (im: Floats, x: number, y: number): Rgba => { const o = (y * im.width + x) * 4; return [im.data[o]!, im.data[o + 1]!, im.data[o + 2]!, im.data[o + 3]!]; };
export const inBox = (b: readonly number[], x: number, y: number): boolean => x >= b[0]! && x < b[0]! + b[2]! && y >= b[1]! && y < b[1]! + b[3]!;
export const grown = (b: readonly number[], by: number): [number, number, number, number] => [b[0]! - by, b[1]! - by, b[2]! + 2 * by, b[3]! + 2 * by];

/** A file the binary wrote under `out`, named by its SHA-256; null with the reason when it isn't there. */
export function named(out: string, hash: JsonValue | undefined, ext: string): Buffer | string {
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) return `not a SHA-256: ${shown(hash, 80)}`;
  const path = join(out, `${hash}.${ext}`);
  if (!existsSync(path)) return `no file ${hash}.${ext}`;
  const bytes = readFileSync(path);
  return sha256(bytes) === hash ? bytes : `${hash}.${ext} doesn't hash to its name`;
}
export function floatsOf(out: string, hash: JsonValue | undefined, size: readonly [number, number]): Floats | string {
  const bytes = named(out, hash, 'f32');
  if (typeof bytes === 'string') return bytes;
  if (bytes.length !== size[0] * size[1] * 16) return `the f32 file holds ${bytes.length} bytes, not ${size[0]} × ${size[1]} × 16`;
  const data = new Float32Array(bytes.length / 4);
  for (let i = 0; i < data.length; i++) data[i] = bytes.readFloatLE(i * 4);
  return { width: size[0], height: size[1], data };
}
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** An 8-bit RGB or RGBA PNG with no interlace, as RGBA. */
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(SIGNATURE)) throw Error('not a PNG');
  let at = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (at < file.length) {
    const length = file.readUInt32BE(at); const type = file.toString('latin1', at + 4, at + 8); const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}; the reader takes 8-bit RGB or RGBA, no interlace`);
  const channels = color === 6 ? 4 : 3; const stride = width * channels;
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
export function pngOf(out: string, hash: JsonValue | undefined): Image | string {
  const bytes = named(out, hash, 'png');
  if (typeof bytes === 'string') return bytes;
  try { return decodePng(bytes); } catch (e) { return (e as Error).message; }
}
function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}
/** An 8-bit RGBA PNG: what the suite hands the operator check as a texture asset. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgba.subarray(y * width * 4, (y + 1) * width * 4)).copy(raw, y * (width * 4 + 1) + 1);
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))]);
}
/** An animated PNG of equal-sized frames at `fps`, looping: the suite's recording, from the renderer's own frames. */
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
// One 10-bit code value: 1/1023 of max(1, |want|), per channel, alpha included (#429's and #431's reading).

export const codes = (got: number, want: number): number => (Number.isFinite(got) && Number.isFinite(want) ? (Math.abs(got - want) * 1023) / Math.max(1, Math.abs(want)) : got === want ? 0 : Infinity);
/** The most codes any channel of `got` is from `want`. */
export const off = (got: readonly number[], want: readonly number[]): number => Math.max(...want.map((w, i) => codes(got[i]!, w)));
export const at = (v: readonly number[]): string => `(${v.map((x) => Number(x.toFixed(4))).join(', ')})`;
/** A stable half-up rounding of one code, so 1.0000001 codes of float noise isn't a miss. */
export const ONE = 1 + 1e-3;

// OKLab (its published matrices) of an 8-bit sRGB color, for the status distance (ΔE, Euclidean in OKLab).
const decode = (c: number): number => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
export function oklab(rgb: readonly number[]): [number, number, number] {
  const [r, g, b] = [decode(rgb[0]!), decode(rgb[1]!), decode(rgb[2]!)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
export const deltaE = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

// ---------------------------------------------------------------------------------------------------
// The pack, as the data it is.

export const PACK_DIR = join(REPO, 'packs', 'fx-1.0.0');
/** The pack's ID in a hub's store and its reference in a document's `packs` (#1720's reading of a first-party pack). */
export const PACK_ID = 'deepbuild/fx';
export const PACK_REF = 'deepbuild/fx@1.0.0';
/** The issue's ten lists, each name as the issue writes it. */
export const CATEGORIES = {
  color: ['levels', 'curves', 'brightness_contrast', 'exposure', 'gamma_pedestal_gain', 'channel_mixer', 'black_white', 'tint', 'tritone', 'gradient_map', 'selective_color', 'vibrance', 'invert', 'leave_color'],
  blur: ['directional', 'radial', 'channel', 'bilateral', 'compound', 'sharpen', 'unsharp'],
  distort: ['bulge', 'twirl', 'ripple', 'wave_warp', 'polar', 'spherize', 'mirror', 'offset', 'corner_pin', 'displacement_map', 'turbulent_displace', 'lens_distort', 'magnify', 'bend', 'page_turn'],
  stylize: ['find_edges', 'emboss', 'mosaic', 'posterize', 'threshold', 'scatter', 'roughen_edges', 'motion_tile', 'kaleida', 'glass', 'cartoon'],
  generate: ['four_color_gradient', 'cell_pattern', 'checkerboard', 'light_rays', 'light_sweep', 'light_burst'],
  noise: ['noise', 'dust_scratches'],
  channel: ['set_channels', 'arithmetic', 'minimax'],
  keying: ['linear_color_key', 'color_difference_key', 'luma_key', 'spill_suppressor', 'key_light'],
  matte: ['choker'],
  transitions: ['gradient_wipe', 'radial_wipe', 'block_dissolve', 'venetian_blinds', 'light_wipe'],
} as const;
export type Category = keyof typeof CATEGORIES;
export const CATEGORY_NAMES = Object.keys(CATEGORIES) as Category[];
/** The blur list's five kinds of blur, which the issue's list names by their adjective alone. */
const BLURS = ['directional', 'radial', 'channel', 'bilateral', 'compound'];
/** An operator's ID: `fx.<the issue's name>@1`. The blur list's `directional` is the base's `fx.directional_blur@1`
 * (the issue's own "On main already" line), and the list's other four kinds of blur are named as it is: `radial` is
 * `fx.radial_blur@1`, the issue's "radial blur" (README: Readings). */
export const opId = (name: string): string => `fx.${BLURS.includes(name) ? `${name}_blur` : name}@1`;
export const SLICE_SHIFT = 'fx.slice_shift@1';
/** The 69 of the ten lists. */
export const LISTED: string[] = CATEGORY_NAMES.flatMap((c) => CATEGORIES[c].map(opId));
/** All 70: the 69 and slice_shift, in name order. */
export const ALL: string[] = [...LISTED, SLICE_SHIFT].sort();
/** The category whose fixture an operator runs on; slice_shift, in no list, runs on distort's (README: Readings). */
export function categoryOf(id: string): Category {
  return CATEGORY_NAMES.find((c) => CATEGORIES[c].some((n) => opId(n) === id)) ?? 'distort';
}
/** The pack's operators as `pack.json` holds them, by ID. */
export function packOperators(): Record<string, JsonObject> {
  const pack = JSON.parse(readFileSync(join(PACK_DIR, 'pack.json'), 'utf8')) as JsonObject;
  return isObject(pack['operators']) ? (pack['operators'] as Record<string, JsonObject>) : {};
}
/** What the pack's list is missing or holds beyond the 70; the first assertion of every test that reads the pack. */
export function listProblems(operators: Record<string, JsonObject>): string[] {
  const held = Object.keys(operators);
  return [...ALL.filter((id) => !held.includes(id)).map((id) => `the pack lacks ${id}`), ...held.filter((id) => !ALL.includes(id)).map((id) => `the pack holds ${id}, which the issue doesn't name`)];
}
/** An operator's declared cost, ns a pixel (1 ns a pixel is 1 ms a megapixel), or NaN. */
export const declared = (graph: JsonObject | undefined): number => {
  const cost = graph?.['cost'];
  return isObject(cost) && typeof cost['ns_per_px'] === 'number' ? cost['ns_per_px'] : NaN;
};
const isCoreColor = (input: JsonValue | undefined): boolean => {
  const target = isObject(input) && isObject(input['from']) && isObject(input['from']['texture']) ? input['from']['texture']['target'] : undefined;
  return isObject(target) && target['op'] === 'core' && target['output'] === 'color';
};
/** The pack's graph with every input that reads the pass's own target (`core` `color`) bound to the image `sha`
 * instead, so the operator check's step harness draws it over a picture (README: The reference harness). */
export function overAsset(graph: JsonObject, sha: string): JsonObject {
  const g = clone(graph);
  const inputs = isObject(g['inputs']) ? g['inputs'] : {};
  for (const [name, input] of Object.entries(inputs)) if (isCoreColor(input)) inputs[name] = { ...(input as JsonObject), from: { texture: sha } };
  return g;
}
/** `check_operator` (#380, #429, #431) on one graph, with its `reference` at `size` when asked. */
export const checkCall = (operator: JsonObject, extra: JsonObject = {}): JsonObject => ({ call: 'check_operator', operator, ...extra });

// ---------------------------------------------------------------------------------------------------
// Documents. Colors a float test reads come from this role map (#391's form: no status map, no tone map, unit
// exposure in a 3D writer layer), so every answer is set here.

export const ROLES: Record<string, [number, number, number]> = {
  ground: [255, 255, 255], black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 255, 0], blue: [0, 0, 255],
  ink: [24, 26, 31], accent: [26, 163, 200], plate: [90, 160, 110], amber: [230, 160, 40], violet: [130, 70, 190], sky: [150, 200, 240],
  // The 8-bit roles nearest the issue's linear values: 231 is linear 0.7991, 170 is 0.4020 and 188 is 0.5029.
  r231: [231, 0, 0], b170: [0, 0, 170], g188: [188, 188, 188],
};
export const LOOK: JsonObject = { light: ROLES };
export type Box = readonly [number, number, number, number];
export const item = (id: string, kind: string, order: string, params: JsonObject, extra: JsonObject = {}): JsonObject => ({ id, kind, layer: 'main', name: id, order, params, ...extra });
/** A rectangle filled with a role, at `opacity` (a two-stop gradient of one role, the form #430's fixtures draw). */
export function rect(id: string, order: string, box: Box, role: string, opacity = 1, extra: JsonObject = {}): JsonObject {
  const fill: JsonObject = opacity === 1 ? { role } : { gradient: { kind: 'linear', stops: [{ at: 0, role, opacity }, { at: 1, role, opacity }] } };
  return item(id, 'rect@1', order, { box: [...box], paint: { fill } }, extra);
}
export const group = (id: string, order: string, passes: JsonValue[], more: JsonObject = {}): JsonObject => item(id, 'group@1', order, { passes, isolate: true, ...more });
/** A figure document of one writer layer, naming the pack. */
export function document(id: string, size: readonly [number, number], items: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    format: 1, id, profile: 'figure', title: id, description: `${id}: a #161 acceptance fixture.`, size: [...size], transport: { span: '4s' }, seed: 161,
    requires: { modules: { effects: '^1' } }, budget: { class: 'figure' }, packs: [PACK_REF],
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a1' } }, ...extra,
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])),
  };
}
/** What makes a writer layer 3D, so its groups composite in linear light (#430's fixture): a camera, a box and a sun,
 * the box low in the frame's right corner, away from every texel a test reads. */
export function threeD(doc: JsonObject): JsonObject {
  const d = clone(doc);
  d['profile'] = 'scene'; d['camera'] = 'cam'; d['requires'] = { modules: { scene3d: '^1', effects: '^1' } };
  Object.assign(d['items'] as JsonObject, {
    cam: item('cam', 'camera@1', 'a0', { projection: 'perspective', target: [0, 0, 0], orbit: { azimuth: 30, elevation: 25, distance: 6 }, fov: 40, near: 0.1 }),
    cube: item('cube', 'mark.box@1', 'z8', { size: [0.3, 0.3, 0.3], paint: { fill: { role: 'accent' } } }, { at: { pos: [2.6, -1.6, 0] } }),
    sun: item('sun', 'light.sun@1', 'z9', { illuminance: Math.PI, shadow: false, angle: 0.53 }, { at: { rot: [-55, -40, 0] } }),
  });
  return d;
}
/** `layers` (#385's call, with #430's `float` and `packs`): each writer layer as the GPU layer draws it. */
export const layersCall = (doc: JsonObject, extra: JsonObject = {}): JsonObject => ({ call: 'layers', doc, look: LOOK, by: ['gpu_layer'], float: true, packs: [PACK_DIR], ...extra });
/** `own`: each group whose `blend` isn't `normal`, as #430's `blend_inputs` answers its `source`: the group's own texels
 * after its passes, premultiplied, drawn isolated over transparent. */
export interface Drawn { png: Image; floats: Floats; dim: string; own: Map<string, Floats | string> }
/** Layer `main` of one `layers` reply: its PNG and its premultiplied f32 file, or why there is none. */
export function mainLayer(out: string, reply: JsonObject | undefined, size: readonly [number, number], what: string): Drawn | string {
  const refused = refusal(reply, what);
  if (refused) return refused;
  const layer = (Array.isArray(reply!['layers']) ? reply!['layers'] : []).filter(isObject).find((l) => l['layer'] === 'main');
  if (!layer) return `${what}: the reply lists no layer main: ${shown(reply, 300)}`;
  const side = isObject(layer['drawn']) && isObject(layer['drawn']['gpu_layer']) ? layer['drawn']['gpu_layer'] : undefined;
  if (!side || side['code'] !== undefined) return `${what}: the GPU layer drew no layer main: ${shown(layer, 400)}`;
  const png = pngOf(out, side['png']);
  if (typeof png === 'string') return `${what}: png: ${png}`;
  const floats = floatsOf(out, side['f32'], size);
  if (typeof floats === 'string') return `${what}: \`float: true\` answers the layer's f32 file: ${floats}`;
  const own = new Map<string, Floats | string>();
  for (const b of (Array.isArray(side['blend_inputs']) ? side['blend_inputs'] : []).filter(isObject)) own.set(String(b['group']), floatsOf(out, b['source'], size));
  return { png, floats, dim: String(layer['dim']), own };
}

// ---------------------------------------------------------------------------------------------------
// `live` (#379's call): sessions in the live window, each a document as a session takes it (#393's payload: no `id`,
// no `layers`, no item `layer`), checked by the document check before it shows.

const STATUS: JsonObject = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
export const STATUS_COLORS = STATUS as Record<string, string>;
export const STATUS_DISTANCE = 0.1;
const hex = (c: readonly number[]): string => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
/** A `look@1` whose data roles are `roles` (8-bit sRGB), with the clean status map at the design's distance, no tone
 * map, unit exposure and no finish: the form #382's and #431's suites give `view3d` and `live`. Its ground is dark, or
 * with `paper` white, which a 2D drawing where status shows needs (a status mark keeps its contrast with the ground). */
export function look1(id: string, roles: Record<string, readonly [number, number, number]>, paper = false): JsonObject {
  const palette: JsonObject = { night: paper ? '#ffffff' : '#101114', graphite: '#1b1d22', slate: '#8b8f97' };
  const roleMap: JsonObject = { ground: 'night', ink: 'graphite', muted: 'slate' };
  for (const [role, c] of Object.entries(roles)) { palette[`c-${role}`] = hex(c); roleMap[role] = `c-${role}`; }
  return {
    id, format: 1, basis: 'physical', license: 'Apache-2.0', description: `The #161 acceptance look ${id}.`, palette, roles: roleMap, themes: { light: {}, dark: {} },
    fonts: {
      body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
      mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
    },
    status: { ...STATUS }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: STATUS_DISTANCE,
    attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
    tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ground_3d: { kind: 'none' },
  };
}
export const LIVE_WRITER = 'agent:sess-alpha';
export function payload(doc: JsonObject): JsonObject {
  const out = clone(doc);
  delete out['id']; delete out['layers'];
  for (const i of Object.values(out['items'] as JsonObject)) delete (i as JsonObject)['layer'];
  return out;
}
/** `live` over `sessions`, each `{session, doc: <a payload's path>, size, surface?}`, with the pack installed. */
export const liveCall = (look: JsonObject, sessions: JsonObject[], extra: JsonObject = {}): JsonObject =>
  ({ call: 'live', look, fps: 60, packs: [PACK_DIR], sessions: sessions.map((s) => ({ writer: LIVE_WRITER, ...s })), ...extra });
/** A session's row of a `live` reply: its `state` (`live` or `refused`) and its `issues`. */
export function sessionRow(reply: JsonObject | undefined, session: string): JsonObject | undefined {
  return (Array.isArray(reply?.['sessions']) ? reply['sessions'] : []).filter(isObject).find((s) => s['session'] === session);
}
/** The view of `session` in each frame of a `live` reply, by frame, with that frame's passes. */
export function liveFrames(reply: JsonObject | undefined, session: string): { frame: number; view: JsonObject | undefined; passes: JsonObject[] }[] {
  return (Array.isArray(reply?.['frames']) ? reply['frames'] : []).filter(isObject).map((f) => ({
    frame: Number(f['frame']),
    view: (Array.isArray(f['views']) ? f['views'] : []).filter(isObject).find((v) => v['session'] === session),
    passes: (Array.isArray(f['passes']) ? f['passes'] : []).filter(isObject),
  }));
}

// ---------------------------------------------------------------------------------------------------
// Timed readings: the perf lane's own judge, in a child process, as the base's newest budget tests use it.

/** Runs scripts/benchmark.mjs in a child process (its `fingerprint`, `judgeLimit`, `validateBudgets`), so a budget is
 * judged exactly as the lane judges it without importing the lane. */
export function lane(code: string, input: JsonValue = null): JsonValue {
  const script = `import * as b from ${JSON.stringify(join(REPO, 'scripts', 'benchmark.mjs'))};\nconst input = JSON.parse(process.argv[1]);\nconst out = await (async () => { ${code} })();\nprocess.stdout.write(JSON.stringify(out ?? null));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(input)], { cwd: REPO, encoding: 'utf8', timeout: 300_000, maxBuffer: 64 * 1024 * 1024 });
  expect(r.status, `scripts/benchmark.mjs ran: ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
  return JSON.parse(r.stdout) as JsonValue;
}
export type Load = { start: number; end: number };
export const loadNow = (): number => loadavg()[0]!;
/** Why a timing can't count on this machine now, or '': the lane's judge on five empty readings with the load read
 * now, so the fingerprint (a reference Mac, mains power, Low Power Mode off, thermal state nominal) and the load are
 * read as a run's would be. */
export function timingProblem(): string {
  const now = loadNow();
  const v = obj(lane('return b.judgeLimit({ limit: 1, runs: [0, 0, 0, 0, 0], fingerprint: b.fingerprint(), loads: input });', Array.from({ length: 5 }, () => ({ start: now, end: now }))), 'judgeLimit');
  return v['status'] === 'PASS' ? '' : String(v['reason'] ?? v['status']);
}
export interface Verdict { name: string; status: string; line: string }
/** Each `{name, runs}` judged against `limit` by the lane's rule on five runs after a warm-up, each with its load. */
export function judgeAll(limit: number, rows: { name: string; runs: number[] }[], loads: Load[]): Verdict[] {
  const out = arr(lane('const fp = b.fingerprint(); return input.rows.map((r) => b.judgeLimit({ limit: input.limit, runs: r.runs, fingerprint: fp, loads: input.loads }));', { limit, rows, loads }), 'judgeLimit');
  return rows.map((r, i) => {
    const v = obj(out[i], 'judgeLimit');
    return { name: r.name, status: String(v['status']), line: `${r.name}: ${String(v['status'])} ${r.runs.map((x) => x.toFixed(3)).join(', ')} against ${limit}${v['reason'] ? ` (${String(v['reason'])})` : ''}` };
  });
}
/** PASS passes, a FAIL fails, and anything else fails `INCONCLUSIVE:` with every reading, never a pass. */
export function settle(what: string, verdicts: Verdict[]): void {
  for (const v of verdicts) console.log(v.line);
  const failed = verdicts.filter((v) => v.status === 'FAIL').map((v) => v.line);
  expect(failed, `FAIL: ${what}`).toEqual([]);
  const open = verdicts.filter((v) => v.status !== 'PASS').map((v) => v.line);
  if (open.length) inconclusive(`${what}: ${open.slice(0, 12).join('; ')}`);
}

// ---------------------------------------------------------------------------------------------------
// What a person reads: DEEPBUILD_EVIDENCE_DIR, else a folder under $TMPDIR (the base's taste tests' place).

export function evidenceDir(): string {
  const dir = process.env['DEEPBUILD_EVIDENCE_DIR'] ?? join(tmpdir(), 'deep-161-evidence');
  mkdirSync(dir, { recursive: true });
  return dir;
}
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(value));
  return p;
}
