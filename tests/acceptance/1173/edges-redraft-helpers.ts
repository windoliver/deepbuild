// Test-side tools for #1173's edge-coverage redraft (#1173.b5284ee0, C1-REDRAFT.md): `deep-gpu` (#377's binary) driven
// by JSON lines through #378's `view3d` and #379's `canonical` calls, with the reply fields and the planted program this
// redraft names; the fixture (an unlit cube whose silhouette is a hexagon, turning and sliding by sub-pixel steps); PNG
// and linear-target reading; and the measure: each pixel's coverage of the box, read in linear light from the resolved
// target, and the share of the silhouette's edge pixels that a 4x MSAA resolve leaves partly covered. A CPU rasterizer
// of the same silhouette at 1 and 4 samples a pixel lets the measure be checked on its own (and drives the simulation
// C1-REDRAFT.md reports). The JSON, build, run, PNG and gate helpers are copied from tests/acceptance/386/helpers.ts
// and the linear-target reader from tests/acceptance/378/helpers.ts, since suites don't import each other. Nothing here
// stands in for the renderer's multisampling or its resolve.

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
/** The checkout root (tests/acceptance/1173 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const BIN = 'deep-gpu';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);

// ---------------------------------------------------------------------------------------------------
// The criterion's numbers and the renderer's names.

/** "drawn at 4x MSAA": the sample count the replies report (C1-REDRAFT.md: Surface fields and the planted program). */
export const MSAA = 4;
/** scene3d's passes and the color target its geometry pass writes and its output pass reads (view3d's `passes`, #382). */
export const GEOMETRY_PASS = 'scene3d.geometry';
export const OUTPUT_PASS = 'scene3d.output';
export const COLOR_TARGET = 'linear';
/** The planted program: scene3d's geometry-pass targets made single-sample. */
export type Planted = 'single_sample_targets';

/**
 * The measure's thresholds (C1-REDRAFT.md: The measure). A pixel is partly covered when its coverage of the box, read in
 * linear light, lies in [PARTIAL_LO, PARTIAL_HI] (4x MSAA's levels are 1/4, 1/2 and 3/4; a single-sample pixel reads 0
 * or 1) and it lies on the line from the ground's color to the face's within RESIDUAL_MAX of their distance. A frame
 * passes when at least SHARE_MIN of the silhouette's edge pixels, and at least COUNT_MIN pixels, are partly covered
 * within EDGE_REACH px of the edge.
 */
export const PARTIAL_LO = 0.125;
export const PARTIAL_HI = 0.875;
export const RESIDUAL_MAX = 0.05;
export const EDGE_REACH = 2;
export const SHARE_MIN = 0.3;
export const COUNT_MIN = 60;
/** The fixture holds: the face at least this much brighter than the ground (linear luminance), the silhouette this share of the view. */
export const CONTRAST_MIN = 0.3;
export const AREA_SHARE: [number, number] = [0.08, 0.25];

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
const optStr = (v: JsonValue | undefined, what: string): string | null => (v === undefined || v === null ? null : str(v, what));

// ---------------------------------------------------------------------------------------------------
// The machine: the GPU layer draws on macOS's Metal device.

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these pixels on macOS's Metal device; this is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// The build: `deep-gpu`, the shipped feature set, built once per file.

function cargoBuild(): string {
  const args = ['build', '--locked', '--bin', BIN];
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}

