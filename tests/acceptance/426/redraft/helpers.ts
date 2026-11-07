// Test-side tools for the blind redraft of #426's AC2: the base's `deep-gpu` binary (#377's GPU layer with #378's
// `view3d`), built once per file and driven by one JSON line; the suite's assumed surfaces (README); the test HDR, the
// documents and their cameras; and the reviewed CPU references the criterion is held to: #378's pinhole, the dome a
// view ray meets (Sky `sky@1`: environment, `background_ground`), the cell a direction lies in, a sun's shadow of a box
// on y = 0, and the pixel judges. Copied from #424's redraft and #424's helpers where they agree, since suites don't
// import each other. Nothing here stands in for the renderer, the backdrop or the shadow catcher; the CPU images exist
// only to show that the judges fail the planted wrong programs this criterion names (README: Planted programs).

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
/** The checkout root (tests/acceptance/426/redraft is four levels down). */
export const REPO = join(HERE, '..', '..', '..', '..');

/** AC2's ID: the first 8 hex digits of SHA-256 of its trimmed, whitespace-collapsed text. */
export const AC2 = 'AC2 #426.f893b6e0';

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
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)?.slice(0, 200)}`).toBe(true);
  return value as number;
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
/** At least one failure, and one that names each of `names`: what a planted program must give. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  for (const name of names) {
    expect(failures.some((f) => f.includes(name)), `${what}: a failure names ${name}; the failures were:\n  ${failures.join('\n  ')}`).toBe(true);
  }
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
    dir = mkdtempSync(join(tmpdir(), 'deep-426r-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(targetDir(), 'debug', exe('deep-gpu')), join(dir, exe('deep-gpu')));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo ${CARGO_ARGS.join(' ')}`).toBe('');
    return join(dir, exe('deep-gpu'));
  };
}
/** A fresh temporary folder per test (documents, the HDR, outputs), deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-426r-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run`: one JSON line `{out, calls}` in, one JSON line out (#377). The base has no planted switch for this
// criterion, so none is passed (README: Planted programs).

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
// Vectors, sRGB codes

export type V3 = [number, number, number];
export type Rgb = [number, number, number];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
const rad = (d: number): number => (d * Math.PI) / 180;
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
/** sRGB coding: with tone map none at exposure scale 1 the final target is the sRGB encoding of linear light. */
export const encode = (v: number): number => { const c = Math.min(Math.max(v, 0), 1); return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; };
export const code8 = (v: number): number => Math.round(255 * encode(v));
export const decode8 = (c: number): number => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
export const codes = (c: Rgb): Rgb => c.map(code8) as Rgb;
/** The largest per-channel difference between two codes. */
export const codeOff = (a: Rgb, b: Rgb): number => Math.max(...[0, 1, 2].map((k) => Math.abs(a[k]! - b[k]!)));
export const fx = (v: number, d = 3): string => v.toFixed(d);
export const v3s = (v: V3): string => `(${v.map((c) => fx(c, 2)).join(', ')})`;

// ---------------------------------------------------------------------------------------------------
// The test HDR: an equirectangular Radiance file (RGBE, flat scanlines, `-Y h +X w`). Columns run in u from −Z turning
// toward +X, rows down from the zenith (the base's equirectangular convention, the only orientation surface it names).
// The upper half is one flat grey; the lower half is a grid of 36 × 9 flat cells, 10° of azimuth by 10° of polar angle
// each, column c covering u·360° ∈ [10c, 10c + 10), row r covering θ ∈ [90 + 10r, 100 + 10r). Every texel holds RGBE
// mantissas m with exponent 128, so its radiance is exactly m ÷ 256 and nothing is lost to the file's quantization.

export const HDR_W = 720; export const HDR_H = 360;
export const COLS = 36; export const ROWS = 9;
/** sRGB code levels; each cell takes one per channel, so any two cells differ by about 24 codes or more. */
const LEVELS = [40, 64, 88, 112, 136, 160, 184];
const UPPER_CODE = 150;
const mantissa = (code: number): number => Math.max(1, Math.min(255, Math.round(decode8(code) * 256)));

