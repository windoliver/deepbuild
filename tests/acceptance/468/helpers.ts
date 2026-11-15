// Test-side tools for the #468 acceptance tests (README: The surface under test). `deep-gpu` (#377's binary, with #378's
// `view3d` and #417's `film2d`) is built once per file and driven by JSON lines; this file adds the criterion IDs, the
// planted names, the documents and the looks the criteria draw, the reply readers (the f32 targets, `values`,
// `projected`, `overlays`), the reviewed references the criteria are held to (#378's pinhole, the orbit, the lens's
// closed forms, in_out_cubic), the disc measurement, and the perf lane's own five-run judge, read from
// scripts/benchmark.mjs in a child process. Nothing here stands in for the lens, the depth of field, the leader or the
// projection under test: every value a test compares comes from a binary, every expected value from the issue's text
// worked here.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from 'vitest';

vi.setConfig({ testTimeout: 3_600_000, hookTimeout: 7_200_000 });

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type V3 = [number, number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/468 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
/** Every `it` passes this timeout: a first cargo build on the shared Mac takes many minutes. */
export const TIMEOUT = 3_600_000;

/** Each criterion's ID (scripts/proof-change.mjs, `criterionId`: `#468.` and the first 8 hex of SHA-256 of its text). */
export const AC = {
  1: 'AC1 #468.01baeaa5',
  2: 'AC2 #468.75d393c7',
  3: 'AC3 #468.632af807',
  4: 'AC4 #468.7ecff161',
  5: 'AC5 #468.43d77df2',
  6: 'AC6 #468.1d583371',
  7: 'AC7 #468.af788480',
  8: 'AC8 #468.ce8ac7ee',
} as const;

// ---------------------------------------------------------------------------------------------------
// JSON and verdict words

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const shown = (v: JsonValue | undefined, n = 1500): string => JSON.stringify(v)?.slice(0, n) ?? 'undefined';
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
/** `[x, y]` or `[x, y, z]` of finite numbers. */
export function vec(v: JsonValue | undefined, n: 2 | 3, what: string): number[] {
  const a = arr(v, what);
  expect(a.length, `${what} has ${n} numbers, got ${shown(v)}`).toBe(n);
  return a.map((x, i) => num(x, `${what}[${i}]`));
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
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 30).join('\n  ')}`).toEqual([]);
}
/** A planted program's check: it found failures, and one names each of `names`. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  for (const n of names) expect(failures.some((f) => f.includes(n)), `${what}: a failure names ${n}; the failures were:\n  ${failures.slice(0, 30).join('\n  ')}`).toBe(true);
}
/** A seeded generator (mulberry32): the same seed gives the same times on every run. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
export const median = (xs: readonly number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]!; };

// ---------------------------------------------------------------------------------------------------
// The machine

/** Everything here draws on macOS's Metal device, the reference platform; off it, INCONCLUSIVE. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these pixels on macOS's Metal device; this is ${process.platform}`);
}
/** The one-minute load average, read at a timed run's start and end. */
export const load = (): number => loadavg()[0]!;
/** Runs the perf lane's own scripts/benchmark.mjs in a child process (its `fingerprint`, `judgeLimit` and
 * `validateBudgets`), so a budget is judged exactly as the lane judges it. */
export function lane(code: string, input: JsonValue = null): JsonValue {
  const script = `import * as b from ${JSON.stringify(join(REPO, 'scripts', 'benchmark.mjs'))};\nconst input = JSON.parse(process.argv[1]);\nconst out = await (async () => { ${code} })();\nprocess.stdout.write(JSON.stringify(out ?? null));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(input)], { cwd: REPO, encoding: 'utf8', timeout: 120_000 });
  expect(r.status, `scripts/benchmark.mjs ran: ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
  return JSON.parse(r.stdout) as JsonValue;
}
export interface Load { start: number; end: number }
/** The lane's verdict on five readings of `limit` taken under `loads` on this machine (PASS, FAIL, INCONCLUSIVE). */
export function judgeLimit(limit: number, runs: number[], loads: Load[]): JsonObject {
  return obj(lane('return b.judgeLimit({ limit: input.limit, runs: input.runs, fingerprint: b.fingerprint(), loads: input.loads });', { limit, runs, loads: loads as unknown as JsonValue }), 'judgeLimit');
}
/** Why a timing can't count on this machine now (off the reference Macs, not on mains, Low Power Mode, thermal state
 * or loaded past its cores, as the lane's `judgeLimit` reads it), or '' when it can. Nothing waits for it to change. */
