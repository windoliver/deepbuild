// Test-side tools for the #464 acceptance tests: `deep-gpu` (#377's binary, with #417's and #149's `film2d`, #378's
// `view3d` and #418's `tone`) and `deep-show` (#393's hub, for render-back) built once per file and driven by JSON
// lines; the 2D documents and looks the tests draw, generated here so every value is readable; the reply readers
// (PNG, f32 and index targets); the color math in f64; the two-GPU record; and the evidence folder. Suites don't import
// each other, so what this file shares with #149's, #418's, #429's, #252's and #1162's helpers is repeated here.
// Each check a planted twin must fail returns its failures as sentences naming what failed.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from 'vitest';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';

vi.setConfig({ testTimeout: 3_600_000, hookTimeout: 3_600_000 });

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type Rgb = [number, number, number];
export type Lin = [number, number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/464 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** Each criterion's ID: the first 8 hex digits of SHA-256 of its text, trimmed, white space collapsed (README). */
export const AC = {
  1: '#464.56dd891a', 2: '#464.bf7ef469', 3: '#464.dc7d4ab3', 4: '#464.c29f1d4c', 5: '#464.8dfec0d8',
  6: '#464.2b45c184', 7: '#464.0f0a7807', 8: '#464.1f75f469', 9: '#464.6ebf11ae', 10: '#464.737ef81a',
  11: '#464.1bc1fe40', 12: '#464.2cb143dd', 13: '#464.43c8684e', 14: '#464.93ecbe88', 15: '#464.d22bf5b7',
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
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** A test that needs what this machine lacks fails with this and its one unblock ask, never passes. */
export function blocked(reason: string): never {
  expect.fail(`BLOCKED: ${reason}; this is not a pass`);
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

// ---------------------------------------------------------------------------------------------------
// The machine: Metal on macOS for anything the GPU draws; the GPU family for the two-GPU record.

export function requireGpu(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these pixels on macOS's Metal device, the reference platform; this is ${process.platform}`);
}
function chipName(): string {
  try { return execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; }
}
/** This Mac's Metal GPU family, from its chip (M1 apple7, M2 apple8, M3 and M4 apple9, then apple(n + 5)), as #429's suite reads it. */
export function thisFamily(): string {
  const m = /\bM(\d+)\b/.exec(chipName());
  const n = m ? Number(m[1]) : 0;
  return n === 1 ? 'apple7' : n === 2 ? 'apple8' : n === 3 || n === 4 ? 'apple9' : `apple${n + 5}`;
}
/** Where the run keeps what a person or a second machine reads: DEEPBUILD_EVIDENCE_DIR, else a folder under $TMPDIR. */
export function evidenceDir(): string {
  const dir = process.env['DEEPBUILD_EVIDENCE_DIR'] ?? join(tmpdir(), 'deep-464-evidence');
  mkdirSync(dir, { recursive: true });
  return dir;
}
/**
 * The two-GPU half of a criterion. Writes this GPU's record of the index targets' SHA-256s (`index-record-<family>.json`
 * in the evidence folder) and compares it with the record a GPU of another family made from the same suite, named by
 * DEEPBUILD_SECOND_GPU_464. Without one, it fails BLOCKED with its one unblock ask, never passing.
 */
export function sameOnTwoGpus(name: string, indices: Record<string, string>, what: string): void {
  const family = thisFamily();
  const record = { issue: 464, gpu: { family, chip: chipName() }, indices };
  const path = join(evidenceDir(), `index-record-${name}-${family}.json`);
  writeFileSync(path, `${JSON.stringify(record, null, 1)}\n`);
  console.log(`${what}: this GPU's index record: ${path}`);
  const other = process.env['DEEPBUILD_SECOND_GPU_464'];
  const ask = `one unblock ask: run \`npx vitest run --root tests/acceptance/464 --no-file-parallelism\` on a Mac whose GPU is another family than ${family} and name its ${name} record (index-record-${name}-<family>.json in its DEEPBUILD_EVIDENCE_DIR) in DEEPBUILD_SECOND_GPU_464`;
  if (!other || !existsSync(other)) blocked(`${what} needs a second GPU and this machine has one (${family}); ${ask}`);
  const second = JSON.parse(readFileSync(other, 'utf8')) as { gpu?: { family?: string }; indices?: Record<string, string> };
  if (second.gpu?.family === undefined || second.gpu.family === family) blocked(`${what}: the record in DEEPBUILD_SECOND_GPU_464 is from ${second.gpu?.family ?? 'no named GPU'}, not another family than ${family}; ${ask}`);
  for (const [k, h] of Object.entries(indices)) {
    expect(second.indices?.[k], `${what}: ${k}'s indices on ${family} and on ${second.gpu.family} are the same bytes`).toBe(h);
  }
}

// ---------------------------------------------------------------------------------------------------
// Builds: each binary built once per file and copied out of the target folder.

export type Build = 'deep-gpu' | 'deep-show';
const BUILD_ARGS: Record<Build, string[]> = {
  'deep-gpu': ['build', '--locked', '--bin', 'deep-gpu'],
  'deep-show': ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'full'],
};
/** cargo on PATH, or the pinned toolchain's when PATH has none. */
function cargoEnv(): NodeJS.ProcessEnv {
  const pinned = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
  const path = existsSync(pinned) ? `${process.env['PATH'] ?? ''}${delimiter}${pinned}` : process.env['PATH'];
  return { ...process.env, PATH: path, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
}
function cargoBuild(b: Build): string {
  const args = BUILD_ARGS[b];
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: cargoEnv() });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
const targetDir = (): string => {
  const t = process.env['CARGO_TARGET_DIR'];
  return t ? resolve(REPO, t) : join(REPO, 'target');
};
export interface Bins { bin: (b: Build) => string }
/** Builds each named binary once before the file's tests; a test that uses a failed build fails with cargo's error. */
export function useBins(builds: Build[]): Bins {
  let dir = '';
  const made = new Map<Build, string>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-464-bin-'));
    for (const b of builds) {
      const error = cargoBuild(b);
      if (error === '') copyFileSync(join(targetDir(), 'debug', b), join(dir, b));
      made.set(b, error);
    }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(b: Build): string {
      expect(made.has(b), `the file built ${b}`).toBe(true);
      expect(made.get(b), `${b} builds: cargo ${BUILD_ARGS[b].join(' ')}`).toBe('');
      return join(dir, b);
    },
  };
}
/** A fresh output folder per test, deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-464-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]` and `deep-show run`: one scenario per line in, one line out.

/** The wrong programs this suite adds to `deep-gpu run`, each reachable only through `--planted` (README: Planted programs). */
export type Planted = 'vignette_pixels' | 'grain_from_t' | 'partial_coverage' | 'puff_full_opacity' | 'light_after_upscale' | 'flicker_wall_time';

function lines(bin: string, args: string[], inputs: JsonValue[], timeoutMs = 3_000_000): JsonObject[] {
  const label = `${bin.split(/[\\/]/).at(-1)} ${args.join(' ')}`;
  const r = spawnSync(bin, args, { cwd: REPO, input: `${inputs.map((v) => JSON.stringify(v)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${label} did not finish within ${timeoutMs} ms`);
  if (r.error) throw Error(`${label}: ${r.error.message}`);
  expect(r.status, `${label} exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const out = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(out.length, `${label}: one output line per input line`).toBe(inputs.length);
  return out.map((l, i) => {
    try { return obj(JSON.parse(l) as JsonValue, `${label}: line ${i + 1}`); } catch { return expect.fail(`${label}: line ${i + 1} is JSON: ${l.slice(0, 1500)}`); }
  });
}
/** One `deep-gpu` scenario, accepted, with one reply per call, in one process. */
export function runGpu(bin: string, out: string, calls: JsonObject[], planted?: Planted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const [answer] = lines(bin, args, [{ out, calls }]);
  expect(answer!['ok'], `deep-gpu ${args.join(' ')} accepted the scenario: ${shown(answer)}`).toBe(true);
  const replies = objs(answer!['replies'], 'deep-gpu: replies');
  expect(replies.length, 'deep-gpu: one reply per call').toBe(calls.length);
  return replies;
}
/** A reply the binary answered, not refused (any `code`); INCONCLUSIVE when it says the platform can't draw it. */
export function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  return reply;
}
/** `deep-show run`: one scenario per line, each a fresh run of the hub (#393); each answered ok with one reply per call. */
export function runShow(bin: string, scenarios: JsonObject[], what: string): JsonObject[][] {
  return lines(bin, ['run'], scenarios).map((a, k) => {
    expect(a['ok'], `${what}: deep-show run answers scenario ${k + 1} ok; got ${shown(a)}`).toBe(true);
    const replies = objs(a['replies'], `${what}: replies`);
    expect(replies.length, `${what}: one reply per call`).toBe(arr(scenarios[k]!['calls'], 'calls').length);
    return replies;
  });
}
/** Reads a file of the hub's evidence store by its SHA-256 (packages/evidence's public entry). */
export async function readEvidence(root: string, sha: string): Promise<Buffer> {
  const store = await openEvidenceStore({ root });
  return Buffer.from(await store.read(sha));
}
/** Puts bytes into an evidence store at their SHA-256, as the hub keeps them (#1162's seeding). */
export function seedEvidence(root: string, bytes: Buffer): string {
  const sha = sha256(bytes);
  mkdirSync(join(root, sha.slice(0, 2)), { recursive: true });
  writeFileSync(join(root, sha.slice(0, 2), sha.slice(2)), bytes);
  return sha;
}

// ---------------------------------------------------------------------------------------------------
// Frames and their targets

/** A frame row of `film2d` or `view3d`: its absolute index, pixel hash, and the target files it names. */
export interface Frame { frame: number; pixel_hash: string; raw: JsonObject }
export function framesOf(reply: JsonObject, what: string): Frame[] {
  answered(reply, what);
  return objs(reply['frames'], `${what}: frames`).map((f, i): Frame => {
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
export function readNamed(out: string, hash: JsonValue | undefined, ext: string, what: string): Buffer {
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
/** Reads an 8-bit RGB or RGBA PNG with no interlace (#418's reader). */
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
/** A frame's `final` target: the 8-bit sRGB PNG the frame shows, named by its hash. */
export const readFinal = (out: string, f: Frame, what: string): Image => decodePng(readNamed(out, f.raw['final'], 'png', `${what}: final`));
export function pixel(image: Image, x: number, y: number): Rgb {
  const o = (y * image.width + x) * 4;
  return [image.rgba[o]!, image.rgba[o + 1]!, image.rgba[o + 2]!];
}
export interface F32 { width: number; height: number; rgba: Float32Array }
/** A float target (`linear`) or a `tone` output: little-endian f32 RGBA, rows top-down, `w × h × 16` bytes. */
export function readF32(out: string, hash: JsonValue | undefined, size: readonly [number, number], what: string): F32 {
  const file = readNamed(out, hash, 'f32', what);
  expect(file.length, `${what} holds ${size[0]} × ${size[1]} f32 RGBA pixels`).toBe(size[0] * size[1] * 16);
  const rgba = new Float32Array(size[0] * size[1] * 4);
  for (let i = 0; i < rgba.length; i++) rgba[i] = file.readFloatLE(i * 4);
  return { width: size[0], height: size[1], rgba };
}
export const readLinear = (out: string, f: Frame, size: readonly [number, number], what: string): F32 => readF32(out, f.raw['linear'], size, `${what}: linear`);
export function writeF32(dir: string, name: string, rgba: Float32Array): string {
  const buf = Buffer.alloc(rgba.length * 4);
  for (let i = 0; i < rgba.length; i++) buf.writeFloatLE(rgba[i]!, i * 4);
  const path = join(dir, name);
  writeFileSync(path, buf);
  return path;
}
export interface Indices { width: number; height: number; at: (x: number, y: number) => number; hash: string }
/** A frame's `indices` target: the indexed basis's index target, little-endian u16 per target pixel, rows top-down. */
export function readIndices(out: string, f: Frame, size: readonly [number, number], what: string): Indices {
  const hash = str(f.raw['indices'], `${what}: indices`);
  const file = readNamed(out, hash, 'u16', `${what}: indices`);
  expect(file.length, `${what}: the index target holds ${size[0]} × ${size[1]} u16 indices`).toBe(size[0] * size[1] * 2);
  return { width: size[0], height: size[1], at: (x, y) => file.readUInt16LE((y * size[0] + x) * 2), hash };
}
/** Rec. 709 luminance of a linear color, and of a linear target's pixel. */
export const luma = (c: Lin): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
export const lumaAt = (im: F32, x: number, y: number): number => { const o = (y * im.width + x) * 4; return 0.2126 * im.rgba[o]! + 0.7152 * im.rgba[o + 1]! + 0.0722 * im.rgba[o + 2]!; };

// ---------------------------------------------------------------------------------------------------
// Color in f64

export const clamp01 = (x: number): number => (Number.isNaN(x) ? 0 : Math.min(1, Math.max(0, x)));
export const srgbEncode = (x: number): number => { const v = clamp01(x); return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; };
export const srgbDecode = (v: number): number => { const c = clamp01(v); return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export const decode8 = (c: Rgb): Lin => c.map((v) => srgbDecode(v / 255)) as Lin;
export const hex = (c: Rgb): string => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
export function fromHex(h: string): Rgb {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h);
  if (!m) throw Error(`not a #rrggbb color: ${h}`);
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}
export const maxDiff = (a: Rgb, b: Rgb): number => Math.max(...[0, 1, 2].map((c) => Math.abs(a[c]! - b[c]!)));
/** A 32-bit linear congruential generator (Numerical Recipes' constants), uniform in [0, 1). */
export class Lcg {
  private x: number;
  constructor(seed: number) { this.x = seed >>> 0; }
  next(): number { this.x = (Math.imul(1664525, this.x) + 1013904223) >>> 0; return this.x / 4294967296; }
}

// ---------------------------------------------------------------------------------------------------
// 2D looks and documents (README: The documents)

const BASE_LOOK = JSON.parse(readFileSync(join(HERE, 'fixtures', 'look.json'), 'utf8')) as JsonObject;
/**
 * A 2D `look@1` on a drawing basis: fixtures/look.json (white ground, graphite ink, the clean status map), with each of
 * `colors` added as a palette entry and a role of that name, then `change` replacing or adding top-level fields
 * (`separations`, `finish`, `basis`, `grade`, …).
 */
export function look2d(id: string, colors: Record<string, string>, change: JsonObject = {}): JsonObject {
  const palette = { ...obj(BASE_LOOK['palette'], 'palette') };
  const roles = { ...obj(BASE_LOOK['roles'], 'roles') };
  for (const [role, c] of Object.entries(colors)) { palette[`c-${role}`] = c; roles[role] = `c-${role}`; }
  return { ...BASE_LOOK, id, description: `The #464 acceptance look ${id}.`, palette, roles, ...change };
}
/** The base look's ink (role `ink`, palette graphite), the vignette's color. */
export const INK: Rgb = fromHex('#1b1d22');
export const WRITER = 'agent-a';
/** A 2D document, one writer layer `main`, items keyed by ID. */
export function doc2d(id: string, size: readonly [number, number], items: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    format: 1, id, profile: 'figure', title: `Fixture ${id}`, description: `The #464 acceptance fixture ${id}.`, size: [...size], seed: 464,
    transport: { span: '8s' }, requires: { modules: { effects: '^1' } }, budget: { class: 'showpiece' },
    layers: { main: { writer: WRITER, title: 'Main', order: 'a1' } },
    items: Object.fromEntries(items.map((i) => [i['id'] as string, i])), ...extra,
  };
}
export const item = (id: string, kind: string, order: string, params: JsonObject, extra: JsonObject = {}): JsonObject =>
  ({ id, kind, layer: 'main', name: id, order, params, ...extra });
export const rect = (id: string, order: string, box: [number, number, number, number], role: string, extra: JsonObject = {}): JsonObject =>
  item(id, 'rect@1', order, { box, paint: { fill: { role } } }, extra);
export const circle = (id: string, order: string, center: [number, number], r: number, role: string, extra: JsonObject = {}): JsonObject =>
  item(id, 'circle@1', order, { center, r, paint: { fill: { role } } }, extra);
export const line = (id: string, order: string, from: [number, number], to: [number, number], width: number, role: string): JsonObject =>
  item(id, 'path@1', order, { d: `M ${from[0]} ${from[1]} L ${to[0]} ${to[1]}`, paint: { stroke: { role, width } } });
/** `film2d` (#417, #149) with this suite's fields (README: The surface under test). */
export const film2d = (doc: JsonObject, look: JsonObject, extra: JsonObject): JsonObject => ({ call: 'film2d', doc, look, hash: true, ...extra });

/** A flat frame: one rect of `role` over the whole document. */
export const flat = (id: string, size: readonly [number, number], role?: string): JsonObject =>
  doc2d(id, size, role ? [rect('flat', 'a0', [0, 0, size[0], size[1]], role)] : []);

/** The indexed basis's 4 × 4 ordered (Bayer) matrix, read at (x mod 4, y mod 4) of the target pixel as BAYER4[y][x]. */
export const BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]] as const;
/** The indexed fixtures' target and scale: 320 × 180 at scale 4, so the document and the frame are 1280 × 720. */
export const TARGET: [number, number] = [320, 180];
export const SCALE = 4;
export const FRAME_SIZE: [number, number] = [TARGET[0] * SCALE, TARGET[1] * SCALE];
/** A document box for a box in target pixels. */
export const tbox = (x: number, y: number, w: number, h: number): [number, number, number, number] => [x * SCALE, y * SCALE, w * SCALE, h * SCALE];
/** An indexed look: `palette` in index order (index i is palette[i]), each role's color in `colors`, and `indexed` fields beside size, scale and snap. */
export function indexedLook(id: string, colors: Record<string, string>, palette: string[], indexed: JsonObject = {}): JsonObject {
  return look2d(id, colors, { basis: { indexed: { size: TARGET, scale: SCALE, palette: ['ground', ...palette], tables: {}, protected: [], snap: 'integer', ...indexed } } });
}
/** The reply's `indexed` record: the class of the operator the index target was read back from, and the palette in index order. */
export function indexedOf(reply: JsonObject, what: string): { cls: string; operator: string; palette: string[] } {
  const r = obj(answered(reply, what)['indexed'], `${what}: indexed`);
  return { cls: str(r['class'], `${what}: indexed.class`), operator: str(r['operator'], `${what}: indexed.operator`), palette: arr(r['palette'], `${what}: indexed.palette`).map((p, i) => str(p, `${what}: indexed.palette[${i}]`)) };
}

