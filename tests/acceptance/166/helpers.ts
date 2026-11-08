// Test-side tools for the #166 acceptance tests: `deep-gpu` (#377's binary, with #378's `view3d`) and, for the document
// checks, `deep-show` (#393's scenario binary), each built once per file and driven by JSON lines; the documents and
// looks the tests draw, generated here so every value is readable; the closed-form trochoidal waves the depth readback
// is held to; the reply readers (f32 targets, PNG); #378's pinhole; the five-run budget judge and the machine's
// fingerprint, read from the perf lane's own scripts/benchmark.mjs in a child process; PNG and animated PNG writing for
// the taste call. Suites don't import each other, so what this file shares with #465's and #421's helpers is repeated
// here. Each check a planted twin must fail returns its failures as sentences naming what failed.

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
/** The checkout root (tests/acceptance/166 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** Each criterion's ID: the first 8 hex digits of SHA-256 of its text, trimmed, white space collapsed (README). */
export const AC = {
  1: '#166.f045d1c5', 2: '#166.cc52bd24', 3: '#166.ab96f725', 4: '#166.f353deab', 5: '#166.28aab23d',
  6: '#166.037482f7', 7: '#166.5cdde7aa', 8: '#166.198cb586', 9: '#166.59c5001c', 10: '#166.ad7d1fa8',
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
  const dir = process.env['DEEPBUILD_EVIDENCE_DIR'] ?? join(tmpdir(), 'deep-166-evidence');
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
// Builds: each binary built once per file and copied out of the target folder under its own name.

export type BinName = 'deep-gpu' | 'deep-show';
const cargoArgs = (name: BinName): string[] =>
  name === 'deep-show' ? ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'full'] : ['build', '--locked', '--bin', 'deep-gpu'];
function cargoBuild(name: BinName): string {
  const args = cargoArgs(name);
  const pinned = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
  const path = existsSync(pinned) ? `${process.env['PATH'] ?? ''}${delimiter}${pinned}` : process.env['PATH'];
  const env = { ...process.env, PATH: path, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
const targetDir = (): string => { const t = process.env['CARGO_TARGET_DIR']; return t ? resolve(REPO, t) : join(REPO, 'target'); };
/** Builds every listed binary before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useBins(names: readonly BinName[]): (name: BinName) => string {
  let dir = '';
  const made = new Map<BinName, string>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-166-bin-'));
    for (const name of names) {
      const error = cargoBuild(name);
      if (error === '') copyFileSync(join(targetDir(), 'debug', name), join(dir, name));
      made.set(name, error);
    }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (name: BinName): string => {
    const error = made.get(name);
    if (error === undefined) throw Error(`the file didn't list ${name} in useBins`);
    expect(error, `${name} builds: cargo ${cargoArgs(name).join(' ')}`).toBe('');
    return join(dir, name);
  };
}
/** deep-gpu alone, built once per file. */
export function useGpu(): () => string {
  const bins = useBins(['deep-gpu']);
  return () => bins('deep-gpu');
}
/** A fresh output folder per test, deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-166-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one scenario in, one line out (#377).

/** The one wrong program this suite adds to `deep-gpu run`, reachable only through `--planted` (README). */
export type Planted = 'water_foam_keeps_state';

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

/** The targets this suite reads: the base's `final` and `pre_tone`, and this suite's `depth` and `reflection` (README). */
export type Target = 'final' | 'pre_tone' | 'depth' | 'reflection';
/** `view3d` (#378, #380, #418): the base's fields, and this suite's `rings` (README). */
export interface View3d {
  doc: string; look: JsonObject; size: [number, number]; frames?: number; fps?: number; from?: number;
  capture?: 'every' | number[]; targets?: Target[]; timings?: boolean; rings?: boolean;
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
/** The pixel hash of frame `n` of a reply. */
export const hashAt = (reply: JsonObject, n: number, what: string): string => frameAt(framesOf(reply, what), n, what).pixel_hash;
/** Each frame's GPU time (`timings: true`). */
export const gpuMs = (frames: Frame[], what: string): number[] => frames.map((f) => num(f.raw['gpu_ms'], `${what}: frame ${f.frame}'s gpu_ms`));
export function readNamed(out: string, hash: JsonValue | undefined, ext: string, what: string): Buffer {
  const h = str(hash, `${what} (a file named by its SHA-256)`);
  expect(h, `${what} is named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${h}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(h);
  return file;
}
/** A float target: little-endian f32, rows top-down, `channels` floats a pixel. */
export interface Floats { width: number; height: number; channels: number; v: Float32Array }
export function readFloats(out: string, f: Frame, target: 'pre_tone' | 'depth' | 'reflection', size: readonly [number, number], what: string): Floats {
  const channels = target === 'depth' ? 1 : 4;
  const file = readNamed(out, f.raw[target], 'f32', `${what}: ${target}`);
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

// ---------------------------------------------------------------------------------------------------
// PNG in and out

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
/** A physical-basis `look@1` (#421's, #465's shape). With no change it maps the scene through tone map none at the
 * exposure whose scale is 1, bloom off and no finish, so `pre_tone` and `final` carry the scene's own linear values. */
export function look3d(id: string, change: JsonObject = {}): JsonObject {
  return {
    id, format: 1, basis: 'physical', license: 'Apache-2.0', description: `The #166 acceptance look ${id}.`,
    palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', white: '#ffffff' },
    roles: { ground: 'night', ink: 'graphite', muted: 'slate' },
    themes: { light: {}, dark: {} }, fonts: FONTS,
    status: { ...STATUS }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: 0.1,
    attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
    tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' },
    ...change,
  };
}
/** The look the screenshots, the recording and the timings draw in: filmic, as a film would. */
export const FILMIC = look3d('filmic-166', { tone_map: 'filmic', exposure: 0 });

export const WRITER = 'agent:sess-alpha';
export const SEED = 166;
/** A scene document as a session holds it (#378): every item in the one writer layer `main`, camera `cam`. */
export function sceneDoc(id: string, size: readonly [number, number], items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #166 acceptance fixture.`, size: [...size], camera: 'cam', seed: SEED,
    transport: { span: '30s' }, requires: { modules: { scene3d: '^1' } }, budget: { class: 'showpiece' },
    layers: { main: { writer: WRITER, title: 'main', order: 'a0' } }, ...extra, items: withIds,
  };
}
export const camera = (position: V3, target: V3, fov: number): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov, near: 0.1, far: 1000 } });
export const material = (params: JsonObject): JsonObject => ({ kind: 'material@1', params });
export const box = (size: V3, pos: V3, mat: string): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos }, material: mat });
/** A planar part: `plate@1` (#383's builder), a `size[0]` × `size[1]` rectangle of `grid` cells in its own XZ plane at
 * y = 0, facing +Y, centred on `pos`, unturned. */
