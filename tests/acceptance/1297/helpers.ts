// Test-side tools for #1297's AC1: the base's `deep-gpu` binary (#377's GPU layer with #378's `view3d`), built once per
// file and driven by one JSON line; the issue's repro (an icosphere as a positions-only JSON glTF, its material, camera,
// key sun and filmic look); and the reviewed CPU references the guard is held to: #378's pinhole, a ray cast against
// the icosphere's triangles, and a shadow ray toward the sun against the guard's box. Written for this suite alone
// (nothing imported from other suites). Nothing here stands in for the renderer or its shadow pass.

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
/** The checkout root (tests/acceptance/1297 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** AC1's ID: the first 8 hex digits of SHA-256 of its trimmed, whitespace-collapsed text. */
export const AC1 = 'AC1 #1297.d09869dd';

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
// The machine

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** The GPU layer draws these pixels on macOS's Metal device, the reference platform. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these pixels on macOS's Metal device; this is ${process.platform}`);
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
/** Builds deep-gpu before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useGpu(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1297-bin-'));
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
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1297-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run`: one JSON line `{out, calls}` in, one JSON line out (#377).

/** One process: the calls in order, a reply per call. */
export function runGpu(bin: string, out: string, calls: JsonObject[]): JsonObject[] {
  const name = 'deep-gpu run';
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
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
/** A reply that holds no refusal `code`; INCONCLUSIVE when the platform can't draw it. */
export function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
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
export const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
const rad = (d: number): number => (d * Math.PI) / 180;
/** R = Rz·Ry·Rx (degrees) applied to `v` (Units and axes). */
export function rotate(rot: V3, v: V3): V3 {
  const [cx, sx] = [Math.cos(rad(rot[0])), Math.sin(rad(rot[0]))];
  const [cy, sy] = [Math.cos(rad(rot[1])), Math.sin(rad(rot[1]))];
  const [cz, sz] = [Math.cos(rad(rot[2])), Math.sin(rad(rot[2]))];
  const x1: V3 = [v[0], cx * v[1] - sx * v[2], sx * v[1] + cx * v[2]];
  const y1: V3 = [cy * x1[0] + sy * x1[2], x1[1], -sy * x1[0] + cy * x1[2]];
  return [cz * y1[0] - sz * y1[1], sz * y1[0] + cz * y1[1], y1[2]];
}

// ---------------------------------------------------------------------------------------------------
// The icosphere: radius 1, subdivided `depth` times by midpoint subdivision, each new point renormalized to the unit
// sphere, every vertex shared by the triangles that meet at it (so the reader's smooth normals average across them),
// counter-clockwise seen from outside.

export interface Mesh { positions: V3[]; triangles: [number, number, number][] }
export function icosphere(depth: number): Mesh {
  const t = (1 + Math.sqrt(5)) / 2;
  const positions: V3[] = ([
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
      if (i === undefined) { i = positions.length; positions.push(unit(scale(add(positions[a]!, positions[b]!), 0.5))); mids.set(key, i); }
      return i;
    };
    const next: [number, number, number][] = [];
    for (const [a, b, c] of triangles) {
      const ab = mid(a, b); const bc = mid(b, c); const ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    triangles = next;
  }
  // Every face counter-clockwise from outside: its normal points away from the centre.
  triangles = triangles.map(([a, b, c]) => {
    const n = cross(sub(positions[b]!, positions[a]!), sub(positions[c]!, positions[a]!));
    return dot(n, positions[a]!) > 0 ? [a, b, c] : [a, c, b];
  });
  return { positions, triangles };
}
/** A JSON glTF of `m` (POSITION and u32 indices only, one node, no material, no normals), its buffer inline as a data
 * URI (#420's `mesh.asset@1` reads it); its bytes and their SHA-256. */
export function gltf(m: Mesh): { bytes: Buffer; sha: string } {
  const pos = Buffer.alloc(m.positions.length * 12); const idx = Buffer.alloc(m.triangles.length * 12);
  m.positions.forEach((p, i) => p.forEach((v, k) => pos.writeFloatLE(v, i * 12 + k * 4)));
  m.triangles.forEach((t, i) => t.forEach((v, k) => idx.writeUInt32LE(v, i * 12 + k * 4)));
  const lo = [0, 1, 2].map((k) => Math.min(...m.positions.map((p) => Math.fround(p[k]!))));
  const hi = [0, 1, 2].map((k) => Math.max(...m.positions.map((p) => Math.fround(p[k]!))));
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

// ---------------------------------------------------------------------------------------------------
// The repro (issue #1297, Repro on main): the material, the camera, the key sun and the look.

export const SIZE: [number, number] = [640, 480];
export interface Pinhole { position: V3; target: V3; fov: number; size: [number, number] }
export const CAM: Pinhole = { position: [0, 0, 2.04], target: [0, 0, 0], fov: 40, size: SIZE };
export const LUX = 3;
/** The sun's `at.rot`; it shines along its own −Z. */
export const SUN_ROT: V3 = [-60, 25, 0];
/** The unit direction toward the sun: about (0.211, 0.866, 0.453). */
export const TOWARD_SUN: V3 = scale(rotate(SUN_ROT, [0, 0, -1]), -1);
/** The two subdivision depths the criterion names. */
export const DEPTHS = [2, 4] as const;

const STATUS: JsonObject = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
/** "The look is filmic at exposure 0": a physical-basis `look@1` (#421's shape), filmic, exposure 0, no bloom, no
 * deband, no finish, no 3D ground. */
export const FILMIC_LOOK: JsonObject = {
  id: 'look-1297-filmic', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'A #1297 acceptance look.',
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
export function sessionDoc(id: string, items: Record<string, JsonObject>): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #1297 acceptance fixture.`, size: SIZE, camera: 'cam', transport: { span: '10s' },
    requires: { modules: { scene3d: '^1' } }, layers: { main: { writer: AGENT, title: 'main', order: 'a0' } }, items: withIds,
  };
}

/** The guard's caster: a box between the sun and the sphere's sunlit, visible face, out of the camera's view. Its
 * centre sits 1 m toward the sun from the sphere point P = unit(0.15, 0.25, 1). */
export const GUARD_P: V3 = unit([0.15, 0.25, 1]);
export const GUARD_BOX = { center: add(GUARD_P, TOWARD_SUN), size: 0.15 };

/** The repro's document: the icosphere as `mesh.asset@1` (its glTF written under `dir`), the material, the camera
 * and the key sun casting or not; with `box`, the guard's box too. Returns the document's path and the assets. */
export function reproDoc(dir: string, depth: number, shadow: boolean, box = false): { doc: string; assets: Record<string, string> } {
  const g = gltf(icosphere(depth));
  const path = join(dir, `${g.sha}.gltf`); writeFileSync(path, g.bytes);
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: CAM.position, target: CAM.target, fov: CAM.fov } },
    clay: { kind: 'material@1', params: { base_color: [0.7, 0.5, 0.35, 1], roughness: 0.6 } },
    sun: { kind: 'light.sun@1', params: { illuminance: LUX, shadow }, at: { rot: SUN_ROT } },
    sphere: { kind: 'mesh.asset@1', params: { sha256: g.sha, node: 0 }, at: { pos: [0, 0, 0] }, material: 'clay' },
  };
  if (box) {
    const s = GUARD_BOX.size;
    items['blocker'] = { kind: 'mark.box@1', params: { size: [s, s, s] }, at: { pos: GUARD_BOX.center }, material: 'clay' };
  }
  const name = `sphere-d${depth}-${shadow ? 'shadow' : 'noshadow'}${box ? '-box' : ''}`;
  return { doc: writeJson(dir, name, sessionDoc(name, items)), assets: { [g.sha]: path } };
}
/** One `view3d` call of a one-frame document: the final and object-ID targets, the cascades reported. */
export const view3dCall = (doc: string, assets: Record<string, string>): JsonObject =>
  ({ call: 'view3d', doc, look: FILMIC_LOOK, size: SIZE, frames: 1, capture: [0], targets: ['final', 'ids'], cascades: true, assets });

