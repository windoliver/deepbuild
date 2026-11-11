// Test-side tools for the #1976 acceptance test: the base's `deep-gpu` binary (#377's GPU layer with #378's `view3d`
// and #424's object-ID pick), built once per file and driven by JSON lines; a scene document as a session holds it; the
// reviewed references the criterion is held to: #378's pinhole (the ray through a frame point), ray–sphere, ray–plane
// and ray–triangle hits in f64, a seeded generator and a minimal glTF writer. Copied in part from #424's helpers, since
// suites don't import each other. Nothing here stands in for the hit path under test.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1976 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** The criterion's ID: the first 8 hex digits of SHA-256 of its text, trimmed, whitespace collapsed (README). */
export const AC1 = 'AC1 #1976.aa8721f3';

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
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 600) ?? 'undefined';

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
/** The GPU layer draws the frames whose object-ID target names the item on macOS's Metal device. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws the object-ID target on macOS's Metal device; this is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// The build: deep-gpu built once per file and copied out of the target folder.

const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetDir = (): string => process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');
const CARGO_ARGS = ['build', '--locked', '--bin', 'deep-gpu'];
function cargoBuild(): string {
  const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const run = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${CARGO_ARGS.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
/** Builds deep-gpu before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useGpu(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1976-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(targetDir(), 'debug', exe('deep-gpu')), join(dir, exe('deep-gpu')));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo ${CARGO_ARGS.join(' ')}`).toBe('');
    return join(dir, exe('deep-gpu'));
  };
}
/** A fresh temporary folder per test (documents, assets, outputs), deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1976-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one JSON line in, one JSON line out (#377).

/** The `deep-gpu --planted` name this suite adds, a wrong program reachable only there (README: Planted program). */
export type GpuPlanted = 'hit_from_depth';

