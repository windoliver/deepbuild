// Test-side tools for the #465 acceptance tests: `deep-gpu` (#377's binary, with #378's `view3d` and #417's and #149's
// `film2d`) built once per file and driven by JSON lines; the documents and looks the tests draw, generated here so
// every value is readable; the reply readers (PNG, f32 targets); #378's pinhole; the flare's own light as the
// difference of two `pre_tone` targets; the five-run budget judge and the machine's fingerprint, read from the perf
// lane's own scripts/benchmark.mjs in a child process; PNG and animated PNG writing for the taste call. Suites don't
// import each other, so what this file shares with #422's, #464's and #149's helpers is repeated here. Each check a
// planted twin must fail returns its failures as sentences naming what failed.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, homedir, loadavg, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from 'vitest';

vi.setConfig({ testTimeout: 3_600_000, hookTimeout: 3_600_000 });

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type V3 = [number, number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/465 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** Each criterion's ID: the first 8 hex digits of SHA-256 of its text, trimmed, white space collapsed (README). */
export const AC = {
  1: '#465.fd08a941', 2: '#465.b55974ba', 3: '#465.5d373d2b', 4: '#465.1b29e5c0',
  5: '#465.c54ce6c3', 6: '#465.72006fae', 7: '#465.e0d48d0f', 8: '#465.e3e14ecf',
} as const;

// ---------------------------------------------------------------------------------------------------
// JSON and verdict words

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
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(value));
  return path;
}
/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** No failures. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}: ${failures.slice(0, 8).join('; ')}`).toEqual([]);
}
/** A planted twin's check: it found failures, and they name what the criterion says they name. */
export function failsNaming(failures: readonly string[], names: (string | RegExp)[], what: string): void {
  expect(failures.length, `${what} fails`).toBeGreaterThan(0);
  const text = failures.join('\n');
  for (const n of names) {
    if (typeof n === 'string') expect(text, `${what}'s failure names ${n}`).toContain(n);
    else expect(text, `${what}'s failure names ${String(n)}`).toMatch(n);
  }
}
/** A 32-bit linear congruential generator (Numerical Recipes' constants), uniform in [0, 1). */
export class Lcg {
  private x: number;
  constructor(seed: number) { this.x = seed >>> 0; }
  next(): number { this.x = (Math.imul(1664525, this.x) + 1013904223) >>> 0; return this.x / 4294967296; }
}

// ---------------------------------------------------------------------------------------------------
// The machine

/** Everything here draws on macOS's Metal device, the reference platform; off it, INCONCLUSIVE. */
export function requireGpu(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these pixels on macOS's Metal device; this is ${process.platform}`);
}
/** Where the run keeps what a person reads: DEEPBUILD_EVIDENCE_DIR, else a folder under $TMPDIR. */
export function evidenceDir(): string {
  const dir = process.env['DEEPBUILD_EVIDENCE_DIR'] ?? join(tmpdir(), 'deep-465-evidence');
  mkdirSync(dir, { recursive: true });
  return dir;
}
export const loadPerCore = (): number => loadavg()[0]! / cpus().length;
/** Runs the perf lane's own scripts/benchmark.mjs in a child process (its `fingerprint`, `judgeLimit` and
 * `validateBudgets`), so the suite judges a budget exactly as the lane does without importing the lane. */
export function lane(code: string, input: JsonValue = null): JsonValue {
  const script = `import * as b from ${JSON.stringify(join(REPO, 'scripts', 'benchmark.mjs'))};\nconst input = JSON.parse(process.argv[1]);\nconst out = await (async () => { ${code} })();\nprocess.stdout.write(JSON.stringify(out ?? null));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(input)], { cwd: REPO, encoding: 'utf8', timeout: 120_000 });
  expect(r.status, `scripts/benchmark.mjs ran: ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
  return JSON.parse(r.stdout) as JsonValue;
}
/** Why a timing can't count on this machine now (off the reference Macs, not on mains, Low Power Mode, thermal state,
 * as the lane's `judgeLimit` reads it; or other work loading it past its core count), or '' when it can. */