// ---------------------------------------------------------------------------------------------------
// The reply: frame 0's targets, its shadow maps and the passes

export interface ViewFrame { final: string | null; ids: string | null; picks: Map<number, string> | null; maps: number | null }
const optStr = (v: JsonValue | undefined, what: string): string | null => (v === undefined || v === null ? null : str(v, what));
export function frame0(reply: JsonObject, what: string): ViewFrame {
  answered(reply, what);
  const frames = arr(reply['frames'], `${what}: frames`).map((v, i) => obj(v, `${what}: frames[${i}]`));
  const f = frames.find((x) => x['frame'] === 0);
  expect(f, `${what}: frame 0 is in the reply`).toBeDefined();
  const at = `${what}: frame 0`;
  const pk = f!['picks'];
  const picks = isObject(pk) ? new Map(Object.entries(pk).map(([k, id]) => [Number(k), str(id, `${at}.picks[${k}]`)])) : null;
  const c = f!['cascades'];
  const maps = isObject(c) && Array.isArray(c['maps']) ? c['maps'].length : null;
  return { final: optStr(f!['final'], `${at}.final`), ids: optStr(f!['ids'], `${at}.ids`), picks, maps };
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
    const len = file.readUInt32BE(at); const type = file.toString('latin1', at + 4, at + 8); const body = file.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  expect([depth, color, interlace], `${what} is an 8-bit RGBA PNG with no interlace`).toEqual([8, 6, 0]);
  const stride = width * 4;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? line[i - 4]! : 0; const b = previous[i]!; const c = i >= 4 ? previous[i - 4]! : 0; const x = line[i]!;
      const v = filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + b : filter === 3 ? x + ((a + b) >> 1) : filter === 4 ? x + paeth(a, b, c) : NaN;
      expect(Number.isNaN(v), `${what}: PNG filter ${filter} is one of 0–4`).toBe(false);
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
/** The object-ID target (#378): pick ID r + 2^8 g + 2^16 b + 2^24 a, 0 where nothing draws, named through `picks`. */
export function readIds(out: string, f: ViewFrame, what: string): (x: number, y: number) => string | null {
  const png = decodeRgbaPng(readNamed(out, f.ids, 'png', what), what);
  expect([png.width, png.height], `${what} is ${SIZE[0]} × ${SIZE[1]}`).toEqual(SIZE);
  expect(f.picks, `${what}: the frame names the item each pick ID stands for`).not.toBeNull();
  return (x, y) => {
    const o = (y * png.width + x) * 4;
    const pick = (png.rgba[o]! + png.rgba[o + 1]! * 256 + png.rgba[o + 2]! * 65_536 + png.rgba[o + 3]! * 16_777_216) >>> 0;
    return pick === 0 ? null : f.picks!.get(pick) ?? `unknown:${pick}`;
  };
}

/** How two final frames differ: per pixel, the largest of its R, G and B code differences. */
export interface Diff { over: number; max: number; at: [number, number] | null; codes: Uint8Array }
export function diff(a: Uint8Array, b: Uint8Array, limit: number): Diff {
  const codes = new Uint8Array(SIZE[0] * SIZE[1]);
  let over = 0; let max = 0; let at: [number, number] | null = null;
  for (let i = 0; i < codes.length; i++) {
    const d = Math.max(Math.abs(a[i * 4]! - b[i * 4]!), Math.abs(a[i * 4 + 1]! - b[i * 4 + 1]!), Math.abs(a[i * 4 + 2]! - b[i * 4 + 2]!));
    codes[i] = d;
    if (d > limit) over++;
    if (d > max) { max = d; at = [i % SIZE[0], Math.floor(i / SIZE[0])]; }
  }
  return { over, max, at, codes };
}

// ---------------------------------------------------------------------------------------------------
// The CPU reference for the guard: #378's pinhole (position, target, +Y up, fov across the wider side), the pixel's ray
// against the icosphere's triangles, and a shadow ray from the hit toward the sun against the guard's box.

export function pixelRay(cam: Pinhole, px: number, py: number): V3 {
  const f = unit(sub(cam.target, cam.position));
  const r = unit(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const focal = Math.max(...cam.size) / 2 / Math.tan(rad(cam.fov) / 2);
  return unit(add(add(f, scale(r, (px + 0.5 - cam.size[0] / 2) / focal)), scale(u, -(py + 0.5 - cam.size[1] / 2) / focal)));
}
function rayTriangle(o: V3, d: V3, a: V3, b: V3, c: V3): number | null {
  const e1 = sub(b, a); const e2 = sub(c, a); const q = cross(d, e2); const det = dot(e1, q);
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det; const s = sub(o, a); const u = dot(s, q) * inv;
  if (u < 0 || u > 1) return null;
  const r = cross(s, e1); const v = dot(d, r) * inv;
  if (v < 0 || u + v > 1) return null;
  const t = dot(e2, r) * inv;
  return t > 1e-9 ? t : null;
}
function rayBox(o: V3, d: V3, min: V3, max: V3): boolean {
  let t0 = 1e-6; let t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]!) < 1e-12) { if (o[k]! < min[k]! || o[k]! > max[k]!) return false; continue; }
    const a = (min[k]! - o[k]!) / d[k]!; const b = (max[k]! - o[k]!) / d[k]!;
    t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b));
  }
  return t0 <= t1;
}
/** Per pixel of the guard's frame: 1 where the sphere's sunlit face (smooth n·l over 0.3 at the hit) lies in the box's
 * shadow, 2 where it is lit by the sun, 0 elsewhere (missed, or turned from the sun). */
