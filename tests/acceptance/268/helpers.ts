// Test-side tools for the #268 acceptance tests: `deep-gpu` (#377's binary, with #378's `view3d` and #166's water),
// built once per file and driven by JSON lines; the documents the tests draw (the pile, the quay, the deck and the
// harbour that holds all three), generated here so every value is readable; the closed forms the readbacks are held to
// (#166's trochoidal wave, the issue's calm factor); #378's pinhole and the ray from a pixel to the water at rest; the
// reply readers (f32 targets, the shore row); the five-run budget judge and the machine's fingerprint, read from the
// perf lane's own scripts/benchmark.mjs in a child process. Suites don't import each other, so what this file shares
// with #166's helpers is repeated here. Each check a planted twin must fail returns its failures as sentences naming
// what failed.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, homedir, loadavg, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from 'vitest';

vi.setConfig({ testTimeout: 3_600_000, hookTimeout: 3_600_000 });

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type V3 = [number, number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/268 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** Each criterion's ID: the first 8 hex digits of SHA-256 of its text, trimmed, white space collapsed (README). */
export const AC = {
  1: '#268.ed64c4a9', 2: '#268.2a540142', 3: '#268.7e7ee25a', 4: '#268.a0c77147', 5: '#268.d5fcb247', 6: '#268.b2dd7e77', 7: '#268.f8d9db3f',
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
  const dir = process.env['DEEPBUILD_EVIDENCE_DIR'] ?? join(tmpdir(), 'deep-268-evidence');
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
    dir = mkdtempSync(join(tmpdir(), 'deep-268-bin-'));
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
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-268-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one scenario in, one line out (#377).

/** The wrong programs this suite adds to `deep-gpu run`, reachable only through `--planted` (README). */
export type Planted = 'shore_field_from_centre' | 'shore_calm_ignores_field';

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
/** A reply refused at check (a `code` other than a platform gap) whose text names `name` as a whole ID. */
export function refusedNaming(reply: JsonObject, name: string, what: string): void {
  expect(reply['code'], `${what} is refused at check: ${shown(reply)}`).toBeDefined();
  expect(reply['code'], `${what}: refused, not reported as a platform gap`).not.toBe('unsupported_platform');
  const escaped = name.replace(/[.*+?^${}()|[\]\\#]/g, '\\$&');
  expect(JSON.stringify(reply), `${what}: the refusal names ${name}: ${shown(reply)}`).toMatch(new RegExp(`(^|[^A-Za-z0-9_#-])${escaped}($|[^A-Za-z0-9_#-])`));
}

/** The targets this suite reads: the base's `final` and `pre_tone`, #166's `depth`, and this suite's `foam` (README). */
export type Target = 'final' | 'pre_tone' | 'depth' | 'foam';
/** `view3d` (#378, #166): the base's fields, with `patches` (a writer's revision before the frame it names), and this
 * suite's `shore` (README). */
export interface View3d {
  doc: string; look: JsonObject; size: [number, number]; frames?: number; fps?: number; from?: number;
  capture?: 'every' | number[]; targets?: Target[]; timings?: boolean; shore?: boolean;
  patches?: { frame: number; writer: string; ops: JsonObject[] }[];
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
export function readFloats(out: string, f: Frame, target: 'pre_tone' | 'depth' | 'foam', size: readonly [number, number], what: string): Floats {
  const channels = target === 'pre_tone' ? 4 : 1;
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
/** The value of a one-channel float target at pixel (x, y). */
export const at1 = (t: Floats, x: number, y: number): number => t.v[y * t.width + x]!;

/** A frame row's `shore` (README: `shore: true`): the water's material, its field's key, and the field's bytes. */
export interface ShoreRow { material: string; key: string; field: string; bakeMs: number; bytes: Buffer }
export function shoreOf(out: string, f: Frame, what: string): ShoreRow {
  const s = obj(f.raw['shore'], `${what}: frame ${f.frame}'s shore`);
  const key = str(s['key'], `${what}: shore.key`);
  expect(key.length, `${what}: shore.key is not empty`).toBeGreaterThan(0);
  const field = str(s['field'], `${what}: shore.field`);
  return {
    material: str(s['material'], `${what}: shore.material`), key, field,
    bakeMs: num(s['bake_ms'], `${what}: shore.bake_ms`), bytes: readNamed(out, field, 'bin', `${what}: the shore field`),
  };
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
    id, format: 1, basis: 'physical', license: 'Apache-2.0', description: `The #268 acceptance look ${id}.`,
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
export const FILMIC = look3d('filmic-268', { tone_map: 'filmic', exposure: 0 });

export const WRITER = 'agent:sess-alpha';
export const SEED = 268;
/** A scene document as a session holds it (#378): every item in the one writer layer `main`, camera `cam`. */
export function sceneDoc(id: string, size: readonly [number, number], items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #268 acceptance fixture.`, size: [...size], camera: 'cam', seed: SEED,
    transport: { span: '30s' }, requires: { modules: { scene3d: '^1' } }, budget: { class: 'showpiece' },
    layers: { main: { writer: WRITER, title: 'main', order: 'a0' } }, ...extra, items: withIds,
  };
}
export const camera = (position: V3, target: V3, fov: number): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov, near: 0.1, far: 1000 } });
export const material = (params: JsonObject): JsonObject => ({ kind: 'material@1', params });
/** A box `size` (x, y, z) centred on `pos`. */
export const box = (size: V3, pos: V3, mat: string): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos }, material: mat });
/** An upright cylinder (#378's `mark.cylinder@1`: its unit shape is radius 0.5 and height 1 about +Y), `size` (x, y, z)
 * centred on `pos`: [2r, h, 2r] is a cylinder of radius r and height h. */
export const cylinder = (size: V3, pos: V3, mat: string): JsonObject => ({ kind: 'mark.cylinder@1', params: { size }, at: { pos }, material: mat });
/** A planar part: `plate@1` (#383's builder), a `size[0]` × `size[1]` rectangle of `grid` cells in its own XZ plane at
 * y = 0, facing +Y, centred on `pos`, unturned. */
export const plate = (size: [number, number], grid: [number, number], pos: V3, mat: string): JsonObject =>
  ({ kind: 'plate@1', params: { grid, size }, at: { pos }, material: mat });
/** A day sky with a gray ambient gradient. */
export const DAY_SKY: JsonObject = { kind: 'sky@1', params: { top: [0.15, 0.3, 0.75, 1], low: [0.6, 0.7, 0.85, 1], ambient_top: [0.25, 0.25, 0.25], ambient_low: [0.1, 0.1, 0.1] } };
export const sun = (illuminance: number, rot: V3): JsonObject => ({ kind: 'light.sun@1', params: { illuminance, color: [1, 1, 1], shadow: false }, at: { rot } });
/** A linear f32 channel on an item's path, keyed at seconds (`[t s, value]`). */
export function channel(target: string, keys: [number, number][]): JsonObject {
  return { target, type: 'f32', keys: Object.fromEntries(keys.map(([t, value], k) => [`k${k}`, { t: `${t}s`, value, interp: 'linear' }])) };
}
/** A document collection by list (`collections: {ID → {members: [ID]}}`). */
export const collection = (members: string[]): JsonObject => ({ members });
/** A writer's `set` op on an item's path, as #378's patches carry it. */
export const set = (id: string, path: string, value: JsonValue): JsonObject => ({ op: 'set', id, path: `items/${id}/${path}`, value });

// ---------------------------------------------------------------------------------------------------
// Material: water, with the issue's `shore` (its Fields row, as it names them)

/** One trochoidal wave as #166 lists it: `{direction: deg, length: m, amplitude: m, steepness: 0..1}`. */
export interface Wave { direction: number; length: number; amplitude: number; steepness: number }
/** The issue's `shore`: `items` names a document collection; fields left out take the Fields row's defaults. */
export interface Shore {
  items: string; cell?: number;
  foam?: { width?: number; strength?: number; breakup?: number };
  calm?: { near?: number; far?: number };
  shade?: number;
}
/** The `water` field (#166's, with `shore`). Fields left out take the design's defaults. */
export interface Water {
  waves?: { wind: { speed?: number; direction?: number } } | Wave[];
  ripples?: { scale?: number; strength?: number };
  rain?: number;
  foam?: { threshold?: number };
  shore?: Shore | 'none';
}
/** A `material@1` carrying `water`. */
export const waterMaterial = (water: Water, extra: JsonObject = {}): JsonObject => material({ roughness: 0.05, ...extra, water: water as unknown as JsonObject });
/** A flat lake: one wave of amplitude 0, no ripples, no rain, and the steepness foam off (threshold 1). */
export const STILL: Water = { waves: [{ direction: 0, length: 10, amplitude: 0, steepness: 0 }], ripples: { strength: 0 }, rain: 0, foam: { threshold: 1 } };
/** #166's four lake waves. */
export const LAKE_WAVES: Wave[] = [
  { direction: 20, length: 9, amplitude: 0.12, steepness: 0.5 },
  { direction: 110, length: 6, amplitude: 0.08, steepness: 0.6 },
  { direction: 235, length: 4.5, amplitude: 0.05, steepness: 0.4 },
  { direction: 300, length: 3.2, amplitude: 0.03, steepness: 0.7 },
];

/** g for the deep-water dispersion relation ω = √(g k) (#166). */
export const G = 9.81;
/** One wave's height at rest point (x0, z0) and t in #166's closed form: A cos θ, θ = k (D · (x0, z0)) − √(g k) t,
 * D = (sin d, cos d) in (x, z), k = 2π ÷ length. With steepness 0 the point moves only up and down. */
export function waveHeight(w: Wave, x0: number, z0: number, t: number): number {
  const d = (w.direction * Math.PI) / 180;
  const k = (2 * Math.PI) / w.length;
  return w.amplitude * Math.cos(k * (Math.sin(d) * x0 + Math.cos(d) * z0) - Math.sqrt(G * k) * t);
}
const smoothstep = (e0: number, e1: number, x: number): number => { const u = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return u * u * (3 - 2 * u); };
/** The issue's calm factor at distance d: mix(near, 1, smoothstep(0, far, d)). */
export const calmFactor = (near: number, far: number, d: number): number => near + (1 - near) * smoothstep(0, far, d);

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

/** The pile fixture: a 20 m × 20 m plate `lake` (256 × 256 cells) at y = 0 whose material `pile-water` carries `water`
 * (STILL unless given), and a pile `pile` of 1 m radius standing through the water at the origin from 2 m below it to
 * 0.1 m above it, the one member of the collection `pile-shore`; a day sky and a sun. `extra` adds items, `collections`
 * replaces the document's collections, `docExtra` adds document sections. */
export function pileDoc(id: string, size: readonly [number, number], cam: JsonObject, water: Water, opts: {
  extra?: Record<string, JsonObject>; collections?: Record<string, JsonObject>; docExtra?: JsonObject; plateSize?: [number, number];
} = {}): JsonObject {
  return sceneDoc(id, size, {
    cam, sky: DAY_SKY, sun: sun(3, [-35, 30, 0]),
    'pile-water': waterMaterial(water),
    'pile-wood': material({ base_color: [0.42, 0.3, 0.2, 1], roughness: 0.8 }),
    lake: plate(opts.plateSize ?? [20, 20], [256, 256], [0, 0, 0], 'pile-water'),
    pile: cylinder([2, 2.1, 2], [0, -0.95, 0], 'pile-wood'),
    ...(opts.extra ?? {}),
  }, { collections: opts.collections ?? { 'pile-shore': collection(['pile']) }, ...(opts.docExtra ?? {}) });
}
/** The shore of the pile fixture with the steepness foam off and a solid band (breakup 0). */
export const PILE_SHORE: Shore = { items: 'pile-shore', foam: { width: 0.5, breakup: 0 } };

/** The quay's one wave: along +Z, 8 m long, 0.4 m high, steepness 0, so a point moves only up and down. */
export const QUAY_WAVE: Wave = { direction: 0, length: 8, amplitude: 0.4, steepness: 0 };
/** The quay fixture: a 32 m × 8 m plate `lake` of 640 × 160 cells (5 cm) spanning x from −2 to 30 m, whose material
 * `quay-water` carries QUAY_WAVE (no ripples, no rain, the steepness foam off) and `shore: {items: "quay-shore", calm}`;
 * a quay `quay`, a box from x = −6 to 0 m, z = −4 to 4 m and y = −2 to 1 m, so its straight face x = 0 meets the water
 * along z; a day sky and a sun. */
export function quayDoc(id: string, size: readonly [number, number], cam: JsonObject, calm: { near: number; far: number }, waves: Wave[] = [QUAY_WAVE]): JsonObject {
  return sceneDoc(id, size, {
    cam, sky: DAY_SKY, sun: sun(3, [-35, 30, 0]),
    'quay-water': waterMaterial({ waves, ripples: { strength: 0 }, rain: 0, foam: { threshold: 1 }, shore: { items: 'quay-shore', calm } }),
    'quay-stone': material({ base_color: [0.55, 0.53, 0.5, 1], roughness: 0.9 }),
    lake: plate([32, 8], [640, 160], [14, 0, 0], 'quay-water'),
    quay: box([6, 3, 8], [-3, -0.5, 0], 'quay-stone'),
  }, { collections: { 'quay-shore': collection(['quay']) } });
}

/** The deck's half size: its footprint is x and z within ±2.5 m. */
export const DECK_HALF = 2.5;
/** The deck fixture: a 20 m × 20 m STILL plate `lake` (64 × 64 cells) whose material `deck-water` carries `shore:
 * {items: "deck-shore", shade}`, and a floating deck `deck`, a 5 m × 0.2 m × 5 m box over the origin from 0.5 to 0.7 m
 * above the water, the one member of `deck-shore`; a day sky and a sun. */
export function deckDoc(id: string, size: readonly [number, number], cam: JsonObject, shade: number): JsonObject {
  return sceneDoc(id, size, {
    cam, sky: DAY_SKY, sun: sun(3, [-35, 30, 0]),
    'deck-water': waterMaterial({ ...STILL, shore: { items: 'deck-shore', shade } }),
    'deck-wood': material({ base_color: [0.6, 0.45, 0.3, 1], roughness: 0.7 }),
    lake: plate([20, 20], [64, 64], [0, 0, 0], 'deck-water'),
    deck: box([2 * DECK_HALF, 0.2, 2 * DECK_HALF], [0, 0.6, 0], 'deck-wood'),
  }, { collections: { 'deck-shore': collection(['deck']) } });
}

/** A harbour holding all three (criterion 5, the taste call): a 40 m × 40 m plate `lake` (256 × 256 cells) whose
 * material `harbour-water` carries `water` (LAKE_WAVES, ripples 0.3 unless given), a pile `pile` at (−4, −3), a quay
 * `quay` from x = 14 to 20 m along the plate's east side, a floating deck `deck` 4 m × 6 m over (6, −2), all three in
 * `harbour-shore`; seen from a low camera. */
export function harbourDoc(id: string, size: readonly [number, number], water: Water): JsonObject {
  return sceneDoc(id, size, {
    cam: camera([0, 3, 16], [2, 0, -2], 55), sky: DAY_SKY, sun: sun(3, [-35, 30, 0]),
    'harbour-water': waterMaterial(water),
    wood: material({ base_color: [0.5, 0.36, 0.24, 1], roughness: 0.8 }),
    stone: material({ base_color: [0.55, 0.53, 0.5, 1], roughness: 0.9 }),
    lake: plate([40, 40], [256, 256], [0, 0, 0], 'harbour-water'),
    pile: cylinder([1.2, 4, 1.2], [-4, 0, -3], 'wood'),
    quay: box([6, 3, 40], [17, -0.5, 0], 'stone'),
    deck: box([4, 0.2, 6], [6, 0.6, -2], 'wood'),
  }, { collections: { 'harbour-shore': collection(['pile', 'quay', 'deck']) } });
}
/** The harbour's shore with every part of the issue's on: a broken foam band, the calm swell and the deck's shade. */
export const HARBOUR_SHORE: Shore = { items: 'harbour-shore', foam: { width: 0.5, breakup: 0.5 }, calm: { near: 0.25, far: 20 }, shade: 0.6 };
