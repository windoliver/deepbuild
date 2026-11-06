// Test-side tools for the blind redraft of #424's AC3 (REDRAFT.md). Standing alone, as suites don't import each
// other: the machine gate, deep-gpu built once per file and driven by one JSON line (#377), `view3d`'s targets read
// back (#378: final PNG, linear f32, object-ID PNG; copied from #421's and #422's helpers), the two fixtures this
// criterion names, and the two judges as pure functions over pixels, so they can be fed CPU stand-ins. Nothing here
// stands in for the renderer.

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
/** The checkout root (tests/acceptance/424/redraft-ac3 is four levels down). */
export const REPO = join(HERE, '..', '..', '..', '..');

/** The criterion's ID: the first 8 hex digits of SHA-256 of its text (REDRAFT.md: The criterion). */
export const AC3 = 'AC3 #424.649ef843';

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
const ON_METAL = process.platform === 'darwin';
/** The GPU layer draws these pixels on macOS's Metal device, the reference platform. Nothing is gated on the model. */
export function requireMetal(): void {
  if (!ON_METAL) inconclusive(`the GPU layer draws these pixels on macOS's Metal device; this is ${process.platform}`);
}

// The build: deep-gpu built once per file, on macOS only (off it every test is INCONCLUSIVE before drawing).
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
    if (!ON_METAL) return;
    dir = mkdtempSync(join(tmpdir(), 'deep-424-ac3-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(targetDir(), 'debug', exe('deep-gpu')), join(dir, exe('deep-gpu')));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo ${CARGO_ARGS.join(' ')}`).toBe('');
    return join(dir, exe('deep-gpu'));
  };
}
/** A fresh temporary folder per test (documents, outputs), deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-424-ac3-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run`: one JSON line in (`{out, calls}`), one line out (`{ok, replies}`) (#377).

export function runGpu(bin: string, out: string, calls: JsonObject[]): JsonObject[] {
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`deep-gpu run: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  const lines = stdout.split('\n').filter((line) => line !== '').map((line): JsonValue => {
    try { return JSON.parse(line) as JsonValue; } catch { return line; }
  });
  expect(timedOut, 'deep-gpu run finished within its timeout').toBe(false);
  expect(run.status, `deep-gpu run exited 0 (${run.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(run.stderr ?? '').slice(-3000)}`).toBe(0);
  expect(lines.length, 'deep-gpu run: one output line per input line').toBe(1);
  const answer = obj(lines[0], 'deep-gpu run: the answer');
  expect(answer['ok'], `deep-gpu run refused the scenario: ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], 'deep-gpu run: replies').map((r, i) => obj(r, `deep-gpu run: replies[${i}]`));
  expect(replies.length, 'deep-gpu run: one reply per call').toBe(calls.length);
  return replies;
}
/** A reply that holds no refusal `code`; INCONCLUSIVE when the platform can't draw it. */
export function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  return reply;
}

// ---------------------------------------------------------------------------------------------------
// The look and the documents

const STATUS: JsonObject = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
/** #378's acceptance look: physical basis, tone map none at the EV100 whose scale is 1 (−log₂ 1.2), no finish, no
 * deband, no bloom, no ground grid; so the final frame is the sRGB encoding of the linear target (#378's AC). */
export const PLAIN_LOOK: JsonObject = {
  id: 'look-424-ac3', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'A #424 AC3 acceptance look.',
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
export function sessionDoc(id: string, size: [number, number], items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) {
    withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  }
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #424 AC3 acceptance fixture.`, size, camera: 'cam', transport: { span: '2s' },
    requires: { modules: { scene3d: '^1' } }, layers: { main: { writer: 'agent:sess-alpha', title: 'Main', order: 'a0' } }, ...extra, items: withIds,
  };
}

export type V3 = [number, number, number];
export type Rgb = [number, number, number];
const camera = (position: V3, target: V3, fov: number): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov, near: 0.1, far: 100 } });
const material = (params: JsonObject): JsonObject => ({ kind: 'material@1', params });
/** A sun (`light.sun@1`, shining along its own −Z, aimed by `at.rot`) with no shadow map, so nothing in either
 * fixture shadows anything and "the block hidden" changes no light on the crankshaft. */
