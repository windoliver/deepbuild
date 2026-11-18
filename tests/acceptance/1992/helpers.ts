// Test-side tools for the #1992 acceptance tests: the checkout's `deep-gpu` binary (#377's GPU layer with #378's
// `view3d`, #422's sky and fog, #426's HDR environments), built once per file and driven by JSON lines; the merge
// base's own `deep-gpu`, built once per merge base and kept (criterion 5); `deep-show`'s `deep_kinds` (the scope
// line "deep_kinds lists the new fields"); the fixtures the criteria name (the linear fixture's panels, the off-axis
// pair, the marks, the status-bound mark, the uniform HDR and its sphere, the castle with labels), shared with the
// taste test so its screenshots are the same scenes; and the reviewed references the criteria are held to: the
// closed forms of the three curves, #378's pinhole, ray and plane hits, sRGB coding, PNG and f32 target reading.
// Copied in part from #426's, #422's, #382's, #485's and #1973's helpers, since suites don't import each other.
// Nothing here stands in for the renderer, the fog, the marks or the background under test.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1992 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text (scripts/proof-change.mjs, criterionId). */
export const AC = {
  1: 'AC1 #1992.cf298652',
  2: 'AC2 #1992.80a02b86',
  3: 'AC3 #1992.5703f3eb',
  4: 'AC4 #1992.6b71e62f',
  5: 'AC5 #1992.597ff532',
  6: 'AC6 #1992.9d39bde2',
  7: 'AC7 #1992.b0119deb',
} as const;
/** A criterion's bare ID, `#1992.<h8>`, as `benchmarks/budgets.json` and TASTE.json name it. */
export const idOf = (n: keyof typeof AC): string => AC[n].split(' ')[1]!;

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
export const shown = (v: unknown, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export const clone = <T extends JsonValue>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** At least one failure, and every failure names `name`: what a planted program must give ("fails, naming ..."). */
export function failsNaming(failures: readonly string[], name: string | RegExp, what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  const bare = failures.filter((f) => (typeof name === 'string' ? !f.includes(name) : !name.test(f)));
  expect(bare, `${what}: every failure names ${String(name)}`).toEqual([]);
}
/** A failure line's pixel, `(x, y)`. */
export const PIXEL = /\(\d+, \d+\)/;

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

// The perf lane's own rule (scripts/benchmark.mjs), as #1636's and #233's budget tests read it: five runs after a
// warm-up, judged only on a reference Mac at rest with the load within the cores; anything else is INCONCLUSIVE.
export const load = (): number => loadavg()[0]!;
interface Bench { fingerprint: () => JsonObject; judgeLimit: (o: unknown) => JsonObject; validateBudgets: (current: unknown, base: unknown) => void }
const bench = async (): Promise<Bench> => (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as Bench;
export async function judgeLimit(limit: number, runs: number[], loads: { start: number; end: number }[]): Promise<JsonObject> {
  const b = await bench();
  return b.judgeLimit({ limit, runs, fingerprint: b.fingerprint(), loads });
}
/** Why this machine can't judge a timing now, or '' when it can: the lane's verdict on five zero runs at this load. */
export async function timingProblem(): Promise<string> {
  const now = load();
  const v = await judgeLimit(1, [0, 0, 0, 0, 0], Array.from({ length: 5 }, () => ({ start: now, end: now })));
  return v['status'] === 'PASS' ? '' : String(v['reason'] ?? v['status']);
}
export async function validateBudgets(current: JsonObject, base: JsonObject): Promise<void> {
  (await bench()).validateBudgets(current, base);
}

// ---------------------------------------------------------------------------------------------------
// The builds: a cargo binary built once per file and copied out of the target folder.

const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
export const targetDir = (): string => process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');
const cargoEnv = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv =>
  ({ ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0', ...extra });
function cargoBuild(bin: string, cwd = REPO, extra: NodeJS.ProcessEnv = {}): string {
  const args = ['build', '--locked', '--bin', bin];
  const run = spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: cargoEnv(extra) });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
/** Builds `bin` (deep-gpu by default) before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useBin(bin = 'deep-gpu'): () => string {
  let dir = '';
  let error = 'the build did not run';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1992-bin-'));
    error = cargoBuild(bin);
    if (error === '') copyFileSync(join(targetDir(), 'debug', exe(bin)), join(dir, exe(bin)));
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo build --locked --bin ${bin}`).toBe('');
    return join(dir, exe(bin));
  };
}
/** A fresh temporary folder per test (documents, assets, outputs), deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1992-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run`: one JSON line in, one JSON line out (#377). This suite plants no renderer flag (README: Planted programs).

/** One process: the calls in order, a reply per call. */
export function runGpu(bin: string, out: string, calls: JsonObject[]): JsonObject[] {
  const name = 'deep-gpu run';
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
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
  expect(reply['code'], `${what} is drawn, not refused: ${shown(reply)}`).toBeUndefined();
  return reply;
}
/** Whether a `view3d` reply is a refusal that names the sky (README: The surface under test): a string `code`, no
 * frames, and the item ID `sky` as a word in its other fields. Returns why it isn't, or ''. */
export function skyRefusal(reply: JsonObject): string {
  if (typeof reply['code'] !== 'string') return `it is drawn, not refused: ${shown(reply, 400)}`;
  if (reply['code'] === 'unsupported_platform') return 'the refusal is the platform\'s, not the sky\'s';
  if (reply['frames'] !== undefined) return `a refused call draws no frame: ${shown(reply, 400)}`;
  const text = Object.entries(reply).filter(([k]) => k !== 'code').map(([, v]) => JSON.stringify(v)).join(' ');
  return new RegExp(`(^|[^A-Za-z0-9_-])${SKY}([^A-Za-z0-9_-]|$)`).test(text) ? '' : `the refusal doesn't name the sky \`${SKY}\`: ${shown(reply, 400)}`;
}

// ---------------------------------------------------------------------------------------------------
// Looks and documents

/** The status colors (Look `look@1`: status), as #382's looks carry them. */
export const STATUS: Record<string, string> = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
/** A physical-basis `look@1` with tone map none at the exposure whose scale 1 ÷ (1.2 × 2^EV100) is 1, so the linear
 * target holds the values the criteria state and the final target is its sRGB encoding (#378's, #421's and #426's
 * acceptance look), no bloom, no deband, no ground grid; the role `white` is #ffffff, linear 1. */
export const PLAIN_LOOK: JsonObject = {
  id: 'look-1992-plain', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'A #1992 acceptance look.',
  palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', white: '#ffffff' },
  roles: { ground: 'night', ink: 'graphite', muted: 'slate', white: 'white' },
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
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #1992 acceptance fixture.`, size, camera: 'cam', transport: { span: '10s' },
    requires: { modules: { scene3d: '^1' } }, layers: { main: { writer: AGENT, title: 'main', order: 'a0' } }, ...extra, items: withIds,
  };
}

export type V3 = [number, number, number];
export type Rgb = [number, number, number];

// ---------------------------------------------------------------------------------------------------
// view3d (#378)

export interface View3d {
  doc: string; look?: JsonObject; size: [number, number]; frames?: number; fps?: number;
  capture?: 'every' | number[]; targets?: ('final' | 'linear' | 'ids')[];
  assets?: Record<string, string>; packs?: string[]; states?: Record<string, string>; timings?: boolean;
}
export const view3dCall = (v: View3d): JsonObject => ({ call: 'view3d', look: PLAIN_LOOK, frames: 1, capture: [0], ...(v as unknown as JsonObject) });
export interface ViewFrame {
  frame: number; final: string | null; linear: string | null; ids: string | null; picks: Map<number, string> | null;
  pixel_hash: string | null; gpu_ms: number | null;
}
const optStr = (v: JsonValue | undefined, what: string): string | null => (v === undefined || v === null ? null : str(v, what));
export function framesOf(reply: JsonObject, what: string): ViewFrame[] {
  answered(reply, what);
  return arr(reply['frames'], `${what}: frames`).map((v, i): ViewFrame => {
    const f = obj(v, `${what}: frames[${i}]`); const at = `${what}: frames[${i}]`;
    let picks: Map<number, string> | null = null;
    if (isObject(f['picks'])) picks = new Map(Object.entries(f['picks']).map(([k, id]) => [Number(k), str(id, `${at}.picks[${k}]`)]));
    return {
      frame: num(f['frame'], `${at}.frame`), final: optStr(f['final'], `${at}.final`), linear: optStr(f['linear'], `${at}.linear`), ids: optStr(f['ids'], `${at}.ids`), picks,
      pixel_hash: optStr(f['pixel_hash'], `${at}.pixel_hash`), gpu_ms: typeof f['gpu_ms'] === 'number' ? f['gpu_ms'] : null,
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
export interface Linear { width: number; height: number; at: (x: number, y: number) => Rgb; bytes: (x: number, y: number) => string }
export function readLinear(out: string, f: ViewFrame, size: [number, number], what: string): Linear {
  const file = readNamed(out, f.linear, 'f32', what);
  expect(file.length, `${what} holds ${size[0]} × ${size[1]} f32 RGBA pixels`).toBe(size[0] * size[1] * 16);
  const o = (x: number, y: number): number => (y * size[0] + x) * 16;
  return {
    width: size[0], height: size[1],
    at: (x, y) => [file.readFloatLE(o(x, y)), file.readFloatLE(o(x, y) + 4), file.readFloatLE(o(x, y) + 8)],
    bytes: (x, y) => file.subarray(o(x, y), o(x, y) + 16).toString('hex'),
  };
}

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
export interface Ids { width: number; height: number; at: (x: number, y: number) => string | null }
export function readIds(out: string, f: ViewFrame, what: string): Ids {
  const png = decodePng(readNamed(out, f.ids, 'png', what));
  expect(png.channels, `${what} is an RGBA PNG`).toBe(4);
  expect(f.picks, `${what}: the frame names the item each pick ID stands for`).not.toBeNull();
  const items: (string | null)[] = new Array(png.width * png.height);
  for (let i = 0; i < items.length; i++) {
    const o = i * 4;
    const pick = (png.rgba[o]! + png.rgba[o + 1]! * 256 + png.rgba[o + 2]! * 65_536 + png.rgba[o + 3]! * 16_777_216) >>> 0;
    items[i] = pick === 0 ? null : f.picks!.get(pick) ?? `unknown:${pick}`;
  }
  return { width: png.width, height: png.height, at: (x, y) => (x < 0 || y < 0 || x >= png.width || y >= png.height ? null : items[Math.floor(y) * png.width + Math.floor(x)]!) };
}
/** Whether every pixel within `r` px of (x, y) shows `id` (the pixel is covered whole, `2r + 1` px wide). */
export function within(ids: Ids, x: number, y: number, id: string | null, r: number): boolean {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (ids.at(x + dx, y + dy) !== id) return false;
  return true;
}
/** The box of `id`'s pixels in the ID target, `[x0, y0, x1, y1]` inclusive, or null when it has none. */
export function idsBox(ids: Ids, id: string): [number, number, number, number] | null {
  let box: [number, number, number, number] | null = null;
  for (let y = 0; y < ids.height; y++) for (let x = 0; x < ids.width; x++) {
    if (ids.at(x, y) !== id) continue;
    box = box ? [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)] : [x, y, x, y];
  }
  return box;
}

// sRGB coding (the final target with tone map none is the sRGB encoding of the linear target).
export const encode = (v: number): number => { const c = Math.min(Math.max(v, 0), 1); return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; };
export const decode8 = (c: number): number => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
export const fromHex = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;

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
export interface Asset { path: string; sha: string }
/** A white, opaque 8 × 8 PNG under `dir`, named by its SHA-256: the image mark's picture. */
export function writeWhitePng(dir: string): Asset {
  const bytes = encodeRgbaPng(8, 8, new Uint8Array(8 * 8 * 4).fill(255));
  const sha = sha256(bytes); const path = join(dir, `${sha}.png`);
  writeFileSync(path, bytes);
  return { path, sha };
}
/** A Radiance RGBE file (`#?RADIANCE`, `-Y h +X w`, flat scanlines, the base's reader as #426 found it) whose every
 * pixel is mantissa 128 at exponent 129: 128 × 2^(129 − 136) = 1 exactly in each channel. "A uniform HDR environment
 * of radiance 1". */
export function writeUniformHdr(dir: string): Asset {
  const [w, h] = [256, 128];
  const head = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`, 'latin1');
  const body = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { body[i * 4] = 128; body[i * 4 + 1] = 128; body[i * 4 + 2] = 128; body[i * 4 + 3] = 129; }
  const bytes = Buffer.concat([head, body]);
  const sha = sha256(bytes); const path = join(dir, `${sha}.hdr`);
  writeFileSync(path, bytes);
  return { path, sha };
}

// ---------------------------------------------------------------------------------------------------
// Reviewed references: vectors, the transform order (Units and axes), #378's pinhole, hits.

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: V3): V3 => scale(a, 1 / len(a));
export const rad = (d: number): number => (d * Math.PI) / 180;
/** The unit direction `az`° to the right of −Z in the horizontal plane. */
export const dirAt = (az: number): V3 => [Math.sin(rad(az)), 0, -Math.cos(rad(az))];

/** #378's pinhole: position, target, +Y up, fov across the wider side. */
export interface Pinhole { position: V3; target: V3; fov: number; size: [number, number] }
function basis(cam: Pinhole): { f: V3; r: V3; u: V3; focal: number } {
  const f = unit(sub(cam.target, cam.position));
  const r = unit(cross(f, [0, 1, 0]));
  return { f, r, u: cross(r, f), focal: Math.max(...cam.size) / 2 / Math.tan(rad(cam.fov) / 2) };
}
export const forward = (cam: Pinhole): V3 => basis(cam).f;
export const focalPx = (cam: Pinhole): number => basis(cam).focal;
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
/** The pixel holding world point `p` for `cam`. */
export function pixelOf(cam: Pinhole, p: V3): [number, number] { const [sx, sy] = project(cam, p); return [Math.floor(sx), Math.floor(sy)]; }
/** Where the ray from `o` along unit `d` meets the plane through `p` with normal `n`, or null when it runs beside it. */
export function hitPlane(o: V3, d: V3, p: V3, n: V3): V3 | null {
  const k = dot(d, n);
  if (Math.abs(k) < 1e-9) return null;
  const t = dot(sub(p, o), n) / k;
  return t > 0 ? add(o, scale(d, t)) : null;
}

// ---------------------------------------------------------------------------------------------------
// The fog under test, as the issue states it, in closed form.

/** The sky item's ID in every fixture: what a refusal or a failure that "names the sky" names. */
export const SKY = 'sky';
/** The issue's fog color, linear 0.5, and what it mixes: an unlit white surface, linear 1. */
export const FOG_COLOR = 0.5;
export const WHITE = 1;
/** One code value of an 8-bit target, the criteria's tolerance on linear targets. */
export const TOL = 1 / 255;

export interface Curve { name: 'linear' | 'exp' | 'exp2'; sky: JsonObject; share: (d: number) => number; text: string }
/** `fog_curve: linear {near: 10, far: 50}` as a `sky@1` holds it (README: The surface under test): no density. */
export const linearCurve = (near: number, far: number): JsonObject => ({ fog_curve: { linear: { near, far } } });
/** The linear fixture's curve: the share of fog at d m from the eye is clamp((d − 10) ÷ (50 − 10), 0, 1). */
export const LINEAR: Curve = {
  name: 'linear', sky: linearCurve(10, 50), text: 'fog_curve: linear {near: 10, far: 50}',
  share: (d) => Math.min(1, Math.max(0, (d - 10) / 40)),
};
/** The issue's exp curve "fitted to the same halfway distance (density 0.0231 per m)": 1 − e^(−0.0231 d), half at 30 m. */
export const EXP_DENSITY = 0.0231;
export const EXP: Curve = {
  name: 'exp', sky: { fog_curve: 'exp', fog_density: EXP_DENSITY }, text: `fog_curve: exp, fog_density: ${EXP_DENSITY}`,
  share: (d) => 1 - Math.exp(-EXP_DENSITY * d),
};
/** An exp2 curve fitted the same way (README: Readings): 1 − e^(−(0.02775 d)²), half at 30 m, since 0.02775 × 30 = √(ln 2). */
export const EXP2_DENSITY = 0.02775;
export const EXP2: Curve = {
  name: 'exp2', sky: { fog_curve: 'exp2', fog_density: EXP2_DENSITY }, text: `fog_curve: exp2, fog_density: ${EXP2_DENSITY}`,
  share: (d) => 1 - Math.exp(-((EXP2_DENSITY * d) ** 2)),
};
export const CURVES: Curve[] = [LINEAR, EXP, EXP2];
/** What an unlit white surface reads on the linear target with `share` of the fog color mixed in. */
export const fogged = (share: number, color = WHITE): number => color + (FOG_COLOR - color) * share;

/** The fixtures' sky: black behind the scene, no ambient light, fog color linear 0.5, the curve as given. */
export const fogSky = (curve: JsonObject, extra: JsonObject = {}): JsonObject => ({
  kind: 'sky@1',
  params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0], fog: [FOG_COLOR, FOG_COLOR, FOG_COLOR, 1], ...curve, ...extra },
});
export const camera = (cam: Pinhole, far: number): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', position: cam.position, target: cam.target, fov: cam.fov, near: 0.1, far } });
/** The unlit white material every panel wears: its color is its base color, whatever lights the scene (Material: `unlit`). */
export const UNLIT_WHITE: JsonObject = { kind: 'material@1', params: { base_color: [1, 1, 1, 1], unlit: true } };

// ---- "An unlit white panel" (README: Readings): a thin `mark.box@1` in the unlit white material, square to the eye.
export interface Panel { id: string; distance: number; azimuth: number; side: number; item: JsonObject; face: V3; normal: V3 }
const THICK = 0.1;
/** A panel `side` m square whose near face's centre is `distance` m from the eye at the origin, `azimuth`° right of −Z,
 * turned about +Y to face the eye (R = Rz·Ry·Rx, so `rot: [0, −azimuth, 0]` turns the box's Z axis onto the line of sight). */
export function panel(id: string, distance: number, azimuth: number, side: number): Panel {
  const d = dirAt(azimuth);
  return {
    id, distance, azimuth, side, face: scale(d, distance), normal: scale(d, -1),
    item: { kind: 'mark.box@1', params: { size: [side, side, THICK] }, at: { pos: scale(d, distance + THICK / 2), rot: [0, -azimuth, 0] }, material: 'white' },
  };
}
/** The four corners of a panel's near face. */
export function panelCorners(p: Panel): V3[] {
  const right: V3 = [Math.cos(rad(p.azimuth)), 0, Math.sin(rad(p.azimuth))];
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => add(add(p.face, scale(right, (a! * p.side) / 2)), [0, (b! * p.side) / 2, 0]));
}
export interface PanelReading { pixel: [number, number]; distance: number; value: Rgb; problems: string[] }
/** Reads a panel at the pixel its near face's centre projects to, and checks the fixture there: the ray through that
 * pixel's centre meets the near face inside it, `distance` m from the eye within 5 cm; the ID target shows the panel
 * on every pixel within 2 px (the pixel is covered whole, 5 px wide); and the panel's pixels span what the pinhole
 * gives for its near face within 2 px (so the suite's camera and rotation are the renderer's). */
export function readPanel(cam: Pinhole, p: Panel, lin: Linear, ids: Ids, what: string): PanelReading {
  const problems: string[] = [];
  const pixel = pixelOf(cam, p.face);
  const hit = hitPlane(cam.position, rayAt(cam, pixel[0] + 0.5, pixel[1] + 0.5), p.face, p.normal);
  const distance = hit ? len(sub(hit, cam.position)) : NaN;
  if (!hit || len(sub(hit, p.face)) > p.side / 2 - 0.05) problems.push(`${what}: the ray through (${pixel.join(', ')}) misses the panel \`${p.id}\`'s near face`);
  if (!(Math.abs(distance - p.distance) <= 0.05)) problems.push(`${what}: the panel \`${p.id}\`'s surface at (${pixel.join(', ')}) is ${distance.toFixed(3)} m from the eye, not ${p.distance} m`);
  if (!within(ids, pixel[0], pixel[1], p.id, 2)) problems.push(`${what}: the panel \`${p.id}\` doesn't cover every pixel within 2 px of (${pixel.join(', ')})`);
  const box = idsBox(ids, p.id);
  const corners = panelCorners(p).map((c) => project(cam, c));
  const want = [Math.min(...corners.map((c) => c[0])), Math.min(...corners.map((c) => c[1])), Math.max(...corners.map((c) => c[0])), Math.max(...corners.map((c) => c[1]))];
  if (!box) problems.push(`${what}: the panel \`${p.id}\` draws no pixel in the ID target`);
  else if ([box[0] - want[0]!, box[1] - want[1]!, box[2] + 1 - want[2]!, box[3] + 1 - want[3]!].some((e) => Math.abs(e) > 2))
    problems.push(`${what}: the panel \`${p.id}\` spans ${box.join(', ')} px in the ID target, the pinhole gives ${want.map((v) => v.toFixed(1)).join(', ')}`);
  return { pixel, distance, value: lin.at(pixel[0], pixel[1]), problems };
}
/** The largest channel difference between a reading and one gray value. */
export const off = (got: Rgb, want: number): number => Math.max(...got.map((v) => Math.abs(v - want)));
export const fmt = (c: Rgb): string => c.map((v) => v.toFixed(4)).join(', ');

// ---- Criterion 1: the linear fixture's panels at 8, 10, 30 and 60 m, side by side, each 8° wide.
export const PANELS_SIZE: [number, number] = [640, 360];
export const PANELS_CAM: Pinhole = { position: [0, 0, 0], target: [0, 0, -1], fov: 60, size: PANELS_SIZE };
const wide = (d: number): number => 2 * d * Math.tan(rad(4));
export const PANELS: Panel[] = [panel('p8', 8, -21, wide(8)), panel('p10', 10, -7, wide(10)), panel('p30', 30, 7, wide(30)), panel('p60', 60, 21, wide(60))];
export function panelsDoc(curve: JsonObject): JsonObject {
  return sessionDoc('panels', PANELS_SIZE, { cam: camera(PANELS_CAM, 200), [SKY]: fogSky(curve), white: UNLIT_WHITE, ...Object.fromEntries(PANELS.map((p) => [p.id, p.item])) });
}
/** Criterion 1's judge: each panel's reading against what the linear fixture's curve gives at its distance, within
 * 1/255 on the linear target. A failure names the sky, whose curve it judges, the panel and the pixel. */
export function judgePanels(readings: { panel: Panel; value: Rgb; pixel: [number, number] }[], what: string): string[] {
  return readings.flatMap(({ panel: p, value, pixel }) => {
    const want = fogged(LINEAR.share(p.distance));
    return off(value, want) <= TOL ? [] : [`${what}: the sky \`${SKY}\` (${LINEAR.text}): the panel \`${p.id}\` ${p.distance} m from the eye reads ${fmt(value)} at (${pixel.join(', ')}), should read ${want.toFixed(4)}`];
  });
}

// ---- Criterion 2: a camera at the origin with fov 90°, a panel 30 m away on the axis and one 30 m away 40° off it.
export const PAIR_SIZE: [number, number] = [640, 360];
export const TURN = 40;
/** The camera at the origin, fov 90°, looking along −Z, or turned `TURN`° in place toward the off-axis panel. */
export const pairCam = (turned: boolean): Pinhole => ({ position: [0, 0, 0], target: dirAt(turned ? TURN : 0), fov: 90, size: PAIR_SIZE });
export const PAIR: Panel[] = [panel('on_axis', 30, 0, 3), panel('off_axis', 30, TURN, 3)];
export function pairDoc(curve: JsonObject, turned: boolean): JsonObject {
  return sessionDoc(`pair-${turned ? 'turned' : 'ahead'}`, PAIR_SIZE, { cam: camera(pairCam(turned), 200), [SKY]: fogSky(curve), white: UNLIT_WHITE, ...Object.fromEntries(PAIR.map((p) => [p.id, p.item])) });
}
export interface PairReading { panel: Panel; pixel: [number, number]; value: Rgb; turnedPixel: [number, number]; turned: Rgb }
/** Criterion 2's judge: each panel reads the curve's value at 30 m from the eye within 1/255, and the 40° turn in
 * place changes neither by more than 1/255. A failure names the pixel. */
export function judgePair(curve: Curve, readings: PairReading[]): string[] {
  const want = fogged(curve.share(30));
  return readings.flatMap((r) => {
    const out: string[] = [];
    if (off(r.value, want) > TOL) out.push(`(${r.pixel.join(', ')}) the panel \`${r.panel.id}\` 30 m from the eye, ${r.panel.azimuth}° off the axis, under ${curve.text}: reads ${fmt(r.value)}, should read ${want.toFixed(4)}`);
    const moved = Math.max(...[0, 1, 2].map((k) => Math.abs(r.value[k]! - r.turned[k]!)));
    if (moved > TOL) out.push(`(${r.turnedPixel.join(', ')}) the panel \`${r.panel.id}\` under ${curve.text}: turning the camera ${TURN}° in place moves it from ${fmt(r.value)} to ${fmt(r.turned)}, ${(moved * 255).toFixed(2)} codes`);
    return out;
  });
}
/** The planted fog by view depth, on the CPU: what a panel reads when the curve takes the depth along `cam`'s axis. */
export const byViewDepth = (curve: Curve, cam: Pinhole, p: Panel): Rgb => {
  const v = fogged(curve.share(dot(sub(p.face, cam.position), forward(cam))));
  return [v, v, v];
};

// ---- Criterion 3: the marks, each unlit white 30 m from the eye, seen through a long lens so each is several px wide.
export const MARKS_SIZE: [number, number] = [640, 360];
export const MARKS_CAM: Pinhole = { position: [0, 0, 0], target: [0, 0, -1], fov: 12, size: MARKS_SIZE };
/** The point 30 m from the eye whose ray passes (x, y) m off the axis at 30 m. */
const at30 = (x: number, y: number): V3 => scale(unit([x, y, -30]), 30);
export const MARK_AT = { line: at30(-2, 0.9), point: at30(0, 0.9), image: at30(2, 0.9), text: at30(-0.7, -0.6) };
export const LINE_WIDTH = 0.1;
export const LINE_HALF = 0.6;
export const POINT_SIZE = 0.2;
export const IMAGE_SIDE = 0.6;
export const TEXT_EM = 1.2;
const WHITE_PAINT: JsonObject = { fill: { role: 'white' } };
export type MarkId = 'line' | 'point' | 'image' | 'label';
/** The marks document: a world-size `mark.line` 0.1 m wide, a `mark.point` 0.2 m across, a camera-facing image mark
 * (README: The surface under test) and a `mark.text` label, each white, each 30 m from the eye. `fog` writes that
 * value on the line, the point and the image (none: their default); `textFog` writes it on the label (none: its default). */
export function marksDoc(curve: JsonObject, image: string, o: { fog?: boolean; textFog?: boolean } = {}): JsonObject {
  const fog: JsonObject = o.fog === undefined ? {} : { fog: o.fog };
  const [lx, ly, lz] = MARK_AT.line;
  return sessionDoc('marks', MARKS_SIZE, {
    cam: camera(MARKS_CAM, 200), [SKY]: fogSky(curve),
    line: { kind: 'mark.line@1', params: { points: [[lx - LINE_HALF, ly, lz], [lx + LINE_HALF, ly, lz]], width: LINE_WIDTH, size_space: 'world', paint: WHITE_PAINT, ...fog } },
    point: { kind: 'mark.point@1', params: { size: POINT_SIZE, size_space: 'world', paint: WHITE_PAINT, ...fog }, at: { pos: MARK_AT.point } },
    image: { kind: 'mark.image@1', params: { asset: image, alt: 'A white square', size: [IMAGE_SIDE, IMAGE_SIDE], size_space: 'world', facing: 'camera', ...fog }, at: { pos: MARK_AT.image } },
    label: { kind: 'mark.text@1', params: { text: 'TEXT', font: 'body', size: TEXT_EM, size_space: 'world', paint: WHITE_PAINT, ...(o.textFog === undefined ? {} : { fog: o.textFog }) }, at: { pos: MARK_AT.text } },
  });
}
/** The marks document with no fog at all (the sky has no curve and no density): where its label's ink is. */
export const clearMarksDoc = (image: string): JsonObject => marksDoc({}, image);
/** The line's, the point's and the image's judged pixel: where the mark's own centre, 30 m from the eye, projects. Its
 * half-extent there in px, by the pinhole, says how wide the mark is around that pixel. */
export function markPixel(id: 'line' | 'point' | 'image'): { pixel: [number, number]; distance: number; halfPx: number } {
  const c = MARK_AT[id];
  const half = { line: LINE_WIDTH / 2, point: POINT_SIZE / 2, image: IMAGE_SIDE / 2 }[id];
  return { pixel: pixelOf(MARKS_CAM, c), distance: len(c), halfPx: (focalPx(MARKS_CAM) * half) / project(MARKS_CAM, c)[2] };
}
/** The frame row the label's ink is looked for from: the line, the point and the image all end above it (the image,
 * the lowest, at row 88 + 31), and the label's anchor projects to row 240. */
export const LABEL_ROWS_FROM = 140;
/** The label's judged pixels: those from row `LABEL_ROWS_FROM` down that the frame with no fog draws at linear 1 with
 * every pixel within 2 px at 1 too (ink covered whole, 5 px wide), each with the distance from the eye of the point
 * of the label's plane (through its anchor, square to the camera's axis) its ray meets. */
export function labelPixels(clear: Linear): { pixel: [number, number]; distance: number }[] {
  const one = (x: number, y: number): boolean => off(clear.at(x, y), WHITE) <= 1e-3;
  const out: { pixel: [number, number]; distance: number }[] = [];
  const f = forward(MARKS_CAM);
  for (let y = LABEL_ROWS_FROM + 2; y < clear.height - 2; y++) for (let x = 2; x < clear.width - 2; x++) {
    let whole = true;
    for (let dy = -2; dy <= 2 && whole; dy++) for (let dx = -2; dx <= 2; dx++) if (!one(x + dx, y + dy)) { whole = false; break; }
    if (!whole) continue;
    const hit = hitPlane(MARKS_CAM.position, rayAt(MARKS_CAM, x + 0.5, y + 0.5), MARK_AT.text, f);
    out.push({ pixel: [x, y], distance: hit ? len(hit) : NaN });
  }
  return out;
}
export interface MarkReading { mark: MarkId; pixel: [number, number]; value: Rgb }
/** Criterion 3's judge: every reading of a mark against `want` within 1/255 on the linear target. A failure names the mark. */
export function judgeMarks(readings: MarkReading[], want: number, what: string): string[] {
  const failures = readings.filter((r) => off(r.value, want) > TOL);
  const by = new Map<MarkId, MarkReading[]>();
  for (const r of failures) by.set(r.mark, [...(by.get(r.mark) ?? []), r]);
  return [...by.entries()].map(([mark, rs]) => `the mark \`${mark}\` ${what}: reads ${fmt(rs[0]!.value)} at (${rs[0]!.pixel.join(', ')})${rs.length > 1 ? ` and misses at ${rs.length - 1} more of its pixels` : ''}, should read ${want.toFixed(4)}`);
}

// ---- Criterion 3: a mark with a status binding, 60 m from the eye.
export const STATUS_SIZE: [number, number] = [640, 360];
export const STATUS_CAM: Pinhole = { position: [0, 0, 0], target: [0, 0, -1], fov: 12, size: STATUS_SIZE };
export const VERDICT = 'verdict:01JB19920000000000000001992';
export const STATE = 'fail';
export const BOUND: Panel = panel('bound', 60, 0, 2);
/** A `mark.box@1` 60 m from the eye, unlit white, its badge slot bound to a verdict (Status binding; #382's form). */
export function statusDoc(curve: JsonObject): JsonObject {
  return sessionDoc('status', STATUS_SIZE, { cam: camera(STATUS_CAM, 200), [SKY]: fogSky(curve), white: UNLIT_WHITE, [BOUND.id]: BOUND.item }, {
    status_bindings: { b1: { target: `items/${BOUND.id}/params/paint/badge`, source: VERDICT } },
  });
}
export type Box = [number, number, number, number];
/** The status mark `view3d` reports for `item` (#382): its state, its color and its chip's box in px. */
export function statusMark(reply: JsonObject, item: string, what: string): { state: string; color: Rgb; bounds: Box } {
  const marks = arr(obj(reply['status'], `${what}: status`)['marks'], `${what}: status.marks`).map((m, i) => obj(m, `${what}: status.marks[${i}]`));
  const m = marks.find((x) => x['item'] === item);
  expect(m, `${what}: the reply reports a status mark on \`${item}\`: ${shown(marks, 600)}`).toBeDefined();
  const nums = (v: JsonValue | undefined, n: number, at: string): number[] => { const a = arr(v, at).map((x) => num(x, at)); expect(a.length, at).toBe(n); return a; };
  return { state: str(m!['state'], `${what}: the mark's state`), color: nums(m!['color'], 3, `${what}: the mark's color`) as Rgb, bounds: nums(m!['bounds'], 4, `${what}: the mark's bounds`) as Box };
}
/** The color most pixels of `box` hold in the final target, and how many hold it: a status chip's own color (its
 * glyph and its antialiased rim are the fewer). */
export function modal(final: Image, box: Box): { color: Rgb; count: number } {
  const counts = new Map<string, number>();
  for (let y = Math.max(0, Math.ceil(box[1])); y < Math.min(final.height, Math.floor(box[1] + box[3])); y++)
    for (let x = Math.max(0, Math.ceil(box[0])); x < Math.min(final.width, Math.floor(box[0] + box[2])); x++) {
      const k = px(final, x, y).join(','); counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['0,0,0', 0];
  return { color: best[0].split(',').map(Number) as Rgb, count: best[1] };
}
/** Criterion 3's status judge: the mark's chip holds its state's color from the look, exactly. A failure names the mark. */
export function judgeStatus(item: string, got: Rgb, curve: Curve): string[] {
  const want = fromHex(STATUS[STATE]!);
  return got.every((v, k) => v === want[k]) ? [] : [`the mark \`${item}\` 60 m from the eye under ${curve.text}: its status color reads ${got.join(', ')}, should read ${STATE}'s ${want.join(', ')} exactly`];
}
/** The planted fog that tints a status color, on the CPU: the state's color with the curve's share of the fog color
 * mixed in at 60 m, in linear light, encoded. */
export function tintedStatus(curve: Curve): Rgb {
  const s = curve.share(BOUND.distance);
  return fromHex(STATUS[STATE]!).map((c) => Math.round(255 * encode(fogged(s, decode8(c))))) as Rgb;
}

// ---- Criterion 4: a uniform HDR environment of radiance 1 behind and around a white matte sphere.
export const BG_SIZE: [number, number] = [480, 360];
export const BG_CAM: Pinhole = { position: [0, 0, 0], target: [0, 0, -1], fov: 60, size: BG_SIZE };
export const SPHERE = 'sphere';
/** The sphere fixture: the HDR `sha` as the environment (so it draws behind the scene, `background: auto`), no fog,
 * a white matte `ball@1` of radius 1 m 4 m ahead; `sky` adds the field under test, `env` the environment's own. */
export function backgroundDoc(sha: string, sky: JsonObject, env: JsonObject = {}): JsonObject {
  return sessionDoc('background', BG_SIZE, {
    cam: camera(BG_CAM, 100),
    [SKY]: { kind: 'sky@1', params: { ambient_top: [0, 0, 0], ambient_low: [0, 0, 0], environment: { from: sha, intensity: 1, ...env }, ...sky } },
    matte: { kind: 'material@1', params: { base_color: [1, 1, 1, 1], metallic: 0, roughness: 1 } },
    [SPHERE]: { kind: 'ball@1', params: { radius: 1, segments: 128 }, at: { pos: [0, 0, -4] }, material: 'matte' },
  });
}
/** Whether any pixel within `r` px of (x, y) shows an item. */
export function nearItem(ids: Ids, x: number, y: number, r: number): boolean {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (ids.at(x + dx, y + dy) !== null) return true;
  return false;
}
/** Criterion 4's sphere judge: every pixel the sphere covers whole (it and every pixel within 2 px on the sphere) holds
 * the same bytes in `a` and `b`, on the linear and the final target. A failure names the pixel. */
export function judgeSphere(ids: Ids, a: { lin: Linear; final: Image }, b: { lin: Linear; final: Image }, what: string): { failures: string[]; judged: number } {
  const failures: string[] = []; let judged = 0;
  for (let y = 0; y < ids.height; y++) for (let x = 0; x < ids.width; x++) {
    if (!within(ids, x, y, SPHERE, 2)) continue;
    judged++;
    if (a.lin.bytes(x, y) !== b.lin.bytes(x, y)) failures.push(`(${x}, ${y}) ${what}: the sphere's linear pixel is ${fmt(a.lin.at(x, y))}, at background_intensity 1 it is ${fmt(b.lin.at(x, y))}`);
    else if (px(a.final, x, y).join() !== px(b.final, x, y).join()) failures.push(`(${x}, ${y}) ${what}: the sphere's final pixel is ${px(a.final, x, y).join(', ')}, at background_intensity 1 it is ${px(b.final, x, y).join(', ')}`);
  }
  return { failures, judged };
}

// ---------------------------------------------------------------------------------------------------
// The castle (criteria 5 and 6): the checkout's own fixture, as #422's suite draws it.

export const CASTLE = join('packs', 'examples', 'castle.json');
export const CASTLE_LOOK = join('packs', 'examples', 'castle.look.json');
export const CASTLE_PACK = join('packs', 'composites-1.0.0');
export const CASTLE_FPS = 30;
export interface Castle { doc: JsonObject; look: JsonObject; size: [number, number]; packs: string[] }
/** The castle of the tree at `root`: its document, its look, its size and its recipes' pack. */
export function castleOf(root: string): Castle {
  const read = (p: string): JsonObject => obj(JSON.parse(readFileSync(join(root, p), 'utf8')) as JsonValue, p);
  const doc = read(CASTLE);
  const size = arr(doc['size'], `${CASTLE}: size`).map((v) => num(v, `${CASTLE}: size`)) as [number, number];
  return { doc, look: read(CASTLE_LOOK), size, packs: [join(root, CASTLE_PACK)] };
}
/** The castle's one sky: its ID and its params. */
export function castleSky(doc: JsonObject): { id: string; params: JsonObject } {
  const skies = Object.entries(obj(doc['items'], 'the castle\'s items')).filter(([, v]) => isObject(v) && v['kind'] === 'sky@1');
  expect(skies.length, 'the castle holds one sky@1').toBe(1);
  return { id: skies[0]![0], params: obj(obj(skies[0]![1], 'the castle\'s sky')['params'], 'the castle\'s sky\'s params') };
}
/** The fields this issue adds that a document names: a linear curve or a background intensity on a sky, `fog` on a
 * mark, an image mark. "A document with no new field" names none. */
export function newFields(doc: JsonObject): string[] {
  const out: string[] = [];
  for (const [id, v] of Object.entries(obj(doc['items'], 'the document\'s items'))) {
    const item = obj(v, `items/${id}`); const params = isObject(item['params']) ? item['params'] : {}; const kind = String(item['kind']);
    if (kind === 'sky@1' && params['fog_curve'] !== undefined && typeof params['fog_curve'] !== 'string') out.push(`items/${id}/params/fog_curve`);
    if (kind === 'sky@1' && params['background_intensity'] !== undefined) out.push(`items/${id}/params/background_intensity`);
    if (kind.startsWith('mark.') && params['fog'] !== undefined) out.push(`items/${id}/params/fog`);
    if (kind === 'mark.image@1') out.push(`items/${id}`);
  }
  return out;
}
/** The castle with labels (README: Readings, "the fixture's labels"): two `mark.text@1` items in world size over the
 * keep and the east tower, in the look's `stone`, written with the fields the base has. `fog` writes that value on both. */
export const LABELS = ['label_keep', 'label_east'];
export function labelled(doc: JsonObject, fog?: boolean): JsonObject {
  const out = clone(doc);
  const items = obj(out['items'], 'the castle\'s items');
  const label = (id: string, text: string, pos: V3, order: string): JsonObject => ({
    id, kind: 'mark.text@1', name: text, order,
    params: { text, font: 'body', size: 3, size_space: 'world', paint: { fill: { role: 'stone' } }, ...(fog === undefined ? {} : { fog }) }, at: { pos },
  });
  items[LABELS[0]!] = label(LABELS[0]!, 'KEEP', [0, 16, 0], 'z001');
  items[LABELS[1]!] = label(LABELS[1]!, 'EAST', [26, 16, -16], 'z002');
  return out;
}
/** Two frames of the castle's orbit: the first, and half a second on. */
export const CASTLE_FRAMES = [0, 15];
export interface Drawn { frame: number; pixel_hash: string | null; image: Image; png: Buffer }
/** `bin` draws `doc` in the castle's look with its packs at the castle's size, 30 fps: the captured frames' final targets. */
export function drawCastle(bin: string, out: string, c: Castle, doc: JsonObject, name: string): Drawn[] {
  const [reply] = runGpu(bin, out, [view3dCall({ doc: writeJson(out, name, doc), look: c.look, size: c.size, frames: Math.max(...CASTLE_FRAMES) + 1, fps: CASTLE_FPS, capture: CASTLE_FRAMES, targets: ['final'], packs: c.packs })]);
  const frames = framesOf(reply!, name);
  return CASTLE_FRAMES.map((n) => {
    const f = frameAt(frames, n, name);
    const png = readNamed(out, f.final, 'png', `${name}, frame ${n}`);
    return { frame: n, pixel_hash: f.pixel_hash, image: decodePng(png), png };
  });
}
/** The suite's own hash of a frame's pixels: SHA-256 of its size and its RGBA bytes. */
export const pixelHash = (im: Image): string => sha256(Buffer.concat([Buffer.from(`${im.width}x${im.height}:`), Buffer.from(im.rgba.buffer, im.rgba.byteOffset, im.rgba.length)]));
/** The pixels where two frames differ, in row order. */
export function differing(a: Image, b: Image): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < a.rgba.length; i += 4) {
    if (a.rgba[i] !== b.rgba[i] || a.rgba[i + 1] !== b.rgba[i + 1] || a.rgba[i + 2] !== b.rgba[i + 2] || a.rgba[i + 3] !== b.rgba[i + 3]) out.push([(i / 4) % a.width, Math.floor(i / 4 / a.width)]);
  }
  return out;
}
/** The pixels where two frames differ by `codes` or more in a channel, as `y × width + x`: what an item draws itself,
 * apart from the code or two its bloom moves around it. */
export function drawnBy(a: Image, b: Image, codes = 8): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < a.rgba.length; i += 4) {
    if (Math.max(Math.abs(a.rgba[i]! - b.rgba[i]!), Math.abs(a.rgba[i + 1]! - b.rgba[i + 1]!), Math.abs(a.rgba[i + 2]! - b.rgba[i + 2]!)) >= codes) out.add(i / 4);
  }
  return out;
}
/** Criterion 5's judge: each frame `mine` drew has the pixel hash of the merge base's, by the renderer's own
 * `pixel_hash` and by the suite's hash of the decoded pixels. A failure names the first differing pixel. */
export function judgeSame(mine: Drawn[], base: Drawn[], what: string): string[] {
  return mine.flatMap((m, i) => {
    const b = base[i]!;
    if (m.image.width !== b.image.width || m.image.height !== b.image.height) return [`${what}, frame ${m.frame}: ${m.image.width} × ${m.image.height} px, the merge base's is ${b.image.width} × ${b.image.height}`];
    const first = differing(m.image, b.image)[0];
    if (first) return [`${what}, frame ${m.frame}: the first differing pixel is (${first.join(', ')}): ${px(m.image, ...first).join(', ')} here, ${px(b.image, ...first).join(', ')} on the merge base (pixel hash ${pixelHash(m.image).slice(0, 12)} against ${pixelHash(b.image).slice(0, 12)})`];
    return m.pixel_hash !== b.pixel_hash || m.pixel_hash === null ? [`${what}, frame ${m.frame}: the renderer's pixel_hash is ${String(m.pixel_hash)}, the merge base's ${String(b.pixel_hash)}`] : [];
  });
}

// ---- The merge base's renderer (criterion 5), built once per merge base and kept small (README: The merge base).

/** `git merge-base HEAD origin/main`, else `main`; '' when neither answers. */
export function mergeBase(): string {
  for (const ref of ['origin/main', 'main']) {
    const r = spawnSync('git', ['merge-base', 'HEAD', ref], { cwd: REPO, encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  return '';
}
export interface Base { rev: string; bin: string; root: string }
/**
 * The merge base's own `deep-gpu` and castle. Kept under `<target>/acceptance-1992-base/<rev, 12 hex>/`: the binary
 * and the three fixture paths of that commit, nothing else, and only for one merge base (an older one's folder is
 * removed). Built when it isn't there: the commit's tree exported with `git archive` into a scratch folder beside it,
 * the checkout's own `target/debug` cloned next to it with `cp -c` (copy-on-write, so the third-party crates aren't
 * compiled or stored again), `cargo build --locked --bin deep-gpu` there, the binary and the fixture copied out, and
 * the scratch folder removed. No worktree is added and no git state changes.
 */
export function useMergeBase(): () => Base {
  let error = 'the merge base was not built'; let found: Base | undefined;
  beforeAll(() => {
    if (process.platform !== 'darwin') { error = ''; return; }
    const rev = mergeBase();
    if (!rev) { error = 'git merge-base HEAD origin/main (or main) gave no commit'; return; }
    const kept = join(targetDir(), 'acceptance-1992-base');
    const root = join(kept, rev.slice(0, 12));
    const bin = join(root, exe('deep-gpu'));
    if (!(existsSync(join(root, '.built')) && readFileSync(join(root, '.built'), 'utf8') === rev && existsSync(bin))) {
      rmSync(kept, { recursive: true, force: true });
      const scratch = join(kept, `build-${rev.slice(0, 12)}`); const src = join(scratch, 'src');
      mkdirSync(src, { recursive: true });
      try {
        const tar = join(scratch, 'src.tar');
        const a = spawnSync('git', ['archive', '--format=tar', '-o', tar, rev], { cwd: REPO, encoding: 'utf8' });
        const x = a.status === 0 ? spawnSync('tar', ['-xf', tar, '-C', src], { encoding: 'utf8' }) : a;
        rmSync(tar, { force: true });
        if (x.status !== 0) { error = `exporting the merge base ${rev} failed: ${x.stderr}`; return; }
        mkdirSync(join(scratch, 'target'), { recursive: true });
        if (existsSync(join(targetDir(), 'debug'))) spawnSync('cp', ['-c', '-R', join(targetDir(), 'debug'), join(scratch, 'target', 'debug')], { encoding: 'utf8' });
        const failed = cargoBuild('deep-gpu', src, { CARGO_TARGET_DIR: join(scratch, 'target') });
        if (failed) { error = `at the merge base ${rev}: ${failed}`; return; }
        mkdirSync(root, { recursive: true });
        copyFileSync(join(scratch, 'target', 'debug', exe('deep-gpu')), bin);
        for (const p of [CASTLE, CASTLE_LOOK]) { mkdirSync(dirname(join(root, p)), { recursive: true }); copyFileSync(join(src, p), join(root, p)); }
        mkdirSync(join(root, CASTLE_PACK), { recursive: true });
        for (const f of readdirSync(join(src, CASTLE_PACK))) copyFileSync(join(src, CASTLE_PACK, f), join(root, CASTLE_PACK, f));
        writeFileSync(join(root, '.built'), rev);
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    }
    error = ''; found = { rev, bin, root };
  }, 4 * 3_600_000);
  return () => { expect(error, 'the merge base exports and its deep-gpu builds').toBe(''); return found!; };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: `deep_kinds` (#412, #1973), one scenario per batch of calls.

/** `deep_kinds {op: "field", path: "<kind>@<major>"}`: every field line of the kind, or why it has none. */
export function kindFields(bin: string, evidence: string, kinds: string[]): (JsonObject[] | string)[] {
  const calls = kinds.map((path) => ({ call: 'deep_kinds', op: 'field', path }));
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify({ evidence, calls })}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  if (r.error) throw Error(`deep-show run: ${r.error.message}`);
  expect(r.status, `deep-show run exits 0; stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, 'deep-show run: one output line per input line').toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, 'deep-show run: the answer');
  expect(out['ok'], `deep-show run took the scenario: ${shown(out)}`).toBe(true);
  const replies = arr(out['replies'], 'deep-show run: replies');
  expect(replies.length, 'deep-show run: one reply per call').toBe(calls.length);
  return replies.map((v, i) => {
    const reply = isObject(v) ? v : {};
    if (isObject(reply['error'])) return `deep_kinds refuses ${kinds[i]!}: ${shown(reply['error'], 300)}`;
    if (!Array.isArray(reply['lines'])) return `deep_kinds answers no lines for ${kinds[i]!}: ${shown(reply, 300)}`;
    return reply['lines'].map((l): JsonObject => {
      if (isObject(l)) return l;
      try { const p = JSON.parse(String(l)) as JsonValue; return isObject(p) ? p : {}; } catch { return {}; }
    });
  });
}