export interface Cell { col: number; row: number }
/** The RGBE mantissas of cell (col, row): the 343 level triples, cells spread over them by a stride coprime with 343. */
export function cellMantissas(c: Cell): Rgb {
  const k = ((c.row * COLS + c.col) * 97) % 343;
  return [mantissa(LEVELS[k % 7]!), mantissa(LEVELS[Math.floor(k / 7) % 7]!), mantissa(LEVELS[Math.floor(k / 49)]!)];
}
const UPPER: Rgb = [mantissa(UPPER_CODE), mantissa(UPPER_CODE), mantissa(UPPER_CODE)];
/** A cell's flat radiance, linear. */
export const cellLinear = (c: Cell): Rgb => cellMantissas(c).map((m) => m / 256) as Rgb;
/** A cell's flat color as the final target shows it (tone map none, exposure scale 1): 8-bit sRGB codes. */
export const cellCode = (c: Cell): Rgb => codes(cellLinear(c));
const UPPER_LINEAR: Rgb = UPPER.map((m) => m / 256) as Rgb;

/** The test HDR's bytes. */
export function testHdr(): Buffer {
  const head = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${HDR_H} +X ${HDR_W}\n`, 'latin1');
  const body = Buffer.alloc(HDR_W * HDR_H * 4);
  for (let y = 0; y < HDR_H; y++) for (let x = 0; x < HDR_W; x++) {
    const m = y < HDR_H / 2 ? UPPER : cellMantissas({ col: Math.floor((x * COLS) / HDR_W), row: Math.floor(((y - HDR_H / 2) * ROWS * 2) / HDR_H) });
    const o = (y * HDR_W + x) * 4;
    body[o] = m[0]; body[o + 1] = m[1]; body[o + 2] = m[2]; body[o + 3] = 128;
  }
  return Buffer.concat([head, body]);
}
/** The fixture's own claim (criterion: "each a color at least 4 code values from every other cell's"): the smallest
 * per-channel code distance between any two cells as the final target shows them. */
export function smallestCellDistance(): number {
  const all: Rgb[] = [];
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) all.push(cellCode({ col, row }));
  let least = Infinity;
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) least = Math.min(least, codeOff(all[i]!, all[j]!));
  return least;
}

/** Where direction `d` falls in the HDR: its cell (null in the upper half) and its angular distance, in degrees, to
 * the nearest cell edge (the arc across a column edge is the azimuth gap × sin θ). */
export interface Where { cell: Cell | null; margin: number; theta: number; azimuth: number }
export function whereIs(dir: V3): Where {
  const d = unit(dir);
  const theta = deg(Math.acos(Math.max(-1, Math.min(1, d[1]))));
  const phi = deg(Math.atan2(d[0], -d[2]));
  const azimuth = ((phi + 180) % 360 + 360) % 360;
  if (theta < 90) return { cell: null, margin: 90 - theta, theta, azimuth };
  const col = Math.min(COLS - 1, Math.floor(azimuth / 10));
  const row = Math.min(ROWS - 1, Math.floor((theta - 90) / 10));
  const dTheta = Math.min(theta - (90 + 10 * row), 90 + 10 * (row + 1) - theta);
  const dPhi = Math.min(azimuth - 10 * col, 10 * (col + 1) - azimuth);
  return { cell: { col, row }, margin: Math.min(dTheta, dPhi * Math.sin(rad(theta))), theta, azimuth };
}
export const cellName = (c: Cell | null): string => (c ? `cell (column ${c.col}, row ${c.row})` : 'the upper half');
const sameCell = (a: Cell | null, b: Cell | null): boolean => (a === null ? b === null : b !== null && a.col === b.col && a.row === b.row);
/** The HDR's radiance along `dir` (the flat color of the cell or the upper half it falls in). */
export const radiance = (dir: V3): Rgb => { const w = whereIs(dir); return w.cell ? cellLinear(w.cell) : UPPER_LINEAR; };

// ---------------------------------------------------------------------------------------------------
// The backdrop on its ground (Sky `sky@1`: environment, `background_ground`): each view ray meets a dome of `radius`
// around (0, `height`, 0) whose floor is cut flat at y = 0, and the background shows the environment in the direction
// from (0, `height`, 0) to that point. The planted backdrop centres the same dome above the camera, at (eye x, height,
// eye z).

export const GROUND = { height: 1.7, radius: 20 } as const;
export type Dome = 'origin' | 'above_camera';
export function domeCentre(eye: V3, dome: Dome): V3 {
  return dome === 'origin' ? [0, GROUND.height, 0] : [eye[0], GROUND.height, eye[2]];
}
/** The direction the backdrop shows along the ray `d` from `eye`. */
export function groundDirection(eye: V3, d: V3, dome: Dome = 'origin'): V3 {
  const c = domeCentre(eye, dome);
  const o = sub(eye, c);
  const b = dot(o, d);
  const t = -b + Math.sqrt(Math.max(b * b - (dot(o, o) - GROUND.radius * GROUND.radius), 0));
  let p = add(eye, scale(d, t));
  if (p[1] < 0 && d[1] < 0) p = add(eye, scale(d, -eye[1] / d[1]));
  return unit(sub(p, c));
}

// ---------------------------------------------------------------------------------------------------
// #378's pinhole (position, target, +Y up, fov across the wider side).

export interface Pinhole { position: V3; target: V3; fov: number; size: [number, number] }
function basis(cam: Pinhole): { f: V3; r: V3; u: V3; focal: number } {
  const f = unit(sub(cam.target, cam.position));
  const r = unit(cross(f, [0, 1, 0]));
  return { f, r, u: cross(r, f), focal: Math.max(...cam.size) / 2 / Math.tan(rad(cam.fov) / 2) };
}
/** The unit ray through view point (sx, sy) in px (a pixel's centre is (x + 0.5, y + 0.5)). */
export function rayAt(cam: Pinhole, sx: number, sy: number): V3 {
  const { f, r, u, focal } = basis(cam);
  return unit(add(add(f, scale(r, (sx - cam.size[0] / 2) / focal)), scale(u, -(sy - cam.size[1] / 2) / focal)));
}
/** Where world point `p` lands, in view px. */
export function project(cam: Pinhole, p: V3): [number, number] {
  const { f, r, u, focal } = basis(cam);
  const w = sub(p, cam.position);
  const z = dot(w, f);
  return [cam.size[0] / 2 + (dot(w, r) / z) * focal, cam.size[1] / 2 - (dot(w, u) / z) * focal];
}
/** The pixel holding world point `p`. */
export function pixelOf(cam: Pinhole, p: V3): [number, number] {
  const [sx, sy] = project(cam, p);
  return [Math.floor(sx), Math.floor(sy)];
}

// ---------------------------------------------------------------------------------------------------
// The look and documents

const STATUS: JsonObject = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
/** A physical-basis `look@1` with tone map none at the exposure whose scale 1 ÷ (1.2 × 2^EV100) is 1, no bloom, no
 * deband, no finish: the final target is the sRGB encoding of the linear light (#378's and #421's acceptance look). */
export const PLAIN_LOOK: JsonObject = {
  id: 'look-426-redraft', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'A #426 acceptance look.',
  palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97' },
  roles: { ground: 'night', ink: 'graphite', muted: 'slate' },
  themes: { light: {}, dark: {} },
  fonts: {
    body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
    mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  },
  tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ground_3d: { kind: 'none' },
  status: { ...STATUS }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: 0.1,
  attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
};

export const AGENT = 'agent:sess-alpha';
/** A scene document as a session holds it (#378): every item in one writer layer. */
export function sessionDoc(id: string, size: [number, number], items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #426 acceptance fixture.`, size, camera: 'cam', transport: { span: '10s' },
    requires: { modules: { scene3d: '^1' } }, layers: { main: { writer: AGENT, title: 'main', order: 'a0' } }, ...extra, items: withIds,
  };
}
const camera = (position: V3, target: V3, fov: number): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov, near: 0.05, far: 200 } });
/** The sky: the test HDR as the environment at intensity 1 (an HDR asset draws behind the scene by default), laid on
 * its ground, with no ambient gradient. */