export function timingProblem(): string {
  const l = load();
  const v = judgeLimit(1, [0, 0, 0, 0, 0], Array.from({ length: 5 }, () => ({ start: l, end: l })));
  return v['status'] === 'PASS' ? '' : String(v['reason'] ?? v['status']);
}

// ---------------------------------------------------------------------------------------------------
// The build: deep-gpu built once per file and copied out of the target folder.

const CARGO_ARGS = ['build', '--locked', '--bin', 'deep-gpu'];
const targetDir = (): string => { const t = process.env['CARGO_TARGET_DIR']; return t ? resolve(REPO, t) : join(REPO, 'target'); };
function cargoBuild(): string {
  const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const r = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${CARGO_ARGS.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
/** Builds deep-gpu before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useGpu(): () => string {
  let dir = ''; let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-468-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(targetDir(), 'debug', 'deep-gpu'), join(dir, 'deep-gpu'));
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => { expect(error, `deep-gpu builds: cargo ${CARGO_ARGS.join(' ')}`).toBe(''); return join(dir, 'deep-gpu'); };
}
/** A fresh output folder per test, deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-468-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one scenario line in, one line out (#377).

/** The wrong program this suite adds to `deep-gpu run`, reachable only through `--planted` (README: Planted programs). */
export type Planted = 'coc_linear_in_distance';

/** One `deep-gpu` process: the calls in order, a reply per call. */
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
  if (a['code'] === 'unsupported_platform') inconclusive(`${label} reports unsupported_platform`);
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

/** `view3d` (#378 and the suites after it), with the fields this suite adds (README: Assumed surfaces). */
export interface View3d {
  doc: string; size: [number, number]; look?: JsonObject; frames?: number; fps?: number; from?: number;
  capture?: 'every' | number[]; targets?: ('final' | 'pre_tone' | 'coc')[]; timings?: boolean;
  packs?: JsonObject[]; looks?: Record<string, JsonObject>;
  /** #429's: each frame's `values` of these paths. */
  evaluate?: string[];
  /** Assumed surface 3: world points (m) each frame projects through the camera it draws. */
  project?: number[][];
  /** Assumed surface 4: each frame's overlays and their leaders. */
  overlays?: boolean;
}
export const view3d = (v: View3d): JsonObject => ({ call: 'view3d', look: PLAIN_LOOK, frames: 1, fps: 60, ...(v as unknown as JsonObject) });

/** A frame row of `view3d` or `film2d`. */
export interface Frame { frame: number; pixel_hash: string | null; raw: JsonObject }
export function framesOf(reply: JsonObject, what: string): Frame[] {
  answered(reply, what);
  return arr(reply['frames'], `${what}: frames`).map((v, i): Frame => {
    const f = obj(v, `${what}: frames[${i}]`);
    const h = f['pixel_hash'];
    return { frame: num(f['frame'], `${what}: frames[${i}].frame`), pixel_hash: typeof h === 'string' ? h : null, raw: f };
  });
}
export function frameAt(frames: Frame[], n: number, what: string): Frame {
  const f = frames.find((x) => x.frame === n);
  expect(f, `${what}: frame ${n} is in the reply (frames ${frames.slice(0, 12).map((x) => x.frame).join(', ')}…)`).toBeDefined();
  return f!;
}
/** The one value `evaluate` reports for `path` on a frame (#429's `values`). */
export function valueAt(f: Frame, path: string, what: string): JsonValue {
  const values = obj(f.raw['values'], `${what}: frame ${f.frame}'s values (evaluate)`);
  expect(path in values, `${what}: frame ${f.frame}'s values hold ${path}: ${shown(values)}`).toBe(true);
  return values[path]!;
}
/** Assumed surface 3: a frame's `projected`, one `[x, y]` (frame px) or null per point of the call's `project`. */
export function projectedOf(f: Frame, count: number, what: string): ([number, number] | null)[] {
  const rows = arr(f.raw['projected'], `${what}: frame ${f.frame}'s projected`);
  expect(rows.length, `${what}: frame ${f.frame} projects each of the ${count} points`).toBe(count);
  return rows.map((p, i) => (p === null ? null : (vec(p, 2, `${what}: frame ${f.frame}'s projected[${i}]`) as [number, number])));
}
/** Assumed surface 4: an overlay's row on a frame. */
export interface Overlay { shown: boolean; leader: { from: [number, number]; to: [number, number] } | null }
export function overlayOf(f: Frame, id: string, what: string): Overlay {
  const all = obj(f.raw['overlays'], `${what}: frame ${f.frame}'s overlays`);
  const o = obj(all[id], `${what}: frame ${f.frame}'s overlays.${id}`);
  expect(typeof o['shown'], `${what}: frame ${f.frame}'s overlays.${id}.shown is a bool, got ${shown(o)}`).toBe('boolean');
  const l = o['leader'];
  if (l === null || l === undefined) return { shown: o['shown'] as boolean, leader: null };
  const lo = obj(l, `${what}: frame ${f.frame}'s overlays.${id}.leader`);
  return {
    shown: o['shown'] as boolean,
    leader: { from: vec(lo['from'], 2, `${what}: leader.from`) as [number, number], to: vec(lo['to'], 2, `${what}: leader.to`) as [number, number] },
  };
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
/** A one-channel picture of floats, rows top-down. */
export interface Plane { width: number; height: number; v: Float64Array }
export const at = (p: Plane, x: number, y: number): number => (x < 0 || y < 0 || x >= p.width || y >= p.height ? 0 : p.v[y * p.width + x]!);
/** `pre_tone` (#418: the linear image the tone-mapping pass reads, after the effects chain, before exposure), as Rec.
 * 709 luminance: little-endian f32 RGBA, rows top-down, `w × h × 16` bytes. */
export function readPreTone(out: string, f: Frame, size: readonly [number, number], what: string): Plane {
  const file = readNamed(out, f.raw['pre_tone'], 'f32', `${what}: pre_tone`);
  expect(file.length, `${what}: pre_tone holds ${size[0]} × ${size[1]} f32 RGBA pixels`).toBe(size[0] * size[1] * 16);
  const v = new Float64Array(size[0] * size[1]);
  for (let i = 0; i < v.length; i++) v[i] = 0.2126 * file.readFloatLE(i * 16) + 0.7152 * file.readFloatLE(i * 16 + 4) + 0.0722 * file.readFloatLE(i * 16 + 8);
  return { width: size[0], height: size[1], v };
}
/** Assumed surface 2: `coc`, each pixel's signed circle of confusion in frame px (its diameter): little-endian f32,
 * one a pixel, rows top-down, `w × h × 4` bytes, as `depth` is written. */
export function readCoc(out: string, f: Frame, size: readonly [number, number], what: string): Plane {
  const file = readNamed(out, f.raw['coc'], 'f32', `${what}: coc`);
  expect(file.length, `${what}: coc holds ${size[0]} × ${size[1]} f32 pixels`).toBe(size[0] * size[1] * 4);
  const v = new Float64Array(size[0] * size[1]);
  for (let i = 0; i < v.length; i++) v[i] = file.readFloatLE(i * 4);
  return { width: size[0], height: size[1], v };
}

// ---------------------------------------------------------------------------------------------------
// Looks and documents (README: Documents)

const STATUS: JsonObject = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
const FONTS: JsonObject = {
  body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
};
/** A physical-basis `look@1` (#421's, #424's shape): tone map none at the exposure whose scale is 1, no bloom, no
 * finish, so `pre_tone` and `final` read the scene's own light. Roles `ink`, `muted`, `stone`, `caption`. */
export const PLAIN_LOOK: JsonObject = {
  id: 'look-468-plain', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'A #468 acceptance look.',
  palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', stone: '#d9dde3', white: '#ffffff' },
  roles: { ground: 'night', ink: 'graphite', muted: 'slate', stone: 'stone', caption: 'white' },
  themes: { light: {}, dark: {} }, fonts: FONTS,
  status: { ...STATUS }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: 0.1,
  attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
  tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' },
};

export const WRITER = 'agent:sess-alpha';
/** A scene document as a session holds it (#378): every item in the one writer layer `main`, camera `cam`. */
export function sceneDoc(id: string, size: readonly [number, number], items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #468 acceptance fixture.`, size: [...size], camera: 'cam', seed: 468, safe: 24,
    transport: { span: '4s' }, requires: { modules: { scene3d: '^1', effects: '^1' } },
    layers: { main: { writer: WRITER, title: 'main', order: 'a0' } }, ...extra, items: withIds,
  };
}
/** The lens fields of `camera@1` (Camera `camera@1`: lens), as the issue writes them. */
export interface Lens { focal_length: number; sensor?: [number, number]; fit?: 'horizontal' | 'vertical' | 'wider'; shift?: [number, number] }
/** A perspective `camera@1` at `position` looking at `target` through `lens` (no `fov`: the lens derives it). */
export const lensCamera = (position: V3, target: V3, lens: Lens, more: JsonObject = {}): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', position, target, lens: lens as unknown as JsonObject, near: 0.05, far: 500, ...more } });
export const material = (params: JsonObject): JsonObject => ({ kind: 'material@1', params });
/** An unlit, opaque material of linear `color`. */
export const unlit = (color: V3): JsonObject => material({ base_color: [...color, 1], unlit: true, alpha_mode: 'opaque', alpha: 1, double_sided: true });
/** A black material that emits linear radiance `radiance` (white). */
export const emissive = (radiance: number): JsonObject => material({ base_color: [0, 0, 0, 1], emission: [1, 1, 1, 1], emission_strength: radiance, roughness: 1 });
/** `mark.box@1`: a box of `size` centred on `pos`. */
export const box = (size: V3, pos: V3, mat: string, more: JsonObject = {}): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos }, material: mat, ...more });
/** A `ball@1` of `radius` centred on `pos`. */
export const ball = (radius: number, pos: V3, mat: string): JsonObject => ({ kind: 'ball@1', params: { radius, segments: 32 }, at: { pos }, material: mat });
/** A black sky with no ambient and no environment: nothing but the scene's own light, background 0. */
export const DARK_SKY: JsonObject = { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } };
export const sun = (illuminance: number, rot: V3): JsonObject => ({ kind: 'light.sun@1', params: { illuminance, color: [1, 1, 1], shadow: false }, at: { rot } });
/** Effect: dof's fields (the issue's Fields block): an `effect@1` of kind dof. */
export const dof = (fields: JsonObject): JsonObject => ({ kind: 'effect@1', params: { kind: 'dof', dof: { coc: 'physical', taps: 64, rotate: 'pixel_hash', far_over_near: 'refuse', ...fields } } });
/** A channel on `target` keyed at `[seconds, value]`, linear between keys. */
export function linear(target: string, keys: [number, number][]): JsonObject {
  return { target, type: 'f32', keys: Object.fromEntries(keys.map(([t, value], k) => [`k${k}`, { t: `${t}s`, value, interp: 'linear' }])) };
}
/** A linear channel's value at `t` s: held before the first key and after the last. */
export function linearAt(keys: [number, number][], t: number): number {
  if (t <= keys[0]![0]) return keys[0]![1];
  for (let k = 1; k < keys.length; k++) {
    const [t1, v1] = keys[k]!; const [t0, v0] = keys[k - 1]!;
    if (t <= t1) return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
  }
  return keys.at(-1)![1];
}