export const plate = (size: [number, number], grid: [number, number], pos: V3, mat: string): JsonObject =>
  ({ kind: 'plate@1', params: { grid, size }, at: { pos }, material: mat });
/** A black sky with no ambient: nothing but the scene's own lights and unlit parts. */
export const DARK_SKY: JsonObject = { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } };
/** A day sky with a gray ambient gradient. */
export const DAY_SKY: JsonObject = { kind: 'sky@1', params: { top: [0.15, 0.3, 0.75, 1], low: [0.6, 0.7, 0.85, 1], ambient_top: [0.25, 0.25, 0.25], ambient_low: [0.1, 0.1, 0.1] } };
export const sun = (illuminance: number, rot: V3): JsonObject => ({ kind: 'light.sun@1', params: { illuminance, color: [1, 1, 1], shadow: false }, at: { rot } });
/** A linear f32 channel on an item's path, keyed at seconds (`[t s, value]`). */
export function channel(target: string, keys: [number, number][]): JsonObject {
  return { target, type: 'f32', keys: Object.fromEntries(keys.map(([t, value], k) => [`k${k}`, { t: `${t}s`, value, interp: 'linear' }])) };
}

// ---------------------------------------------------------------------------------------------------
// Material: water (the issue's Fields row, as it names them)

/** One trochoidal wave as the issue lists it: `{direction: deg, length: m, amplitude: m, steepness: 0..1}`. */
export interface Wave { direction: number; length: number; amplitude: number; steepness: number }
/** The `water` field. Fields left out take the design's defaults. */
export interface Water {
  waves?: { wind: { speed?: number; direction?: number } } | Wave[];
  ripples?: { scale?: number; strength?: number };
  rain?: number;
  absorption?: { color?: [number, number, number]; depth?: number };
  distort?: number;
  foam?: { threshold?: number };
  wake?: { item: string; span?: number } | 'none';
}
/** A `material@1` carrying `water` (and, when given, the mirror it names). */
export const waterMaterial = (water: Water, extra: JsonObject = {}): JsonObject => material({ ...extra, water: water as unknown as JsonObject });
/** A flat lake for tests that need the surface still: one wave of amplitude 0, no ripples, no rain. */
export const STILL: Water = { waves: [{ direction: 0, length: 10, amplitude: 0, steepness: 0 }], ripples: { strength: 0 }, rain: 0 };
/** Every default of the Fields row spelled out: what `water: {}` must draw. */
export const DEFAULTS: Water = {
  waves: { wind: { speed: 3, direction: 0 } }, ripples: { scale: 0.5, strength: 0.3 }, rain: 0,
  absorption: { color: [0.12, 0.42, 0.40], depth: 3 }, distort: 16, foam: { threshold: 1 }, wake: 'none',
};