const groundSky = (hdrSha: string): JsonObject => ({
  kind: 'sky@1',
  params: { ambient_top: [0, 0, 0], ambient_low: [0, 0, 0], environment: { from: hdrSha, intensity: 1 }, background_ground: { height: GROUND.height, radius: GROUND.radius } },
});

/** The HDR written into `dir`, and the `assets` entry a `view3d` call names it by. */
export function writeHdr(dir: string): { sha: string; assets: Record<string, string> } {
  const bytes = testHdr();
  const sha = sha256(bytes);
  const path = join(dir, `${sha}.hdr`);
  writeFileSync(path, bytes);
  return { sha, assets: { [sha]: path } };
}

// The moving camera: from (0, 1.5, 5) to (3, 1, 4), aimed at the origin, linear over 0.5 s; at 60 fps frame 0 is the
// first pose, frame 15 is halfway, and from frame 30 on the camera holds the second pose. Frame 40 is judged there.
export const MOVE_SIZE: [number, number] = [480, 360];
export const MOVE_FOV = 60;
export const FROM: V3 = [0, 1.5, 5];
export const TO: V3 = [3, 1, 4];
export const FPS = 60;
export const MOVE_SPAN = 0.5;
export const FIRST_FRAME = 0; export const MID_FRAME = 15; export const LAST_FRAME = 40;
export const poseAt = (frame: number): Pinhole => {
  const k = Math.min(1, frame / FPS / MOVE_SPAN);
  return { position: add(FROM, scale(sub(TO, FROM), k)), target: [0, 0, 0], fov: MOVE_FOV, size: MOVE_SIZE };
};
/** The world point and the direction the criterion names. */
export const POINT: V3 = [2, 0, 1];
export const DIRECTION: V3 = [2, -1.7, 1];

