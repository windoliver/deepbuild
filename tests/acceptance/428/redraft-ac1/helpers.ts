// Test-side tools for the blind redraft of #428's AC1 (REDRAFT.md): the `deep-gpu` binary the base already has, built
// once per file and driven by JSON lines; the documents, looks and cameras the tests draw; the targets the renderer
// writes (linear f32, final PNG, object IDs); the three Khronos samples, pinned by commit and SHA-256, fetched on first
// use into an ignored cache and never committed; a reader of the samples' own glTF JSON and buffers, which the import
// and the CPU reference are held to; and an orthographic ray caster over a node's own triangles. Copied where #422's
// and #423's helpers have the same tool, since a suite imports nothing from outside its folder. Nothing here stands
// in for the importer or the renderer; the lobes' CPU reference is `lobes.ts`.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/428/redraft-ac1 is four levels down). */
export const REPO = join(HERE, '..', '..', '..', '..');

/** AC1's ID: the first 8 hex digits of SHA-256 of the criterion's text (REDRAFT.md: The criterion). */
export const AC1 = 'AC1 #428.df10ac08';

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${shown(value)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${shown(value)}`).toBe(true);
  return value as JsonValue[];
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${shown(value)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${shown(value)}`).toBe('string');
  return value as string;
}
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const SHA = /^[0-9a-f]{64}$/;
export const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';

/** No failures; the message lists them (at most 40). */
export function none(failures: readonly string[], what: string): void {
  const listed = failures.length > 40 ? [...failures.slice(0, 40), `… and ${failures.length - 40} more`] : failures;
  expect(failures, `${what}:\n  ${listed.join('\n  ')}`).toEqual([]);
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
/** A test whose inputs can't be had here (the network for a first fetch) fails with this, never passes. */
export function blocked(reason: string, unblock: string): never {
  expect.fail(`BLOCKED: ${reason}; to unblock: ${unblock}`);
}
/** The GPU layer draws these pixels on macOS's Metal device, the reference platform; off it, INCONCLUSIVE. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these pixels on macOS's Metal device; this is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// The build: deep-gpu built once per file (on macOS only: elsewhere every test is INCONCLUSIVE before it draws).

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
    if (process.platform !== 'darwin') return;
    dir = mkdtempSync(join(tmpdir(), 'deep-428-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(targetDir(), 'debug', exe('deep-gpu')), join(dir, exe('deep-gpu')));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `deep-gpu builds: cargo ${CARGO_ARGS.join(' ')}`).toBe('');
    return join(dir, exe('deep-gpu'));
  };
}
/** A fresh temporary folder per test (documents, assets, outputs), deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-428-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run`: one JSON line in ({out, calls}), one JSON line out ({ok, replies}) (#377).

export function runGpu(bin: string, out: string, calls: JsonObject[]): JsonObject[] {
  const name = 'deep-gpu run';
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 3_600_000, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${name}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  expect(timedOut, `${name} finished within its timeout`).toBe(false);
  expect(run.status, `${name} exited 0 (${run.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(run.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((line) => line !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(1);
  let answer: JsonValue;
  try { answer = JSON.parse(lines[0]!) as JsonValue; } catch { return expect.fail(`${name}: its answer is not JSON: ${lines[0]!.slice(0, 600)}`); }
  const a = obj(answer, `${name}: the answer`);
  expect(a['ok'], `${name} refused the scenario: ${shown(a)}`).toBe(true);
  const replies = arr(a['replies'], `${name}: replies`).map((r, i) => obj(r, `${name}: replies[${i}]`));
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
// Looks and documents (#378, #421, #422, #423)

const STATUS: JsonObject = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
/** #421's acceptance look: physical basis, tone map none at the exposure whose scale is 1, no bloom, no deband. */
export const PLAIN_LOOK: JsonObject = {
  id: 'look-428-plain', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'A #428 acceptance look.',
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
export function sessionDoc(id: string, size: [number, number], items: Record<string, JsonObject>): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) {
    withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  }
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #428 acceptance fixture.`, size, camera: 'cam', transport: { span: '2s' },
    requires: { modules: { scene3d: '^1' } }, layers: { main: { writer: 'agent:sess-alpha', title: 'Main', order: 'a0' } }, items: withIds,
  };
}

