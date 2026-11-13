// Test-side tools for the #2017 acceptance tests (README: The surface under test). They drive the binaries as the
// sibling suites do: `deep-gpu run` (#377) with `view3d` (#378) and its #425 `lod`, `counts`, `targets`, `capture` and
// `timings`, plus the fields this suite assumes (README: Assumed surfaces), and `deep-show run` (#393) with `deep_show`,
// `geometry` (#420) and `frames` (#387). Copied here, since suites never import each other: the JSON-lines runners,
// #166's look shape, #425's PNG and APNG coding, #2014's terrain plate and #2013's and #2016's fixtures. Every number a
// test judges comes from the binaries; the only things computed here are the fixtures, the full-detail heights a field
// gives at its samples, and the base's own camera projection.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, loadavg, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type V3 = [number, number, number];
export type Size = [number, number];
export type Tile = [number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/2017 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
/** Each criterion's ID: `#2017.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
export const AC = { 1: '#2017.3e1437ba', 2: '#2017.e778fe83', 3: '#2017.751f674c', 4: '#2017.44d27f48' } as const;
export const TIMEOUT = 3_600_000;
/** "1080p" and "4K". */
export const HD: Size = [1920, 1080];
export const UHD: Size = [3840, 2160];
/** Each budget class's `lod_px`, 1 device px (Level of detail: levels by error); no fixture here lowers it but AC2's. */
export const LOD_PX = 1;

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const brief = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${brief(v, 600)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${brief(v, 600)}`).toBe(true);
  return v as JsonValue[];
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${brief(v, 200)}`).toBe(true);
  return v as number;
}
export function int(v: JsonValue | undefined, what: string): number {
  const n = num(v, what);
  expect(Number.isInteger(n) && n >= 0, `${what} is a whole number ≥ 0, got ${n}`).toBe(true);
  return n;
}
export function tileOfJson(v: JsonValue | undefined, what: string): Tile {
  const a = arr(v, what);
  expect(a.length, `${what} is [i, j]`).toBe(2);
  return [int(a[0], `${what}[0]`), int(a[1], `${what}[1]`)];
}
export const tileName = (t: Tile): string => `tile [${t[0]}, ${t[1]}]`;
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const SHA = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------------------------------
// The machine

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** What the GPU draws is drawn on macOS's Metal device: off macOS a test fails INCONCLUSIVE. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the renderer draws on macOS's Metal device; this is ${process.platform}`);
}
/** The one-minute load average, which the perf lane's `judgeLimit` reads at each run's start and end. */
export const load = (): number => loadavg()[0]!;
interface Bench { fingerprint: () => JsonObject; judgeLimit: (o: unknown) => JsonObject; validateBudgets: (current: unknown, base: unknown) => void }
const bench = async (): Promise<Bench> => (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as Bench;
/** The perf lane's own rule (scripts/benchmark.mjs): five runs after warm-up, a reference Mac on mains power, Low Power
 * Mode off, thermal state nominal, and the load at each run's start and end within the cores. */
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
/** The lane's validator (scripts/benchmark.mjs): throws when `current` breaks a task `base` already has. */
export async function validateBudgets(current: JsonObject, base: JsonObject): Promise<void> {
  (await bench()).validateBudgets(current, base);
}

// ---------------------------------------------------------------------------------------------------
// Builds: each binary built once per file, debug info and incremental builds off, copied out of the target folder.

export type Bin = 'deep-gpu' | 'deep-show';
const FEATURES: Record<Bin, string[]> = { 'deep-gpu': [], 'deep-show': ['--no-default-features', '--features', 'full'] };
const TOOLCHAIN = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
const targetDir = (): string => (process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target'));
const cargoArgs = (bin: Bin, release: boolean): string[] => ['build', '--locked', ...(release ? ['--release'] : []), '--bin', bin, ...FEATURES[bin]];

/** Builds `bin` (debug, or release) and copies it into `dir`: its path, or cargo's error. */
export function buildInto(bin: Bin, release: boolean, dir: string): { path: string; error: string } {
  const args = cargoArgs(bin, release);
  const env = {
    ...process.env, PATH: `${TOOLCHAIN}${delimiter}/opt/homebrew/opt/rustup/bin${delimiter}${process.env['PATH'] ?? ''}`,
    CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  };
  const r = spawnSync('cargo', args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { path: '', error: `cargo could not run: ${r.error.message}` };
  if (r.status !== 0) {
    const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l));
    return { path: '', error: `cargo ${args.join(' ')} failed:\n${lines.join('\n').slice(-4000)}` };
  }
  const path = join(dir, `${bin}${release ? '-release' : ''}`);
  copyFileSync(join(targetDir(), release ? 'release' : 'debug', bin), path);
  return { path, error: '' };
}

/** Builds the debug `bins` once, before the file's tests; a test whose build failed fails with cargo's error. */
export function useBins(bins: readonly Bin[]): (bin: Bin) => string {
  let dir = '';
  const made = new Map<Bin, { path: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-2017-bin-'));
    for (const b of bins) made.set(b, buildInto(b, false, dir));
  }, 2 * TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (bin: Bin): string => {
    const m = made.get(bin);
    expect(m, `${bin} was built before the tests`).toBeDefined();
    expect(m!.error, `the binary builds: cargo ${cargoArgs(bin, false).join(' ')}`).toBe('');
    return m!.path;
  };
}
/** A fresh folder per test, deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-2017-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}
export function writeJson(dir: string, name: string, value: JsonObject): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one scenario `{out, calls}` in, one line out, one reply per call (#377).

/** The wrong programs this suite plants in `deep-gpu run`, each reachable only through `--planted` (README). */
export type Planted = 'terrain_lod_by_distance' | 'terrain_shades_own_level_normals';

export function runGpu(bin: string, out: string, calls: JsonObject[], planted?: Planted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const label = `deep-gpu ${args.join(' ')}`;
  const r = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 3_000_000, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${label} did not finish within 3,000 s`);
  // A binary that refuses its arguments (an unknown --planted) exits before reading its input: its exit is judged below.
  if (r.error && (r.error as NodeJS.ErrnoException).code !== 'EPIPE') throw Error(`${label}: ${r.error.message}`);
  expect(r.status, `${label} exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${label}: one output line`).toBe(1);
  let answer: JsonValue;
  try { answer = JSON.parse(lines[0]!) as JsonValue; } catch { return expect.fail(`${label}: its line is JSON: ${lines[0]!.slice(0, 1500)}`); }
  const a = obj(answer, `${label}: the answer`);
  expect(a['ok'], `${label} accepted the scenario: ${brief(a, 3000)}`).toBe(true);
  const replies = arr(a['replies'], `${label}: replies`).map((x, i) => obj(x, `${label}: replies[${i}]`));
  expect(replies.length, `${label}: one reply per call`).toBe(calls.length);
  return replies;
}
/** A `view3d` reply's frames, in order from `from`; INCONCLUSIVE where the binary says the platform can't draw. */
export function framesOf(reply: JsonObject, count: number, what: string, from = 0): JsonObject[] {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what}: view3d answered unsupported_platform`);
  expect(reply['code'], `${what}: view3d is answered, not refused: ${brief(reply)}`).toBeUndefined();
  const frames = arr(reply['frames'], `${what}: frames`).map((f, i) => obj(f, `${what}: frames[${i}]`));
  expect(frames.map((f) => f['frame']), `${what}: frames ${from} … ${from + count - 1}, in order`).toEqual(Array.from({ length: count }, (_, k) => from + k));
  return frames;
}
/** A file the binary wrote under `out`, named by its SHA-256 (#378). */
export function readNamed(out: string, hash: JsonValue | undefined, ext: string, what: string): Buffer {
  expect(hash, `${what} is written, named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${String(hash)}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line in, one answer line out (#393).

export const SESSION = 'sess-alpha';
export const docId = (n: number): string => `01JB2017D${String(n).padStart(17, '0')}`;
/** One `deep-show run` process: the documents on the panel, the calls; its replies, one per call. */
export function runShow(bin: string, evidence: string, docs: readonly string[], calls: JsonObject[]): JsonObject[] {
  const scenario: JsonObject = {
    evidence,
    sessions: { [SESSION]: { thread: 'thread-alpha', name: 'Claude Code: ground', process: { pid: 4100, start: 1_000 } } },
    processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 4100, ppid: 3000, start: 1_000 }],
    panels: { main: { rect: [0, 0, 1280, 720] } },
    docs: Object.fromEntries(docs.map((d) => [d, { panel: 'main' }])),
    calls,
  };
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 3_000_000, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail('deep-show run did not finish within 3,000 s');
  if (r.error) throw Error(`deep-show run: ${r.error.message}`);
  expect(r.status, `deep-show run exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, 'deep-show run: one output line').toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, 'deep-show run: the answer');
  expect(out['ok'], `deep-show run accepted the scenario: ${brief(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], 'deep-show run: replies').map((v, i) => obj(v, `deep-show run: replies[${i}]`));
  expect(replies.length, 'deep-show run: one reply per call').toBe(calls.length);
  return replies;
}
/** The working agent's deep_show of a whole revision (#393's agent form). */
export const show = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep_show', session: SESSION, doc, document, include: ['issues'] });
/** The show was presented, with no error issue and no item skipped as a kind the build doesn't know. */
export function presented(reply: JsonObject, what: string): void {
  const notices = Array.isArray(reply['notices']) ? reply['notices'].filter(isObject) : [];
  const issues = Array.isArray(reply['issues']) ? reply['issues'].filter(isObject) : [];
  const bad = [
    ...[...notices, ...issues].filter((n) => n['code'] === 'unknown_kind').map((n) => `an item is skipped: ${brief(n, 600)}`),
    ...issues.filter((i) => i['severity'] === 'error').map((i) => `the check raises an error: ${brief(i, 600)}`),
    ...(reply['outcome'] === 'presented' ? [] : [`the outcome is ${brief(reply['outcome'])}: ${brief(reply, 1500)}`]),
  ];
  expect(bad, `${what} is presented: ${bad.join('; ')}`).toEqual([]);
}

