// Test-side tools for the #968 acceptance tests: `deep-gpu` (#377's binary, with #378's `view3d` and #166's water),
// built once per file and driven by JSON lines; the documents the tests draw (the straight channel, the river with
// rapids and the sheet), generated here so every value is readable; the issue's two-phase closed form and the blend the
// normal readback is held to; #378's pinhole and the ray from a pixel to the water at rest; the reply readers (f32
// targets, PNG); the five-run budget judge and the machine's fingerprint, read from the perf lane's own
// scripts/benchmark.mjs in a child process; animated PNG writing for the taste call's recording. Suites don't import
// each other, so what this file shares with #166's and #268's helpers is repeated here. Each check a planted twin must
// fail returns its failures as sentences naming what failed.

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
/** The checkout root (tests/acceptance/968 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** Each criterion's ID: the first 8 hex digits of SHA-256 of its text, trimmed, white space collapsed (README). */
export const AC = { 1: '#968.baa8eab9', 2: '#968.f3b633ac', 3: '#968.3dca895d', 4: '#968.dc555b94' } as const;

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
export function failsNaming(failures: readonly string[], names: string[], what: string): void {
  expect(failures.length, `${what} fails`).toBeGreaterThan(0);
  const text = failures.join('\n');
  for (const n of names) expect(text, `${what}'s failure names ${n}`).toContain(n);
}
/** A 32-bit linear congruential generator (Numerical Recipes' constants), uniform in [0, 1). */
export class Lcg {
  private x: number;
  constructor(seed: number) { this.x = seed >>> 0; }
  next(): number { this.x = (Math.imul(1664525, this.x) + 1013904223) >>> 0; return this.x / 4294967296; }
}
export const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };

// ---------------------------------------------------------------------------------------------------
// The machine