/** The backdrop alone (no item but the camera and the sky) under the moving camera: three f32 channels on the
 * camera's position components, as the base's channels address an array's element. */
export function movingDoc(hdrSha: string): JsonObject {
  const channels: JsonObject = {};
  for (const k of [0, 1, 2]) {
    channels[`move${k}`] = { target: `items/cam/params/position/${k}`, type: 'f32', keys: { k0: { t: '0s', value: FROM[k]!, interp: 'linear' }, k1: { t: `${MOVE_SPAN}s`, value: TO[k]!, interp: 'linear' } } };
  }
  return sessionDoc('backdrop-ground-move', MOVE_SIZE, { cam: camera(FROM, [0, 0, 0], MOVE_FOV), sky: groundSky(hdrSha) }, { channels });
}

// The shadow scene: a 0.5 m white box standing at the origin (0 ≤ y ≤ 0.5), a 2 × 2 m shadow catcher whose top is
// y = 0, a key sun at 45° elevation shining along (0.5, −0.7071, 0.5) that casts, and a fill sun straight down that
// doesn't. On the floor the key gives 10,000 lx and the fill 10,000 lx, so in the box's shadow the catcher's alpha,
// the share of the light its shadow removes, is 0.5; the environment's own light on the floor (under 2 lx: radiance
// under 1 over the hemisphere) moves that share by under 0.01%, a hundredth of a code (README: Readings).
export const SHADOW_SIZE: [number, number] = [640, 480];
export const SHADOW_CAM: Pinhole = { position: [1.4, 1.5, 2.0], target: [0.35, 0, 0.35], fov: 50, size: SHADOW_SIZE };
export const BOX = { min: [-0.25, 0, -0.25] as V3, max: [0.25, 0.5, 0.25] as V3 };
export const CATCHER_HALF = 1;
export const KEY_ROT: V3 = [-45, -135, 0];
/** The unit direction toward the key sun (it shines along its own −Z). */
export const TOWARD_KEY: V3 = scale(rotate(KEY_ROT, [0, 0, -1]), -1);
export const KEY_ON_FLOOR = 10_000;
export const FILL_ON_FLOOR = 10_000;
export const KEY_LUX = KEY_ON_FLOOR / TOWARD_KEY[1];
/** The catcher's alpha in the box's shadow: the share of the floor's light the key's shadow removes. */
export const CATCH_ALPHA = KEY_ON_FLOOR / (KEY_ON_FLOOR + FILL_ON_FLOOR);
/** A projected-floor point outside the catcher, away from every item, for the click. */
export const CLICK_FLOOR: V3 = [1.25, 0, 0.3];
/** The box's top centre, the click that shows clicks answer at all. */
export const CLICK_BOX: V3 = [0, 0.5, 0];