/** g for the deep-water dispersion relation ω = √(g k): the physics world's default gravity (World and backend). */
export const G = 9.81;
/**
 * The trochoidal (Gerstner) surface in closed form of rest position (x0, z0) and t: each wave, with heading D = (sin d,
 * cos d) in (x, z), k = 2π ÷ length, ω = √(g k) and phase θ = k (D · (x0, z0)) − ω t, lifts the point by A cos θ and
 * moves it by −s A sin θ along D (s its steepness). So the crests are sharp, every wave travels along its heading, and
 * no point moves further than the waves' summed amplitude ("It can never"). This is the form of the Oracle's Unreal
 * GerstnerWaveEvaluation (height A cos θ, horizontal −Q sin θ along the direction), with Q = s A (README).
 */
export function trochoid(waves: Wave[], x0: number, z0: number, t: number): { x: number; y: number; z: number } {
  let x = x0; let y = 0; let z = z0;
  for (const w of waves) {
    const d = (w.direction * Math.PI) / 180; const dx = Math.sin(d); const dz = Math.cos(d);
    const k = (2 * Math.PI) / w.length; const omega = Math.sqrt(G * k);
    const theta = k * (dx * x0 + dz * z0) - omega * t;
    y += w.amplitude * Math.cos(theta);
    x -= w.steepness * w.amplitude * dx * Math.sin(theta);
    z -= w.steepness * w.amplitude * dz * Math.sin(theta);
  }
  return { x, y, z };
}

// ---------------------------------------------------------------------------------------------------
// #378's pinhole: position, target, +Y up (straight down keeps +X as screen right, so screen down is +Z), fov across the
// wider side; frame coordinates continuous, (0, 0) the top left corner of the top left pixel, so pixel (i, j)'s centre is
// (i + 0.5, j + 0.5).

export interface Cam { position: V3; target: V3; fov: number; size: [number, number] }
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
export const focal = (cam: Cam): number => Math.max(...cam.size) / 2 / Math.tan((cam.fov * Math.PI) / 360);
function basis(cam: Cam): { f: V3; r: V3; u: V3 } {
  const f = unit(sub(cam.target, cam.position));
  let r = cross(f, [0, 1, 0]);
  r = Math.hypot(...r) === 0 ? [1, 0, 0] : unit(r);
  return { f, r, u: cross(r, f) };
}
export function project(cam: Cam, p: V3): [number, number] {
  const { f, r, u } = basis(cam);
  const d = sub(p, cam.position); const z = dot(d, f);
  return [cam.size[0] / 2 + (focal(cam) * dot(d, r)) / z, cam.size[1] / 2 - (focal(cam) * dot(d, u)) / z];
}
export const camItem = (cam: Cam): JsonObject => camera(cam.position, cam.target, cam.fov);

/**
 * For a camera looking straight down from `cam.position`, the depth along the view axis at which pixel (i, j)'s centre ray
 * meets the trochoidal surface at t: the rest point (x0, z0) whose displaced point lies on the ray, found by fixed-point
 * iteration (a contraction while the waves' summed s·k·A and slopes stay well under 1), and the eye's height less that
 * point's height. Returns the depth and the surface point.
 */