export type V3 = [number, number, number];
export type Rgb = [number, number, number];
/** A perspective `camera@1` (#378's pinhole: +Y up, fov across the wider side). */
export const perspective = (position: V3, target: V3, fov: number): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov, near: 0.1, far: 100 } });
/** An orthographic `camera@1` looking along −Z at `target`, `view_width` m across the frame (#423). */
export const ortho = (target: V3, viewWidth: number): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'orthographic', position: [target[0], target[1], target[2] + 20], target, view_width: viewWidth } });
export const material = (params: JsonObject): JsonObject => ({ kind: 'material@1', params });
/** A smooth `ball@1` (256 segments, so its normals are the sphere's) with uv0 by the sphere projection (Builder: uv:
 * u runs round the vertical axis, so the tangent, uv0's u direction, is horizontal). */
export const ball = (radius: number, pos: V3, mat: string): JsonObject =>
  ({ kind: 'ball@1', params: { radius, segments: 256, uv0: 'sphere' }, at: { pos }, material: mat });
/** A key sun (`light.sun@1`, shining along its own −Z, aimed by `at.rot` as Rz·Ry·Rx in degrees), casting no shadow. */
export const sun = (illuminance: number, rot: V3): JsonObject =>
  ({ kind: 'light.sun@1', params: { illuminance, color: [1, 1, 1], shadow: false }, at: { rot } });
/** #422's white furnace: a sky white at both ends, no ambient gradient, the environment prefiltered from it at
 * intensity 1, so its radiance is 1 in every direction and it is the only light. */
export const FURNACE_SKY: JsonObject = {
  kind: 'sky@1',
  params: { top: [1, 1, 1, 1], low: [1, 1, 1, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0], environment: { from: 'sky', intensity: 1 } },
};
/** #422's black sky: no ambient and no environment, so a sun is the only light. */
export const DARK_SKY: JsonObject = { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } };
/** A glTF file's whole scene 0 as one item (#423); each node drawn picks as `<item>#<node name or index>`. */
export const sceneAsset = (sha: string): JsonObject => ({ kind: 'mesh.asset@1', params: { sha256: sha, node: { scene: 0 } }, at: { pos: [0, 0, 0] } });
/** One node of a glTF file as its own item at `pos` (#423's redraft): its primitives with the materials they name. */
export const nodeAsset = (sha: string, node: string, pos: V3): JsonObject => ({ kind: 'mesh.asset@1', params: { sha256: sha, node }, at: { pos } });

export interface View3d {
  doc: string; look: JsonObject; size: [number, number];
  targets?: ('final' | 'linear' | 'ids')[];
  assets?: Record<string, string>; licenses?: Record<string, JsonObject>; imports?: boolean;
}
export const view3dCall = (v: View3d): JsonObject => ({ call: 'view3d', frames: 1, capture: [0], ...(v as unknown as JsonObject) });
export interface Frame { final: string | null; linear: string | null; ids: string | null; picks: Map<number, string> | null }
const optStr = (v: JsonValue | undefined, what: string): string | null => (v === undefined || v === null ? null : str(v, what));
/** Frame 0 of a view3d reply (#378). */
export function frame0(reply: JsonObject, what: string): Frame {
  answered(reply, what);
  const frames = arr(reply['frames'], `${what}: frames`).map((v, i) => obj(v, `${what}: frames[${i}]`));
  const f = frames.find((x) => x['frame'] === 0);
  expect(f, `${what}: frame 0 is in the reply`).toBeDefined();
  let picks: Map<number, string> | null = null;
  if (isObject(f!['picks'])) picks = new Map(Object.entries(f!['picks']).map(([k, id]) => [Number(k), str(id, `${what}.picks[${k}]`)]));
  return { final: optStr(f!['final'], `${what}.final`), linear: optStr(f!['linear'], `${what}.linear`), ids: optStr(f!['ids'], `${what}.ids`), picks };
}