const sun = (illuminance: number, rot: V3): JsonObject =>
  ({ kind: 'light.sun@1', params: { illuminance, color: [1, 1, 1], shadow: false }, at: { rot } });
/** A near-black sky whose ambient is the same from above and below, so every face, front or back, gets some light. */
const SKY: JsonObject = { kind: 'sky@1', params: { top: [0.02, 0.02, 0.03, 1], low: [0.02, 0.02, 0.03, 1], ambient_top: [0.06, 0.06, 0.06], ambient_low: [0.06, 0.06, 0.06] } };
/** Toward the sun: (0.557, 0.766, 0.321), so the block's top, its +x side and the crankshaft's curve all differ. */
const SUN_ROT: V3 = [-50, 60, 0];

/** Both fixtures draw at this size. */
export const SIZE: [number, number] = [480, 360];

const circle = (r: number, n: number): [number, number][] =>
  Array.from({ length: n }, (_, k): [number, number] => [r * Math.cos((2 * Math.PI * k) / n), r * Math.sin((2 * Math.PI * k) / n)]);
const rect = (x0: number, x1: number, y0: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/**
 * The engine block over its crankshaft (REDRAFT.md: The fixture). The block is an `extrude@1` prism along z, 1.2 ×
 * 1.0 × 1.6 m, with a 0.27 m bore and two water jackets (a slot above the bore, one beside it) as holes; the
 * crankshaft a `lathe@1` turned onto z (journals 0.12 m, webs 0.22 m), wholly inside the bore. From the camera every
 * crankshaft pixel lies behind two front faces of the block (its outer wall, a jacket's far wall) and two back faces
 * (the jacket's near wall, the bore's near wall), and the bore's open ends face away, so the crankshaft shows nowhere
 * but through the block. Iron red, steel blue: a layer of either changes a pixel by many codes.
 *
 * `block`: `absent` (the block hidden: not in the document), `opaque` (no `adjust`: the block's own shaded color) or
 * `see_through` (`adjust: {opacity: 0.3}`).
 */
export function engineDoc(block: 'absent' | 'opaque' | 'see_through'): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: camera([2.4, 1.5, 0.5], [0, 0, 0], 50),
    sky: SKY,
    sun: sun(2, SUN_ROT),
    iron: material({ base_color: [0.5, 0.06, 0.05], roughness: 0.6 }),
    steel: material({ base_color: [0.08, 0.2, 0.6], roughness: 0.4 }),
    crankshaft: {
      kind: 'lathe@1',
      params: {
        outline: [[0.12, -0.7], [0.12, -0.45], [0.22, -0.45], [0.22, -0.3], [0.12, -0.3], [0.12, 0.3], [0.22, 0.3], [0.22, 0.45], [0.12, 0.45], [0.12, 0.7]],
        segments: 64, caps: 'flat',
      },
      at: { pos: [0, 0, 0], rot: [90, 0, 0] },
      material: 'steel', cast_shadow: false,
    },
  };
  if (block !== 'absent') {
    items['block'] = {
      kind: 'extrude@1',
      params: {
        outline: rect(-0.6, 0.6, -0.5, 0.5),
        holes: [circle(0.27, 96), rect(-0.3, 0.3, 0.34, 0.42), rect(0.36, 0.44, -0.35, 0.42)],
        depth: { from: -0.8, to: 0.8 },
      },
      at: { pos: [0, 0, 0] },
      material: 'iron', cast_shadow: false,
      ...(block === 'see_through' ? { adjust: { opacity: 0.3 } } : {}),
    };
  }
  return sessionDoc(`engine-${block}`, SIZE, items);
}

/** The emission fixture's parts: two use `glow`, whose emission_strength the channel keys; two use `twin`, a material
 * whose every field is `glow`'s (so content-keyed, they hold the same numbers until the channel moves one); and a floor. */
