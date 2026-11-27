// Test-side tools for #2033: the base's `deep-gpu` binary (#377's GPU layer with #378's `view3d`), built once per file
// and driven by one JSON line; the issue's fixture family (a ground plane, smooth-shaded icospheres of radius 1 m at
// subdivision 2 and 4, a 1 m box and a wall 2 m tall and 0.5 m thick), each handed to the renderer as a positions-only
// JSON glTF in world coordinates; and the CPU reference that says which pixels are lit and which are occluded: f64 rays
// through #378's pinhole against those same triangles, then toward the light. Written for this suite alone (nothing
// imported from other suites). Nothing here stands in for the renderer or its shadow passes.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/2033 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

// The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's trimmed, whitespace-collapsed text.
export const AC1 = 'AC1 #2033.572c2d31';
export const AC2 = 'AC2 #2033.6912f5fe';
export const AC3 = 'AC3 #2033.51cea4a6';
export const AC4 = 'AC4 #2033.4b94b05f';

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
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value, `${what} is a number, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('number');
  return value as number;
}
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const SHA = /^[0-9a-f]{64}$/;
export const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';

/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.join('\n  ')}`).toEqual([]);
}
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

// ---------------------------------------------------------------------------------------------------
// The machine: the reference Mac only (Runs on). Elsewhere INCONCLUSIVE (a skip with its reason, never a pass); on a
// software adapter BLOCKED (an error, never a pass).

/** The reference Macs: `crates/deep-show/reference-macs.json` as the checkout holds it, and the Mac18,1, which the
 * owner named a reference Mac on 2026-11-20 (#2956; commit 9c7ecd658, PR #2097) and the base's file doesn't list yet. */
export function referenceMacs(): string[] {
  const listed = JSON.parse(readFileSync(join(REPO, 'crates/deep-show/reference-macs.json'), 'utf8')) as string[];
  return [...new Set([...listed, 'Mac18,1'])];
}
/** Why this machine isn't the reference Mac, or null when it is. */
export function notReference(): string | null {
  if (process.platform !== 'darwin') return `every criterion reads frames on the reference Mac (macOS's Metal device); this is ${process.platform}`;
  const model = spawnSync('sysctl', ['-n', 'hw.model'], { encoding: 'utf8' }).stdout?.trim() ?? '';
  const macs = referenceMacs();
  return macs.includes(model) ? null : `every criterion reads frames on a reference Mac (${macs.join(', ')}); this machine is ${model || 'unknown'}`;
}
/** Skips the test as INCONCLUSIVE off the reference Mac. */
export function requireReference(skip: (note?: string) => never): void {
  const why = notReference();
  if (why) skip(`INCONCLUSIVE: ${why}; this is not a pass`);
}

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
/** Builds deep-gpu before the file's tests (not off the reference Mac, where they skip); a test that uses a build that
 * failed fails with cargo's error. */
