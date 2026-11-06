// Test-side tools for the #484 acceptance tests: `deep-gpu` (#377's binary, with #378's `view3d`, #424's clicks and
// #483's `check_operator` frames) built once per file and driven by JSON lines; the fields this suite adds (README:
// The surface under test); the forest and the composed crowd, shared with the taste test so its screenshots are the
// criteria's scenes; #378's pinhole, the orbit, and the failure rules. Nothing here stands in for the cull, the
// compaction, the draws or the picks under test. Parts are copied from #424's and #483's helpers, since suites don't
// import each other.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/484 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** Each criterion's ID: the first 8 hex digits of SHA-256 of its text (README). */
export const AC = { 1: '#484.31f1249b', 2: '#484.7e241cd4', 3: '#484.a2d2a0c9', 4: '#484.ca2dfa6e', 5: '#484.b58c79f0' } as const;

// ---------------------------------------------------------------------------------------------------
// JSON and failure rules

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${shown(v)}`).toBe(true);
  return v as JsonObject;
}
export function objs(v: JsonValue | undefined, what: string): JsonObject[] {
  expect(Array.isArray(v), `${what} is an array, got ${shown(v)}`).toBe(true);
  return (v as JsonValue[]).map((x, i) => obj(x, `${what}[${i}]`));
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
const clone = <T extends JsonValue>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** A planted twin's check: it found problems, and they name what the criterion says they name. */
export function failsNaming(problems: readonly string[], names: readonly (string | RegExp)[], what: string): void {
  expect(problems.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  for (const n of names) {
    const hit = problems.some((p) => (typeof n === 'string' ? p.includes(n) : n.test(p)));
    expect(hit, `${what}: a failure names ${String(n)}; the failures were:\n  ${problems.slice(0, 40).join('\n  ')}`).toBe(true);
  }
}
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const p = join(dir, `${name}.json`);
  writeFileSync(p, JSON.stringify(value));
  return p;
}

// ---------------------------------------------------------------------------------------------------
// The machine, the build and folders

export function requireGpu(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer runs on macOS's Metal device, the reference platform; this is ${process.platform}`);
}
const BIN = 'deep-gpu';
const CARGO_ARGS = ['build', '--locked', '--bin', BIN];
function cargoBuild(): string {
  const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const r = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${CARGO_ARGS.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
/** Builds deep-gpu before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useGpu(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-484-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target'), 'debug', BIN), join(dir, BIN));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo ${CARGO_ARGS.join(' ')}`).toBe('');
    return join(dir, BIN);
  };
}
/** A fresh output folder per test, deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-484-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one JSON line in, one JSON line out (#377).

/** The wrong programs this suite adds, each reachable only through `--planted` (README: Planted programs). */
export type Planted = 'gpu_cull_by_center' | 'count_read_back' | 'compact_in_reverse' | 'ids_by_compacted_row' | 'row_as_element' | 'dispatch_without_guard';

/** One process: the calls in order, a reply per call. */
export function run(bin: string, out: string, calls: JsonObject[], planted?: Planted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const name = `${BIN} ${args.join(' ')}`;
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const r = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${name}: ${r.error.message}`);
  const stdout = r.stdout ?? '';
  expect(timedOut, `${name} finished within its timeout`).toBe(false);
  expect(r.status, `${name} exited 0 (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  expect(lines.length, `${name}: one output line per input line`).toBe(1);
  const answer = obj(lines[0], `${name}: the answer`);
  expect(answer['ok'], `${name} refused the scenario: ${shown(answer)}`).toBe(true);
  const replies = objs(answer['replies'], `${name}: replies`);
  expect(replies.length, `${name}: one reply per call`).toBe(calls.length);
  return replies;
}
/** A reply the binary answered, not refused; INCONCLUSIVE when it says the platform can't draw it. */
export function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  return reply;
}

// Files the binary writes under `out` are named by their SHA-256 with their kind's extension (#378, #483).
export function namedFile(out: string, hash: string | null, ext: string, what: string): Buffer {
  expect(hash, `${what}: a file named by its SHA-256`).toMatch(SHA);
  const b = readFileSync(join(out, `${hash!}.${ext}`));
  expect(sha256(b), `${what}: the file's SHA-256 is its name`).toBe(hash);
  return b;
}
export function u32File(out: string, hash: string | null, what: string): Uint32Array {
  const b = namedFile(out, hash, 'u32', what);
  return new Uint32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}
export function writeU32(dir: string, name: string, words: Uint32Array): string {
  const p = join(dir, `${name}.u32`);
  writeFileSync(p, Buffer.from(words.buffer, words.byteOffset, words.byteLength));
  return p;
}

// ---------------------------------------------------------------------------------------------------
// Operators (#380, #429, #483). In a document the same fields sit in the `params` of a `gpu.compute@1` item.

export const step = (op: string, args: JsonObject = {}): JsonObject => ({ op, args });
export const u32 = (value: number): JsonObject => step('const@1', { value, type: 'u32' });
/** Storage an operator reads: an output written earlier in the frame, or under `core`, check_operator's `data[output]`. */
export const storage = (type: string, count: number, op: string, output: string): JsonObject => ({ type, count, from: { storage: { op, output } } });
/** A composed compute operator; `elements` is a count or `{from, max}`. */
export function compute(id: string, steps: JsonObject, outputs: JsonObject, extra: JsonObject, elements: JsonValue): JsonObject {
  return { id, kind: 'compute', origin: 'composed', about: `The #484 fixture ${id}.`, inputs: {}, steps, outputs, elements, workgroup: 256, cost: { ns_per_element: 100_000 }, ...extra };
}
/** The check's reply, accepted. */
export function accepted(reply: JsonObject, what: string): JsonObject {
  answered(reply, what);
  expect(reply['outcome'], `${what} passes the check: ${shown(reply['issues'])}`).toBe('accepted');
  return reply;
}
/** Operators for a document, each declaring the cost the check estimates for it, so no declaration is understated and a class's sum holds. */
function withEstimates(bin: string, out: string, ops: JsonObject[]): JsonObject[] {
  const replies = run(bin, out, ops.map((operator) => ({ call: 'check_operator', operator })));
  return ops.map((op, i) => ({ ...op, cost: { ns_per_element: num(accepted(replies[i]!, `the check of ${String(op['id'])}`)['estimate_ns'], `${String(op['id'])}: estimate_ns`) } }));
}
/** An operator as an item of its writer's layer: its kind `gpu.compute@1`, its fields in `params`. */
function asItem(op: JsonObject): JsonObject {
  const params = clone(op);
  delete params['id'];
  delete params['kind'];
  return { kind: 'gpu.compute@1', params };
}

// ---------------------------------------------------------------------------------------------------
// Documents

export type V3 = [number, number, number];
export type Rgb = [number, number, number];
const STATUS: JsonObject = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
/** A physical-basis `look@1` with tone map none at the exposure whose scale is 1 (#424's acceptance look). */
export const LOOK: JsonObject = {
  id: 'look-484-plain', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'A #484 acceptance look.',
  palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', stone: '#d9dde3', sand: '#e6d3a3' },
  roles: { ground: 'night', ink: 'graphite', muted: 'slate', stone: 'stone', sand: 'sand' },
  themes: { light: {}, dark: {} },
  fonts: {
    body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
    mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  },
  tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ground_3d: { kind: 'none' },
  status: { ...STATUS }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: 0.1,
  attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
};

/** A scene document as a session holds it (#378): an `id`, one writer layer, every item in it. */
export function sceneDoc(id: string, size: [number, number], items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #484 acceptance fixture.`, size, camera: 'cam', transport: { span: '10s' },
    requires: { modules: { scene3d: '^1', effects: '^1' } }, layers: { main: { writer: 'agent:sess-alpha', title: 'main', order: 'a0' } }, ...extra, items: withIds,
  };
}
export const box = (size: V3, pos: V3, extra: JsonObject = {}): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos }, ...extra });
export const camera = (position: V3, target: V3, fov: number): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov, near: 1, far: 2000 } });
/** An orthographic `camera@1` looking along −Z at the origin, `viewWidth` m across the frame. */
export const ortho = (viewWidth: number): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'orthographic', position: [0, 0, 20], target: [0, 0, 0], view_width: viewWidth, near: 0.1, far: 100 } });
/** The frame px of world point (x, y) under `ortho(viewWidth)`. */
export const orthoProject = (viewWidth: number, size: [number, number], x: number, y: number): [number, number] =>
  [size[0] / 2 + x * (size[0] / viewWidth), size[1] / 2 - y * (size[0] / viewWidth)];