export function timingProblem(): string {
  const v = obj(lane('return b.judgeLimit({ limit: 1, runs: [0, 0, 0, 0, 0], fingerprint: b.fingerprint() });'), 'judgeLimit on this machine');
  if (v['status'] !== 'PASS') return String(v['reason'] ?? v['status']);
  const load = loadPerCore();
  return load > 1 ? `under load: ${load.toFixed(2)} a core` : '';
}
/** One budget judged by the lane's rule on five runs after a warm-up: PASS passes, FAIL fails, anything else, or a
 * machine loaded past its core count, is INCONCLUSIVE. */
export function judge(name: string, limit: number, runs: number[]): void {
  const v = obj(lane('return b.judgeLimit({ limit: input.limit, runs: input.runs, fingerprint: b.fingerprint() });', { limit, runs }), `judgeLimit ${name}`);
  const line = `${name}: ${String(v['status'])} ${runs.map((r) => r.toFixed(4)).join(', ')} against ${limit} at load ${loadPerCore().toFixed(2)} a core${v['reason'] ? ` (${String(v['reason'])})` : ''}`;
  console.log(line);
  if (loadPerCore() > 1) inconclusive(`under load: ${line}`);
  expect(['PASS', 'INCONCLUSIVE'], `FAIL or BLOCKED: ${line}`).toContain(v['status']);
  if (v['status'] === 'INCONCLUSIVE') inconclusive(line);
}
export const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };

// ---------------------------------------------------------------------------------------------------
// The build: deep-gpu built once per file and copied out of the target folder.