export function useGpu(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    if (notReference()) return;
    dir = mkdtempSync(join(tmpdir(), 'deep-2033-bin-'));
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
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-2033-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run`: one JSON line `{out, calls}` in, one JSON line out (#377).

/** One process: the calls in order, a reply per call. */
export function runGpu(bin: string, out: string, calls: JsonObject[]): JsonObject[] {
  const name = 'deep-gpu run';
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 900_000, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${name}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  expect(timedOut, `${name} finished within its timeout`).toBe(false);
  expect(run.status, `${name} exited 0 (${run.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(run.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((line) => line !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(1);
  let parsed: JsonValue;
  try { parsed = JSON.parse(lines[0]!) as JsonValue; } catch { return expect.fail(`${name}: its answer is JSON: ${lines[0]!.slice(0, 600)}`); }
  const answer = obj(parsed, `${name}: the answer`);
  expect(answer['ok'], `${name} refused the scenario: ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], `${name}: replies`).map((r, i) => obj(r, `${name}: replies[${i}]`));
  expect(replies.length, `${name}: one reply per call`).toBe(calls.length);
  return replies;
}
/** BLOCKED (thrown as an error, never a pass) when the GPU layer runs on a software adapter: the full lane's call
 * names the adapter and its device type. */
export function requireHardware(bin: string, out: string): void {
  const [reply] = runGpu(bin, out, [{ call: 'full_lane' }]);
  const adapter = reply!['adapter'];
  if (!isObject(adapter)) throw Error(`BLOCKED: the GPU layer names no adapter (${shown(reply)}); nothing is judged without a hardware GPU`);
  if (adapter['type'] === 'cpu') throw Error(`BLOCKED: the GPU layer runs on a software adapter (${shown(adapter)}); these frames are judged only on the reference Mac's GPU`);
}
/** A reply that holds no refusal `code`. */
export function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform') throw Error(`BLOCKED: ${what} reports unsupported_platform`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  return reply;
}

// ---------------------------------------------------------------------------------------------------
// Vectors

export type V3 = [number, number, number];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: V3): V3 => { const l = len(a); return [a[0] / l, a[1] / l, a[2] / l]; };
export const rad = (d: number): number => (d * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;
/** R = Rz·Ry·Rx (degrees) applied to `v` (Units and axes). */
export function rotate(rot: V3, v: V3): V3 {
  const [cx, sx] = [Math.cos(rad(rot[0])), Math.sin(rad(rot[0]))];
  const [cy, sy] = [Math.cos(rad(rot[1])), Math.sin(rad(rot[1]))];
  const [cz, sz] = [Math.cos(rad(rot[2])), Math.sin(rad(rot[2]))];
  const x1: V3 = [v[0], cx * v[1] - sx * v[2], sx * v[1] + cx * v[2]];
  const y1: V3 = [cy * x1[0] + sy * x1[2], x1[1], -sy * x1[0] + cy * x1[2]];
  return [cz * y1[0] - sz * y1[1], sz * y1[0] + cz * y1[1], y1[2]];
}
/** The `at.rot` (Rz = 0) that turns a light's own −Z onto the unit direction `d`: Ry(b)·Rx(a)·(0, 0, −1) =
 * (−sin b cos a, sin a, −cos b cos a). */
export function aim(d: V3): V3 {
  const a = Math.asin(Math.max(-1, Math.min(1, d[1])));
  const b = Math.atan2(-d[0], -d[2]);
  return [deg(a), deg(b), 0];
}
/** The unit direction toward a light at `elevation` above the plane, from azimuth `azimuth` (degrees from +X toward +Z). */
export const towardAt = (elevation: number, azimuth: number): V3 =>
  [Math.cos(rad(elevation)) * Math.cos(rad(azimuth)), Math.sin(rad(elevation)), Math.cos(rad(elevation)) * Math.sin(rad(azimuth))];

// ---------------------------------------------------------------------------------------------------
// The fixture family's meshes, in world coordinates. Positions are rounded to f32 as the glTF holds them, so the CPU
// rays meet exactly the triangles the renderer reads.

export interface Mesh { positions: V3[]; triangles: [number, number, number][] }
const f32 = (p: V3): V3 => [Math.fround(p[0]), Math.fround(p[1]), Math.fround(p[2])];

/** An icosphere of radius `r` about `c`: midpoint subdivision `depth` times, each new point renormalized to the sphere,
 * every vertex shared by the triangles that meet at it (so the reader's smooth normals average across them),
 * counter-clockwise seen from outside. */
export function icosphere(depth: number, c: V3, r: number): Mesh {
  const t = (1 + Math.sqrt(5)) / 2;
  const unitPos: V3[] = ([
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ] as V3[]).map(unit);
  let triangles: [number, number, number][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let d = 0; d < depth; d++) {
    const mids = new Map<string, number>();
    const mid = (a: number, b: number): number => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      let i = mids.get(key);
      if (i === undefined) { i = unitPos.length; unitPos.push(unit(scale(add(unitPos[a]!, unitPos[b]!), 0.5))); mids.set(key, i); }
      return i;
    };
    const next: [number, number, number][] = [];
    for (const [a, b, cc] of triangles) {
      const ab = mid(a, b); const bc = mid(b, cc); const ca = mid(cc, a);
      next.push([a, ab, ca], [b, bc, ab], [cc, ca, bc], [ab, bc, ca]);
    }
    triangles = next;
  }
  triangles = triangles.map(([a, b, cc]) => {
    const n = cross(sub(unitPos[b]!, unitPos[a]!), sub(unitPos[cc]!, unitPos[a]!));
    return dot(n, unitPos[a]!) > 0 ? [a, b, cc] : [a, cc, b];
  });
  return { positions: unitPos.map((p) => f32(add(c, scale(p, r)))), triangles };
}
/** The lowest point of a unit icosphere at `depth`: a sphere of radius r rests on the plane when its centre is −r × this
 * above it. */
export function icosphereBottom(depth: number): number {
  return Math.min(...icosphere(depth, [0, 0, 0], 1).positions.map((p) => p[1]));
}
/** An axis-aligned box from `min` to `max`, each face its own four vertices (so the reader's normals are the face's:
 * flat), counter-clockwise from outside. */
export function boxMesh(min: V3, max: V3): Mesh {
  const positions: V3[] = []; const triangles: [number, number, number][] = [];
  const face = (corners: V3[]): void => {
    const b = positions.length;
    positions.push(...corners.map(f32));
    triangles.push([b, b + 1, b + 2], [b, b + 2, b + 3]);
  };
  const [x0, y0, z0] = min; const [x1, y1, z1] = max;
  face([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]); // +x
  face([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]); // −x
  face([[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]]); // +y
  face([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]); // −y
  face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]); // +z
  face([[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]]); // −z
  return { positions, triangles };
}
/** The ground plane: one quad at y = 0 over x ∈ [x0, x1], z ∈ [z0, z1], facing +y. */
export function planeMesh(x0: number, x1: number, z0: number, z1: number): Mesh {
  return { positions: ([[x0, 0, z0], [x0, 0, z1], [x1, 0, z1], [x1, 0, z0]] as V3[]).map(f32), triangles: [[0, 1, 2], [0, 2, 3]] };
}
/** A JSON glTF of `m` (POSITION and u32 indices only, one node, no material, no normals), its buffer inline as a data
 * URI (#420's `mesh.asset@1` reads it); its bytes and their SHA-256. */
export function gltf(m: Mesh): { bytes: Buffer; sha: string } {
  const pos = Buffer.alloc(m.positions.length * 12); const idx = Buffer.alloc(m.triangles.length * 12);
  m.positions.forEach((p, i) => p.forEach((v, k) => pos.writeFloatLE(v, i * 12 + k * 4)));
  m.triangles.forEach((t, i) => t.forEach((v, k) => idx.writeUInt32LE(v, i * 12 + k * 4)));
  const lo = [0, 1, 2].map((k) => Math.min(...m.positions.map((p) => p[k]!)));
  const hi = [0, 1, 2].map((k) => Math.max(...m.positions.map((p) => p[k]!)));
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

/** One item of a fixture: its ID (the object-ID target names it), its triangles and its material. */
export interface Part { id: string; mesh: Mesh; material: 'clay' | 'ground'; box?: { min: V3; max: V3 } }

export const SPHERE_R = 1;
export function sphere(depth: 2 | 4, x: number, z: number): Part {
  const y = -SPHERE_R * icosphereBottom(depth);
  return { id: `sphere${depth}`, mesh: icosphere(depth, [x, y, z], SPHERE_R), material: 'clay' };
}
export function cube(cx: number, cz: number): Part {
  const min: V3 = [cx - 0.5, 0, cz - 0.5]; const max: V3 = [cx + 0.5, 1, cz + 0.5];
  return { id: 'box', mesh: boxMesh(min, max), material: 'clay', box: { min, max } };
}
/** The wall: 2 m tall and 0.5 m thick, 4 m long along z. */
export function wall(cx: number, cz: number): Part {
  const min: V3 = [cx - 0.25, 0, cz - 2]; const max: V3 = [cx + 0.25, 2, cz + 2];
  return { id: 'wall', mesh: boxMesh(min, max), material: 'clay', box: { min, max } };
}
export function ground(x0: number, x1: number, z0: number, z1: number): Part {
  return { id: 'plane', mesh: planeMesh(x0, x1, z0, z1), material: 'ground' };
}

// ---------------------------------------------------------------------------------------------------
// Documents

export const SIZE: [number, number] = [640, 480];
export interface Pinhole { position: V3; target: V3; fov: number; near: number; far: number }

const STATUS: JsonObject = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
/** A physical-basis `look@1` (#421's shape), filmic at exposure 0, no bloom, no deband, no finish, no 3D ground (#1297's
 * repro look). */
export const FILMIC_LOOK: JsonObject = {
  id: 'look-2033-filmic', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'A #2033 acceptance look.',
  palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97' },
  roles: { ground: 'night', ink: 'graphite', muted: 'slate' },
  themes: { light: {}, dark: {} },
  fonts: {
    body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
    mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  },
  tone_map: 'filmic', exposure: 0, finish: [], deband: 'none', bloom: 'none', ground_3d: { kind: 'none' },
  status: { ...STATUS }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: 0.1,
  attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
};

export const AGENT = 'agent:sess-alpha';
/** A scene document as a session holds it (#378): every item in one writer layer. */
export function sessionDoc(id: string, items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #2033 acceptance fixture.`, size: SIZE, camera: 'cam', transport: { span: '10s' },
    requires: { modules: { scene3d: '^1' } }, layers: { main: { writer: AGENT, title: 'main', order: 'a0' } }, ...extra, items: withIds,
  };
}

/** The light a frame is drawn under, as the document gives it and the CPU rays read it. */
export type Light =
  | { kind: 'sun'; toward: V3; lux: number; cascades: number; split: number; shadowFar: number }
  | { kind: 'spot' | 'point'; pos: V3; axis: V3; outer: number; inner: number; power: number };
export type Variant = 'shadow' | 'noshadow' | 'off';

/** A fixture's document: its parts as `mesh.asset@1` items (their glTFs written under `dir`), #1297's clay and a grey
 * ground, the camera, a black sky with no ambient, and the light: casting (`shadow`), with `shadow: false`
 * (`noshadow`), or off (`off`: its illuminance or power 0, all else kept). A local light's document names the light
 * policy's local shadows: one spot and one point light shadowed, 512 px maps (Light policy: local shadows). */
export function fixtureDoc(dir: string, name: string, parts: Part[], cam: Pinhole, light: Light, variant: Variant): { doc: string; assets: Record<string, string> } {
  const assets: Record<string, string> = {};
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: cam.position, target: cam.target, fov: cam.fov, near: cam.near, far: cam.far } },
    sky: { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } },
    clay: { kind: 'material@1', params: { base_color: [0.7, 0.5, 0.35, 1], roughness: 0.6 } },
    ground: { kind: 'material@1', params: { base_color: [0.5, 0.5, 0.5, 1], roughness: 0.9 } },
  };
  for (const p of parts) {
    const g = gltf(p.mesh);
    const path = join(dir, `${g.sha}.gltf`); writeFileSync(path, g.bytes); assets[g.sha] = path;
    items[p.id] = { kind: 'mesh.asset@1', params: { sha256: g.sha, node: 0 }, at: { pos: [0, 0, 0] }, material: p.material };
  }
  const shadow = variant !== 'noshadow';
  let extra: JsonObject = {};
  if (light.kind === 'sun') {
    items['key'] = {
      kind: 'light.sun@1',
      params: { illuminance: variant === 'off' ? 0 : light.lux, color: [1, 1, 1], shadow, cascades: light.cascades, split: light.split, shadow_far: light.shadowFar },
      at: { rot: aim(scale(light.toward, -1)) },
    };
  } else {
    const params: JsonObject = { power: variant === 'off' ? 0 : light.power, color: [1, 1, 1], shadow };
    if (light.kind === 'spot') { params['outer'] = light.outer; params['inner'] = light.inner; }
    items['key'] = { kind: light.kind === 'spot' ? 'light.spot@1' : 'light.point@1', params, at: light.kind === 'spot' ? { pos: light.pos, rot: aim(light.axis) } : { pos: light.pos } };
    extra = { light_policy: { shadowed: { sun: 1, spots: 1, points: 1 }, local_map: 512 } };
  }
  return { doc: writeJson(dir, `${name}-${variant}`, sessionDoc(`${name}-${variant}`, items, extra)), assets };
}
/** One `view3d` call of a one-frame document: the final and object-ID targets, the cascades and local maps reported. */
export const view3dCall = (doc: string, assets: Record<string, string>): JsonObject =>
  ({ call: 'view3d', doc, look: FILMIC_LOOK, size: SIZE, frames: 1, capture: [0], targets: ['final', 'ids'], cascades: true, shadows: true, assets });