/** Everything here draws on macOS's Metal device, the reference platform; off it, INCONCLUSIVE. */
export function requireGpu(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these pixels on macOS's Metal device; this is ${process.platform}`);
}
/** Where the run keeps what a person reads: DEEPBUILD_EVIDENCE_DIR, else a folder under $TMPDIR. */
export function evidenceDir(): string {
  const dir = process.env['DEEPBUILD_EVIDENCE_DIR'] ?? join(tmpdir(), 'deep-968-evidence');
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
/** deep-gpu, built once before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useGpu(): () => string {
  let dir = '';
  let error: string | undefined;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-968-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(targetDir(), 'debug', 'deep-gpu'), join(dir, 'deep-gpu'));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (): string => {
    expect(error, `deep-gpu builds: cargo ${CARGO_ARGS.join(' ')}`).toBe('');
    return join(dir, 'deep-gpu');
  };
}
/** A fresh output folder per test, deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-968-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one scenario in, one line out (#377).

/** The wrong program this suite adds to `deep-gpu run`, reachable only through `--planted` (README). */
export type Planted = 'water_flow_single_phase';

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

/** The targets this suite reads: the base's `final` and `pre_tone`, #268's `foam`, and this suite's `normal` (README). */
export type Target = 'final' | 'pre_tone' | 'foam' | 'normal';
/** `view3d` (#378, #166) with the base's fields; nothing added but the target `normal` (README). */
export interface View3d {
  doc: string; look: JsonObject; size: [number, number]; frames?: number; fps?: number; from?: number;
  capture?: 'every' | number[]; targets?: Target[]; timings?: boolean;
}
export const view3d = (v: View3d): JsonObject => ({ call: 'view3d', ...(v as unknown as JsonObject) });

/** A frame row of `view3d`: its index, pixel hash, and the row as given. */
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
/** A float target: little-endian f32, rows top-down, `channels` floats a pixel (pre_tone 4, normal 3, foam 1). */
export interface Floats { width: number; height: number; channels: number; v: Float32Array }
export function readFloats(out: string, f: Frame, target: 'pre_tone' | 'foam' | 'normal', size: readonly [number, number], what: string): Floats {
  const channels = target === 'pre_tone' ? 4 : target === 'normal' ? 3 : 1;
  const file = readNamed(out, f.raw[target], 'f32', `${what}: ${target} at frame ${f.frame}`);
  expect(file.length, `${what}: ${target} holds ${size[0]} × ${size[1]} pixels of ${channels} f32`).toBe(size[0] * size[1] * channels * 4);
  const v = new Float32Array(size[0] * size[1] * channels);
  for (let i = 0; i < v.length; i++) v[i] = file.readFloatLE(i * 4);
  return { width: size[0], height: size[1], channels, v };
}
/** Rec. 709 luminance of an RGBA float target at pixel (x, y). */
export const lumAt = (t: Floats, x: number, y: number): number => {
  const o = (y * t.width + x) * 4;
  return 0.2126 * t.v[o]! + 0.7152 * t.v[o + 1]! + 0.0722 * t.v[o + 2]!;
};
/** The value of a one-channel float target at pixel (x, y). */
export const at1 = (t: Floats, x: number, y: number): number => t.v[y * t.width + x]!;
/** The `normal` target's vector at pixel (x, y). */
export const at3 = (t: Floats, x: number, y: number): V3 => { const o = (y * t.width + x) * 3; return [t.v[o]!, t.v[o + 1]!, t.v[o + 2]!]; };
export const dist3 = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// ---------------------------------------------------------------------------------------------------
// PNG in and out (the taste call's recording)

export interface Image { width: number; height: number; /** RGBA, row-major. */ rgba: Uint8Array }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
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
/** An animated PNG of equal-sized frames at `fps`, looping (#422's encoder): the recording, from the renderer's frames. */
export function encodeApng(frames: Image[], fps: number): Buffer {
  const { width, height } = frames[0]!;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const actl = Buffer.alloc(8); actl.writeUInt32BE(frames.length, 0); actl.writeUInt32BE(0, 4);
  const parts: Buffer[] = [SIGNATURE, chunk('IHDR', ihdr), chunk('acTL', actl)];
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
// Looks and documents (README: The surface under test)

const STATUS: JsonObject = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
const FONTS: JsonObject = {
  body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
};
/** A physical-basis `look@1` (#166's shape). With no change it maps the scene through tone map none at the exposure
 * whose scale is 1, bloom off and no finish, so `pre_tone` and `final` carry the scene's own linear values. */
export function look3d(id: string, change: JsonObject = {}): JsonObject {
  return {
    id, format: 1, basis: 'physical', license: 'Apache-2.0', description: `The #968 acceptance look ${id}.`,
    palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', white: '#ffffff' },
    roles: { ground: 'night', ink: 'graphite', muted: 'slate' },
    themes: { light: {}, dark: {} }, fonts: FONTS,
    status: { ...STATUS }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: 0.1,
    attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
    tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' },
    ...change,
  };
}
/** The look the screenshots and the timings draw in: filmic, as a film would. */
export const FILMIC = look3d('filmic-968', { tone_map: 'filmic', exposure: 0 });

export const WRITER = 'agent:sess-alpha';
export const SEED = 968;
/** A scene document as a session holds it (#378): every item in the one writer layer `main`, camera `cam`. */
export function sceneDoc(id: string, size: readonly [number, number], items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #968 acceptance fixture.`, size: [...size], camera: 'cam', seed: SEED,
    transport: { span: '30s' }, requires: { modules: { scene3d: '^1' } }, budget: { class: 'showpiece' },
    layers: { main: { writer: WRITER, title: 'main', order: 'a0' } }, ...extra, items: withIds,
  };
}
export const camera = (position: V3, target: V3, fov: number): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov, near: 0.1, far: 1000 } });
export const material = (params: JsonObject): JsonObject => ({ kind: 'material@1', params });
/** A box `size` (x, y, z) centred on `pos`. */
export const box = (size: V3, pos: V3, mat: string): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos }, material: mat });
/** A planar part: `plate@1` (#383's builder), a `size[0]` (x) × `size[1]` (z) rectangle of `grid` cells in its own XZ
 * plane at y = 0, facing +Y, centred on `pos`, unturned. */
export const plate = (size: [number, number], grid: [number, number], pos: V3, mat: string): JsonObject =>
  ({ kind: 'plate@1', params: { grid, size }, at: { pos }, material: mat });
/** A straight `curve@1` (path data, not drawn) through its points in order, linear. */
export const line = (points: V3[]): JsonObject => ({ kind: 'curve@1', params: { points, mode: 'linear' } });
/** A day sky with a gray ambient gradient. */
export const DAY_SKY: JsonObject = { kind: 'sky@1', params: { top: [0.15, 0.3, 0.75, 1], low: [0.6, 0.7, 0.85, 1], ambient_top: [0.25, 0.25, 0.25], ambient_low: [0.1, 0.1, 0.1] } };
export const sun = (illuminance: number, rot: V3): JsonObject => ({ kind: 'light.sun@1', params: { illuminance, color: [1, 1, 1], shadow: false }, at: { rot } });