// ---------------------------------------------------------------------------------------------------
// Looks, lights and items (#166's look shape; metres, +Y up)

const FONTS: JsonObject = {
  body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
};
const STATUS: JsonObject = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
/** A physical-basis `look@1`: tone map none at the exposure whose scale is 1, no finish, deband, bloom, ao or 3D ground. */
export function look3d(id: string, change: JsonObject = {}): JsonObject {
  return {
    id, format: 1, basis: 'physical', license: 'Apache-2.0', description: `The #2017 acceptance look ${id}.`,
    palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', white: '#ffffff' },
    roles: { ground: 'night', ink: 'graphite', muted: 'slate' },
    themes: { light: {}, dark: {} }, fonts: FONTS,
    status: { ...STATUS }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: 0.1,
    attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
    tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' },
    ...change,
  };
}
/** The look criteria 1 to 3 draw in: nothing between the lit scene and the frame's code values. */
export const PLAIN = look3d('plain-2017');
/** The look the screenshots and the recording draw in, as a film would. */
export const FILMIC = look3d('filmic-2017', { tone_map: 'filmic', exposure: 0 });

export const DAY_SKY: JsonObject = { kind: 'sky@1', params: { top: [0.15, 0.3, 0.75, 1], low: [0.6, 0.7, 0.85, 1], ambient_top: [0.25, 0.25, 0.25], ambient_low: [0.1, 0.1, 0.1] } };
/** A black sky with no ambient: nothing but the sun lights the scene. */
export const DARK_SKY: JsonObject = { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } };
/** A sun: it shines along its local −Z, so `at.rot` [−e, y, 0] puts it e degrees above the horizon, turned y about +Y. */
export const sun = (illuminance: number, rot: V3, shadow = false): JsonObject => ({ kind: 'light.sun@1', params: { illuminance, color: [1, 1, 1], shadow }, at: { rot } });
export const camera = (position: V3, target: V3, fov: number, near = 0.1, far = 2000): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov, near, far } });
export const material = (base: [number, number, number], roughness = 0.8): JsonObject => ({ kind: 'material@1', params: { base_color: [...base, 1], roughness, metallic: 0 } });
export const box = (size: V3, pos: V3, mat: string, more: JsonObject = {}): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos }, material: mat, ...more });
/** A flat `plate@1` of one cell, `size` m, centred on `pos`, facing +Y. */
export const flat = (size: [number, number], pos: V3, mat: string): JsonObject => ({ kind: 'plate@1', params: { grid: [1, 1], size }, at: { pos }, material: mat });