// ---------------------------------------------------------------------------------------------------
// Reviewed references: vectors, #378's pinhole (fov across the wider side; frame coordinates continuous, (0, 0) the
// top left corner, pixel (i, j)'s centre at (i + 0.5, j + 0.5)), the orbit, the lens's closed forms and the ease.

export const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
export const add = (a: readonly number[], b: readonly number[]): V3 => [a[0]! + b[0]!, a[1]! + b[1]!, a[2]! + b[2]!];
export const scale = (a: readonly number[], k: number): V3 => [a[0]! * k, a[1]! * k, a[2]! * k];
export const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
export const cross = (a: readonly number[], b: readonly number[]): V3 => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
export const unit = (a: readonly number[]): V3 => { const l = Math.hypot(a[0]!, a[1]!, a[2]!); return [a[0]! / l, a[1]! / l, a[2]! / l]; };
export const rad = (d: number): number => (d * Math.PI) / 180;
export const deg = (r: number): number => (r * 180) / Math.PI;
/** The eye on an orbit about `target` (Camera `camera@1`): target + distance · (cos el · sin az, sin el, cos el · cos az). */
export const orbitEye = (target: V3, distance: number, azimuth: number, elevation: number): V3 =>
  add(target, scale([Math.cos(rad(elevation)) * Math.sin(rad(azimuth)), Math.sin(rad(elevation)), Math.cos(rad(elevation)) * Math.cos(rad(azimuth))], distance));