// ---------------------------------------------------------------------------------------------------
// The reply: frame 0's targets, its cascades, its local maps and the passes

export interface CascadeMap { texel: number }
export interface LocalMap { light: string; kind: string }
export interface ViewFrame {
  final: string | null; ids: string | null; picks: Map<number, string> | null;
  splits: number[] | null; cascades: CascadeMap[] | null; locals: LocalMap[] | null;
}
const optStr = (v: JsonValue | undefined, what: string): string | null => (v === undefined || v === null ? null : str(v, what));
export function frame0(reply: JsonObject, what: string): ViewFrame {
  answered(reply, what);
  const frames = arr(reply['frames'], `${what}: frames`).map((v, i) => obj(v, `${what}: frames[${i}]`));
  const f = frames.find((x) => x['frame'] === 0);
  expect(f, `${what}: frame 0 is in the reply`).toBeDefined();
  const at = `${what}: frame 0`;
  const pk = f!['picks'];
  const picks = isObject(pk) ? new Map(Object.entries(pk).map(([k, id]) => [Number(k), str(id, `${at}.picks[${k}]`)])) : null;
  let splits: number[] | null = null; let cascades: CascadeMap[] | null = null; let locals: LocalMap[] | null = null;
  const c = f!['cascades'];
  if (isObject(c)) {
    splits = arr(c['splits'], `${at}.cascades.splits`).map((d) => num(d, `${at}: a split`));
    cascades = arr(c['maps'], `${at}.cascades.maps`).map((m, j) => ({ texel: num(obj(m, `${at}.cascades.maps[${j}]`)['texel_m'], `${at}.cascades.maps[${j}].texel_m`) }));
  }
  const s = f!['shadows'];
  if (isObject(s)) {
    locals = arr(s['maps'], `${at}.shadows.maps`).map((m, j) => {
      const o = obj(m, `${at}.shadows.maps[${j}]`);
      return { light: str(o['light'], `${at}.shadows.maps[${j}].light`), kind: str(o['kind'], `${at}.shadows.maps[${j}].kind`) };
    });
  }
  return { final: optStr(f!['final'], `${at}.final`), ids: optStr(f!['ids'], `${at}.ids`), picks, splits, cascades, locals };
}
/** The names of the reply's passes, in order. */
export function passNames(reply: JsonObject, what: string): string[] {
  return arr(reply['passes'], `${what}: passes`).map((p, i) => str(obj(p, `${what}: passes[${i}]`)['name'], `${what}: passes[${i}].name`));
}