export const GLOW_PARTS = ['glow_ball', 'glow_box'] as const;
export const OTHER_PARTS = ['twin_ball', 'twin_box', 'floor'] as const;
/** The channel's value at frame n at `EMISSION_FPS` (t = n ÷ fps): linear from 0 at 0 s to 4 at 1 s, then held. */
export const EMISSION_FPS = 4;
export const EMISSION_FRAMES = 6;
export const strengthAt = (frame: number): number => Math.min(4, (4 * frame) / EMISSION_FPS);

/**
 * The emission fixture (REDRAFT.md: The fixture): on a grey floor, a ball and a box of `glow` and a ball and a box of
 * `twin`, the glow ball in front of the twin ball so their silhouettes touch; one document channel keys
 * `items/glow/params/emission_strength` from 0 at 0 s to 4 at 1 s, linear (Material: "a channel or a driver keys any
 * of its numbers at items/<id>/params/<name>"; Channel and key).
 */
export function emissionDoc(): JsonObject {
  const shared: JsonObject = { base_color: [0.4, 0.4, 0.4], roughness: 0.5, emission: [1, 1, 1], emission_strength: 0 };
  const box = (size: V3, pos: V3, yaw: number, mat: string): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos, rot: [0, yaw, 0] }, material: mat });
  const ball = (radius: number, pos: V3, mat: string): JsonObject => ({ kind: 'ball@1', params: { radius, segments: 64 }, at: { pos }, material: mat });
  return sessionDoc('emission-keyed', SIZE, {
    cam: camera([0, 1.6, 3.2], [0, 0.25, 0], 40),
    sky: SKY,
    sun: sun(2, SUN_ROT),
    grey: material({ base_color: [0.3, 0.3, 0.3], roughness: 0.8 }),
    glow: material({ ...shared }),
    twin: material({ ...shared }),
    floor: box([4, 0.1, 4], [0, -0.05, 0], 0, 'grey'),
    glow_ball: ball(0.3, [-0.35, 0.3, 0.5], 'glow'),
    twin_ball: ball(0.3, [0.05, 0.3, 0], 'twin'),
    glow_box: box([0.45, 0.45, 0.45], [0.85, 0.225, -0.2], 25, 'glow'),
    twin_box: box([0.45, 0.45, 0.45], [-0.95, 0.225, -0.3], -20, 'twin'),
  }, {
    channels: {
      glow_up: {
        target: 'items/glow/params/emission_strength', type: 'f32',
        keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '1s', value: 4, interp: 'linear' } },
      },
    },
  });
}

// ---------------------------------------------------------------------------------------------------
// view3d (#378) and its frames

export interface View3d {
  doc: string; look: JsonObject; size: [number, number]; frames?: number; fps?: number;
  capture?: 'every' | number[]; targets?: ('final' | 'linear' | 'ids')[];
  /** #378's counters; with them each frame also reports `compiled` (REDRAFT.md: Assumed surfaces). */
  counts?: boolean;
}
export const view3dCall = (v: View3d): JsonObject => ({ call: 'view3d', ...(v as unknown as JsonObject) });
export interface ViewFrame {
  frame: number; final: string | null; linear: string | null; ids: string | null; picks: Map<number, string> | null;
  /** The pipelines compiled since the previous frame drew (frame 0: since the call began), one name per compile. */
  compiled: string[] | null;
}
const optStr = (v: JsonValue | undefined, what: string): string | null => (v === undefined || v === null ? null : str(v, what));
export function framesOf(reply: JsonObject, what: string): ViewFrame[] {
  answered(reply, what);
  return arr(reply['frames'], `${what}: frames`).map((v, i): ViewFrame => {
    const f = obj(v, `${what}: frames[${i}]`); const at = `${what}: frames[${i}]`;
    let picks: Map<number, string> | null = null;
    if (isObject(f['picks'])) picks = new Map(Object.entries(f['picks']).map(([k, id]) => [Number(k), str(id, `${at}.picks[${k}]`)]));
    const compiled = f['compiled'] === undefined ? null : arr(f['compiled'], `${at}.compiled`).map((p, j) => str(p, `${at}.compiled[${j}]`));
    return { frame: num(f['frame'], `${at}.frame`), final: optStr(f['final'], `${at}.final`), linear: optStr(f['linear'], `${at}.linear`), ids: optStr(f['ids'], `${at}.ids`), picks, compiled };
  });
}
export function frameAt(frames: ViewFrame[], n: number, what: string): ViewFrame {
  const f = frames.find((x) => x.frame === n);
  expect(f, `${what}: frame ${n} is in the reply`).toBeDefined();
  return f!;
}