export function guardShadow(depth: number): Uint8Array {
  const m = icosphere(depth);
  const tris = m.triangles.map(([a, b, c]) => [m.positions[a]!, m.positions[b]!, m.positions[c]!] as [V3, V3, V3]);
  const h = GUARD_BOX.size / 2;
  const min = sub(GUARD_BOX.center, [h, h, h]); const max = add(GUARD_BOX.center, [h, h, h]);
  const out = new Uint8Array(SIZE[0] * SIZE[1]);
  for (let y = 0; y < SIZE[1]; y++) for (let x = 0; x < SIZE[0]; x++) {
    const d = pixelRay(CAM, x, y);
    let best = Infinity;
    for (const [a, b, c] of tris) {
      // Only faces toward the camera can be its first hit on a convex mesh.
      if (dot(cross(sub(b, a), sub(c, a)), d) >= 0) continue;
      const t = rayTriangle(CAM.position, d, a, b, c);
      if (t !== null && t < best) best = t;
    }
    if (best === Infinity) continue;
    const p = add(CAM.position, scale(d, best));
    // The smooth normal of a sphere's mesh is near the point's direction from the centre.
    if (dot(unit(p), TOWARD_SUN) < 0.3) continue;
    out[y * SIZE[0] + x] = rayBox(p, TOWARD_SUN, min, max) ? 1 : 2;
  }
  return out;
}
/** The pixels marked `mark` whose whole (2r + 1)² neighbourhood holds the same mark: clear of the shadow's edge. */
export function interior(marks: Uint8Array, mark: number, r: number): number[] {
  const out: number[] = [];
  for (let y = r; y < SIZE[1] - r; y++) for (let x = r; x < SIZE[0] - r; x++) {
    let ok = true;
    for (let dy = -r; dy <= r && ok; dy++) for (let dx = -r; dx <= r; dx++) if (marks[(y + dy) * SIZE[0] + x + dx] !== mark) { ok = false; break; }
    if (ok) out.push(y * SIZE[0] + x);
  }
  return out;
}