export const material = (params: JsonObject): JsonObject => ({ kind: 'material@1', params });
export const unlit = (color: Rgb): JsonObject => material({ base_color: [...color, 1], unlit: true });
export const DARK_SKY: JsonObject = { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } };

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
const rad = (d: number): number => (d * Math.PI) / 180;
/** A camera position on an orbit about the origin: azimuth from +Z toward +X, elevation above the horizon, degrees. */
export const orbitPosition = (distance: number, azimuth: number, elevation: number): V3 =>
  scale([Math.cos(rad(elevation)) * Math.sin(rad(azimuth)), Math.sin(rad(elevation)), Math.cos(rad(elevation)) * Math.cos(rad(azimuth))], distance);
/**
 * One turn about the origin in 10 s: linear channels on the camera's x and z, a key every 0.25 s. The camera's
 * target stays the origin, so a point there stays at the frame's centre; between keys the path is a chord.
 */
export function orbitChannels(distance: number, elevation: number): JsonObject {
  const keys = (axis: 0 | 2): JsonObject => Object.fromEntries(Array.from({ length: 41 }, (_, k) => [
    `k${String(k).padStart(2, '0')}`, { t: `${k * 0.25}s`, value: orbitPosition(distance, (k * 360) / 40, elevation)[axis], interp: 'linear' },
  ]));
  return {
    cam_x: { target: 'items/cam/params/position/0', type: 'f32', keys: keys(0) },
    cam_z: { target: 'items/cam/params/position/2', type: 'f32', keys: keys(2) },
  };
}
/** The orbit's samples: t = n ÷ 6 s, frames 0 to 60, covering 0 to 10 s (README: Readings). */
export const ORBIT = { fps: 6, frames: 61 } as const;