/** One process: the calls in order, a reply per call. */
export function runGpu(bin: string, out: string, calls: JsonObject[], planted?: GpuPlanted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const name = `deep-gpu ${args.join(' ')}`;
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
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

/** The answers to frame 0's clicks in a `view3d` reply (#378, #671: `frames[].clicks: [{at, pick, …}]`), in order. */
export function clickAnswers(reply: JsonObject, what: string): JsonObject[] {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  const frame = arr(reply['frames'], `${what}: frames`).map((f, i) => obj(f, `${what}: frames[${i}]`)).find((f) => f['frame'] === 0);
  expect(frame, `${what}: frame 0 is in the reply`).toBeDefined();
  return arr(frame!['clicks'], `${what}: frame 0's clicks`).map((c, i) => obj(c, `${what}: clicks[${i}]`));
}

// ---------------------------------------------------------------------------------------------------
// Looks and documents

/** A physical-basis `look@1` with tone map none at exposure scale 1, no bloom, no deband (#378's acceptance look). */
export const PLAIN_LOOK: JsonObject = {
  id: 'look-1976-plain', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'A #1976 acceptance look.',
  palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', stone: '#d9dde3', sand: '#e6d3a3' },
  roles: { ground: 'night', ink: 'graphite', muted: 'slate', stone: 'stone', sand: 'sand' },
  themes: { light: {}, dark: {} },
  fonts: {
    body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
    mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  },
  tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ground_3d: { kind: 'none' },
  status: { pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464' },
  status_treatment: { core_min_px: 4, glyph: { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' } },
  min_distance: 0.1, attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
};

/** A scene document as a session holds it (#378): an `id`, one writer layer, every item in it, camera `cam`. */
export function sessionDoc(id: string, size: [number, number], items: Record<string, JsonObject>): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #1976 acceptance fixture.`, size, camera: 'cam', transport: { span: '10s' },
    requires: { modules: { scene3d: '^1' } }, layers: { main: { writer: 'agent:sess-alpha', title: 'main', order: 'a0' } }, items: withIds,
  };
}
/** A black sky with no ambient: nothing but the two fixtures draws. */
export const DARK_SKY: JsonObject = { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } };
/** An unlit, double-sided, opaque material of linear `color` (Material: `unlit`). */
export const unlit = (color: V3): JsonObject => ({ kind: 'material@1', params: { base_color: [...color, 1], unlit: true, alpha_mode: 'opaque', alpha: 1, double_sided: true } });

// ---------------------------------------------------------------------------------------------------
// Reviewed references: vectors, #378's pinhole, hits in f64.

export type V3 = [number, number, number];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
export const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const rad = (d: number): number => (d * Math.PI) / 180;

/** #378's pinhole (Camera `camera@1`): position, target, +Y up, `fov` degrees across the wider side of `size`. */
export interface Pinhole { position: V3; target: V3; fov: number; size: [number, number] }
export function basis(cam: Pinhole): { f: V3; r: V3; u: V3; focal: number } {
  const f = unit(sub(cam.target, cam.position));
  const r = unit(cross(f, [0, 1, 0]));
  return { f, r, u: cross(r, f), focal: Math.max(...cam.size) / 2 / Math.tan(rad(cam.fov) / 2) };
}
/** The unit ray from the eye through frame point (sx, sy) in px (x right, y down), pixel (x, y)'s centre at
 * (x + 0.5, y + 0.5). */
export function rayAt(cam: Pinhole, sx: number, sy: number): V3 {
  const { f, r, u, focal } = basis(cam);
  return unit(add(add(f, scale(r, (sx - cam.size[0] / 2) / focal)), scale(u, -(sy - cam.size[1] / 2) / focal)));
}
/** Where world point `p` lands in the frame, px (the inverse of `rayAt`). */
export function project(cam: Pinhole, p: V3): [number, number] {
  const { f, r, u, focal } = basis(cam);
  const d = sub(p, cam.position); const z = dot(d, f);
  return [cam.size[0] / 2 + (focal * dot(d, r)) / z, cam.size[1] / 2 - (focal * dot(d, u)) / z];
}
/** The distance along unit `d` from `o` to where it first meets the sphere at `c` of radius `r` from outside, or null.
 * The closest approach is taken as a vector, so nothing cancels at 400 m. */
export function hitSphere(o: V3, d: V3, c: V3, r: number): number | null {
  const oc = sub(o, c); const tca = -dot(oc, d);
  const perp = add(oc, scale(d, tca)); const h2 = dot(perp, perp);
  if (tca <= 0 || h2 > r * r) return null;
  return tca - Math.sqrt(r * r - h2);
}
/** The distance along unit `d` from `o` to the plane y = 0 inside |x|, |z| ≤ `half`, from above, or null. */
export function hitGround(o: V3, d: V3, half: number): number | null {
  if (o[1] <= 0 || d[1] >= 0) return null;
  const t = -o[1] / d[1]; const p = add(o, scale(d, t));
  return Math.abs(p[0]) <= half && Math.abs(p[2]) <= half ? t : null;
}
/** The distance along unit `d` from `o` to triangle (a, b, c), either face (Möller–Trumbore, f64), or null. */
export function hitTriangle(o: V3, d: V3, a: V3, b: V3, c: V3): number | null {
  const e1 = sub(b, a); const e2 = sub(c, a); const p = cross(d, e2); const det = dot(e1, p);
  if (Math.abs(det) < 1e-30) return null;
  const inv = 1 / det; const s = sub(o, a); const u = dot(s, p) * inv;
  if (u < 0 || u > 1) return null;
  const q = cross(s, e1); const v = dot(d, q) * inv;
  if (v < 0 || u + v > 1) return null;
  const t = dot(e2, q) * inv;
  return t > 0 ? t : null;
}

/** A seeded generator (mulberry32): the same seed gives the same rays. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------------
// Meshes as glTF (a `mesh.asset@1` reads a JSON glTF with its buffer inline as a data URI, #420).

export interface Mesh { positions: V3[]; triangles: [number, number, number][] }
/** The mesh with its positions rounded to f32, as the file holds them, so a reference sees the triangles drawn. */
export const f32 = (m: Mesh): Mesh => ({ positions: m.positions.map((p) => p.map(Math.fround) as V3), triangles: m.triangles });
/** A JSON glTF of `m` (positions and u32 indices, one node, no material), its bytes and their SHA-256. */
export function gltf(m: Mesh): { bytes: Buffer; sha: string } {
  const pos = Buffer.alloc(m.positions.length * 12); const idx = Buffer.alloc(m.triangles.length * 12);
  const lo = [Infinity, Infinity, Infinity]; const hi = [-Infinity, -Infinity, -Infinity];
  m.positions.forEach((p, i) => p.forEach((v, k) => {
    pos.writeFloatLE(v, i * 12 + k * 4);
    lo[k] = Math.min(lo[k]!, Math.fround(v)); hi[k] = Math.max(hi[k]!, Math.fround(v));
  }));
  m.triangles.forEach((t, i) => t.forEach((v, k) => idx.writeUInt32LE(v, i * 12 + k * 4)));
  const doc = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: m.positions.length, type: 'VEC3', min: lo, max: hi },
      { bufferView: 1, componentType: 5125, count: m.triangles.length * 3, type: 'SCALAR' },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.length }, { buffer: 0, byteOffset: pos.length, byteLength: idx.length }],
    buffers: [{ byteLength: pos.length + idx.length, uri: `data:application/octet-stream;base64,${Buffer.concat([pos, idx]).toString('base64')}` }],
  };
  const bytes = Buffer.from(JSON.stringify(doc));
  return { bytes, sha: sha256(bytes) };
}