export function shadowDoc(hdrSha: string): JsonObject {
  const c = SHADOW_CAM;
  return sessionDoc('backdrop-ground-shadow', SHADOW_SIZE, {
    cam: camera(c.position, c.target, c.fov),
    sky: groundSky(hdrSha),
    white: { kind: 'material@1', params: { base_color: [1, 1, 1, 1], metallic: 0, roughness: 1, specular_level: 0 } },
    catcher_mat: { kind: 'material@1', params: { base_color: [0.8, 0.8, 0.8, 1], roughness: 1, catch: 'shadow' } },
    catcher: { kind: 'mark.box@1', params: { size: [2 * CATCHER_HALF, 0.02, 2 * CATCHER_HALF] }, at: { pos: [0, -0.01, 0] }, material: 'catcher_mat' },
    box: { kind: 'mark.box@1', params: { size: sub(BOX.max, BOX.min) }, at: { pos: scale(add(BOX.min, BOX.max), 0.5) }, material: 'white' },
    key: { kind: 'light.sun@1', params: { illuminance: KEY_LUX, color: [1, 1, 1], shadow: true }, at: { rot: KEY_ROT } },
    fill: { kind: 'light.sun@1', params: { illuminance: FILL_ON_FLOOR, color: [1, 1, 1], shadow: false }, at: { rot: [-90, 0, 0] } },
  });
}

export interface View3d {
  doc: string; size: [number, number]; frames?: number; fps?: number; from?: number; capture?: number[];
  targets: ('final' | 'linear' | 'ids')[]; assets: Record<string, string>; clicks?: { frame: number; at: [number, number] }[];
}
export const view3dCall = (v: View3d): JsonObject => ({ call: 'view3d', look: PLAIN_LOOK, frames: 1, capture: [0], ...(v as unknown as JsonObject) });

// ---------------------------------------------------------------------------------------------------
// The reply

export interface Click { at: [number, number]; pick: string | null }
export interface ViewFrame { frame: number; final: string | null; clicks: Click[] }
const optStr = (v: JsonValue | undefined, what: string): string | null => (v === undefined || v === null ? null : str(v, what));
export function framesOf(reply: JsonObject, what: string): ViewFrame[] {
  answered(reply, what);
  return arr(reply['frames'], `${what}: frames`).map((v, i): ViewFrame => {
    const f = obj(v, `${what}: frames[${i}]`); const at = `${what}: frames[${i}]`;
    const clicks = arr(f['clicks'] ?? [], `${at}.clicks`).map((c, j): Click => {
      const o = obj(c, `${at}.clicks[${j}]`);
      const p = arr(o['at'], `${at}.clicks[${j}].at`).map((x) => num(x, 'a click coordinate')) as [number, number];
      return { at: p, pick: o['pick'] === null || o['pick'] === undefined ? null : str(o['pick'], `${at}.clicks[${j}].pick`) };
    });
    return { frame: num(f['frame'], `${at}.frame`), final: optStr(f['final'], `${at}.final`), clicks };
  });
}
export function frameAt(frames: ViewFrame[], n: number, what: string): ViewFrame {
  const f = frames.find((x) => x.frame === n);
  expect(f, `${what}: frame ${n} is in the reply`).toBeDefined();
  return f!;
}