/** #378's pinhole: position, target, +Y up, fov across the wider side. */
export interface Pinhole { position: V3; target: V3; fov: number; size: [number, number] }
function basis(cam: Pinhole): { f: V3; r: V3; u: V3; focal: number } {
  const f = unit(sub(cam.target, cam.position));
  const r = unit(cross(f, [0, 1, 0]));
  return { f, r, u: cross(r, f), focal: Math.max(...cam.size) / 2 / Math.tan(rad(cam.fov) / 2) };
}
/** The unit ray through frame point (sx, sy) in px. */
export function rayAt(cam: Pinhole, sx: number, sy: number): V3 {
  const { f, r, u, focal } = basis(cam);
  return unit(add(add(f, scale(r, (sx - cam.size[0] / 2) / focal)), scale(u, -(sy - cam.size[1] / 2) / focal)));
}
/** Where world point `p` lands in the frame, px, and its view depth. */
export function project(cam: Pinhole, p: V3): [number, number, number] {
  const { f, r, u, focal } = basis(cam);
  const d = sub(p, cam.position); const z = dot(d, f);
  return [cam.size[0] / 2 + (focal * dot(d, r)) / z, cam.size[1] / 2 - (focal * dot(d, u)) / z, z];
}
/** mulberry32: a fixed-seed generator of u32 words. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

// ---------------------------------------------------------------------------------------------------
// `view3d` (#378, #424's clicks, #483's `read`), with this suite's fields (README: The surface under test).

export interface Click { frame: number; at: [number, number] }
export interface View3d {
  doc: string; size: [number, number]; frames?: number; fps?: number; from?: number;
  capture?: 'every' | number[]; targets?: 'final'[]; counts?: boolean; cascades?: boolean; clicks?: Click[]; read?: string[];
  /** This suite's: draw from the CPU's f64 cull instead of the GPU's. */
  cull?: 'cpu';
  /** This suite's: each captured frame reports what the cull kept, read after the frame drew. */
  cull_report?: boolean;
  /** This suite's: right after frame `after` draws, the same session jumps to frame `to`. */
  seeks?: { after: number; to: number }[];
}
export const view3dCall = (v: View3d): JsonObject => ({ call: 'view3d', look: LOOK, frames: 1, capture: [0], ...(v as unknown as JsonObject) });