const CARGO_ARGS = ['build', '--locked', '--bin', 'deep-gpu'];
function cargoBuild(): string {
  const pinned = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
  const path = existsSync(pinned) ? `${process.env['PATH'] ?? ''}${delimiter}${pinned}` : process.env['PATH'];
  const env = { ...process.env, PATH: path, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
  const r = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${CARGO_ARGS.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
const targetDir = (): string => { const t = process.env['CARGO_TARGET_DIR']; return t ? resolve(REPO, t) : join(REPO, 'target'); };
/** Builds deep-gpu before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useGpu(): () => string {
  let dir = ''; let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-465-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(targetDir(), 'debug', 'deep-gpu'), join(dir, 'deep-gpu'));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => { expect(error, `deep-gpu builds: cargo ${CARGO_ARGS.join(' ')}`).toBe(''); return join(dir, 'deep-gpu'); };
}
/** A fresh output folder per test, deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-465-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}
/** A temporary folder the caller deletes as soon as it has read what the binary wrote there. */
export const scratch = (): string => mkdtempSync(join(tmpdir(), 'deep-465-chunk-'));

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one scenario in, one line out (#377).

/** The wrong programs this suite adds to `deep-gpu run`, each reachable only through `--planted` (README). */
export type Planted = 'flare_fixed_ghosts' | 'flare_ignores_occlusion';

/** One `deep-gpu` scenario, accepted, with one reply per call, in one process. */
export function runGpu(bin: string, out: string, calls: JsonObject[], planted?: Planted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const label = `deep-gpu ${args.join(' ')}`;
  const r = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 3_000_000, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${label} did not finish within 3,000 s`);
  if (r.error) throw Error(`${label}: ${r.error.message}`);
  expect(r.status, `${label} exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${label}: one output line`).toBe(1);
  let answer: JsonValue;
  try { answer = JSON.parse(lines[0]!) as JsonValue; } catch { return expect.fail(`${label}: its line is JSON: ${lines[0]!.slice(0, 1500)}`); }
  const a = obj(answer, `${label}: the answer`);
  expect(a['ok'], `${label} accepted the scenario: ${shown(a)}`).toBe(true);
  const replies = arr(a['replies'], `${label}: replies`).map((x, i) => obj(x, `${label}: replies[${i}]`));
  expect(replies.length, `${label}: one reply per call`).toBe(calls.length);
  return replies;
}
/** A reply the binary answered, not refused (any `code`); INCONCLUSIVE when it says the platform can't draw it. */
export function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  return reply;
}

/** `view3d` (#378, #380, #418, #484): the fields this suite drives, all the base's. */
export interface View3d {
  doc: string; look: JsonObject; size: [number, number]; frames?: number; fps?: number; from?: number;
  capture?: 'every' | number[]; targets?: ('final' | 'pre_tone')[]; timings?: boolean; seeks?: { after: number; to: number }[];
}
export const view3d = (v: View3d): JsonObject => ({ call: 'view3d', ...(v as unknown as JsonObject) });

/** A frame row of `view3d` or `film2d`: its index, pixel hash, and the row as given. */
export interface Frame { frame: number; pixel_hash: string; raw: JsonObject }
export function framesOf(reply: JsonObject, what: string): Frame[] {
  answered(reply, what);
  return arr(reply['frames'], `${what}: frames`).map((v, i): Frame => {
    const f = obj(v, `${what}: frames[${i}]`);
    const hash = str(f['pixel_hash'], `${what}: frames[${i}].pixel_hash`);
    expect(hash, `${what}: frames[${i}].pixel_hash is a SHA-256`).toMatch(SHA);
    return { frame: num(f['frame'], `${what}: frames[${i}].frame`), pixel_hash: hash, raw: f };
  });
}
export function frameAt(frames: Frame[], n: number, what: string): Frame {
  const f = frames.find((x) => x.frame === n);
  expect(f, `${what}: frame ${n} is in the reply (frames ${frames.slice(0, 20).map((x) => x.frame).join(', ')}…)`).toBeDefined();
  return f!;
}
/** Each frame's GPU time (`timings: true`). */
export const gpuMs = (frames: Frame[], what: string): number[] => frames.map((f) => num(f.raw['gpu_ms'], `${what}: frame ${f.frame}'s gpu_ms`));
export function readNamed(out: string, hash: JsonValue | undefined, ext: string, what: string): Buffer {
  const h = str(hash, `${what} (a file named by its SHA-256)`);
  expect(h, `${what} is named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${h}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(h);
  return file;
}
/** A float target as luminance: `pre_tone` (#418: the linear image the tone-mapping pass reads, after the effects chain
 * and bloom, before exposure), little-endian f32 RGBA, rows top-down, `w × h × 16` bytes; Rec. 709 Y per pixel. */
export interface Lum { width: number; height: number; y: Float64Array }
export function readLum(out: string, f: Frame, target: 'pre_tone', size: readonly [number, number], what: string): Lum {
  const file = readNamed(out, f.raw[target], 'f32', `${what}: ${target}`);
  expect(file.length, `${what}: ${target} holds ${size[0]} × ${size[1]} f32 RGBA pixels`).toBe(size[0] * size[1] * 16);
  const y = new Float64Array(size[0] * size[1]);
  for (let i = 0; i < y.length; i++) y[i] = 0.2126 * file.readFloatLE(i * 16) + 0.7152 * file.readFloatLE(i * 16 + 4) + 0.0722 * file.readFloatLE(i * 16 + 8);
  return { width: size[0], height: size[1], y };
}
/** The flare's own light: the frame with the flare less the same frame of the same document without it. */
export function minus(a: Lum, b: Lum): Lum {
  const y = new Float64Array(a.y.length);
  for (let i = 0; i < y.length; i++) y[i] = a.y[i]! - b.y[i]!;
  return { width: a.width, height: a.height, y };
}
export const energy = (l: Lum): number => l.y.reduce((s, v) => s + v, 0);

// ---------------------------------------------------------------------------------------------------
// PNG in and out

export interface Image { width: number; height: number; /** RGBA, row-major. */ rgba: Uint8Array }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** Reads an 8-bit RGB or RGBA PNG with no interlace (#418's reader). */
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
export const readFinal = (out: string, f: Frame, what: string): Image => decodePng(readNamed(out, f.raw['final'], 'png', `${what}: final`));
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}
function rows(image: Image): Buffer {
  const raw = Buffer.alloc((image.width * 3 + 1) * image.height);
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const o = (y * image.width + x) * 4; const r = y * (image.width * 3 + 1) + 1 + x * 3;
    raw[r] = image.rgba[o]!; raw[r + 1] = image.rgba[o + 1]!; raw[r + 2] = image.rgba[o + 2]!;
  }
  return deflateSync(raw, { level: 9 });
}
function ihdr(width: number, height: number): Buffer {
  const h = Buffer.alloc(13); h.writeUInt32BE(width, 0); h.writeUInt32BE(height, 4); h[8] = 8; h[9] = 2;
  return h;
}
/** An animated PNG of equal-sized frames at `fps`, looping (#422's encoder): the recording, from the renderer's frames. */
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
/** The share of pixels where some channel differs by more than `codes`. */
export function changedShare(a: Image, b: Image, codes: number): number {
  let n = 0;
  for (let i = 0; i < a.rgba.length; i += 4) if ([0, 1, 2].some((c) => Math.abs(a.rgba[i + c]! - b.rgba[i + c]!) > codes)) n++;
  return n / (a.width * a.height);
}

// ---------------------------------------------------------------------------------------------------
// Looks and documents (README: The surface under test)

const STATUS: JsonObject = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
const FONTS: JsonObject = {
  body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
};
/** A physical-basis `look@1` (#421's, #422's shape), with a white role `flare` for the flare's tint. With no change it
 * maps the scene through tone map none at the exposure whose scale is 1, bloom off and no finish. */
export function look3d(id: string, change: JsonObject = {}): JsonObject {
  return {
    id, format: 1, basis: 'physical', license: 'Apache-2.0', description: `The #465 acceptance look ${id}.`,
    palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', white: '#ffffff' },
    roles: { ground: 'night', ink: 'graphite', muted: 'slate', flare: 'white' },
    themes: { light: {}, dark: {} }, fonts: FONTS,
    status: { ...STATUS }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: 0.1,
    attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
    tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' },
    ...change,
  };
}
/** The look the screenshots and the timings draw in: filmic, as a film would. */
export const FILMIC = look3d('filmic-465', { tone_map: 'filmic', exposure: 0 });

export const WRITER = 'agent:sess-alpha';
/** A scene document as a session holds it (#378): every item in the one writer layer `main`, camera `cam`. */
export function sceneDoc(id: string, size: readonly [number, number], items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #465 acceptance fixture.`, size: [...size], camera: 'cam', seed: 465,
    transport: { span: '10s' }, requires: { modules: { scene3d: '^1', effects: '^1' } }, budget: { class: 'showpiece' },
    layers: { main: { writer: WRITER, title: 'main', order: 'a0' } }, ...extra, items: withIds,
  };
}
export const camera = (position: V3, target: V3, fov: number): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov, near: 0.1, far: 500 } });
export const material = (params: JsonObject): JsonObject => ({ kind: 'material@1', params });
export const box = (size: V3, pos: V3, mat: string): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos }, material: mat });
/** A planar part: `plate@1` (#383's builder), a `size[0]` × `size[1]` rectangle in its own XZ plane facing +Y, turned by `rot`. */
export const plate = (size: [number, number], pos: V3, rot: V3, mat: string): JsonObject =>
  ({ kind: 'plate@1', params: { grid: [1, 1], size }, at: { pos, rot }, material: mat });