// ---------------------------------------------------------------------------------------------------
// Material: water, with the issue's `flow` and `foam.speed` (its Fields rows, as it names them)

/** The issue's `flow`: `along` a curve item's ID, or a field: the vec2 over x and z written as two expressions (README). */
export interface Flow { along: string | { x: string; z: string }; speed?: number; cycle?: number }
/** The `water` field (#166's, with the issue's `flow` and `foam.speed`). Fields left out take the design's defaults. */
export interface Water {
  waves?: { wind: { speed?: number; direction?: number } } | { direction: number; length: number; amplitude: number; steepness: number }[];
  ripples?: { scale?: number; strength?: number };
  rain?: number;
  foam?: { threshold?: number; speed?: number | 'none' };
  flow?: Flow | 'none';
}
/** A `material@1` carrying `water`. */
export const waterMaterial = (water: Water): JsonObject => material({ roughness: 0.05, water: water as unknown as JsonObject });
/** Water whose surface only the ripples bend: a wind of 0 m/s (no waves, and the ripples drift with no wind), ripples
 * of the default 0.5 m scale at strength 0.1, no rain, the steepness foam off. */
export const FLAT: Water = { waves: { wind: { speed: 0, direction: 0 } }, ripples: { scale: 0.5, strength: 0.1 }, rain: 0, foam: { threshold: 1 } };

// ---------------------------------------------------------------------------------------------------
// The issue's two-phase closed form

/** One phase of the flow at t: its offset downstream in m and its weight. */
export interface Phase { offset: number; weight: number }
/** The issue's two phases at t: phase p ∈ {0, cycle ÷ 2}, each offset speed × ((t + p) mod cycle) and weighted by the
 * triangle 1 − |2 f − 1| of its fraction f = ((t + p) mod cycle) ÷ cycle, which is 0 where the phase wraps (f = 0) and
 * 1 halfway; the two weights sum to 1. */
export function twoPhase(t: number, speed: number, cycle: number): [Phase, Phase] {
  const one = (p: number): Phase => {
    const m = (((t + p) % cycle) + cycle) % cycle;
    return { offset: speed * m, weight: 1 - Math.abs((2 * m) / cycle - 1) };
  };
  return [one(0), one(cycle / 2)];
}
/** The times the phases wrap in (0, span]: every multiple of half a cycle. */
export const wraps = (cycle: number, span: number): number[] => Array.from({ length: Math.floor(span / (cycle / 2) + 1e-9) }, (_, k) => (k + 1) * (cycle / 2));
/**
 * The two-phase blend of the ripples' noise, as a surface normal. On water no wave tilts, a normal n is (−s_x, 1, −s_z)
 * normalized for the noise's slope s, so s = −(n_x, n_z) ÷ n_y; the blended noise's slope is w_a s_a + w_b s_b, and its
 * normal (−s_x, 1, −s_z) normalized. `a` and `b` are the still water's normals where each phase's offset carries the
 * noise from (README: the camera moved upstream by that offset).
 */
export function blend(a: V3, wa: number, b: V3, wb: number): V3 {
  const sx = -(wa * (a[0] / a[1]) + wb * (b[0] / b[1]));
  const sz = -(wa * (a[2] / a[1]) + wb * (b[2] / b[1]));
  const l = Math.hypot(sx, 1, sz);
  return [-sx / l, 1 / l, -sz / l];
}

// ---------------------------------------------------------------------------------------------------
// #378's pinhole: position, target, +Y up (straight down keeps +X as screen right, so screen down is +Z), fov across the
// wider side; frame coordinates continuous, (0, 0) the top left corner of the top left pixel.