/** Builds the binary once before the file's tests, off macOS not at all; a test that uses a build that failed fails with cargo's error. */
export function useBuild(): () => string {
  let dir = '';
  let error = 'not built';
  beforeAll(() => {
    if (process.platform !== 'darwin') return;
    dir = mkdtempSync(join(tmpdir(), 'deep-1173-bins-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(REPO, 'target', 'debug', exe(BIN)), join(dir, BIN));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo build --locked --bin ${BIN}`).toBe('');
    return join(dir, BIN);
  };
}

/** A fresh output folder per test (documents, targets), deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1173-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one scenario per line in, one line out (#377).

/** One scenario `{out, calls}`, accepted, with one reply per call. */
export function run(bin: string, out: string, calls: JsonObject[], planted?: Planted, timeoutMs = 3_600_000): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const name = `${BIN} ${args.join(' ')}`;
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const s = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const timedOut = s.error !== undefined && (s.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (s.error && !timedOut) throw Error(`${name}: ${s.error.message}`);
  expect(timedOut, `${name} finished within its timeout`).toBe(false);
  const stdout = s.stdout ?? '';
  expect(s.status, `${name} exited 0 (${s.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(s.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((line) => line !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(1);
  let parsed: JsonValue;
  try { parsed = JSON.parse(lines[0]!) as JsonValue; } catch { parsed = lines[0]!; }
  const answer = obj(parsed, `${name}: the answer`);
  expect(answer['ok'], `${name} refused the scenario: ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(calls.length);
  return replies;
}

/** A reply the binary answered, not refused (any `code`); INCONCLUSIVE when it says the platform can't draw it. */
export function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} answered unsupported_platform`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  return reply;
}

// ---------------------------------------------------------------------------------------------------
// Color, PNGs and the linear target

const decode = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const encode = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
/** Each 8-bit sRGB code's linear value (IEC 61966-2-1). */
export const LINEAR = Float64Array.from({ length: 256 }, (_, i) => decode(i / 255));
export type Rgb = [number, number, number];
/** Relative luminance of a linear RGB triple (Rec. 709 primaries, as sRGB's). */
export const luminanceOf = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

export interface Image { width: number; height: number; /** RGBA, row-major. */ rgba: Uint8Array }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** Reads an 8-bit RGB or RGBA PNG with no interlace. */
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
function readNamed(out: string, hash: string | null, ext: string, what: string): Buffer {
  expect(hash, `${what} is written, named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${hash}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}
/** The slot's bytes as `pixel_hash` hashes them (#377's): BGRA8, rows top-down, no padding. */
export function slotHashOf(image: Image): string {
  const bgra = Buffer.alloc(image.rgba.length);
  for (let i = 0; i < image.rgba.length; i += 4) { bgra[i] = image.rgba[i + 2]!; bgra[i + 1] = image.rgba[i + 1]!; bgra[i + 2] = image.rgba[i]!; bgra[i + 3] = image.rgba[i + 3]!; }
  return sha256(bgra);
}

/** A picture in linear light: three values a pixel, rows top-down. */
export interface Picture { width: number; height: number; rgb: Float64Array }
/** The final target's PNG, its sRGB codes decoded to linear light (the display encoding undone). */
export function finalPicture(out: string, hash: string | null, size: [number, number], what: string): { picture: Picture; image: Image } {
  const image = decodePng(readNamed(out, hash, 'png', what));
  expect([image.width, image.height], `${what} is ${size.join(' × ')}`).toEqual(size);
  const rgb = new Float64Array(image.width * image.height * 3);
  for (let i = 0; i < image.width * image.height; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = LINEAR[image.rgba[i * 4 + c]!]!;
  return { picture: { width: image.width, height: image.height, rgb }, image };
}
/** The resolved linear target as read back (#378): little-endian f32 RGBA, rows top-down, `w × h × 16` bytes. */
export function linearPicture(out: string, hash: string | null, size: [number, number], what: string): Picture {
  const file = readNamed(out, hash, 'f32', what);
  expect(file.length, `${what} holds ${size[0]} × ${size[1]} f32 RGBA pixels`).toBe(size[0] * size[1] * 16);
  const rgb = new Float64Array(size[0] * size[1] * 3);
  for (let i = 0; i < size[0] * size[1]; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = file.readFloatLE((i * 4 + c) * 4);
  return { width: size[0], height: size[1], rgb };
}

// ---------------------------------------------------------------------------------------------------
// The fixture (C1-REDRAFT.md: The fixture)

/** The view, its orthographic width and the frames: 480 × 360 px, 8 m across (60 px a metre), 24 frames at 24 fps. */
export const VIEW: [number, number] = [480, 360];
export const VIEW_WIDTH = 8;
export const PX_PER_M = VIEW[0] / VIEW_WIDTH;
export const FRAMES = 24;
export const FPS = 24;
/** The cube: 2 m, turned 45° about X then 35.264° about Y (its corner toward the camera: a hexagon silhouette), then by θ about the view axis. */
export const CUBE = 2;
export const TILT: [number, number] = [45, 35.264];
/** Over the 1 s span the cube turns 175.2° about Z (7.3° a frame) and slides 0.73 m right and 0.53 m up (1.825 and 1.325 px a frame). */
export const TURN = 175.2;
export const SLIDE: [number, number] = [0.73, 0.53];
/** The ground (the look's ground role) and the face (an unlit material's linear base color). */
export const GROUND_HEX = '#101114';
export const FACE: Rgb = [0.8, 0.8, 0.8];
export const WRITER = 'agent-a';
export const LIVE_WRITER = 'agent:alpha';

/** The fixture's turn and offset at view3d frame n (t = n ÷ fps; a `canonical` call's frame n + 1 is the same t). */
export function poseAt(n: number): { theta: number; pos: [number, number] } {
  const s = n / FPS;
  return { theta: TURN * s, pos: [SLIDE[0] * s, SLIDE[1] * s] };
}

/** A physical-basis look: tone map none at the exposure whose scale is 1, no finish, deband, bloom or 3D ground. */
export const EDGE_LOOK: JsonObject = {
  id: 'edges-1173', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'The #1173 edge-coverage acceptance look.',
  palette: { night: GROUND_HEX, graphite: '#1b1d22' }, roles: { ground: 'night', ink: 'graphite' },
  themes: { light: {}, dark: {} },
  fonts: {
    body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
    mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  },
  tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ground_3d: { kind: 'none' },
};

const linear = (target: string, to: number): JsonObject =>
  ({ target, type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '1s', value: to, interp: 'linear' } } });
/**
 * The fixture as view3d takes it (#378's shape: an `id`, one writer layer, each item in it): an orthographic camera
 * looking along −Z, and the cube under an unlit material, so its whole silhouette is one color on the ground.
 */
export function cubeDoc(): JsonObject {
  const items: JsonObject = {
    cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', layer: 'main', params: { projection: 'orthographic', position: [0, 0, 20], target: [0, 0, 0], view_width: VIEW_WIDTH } },
    face: { id: 'face', kind: 'material@1', name: 'Face', order: 'a1', layer: 'main', params: { base_color: [...FACE], unlit: true } },
    box: { id: 'box', kind: 'mark.box@1', name: 'Box', order: 'a2', layer: 'main', params: { size: [CUBE, CUBE, CUBE] }, material: 'face', at: { pos: [0, 0, 0], rot: [TILT[0], TILT[1], 0] } },
  };
  return {
    format: 1, id: 'edges-1173', profile: 'scene', title: 'A turning box', description: 'An unlit cube, corner on, turning and sliding by sub-pixel steps.',
    size: VIEW, camera: 'cam', transport: { span: '1s' },
    requires: { modules: { scene3d: '^1' } }, layers: { main: { writer: WRITER, title: 'Main', order: 'a0' } }, items,
    channels: { turn: linear('items/box/at/rot/2', TURN), x: linear('items/box/at/pos/0', SLIDE[0]), y: linear('items/box/at/pos/1', SLIDE[1]) },
  };
}
/** The writer's payload of a view3d document, as `canonical` takes it (#393's: no `id`, `layers` or item `layer`), in budget class `cls`. */
export function payload(doc: JsonObject, cls: string): JsonObject {
  const out = JSON.parse(JSON.stringify(doc)) as JsonObject;
  delete out['id'];
  delete out['layers'];
  for (const item of Object.values(obj(out['items'], 'items'))) delete (item as JsonObject)['layer'];
  out['budget'] = { class: cls };
  return out;
}
/** Writes `value` as JSON under `dir` and returns its absolute path. */
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

// ---------------------------------------------------------------------------------------------------
// view3d (#378) and canonical (#379), with the fields this redraft reads (C1-REDRAFT.md: Surface fields)

export const view3dCall = (doc: string): JsonObject =>
  ({ call: 'view3d', doc, look: EDGE_LOOK, size: VIEW, from: 0, frames: FRAMES, fps: FPS, capture: 'every', targets: ['final', 'linear'] });
export interface ViewFrame { frame: number; pixel_hash: string | null; final: string | null; linear: string | null }
export function framesOf(reply: JsonObject, what: string): ViewFrame[] {
  return arr(reply['frames'], `${what}: frames`).map((v, i): ViewFrame => {
    const f = obj(v, `${what}: frames[${i}]`); const at = `${what}: frames[${i}]`;
    return { frame: num(f['frame'], `${at}.frame`), pixel_hash: optStr(f['pixel_hash'], `${at}.pixel_hash`), final: optStr(f['final'], `${at}.final`), linear: optStr(f['linear'], `${at}.linear`) };
  });
}
export interface PassRow { name: string; reads: string[]; writes: string[] }
/** A view3d reply's `passes` (#382): the frame's passes in order, each with the targets it reads and writes. */
export function passesOf(reply: JsonObject, what: string): PassRow[] {
  return arr(reply['passes'], `${what}: passes`).map((p, i) => {
    const o = obj(p, `${what}: passes[${i}]`);
    return {
      name: str(o['name'], `${what}: passes[${i}].name`),
      reads: arr(o['reads'] ?? [], `${what}: passes[${i}].reads`).map((r) => str(r, 'a target read')),
      writes: arr(o['writes'] ?? [], `${what}: passes[${i}].writes`).map((r) => str(r, 'a target written')),
    };
  });
}
/** The sample count a view3d reply says its view drew at: `surface.msaa` (#386's surface report, with this redraft's field). */
export const viewMsaaOf = (reply: JsonObject, what: string): number => num(obj(reply['surface'], `${what}: surface`)['msaa'], `${what}: surface.msaa`);

/** A fresh `canonical` render (#379's call) of the payload at `frame`, purpose export, with its final and linear targets written. */
export const exportCall = (doc: string, frame: number): JsonObject =>
  ({ call: 'canonical', look: EDGE_LOOK, writer: LIVE_WRITER, doc, size: VIEW, frame, fps: FPS, purpose: 'export', targets: ['final', 'linear'] });
export interface Export { frame: number; purpose: string; pixel_hash: string | null; msaa: number; final: string | null; linear: string | null }
export function exportOf(reply: JsonObject, what: string): Export {
  answered(reply, what);
  return {
    frame: num(reply['frame'], `${what}.frame`), purpose: str(reply['purpose'], `${what}.purpose`), pixel_hash: optStr(reply['pixel_hash'], `${what}.pixel_hash`),
    msaa: num(reply['msaa'], `${what}.msaa`), final: optStr(reply['final'], `${what}.final`), linear: optStr(reply['linear'], `${what}.linear`),
  };
}

// ---------------------------------------------------------------------------------------------------
// The measure (C1-REDRAFT.md: The measure)

export interface EdgeCoverage {
  ground: Rgb; face: Rgb; contrast: number;
  /** Pixels at least half covered; the share of the view they make. */
  area: number; areaShare: number;
  /** Covered pixels with a 4-neighbour that isn't: the silhouette's edge, in pixels. */
  edge: number;
  /** Partly covered pixels on the ground-to-face line within EDGE_REACH px of the edge, and elsewhere. */
  partial: number; stray: number;
  /** Pixels within EDGE_REACH px of the edge whose color is off the ground-to-face line. */
  offLine: number;
  share: number;
  /** Partly covered pixels near the edge by coverage: [1/8, 3/8), [3/8, 5/8), [5/8, 7/8]. */
  levels: [number, number, number];
}
function median(xs: number[]): number { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; }

/**
 * Each pixel's coverage of the box in linear light: the ground is the median of the view's outer 4 px ring, the face
 * the median of the 9 × 9 px at its centre (the fixture keeps the box over both), and a pixel's coverage α its
 * projection onto the line from ground to face. The resolve averages samples in linear light, so a pixel that k of n
 * samples cover reads α = k ÷ n.
 */
export function edgeCoverage(p: Picture): EdgeCoverage {
  const { width: w, height: h, rgb } = p;
  const ring: number[][] = [[], [], []]; const centre: number[][] = [[], [], []];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (x < 4 || y < 4 || x >= w - 4 || y >= h - 4) for (let c = 0; c < 3; c++) ring[c]!.push(rgb[i * 3 + c]!);
    if (Math.abs(x - Math.floor(w / 2)) <= 4 && Math.abs(y - Math.floor(h / 2)) <= 4) for (let c = 0; c < 3; c++) centre[c]!.push(rgb[i * 3 + c]!);
  }
  const ground = ring.map(median) as Rgb; const face = centre.map(median) as Rgb;
  const d: Rgb = [face[0] - ground[0], face[1] - ground[1], face[2] - ground[2]];
  const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const n = w * h;
  const alpha = new Float64Array(n); const off = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const e: Rgb = [rgb[i * 3]! - ground[0], rgb[i * 3 + 1]! - ground[1], rgb[i * 3 + 2]! - ground[2]];
    const a = dd > 0 ? (e[0] * d[0] + e[1] * d[1] + e[2] * d[2]) / dd : 0;
    alpha[i] = a;
    const r = dd > 0 ? Math.hypot(e[0] - a * d[0], e[1] - a * d[1], e[2] - a * d[2]) / Math.sqrt(dd) : 0;
    off[i] = r > RESIDUAL_MAX ? 1 : 0;
  }
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && alpha[y * w + x]! >= 0.5;
  const edgeMask = new Uint8Array(n);
  let area = 0; let edge = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!inside(x, y)) continue;
    area++;
    if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) { edgeMask[y * w + x] = 1; edge++; }
  }
  // The band within EDGE_REACH px (Chebyshev) of the edge.
  const near = new Uint8Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!edgeMask[y * w + x]) continue;
    for (let dy = -EDGE_REACH; dy <= EDGE_REACH; dy++) for (let dx = -EDGE_REACH; dx <= EDGE_REACH; dx++) {
      const xx = x + dx; const yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h) near[yy * w + xx] = 1;
    }
  }
  let partial = 0; let stray = 0; let offLine = 0;
  const levels: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const isPartial = alpha[i]! >= PARTIAL_LO && alpha[i]! <= PARTIAL_HI && !off[i];
    if (near[i]) {
      if (off[i]) offLine++;
      if (isPartial) { partial++; levels[alpha[i]! < 0.375 ? 0 : alpha[i]! < 0.625 ? 1 : 2]++; }
    } else if (isPartial) stray++;
  }
  return {
    ground, face, contrast: luminanceOf(face) - luminanceOf(ground), area, areaShare: area / n, edge, partial, stray, offLine,
    share: edge > 0 ? partial / edge : 0, levels,
  };
}