function readNamed(out: string, hash: string | null, ext: string, what: string): Buffer {
  expect(hash, `${what} is written, named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${hash}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** Reads an 8-bit RGBA PNG with no interlace. */
export function decodeRgbaPng(file: Buffer, what: string): { width: number; height: number; rgba: Uint8Array } {
  expect(file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${what} is a PNG`).toBe(true);
  let at = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (at < file.length) {
    const l = file.readUInt32BE(at); const type = file.toString('latin1', at + 4, at + 8); const body = file.subarray(at + 8, at + 8 + l);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + l;
  }
  expect([depth, color, interlace], `${what} is an 8-bit RGBA PNG with no interlace`).toEqual([8, 6, 0]);
  const stride = width * 4;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    expect(filter <= 4, `${what}: PNG filter ${filter} is one of 0–4`).toBe(true);
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? line[i - 4]! : 0; const b = previous[i]!; const c = i >= 4 ? previous[i - 4]! : 0; const x = line[i]!;
      const v = filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + b : filter === 3 ? x + ((a + b) >> 1) : x + paeth(a, b, c);
      line[i] = v & 255;
    }
    rgba.set(line, y * stride);
    previous = line;
  }
  return { width, height, rgba };
}
/** The final target (#378): sRGB 8-bit RGBA, rows top-down. */
export function readFinal(out: string, f: ViewFrame, what: string): Uint8Array {
  const png = decodeRgbaPng(readNamed(out, f.final, 'png', what), what);
  expect([png.width, png.height], `${what} is ${SIZE[0]} × ${SIZE[1]}`).toEqual(SIZE);
  return png.rgba;
}
/** The object-ID target (#378), per pixel the item it names ('' where nothing draws). */
export function readIds(out: string, f: ViewFrame, what: string): string[] {
  const png = decodeRgbaPng(readNamed(out, f.ids, 'png', what), what);
  expect([png.width, png.height], `${what} is ${SIZE[0]} × ${SIZE[1]}`).toEqual(SIZE);
  expect(f.picks, `${what}: the frame names the item each pick ID stands for`).not.toBeNull();
  const out2: string[] = new Array(SIZE[0] * SIZE[1]);
  for (let i = 0; i < out2.length; i++) {
    const o = i * 4;
    const pick = (png.rgba[o]! + png.rgba[o + 1]! * 256 + png.rgba[o + 2]! * 65_536 + png.rgba[o + 3]! * 16_777_216) >>> 0;
    out2[i] = pick === 0 ? '' : f.picks!.get(pick) ?? `unknown:${pick}`;
  }
  return out2;
}
/** Per pixel, the largest of its R, G and B code differences between two final frames. */
export function codes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(SIZE[0] * SIZE[1]);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(Math.abs(a[i * 4]! - b[i * 4]!), Math.abs(a[i * 4 + 1]! - b[i * 4 + 1]!), Math.abs(a[i * 4 + 2]! - b[i * 4 + 2]!));
  return out;
}
export const brightest = (rgba: Uint8Array, i: number): number => Math.max(rgba[i * 4]!, rgba[i * 4 + 1]!, rgba[i * 4 + 2]!);

// ---------------------------------------------------------------------------------------------------
// The CPU reference: f64 rays against the fixture's own triangles, through a bounding-volume hierarchy.

export class Tracer {
  readonly ids: string[];
  readonly boxes: ({ min: V3; max: V3 } | undefined)[];
  private readonly p: Float64Array; // 9 per triangle
  private readonly fn: Float64Array; // the face's unit normal, 3 per triangle
  private readonly sn: Float64Array; // the smooth normals at its corners, 9 per triangle
  private readonly part: Int32Array;
  private nodeBox!: Float64Array; private nodeA!: Int32Array; private nodeB!: Int32Array; private nodeLeaf!: Uint8Array;
  private order!: Int32Array;
  private nodes = 0;
  /** Each part's own hierarchy (every part is convex, so a point on a part's face never needs its own part tested). */
  private roots: number[] = [];

  constructor(parts: Part[]) {
    this.ids = parts.map((p) => p.id);
    this.boxes = parts.map((p) => p.box);
    const count = parts.reduce((n, p) => n + p.mesh.triangles.length, 0);
    this.p = new Float64Array(count * 9); this.fn = new Float64Array(count * 3); this.sn = new Float64Array(count * 9); this.part = new Int32Array(count);
    let t = 0;
    const ranges: [number, number][] = [];
    parts.forEach((part, k) => {
      ranges.push([t, t + part.mesh.triangles.length]);
      const { positions, triangles } = part.mesh;
      // The reader's normals where a file has none: each vertex the unit sum of its triangles' unnormalized normals.
      const acc: V3[] = positions.map(() => [0, 0, 0]);
      for (const [a, b, c] of triangles) {
        const n = cross(sub(positions[b]!, positions[a]!), sub(positions[c]!, positions[a]!));
        for (const v of [a, b, c]) acc[v] = add(acc[v]!, n);
      }
      const smooth = acc.map(unit);
      for (const tri of triangles) {
        const [a, b, c] = tri.map((i) => positions[i]!) as [V3, V3, V3];
        this.p.set([...a, ...b, ...c], t * 9);
        this.fn.set(unit(cross(sub(b, a), sub(c, a))), t * 3);
        this.sn.set([...smooth[tri[0]]!, ...smooth[tri[1]]!, ...smooth[tri[2]]!], t * 9);
        this.part[t] = k; t++;
      }
    });
    this.build(count, ranges);
  }