// Targets: files the binary wrote, each named by its SHA-256 (#378).
function readNamed(out: string, hash: string | null, ext: string, what: string): Buffer {
  expect(hash, `${what} is written, named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${hash}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}
/** A target read back as one RGB value per pixel. */
export interface Pixels { width: number; height: number; at: (x: number, y: number) => Rgb }
/** The linear target (#378): little-endian f32 RGBA, rows top-down, `w × h × 16` bytes, before exposure. */
export function readLinear(out: string, hash: string | null, size: [number, number], what: string): Pixels {
  const file = readNamed(out, hash, 'f32', what);
  expect(file.length, `${what} holds ${size[0]} × ${size[1]} f32 RGBA pixels`).toBe(size[0] * size[1] * 16);
  return { width: size[0], height: size[1], at: (x, y) => { const o = (y * size[0] + x) * 16; return [file.readFloatLE(o), file.readFloatLE(o + 4), file.readFloatLE(o + 8)]; } };
}
interface Image { width: number; height: number; rgba: Uint8Array; channels: number }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** Reads an 8-bit RGB or RGBA PNG with no interlace. */
function decodePng(file: Buffer): Image {
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
  return { width, height, rgba, channels };
}
/** The final target (#378): the 8-bit frame as shown, its code values. */
export function readFinal(out: string, hash: string | null, size: [number, number], what: string): Pixels {
  const png = decodePng(readNamed(out, hash, 'png', what));
  expect([png.width, png.height], `${what} is ${size[0]} × ${size[1]}`).toEqual(size);
  return { width: png.width, height: png.height, at: (x, y) => { const o = (y * png.width + x) * 4; return [png.rgba[o]!, png.rgba[o + 1]!, png.rgba[o + 2]!]; } };
}
/** The object-ID target (#378): pick ID r + 2^8 g + 2^16 b + 2^24 a, 0 where nothing draws, named by `picks`. */
export interface Ids { width: number; height: number; at: (x: number, y: number) => string | null }
export function readIds(out: string, f: ViewFrame, what: string): Ids {
  const png = decodePng(readNamed(out, f.ids, 'png', what));
  expect(png.channels, `${what} is an RGBA PNG`).toBe(4);
  expect(f.picks, `${what}: the frame names the item each pick ID stands for`).not.toBeNull();
  const items: (string | null)[] = new Array(png.width * png.height);
  for (let i = 0; i < items.length; i++) {
    const o = i * 4;
    const pick = (png.rgba[o]! + png.rgba[o + 1]! * 256 + png.rgba[o + 2]! * 65_536 + png.rgba[o + 3]! * 16_777_216) >>> 0;
    items[i] = pick === 0 ? null : f.picks!.get(pick) ?? `unknown:${pick}`;
  }
  return { width: png.width, height: png.height, at: (x, y) => (x < 0 || y < 0 || x >= png.width || y >= png.height ? null : items[y * png.width + x]!) };
}

// ---------------------------------------------------------------------------------------------------
// The judges: pure functions of pixels, so a CPU stand-in for a wrong program can be fed to them (REDRAFT.md).

/** The sRGB encoding of a linear value, as an unrounded 8-bit code (IEC 61966-2-1; #378's output pass). */
export function code(linear: number): number {
  const v = Math.min(1, Math.max(0, linear));
  return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
}
const CH = ['red', 'green', 'blue'] as const;
const fmt = (c: readonly number[], d = 4): string => `[${c.map((v) => v.toFixed(d)).join(', ')}]`;

export interface CompositeInput {
  width: number; height: number;
  /** The object-ID target with the block hidden, and with it opaque. */
  idsHidden: Ids; idsOpaque: Ids;
  /** The linear targets with the block hidden (the crankshaft's own value) and opaque (the block's own shaded color). */
  linHidden: Pixels; linOpaque: Pixels;
  /** The final target with the block at adjust opacity 0.3: what is shown. */
  shown: Pixels;
}
export interface CompositeVerdict { judged: number; worst: number; failures: string[]; problems: string[] }
/**
 * Every crankshaft pixel (the crankshaft's in the ID target with the block hidden) must be covered by the block (the
 * block's in the ID target with it opaque; the fixture's own check, in `problems`), and the shown code of each of its
 * channels must be within 2 of the sRGB code of 0.7 × the crankshaft's linear value with the block hidden + 0.3 × the
 * block's own linear shaded color there. A failure names the pixel, the codes and the channel.
 */
export function judgeComposite(input: CompositeInput, crank: string, block: string): CompositeVerdict {
  const failures: string[] = []; const problems: string[] = [];
  let judged = 0; let worst = 0; let uncovered = 0;
  for (let y = 0; y < input.height; y++) for (let x = 0; x < input.width; x++) {
    if (input.idsHidden.at(x, y) !== crank) continue;
    if (input.idsOpaque.at(x, y) !== block) { uncovered++; continue; }
    judged++;
    const a = input.linHidden.at(x, y); const b = input.linOpaque.at(x, y); const s = input.shown.at(x, y);
    const mix: Rgb = [0, 1, 2].map((k) => 0.7 * a[k]! + 0.3 * b[k]!) as Rgb;
    const want = mix.map(code);
    for (let k = 0; k < 3; k++) {
      const off = Math.abs(s[k]! - want[k]!);
      worst = Math.max(worst, off);
      if (off > 2) {
        failures.push(`pixel (${x}, ${y}) ${CH[k]}: shown ${s[k]}, expected ${want[k]!.toFixed(2)} = code(0.7 × ${a[k]!.toFixed(4)} hidden + 0.3 × ${b[k]!.toFixed(4)} block), off by ${off.toFixed(2)} codes; shown ${fmt(s, 0)}, expected ${fmt(want, 2)}`);
        break;
      }
    }
  }
  if (uncovered > 0) problems.push(`${uncovered} crankshaft pixels are not behind the block with it opaque: the fixture doesn't put the block over its crankshaft`);
  return { judged, worst, failures: summarize(failures), problems };
}

/** The first 25 failures and how many there were. */
function summarize(failures: string[]): string[] {
  return failures.length <= 25 ? failures : [...failures.slice(0, 25), `… and ${failures.length - 25} more`];
}

/** The mask grown by `r` px (Chebyshev). */
export function grow(mask: Uint8Array, width: number, height: number, r: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!mask[y * width + x]) continue;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const X = x + dx; const Y = y + dy;
      if (X >= 0 && Y >= 0 && X < width && Y < height) out[Y * width + X] = 1;
    }
  }
  return out;
}