/** A plate whose outline is a circle of `radius` (a 128-gon, its corners on the circle), turned by `rot`. */
export function disc(radius: number, pos: V3, rot: V3, mat: string): JsonObject {
  const outline = Array.from({ length: 128 }, (_, k) => [radius * Math.cos((2 * Math.PI * k) / 128), radius * Math.sin((2 * Math.PI * k) / 128)]);
  return { kind: 'plate@1', params: { outline }, at: { pos, rot }, material: mat };
}
/** A black sky with no ambient: nothing but the scene's own lights. */
export const DARK_SKY: JsonObject = { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } };
/** A day sky with a gray ambient gradient. */
export const DAY_SKY: JsonObject = { kind: 'sky@1', params: { top: [0.15, 0.3, 0.75, 1], low: [0.45, 0.6, 0.85, 1], ambient_top: [0.25, 0.25, 0.25], ambient_low: [0.1, 0.1, 0.1] } };
export const sun = (illuminance: number, rot: V3): JsonObject => ({ kind: 'light.sun@1', params: { illuminance, color: [1, 1, 1], shadow: false }, at: { rot } });
/** The light every flare test uses: radius 0.05 m. */
export const LIGHT_RADIUS = 0.05;
/** A `light.point@1` of radius 0.05 m whose disc has linear radiance `radiance`: a sphere of radius r and intensity I
 * (power ÷ 4π, as the light policy reads `power`) shows radiance I ÷ (π r²), so power = 4π · radiance · π r². */