export interface CullRow { item: string; view: string; batch: string; count: number; kept: string }
export interface Drawn {
  frame: number; hash: string | null; final: string | null; clicks: (string | null)[]; maps: number | null;
  cpuCulled: number | null; countsReadBack: number | null; indirect: { item: string; view: string; batch: string }[] | null;
  cull: CullRow[] | null; read: Map<string, string>;
}
const optStr = (v: JsonValue | undefined): string | null => (typeof v === 'string' ? v : null);
const optNum = (v: JsonValue | undefined): number | null => (typeof v === 'number' ? v : null);
export function framesOf(reply: JsonObject, what: string): Drawn[] {
  answered(reply, what);
  return objs(reply['frames'], `${what}: frames`).map((f, i): Drawn => {
    const at = `${what}: frames[${i}]`;
    const cascades = isObject(f['cascades']) ? f['cascades'] : {};
    const reads = isObject(f['read']) ? f['read'] : {};
    return {
      frame: num(f['frame'], `${at}.frame`), hash: optStr(f['pixel_hash']), final: optStr(f['final']),
      clicks: objs(f['clicks'] ?? [], `${at}.clicks`).map((c) => optStr(c['pick'])),
      maps: Array.isArray(cascades['maps']) ? cascades['maps'].length : null,
      cpuCulled: optNum(f['cpu_culled']), countsReadBack: optNum(f['counts_read_back']),
      indirect: f['indirect_draws'] === undefined ? null : objs(f['indirect_draws'], `${at}.indirect_draws`).map((d, j) => ({
        item: str(d['item'], `${at}.indirect_draws[${j}].item`), view: str(d['view'], `${at}.indirect_draws[${j}].view`), batch: str(d['batch'], `${at}.indirect_draws[${j}].batch`),
      })),
      cull: f['cull'] === undefined ? null : objs(f['cull'], `${at}.cull`).map((r, j) => ({
        item: str(r['item'], `${at}.cull[${j}].item`), view: str(r['view'], `${at}.cull[${j}].view`), batch: str(r['batch'], `${at}.cull[${j}].batch`),
        count: num(r['count'], `${at}.cull[${j}].count`), kept: str(r['kept'], `${at}.cull[${j}].kept`),
      })),
      read: new Map(Object.entries(reads).map(([k, v]) => [k, str(obj(v, `${at}.read.${k}`)['file'], `${at}.read.${k}.file`)])),
    };
  });
}
export function frameAt(frames: Drawn[], n: number, what: string): Drawn {
  const f = frames.find((x) => x.frame === n);
  expect(f, `${what}: frame ${n} is in the reply`).toBeDefined();
  return f!;
}
/** What the cull kept for `item` in `view`, as the frame reports it: stable IDs, batch by batch, in compacted order. */
export function keptIn(out: string, f: Drawn, item: string, view: string, what: string): number[] {
  expect(f.cull, `${what}: frame ${f.frame} reports its cull (cull_report)`).not.toBeNull();
  const rows = f.cull!.filter((r) => r.item === item && r.view === view);
  expect(rows.length, `${what}: frame ${f.frame} reports ${item} in ${view}`).toBeGreaterThan(0);
  return rows.flatMap((r) => {
    const ids = u32File(out, r.kept, `${what}: frame ${f.frame}, ${view}, batch ${r.batch}`);
    expect(ids.length, `${what}: frame ${f.frame}, ${view}, batch ${r.batch}: the file holds its count`).toBe(r.count);
    return Array.from(ids);
  });
}

// ---------------------------------------------------------------------------------------------------
// The forest (criteria 1 and 5)