export function depthFromAbove(cam: Cam, waves: Wave[], i: number, j: number, t: number): { depth: number; point: V3 } {
  const f = focal(cam);
  const rx = (i + 0.5 - cam.size[0] / 2) / f; const rz = (j + 0.5 - cam.size[1] / 2) / f;
  const [cx, cy, cz] = cam.position;
  let x0 = cx; let z0 = cz;
  for (let n = 0; n < 200; n++) {
    const p = trochoid(waves, x0, z0, t);
    const s = cy - p.y;
    const nx = cx + rx * s - (p.x - x0); const nz = cz + rz * s - (p.z - z0);
    const moved = Math.hypot(nx - x0, nz - z0);
    x0 = nx; z0 = nz;
    if (moved < 1e-12) break;
  }
  const p = trochoid(waves, x0, z0, t);
  const s = cy - p.y;
  expect(Math.hypot(p.x - (cx + rx * s), p.z - (cz + rz * s)), `the closed form's solve converged at pixel (${i}, ${j})`).toBeLessThan(1e-9);
  return { depth: s, point: [p.x, p.y, p.z] };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run` (#393's scenario binary): the document checks, as #421's suite reads them.

export const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: water', process: { pid: 4100, start: 1_000 } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
/** A document ID the hub minted. */
export const DOC = '01JB166D000000000000000001';
/** The writer's payload of a session document, as `deep_show` (#393) takes it: no `id`, no `layers`. */
export function payload(doc: JsonObject): JsonObject {
  const out = JSON.parse(JSON.stringify(doc)) as JsonObject;
  delete out['id'];
  delete out['layers'];
  for (const item of Object.values(obj(out['items'], 'items'))) delete (item as JsonObject)['layer'];
  return out;
}
/** One `deep_show` of a whole revision with its issues, in a scenario with one visible panel for `DOC`. */
export function showDocument(bin: string, evidence: string, document: JsonObject): JsonObject {
  const sc: JsonObject = {
    evidence,
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } },
    processes: PROCESSES, panels: { p1: { rect: [0, 0, 800, 600] } }, docs: { [DOC]: { panel: 'p1' } },
    calls: [{ call: 'deep_show', session: ALPHA.id, doc: DOC, document: payload(document), include: ['issues'] }],
  };
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 900_000, killSignal: 'SIGKILL' });
  if (r.error) throw Error(`deep-show run: ${r.error.message}`);
  expect(r.status, `deep-show run exited 0; stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, 'deep-show run: one output line').toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, 'deep-show run: the answer');
  expect(answer['ok'], `deep-show run accepted the scenario: ${shown(answer)}`).toBe(true);
  return obj(arr(answer['replies'], 'deep-show run: replies')[0], 'the deep_show reply');
}
/** Presented with no error issue and no item skipped as an unknown kind (#420's and #421's `admitted`). */
export function admitted(reply: JsonObject, what: string): void {
  const errors = arr(reply['issues'] ?? [], `${what}: issues`).map((v) => obj(v, `${what}: an issue`)).filter((i) => i['severity'] === 'error');
  expect(errors.map((e) => shown(e)), `${what}: no error issue`).toEqual([]);
  const skipped = arr(reply['notices'] ?? [], `${what}: notices`).map((n) => obj(n, `${what}: a notice`)).filter((n) => n['code'] === 'unknown_kind');
  expect(skipped.map((n) => shown(n)), `${what}: no item skipped as an unknown kind`).toEqual([]);
  expect(reply['outcome'], `${what}: presented, got ${shown(reply)}`).toBe('presented');
}

// ---------------------------------------------------------------------------------------------------
// Fixtures more than one file draws

/** The four waves of the lake fixture (AC1, AC2, the budgets; AC3 takes a quarter of their amplitude): headings,
 * lengths and amplitudes stated. */
export const LAKE_WAVES: Wave[] = [
  { direction: 20, length: 9, amplitude: 0.12, steepness: 0.5 },
  { direction: 110, length: 6, amplitude: 0.08, steepness: 0.6 },
  { direction: 235, length: 4.5, amplitude: 0.05, steepness: 0.4 },
  { direction: 300, length: 3.2, amplitude: 0.03, steepness: 0.7 },
];
/** Steeper waves, so foam at threshold 0.6 shows (AC7, AC9, the taste call). */
export const STEEP_WAVES: Wave[] = [
  { direction: 15, length: 7, amplitude: 0.35, steepness: 0.9 },
  { direction: 80, length: 5, amplitude: 0.22, steepness: 0.9 },
  { direction: 200, length: 4, amplitude: 0.15, steepness: 0.8 },
  { direction: 320, length: 3, amplitude: 0.1, steepness: 0.8 },
];

/** A harbour: a lake plate `lake` of 40 m × 40 m (256 × 256 cells) whose material `lake-water` carries `water`, a red
 * post and two crates on the shore for the mirror to show, a day sky and a sun, seen from a low camera. With `boat`, a
 * boat `boat` crosses the lake on a channel from x = −12 m at 0 s to 12 m at 24 s. */
export function harbour(id: string, size: readonly [number, number], water: Water, opts: { boat?: boolean; waterExtra?: JsonObject } = {}): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: camera([0, 2.2, 14], [0, 0.6, 0], 50), sky: DAY_SKY, sun: sun(3, [-35, 30, 0]),
    'lake-water': waterMaterial(water, { roughness: 0.05, ...(opts.waterExtra ?? {}) }),
    'post-red': material({ base_color: [0.85, 0.08, 0.06, 1], roughness: 0.5 }),
    'crate-wood': material({ base_color: [0.55, 0.38, 0.2, 1], roughness: 0.7 }),
    'hull-white': material({ base_color: [0.9, 0.9, 0.88, 1], roughness: 0.4 }),
    lake: plate([40, 40], [256, 256], [0, 0, 0], 'lake-water'),
    post: box([0.3, 3, 0.3], [-2, 1, -2], 'post-red'),
    crate1: box([1, 1, 1], [3, 0.3, -5], 'crate-wood'),
    crate2: box([1.4, 0.8, 1.4], [-5, 0.2, -7], 'crate-wood'),
  };
  if (opts.boat) items['boat'] = box([1.8, 0.5, 0.7], [-12, 0.15, 2], 'hull-white');
  return sceneDoc(id, size, items, opts.boat ? { channels: { sail: channel('items/boat/at/pos/0', [[0, -12], [24, 12]]) } } : {});
}