export interface Cam { position: V3; target: V3; fov: number; size: [number, number] }
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
const focal = (cam: Cam): number => Math.max(...cam.size) / 2 / Math.tan((cam.fov * Math.PI) / 360);
function basis(cam: Cam): { f: V3; r: V3; u: V3 } {
  const f = unit(sub(cam.target, cam.position));
  let r = cross(f, [0, 1, 0]);
  r = Math.hypot(...r) === 0 ? [1, 0, 0] : unit(r);
  return { f, r, u: cross(r, f) };
}
export const camItem = (cam: Cam): JsonObject => camera(cam.position, cam.target, cam.fov);
/** The same camera moved by `d` (position and target together). */
export const moved = (cam: Cam, d: V3): Cam => ({ ...cam, position: [cam.position[0] + d[0], cam.position[1] + d[1], cam.position[2] + d[2]], target: [cam.target[0] + d[0], cam.target[1] + d[1], cam.target[2] + d[2]] });
/** Where pixel (i, j)'s centre ray meets the plane y = 0 (the water at rest), or null when it doesn't go down. */
export function onWater(cam: Cam, i: number, j: number): [number, number] | null {
  const { f, r, u } = basis(cam); const fl = focal(cam);
  const a = (i + 0.5 - cam.size[0] / 2) / fl; const b = -(j + 0.5 - cam.size[1] / 2) / fl;
  const dir: V3 = [f[0] + a * r[0] + b * u[0], f[1] + a * r[1] + b * u[1], f[2] + a * r[2] + b * u[2]];
  if (dir[1] >= 0) return null;
  const s = -cam.position[1] / dir[1];
  return [cam.position[0] + s * dir[0], cam.position[2] + s * dir[2]];
}

// ---------------------------------------------------------------------------------------------------
// Fixtures more than one file draws

/** The channel's flow: along the curve `c`, 1.5 m/s, a 2 s cycle (criterion 1's numbers). */
export const CHANNEL_FLOW: Flow = { along: 'c', speed: 1.5, cycle: 2 };
/** The straight 40 m channel: a 40 m (x) × 8 m (z) plate `channel` of 512 × 128 cells at y = 0 whose material
 * `channel-water` carries `water`; the curve `c`, a straight line along its centre from (−20, 0, 0) to (20, 0, 0), so
 * downstream is +x everywhere; stone banks along both sides (z beyond ±4 m) and a sand bed 1.5 m down; a day sky and a
 * sun. */
export function channelDoc(id: string, size: readonly [number, number], cam: JsonObject, water: Water): JsonObject {
  return sceneDoc(id, size, {
    cam, sky: DAY_SKY, sun: sun(3, [-35, 30, 0]),
    'channel-water': waterMaterial(water),
    stone: material({ base_color: [0.5, 0.48, 0.45, 1], roughness: 0.9 }),
    sand: material({ base_color: [0.55, 0.48, 0.36, 1], roughness: 0.9 }),
    c: line([[-20, 0, 0], [20, 0, 0]]),
    channel: plate([40, 8], [512, 128], [0, 0, 0], 'channel-water'),
    'bank-left': box([40, 2, 3], [0, 0.2, -5.5], 'stone'),
    'bank-right': box([40, 2, 3], [0, 0.2, 5.5], 'stone'),
    bed: box([40, 0.2, 8], [0, -1.6, 0], 'sand'),
  });
}
/** The river's speed at x: 0.5 m/s at its head (x = −20 m) rising evenly to 3 m/s at its foot (x = 20 m). */
export const riverSpeed = (x: number): number => 0.5 + 0.0625 * (x + 20);
/** The river's flow: the field (riverSpeed(x), 0), downstream along +x, at `speed` 1 (README). */
export const RIVER_FLOW: Flow = { along: { x: '0.5 + 0.0625 * (x + 20)', z: '0' }, speed: 1, cycle: 2 };
/** The river with rapids: a 40 m (x) × 10 m (z) plate `river` of 512 × 128 cells at y = 0 whose material `river-water`
 * carries `water`; stone banks along both sides (z beyond ±5 m) and a sand bed 1.5 m down; a day sky and a sun. */
export function riverDoc(id: string, size: readonly [number, number], cam: JsonObject, water: Water): JsonObject {
  return sceneDoc(id, size, {
    cam, sky: DAY_SKY, sun: sun(3, [-35, 30, 0]),
    'river-water': waterMaterial(water),
    stone: material({ base_color: [0.5, 0.48, 0.45, 1], roughness: 0.9 }),
    sand: material({ base_color: [0.55, 0.48, 0.36, 1], roughness: 0.9 }),
    river: plate([40, 10], [512, 128], [0, 0, 0], 'river-water'),
    'bank-left': box([40, 2, 3], [0, 0.2, -6.5], 'stone'),
    'bank-right': box([40, 2, 3], [0, 0.2, 6.5], 'stone'),
    bed: box([40, 0.2, 10], [0, -1.6, 0], 'sand'),
  });
}