/** A scene document as a `view3d` session holds it (#378): every item in the one writer layer `main`, camera `cam`. */
export function sessionDoc(id: string, size: Size, items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(4, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #2017 acceptance fixture.`, size: [...size], camera: 'cam', seed: 2017,
    requires: { modules: { scene3d: '^1' } }, budget: { class: 'work_product' },
    layers: { main: { writer: 'agent:alpha', title: 'Main', order: 'a0' } }, ...extra, items: withIds,
  };
}
/** The same document in the agent's form for deep_show (#393): no `id`, no `layers`, no item's `layer`. */
export function agentDoc(session: JsonObject): JsonObject {
  const { id: _id, layers: _layers, items, ...rest } = session;
  const out: JsonObject = {};
  for (const [key, item] of Object.entries(obj(items, 'items'))) {
    const { layer: _layer, ...it } = obj(item, `items.${key}`);
    out[key] = it;
  }
  return { ...rest, items: out };
}

// ---------------------------------------------------------------------------------------------------
// The terrain plate (#2014's form): `plate@1` with `params.terrain`, no `at`, so its own space is the world's. Its
// samples lie `spacing` apart over `size`, centred on its origin: x = −size[0] ÷ 2 + c × spacing, z likewise with r.
// Tile [i, j] covers x from −size[0] ÷ 2 + i × tile to that + tile, and z likewise: i counts along +x from the −x edge,
// j along +z from the −z edge, both from 0 (#2014's cell naming, on tiles).

export interface Terrain { height: string; size: [number, number]; spacing: number; tile: number; lod_levels: number }
export const PLATE_ID = 'ground';
const terrainItem = (t: Terrain, mat: string): JsonObject => ({ kind: 'plate@1', params: { terrain: { ...t, size: [...t.size] } }, material: mat });
export const tilesASide = (t: Terrain): [number, number] => [Math.ceil(t.size[0] / t.tile), Math.ceil(t.size[1] / t.tile)];
export function tileOf(t: Terrain, x: number, z: number): Tile {
  const [ni, nj] = tilesASide(t);
  return [Math.min(ni - 1, Math.floor((x + t.size[0] / 2) / t.tile)), Math.min(nj - 1, Math.floor((z + t.size[1] / 2) / t.tile))];
}
const fract = (v: number): number => v - Math.floor(v);