  private build(count: number, ranges: [number, number][]): void {
    const cap = 2 * count + 1;
    this.nodeBox = new Float64Array(cap * 6); this.nodeA = new Int32Array(cap); this.nodeB = new Int32Array(cap); this.nodeLeaf = new Uint8Array(cap);
    this.order = Int32Array.from({ length: count }, (_, i) => i);
    const cen = new Float64Array(count * 3);
    for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) cen[i * 3 + k] = (this.p[i * 9 + k]! + this.p[i * 9 + 3 + k]! + this.p[i * 9 + 6 + k]!) / 3;
    const make = (lo: number, hi: number): number => {
      const n = this.nodes++;
      const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (let i = lo; i < hi; i++) {
        const t = this.order[i]!;
        for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) {
          const x = this.p[t * 9 + v * 3 + k]!;
          if (x < b[k]!) b[k] = x; if (x > b[3 + k]!) b[3 + k] = x;
        }
      }
      this.nodeBox.set(b, n * 6);
      if (hi - lo <= 4) { this.nodeLeaf[n] = 1; this.nodeA[n] = lo; this.nodeB[n] = hi; return n; }
      let axis = 0; let ext = -1;
      for (let k = 0; k < 3; k++) { const e = b[3 + k]! - b[k]!; if (e > ext) { ext = e; axis = k; } }
      const slice = Array.from(this.order.subarray(lo, hi)).sort((x, y) => cen[x * 3 + axis]! - cen[y * 3 + axis]!);
      this.order.set(slice, lo);
      const mid = (lo + hi) >> 1;
      const left = make(lo, mid); const right = make(mid, hi);
      this.nodeA[n] = left; this.nodeB[n] = right;
      return n;
    };
    this.roots = ranges.map(([lo, hi]) => make(lo, hi));
  }

  private boxHit(n: number, o: V3, inv: V3, tmax: number, grow = 0): boolean {
    let t0 = 0; let t1 = tmax;
    for (let k = 0; k < 3; k++) {
      let a = (this.nodeBox[n * 6 + k]! - grow - o[k]!) * inv[k]!; let b = (this.nodeBox[n * 6 + 3 + k]! + grow - o[k]!) * inv[k]!;
      if (a > b) { const s = a; a = b; b = s; }
      if (a > t0) t0 = a; if (b < t1) t1 = b;
      if (t0 > t1) return false;
    }
    return true;
  }
  /** Möller–Trumbore, either side: t, and the barycentric u and v, or null. */
  private tri(t: number, o: V3, d: V3, out: { t: number; u: number; v: number }): boolean {
    const P = this.p; const i = t * 9;
    const e1x = P[i + 3]! - P[i]!; const e1y = P[i + 4]! - P[i + 1]!; const e1z = P[i + 5]! - P[i + 2]!;
    const e2x = P[i + 6]! - P[i]!; const e2y = P[i + 7]! - P[i + 1]!; const e2z = P[i + 8]! - P[i + 2]!;
    const qx = d[1] * e2z - d[2] * e2y; const qy = d[2] * e2x - d[0] * e2z; const qz = d[0] * e2y - d[1] * e2x;
    const det = e1x * qx + e1y * qy + e1z * qz;
    if (Math.abs(det) < 1e-14) return false;
    const inv = 1 / det;
    const sx = o[0] - P[i]!; const sy = o[1] - P[i + 1]!; const sz = o[2] - P[i + 2]!;
    const u = (sx * qx + sy * qy + sz * qz) * inv;
    if (u < 0 || u > 1) return false;
    const rx = sy * e1z - sz * e1y; const ry = sz * e1x - sx * e1z; const rz = sx * e1y - sy * e1x;
    const v = (d[0] * rx + d[1] * ry + d[2] * rz) * inv;
    if (v < 0 || u + v > 1) return false;
    const tt = (e2x * rx + e2y * ry + e2z * rz) * inv;
    if (tt <= 1e-9) return false;
    out.t = tt; out.u = u; out.v = v;
    return true;
  }
  /** The first triangle the ray from `o` along unit `d` meets within `tmax`, or −1 (any: the first found). */
  private walk(root: number, o: V3, d: V3, any: boolean, best: { t: number; u: number; v: number; tri: number }): void {
    const inv: V3 = [1 / d[0], 1 / d[1], 1 / d[2]];
    const stack = [root];
    const hit = { t: 0, u: 0, v: 0 };
    while (stack.length) {
      const n = stack.pop()!;
      if (!this.boxHit(n, o, inv, best.t)) continue;
      if (this.nodeLeaf[n]) {
        for (let i = this.nodeA[n]!; i < this.nodeB[n]!; i++) {
          const t = this.order[i]!;
          if (this.tri(t, o, d, hit) && hit.t < best.t) {
            best.t = hit.t; best.u = hit.u; best.v = hit.v; best.tri = t;
            if (any) return;
          }
        }
      } else { stack.push(this.nodeA[n]!, this.nodeB[n]!); }
    }
  }
  private scratch = { t: 0, u: 0, v: 0, tri: -1 };
  /** The ray's first hit: the part it meets, where, the face's unit normal and the smooth normal there. */
  first(o: V3, d: V3): Hit | null {
    const b = this.scratch;
    b.t = Infinity; b.tri = -1;
    for (const r of this.roots) this.walk(r, o, d, false, b);
    if (b.tri < 0) return null;
    const t = b.tri; const w = 1 - b.u - b.v; const S = this.sn;
    const smooth = unit([
      w * S[t * 9]! + b.u * S[t * 9 + 3]! + b.v * S[t * 9 + 6]!,
      w * S[t * 9 + 1]! + b.u * S[t * 9 + 4]! + b.v * S[t * 9 + 7]!,
      w * S[t * 9 + 2]! + b.u * S[t * 9 + 5]! + b.v * S[t * 9 + 8]!,
    ]);
    return { part: this.part[t]!, p: add(o, scale(d, b.t)), face: [this.fn[t * 3]!, this.fn[t * 3 + 1]!, this.fn[t * 3 + 2]!], smooth };
  }
  /** Whether any part but `skip` lies on the segment from `o` along unit `d` for `tmax`. */
  blocked(o: V3, d: V3, tmax: number, skip = -1): boolean {
    const b = this.scratch;
    b.t = tmax; b.tri = -1;
    for (const [k, r] of this.roots.entries()) {
      if (k === skip) continue;
      this.walk(r, o, d, true, b);
      if (b.tri >= 0) return true;
    }
    return false;
  }
  /** Whether any triangle of a part but `skip` may lie within `grow` of the segment from `o` along unit `d` for `tmax`
   * (conservative: a leaf's box grown by `grow` meets the segment). False means no ray beside it within `grow` is
   * blocked either. */
  near(o: V3, d: V3, tmax: number, grow: number, skip: number): boolean {
    const inv: V3 = [1 / d[0], 1 / d[1], 1 / d[2]];
    for (const [k, r] of this.roots.entries()) {
      if (k === skip) continue;
      const stack = [r];
      while (stack.length) {
        const n = stack.pop()!;
        if (!this.boxHit(n, o, inv, tmax, grow)) continue;
        if (this.nodeLeaf[n]) return true;
        stack.push(this.nodeA[n]!, this.nodeB[n]!);
      }
    }
    return false;
  }
}
export interface Hit { part: number; p: V3; face: V3; smooth: V3 }