/** A pinhole: the focal length in px (`focal`), and a shift of the frame's centre as fractions of the frame, x right
 * and y up (a positive y raises the view, so the optical axis lands below the frame's centre). */
export interface Pinhole { position: V3; target: V3; focal: number; size: [number, number]; shift?: [number, number] }
/** The focal length in px of a field of view across the frame's wider side. */
export const focalOfFov = (fovDeg: number, size: readonly [number, number]): number => Math.max(size[0], size[1]) / 2 / Math.tan(rad(fovDeg) / 2);
/** Where world point `p` lands in the frame (px), and its depth along the view; null at or behind the eye. */
export function project(cam: Pinhole, p: readonly number[]): [number, number, number] | null {
  const f = unit(sub(cam.target, cam.position)); const r = unit(cross(f, [0, 1, 0])); const u = cross(r, f);
  const d = sub(p, cam.position); const z = dot(d, f);
  if (z <= 0) return null;
  const [sx, sy] = cam.shift ?? [0, 0];
  return [cam.size[0] / 2 + sx * cam.size[0] + (cam.focal * dot(d, r)) / z, cam.size[1] / 2 + sy * cam.size[1] - (cam.focal * dot(d, u)) / z, z];
}
/** The field of view (degrees) of focal length `f` mm across a sensor side of `side` mm: 2·atan(side ÷ 2f). */
export const fovOfLens = (side: number, f: number): number => deg(2 * Math.atan(side / (2 * f)));
/** EV100 from the lens: log2(N² ÷ t) − log2(ISO ÷ 100), with t = angle ÷ (360 × frame rate). */
export const ev100OfLens = (fStop: number, angle: number, iso: number, frameRate: number): number =>
  Math.log2((fStop * fStop) / (angle / (360 * frameRate))) - Math.log2(iso / 100);