/**
 * Criteria 1, 3 and 4's plate (README: Fixtures): 512 × 512 m at 1 m, 8 × 8 tiles of 64 m, six levels. Rolling hills
 * (±6 m and ±2 m) under a 3 cm zigzag along x, +0.03 m at even x and −0.03 m at odd x: a sample every level past full
 * detail drops, so at an odd x every coarser level is off full detail by about 6 cm, wherever the tile lies.
 */
export const PLATE: Terrain = {
  height: '0.03 * (1 - 4 * fract(position.x * 0.5)) + 6 * sin(position.x * 0.025) * cos(position.z * 0.019) + 2 * sin((position.x + position.z) * 0.07)',
  size: [512, 512], spacing: 1, tile: 64, lod_levels: 6,
};
/** PLATE's field at a sample: the full-detail height there. */
export const plateHeight = (x: number, z: number): number =>
  0.03 * (1 - 4 * fract(x * 0.5)) + 6 * Math.sin(x * 0.025) * Math.cos(z * 0.019) + 2 * Math.sin((x + z) * 0.07);
/** The pose criterion 1 sees the plate from at both sizes: 25 m up, 44 m past its +z edge, looking at its centre. */
export const PLATE_EYE: V3 = [0, 25, 300];
export const PLATE_TARGET: V3 = [0, 0, 0];
export const PLATE_FOV = 60;
export function plateDoc(size: Size, look: 'plain' | 'filmic' = 'plain'): JsonObject {
  return sessionDoc(`plate-2017-${size[0]}x${size[1]}`, size, {
    cam: camera(PLATE_EYE, PLATE_TARGET, PLATE_FOV, 0.5, 2000),
    sky: DAY_SKY,
    sun: sun(3, [-35, 30, 0], look === 'filmic'),
    turf: material([0.3, 0.42, 0.2], 0.9),
    [PLATE_ID]: terrainItem(PLATE, 'turf'),
  });
}

/** The base's camera (scene3d `posed`): focal length in px from the wider side, screen right ⟂ +Y, screen up. */
export function projector(eye: V3, target: V3, fov: number, size: Size): { focal: number; project: (p: V3) => [number, number] | null } {
  const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const unit = (a: V3): V3 => { const l = Math.hypot(...a); return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : a; };
  const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const forward = unit(sub(target, eye));
  let right = unit(cross(forward, [0, 1, 0]));
  if (Math.hypot(...right) === 0) right = [1, 0, 0];
  const up = cross(right, forward);
  const focal = Math.max(size[0], size[1]) / 2 / Math.tan((fov * Math.PI) / 360);
  return {
    focal,
    project: (p) => {
      const d = sub(p, eye); const vz = dot(d, forward);
      return vz <= 0 ? null : [size[0] / 2 + (dot(d, right) * focal) / vz, size[1] / 2 - (dot(d, up) * focal) / vz];
    },
  };
}
/** The focal length in device px of PLATE's camera at `size`. */
export const plateFocal = (size: Size): number => projector(PLATE_EYE, PLATE_TARGET, PLATE_FOV, size).focal;

/** A 32-bit linear congruential generator (Numerical Recipes' constants), uniform in [0, 1). */
class Lcg {
  private x: number;
  constructor(seed: number) { this.x = seed >>> 0; }
  next(): number { this.x = (Math.imul(1664525, this.x) + 1013904223) >>> 0; return this.x / 4294967296; }
}
export interface GroundPoint { x: number; z: number; full: number; tile: Tile }
/**
 * Criterion 1's 200 sampled ground points (README: Fixtures): samples of PLATE at an odd column and an odd row, so every
 * level past full detail drops them; none within one sample of a tile's edge; each on screen at 1080p, at least 2 px
 * inside the frame. Drawn in order from an LCG seeded 2017 until 200 are kept.
 */