/** #378's pinhole: position, target, +Y up, `fov` across the wider side; the ray through image point (u, v) in pixels
 * from the top left, and the view's forward axis. */
export function pinhole(cam: Pinhole): { ray: (u: number, v: number) => V3; forward: V3 } {
  const f = unit(sub(cam.target, cam.position));
  const r = unit(cross(f, [0, 1, 0]));
  const up = cross(r, f);
  const focal = Math.max(...SIZE) / 2 / Math.tan(rad(cam.fov) / 2);
  return {
    forward: f,
    ray: (u, v) => unit(add(add(f, scale(r, (u - SIZE[0] / 2) / focal)), scale(up, -(v - SIZE[1] / 2) / focal))),
  };
}

/** The unit direction from `p` toward the light and the distance to it (Infinity for the sun). */
function toLight(light: Light, p: V3): { l: V3; dist: number } {
  if (light.kind === 'sun') return { l: light.toward, dist: Infinity };
  const v = sub(light.pos, p); const d = len(v);
  return { l: scale(v, 1 / d), dist: d };
}
/** Whether `p` lies inside a spot's outer cone (always, for a sun or a point light). */
function inCone(light: Light, p: V3): boolean {
  if (light.kind !== 'spot') return true;
  return dot(unit(sub(p, light.pos)), light.axis) >= Math.cos(rad(light.outer));
}
/** Faces the light by 10° or more: the light stands 10° or more above the surface's tangent plane. */
export const FACING = Math.sin(rad(10));
export const EDGE_M = 0.25;
export const WALL_M = 0.25;
const LIFT = 1e-4;

/** What the CPU rays say of one point a ray met. */
interface Seen { part: number; lit: boolean; facing: boolean; cone: boolean; through: number; hit: Hit; dist: number; depth: number }

/** The length of the segment from `p` along unit `l` for `tmax` that lies inside the axis-aligned box. */
function insideLength(p: V3, l: V3, tmax: number, box: { min: V3; max: V3 }): number {
  let t0 = 0; let t1 = Math.min(tmax, 1e4);
  for (let k = 0; k < 3; k++) {
    if (Math.abs(l[k]!) < 1e-15) { if (p[k]! < box.min[k]! || p[k]! > box.max[k]!) return 0; continue; }
    let a = (box.min[k]! - p[k]!) / l[k]!; let b = (box.max[k]! - p[k]!) / l[k]!;
    if (a > b) { const s = a; a = b; b = s; }
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
  }
  return Math.max(0, t1 - t0);
}

/** Per pixel of a frame, what the CPU rays say. `cls`: 0 nothing judged; LIT, a pixel whose centre and four corners
 * meet one part, each lit (unoccluded, facing the light by 10° or more by face and smooth normal, inside a spot's
 * cone), the centre 0.25 m or more from a shadow edge; DARK, the same with each occluded and the centre 0.25 m or more
 * inside the shadow; BEHIND, a plane pixel whose centre's and corners' rays to the light each pass through 0.25 m or
 * more of the wall. `part` is the part the centre meets (−1 none), `agree` whether the corners meet it too, `depth` the
 * centre's view depth. */