export const pointLight = (pos: V3, radiance = 50): JsonObject =>
  ({ kind: 'light.point@1', params: { power: 4 * Math.PI * radiance * Math.PI * LIGHT_RADIUS ** 2, radius: LIGHT_RADIUS, color: [1, 1, 1], shadow: false }, at: { pos } });
/** Effect: flare's fields (the issue's Fields block). Left out: no ghosts, no streak, no halo, no starburst. */
export interface Flare { ghosts?: number; streak?: { count: number; length: number; anamorphic: boolean }; halo?: number; starburst?: { blades: number }; intensity?: number }
/** An Effect item of kind flare, from the evaluated lights, tinted by the look's white role `flare`. */
export const flare = (f: Flare): JsonObject => ({
  kind: 'effect@1',
  params: { kind: 'flare', flare: { from: 'lights', ghosts: 0, streak: { count: 0, length: 0, anamorphic: false }, halo: 0, starburst: { blades: 0 }, intensity: 1, tint: 'flare', ...(f as unknown as JsonObject) } },
});
/** A linear f32 channel on an item's path, keyed at whole seconds' fractions (`[t s, value]`). */
export function channel(target: string, keys: [number, number][]): JsonObject {
  return { target, type: 'f32', keys: Object.fromEntries(keys.map(([t, value], k) => [`k${k}`, { t: `${t}s`, value, interp: 'linear' }])) };
}
/** Linear interpolation of `keys` at `t` (the channel's own rule). */
export function at(keys: [number, number][], t: number): number {
  if (t <= keys[0]![0]) return keys[0]![1];
  for (let k = 1; k < keys.length; k++) {
    const [t1, v1] = keys[k]!; const [t0, v0] = keys[k - 1]!;
    if (t <= t1) return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
  }
  return keys.at(-1)![1];
}

// ---------------------------------------------------------------------------------------------------
// #378's pinhole: position, target, +Y up, fov across the wider side; frame coordinates continuous, (0, 0) the top
// left corner of the top left pixel, so pixel (i, j)'s centre is (i + 0.5, j + 0.5).

export interface Cam { position: V3; target: V3; fov: number; size: [number, number] }
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
export const focal = (cam: Cam): number => Math.max(...cam.size) / 2 / Math.tan((cam.fov * Math.PI) / 360);
export function project(cam: Cam, p: V3): [number, number] {
  const f = unit(sub(cam.target, cam.position)); const r = unit(cross(f, [0, 1, 0])); const u = cross(r, f);
  const d = sub(p, cam.position); const z = dot(d, f);
  return [cam.size[0] / 2 + (focal(cam) * dot(d, r)) / z, cam.size[1] / 2 - (focal(cam) * dot(d, u)) / z];
}
/** The world point at depth `depth` along the view axis that projects to frame point (x, y) (a camera looking along −Z). */
export function unproject(cam: Cam, x: number, y: number, depth: number): [number, number] {
  return [((x - cam.size[0] / 2) / focal(cam)) * depth + cam.position[0], (-(y - cam.size[1] / 2) / focal(cam)) * depth + cam.position[1]];
}
/** The projected radius, in px, of the light's sphere at `distance` on the view axis. */
export const discPx = (cam: Cam, distance: number): number => focal(cam) * Math.tan(Math.asin(LIGHT_RADIUS / distance));
/** A camera item for a pinhole. */
export const camItem = (cam: Cam): JsonObject => camera(cam.position, cam.target, cam.fov);