export interface EmissionFrame { frame: number; strength: number; shown: Pixels; linear: Pixels; compiled: string[] | null }
export interface EmissionVerdict {
  /** Pixels judged unchanged (outside the glow parts grown by 2 px), and of those, the other parts' own. */
  still: number; stillOfOthers: Map<string, number>;
  /** Each glow part's pixels at least 1 px inside its silhouette. */
  glowing: Map<string, number>;
  failures: string[];
}
/**
 * Against frame 0 (strength 0), at every later frame:
 * - every pixel farther than 2 px from a pixel of a part that uses the keyed material shows the same code on every
 *   channel (nothing else changes), naming the pixel and the part the ID target gives it;
 * - every pixel at least 1 px inside such a part changes at strength 4 (it is that part's change), and its linear
 *   value rises in step with the strength: the rise at strength s is s ÷ 4 of the rise at 4, within 1% of that rise
 *   (+ 1e-4), so the keys reach the shading as the values 0 to 4;
 * - no frame after frame 0 compiled a pipeline, naming those it did; frame 0 must report the compiles that opened the
 *   view, or the report reads nothing.
 */
export function judgeEmission(frames: EmissionFrame[], ids: Ids, glow: readonly string[]): EmissionVerdict {
  const { width, height } = ids;
  const failures: string[] = [];
  const base = frames.find((f) => f.strength === 0);
  const full = frames.find((f) => f.strength === 4);
  if (!base || !full) return { still: 0, stillOfOthers: new Map(), glowing: new Map(), failures: ['the frames hold no strength-0 or no strength-4 frame'] };
  const isGlow = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (glow.includes(ids.at(x, y) ?? '')) isGlow[y * width + x] = 1;
  const near = grow(isGlow, width, height, 2);
  let still = 0;
  const glowing = new Map<string, number>();
  const stillOfOthers = new Map<string, number>();
  const changed: string[] = []; const dark: string[] = []; const offStep: string[] = []; const compiled: string[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (!near[i]) {
      still++;
      const id = ids.at(x, y) ?? 'background';
      stillOfOthers.set(id, (stillOfOthers.get(id) ?? 0) + 1);
      const s0 = base.shown.at(x, y);
      for (const f of frames) {
        if (f === base) continue;
        const s = f.shown.at(x, y);
        if (s[0] !== s0[0] || s[1] !== s0[1] || s[2] !== s0[2]) { changed.push(`frame ${f.frame} (strength ${f.strength}): pixel (${x}, ${y}) of ${id}, not a part that uses the keyed material, changed from ${fmt(s0, 0)} to ${fmt(s, 0)}`); break; }
      }
      continue;
    }
    // At least 1 px inside a glow part: the pixel and its 8 neighbours are glow pixels.
    let inside = true;
    for (let dy = -1; dy <= 1 && inside; dy++) for (let dx = -1; dx <= 1 && inside; dx++) {
      const X = x + dx; const Y = y + dy;
      if (X < 0 || Y < 0 || X >= width || Y >= height || !isGlow[Y * width + X]) inside = false;
    }
    if (!inside) continue;
    const id = ids.at(x, y)!;
    glowing.set(id, (glowing.get(id) ?? 0) + 1);
    const s0 = base.shown.at(x, y); const s4 = full.shown.at(x, y);
    if (![0, 1, 2].some((k) => Math.abs(s4[k]! - s0[k]!) > 2)) dark.push(`pixel (${x}, ${y}) of ${id} shows ${fmt(s4, 0)} at strength 4, within 2 codes of ${fmt(s0, 0)} at 0: the part that uses the keyed material didn't change`);
    const l0 = base.linear.at(x, y); const rise4 = full.linear.at(x, y).map((v, k) => v - l0[k]!);
    for (const f of frames) {
      if (f === base || f === full) continue;
      const rise = f.linear.at(x, y).map((v, k) => v - l0[k]!);
      for (let k = 0; k < 3; k++) {
        const want = (f.strength / 4) * rise4[k]!;
        if (Math.abs(rise[k]! - want) > 0.01 * Math.abs(rise4[k]!) + 1e-4) {
          offStep.push(`frame ${f.frame} (strength ${f.strength}): pixel (${x}, ${y}) of ${id} ${CH[k]} rose ${rise[k]!.toFixed(5)} in linear light, expected ${f.strength} ÷ 4 of the ${rise4[k]!.toFixed(5)} it rises at strength 4 = ${want.toFixed(5)}`);
          break;
        }
      }
    }
  }
  if (base.compiled === null || base.compiled.length === 0) compiled.push(`frame ${base.frame} reports no compile, though the view compiled what it draws with as it opened: the report counts nothing, so "compiles no pipeline" can't be read from it`);
  for (const f of frames) {
    if (f === base) continue;
    if (f.compiled === null) compiled.push(`frame ${f.frame} (strength ${f.strength}) reports no \`compiled\` list`);
    else if (f.compiled.length > 0) compiled.push(`frame ${f.frame} (strength ${f.strength}) compiled ${JSON.stringify(f.compiled)}`);
  }
  failures.push(...summarize(changed), ...summarize(dark), ...summarize(offStep), ...compiled);
  return { still, stillOfOthers, glowing, failures };
}