export const FOREST_SIZE: [number, number] = [960, 540];
export const TREES = 100_000;
/** The views an element is culled for: the camera's and the key sun's four cascades. */
export const VIEWS = ['view', 'cascade0', 'cascade1', 'cascade2', 'cascade3'] as const;
/** The camera at frame 0: on the orbit at azimuth 0, 170 m out and 20° up, looking at the origin. */
export const FOREST_CAM: Pinhole = { position: orbitPosition(170, 0, 20), target: [0, 0, 0], fov: 50, size: FOREST_SIZE };
/** The tree whose crown enters the frame while its center stays out, at frame 0 (README: Fixtures). */
export const CROWN_TREE = 73_105;
const CROWN_SCALE = 2;
/** The widest ring of the oak's crown, in its own space: 2.4 m from its axis, 4.4 m up. */
const CROWN_RING = { radius: 2.4, height: 4.4 } as const;
const OAK = [[0.3, 0, false], [0.3, 2.4, false], [2.2, 3, true], [CROWN_RING.radius, CROWN_RING.height, true], [1.4, 6, true], [0.05, 6.8, false]];
const PINE = [[0.25, 0, false], [0.25, 1.4, false], [2, 1.8, false], [0.05, 9.5, false]];

export interface Forest { doc: JsonObject; crownPixel: [number, number]; crownPos: V3 }
let forestMade: Forest | null = null;
/**
 * 100,000 trees of two prototypes (so two batches) on a strip 1,600 m by 300 m along X, each a lathe, under a key sun
 * casting 4 cascades out to 300 m, orbited once in 10 s. Row i has ID i. From +Z the frame sees across the strip and
 * from azimuth 72° (t = 2 s) along it, so the view keeps far more trees at 2 s than at 10 s. Row CROWN_TREE, an oak at
 * twice size, stands so that at frame 0 its base, its middle and the centre of its crown all lie past the frame's right
 * edge while the crown reaches over it; no other tree stands within 140 px of it there, so nothing covers that crown.
 */
export function forest(): Forest {
  if (forestMade) return forestMade;
  const [w] = FOREST_SIZE;
  const row = 300;
  const ring = CROWN_RING.height * CROWN_SCALE;
  const ray = rayAt(FOREST_CAM, w + 16, row);
  const hit = add(FOREST_CAM.position, scale(ray, (ring - FOREST_CAM.position[1]) / ray[1]));
  const crownPos: V3 = [hit[0], 0, hit[2]];
  const crownPixel: [number, number] = [w - 8, row];
  const r = rng(4841);
  const u = (): number => r() / 4294967296;
  const round = (x: number): number => Math.round(x * 1000) / 1000;
  const pos: V3[] = []; const proto: number[] = []; const size: number[] = [];
  for (let i = 0; i < TREES; i++) {
    if (i === CROWN_TREE) { pos.push(crownPos); proto.push(0); size.push(CROWN_SCALE); continue; }
    for (;;) {
      const p: V3 = [round(-800 + 1600 * u()), 0, round(-150 + 300 * u())];
      const at = project(FOREST_CAM, p);
      if (at[2] > 0 && Math.hypot(at[0] - w, at[1] - row) < 140) continue;
      pos.push(p); proto.push(r() & 1); size.push(round(0.8 + 0.6 * u()));
      break;
    }
  }
  const items: Record<string, JsonObject> = {
    cam: camera(FOREST_CAM.position, FOREST_CAM.target, FOREST_CAM.fov),
    sky: { kind: 'sky@1', params: { top: [0.35, 0.5, 0.75, 1], low: [0.75, 0.82, 0.9, 1], ambient_top: [0.25, 0.3, 0.35], ambient_low: [0.1, 0.1, 0.1] } },
    key: { kind: 'light.sun@1', params: { illuminance: Math.PI, color: [1, 1, 1], shadow: true, cascades: 4, split: 0.7, shadow_far: 300, fade: true }, at: { rot: [-50, 30, 0] } },
    ground_mat: material({ base_color: [0.32, 0.3, 0.2, 1], roughness: 0.95 }),
    oak_mat: material({ base_color: [0.2, 0.42, 0.14, 1], roughness: 0.85 }),
    pine_mat: material({ base_color: [0.08, 0.26, 0.17, 1], roughness: 0.85 }),
    ground: box([2000, 1, 800], [0, -0.5, 0], { material: 'ground_mat' }),
    oak: { kind: 'lathe@1', params: { outline: OAK, segments: 8 }, material: 'oak_mat', visible: false },
    pine: { kind: 'lathe@1', params: { outline: PINE, segments: 8 }, material: 'pine_mat', visible: false },
    trees: { kind: 'instance@1', params: { of: ['oak', 'pine'], ids: Array.from({ length: TREES }, (_, i) => i), proto, pos, scale: size } },
  };
  forestMade = { doc: sceneDoc('forest-484', FOREST_SIZE, items, { channels: orbitChannels(170, 20) }), crownPixel, crownPos };
  return forestMade;
}