// ---------------------------------------------------------------------------------------------------
// 3D: #382's film under a physical look (#418's), for the status report and the grade.

export const STATES = ['pass', 'fail', 'invalid', 'blocked', 'inconclusive', 'running', 'needs_you', 'stale', 'idle'] as const;
export const STATUS: Record<(typeof STATES)[number], string> = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
export const FAIL = fromHex(STATUS.fail);
const GLYPHS: Record<(typeof STATES)[number], string> = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
const FONTS: JsonObject = {
  body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
};
/** #418's physical look: the clean status map, tone map none at the exposure whose scale is 1, the finish at identity. */
export function look3d(id: string, roles: Record<string, string>, change: JsonObject = {}): JsonObject {
  const palette: JsonObject = { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97' };
  const roleMap: JsonObject = { ground: 'night', ink: 'graphite', muted: 'slate' };
  for (const [role, c] of Object.entries(roles)) { palette[`c-${role}`] = c; roleMap[role] = `c-${role}`; }
  return {
    id, format: 1, basis: 'physical', license: 'Apache-2.0', description: `The #464 acceptance look ${id}.`,
    palette, roles: roleMap, themes: { light: {}, dark: {} },
    status: { ...STATUS }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: 0.1,
    attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto', fonts: FONTS,
    tone_map: 'none', exposure: Math.log2(1 / 1.2), finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' },
    ...change,
  };
}
export const FILM_ROLES: Record<string, string> = { lamp: '#d9a441', block: '#b8bcc4', crate: '#7fa7c9', floor: '#2a2d33' };
export const VERDICT = 'verdict:01JB4640000000000000000464';
export const FAILED: JsonObject = { [VERDICT]: 'fail' };
type V3 = [number, number, number];
const solid = (id: string, order: string, size: V3, pos: V3, role: string): JsonObject =>
  ({ id, kind: 'mark.box@1', name: id, order, layer: 'main', params: { size, paint: { fill: { role } } }, at: { pos } });
/** #382's film: three boxes on a floor under a sun, seen from the front (480 × 360); with `bound`, the lamp's badge bound to the verdict. */
export function film3d(id: string, bound = true): JsonObject {
  const items: JsonObject[] = [
    { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', layer: 'main', params: { projection: 'perspective', target: [0, 0.6, 0], orbit: { azimuth: 0, elevation: 0, distance: 7 }, fov: 40, near: 0.1 } },
    solid('floor', 'a1', [12, 0.1, 12], [0, -0.05, 0], 'floor'),
    solid('lamp', 'a2', [1.2, 1.2, 1.2], [0, 0.6, 0], 'lamp'),
    solid('block', 'a3', [0.8, 0.8, 0.8], [-1.8, 0.4, 0.4], 'block'),
    solid('crate', 'a4', [0.8, 0.8, 0.8], [1.8, 0.4, -0.4], 'crate'),
    { id: 'sun', kind: 'light.sun@1', name: 'Sun', order: 'z0', layer: 'main', params: { illuminance: Math.PI, shadow: false, angle: 0.53 }, at: { rot: [0, 0, 0] } },
  ];
  return {
    format: 1, id, profile: 'scene', title: `Film ${id}`, description: 'Three boxes on a floor under a sun, seen from the front.', size: [480, 360], camera: 'cam',
    transport: { span: '2s' }, requires: { modules: { scene3d: '^1', effects: '^1' } }, layers: { main: { writer: WRITER, title: 'Main', order: 'a0' } },
    items: Object.fromEntries(items.map((i) => [i['id'] as string, i])),
    ...(bound ? { status_bindings: { 'b-lamp': { target: 'items/lamp/params/paint/badge', source: VERDICT } } } : {}),
  };
}
type Box = [number, number, number, number];
function box(v: JsonValue | undefined, what: string): Box {
  const a = arr(v, what);
  expect(a.length, `${what} is [x, y, w, h]`).toBe(4);
  return a.map((x, i) => num(x, `${what}[${i}]`)) as Box;
}
/** The most common color among the pixels `keep` selects. */
export function mode(image: Image, keep: (x: number, y: number) => boolean): Rgb {
  const counts = new Map<string, number>();
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) if (keep(x, y)) { const k = pixel(image, x, y).join(); counts.set(k, (counts.get(k) ?? 0) + 1); }
  let best = '0,0,0'; let n = -1;
  for (const [k, c] of counts) if (c > n) { best = k; n = c; }
  return best.split(',').map(Number) as Rgb;
}
const inBox = ([bx, by, bw, bh]: Box, shrink: number) => (x: number, y: number): boolean =>
  x + 0.5 >= bx + shrink && x + 0.5 <= bx + bw - shrink && y + 0.5 >= by + shrink && y + 0.5 <= by + bh - shrink;
/**
 * Status colors exact (#382's status report on a `view3d` reply): the fail mark reports the fail color and its bounds'
 * most common pixel is that color, and so is the legend's fail swatch. Returns the failures, each naming what differs.
 */
export function statusExact(reply: JsonObject, final: Image, what: string): string[] {
  const s = obj(reply['status'], `${what}: status`);
  const problems: string[] = [];
  if (s['shows'] !== true) problems.push(`${what}: status.shows is not true for a document with a status binding`);
  const mark = objs(s['marks'], `${what}: status.marks`).find((m) => m['state'] === 'fail');
  if (!mark) problems.push(`${what}: no fail mark is drawn`);
  else {
    const m = mode(final, inBox(box(mark['bounds'], `${what}: the fail mark's bounds`), 1));
    if (hex(m) !== hex(FAIL)) problems.push(`${what}: the fail mark's most common pixel is ${hex(m)}, not ${hex(FAIL)}`);
  }
  const entry = objs(s['legend'], `${what}: status.legend`).find((e) => e['state'] === 'fail');
  if (!entry) problems.push(`${what}: the legend has no fail entry`);
  else {
    const m = mode(final, inBox(box(entry['swatch'], `${what}: the legend's fail swatch`), 1));
    if (hex(m) !== hex(FAIL)) problems.push(`${what}: the legend's fail swatch draws ${hex(m)}, not ${hex(FAIL)}`);
  }
  return problems;
}
