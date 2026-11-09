// Test-side tools for the #481 acceptance tests: the base's `deep-gpu` binary (#377's GPU layer with #378's `view3d`,
// #421's shading core, #422's sky, environment and key-sun shadows, #428's lobes, the base's `light.area@1`), built
// once per file and driven by JSON lines; the field and planted programs this suite adds (README: Assumed surfaces);
// the documents the tests draw; and PNG reading and writing (copied from #422's helpers, since suites don't import
// each other). Nothing here stands in for the renderer: the CPU reference of the profile is `reference.ts`.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type V3 = [number, number, number];
export type Rgb = [number, number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/481 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text (README: Criteria to tests). */
export const AC = {
  1: 'AC1 #481.79c5d9ee',
  2: 'AC2 #481.350e172c',
  3: 'AC3 #481.9afd6b06',
  4: 'AC4 #481.7124c07a',
} as const;

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
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** At least one failure, and one that names each of `names`: what a planted program must give. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  for (const name of names) {
    expect(failures.some((f) => f.includes(name)), `${what}: a failure names ${name}; the failures were:\n  ${failures.slice(0, 40).join('\n  ')}`).toBe(true);
  }
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
/** The GPU layer draws these pixels on macOS's Metal device; anywhere else the test is INCONCLUSIVE. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these pixels on macOS's Metal device; this is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// The build: deep-gpu built once per file and copied out of the target folder (the pinned toolchain added to PATH,
// as #166's suite does, for a shell that has rustup's toolchains but no cargo on its PATH).

const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetDir = (): string => { const t = process.env['CARGO_TARGET_DIR']; return t ? resolve(REPO, t) : join(REPO, 'target'); };
const CARGO_ARGS = ['build', '--locked', '--bin', 'deep-gpu'];
function cargoBuild(): string {
  const pinned = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
  const path = existsSync(pinned) ? `${process.env['PATH'] ?? ''}${delimiter}${pinned}` : process.env['PATH'];
  const env = { ...process.env, PATH: path, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const run = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${CARGO_ARGS.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
/** Builds deep-gpu before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useGpu(): () => string {
  let dir = ''; let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-481-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(targetDir(), 'debug', exe('deep-gpu')), join(dir, exe('deep-gpu')));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => { expect(error, `the binary builds: cargo ${CARGO_ARGS.join(' ')}`).toBe(''); return join(dir, exe('deep-gpu')); };
}
/** A fresh temporary folder per test (documents, outputs), deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-481-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one JSON line in, one JSON line out (#377).

/** The wrong programs this suite plants, each reachable only through `--planted` (README: Assumed surfaces, 5). */
export type GpuPlanted = 'subsurface_across_parts' | 'subsurface_adds_to_diffuse';
export function runGpu(bin: string, out: string, calls: JsonObject[], planted?: GpuPlanted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const name = `deep-gpu ${args.join(' ')}`;
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${name}: ${run.error.message}`);
  expect(timedOut, `${name} finished within its timeout`).toBe(false);
  const stdout = run.stdout ?? '';
  expect(run.status, `${name} exited 0 (${run.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(run.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, `${name}: the answer`);
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
// Looks and documents

const STATUS: JsonObject = { pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464' };
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
/** A physical-basis `look@1` (#421's shape) with the tone map and exposure given. */
function look(tone: 'none' | 'filmic', exposure: number): JsonObject {
  return {
    id: `look-481-${tone}`, format: 1, basis: 'physical', license: 'Apache-2.0', description: 'A #481 acceptance look.',
    palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', stone: '#d9dde3', sand: '#e6d3a3' },
    roles: { ground: 'night', ink: 'graphite', muted: 'slate', stone: 'stone', sand: 'sand' }, themes: { light: {}, dark: {} },
    fonts: {
      body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
      mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
    },
    tone_map: tone, exposure, finish: [], deband: 'none', bloom: 'none', ground_3d: { kind: 'none' },
    status: { ...STATUS }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: 0.1,
    attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
  };
}
/** Tone map none at the exposure whose scale is 1 (#378's and #421's acceptance look): the linear-target tests. */
export const PLAIN_LOOK = look('none', -Math.log2(1.2));
/** A filmic look for the pictures a person judges (AC4). */
export const SHOW_LOOK = look('filmic', 0);

/** A scene document as a session holds it (#378): one writer layer, every item in it. */
export function sessionDoc(id: string, size: [number, number], items: Record<string, JsonObject>): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #481 acceptance fixture.`, size, camera: 'cam', transport: { span: '4s' },
    requires: { modules: { scene3d: '^1' } }, layers: { main: { writer: 'agent:sess-481', title: 'Main', order: 'a0' } }, items: withIds,
  };
}
/** #378's pinhole `camera@1`: fov across the wider side, +Y up. */
export const camera = (position: V3, target: V3, fov: number): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov, near: 0.05, far: 50 } });
/** A `material@1` item (Material): the fields given over the design's defaults. */
export const material = (params: JsonObject): JsonObject => ({ kind: 'material@1', params });
/** A smooth `ball@1` (Builder: `ball {radius, segments}`). */
export const ball = (radius: number, pos: V3, mat: string): JsonObject => ({ kind: 'ball@1', params: { radius, segments: 256 }, at: { pos }, material: mat });
/** A `mark.box@1` of `size` centred on `pos`, turned by `rot` (degrees). */
export const box = (size: V3, pos: V3, mat: string, rot: V3 = [0, 0, 0]): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos, rot }, material: mat });
/** A sun (`light.sun@1`, shining along its own −Z, aimed by `at.rot`). */
export const sun = (illuminance: number, rot: V3, shadow: boolean): JsonObject => ({ kind: 'light.sun@1', params: { illuminance, color: [1, 1, 1], shadow }, at: { rot } });
/** A black sky with no ambient and no environment: the document's lights are the only light (#422). */
export const DARK_SKY: JsonObject = { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } };
/** The white furnace (#422; README: Assumed surfaces, 4): the environment's radiance is 1 in every direction. */
export const FURNACE_SKY: JsonObject = {
  kind: 'sky@1', params: { top: [1, 1, 1, 1], low: [1, 1, 1, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0], environment: { from: 'sky', intensity: 1 } },
};