function readNamed(out: string, hash: string | null, ext: string, what: string): Buffer {
  expect(hash, `${what} is written, named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${hash}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}
export interface Image { width: number; height: number; rgba: Uint8Array }
export const px = (im: Image, x: number, y: number): Rgb => { const o = (y * im.width + x) * 4; return [im.rgba[o]!, im.rgba[o + 1]!, im.rgba[o + 2]!]; };
/** The hash of an image's pixels (its RGBA bytes, rows top-down), whatever file carried them. */
export const pixelHash = (im: Image): string => sha256(im.rgba);
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** Reads an 8-bit RGB or RGBA PNG with no interlace. */
export function decodePng(file: Buffer, what: string): Image {
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
  expect(depth === 8 && (color === 2 || color === 6) && interlace === 0, `${what} is an 8-bit RGB or RGBA PNG with no interlace (depth ${depth}, color type ${color}, interlace ${interlace})`).toBe(true);
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
      expect(Number.isNaN(v), `${what}: PNG filter ${filter} is one of 0–4`).toBe(false);
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
export function readFinal(out: string, f: ViewFrame, size: [number, number], what: string): Image {
  const im = decodePng(readNamed(out, f.final, 'png', what), what);
  expect([im.width, im.height], `${what} is ${size[0]} × ${size[1]}`).toEqual(size);
  return im;
}

// ---------------------------------------------------------------------------------------------------
// The judges. Each takes an image as the final target holds it, from the renderer or from a CPU reference, and returns
// its failures, each naming its pixel.

/** The backdrop pixel where POINT projects, seen from `cam`, shows the flat color of the cell holding DIRECTION
 * within 1 code value. */
export function backdropProblems(im: Image, cam: Pinhole, label: string): string[] {
  const [x, y] = pixelOf(cam, POINT);
  const cell = whereIs(DIRECTION).cell!;
  const want = cellCode(cell);
  const got = px(im, x, y);
  if (codeOff(got, want) <= 1) return [];
  return [`${label}: the background pixel (${x}, ${y}) where the world point (2, 0, 1) projects reads ${got.join(', ')}; the flat color of ${cellName(cell)}, which holds the direction (2, −1.7, 1), is ${want.join(', ')} within 1 code value`];
}

/** Whether the ray from floor point `p` toward the key sun meets the box (so `p` is in its shadow). */
function shadowed(p: V3): boolean {
  return hitBox(p, TOWARD_KEY) !== null;
}
/** The nearest positive hit of a ray on the box, or null. */
export function hitBox(o: V3, d: V3): number | null {
  let t0 = 1e-9; let t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]!) < 1e-12) { if (o[k]! < BOX.min[k]! || o[k]! > BOX.max[k]!) return null; continue; }
    const a = (BOX.min[k]! - o[k]!) / d[k]!; const b = (BOX.max[k]! - o[k]!) / d[k]!;
    t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b));
  }
  return t0 <= t1 ? t0 : null;
}
/** Where pixel centre (x, y)'s ray meets y = 0 before the box, or null. */
export function floorHit(cam: Pinhole, x: number, y: number): V3 | null {
  const d = rayAt(cam, x + 0.5, y + 0.5);
  if (d[1] >= 0) return null;
  const t = -cam.position[1] / d[1];
  const tb = hitBox(cam.position, d);
  if (tb !== null && tb < t) return null;
  return add(cam.position, scale(d, t));
}
/** Margins (m) around the shadow's edges and the box's foot, and the least angular margin (°) to a cell edge, within
 * which pixels are not judged: the shadow's edge filtering, the contact, and the environment's filtering across cell
 * edges are free there. */
export const EDGE_M = 0.05;
export const CELL_MARGIN_DEG = 1;
/** The shadow's judged core: projected-floor pixels on the catcher whose point lies in the box's shadow more than
 * EDGE_M from its edge and from the box's foot, whose ±2 px neighbours do too, and whose backdrop direction lies more
 * than CELL_MARGIN_DEG inside one cell; each with the floor's linear value there. */
export interface CorePixel { x: number; y: number; p: V3; cell: Cell; floor: Rgb }
export function shadowCore(cam: Pinhole = SHADOW_CAM): CorePixel[] {
  const [w, h] = cam.size;
  const ring: [number, number][] = Array.from({ length: 16 }, (_, k) => [Math.cos((k * Math.PI) / 8) * EDGE_M, Math.sin((k * Math.PI) / 8) * EDGE_M]);
  const inCore = (p: V3): boolean => {
    if (Math.abs(p[0]) > CATCHER_HALF - 0.1 || Math.abs(p[2]) > CATCHER_HALF - 0.1) return false;
    const nearFoot = p[0] > BOX.min[0] - EDGE_M && p[0] < BOX.max[0] + EDGE_M && p[2] > BOX.min[2] - EDGE_M && p[2] < BOX.max[2] + EDGE_M;
    if (nearFoot || !shadowed(p)) return false;
    return ring.every(([dx, dz]) => shadowed([p[0] + dx, 0, p[2] + dz]));
  };
  const core = new Uint8Array(w * h);
  const hits: (V3 | null)[] = new Array(w * h).fill(null);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = floorHit(cam, x, y);
    hits[y * w + x] = p;
    if (p && inCore(p)) core[y * w + x] = 1;
  }
  const out: CorePixel[] = [];
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    let all = true;
    for (let dy = -2; dy <= 2 && all; dy++) for (let dx = -2; dx <= 2; dx++) if (!core[(y + dy) * w + x + dx]) { all = false; break; }
    if (!all) continue;
    const p = hits[y * w + x]!;
    const where = whereIs(sub(p, domeCentre(cam.position, 'origin')));
    if (!where.cell || where.margin < CELL_MARGIN_DEG) continue;
    out.push({ x, y, p, cell: where.cell, floor: cellLinear(where.cell) });
  }
  return out;
}
/** The fewest core pixels the shadow is judged on (counted on the CPU helpers before commit: README, Fixture). */
export const MIN_CORE = 500;

/** Each core pixel shows the floor's value × (1 − the catcher's alpha) within 1 code value. */
export function shadowProblems(im: Image, core: CorePixel[], label: string): string[] {
  const keep = 1 - CATCH_ALPHA;
  let off = 0; const first: string[] = [];
  for (const c of core) {
    const want = codes(c.floor.map((v) => v * keep) as Rgb);
    const got = px(im, c.x, c.y);
    if (codeOff(got, want) <= 1) continue;
    off++;
    if (first.length < 3) first.push(`(${c.x}, ${c.y}) at ${v3s(c.p)} reads ${got.join(', ')}, the floor's ${codes(c.floor).join(', ')} (${cellName(c.cell)}) × (1 − ${CATCH_ALPHA}) is ${want.join(', ')}`);
  }
  return off === 0 ? [] : [`${label}: ${off} of ${core.length} projected-floor pixels in the box's shadow are not the floor's value × (1 − the catcher's alpha ${CATCH_ALPHA}) within 1 code value; first ${first.join('; ')}`];
}