// ---------------------------------------------------------------------------------------------------
// The two fixtures more than one file draws: the mirrors (#465.fd08a941 and the taste call) and the flare showcase
// (the taste call and its recording).

/** Which mirrors the room holds: both with `mirror`; m2 without its `mirror` field (its fallback); no m2; m1 without. */
export type Variant = 'both' | 'm2_plain' | 'no_m2' | 'm1_plain';
/** Two mirrors facing each other: `m1` on the wall at z = −3 in front of the camera, `m2` at z = +3 behind it, seen
 * only inside m1; a red box sliding across the floor between them over 2 s. */
export function mirrors(v: Variant, size: [number, number]): JsonObject {
  const m1: JsonObject = { base_color: [0.95, 0.95, 0.95, 1], metallic: 1, roughness: 0 };
  const m2: JsonObject = { base_color: [0.2, 0.6, 0.3, 1], metallic: 0, roughness: 0.6 };
  if (v !== 'm1_plain') m1['mirror'] = { strength: 1, blur: 0, plane: 'm1' };
  if (v === 'both' || v === 'm1_plain') m2['mirror'] = { strength: 1, blur: 0, plane: 'm2' };
  const items: Record<string, JsonObject> = {
    cam: camera([0, 1.2, 1.5], [0, 1.0, -3], 60), sky: DAY_SKY, sun: sun(3, [-50, 30, 0]),
    floor_mat: material({ base_color: [0.45, 0.42, 0.4, 1], roughness: 0.9 }), red_mat: material({ base_color: [0.8, 0.1, 0.08, 1], roughness: 0.5 }),
    m1_mat: material(m1), m2_mat: material(m2),
    floor: box([20, 0.1, 20], [0, -0.05, 0], 'floor_mat'),
    cube: box([0.6, 0.6, 0.6], [-1, 0.3, -1.2], 'red_mat'),
    m1: plate([8, 5], [0, 2, -3], [90, 0, 0], 'm1_mat'),
  };
  if (v !== 'no_m2') items['m2'] = plate([24, 12], [0, 2, 3], [-90, 0, 0], 'm2_mat');
  return sceneDoc(`mirrors-${v}`, size, items, { channels: { slide: channel('items/cube/at/pos/0', [[0, -1], [2, 1]]) } });
}
/** A night stage lit by the point light `key-light` beyond a row of boxes, with a full flare; with `moving`, the light
 * crosses the stage over 2 s. */
export function flareShowcase(size: [number, number], moving: boolean): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: camera([0, 1.4, 7], [0, 1.2, 0], 45), sky: DARK_SKY,
    floor_mat: material({ base_color: [0.3, 0.3, 0.32, 1], roughness: 0.7 }), box_mat: material({ base_color: [0.6, 0.5, 0.4, 1], roughness: 0.6 }),
    floor: plate([30, 30], [0, 0, 0], [0, 0, 0], 'floor_mat'),
    'key-light': pointLight([-1.5, 2.4, -2], 2000),
    flare: flare({ ghosts: 6, halo: 0.05, streak: { count: 4, length: 0.25, anamorphic: false }, starburst: { blades: 6 } }),
  };
  for (let k = 0; k < 5; k++) items[`box${k}`] = box([0.8, 1 + 0.3 * k, 0.8], [-3 + 1.5 * k, 0.5 + 0.15 * k, -0.5], 'box_mat');
  return sceneDoc(`flare-showcase${moving ? '-moving' : ''}`, size, items, moving ? { channels: { cross: channel('items/key-light/at/pos/0', [[0, -2.5], [2, 2.5]]) } } : {});
}