/** One line of numbers for the log. */
export const coverageLine = (c: EdgeCoverage): string =>
  `${c.partial} partly covered of ${c.edge} edge px (share ${c.share.toFixed(3)}; levels ¼ ${c.levels[0]}, ½ ${c.levels[1]}, ¾ ${c.levels[2]}; stray ${c.stray}; off the line ${c.offLine}; silhouette ${(c.areaShare * 100).toFixed(1)}% of the view)`;

/** The fixture drew (the box on the ground, at its size): failures as sentences naming `what`. */
export function fixtureProblems(c: EdgeCoverage, what: string): string[] {
  const out: string[] = [];
  if (!(c.contrast >= CONTRAST_MIN)) out.push(`${what}: the box's face reads ${c.contrast.toFixed(3)} above the ground in linear luminance, not ${CONTRAST_MIN}: the box isn't drawn over the ground`);
  if (!(c.areaShare >= AREA_SHARE[0] && c.areaShare <= AREA_SHARE[1])) out.push(`${what}: the box's silhouette covers ${(c.areaShare * 100).toFixed(1)}% of the view, not ${AREA_SHARE[0] * 100}% to ${AREA_SHARE[1] * 100}%`);
  return out;
}
/** The box's edge has the partial coverage a 4x MSAA resolve leaves: failures as sentences naming `what`, the target read. */
export function coverageProblems(c: EdgeCoverage, what: string): string[] {
  const out = fixtureProblems(c, what);
  if (!(c.share >= SHARE_MIN && c.partial >= COUNT_MIN)) {
    out.push(`${what}: ${c.partial} pixels of partial coverage along the box's edge, ${c.share.toFixed(3)} of its ${c.edge} edge pixels, under the ${SHARE_MIN} (and ${COUNT_MIN} pixels) a ${MSAA}x MSAA resolve leaves: the target drew single-sample`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// A CPU rasterizer of the fixture's silhouette, n samples a pixel resolved in linear light: the measure's own check
// and C1-REDRAFT.md's simulation. It is not the renderer and stands in for nothing it draws.

/** Sample positions in a pixel, from its top-left corner: the standard 4x pattern (D3D, Metal, Vulkan), a 2 × 2 grid, and one sample at the centre. */
export const STANDARD_4X: [number, number][] = [[0.375, 0.125], [0.875, 0.375], [0.125, 0.625], [0.625, 0.875]];
export const GRID_4X: [number, number][] = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
export const ONE_SAMPLE: [number, number][] = [[0.5, 0.5]];

/** The cube's silhouette in view px (y down), counter-clockwise on screen: its corners turned by Rz·Ry·Rx (the core's order) and projected along −Z. */
export function silhouette(theta: number, pos: [number, number], pxPerM = PX_PER_M, size: [number, number] = VIEW): [number, number][] {
  const r = (deg: number): number => (deg * Math.PI) / 180;
  const [cx, sx] = [Math.cos(r(TILT[0])), Math.sin(r(TILT[0]))];
  const [cy, sy] = [Math.cos(r(TILT[1])), Math.sin(r(TILT[1]))];
  const [cz, sz] = [Math.cos(r(theta)), Math.sin(r(theta))];
  const m = [[cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx], [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx]];
  const pts: [number, number][] = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) {
    const v = [a * CUBE / 2, b * CUBE / 2, c * CUBE / 2];
    const x = m[0]![0]! * v[0]! + m[0]![1]! * v[1]! + m[0]![2]! * v[2]! + pos[0];
    const y = m[1]![0]! * v[0]! + m[1]![1]! * v[1]! + m[1]![2]! * v[2]! + pos[1];
    pts.push([size[0] / 2 + x * pxPerM, size[1] / 2 - y * pxPerM]);
  }
  // Andrew's monotone chain.
  pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = []; const upper: [number, number][] = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop(); lower.push(p); }
  for (const p of [...pts].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop(); upper.push(p); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** The polygon drawn with `samples` a pixel, face over ground, each pixel the mean of its samples in linear light (the resolve). */
export function rasterize(poly: [number, number][], samples: [number, number][], size: [number, number] = VIEW): Picture {
  const [w, h] = size;
  const ground = [0, 1, 2].map((c) => LINEAR[parseInt(GROUND_HEX.slice(1 + 2 * c, 3 + 2 * c), 16)]!) as Rgb;
  const rgb = new Float64Array(w * h * 3);
  for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = ground[c]!;
  const xs = poly.map((p) => p[0]); const ys = poly.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)) - 1); const x1 = Math.min(w - 1, Math.ceil(Math.max(...xs)) + 1);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)) - 1); const y1 = Math.min(h - 1, Math.ceil(Math.max(...ys)) + 1);
  const edges = poly.map((a, i) => { const b = poly[(i + 1) % poly.length]!; return [a[0], a[1], b[0] - a[0], b[1] - a[1]] as const; });
  const covers = (x: number, y: number): boolean => edges.every(([ax, ay, ex, ey]) => ex * (y - ay) - ey * (x - ax) >= 0);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    let k = 0;
    for (const [sx, sy] of samples) if (covers(x + sx, y + sy)) k++;
    const a = k / samples.length;
    for (let c = 0; c < 3; c++) rgb[(y * w + x) * 3 + c] = a * FACE[c]! + (1 - a) * ground[c]!;
  }
  return { width: w, height: h, rgb };
}
/** The picture as the final target holds it: each value sRGB-encoded to 8 bits, then decoded back to linear light as the test reads a PNG. */
export function throughFinal(p: Picture): Picture {
  const rgb = new Float64Array(p.rgb.length);
  for (let i = 0; i < rgb.length; i++) rgb[i] = LINEAR[Math.round(255 * encode(Math.min(1, Math.max(0, p.rgb[i]!))))]!;
  return { width: p.width, height: p.height, rgb };
}