// ---------------------------------------------------------------------------------------------------
// view3d (#378): the base's call, unchanged

export interface View3d { doc: string; look: JsonObject; size: [number, number]; targets: ('final' | 'linear' | 'ids')[] }
export const view3dCall = (v: View3d): JsonObject => ({ call: 'view3d', frames: 1, capture: [0], ...(v as unknown as JsonObject) });
export interface ViewFrame { frame: number; final: string | null; linear: string | null; ids: string | null; picks: Map<number, string> | null }
const optStr = (v: JsonValue | undefined, what: string): string | null => (v === undefined || v === null ? null : str(v, what));
export function frame0(reply: JsonObject, what: string): ViewFrame {
  answered(reply, what);
  const frames = arr(reply['frames'], `${what}: frames`).map((v, i) => obj(v, `${what}: frames[${i}]`));
  const f = frames.find((x) => x['frame'] === 0);
  expect(f, `${what}: frame 0 is in the reply`).toBeDefined();
  let picks: Map<number, string> | null = null;
  if (isObject(f!['picks'])) picks = new Map(Object.entries(f!['picks']).map(([k, id]) => [Number(k), str(id, `${what}.picks[${k}]`)]));
  return { frame: 0, final: optStr(f!['final'], `${what}.final`), linear: optStr(f!['linear'], `${what}.linear`), ids: optStr(f!['ids'], `${what}.ids`), picks };
}
export function readNamed(out: string, hash: string | null, ext: string, what: string): Buffer {
  expect(hash, `${what} is written, named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${hash}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}
/** The linear target (#378): little-endian f32 RGBA, rows top-down, `w × h × 16` bytes, before exposure. */
export interface Linear { width: number; height: number; at: (x: number, y: number) => Rgb }
export function readLinear(out: string, hash: string | null, size: [number, number], what: string): Linear {
  const file = readNamed(out, hash, 'f32', what);
  expect(file.length, `${what} holds ${size[0]} × ${size[1]} f32 RGBA pixels`).toBe(size[0] * size[1] * 16);
  return { width: size[0], height: size[1], at: (x, y) => { const o = (y * size[0] + x) * 16; return [file.readFloatLE(o), file.readFloatLE(o + 4), file.readFloatLE(o + 8)]; } };
}
export const lum = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

export interface Image { width: number; height: number; rgba: Uint8Array; channels: number }
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
/** The object-ID target (#378): pick ID r + 2^8 g + 2^16 b + 2^24 a, 0 where nothing draws. */
export interface Ids { width: number; height: number; at: (x: number, y: number) => string | null; count: Map<string, number> }
export function readIds(out: string, f: ViewFrame, what: string): Ids {
  const png = decodePng(readNamed(out, f.ids, 'png', what));
  expect(f.picks, `${what}: the frame names the item each pick ID stands for`).not.toBeNull();
  const items: (string | null)[] = new Array(png.width * png.height);
  const count = new Map<string, number>();
  for (let i = 0; i < items.length; i++) {
    const o = i * 4;
    const pick = (png.rgba[o]! + png.rgba[o + 1]! * 256 + png.rgba[o + 2]! * 65_536 + png.rgba[o + 3]! * 16_777_216) >>> 0;
    const id = pick === 0 ? null : f.picks!.get(pick) ?? `unknown:${pick}`;
    items[i] = id;
    if (id) count.set(id, (count.get(id) ?? 0) + 1);
  }
  return { width: png.width, height: png.height, count, at: (x, y) => (x < 0 || y < 0 || x >= png.width || y >= png.height ? null : items[Math.floor(y) * png.width + Math.floor(x)]!) };
}
/** Whether every pixel within `r` px of (x, y) shows `id`: away from its silhouette, where MSAA mixes parts. */
export function insideAt(ids: Ids, id: string, x: number, y: number, r: number): boolean {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (ids.at(x + dx, y + dy) !== id) return false;
  return true;
}

// PNG written by the suite (no filter, zlib level 9), so the same pixels give the same SHA-256.
function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}
export function encodePng(image: Image): Buffer {
  const raw = Buffer.alloc((image.width * 3 + 1) * image.height);
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const o = (y * image.width + x) * 4; const r = y * (image.width * 3 + 1) + 1 + x * 3;
    raw[r] = image.rgba[o]!; raw[r + 1] = image.rgba[o + 1]!; raw[r + 2] = image.rgba[o + 2]!;
  }
  const h = Buffer.alloc(13); h.writeUInt32BE(image.width, 0); h.writeUInt32BE(image.height, 4); h[8] = 8; h[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', h), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))]);
}
/** Images laid left to right, top-aligned. */
export function sideBySide(images: Image[]): Image {
  const width = images.reduce((s, im) => s + im.width, 0); const height = Math.max(...images.map((im) => im.height));
  const rgba = new Uint8Array(width * height * 4);
  let x0 = 0;
  for (const im of images) {
    for (let y = 0; y < im.height; y++) rgba.set(im.rgba.subarray(y * im.width * 4, (y + 1) * im.width * 4), (y * width + x0) * 4);
    x0 += im.width;
  }
  return { width, height, rgba, channels: 4 };
}

// ---------------------------------------------------------------------------------------------------
// The fixtures

/** A `subsurface` field (README: Assumed surfaces, 1): the issue's Fields block, as given on `material@1`. */
export interface Subsurface { weight: number; color?: [number, number, number, number]; radius?: V3; thin?: boolean }

/** AC1's slab: 1 cm thick, 40 cm square, its front face at z = 0 facing +Z, seen straight on from 1 m at a fov that
 * spans 0.2 m across the frame, so each pixel is 0.2 m ÷ width in the slab's plane; white, no specular (the frame is
 * its diffuse alone), under a black sky, lit only by the thin line of light along y through x = 0. */
export const SLAB = {
  /** The camera's distance to the slab's front face, and the field across the frame there (m). */
  distance: 1, span: 0.2,
  /** The line: a `light.area@1` rect 0.2 mm across (x) and 0.4 m along (y), 1 mm in front of the slab, facing it. */
  lineWidth: 0.0002, lineLength: 0.4, lineHeight: 0.001, linePower: 0.005,
  /** The criterion's mean free paths, red and green; blue isn't judged. */
  radius: [0.005, 0.001, 0.001] as V3,
};
export const SLAB_FOV = (2 * Math.atan(SLAB.span / 2 / SLAB.distance) * 180) / Math.PI;
export const SLAB_BASE: JsonObject = { base_color: [1, 1, 1, 1], metallic: 0, roughness: 1, specular_level: 0 };
export function slabDoc(name: string, size: number, subsurface: Subsurface | null): JsonObject {
  return sessionDoc(`slab-${name}`, [size, size], {
    cam: camera([0, 0, SLAB.distance], [0, 0, 0], SLAB_FOV),
    sky: DARK_SKY,
    slab_white: material(subsurface ? { ...SLAB_BASE, subsurface: subsurface as unknown as JsonObject } : SLAB_BASE),
    slab: box([0.4, 0.4, 0.01], [0, 0, -0.005], 'slab_white'),
    line: {
      kind: 'light.area@1', params: { shape: 'rect', size: [SLAB.lineWidth, SLAB.lineLength], power: SLAB.linePower, color: [1, 1, 1], range: 10, shadow: false },
      at: { pos: [0, 0, SLAB.lineHeight] },
    },
  });
}

/** AC2's skin sphere before a white wall: a 5 cm ball of skin (subsurface at its defaults, skin's mean free paths)
 * 1 cm in front of a white wall, both lit by one π lx sun along the view, seen from 0.5 m. */
export const WALL_SIZE: [number, number] = [480, 480];
export const SKIN_BASE: JsonObject = { base_color: [0.8, 0.45, 0.35, 1], metallic: 0, roughness: 0.5 };
export function wallDoc(name: string, withLobe: boolean): JsonObject {
  return sessionDoc(`wall-${name}`, WALL_SIZE, {
    cam: camera([0, 0, 0.5], [0, 0, 0], 20),
    sky: DARK_SKY,
    sun: sun(Math.PI, [0, 0, 0], false),
    skin: material(withLobe ? { ...SKIN_BASE, subsurface: { weight: 1 } } : SKIN_BASE),
    white: material({ base_color: [1, 1, 1, 1], metallic: 0, roughness: 0.5 }),
    ball: ball(0.05, [0, 0, 0], 'skin'),
    wall: box([0.4, 0.4, 0.01], [0, 0, -0.065], 'white'),
  });
}

/** AC3's fin: a 20 cm square slab `thickness` m thick at the origin, facing +Z, backlit by the key sun (π lx, shadowed)
 * shining along +Z toward the camera 1 m in front, whose 6° field the fin fills. */
export const FIN_SIZE: [number, number] = [256, 256];
export const FIN_RADIUS: V3 = [0.012, 0.008, 0.005];
export function finDoc(name: string, thickness: number): JsonObject {
  return sessionDoc(`fin-${name}`, FIN_SIZE, {
    cam: camera([0, 0, 1], [0, 0, 0], 6),
    sky: DARK_SKY,
    key: sun(Math.PI, [0, 180, 0], true),
    fin_white: material({ base_color: [1, 1, 1, 1], metallic: 0, roughness: 0.5, specular_level: 0, subsurface: { weight: 1, radius: FIN_RADIUS, thin: true } }),
    fin: box([0.2, 0.2, thickness], [0, 0, 0], 'fin_white'),
  });
}

/** Each document drawn once at its size, its linear, final and ID targets read. */
export interface Drawn { name: string; linear: Linear; final: Buffer; ids: Ids; finalName: string; linearName: string }
export function draw(bin: string, out: string, docs: { name: string; doc: JsonObject }[], planted?: GpuPlanted, view: JsonObject = PLAIN_LOOK): Drawn[] {
  const size = (d: JsonObject): [number, number] => d['size'] as [number, number];
  const replies = runGpu(bin, out, docs.map((d) => view3dCall({ doc: writeJson(out, d.name, d.doc), look: view, size: size(d.doc), targets: ['final', 'linear', 'ids'] })), planted);
  return replies.map((r, i) => {
    const { name, doc } = docs[i]!;
    const f = frame0(r, name);
    return {
      name, linear: readLinear(out, f.linear, size(doc), `${name}: linear`), final: readNamed(out, f.final, 'png', `${name}: final`), ids: readIds(out, f, `${name}: ids`),
      finalName: f.final!, linearName: f.linear!,
    };
  });
}

/** The furnace's own check: its background reads radiance 1 within 1%, else nothing it reads counts (#422). */
export function furnaceBackground(d: Drawn): string[] {
  let worst = 0; let at = '';
  for (let y = 0; y < d.ids.height; y += 4) for (let x = 0; x < d.ids.width; x += 4) {
    if (d.ids.at(x, y) !== null) continue;
    for (const v of d.linear.at(x, y)) if (Math.abs(v - 1) > worst) { worst = Math.abs(v - 1); at = `(${x}, ${y})`; }
  }
  return worst > 0.01 ? [`${d.name}: the furnace's background isn't radiance 1 within 1% (${(worst * 100).toFixed(2)}% off at ${at})`] : [];
}
/** In the furnace, no pixel of `item` above 1.01 in any channel (pbrt-v4's pass rule, as #422 ported it), and the item
 * lit at all: its mean luminance at least 0.5, so the bound can't pass on a part the furnace doesn't light. */
export function furnaceOver(d: Drawn, item: string): string[] {
  let worst = 0; let at = ''; let sum = 0; let n = 0;
  for (let y = 0; y < d.ids.height; y++) for (let x = 0; x < d.ids.width; x++) {
    if (d.ids.at(x, y) !== item) continue;
    const c = d.linear.at(x, y); const v = Math.max(c[0], c[1], c[2]);
    sum += lum(c); n++;
    if (v > worst) { worst = v; at = `(${x}, ${y})`; }
  }
  if (n < 500) return [`${d.name}: only ${n} pixels of ${item} drawn (500 needed)`];
  const out: string[] = [];
  if (worst > 1.01) out.push(`${d.name}: reflects more than it receives in the white furnace, ${worst.toFixed(4)} at ${at}`);
  if (sum / n < 0.5) out.push(`${d.name}: the furnace barely lights ${item}: mean luminance ${(sum / n).toFixed(4)}`);
  return out;
}