/** The physical circle of confusion on the sensor (m): c = f² × |d − s| ÷ (N × d × (s − f)), all in m. */
export const cocOnSensor = (f: number, n: number, s: number, d: number): number => (f * f * Math.abs(d - s)) / (n * d * (s - f));
/** in_out_cubic, the design's default ease. */
export const inOutCubic = (s: number): number => { const c = Math.min(Math.max(s, 0), 1); return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2; };

// ---------------------------------------------------------------------------------------------------
// A bright point's disc, measured on a luminance plane whose background is 0 (AC1, AC6).

export interface Disc {
  /** The summed linear luminance inside the window. */
  energy: number;
  centre: [number, number];
  /** 2·√(A ÷ π), A the pixels at or above half the disc's level. */
  across: number;
  /** The boundary's distance from the centre (half the level) at each whole degree, 0° to the right, clockwise. */
  radii: number[];
}
/** Measures the disc around `near` within `half` px: its energy; its centroid; its level, the mean of the pixels
 * within 0.4 of its second-moment radius (at least the centre pixel); its area at half that level; and its boundary
 * along 360 rays, each the first crossing of half the level (bilinear, 0.05 px steps), averaged over ±2°. */
export function measureDisc(p: Plane, near: [number, number], half: number): Disc {
  const x0 = Math.max(0, Math.floor(near[0] - half)); const x1 = Math.min(p.width - 1, Math.ceil(near[0] + half));
  const y0 = Math.max(0, Math.floor(near[1] - half)); const y1 = Math.min(p.height - 1, Math.ceil(near[1] + half));
  let e = 0; let sx = 0; let sy = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const v = Math.max(0, at(p, x, y)); e += v; sx += v * (x + 0.5); sy += v * (y + 0.5); }
  const c: [number, number] = e > 0 ? [sx / e, sy / e] : [near[0], near[1]];
  let m2 = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const v = Math.max(0, at(p, x, y)); m2 += v * ((x + 0.5 - c[0]) ** 2 + (y + 0.5 - c[1]) ** 2); }
  const r1 = e > 0 ? Math.sqrt((2 * m2) / e) : 0;
  const inner = Math.max(0.4 * r1, 0.75);
  let lsum = 0; let ln = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if ((x + 0.5 - c[0]) ** 2 + (y + 0.5 - c[1]) ** 2 <= inner * inner) { lsum += at(p, x, y); ln++; }
  if (ln === 0) { lsum = at(p, Math.floor(c[0]), Math.floor(c[1])); ln = 1; }
  const level = lsum / ln;
  let area = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (at(p, x, y) >= level / 2) area++;
  const sample = (x: number, y: number): number => {
    const fx = x - 0.5; const fy = y - 0.5; const ix = Math.floor(fx); const iy = Math.floor(fy); const tx = fx - ix; const ty = fy - iy;
    return (1 - ty) * ((1 - tx) * at(p, ix, iy) + tx * at(p, ix + 1, iy)) + ty * ((1 - tx) * at(p, ix, iy + 1) + tx * at(p, ix + 1, iy + 1));
  };
  const ray = (a: number): number => {
    const dx = Math.cos(rad(a)); const dy = Math.sin(rad(a));
    let prev = sample(c[0], c[1]);
    for (let r = 0.05; r <= half; r += 0.05) {
      const v = sample(c[0] + r * dx, c[1] + r * dy);
      if (v < level / 2) return r - 0.05 + (0.05 * (prev - level / 2)) / Math.max(prev - v, 1e-12);
      prev = v;
    }
    return half;
  };
  const raw = Array.from({ length: 360 }, (_, a) => ray(a));
  const radii = raw.map((_, a) => [-2, -1, 0, 1, 2].reduce((s, k) => s + raw[(a + k + 360) % 360]!, 0) / 5);
  return { energy: e, centre: c, across: 2 * Math.sqrt(area / Math.PI), radii };
}
/** A disc's corners and edges as a polygon of `n` sides: the orientation whose `n` rays (every 360 ÷ n degrees) reach
 * furthest, the mean reach of those rays (centre to corner) and of the rays halfway between them (centre to edge). */
export function polygonOf(d: Disc, n: number): { corner: number; edge: number; at: number } {
  const step = 360 / n;
  let best = 0; let bestSum = -Infinity;
  for (let a = 0; a < step; a++) { let s = 0; for (let k = 0; k < n; k++) s += d.radii[Math.round(a + k * step) % 360]!; if (s > bestSum) { bestSum = s; best = a; } }
  let corner = 0; let edge = 0;
  for (let k = 0; k < n; k++) { corner += d.radii[Math.round(best + k * step) % 360]!; edge += d.radii[Math.round(best + step / 2 + k * step) % 360]!; }
  return { corner: corner / n, edge: edge / n, at: best };
}