export function groundPoints(): GroundPoint[] {
  const cam = projector(PLATE_EYE, PLATE_TARGET, PLATE_FOV, HD);
  const rnd = new Lcg(2017);
  const out: GroundPoint[] = [];
  const cells = PLATE.size[0] / PLATE.spacing;
  while (out.length < 200) {
    const c = 1 + 2 * Math.floor(rnd.next() * (cells / 2));
    const r = 1 + 2 * Math.floor(rnd.next() * (cells / 2));
    if ([1, PLATE.tile - 1].includes(c % PLATE.tile) || [1, PLATE.tile - 1].includes(r % PLATE.tile)) continue;
    const x = -PLATE.size[0] / 2 + c; const z = -PLATE.size[1] / 2 + r; const full = plateHeight(x, z);
    const p = cam.project([x, full, z]);
    if (!p || p[0] < 2 || p[0] > HD[0] - 2 || p[1] < 2 || p[1] > HD[1] - 2) continue;
    out.push({ x, z, full, tile: tileOf(PLATE, x, z) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Reading a frame's terrain rows (README: Assumed surfaces 1 and 2)

export interface TileRow { tile: Tile; level: number; errorsPx: number[] }
/** The frame's `lod` row for terrain plate `item`: one entry per tile of the plate, by name. */
export function tilesOf(frame: JsonObject, item: string, t: Terrain, what: string): Map<string, TileRow> {
  const rows = arr(frame['lod'], `${what}: the frame's \`lod\` (README: Assumed surfaces 1)`).filter(isObject);
  const row = rows.find((r) => r['item'] === item);
  expect(row, `${what}: the frame's \`lod\` has a row for the terrain plate ${item}, with its tiles (README: Assumed surfaces 1)`).toBeDefined();
  const tiles = arr(row!['tiles'], `${what}: ${item}'s tiles`).map((v, k): TileRow => {
    const at = `${what}: ${item}'s tiles[${k}]`;
    const o = obj(v, at);
    const tile = tileOfJson(o['tile'], `${at}.tile`);
    const errorsPx = arr(o['errors_px'], `${at}.errors_px`).map((e, l) => num(e, `${at}.errors_px[${l}]`));
    return { tile, level: int(o['level'], `${at}.level`), errorsPx };
  });
  const [ni, nj] = tilesASide(t);
  const byName = new Map(tiles.map((r) => [tileName(r.tile), r]));
  expect(byName.size, `${what}: one row per tile, none twice`).toBe(tiles.length);
  const want = Array.from({ length: ni * nj }, (_, k) => tileName([k % ni, Math.floor(k / ni)])).sort();
  expect([...byName.keys()].sort(), `${what}: a row for each of the plate's ${ni} × ${nj} tiles`).toEqual(want);
  for (const r of tiles) {
    const at = `${what}: ${tileName(r.tile)}`;
    expect(r.errorsPx.length, `${at}: errors_px holds one error per level (lod_levels ${t.lod_levels})`).toBe(t.lod_levels);
    expect(r.errorsPx[0], `${at}: full detail's error is 0`).toBe(0);
    r.errorsPx.forEach((e, l) => { if (l > 0) expect(e, `${at}: level ${l}'s error is no lower than level ${l - 1}'s`).toBeGreaterThanOrEqual(r.errorsPx[l - 1]!); });
    expect(r.level, `${at}: its level is one of its ${t.lod_levels}`).toBeLessThan(t.lod_levels);
  }
  return byName;
}
/** The coarsest level whose projected error is at most `lodPx` (Level of detail: chunks streamed by view). */
export const coarsestWithin = (errorsPx: readonly number[], lodPx: number): number => errorsPx.reduce((best, e, l) => (e <= lodPx ? l : best), 0);

export interface PointRow { x: number; z: number; tile: Tile; level: number; y: number }
/** The frame's `ground_points`, in the order asked (README: Assumed surfaces 2). */
export function pointsOf(frame: JsonObject, asked: readonly GroundPoint[], what: string): PointRow[] {
  const rows = arr(frame['ground_points'], `${what}: the frame's \`ground_points\` (README: Assumed surfaces 2)`);
  expect(rows.length, `${what}: one reading per point asked`).toBe(asked.length);
  return rows.map((v, k) => {
    const at = `${what}: ground_points[${k}]`;
    const o = obj(v, at);
    const xz = arr(o['at'], `${at}.at`).map((n, i) => num(n, `${at}.at[${i}]`));
    expect(xz, `${at}: the point asked`).toEqual([asked[k]!.x, asked[k]!.z]);
    return { x: xz[0]!, z: xz[1]!, tile: tileOfJson(o['tile'], `${at}.tile`), level: int(o['level'], `${at}.level`), y: num(o['y'], `${at}.y`) };
  });
}
/** How far a drawn height is from full detail on screen at `size`: the difference projected at the point's distance
 * from the eye, as the selection projects a tile's error (README: Readings). */
export function offPx(p: { x: number; z: number; y: number }, full: number, size: Size): number {
  const d = Math.hypot(p.x - PLATE_EYE[0], full - PLATE_EYE[1], p.z - PLATE_EYE[2]);
  return (Math.abs(p.y - full) * plateFocal(size)) / d;
}
/** The 200-point judge: every point within `lodPx` of full detail on screen (1e-3 px for f32), each failure naming its
 * tile. The rows must also name the tile the point lies in and the level the frame's `lod` row gives that tile. */
export function pointFailures(points: readonly GroundPoint[], rows: readonly PointRow[], tiles: Map<string, TileRow>, size: Size, lodPx: number): string[] {
  const out: string[] = [];
  rows.forEach((r, k) => {
    const p = points[k]!;
    const name = tileName(p.tile);
    if (tileName(r.tile) !== name) out.push(`point (${p.x}, ${p.z}) lies in ${name}, but the frame reports it in ${tileName(r.tile)}`);
    const t = tiles.get(name);
    if (t && r.level !== t.level) out.push(`${name}: point (${p.x}, ${p.z}) is drawn at level ${r.level}, but the tile's row says level ${t.level}`);
    const off = offPx(r, p.full, size);
    if (off > lodPx + 1e-3) out.push(`${name} (level ${r.level}): point (${p.x}, ${p.z}) is drawn at y ${r.y.toFixed(5)} m, full detail ${p.full.toFixed(5)} m, ${off.toFixed(3)} px off at ${size[0]} × ${size[1]}, over lod_px ${lodPx}`);
  });
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 2's plate, seen straight down through an orthographic camera, so a pixel sees the same ground (x, z) at
// every level and only its shading can change (README: Fixtures).

export const SHADED: Terrain = {
  height: '0.1 * sin(position.x * 1.0471975511965976) + 1.5 * sin(position.x * 0.031) * cos(position.z * 0.027)',
  size: [256, 256], spacing: 1, tile: 64, lod_levels: 6,
};
export const SHADED_SIZE: Size = [960, 540];
/** The camera's view width in m: 960 ÷ 112 ≈ 8.57 px a metre. */
export const SHADED_WIDTH = 112;
/** The sun's illuminance on criterion 2's plate. */
export const SHADED_SUN = 12;
/** The document's `budget.lod_px` that lowers every tile to full detail (a document may only lower it). */
export const LOWERED_LOD_PX = 0.01;
export function shadedDoc(lowered: boolean): JsonObject {
  return sessionDoc(`shaded-2017${lowered ? '-full' : ''}`, SHADED_SIZE, {
    cam: { kind: 'camera@1', params: { projection: 'orthographic', position: [0, 100, 0], target: [0, 0, 0], view_width: SHADED_WIDTH, near: 1, far: 200 } },
    sky: DARK_SKY,
    sun: sun(SHADED_SUN, [-10, 90, 0]),
    grey: material([0.6, 0.6, 0.6], 1),
    [PLATE_ID]: terrainItem(SHADED, 'grey'),
  }, { budget: lowered ? { class: 'work_product', lod_px: LOWERED_LOD_PX } : { class: 'work_product' } });
}
/** The ground (x, z) a pixel's centre sees through criterion 2's camera: screen right +X, screen down +Z. */
export function shadedGround(px: number, py: number): [number, number] {
  const s = SHADED_SIZE[0] / SHADED_WIDTH;
  return [(px + 0.5 - SHADED_SIZE[0] / 2) / s, (py + 0.5 - SHADED_SIZE[1] / 2) / s];
}

export interface Image { width: number; height: number; rgba: Uint8Array }
/** Criterion 2's judge: each pixel of a tile that changed level, its lit color in A and in B, at most `codes` apart in
 * every channel; each failure names its tile, the levels, how many pixels moved and the worst. */
export function lightFailures(a: Image, b: Image, levelsA: Map<string, TileRow>, levelsB: Map<string, TileRow>, codes = 1): string[] {
  const worst = new Map<string, { n: number; d: number; at: [number, number] }>();
  for (let py = 0; py < a.height; py++) for (let px = 0; px < a.width; px++) {
    const [x, z] = shadedGround(px, py);
    const name = tileName(tileOf(SHADED, x, z));
    if (levelsA.get(name)?.level === levelsB.get(name)?.level) continue;
    const o = (py * a.width + px) * 4;
    const d = Math.max(...[0, 1, 2].map((c) => Math.abs(a.rgba[o + c]! - b.rgba[o + c]!)));
    if (d <= codes) continue;
    const w = worst.get(name) ?? { n: 0, d: 0, at: [px, py] as [number, number] };
    w.n++;
    if (d > w.d) { w.d = d; w.at = [px, py]; }
    worst.set(name, w);
  }
  return [...worst.entries()].map(([name, w]) => `${name} (level ${levelsA.get(name)?.level} → ${levelsB.get(name)?.level}): ${w.n} pixels change by more than ${codes} code value, the worst by ${w.d} at pixel (${w.at[0]}, ${w.at[1]})`);
}

// ---------------------------------------------------------------------------------------------------
// Criterion 3's documents (README: Fixtures)

/** A vase's outline from the axis at its foot to the axis at its rim's cap: 11 points, 10 bands, every corner sharp. */
const VASE_OUTLINE: JsonValue[] = [[0, 0], [0.3, 0.02], [0.34, 0.1], [0.36, 0.3], [0.3, 0.5], [0.2, 0.62], [0.16, 0.7], [0.18, 0.8], [0.22, 0.86], [0.2, 0.9], [0, 0.9]].map((p) => [...p, false]);
/** The prop: a `lathe@1` of 10 bands × `segments` faces (10,000 at 1,000), beveled then given weighted normals. */
export const propItem = (segments: number, pos: V3): JsonObject => ({
  kind: 'lathe@1', params: { outline: VASE_OUTLINE, segments }, material: 'clay', at: { pos },
  modifiers: [{ kind: 'mod.bevel@1', params: { width: 0.002, segments: 2 } }, { kind: 'mod.normals@1', params: { mode: 'weighted' } }],
});
/** The mesh: the same lathe at `segments` (1,000 faces at 100), subdivided two levels. */
export const meshItem = (segments: number, pos: V3): JsonObject => ({
  kind: 'lathe@1', params: { outline: VASE_OUTLINE, segments }, material: 'clay', at: { pos },
  modifiers: [{ kind: 'mod.subdivide@1', params: { levels: 2 } }],
});
/** A curve of `spans` spans: a slow spiral, catmull_rom, every point apart. */
export function pathItem(spans: number, centre: V3): JsonObject {
  const points = Array.from({ length: spans + 1 }, (_, k) => [centre[0] + 20 * Math.cos(k * 0.05), centre[1] + 0.01 * k, centre[2] + 20 * Math.sin(k * 0.05)]);
  return { kind: 'curve@1', params: { points, mode: 'catmull_rom' } };
}
/** A scatter of the bush (0.6 m) and the flower (0.2 m) over `on`, poisson at 0.5 m, pruned larger first. */
export const scatterItem = (on: string, max?: number): JsonObject => ({
  kind: 'instance@1', params: { of: ['bush', 'flower'], from: { distribute: { on, mode: 'poisson', min_distance: 0.5, prune: 'larger_first', seed: 2017, ...(max === undefined ? {} : { max }) } } },
});
const protos = (): Record<string, JsonObject> => ({
  bush: box([0.6, 0.6, 0.6], [0, 0.3, 0], 'leaves', { visible: false }),
  flower: box([0.2, 0.2, 0.2], [0, 0.1, 0], 'petals', { visible: false }),
});
const MATS = (): Record<string, JsonObject> => ({
  clay: material([0.62, 0.4, 0.3], 0.6), leaves: material([0.2, 0.42, 0.18], 0.9), petals: material([0.85, 0.4, 0.55], 0.7), soil: material([0.35, 0.28, 0.2], 1),
});
/** The CPU budgets' items: the 10,000-face prop, the 1,000-face mesh, 100,000 points distributed over a 200 m field
 * with pruning, and a curve of 1,000 spans. Nothing is drawn: deep-show builds them. */
export const BUDGET_IDS = { prop: 'prop', mesh: 'mesh', scatter: 'scatter', path: 'path' } as const;
export function budgetDoc(): JsonObject {
  return sessionDoc('budgets-2017', [640, 360], {
    cam: camera([0, 30, 150], [0, 0, 0], 60), sun: sun(3, [-40, 30, 0]), ...MATS(),
    [BUDGET_IDS.prop]: propItem(1000, [0, 0, 0]),
    [BUDGET_IDS.mesh]: meshItem(100, [2, 0, 0]),
    field: flat([200, 200], [0, 0, 0], 'soil'), ...protos(),
    [BUDGET_IDS.scatter]: scatterItem('field', 100_000),
    [BUDGET_IDS.path]: pathItem(1000, [0, 1, 0]),
  });
}
/** "Nothing in this task runs per frame while still": the plate with its levels, a scattered lawn, the beveled prop, the
 * subdivided mesh and a rail swept along a curve, under a still camera, with nothing bound to time. `bare`: the same
 * camera, sky, sun and materials with one box in place of the task's items, what a frame runs without them. */
export function stillDoc(bare = false): JsonObject {
  const common = { cam: camera(PLATE_EYE, PLATE_TARGET, PLATE_FOV, 0.5, 2000), sky: DAY_SKY, sun: sun(3, [-35, 30, 0]), turf: material([0.3, 0.42, 0.2], 0.9), ...MATS() };
  if (bare) return sessionDoc('still-2017-bare', [640, 360], { ...common, block: box([1, 1, 1], [0, 12.5, 230], 'clay') });
  return sessionDoc('still-2017', [640, 360], {
    ...common,
    [PLATE_ID]: terrainItem(PLATE, 'turf'),
    lawn: flat([10, 10], [0, 12, 230], 'soil'), ...protos(), shrubs: scatterItem('lawn'),
    prop: propItem(64, [-6, 12, 240]), mesh: meshItem(16, [6, 12, 240]),
    path: pathItem(100, [0, 14, 200]),
    rail: { kind: 'extrude@1', params: { outline: [[0, -0.05], [0.1, -0.05], [0.1, 0.05], [0, 0.05]], along: { curve: 'path', range: [0, 1], rings: 256 } }, material: 'clay' },
  });
}

/** The tree of the forest: a `lathe@1` of 4 bands × 250 rings × 2 = 2,000 vertices, its ends on the axis, no caps. */
export const TREE = {
  kind: 'lathe@1', params: { outline: [[0, 0, false], [0.25, 0.1, false], [0.25, 1, false], [1.2, 1.2, false], [0, 3.5, false]], segments: 249 },
} as const;
export const FOREST_TREES = 10_000;
/** 10,000 instanced trees, 100 × 100 at 3 m, each the tree with one `mod.sway@1` (#2016's numbers), on or off. */
export function forestDoc(swaying: boolean): JsonObject {
  const n = Math.sqrt(FOREST_TREES);
  const pos = Array.from({ length: FOREST_TREES }, (_, k) => [3 * (k % n), 0, 3 * Math.floor(k / n)]);
  return sessionDoc(`forest-2017-${swaying ? 'swaying' : 'still'}`, HD, {
    cam: camera([148.5, 35, 360], [148.5, 0, 140], 60), sky: DAY_SKY, sun: sun(3, [-40, 30, 0]),
    needles: material([0.18, 0.4, 0.2], 0.9), soil: material([0.35, 0.28, 0.2], 1),
    earth: flat([320, 320], [148.5, 0, 148.5], 'soil'),
    tree: {
      ...TREE, params: { ...TREE.params, outline: TREE.params.outline.map((p) => [...p]) }, material: 'needles', visible: false,
      modifiers: [{ kind: 'mod.sway@1', enabled: swaying, params: { amount: 0.3, wind: { direction: 0, speed: 5, gust: { scale: 20 } }, seed: 7 } }],
    },
    forest: {
      kind: 'instance@1',
      params: { of: ['tree'], ids: pos.map((_, k) => k), proto: pos.map(() => 0), pos, yaw: pos.map((_, k) => (k * 137.5) % 360), scale: pos.map(() => 1) },
    },
  });
}

// ---------------------------------------------------------------------------------------------------
// Criterion 4's scenes: #2013's garden and vase, #2016's field, each with a camera and a sun (README: Fixtures)

/** #2013's scattered garden: a 10 × 10 m plate, a 1.2 m bush and a 0.3 m flower scattered poisson at 0.5 m, seed
 * 2013, unturned, pruned larger first. */
export function gardenDoc(size: Size): JsonObject {
  return sessionDoc('garden-2017', size, {
    cam: camera([0, 10, 16], [0, 0, 0], 45), sky: DAY_SKY, sun: sun(3, [-40, 30, 0], true), ...MATS(),
    plate: flat([10, 10], [0, 0, 0], 'soil'),
    bush: box([1.2, 1.2, 1.2], [0, 0.6, 0], 'leaves', { visible: false }),
    flower: box([0.3, 0.3, 0.3], [0, 0.15, 0], 'petals', { visible: false }),
    shrubs: { kind: 'instance@1', params: { of: ['bush', 'flower'], from: { distribute: { on: 'plate', mode: 'poisson', min_distance: 0.5, yaw: [0, 0], seed: 2013, prune: 'larger_first' } } } },
  });
}
/** #2013's vase on the table: a ball of radius 0.1 m written 0.3 m left of the centre of a table top tilted 20°, at
 * y 1.2, rested on it by `rest_on` with every default. */
export function vaseDoc(size: Size): JsonObject {
  return sessionDoc('vase-2017', size, {
    cam: camera([0.3, 1.6, 2.6], [0, 0.8, 0], 40), sky: DAY_SKY, sun: sun(3, [-45, 20, 0], true), ...MATS(),
    floor: flat([6, 6], [0, 0, 0], 'soil'),
    table: { kind: 'mark.box@1', params: { size: [1.2, 0.05, 0.8] }, at: { pos: [0, 0.8, 0], rot: [0, 0, 20] }, material: 'leaves' },
    vase: { kind: 'mark.sphere@1', params: { size: [0.2, 0.2, 0.2] }, at: { pos: [-0.3, 1.2, 0] }, material: 'clay' },
  }, { requires: { modules: { scene3d: '^1', motion: '^1' } }, constraints: { rest: { owner: 'vase', kind: 'rest_on', on: 'table' } } });
}
/** #2016's swaying field: 36 identical lathe trees 2 m apart, 12 along the wind (+x) by 3, each with the same sway
 * (amount 0.3 m, a 5 m/s wind toward +x, gusts at 20 m, seed 7), under a still camera; here on a ground plate. */
export function windDoc(size: Size): JsonObject {
  const trees: Record<string, JsonObject> = {};
  for (let i = 0; i < 12; i++) for (let k = 0; k < 3; k++) {
    trees[`tree-x${String(2 * i).padStart(2, '0')}-z${2 * k}`] = {
      kind: 'lathe@1', params: { outline: [[0.15, 0, false], [0.15, 1, false], [1, 1, false], [0, 3, false]], segments: 8 }, material: 'needles',
      modifiers: [{ kind: 'mod.sway@1', params: { amount: 0.3, wind: { direction: 0, speed: 5, gust: { scale: 20 } }, seed: 7 } }], at: { pos: [2 * i, 0, 2 * k] },
    };
  }
  return sessionDoc('wind-2017', size, {
    cam: camera([11, 10, 30], [11, 1.2, 2], 60), sky: DAY_SKY, sun: sun(3, [-50, 30, 0]),
    needles: material([0.2, 0.6, 0.25], 1), soil: material([0.35, 0.28, 0.2], 1),
    earth: flat([40, 20], [11, 0, 2], 'soil'), ...trees,
  }, { seed: 2016 });
}

// ---------------------------------------------------------------------------------------------------
// PNG reading and writing (#425's): 8-bit RGB or RGBA, no interlace; written with no filter at zlib level 9, so the
// same pixels give the same SHA-256.

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
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
function ihdr(width: number, height: number): Buffer {
  const h = Buffer.alloc(13); h.writeUInt32BE(width, 0); h.writeUInt32BE(height, 4); h[8] = 8; h[9] = 2;
  return h;
}
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export function encodePng(image: Image): Buffer {
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr(image.width, image.height)), chunk('IDAT', rows(image)), chunk('IEND', new Uint8Array(0))]);
}
/** An animated PNG of equal-sized frames at `fps`, looping. */
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