export const LIT = 1; export const DARK = 2;
export interface Classes { cls: Uint8Array; behind: Uint8Array; part: Int8Array; agree: Uint8Array; depth: Float64Array; ids: string[] }
export function classify(parts: Part[], cam: Pinhole, light: Light): Classes {
  const tracer = new Tracer(parts);
  const { ray, forward } = pinhole(cam);
  const wallIndex = tracer.ids.indexOf('wall');
  const wallBox = wallIndex >= 0 ? tracer.boxes[wallIndex] : undefined;
  const see = (u: number, v: number): Seen | null => {
    const d = ray(u, v);
    const hit = tracer.first(cam.position, d);
    if (!hit) return null;
    const { l, dist } = toLight(light, hit.p);
    // The face normal toward the eye side (every judged surface is seen from its front).
    const facing = dot(hit.face, l) >= FACING && dot(hit.smooth, l) >= FACING;
    // Every part is convex, so a ray leaving a point on its face toward the light (n·l > 0) never meets that part.
    const lit = dot(hit.face, l) > 0 && !tracer.blocked(add(hit.p, scale(hit.face, LIFT)), l, dist, hit.part);
    const through = wallBox ? insideLength(hit.p, l, dist, wallBox) : 0;
    return { part: hit.part, lit, facing, cone: inCone(light, hit.p), through, hit, dist, depth: dot(sub(hit.p, cam.position), forward) };
  };
  const [W, H] = SIZE;
  const corners: (Seen | null)[] = new Array((W + 1) * (H + 1));
  for (let y = 0; y <= H; y++) for (let x = 0; x <= W; x++) corners[y * (W + 1) + x] = see(x, y);
  const cls = new Uint8Array(W * H); const behind = new Uint8Array(W * H); const part = new Int8Array(W * H).fill(-1);
  const agree = new Uint8Array(W * H); const depth = new Float64Array(W * H).fill(NaN);
  // Samples on a disk about the point in its tangent plane: 16 at 0.25 m and 8 at 0.125 m.
  const ring: [number, number][] = [];
  for (let k = 0; k < 16; k++) ring.push([EDGE_M * Math.cos((2 * Math.PI * k) / 16), EDGE_M * Math.sin((2 * Math.PI * k) / 16)]);
  for (let k = 0; k < 8; k++) ring.push([(EDGE_M / 2) * Math.cos((2 * Math.PI * k) / 8 + 0.2), (EDGE_M / 2) * Math.sin((2 * Math.PI * k) / 8 + 0.2)]);
  /** Whether every disk sample sees the light (`lit`) or every one is occluded (not `lit`). */
  const clear = (h: Hit, part: number, lit: boolean): boolean => {
    const n = h.face;
    if (lit) {
      // No triangle of another part within 0.25 m of the centre's ray: no sample's ray is blocked (each runs within
      // 0.25 m of it), and each leaves the facet's plane forward while n·l stays positive across the disk.
      const { l, dist } = toLight(light, h.p);
      const margin = Number.isFinite(dist) ? EDGE_M / dist : 0;
      if (dot(n, l) >= FACING + margin && !tracer.near(add(h.p, scale(n, LIFT)), l, dist, EDGE_M + 0.01, part)) return true;
    }
    const t1 = unit(cross(n, Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    const t2 = cross(n, t1);
    for (const [a, b] of ring) {
      const s = add(add(h.p, scale(n, LIFT)), add(scale(t1, a), scale(t2, b)));
      const { l, dist } = toLight(light, s);
      const blocked = dot(n, l) <= 0 || tracer.blocked(s, l, dist, part);
      if (blocked === lit) return false;
    }
    return true;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const c = see(x + 0.5, y + 0.5);
    if (!c) continue;
    part[i] = c.part; depth[i] = c.depth;
    const four = [corners[y * (W + 1) + x], corners[y * (W + 1) + x + 1], corners[(y + 1) * (W + 1) + x], corners[(y + 1) * (W + 1) + x + 1]];
    if (!four.every((s) => s !== null && s !== undefined && s.part === c.part)) continue;
    agree[i] = 1;
    const all = [c, ...(four as Seen[])];
    const id = tracer.ids[c.part]!;
    if (id === 'plane' && wallBox && all.every((s) => s.through >= WALL_M)) behind[i] = 1;
    if (id === 'wall') continue;
    if (!all.every((s) => s.facing && s.cone)) continue;
    if (all.every((s) => s.lit)) { if (clear(c.hit, c.part, true)) cls[i] = LIT; }
    else if (all.every((s) => !s.lit)) { if (clear(c.hit, c.part, false)) cls[i] = DARK; }
  }
  return { cls, behind, part, agree, depth, ids: tracer.ids };
}

/** The share of pixels whose centre and corners meet one part where the object-ID target names that part. */
export function coverage(k: Classes, ids: string[]): { matched: number; of: number; firstMiss: string } {
  let matched = 0; let of = 0; let firstMiss = '';
  for (let i = 0; i < k.part.length; i++) {
    if (!k.agree[i]) continue;
    of++;
    const want = k.ids[k.part[i]!]!;
    if (ids[i] === want) matched++;
    else if (!firstMiss) firstMiss = `(${i % SIZE[0]}, ${Math.floor(i / SIZE[0])}) the rays meet ${want}, the target names ${ids[i] || 'nothing'}`;
  }
  return { matched, of, firstMiss };
}
export const at = (i: number): string => `(${i % SIZE[0]}, ${Math.floor(i / SIZE[0])})`;

// ---------------------------------------------------------------------------------------------------
// The sweeps (README: The fixtures)

/** The sun's elevations: 15° to 75° in 10° steps. */
export const ELEVATIONS = [15, 25, 35, 45, 55, 65, 75] as const;
/** The four cascades the subject is placed in, in turn. */
export const CASCADES = [0, 1, 2, 3] as const;
/** Every light comes from this azimuth, degrees from +X toward +Z: the camera looks from +Z, so lit faces turn
 * partly toward it and every shadow falls toward −X, beside the subject in the frame. */
export const AZIMUTH = 20;
export const SUN_LUX = 3;
/** The camera looks down 40° from +Z. */
const PITCH = 40;
const CAM_NEAR = 0.5;

/** The sun fixture: the plane, both spheres, the box and the wall on one plane, the wall upwind of nothing so its
 * shadow falls on open plane. */
export const SUN_PARTS: Part[] = [
  ground(-8, 4.5, -5, 4), wall(-2, 0), sphere(2, 0.8, -1.3), sphere(4, 0.8, 1.3), cube(3, 0),
];
const SUN_BOUNDS = { min: [-8, 0, -5] as V3, max: [4.5, 2.05, 4] as V3 };
const SUN_TARGET: V3 = [-1.75, 0, -0.5];
const HALF_WIDTH = 6.5;

/** The camera and the cascades that put the whole sun fixture inside cascade `i` of 4: the cascades split uniformly
 * (`split: 0`) from the camera's near plane to `shadow_far`, so cascade i spans [n + i w, n + (i + 1) w], w = (far − n)
 * ÷ 4; the camera backs off along its view, its field narrowing to keep the frame 13 m across at the target, until the
 * fixture's view depths fit inside cascade i short of its last tenth (where a fade blends the next cascade in). */
export function sunPlacement(i: number): { cam: Pinhole; shadowFar: number; span: [number, number] } {
  const dir: V3 = [0, Math.sin(rad(PITCH)), Math.cos(rad(PITCH))];
  const corners: V3[] = [];
  for (const x of [SUN_BOUNDS.min[0], SUN_BOUNDS.max[0]]) for (const y of [SUN_BOUNDS.min[1], SUN_BOUNDS.max[1]]) for (const z of [SUN_BOUNDS.min[2], SUN_BOUNDS.max[2]]) corners.push([x, y, z]);
  for (let D = 10; D < 400; D += 0.25) {
    const position = add(SUN_TARGET, scale(dir, D));
    const fwd = scale(dir, -1);
    const depths = corners.map((c) => dot(sub(c, position), fwd));
    const dmin = Math.min(...depths); const dmax = Math.max(...depths);
    if (dmin < CAM_NEAR + 0.3) continue;
    let w: number;
    if (i === 0) w = (dmax - CAM_NEAR) / 0.85;
    else {
      const lo = (dmax - CAM_NEAR) / (i + 0.9); const hi = (dmin - CAM_NEAR) / i;
      if (hi < lo * 1.06) continue;
      w = (lo + hi) / 2;
    }
    const fov = (2 * Math.atan(HALF_WIDTH / D) * 180) / Math.PI;
    return { cam: { position, target: SUN_TARGET, fov, near: CAM_NEAR, far: 400 }, shadowFar: CAM_NEAR + 4 * w, span: [dmin, dmax] };
  }
  throw Error(`no camera puts the fixture inside cascade ${i}`);
}
export function sunLight(elevation: number, shadowFar: number): Light {
  return { kind: 'sun', toward: towardAt(elevation, AZIMUTH), lux: SUN_LUX, cascades: 4, split: 0, shadowFar };
}

/** The local lights' distances from the subject. */
export const DISTANCES = [1, 4, 16] as const;
export const LOCAL_KINDS = ['spot', 'point'] as const;
export type Subject = 'sphere2' | 'sphere4' | 'box' | 'wall';
/** A local fixture: the plane and one subject at the origin, the light 45° above the plane from the subject's centre,
 * `d` m out from where that line leaves the subject (so `d` is its distance from the subject's surface), a spot aimed
 * at the subject's centre (outer 45°, inner 40°), its power such that the subject's centre receives 3 lx. */
export function localFixture(kind: 'spot' | 'point', d: number, subject: Subject): { parts: Part[]; cam: Pinhole; light: Light } {
  const part = subject === 'sphere2' ? sphere(2, 0, 0) : subject === 'sphere4' ? sphere(4, 0, 0) : subject === 'box' ? cube(0, 0) : wall(0, 0);
  const centre: V3 = subject === 'box' ? [0, 0.5, 0] : subject === 'wall' ? [0, 1, 0] : [0, -SPHERE_R * icosphereBottom(subject === 'sphere2' ? 2 : 4), 0];
  const u = towardAt(45, AZIMUTH);
  const exit = part.box
    ? Math.min(...[0, 1, 2].map((k) => (Math.abs(u[k]!) < 1e-12 ? Infinity : ((u[k]! > 0 ? part.box!.max[k]! : part.box!.min[k]!) - centre[k]!) / u[k]!)))
    : SPHERE_R;
  const r = exit + d;
  const pos = add(centre, scale(u, r));
  const light: Light = { kind, pos, axis: scale(u, -1), outer: 45, inner: 40, power: 4 * Math.PI * SUN_LUX * r * r };
  const target: V3 = [-1.5, 0, -0.5];
  const dir: V3 = [0, Math.sin(rad(PITCH)), Math.cos(rad(PITCH))];
  const cam: Pinhole = { position: add(target, scale(dir, 9)), target, fov: (2 * Math.atan(4.5 / 9) * 180) / Math.PI, near: 0.1, far: 200 };
  return { parts: [ground(-7, 4, -6, 4), part], cam, light };
}

// ---------------------------------------------------------------------------------------------------
// Judging a pair of frames

export interface Pair { on: Uint8Array; ref: Uint8Array; diff: Uint8Array; problems: string[] }
/** Reads a casting frame and its reference (`shadow: false`, or the light off), and the checks that make the pair
 * worth comparing: both drawn where the CPU rays put the fixture (99% of the pixels whose centre and corners meet one
 * part name that part in the object-ID target), and the casting frame's shadow maps drawn (the sun: `scene3d.shadow`
 * among the passes and four cascades reported; a local light: its map reported). */
export function readPair(out: string, replies: [JsonObject, JsonObject], k: Classes, light: Light, what: string, refName: string): Pair & { on0: ViewFrame } {
  const problems: string[] = [];
  const fOn = frame0(replies[0], `${what}, casting`);
  const fRef = frame0(replies[1], `${what}, ${refName}`);
  if (light.kind === 'sun') {
    const passes = passNames(replies[0], `${what}, casting`);
    if (!passes.includes('scene3d.shadow')) problems.push(`${what}: the casting frame's passes (${passes.join(', ')}) hold no scene3d.shadow, so the sun drew no shadow map`);
    if ((fOn.cascades?.length ?? 0) !== light.cascades) problems.push(`${what}: the casting frame reports ${fOn.cascades?.length ?? 'no'} cascade maps, not ${light.cascades}`);
  } else {
    const maps = fOn.locals ?? [];
    if (!maps.some((m) => m.light === 'key' && m.kind === light.kind)) problems.push(`${what}: the casting frame reports no ${light.kind} shadow map for the light (${JSON.stringify(fOn.locals)})`);
  }
  const on = readFinal(out, fOn, `${what}, casting: final`);
  const ref = readFinal(out, fRef, `${what}, ${refName}: final`);
  for (const [f, label] of [[fOn, 'casting'], [fRef, refName]] as const) {
    const c = coverage(k, readIds(out, f, `${what}, ${label}: ids`));
    if (c.matched < 0.99 * c.of) problems.push(`${what}, ${label}: the object-ID target names the part the CPU rays meet at ${c.matched} of ${c.of} px, under 99% (first: ${c.firstMiss})`);
  }
  return { on, ref, diff: codes(on, ref), problems, on0: fOn };
}
/** The cascade each view depth falls in, by the frame's reported splits; −1 past them. */
export function cascadeOf(splits: number[], depth: number): number {
  for (let c = 0; c + 1 < splits.length; c++) if (depth >= splits[c]! && depth <= splits[c + 1]!) return c;
  return -1;
}
/** The worst reading among pixels `px` of the difference `diff`: its count over 4 codes, its maximum and where. */
export function worst(px: number[], diff: Uint8Array): { over: number; max: number; at: string } {
  let over = 0; let max = 0; let where = -1;
  for (const i of px) { const d = diff[i]!; if (d > 4) over++; if (d > max) { max = d; where = i; } }
  return { over, max, at: where >= 0 ? at(where) : '-' };
}
/** The pixels of class `c` in `cls`. */
export const pixelsOf = (cls: Uint8Array, c: number): number[] => { const out: number[] = []; for (let i = 0; i < cls.length; i++) if (cls[i] === c) out.push(i); return out; };