// Targets: files the binary wrote, each named by its SHA-256 (#378).
export function readNamed(out: string, hash: string | null, ext: string, what: string): Buffer {
  expect(hash, `${what} is written, named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${hash}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}
/** The linear target as read back (#378): little-endian f32 RGBA, rows top-down, before exposure. */
export interface Linear { width: number; height: number; at: (x: number, y: number) => Rgb }
export function readLinear(out: string, f: Frame, size: [number, number], what: string): Linear {
  const file = readNamed(out, f.linear, 'f32', `${what}: linear`);
  expect(file.length, `${what}: linear holds ${size[0]} × ${size[1]} f32 RGBA pixels`).toBe(size[0] * size[1] * 16);
  return { width: size[0], height: size[1], at: (x, y) => { const o = (y * size[0] + x) * 16; return [file.readFloatLE(o), file.readFloatLE(o + 4), file.readFloatLE(o + 8)]; } };
}
export const lum = (c: readonly number[]): number => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;

export interface Image { width: number; height: number; rgba: Uint8Array; channels: number }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** Reads an 8-bit RGB or RGBA PNG with no interlace (the renderer's targets). */
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
export const readPng = (out: string, f: Frame, what: string): Image => decodePng(readNamed(out, f.final, 'png', `${what}: final`));
export function pixel(image: Image, x: number, y: number): Rgb {
  const o = (y * image.width + x) * 4;
  return [image.rgba[o]!, image.rgba[o + 1]!, image.rgba[o + 2]!];
}

/** The object-ID target (#378): pick ID r + 2^8 g + 2^16 b + 2^24 a, 0 where nothing draws. */
export interface Ids { width: number; height: number; at: (x: number, y: number) => string | null }
export function readIds(out: string, f: Frame, what: string): Ids {
  const png = decodePng(readNamed(out, f.ids, 'png', `${what}: ids`));
  expect(png.channels, `${what}: ids is an RGBA PNG`).toBe(4);
  expect(f.picks, `${what}: the frame names the item each pick ID stands for`).not.toBeNull();
  const items: (string | null)[] = new Array(png.width * png.height);
  for (let i = 0; i < items.length; i++) {
    const o = i * 4;
    const pick = (png.rgba[o]! + png.rgba[o + 1]! * 256 + png.rgba[o + 2]! * 65_536 + png.rgba[o + 3]! * 16_777_216) >>> 0;
    items[i] = pick === 0 ? null : f.picks!.get(pick) ?? `unknown:${pick}`;
  }
  return { width: png.width, height: png.height, at: (x, y) => (x < 0 || y < 0 || x >= png.width || y >= png.height ? null : items[Math.floor(y) * png.width + Math.floor(x)]!) };
}
/** Whether a pick names `item` or a node it draws (`<item>` for one node, `<item>#<node>` for a whole scene). */
export const picks = (id: string | null, item: string): boolean => id === item || (id !== null && id.startsWith(`${item}#`));
/** Whether pixel (x, y) and every pixel within `r` px of it (a square) show `item` (README: the 2 px rule). */
export function insideBy(ids: Ids, x: number, y: number, r: number, item: string): boolean {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (!picks(ids.at(x + dx, y + dy), item)) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------------
// The Khronos samples (KhronosGroup/glTF-Sample-Assets), pinned by commit and SHA-256, fetched on first use into the
// checkout's ignored `target/acceptance/428/khronos/` by hash, and never committed.

export const KHRONOS_COMMIT = 'edc7c9e67c639d230715049ee31f9a96a6babbbe';
interface Pin { path: string; sha256: string; size: number }
interface Sample { name: string; pin: Pin; license: JsonObject }
const CC0 = 'https://creativecommons.org/publicdomain/zero/1.0/legalcode';
const CCBY = 'https://creativecommons.org/licenses/by/4.0/legalcode';
export const SAMPLES = {
  SheenChair: {
    name: 'SheenChair',
    pin: { path: 'Models/SheenChair/glTF-Binary/SheenChair.glb', sha256: 'f0af2a2b102d28d540236306ae19f8fb36842df76bd38cf76f063f9bd2853399', size: 4125648 },
    license: { id: 'CC0-1.0', terms: CC0, shareable: true, credit: '© 2020 Wayfair, LLC; by Eric Chadwick (SheenChair, CC0 1.0)' },
  },
  AnisotropyStrengthTest: {
    name: 'AnisotropyStrengthTest',
    pin: { path: 'Models/AnisotropyStrengthTest/glTF-Binary/AnisotropyStrengthTest.glb', sha256: '306321ff8214727b145188ceb56d96d2882b393d0b596fa089fd20b07e959834', size: 94444 },
    license: { id: 'CC0-1.0', terms: CC0, shareable: true, credit: '2023, by Ed Mackey (AnisotropyStrengthTest, CC0 1.0)' },
  },
  DiffuseTransmissionTest: {
    name: 'DiffuseTransmissionTest',
    pin: { path: 'Models/DiffuseTransmissionTest/glTF-Binary/DiffuseTransmissionTest.glb', sha256: 'cac9152a1215177c479f33cc0f5d1b64f92010311d2316dc42dde87fa505e282', size: 238336 },
    license: { id: 'CC-BY-4.0', terms: CCBY, shareable: true, credit: '© 2025 Darmstadt Graphics Group GmbH; model and textures by Eric Chadwick (DiffuseTransmissionTest, CC BY 4.0); Khronos and glTF logos are Khronos Group trademarks' },
  },
} satisfies Record<string, Sample>;
export type SampleName = keyof typeof SAMPLES;

const CACHE = join(REPO, 'target', 'acceptance', '428', 'khronos');
/** One pinned file's bytes: from the cache by hash, else fetched once from the pinned commit and checked. */
async function pinned(pin: Pin): Promise<Buffer> {
  const file = join(CACHE, pin.sha256);
  if (existsSync(file)) {
    const bytes = readFileSync(file);
    if (sha256(bytes) === pin.sha256) return bytes;
  }
  const url = `https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/${KHRONOS_COMMIT}/${pin.path}`;
  let bytes: Buffer;
  try {
    const response = await fetch(url);
    if (!response.ok) return blocked(`fetching ${pin.path} at ${KHRONOS_COMMIT.slice(0, 10)} answered HTTP ${response.status}`, `reach ${url}`);
    bytes = Buffer.from(await response.arrayBuffer());
  } catch (e) {
    return blocked(`${pin.path} isn't cached and the network is unreachable (${(e as Error).message})`, `run once with the network, or place the file at ${file}`);
  }
  expect(sha256(bytes), `${pin.path} at ${KHRONOS_COMMIT.slice(0, 10)} has its pinned SHA-256`).toBe(pin.sha256);
  expect(bytes.length, `${pin.path} has its pinned size`).toBe(pin.size);
  mkdirSync(CACHE, { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, bytes);
  renameSync(temp, file);
  return bytes;
}
/** git's blob ID of `bytes` (SHA-1 of "blob <length>\0" and the bytes). */
const gitBlob = (bytes: Buffer): string => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
let tracked: Set<string> | null = null;
/** Every blob in HEAD's tree and in the index, by git's blob ID. */
function trackedBlobs(): Set<string> {
  if (tracked) return tracked;
  const ids = new Set<string>();
  const tree = execFileSync('git', ['ls-tree', '-r', 'HEAD'], { cwd: REPO, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  for (const line of tree.split('\n')) { const id = line.split(/\s+/)[2]; if (id) ids.add(id); }
  const index = execFileSync('git', ['ls-files', '-s'], { cwd: REPO, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  for (const line of index.split('\n')) { const id = line.split(/\s+/)[1]; if (id) ids.add(id); }
  tracked = ids;
  return ids;
}
export interface Fetched { name: SampleName; sha: string; assets: Record<string, string>; licenses: Record<string, JsonObject>; gltf: Gltf }
/** A sample, fetched by hash on first use, checked never committed, written under `dir` by hash for the product. */
export async function khronos(name: SampleName, dir: string): Promise<Fetched> {
  const sample: Sample = SAMPLES[name];
  const bytes = await pinned(sample.pin);
  expect(trackedBlobs().has(gitBlob(bytes)), `${sample.pin.path} is never committed: no blob in HEAD or the index has its bytes`).toBe(false);
  const sha = sha256(bytes);
  const path = join(dir, sha);
  writeFileSync(path, bytes);
  return { name, sha, assets: { [sha]: path }, licenses: { [sha]: sample.license }, gltf: readGlb(bytes) };
}

// ---------------------------------------------------------------------------------------------------
// The samples' own glTF: JSON and binary chunk, accessors, node world matrices, a node's triangles.

export interface Gltf { json: JsonObject; bin: Buffer }
export function readGlb(bytes: Buffer): Gltf {
  expect(bytes.subarray(0, 4).toString('latin1'), 'a GLB starts with its magic').toBe('glTF');
  const jsonLen = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLen).toString('utf8')) as JsonObject;
  const at = 20 + jsonLen;
  const bin = at + 8 <= bytes.length ? bytes.subarray(at + 8, at + 8 + bytes.readUInt32LE(at)) : Buffer.alloc(0);
  return { json, bin };
}
export const list = (g: Gltf, key: string): JsonObject[] => ((g.json[key] as JsonValue[] | undefined) ?? []) as JsonObject[];
const WIDTH: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
/** Accessor `i` as rows of numbers (floats, or unsigned integers as stored). */
export function accessor(g: Gltf, i: number): number[][] {
  const a = list(g, 'accessors')[i]!;
  const view = list(g, 'bufferViews')[a['bufferView'] as number]!;
  const off = (view['byteOffset'] as number | undefined) ?? 0;
  const bytes = g.bin.subarray(off, off + (view['byteLength'] as number));
  const w = WIDTH[a['type'] as string]!; const ct = a['componentType'] as number;
  const size = ct === 5126 || ct === 5125 ? 4 : ct === 5123 ? 2 : 1;
  const stride = (view['byteStride'] as number | undefined) ?? w * size;
  const base = (a['byteOffset'] as number | undefined) ?? 0;
  const read = (o: number): number => (ct === 5126 ? bytes.readFloatLE(o) : ct === 5125 ? bytes.readUInt32LE(o) : ct === 5123 ? bytes.readUInt16LE(o) : bytes[o]!);
  const rows: number[][] = [];
  for (let r = 0; r < (a['count'] as number); r++) rows.push(Array.from({ length: w }, (_, k) => read(base + r * stride + k * size)));
  return rows;
}
/** A 3 × 4 affine matrix, rows. */
export type M34 = [[number, number, number, number], [number, number, number, number], [number, number, number, number]];
const IDENTITY: M34 = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]];
function mul(a: M34, b: M34): M34 {
  return [0, 1, 2].map((i) => [0, 1, 2, 3].map((j) => a[i]![0]! * b[0]![j]! + a[i]![1]! * b[1]![j]! + a[i]![2]! * b[2]![j]! + (j === 3 ? a[i]![3]! : 0))) as M34;
}
export const apply = (m: M34, p: readonly number[]): V3 => [0, 1, 2].map((i) => m[i]![0]! * p[0]! + m[i]![1]! * p[1]! + m[i]![2]! * p[2]! + m[i]![3]!) as V3;
const applyLinear = (m: M34, p: readonly number[]): V3 => [0, 1, 2].map((i) => m[i]![0]! * p[0]! + m[i]![1]! * p[1]! + m[i]![2]! * p[2]!) as V3;
/** A node's local matrix, glTF's T × R × S (or its `matrix`, column-major). */
function localOf(n: JsonObject): M34 {
  if (Array.isArray(n['matrix'])) { const c = n['matrix'] as number[]; return [[c[0]!, c[4]!, c[8]!, c[12]!], [c[1]!, c[5]!, c[9]!, c[13]!], [c[2]!, c[6]!, c[10]!, c[14]!]]; }
  const [x, y, z, w] = (n['rotation'] as number[] | undefined) ?? [0, 0, 0, 1];
  const [sx, sy, sz] = (n['scale'] as number[] | undefined) ?? [1, 1, 1];
  const [tx, ty, tz] = (n['translation'] as number[] | undefined) ?? [0, 0, 0];
  const r = [
    [1 - 2 * (y! * y! + z! * z!), 2 * (x! * y! - z! * w!), 2 * (x! * z! + y! * w!)],
    [2 * (x! * y! + z! * w!), 1 - 2 * (x! * x! + z! * z!), 2 * (y! * z! - x! * w!)],
    [2 * (x! * z! - y! * w!), 2 * (y! * z! + x! * w!), 1 - 2 * (x! * x! + y! * y!)],
  ];
  const t = [tx!, ty!, tz!];
  return [0, 1, 2].map((i) => [r[i]![0]! * sx!, r[i]![1]! * sy!, r[i]![2]! * sz!, t[i]!]) as M34;
}
/** Every node of scene 0 with its world matrix (parent × local), as the file composes them. */
export function worlds(g: Gltf): Map<number, M34> {
  const nodes = list(g, 'nodes'); const out = new Map<number, M34>();
  const walk = (i: number, parent: M34): void => {
    const w = mul(parent, localOf(nodes[i]!)); out.set(i, w);
    for (const c of ((nodes[i]!['children'] as number[] | undefined) ?? [])) walk(c, w);
  };
  const scene = list(g, 'scenes')[(g.json['scene'] as number | undefined) ?? 0]!;
  for (const root of scene['nodes'] as number[]) walk(root, IDENTITY);
  return out;
}
/** The material a node's first primitive names. */
export const nodeMaterial = (g: Gltf, node: number): number =>
  (list(g, 'meshes')[list(g, 'nodes')[node]!['mesh'] as number]!['primitives'] as JsonObject[])[0]!['material'] as number;

/** One triangle of a node in world metres, with its vertex normals and (where the file has them) tangents. */
export interface Tri { p: [V3, V3, V3]; n: [V3, V3, V3]; t: [V3, V3, V3] | null }
/** Node `i`'s triangles in the world: positions by its world matrix, normals and tangents by its linear part (the
 * samples' nodes are translations or rotations, so that part is orthonormal). */
export function nodeTriangles(g: Gltf, i: number, world: M34): Tri[] {
  const mesh = list(g, 'meshes')[list(g, 'nodes')[i]!['mesh'] as number]!;
  const tris: Tri[] = [];
  for (const p of mesh['primitives'] as JsonObject[]) {
    const attrs = p['attributes'] as JsonObject;
    const pos = accessor(g, attrs['POSITION'] as number).map((q) => apply(world, q));
    const nor = accessor(g, attrs['NORMAL'] as number).map((q) => unit(applyLinear(world, q)));
    const tan = typeof attrs['TANGENT'] === 'number' ? accessor(g, attrs['TANGENT']).map((q) => unit(applyLinear(world, q))) : null;
    const idx = typeof p['indices'] === 'number' ? accessor(g, p['indices']).map((r) => r[0]!) : pos.map((_, k) => k);
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const [a, b, c] = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
      tris.push({ p: [pos[a]!, pos[b]!, pos[c]!], n: [nor[a]!, nor[b]!, nor[c]!], t: tan ? [tan[a]!, tan[b]!, tan[c]!] : null });
    }
  }
  return tris;
}

// ---------------------------------------------------------------------------------------------------
// Reviewed geometry: vectors, the transform order (Units and axes), #378's pinhole, #423's orthographic view, a ray
// caster over triangles seen orthographically from +Z.

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const unit = (a: readonly number[]): V3 => { const l = Math.hypot(a[0]!, a[1]!, a[2]!); return [a[0]! / l, a[1]! / l, a[2]! / l]; };
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
/** The unit direction toward a sun aimed by `rot` (it shines along its own −Z). */
export const towardSun = (rot: V3): V3 => scale(rotate(rot, [0, 0, -1]), -1);

/** #378's pinhole: position, target, +Y up, fov across the wider side. */
export interface Pinhole { position: V3; target: V3; fov: number; size: [number, number] }
/** The unit ray through pixel (px, py)'s centre. */
export function pixelRay(cam: Pinhole, px: number, py: number): V3 {
  const f = unit(sub(cam.target, cam.position));
  const r = unit(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const focal = Math.max(...cam.size) / 2 / Math.tan(rad(cam.fov) / 2);
  return unit(add(add(f, scale(r, (px + 0.5 - cam.size[0] / 2) / focal)), scale(u, -(py + 0.5 - cam.size[1] / 2) / focal)));
}
/** Where a ray from `o` along unit `d` first meets the sphere at `c` of radius `r`, or null. */
export function hitSphere(o: V3, d: V3, c: V3, r: number): V3 | null {
  const oc = sub(o, c); const b = dot(oc, d); const disc = b * b - (dot(oc, oc) - r * r);
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? add(o, scale(d, t)) : null;
}

/** #423's orthographic view (`ortho()`): looking along −Z at `target`, `viewWidth` m across `size[0]` px. */
export interface Ortho { target: V3; viewWidth: number; size: [number, number] }
/** The world x, y of pixel (x, y)'s centre. */
export function orthoWorld(o: Ortho, x: number, y: number): [number, number] {
  const k = o.size[0] / o.viewWidth;
  return [o.target[0] + (x + 0.5 - o.size[0] / 2) / k, o.target[1] - (y + 0.5 - o.size[1] / 2) / k];
}
/** What the nearest triangle shows at a pixel centre seen from +Z: its interpolated normal and tangent, unit. */
export interface Hit { n: V3; t: V3 | null }
/** A ray caster over `tris` for the view `o`: at each pixel centre, the triangle with the largest z there, its vertex
 * normals (and tangents) interpolated by the pixel centre's barycentric weights and normalized, as a rasterizer
 * interpolates them under an orthographic projection; triangles are binned by their pixel boxes into 8 px cells. */
export function orthoCaster(tris: Tri[], o: Ortho): (x: number, y: number) => Hit | null {
  const k = o.size[0] / o.viewWidth;
  const CELL = 8;
  const cols = Math.ceil(o.size[0] / CELL); const rows = Math.ceil(o.size[1] / CELL);
  const cells: number[][] = Array.from({ length: cols * rows }, () => []);
  const toPx = (p: V3): [number, number] => [o.size[0] / 2 + (p[0] - o.target[0]) * k, o.size[1] / 2 - (p[1] - o.target[1]) * k];
  tris.forEach((t, i) => {
    const q = t.p.map(toPx);
    const x0 = Math.max(0, Math.floor(Math.min(...q.map((v) => v[0])) / CELL)); const x1 = Math.min(cols - 1, Math.floor(Math.max(...q.map((v) => v[0])) / CELL));
    const y0 = Math.max(0, Math.floor(Math.min(...q.map((v) => v[1])) / CELL)); const y1 = Math.min(rows - 1, Math.floor(Math.max(...q.map((v) => v[1])) / CELL));
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) cells[cy * cols + cx]!.push(i);
  });
  const mix = (w: [number, number, number], v: [V3, V3, V3]): V3 => unit(add(add(scale(v[0], w[0]), scale(v[1], w[1])), scale(v[2], w[2])));
  return (x, y) => {
    if (x < 0 || y < 0 || x >= o.size[0] || y >= o.size[1]) return null;
    const [wx, wy] = orthoWorld(o, x, y);
    let best: Hit | null = null; let bestZ = -Infinity;
    for (const i of cells[Math.floor(y / CELL) * cols + Math.floor(x / CELL)]!) {
      const t = tris[i]!; const [a, b, c] = t.p;
      const d = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
      if (Math.abs(d) < 1e-14) continue;
      const l1 = ((wx - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (wy - a[1])) / d;
      const l2 = ((b[0] - a[0]) * (wy - a[1]) - (wx - a[0]) * (b[1] - a[1])) / d;
      const l0 = 1 - l1 - l2;
      if (l0 < -1e-9 || l1 < -1e-9 || l2 < -1e-9) continue;
      const z = l0 * a[2] + l1 * b[2] + l2 * c[2];
      if (z <= bestZ) continue;
      bestZ = z;
      const w: [number, number, number] = [l0, l1, l2];
      const n = mix(w, t.n);
      let tan: V3 | null = null;
      if (t.t) { const raw = mix(w, t.t); tan = unit(sub(raw, scale(n, dot(raw, n)))); }
      best = { n, t: tan };
    }
    return best;
  };
}