// ---------------------------------------------------------------------------------------------------
// The composed crowd (criteria 3 and 5)

export const AGENTS = 10_000;
export const CROWD_SIZE: [number, number] = [800, 800];
/** Metres across the frame: 8 px a metre, so a 0.5 m agent is 4 px on an 8 px pitch. */
export const CROWD_VIEW = 100;
/** Agent e's cell in the 100 × 100 grid, centred on the origin, at z = 0. */
export const cell = (e: number): [number, number] => [-49.5 + (e % 100), -49.5 + Math.floor(e / 100)];
/** Agent e's place: its cell, but agent 999 stands exactly where agent 4,995 stands (README: Fixtures). */
const place = (e: number): [number, number] => cell(e === 999 ? 4995 : e);

/**
 * The crowd, as a document written under `out`: `crowd_state` writes each agent's alive flag (agents 0, 5, 10 and on)
 * and its index; `crowd` compacts the indices by the flags, and its `drawn` output, with `count` from that compact
 * step, draws the instancer `agents`. Nothing else names a draw count.
 */
export function crowdDoc(bin: string, out: string): string {
  const state = compute('crowd_state', {
    e: step('element@1'), five: u32(5), zero: u32(0), one: u32(1),
    r: step('rem@1', { a: 'e', b: 'five' }), is_kept: step('eq@1', { a: 'r', b: 'zero' }), f: step('select@1', { f: 'zero', t: 'one', cond: 'is_kept' }),
    w_alive: step('write@1', { buf: 'alive', i: 'e', v: 'f' }), w_index: step('write@1', { buf: 'index', i: 'e', v: 'e' }),
  }, { alive: { storage: { type: 'u32', count: AGENTS } }, index: { storage: { type: 'u32', count: AGENTS } } }, {}, AGENTS);
  const crowd = compute('crowd', { c: step('compact@1', { in: 'index', flag: 'alive', count: AGENTS }) }, {
    kept: { storage: { type: 'u32', count: AGENTS }, from: 'c.out' },
    count: { storage: { type: 'u32', count: 1 }, from: 'c.count' },
    drawn: { instances: { instancer: 'agents', columns: [], count: 'c' } },
  }, { inputs: { index: storage('u32', AGENTS, 'crowd_state', 'index'), alive: storage('u32', AGENTS, 'crowd_state', 'alive') }, after: ['crowd_state'] }, AGENTS);
  const [s, c] = withEstimates(bin, out, [state, crowd]);
  const items: Record<string, JsonObject> = {
    cam: ortho(CROWD_VIEW), sky: DARK_SKY, agent_mat: unlit([0.85, 0.35, 0.2]),
    agent: box([0.5, 0.5, 0.5], [0, 0, 0], { material: 'agent_mat', visible: false }),
    agents: { kind: 'instance@1', params: { of: ['agent'], ids: Array.from({ length: AGENTS }, (_, e) => e), pos: Array.from({ length: AGENTS }, (_, e) => [...place(e), 0]) } },
    crowd_state: asItem(s!), crowd: asItem(c!),
  };
  return writeJson(out, 'crowd', sceneDoc('crowd-484', CROWD_SIZE, items));
}