// ---------------------------------------------------------------------------------------------------
// CPU images: the right program's and the planted wrong programs' pixels, as the judges read them.

/** The backdrop alone seen from `cam` with the dome where `dome` says: each pixel the flat color its centre ray shows. */
export function cpuBackdrop(cam: Pinhole, dome: Dome): Image {
  const [w, h] = cam.size;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = codes(radiance(groundDirection(cam.position, rayAt(cam, x + 0.5, y + 0.5), dome)));
    rgba.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
  }
  return { width: w, height: h, rgba };
}
/** The shadow scene's core pixels as drawn in `order`: `catcher_over` composites the catcher's black at its alpha over
 * the projected floor; the planted `backdrop_over` draws the backdrop after the catcher, so the floor shows unshadowed. */
export function cpuShadow(core: CorePixel[], order: 'catcher_over' | 'backdrop_over'): Image {
  const [w, h] = SHADOW_SIZE;
  const rgba = new Uint8Array(w * h * 4);
  const keep = order === 'catcher_over' ? 1 - CATCH_ALPHA : 1;
  for (const c of core) {
    const v = codes(c.floor.map((f) => f * keep) as Rgb);
    rgba.set([v[0], v[1], v[2], 255], (c.y * w + c.x) * 4);
  }
  return { width: w, height: h, rgba };
}

/** The fixture's own checks for one pose: the pixel where POINT projects is in view, its centre ray's backdrop
 * direction (and its ±1 px neighbours') lies in the cell holding DIRECTION more than CELL_MARGIN_DEG inside it, and
 * the planted dome shows another cell there whose color is more than 1 code away. */
export function poseFixture(cam: Pinhole, label: string): string[] {
  const problems: string[] = [];
  const [x, y] = pixelOf(cam, POINT);
  if (x < 2 || y < 2 || x >= cam.size[0] - 2 || y >= cam.size[1] - 2) return [`${label}: (2, 0, 1) projects to (${x}, ${y}), outside the view`];
  const want = whereIs(DIRECTION);
  if (!want.cell || want.margin < CELL_MARGIN_DEG) problems.push(`${label}: the direction (2, −1.7, 1) lies within ${CELL_MARGIN_DEG}° of a cell edge`);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const w = whereIs(groundDirection(cam.position, rayAt(cam, x + dx + 0.5, y + dy + 0.5)));
    if (!sameCell(w.cell, want.cell) || w.margin < CELL_MARGIN_DEG) problems.push(`${label}: pixel (${x + dx}, ${y + dy})'s backdrop direction is in ${cellName(w.cell)} at ${fx(w.margin, 2)}° from its edge, not inside ${cellName(want.cell)}`);
  }
  const planted = whereIs(groundDirection(cam.position, rayAt(cam, x + 0.5, y + 0.5), 'above_camera'));
  if (sameCell(planted.cell, want.cell) || codeOff(codes(radiance(groundDirection(cam.position, rayAt(cam, x + 0.5, y + 0.5), 'above_camera'))), cellCode(want.cell!)) <= 1) {
    problems.push(`${label}: the dome above the camera shows ${cellName(planted.cell)} at (${x}, ${y}), too near the right cell's color to tell apart`);
  }
  return problems;
}
