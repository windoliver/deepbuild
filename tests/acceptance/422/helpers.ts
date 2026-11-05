// Test-side tools for the #422 acceptance tests: the base's `deep-gpu` binary (#377's GPU layer, with #378's
// `view3d`, #380's `golden` and `decide`, #386's `surface` and #421's shading core and light policy), built once per
// file and driven by JSON lines; the calls and fields this suite adds (README: Assumed surfaces); the documents the
// tests draw; the five-run timing rule (technical design: Every task carries its own budgets); and the reviewed CPU
// references the criteria are held to: #378's pinhole, a ray-sphere hit, the GGX lobe with height-correlated Smith
// visibility and its directional albedo by quadrature, glTF's metal and dielectric lobes with the design's
// multiple-scattering compensation on direct light, the cascades' closed form, PNG reading and writing (copied from
// #421's and #1174's helpers, since suites don't import each other). Nothing here stands in for the renderer, the
// environment, the light policy, the cascades or the golden under test.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/422 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text (README: Criteria to tests). */
export const AC = {
  1: 'AC1 #422.4c4893c7',
  2: 'AC2 #422.7daccf6e',
  3: 'AC3 #422.daf158a9',
  4: 'AC4 #422.05bcdd2b',
  5: 'AC5 #422.8976921a',
  6: 'AC6 #422.9d4b631c',
  7: 'AC7 #422.4f7bd0ec',
  8: 'AC8 #422.45d51ce0',
  9: 'AC9 #422.4f89df46',
  10: 'AC10 #422.99034ca1',
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
export const clone = <T extends JsonValue>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

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

/** Writes `value` as JSON under `dir` and returns its absolute path. */
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(value));
  return path;
}
/** A JSON file of the checkout (the castle, its look, the golden store), as committed. */
export function repoJson(path: string): JsonObject {
  let text: string;
  try { text = readFileSync(join(REPO, path), 'utf8'); } catch (e) { return expect.fail(`${path} is in the checkout (README: Assumed surfaces): ${(e as Error).message}`); }
  return obj(JSON.parse(text) as JsonValue, path);
}

// ---------------------------------------------------------------------------------------------------
// The machine

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** The reference Macs and their built-in displays (technical design: The reference Macs). */
export const REFERENCE_MACS: Record<string, [number, number]> = { 'Mac15,7': [3456, 2234], 'Mac15,12': [2560, 1664] };
/** The GPU layer draws these pixels on macOS's Metal device, the reference platform. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these pixels on macOS's Metal device; this is ${process.platform}`);
}
/** Goldens, GPU budgets and frame times count only on a reference Mac: off one, INCONCLUSIVE. Power and load are
 * not gated (the owner's rule). Returns the machine's display size, the showpiece's "full screen". */
export function requireReferenceMac(): [number, number] {
  requireMetal();
  let model: string | null = null;
  try { model = execFileSync('sysctl', ['-n', 'hw.model'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { model = null; }
  const display = model ? REFERENCE_MACS[model] : undefined;
  if (!display) inconclusive(`not a reference Mac (${Object.keys(REFERENCE_MACS).join(' or ')}): hw.model is ${model}`);
  return display;
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
    dir = mkdtempSync(join(tmpdir(), 'deep-422-bin-'));
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
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-422-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one JSON line in, one JSON line out (#377).

/** `deep-gpu --planted` names this suite adds, each a wrong program reachable only there (README: Planted programs). */
export type GpuPlanted =
  | 'draws_black' | 'drops_clouds' | 'cascade_cache_keeps_stale' | 'prefilter_over_frames'
  | 'uncompensated_lobe' | 'compensates_environment_only' | 'premixed_metallic';

interface Started { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }
function start(bin: string, args: string[], input: JsonValue, timeoutMs = 1_800_000): Started {
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify(input)}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${bin} ${args.join(' ')}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  const lines = stdout.split('\n').filter((line) => line !== '').map((line) => {
    try { return JSON.parse(line) as JsonValue; } catch { return line; }
  });
  return { status: run.status, signal: run.signal, timedOut, lines, stdout, stderr: run.stderr ?? '' };
}
/** One process: the calls in order, a reply per call. */
export function runGpu(bin: string, out: string, calls: JsonObject[], planted?: GpuPlanted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const name = `deep-gpu ${args.join(' ')}`;
  const s = start(bin, args, { out, calls });
  expect(s.timedOut, `${name} finished within its timeout`).toBe(false);
  expect(s.status, `${name} exited 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-3000)}`).toBe(0);
  expect(s.lines.length, `${name}: one output line per input line`).toBe(1);
  const answer = obj(s.lines[0], `${name}: the answer`);
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

const STATUS: JsonObject = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
/** A physical-basis `look@1` (#421's shape): `tone_map`, `exposure` and `bloom` as given. */
export function look(tone: { tone_map: 'none' | 'filmic'; exposure: number; bloom?: JsonObject }): JsonObject {
  return {
    id: `look-422-${tone.tone_map}${tone.bloom ? '-bloom' : ''}`, format: 1, basis: 'physical', license: 'Apache-2.0', description: 'A #422 acceptance look.',
    palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', stone: '#d9dde3', sand: '#e6d3a3' },
    roles: { ground: 'night', ink: 'graphite', muted: 'slate', stone: 'stone', sand: 'sand' },
    themes: { light: {}, dark: {} },
    fonts: {
      body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
      mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
    },
    tone_map: tone.tone_map, exposure: tone.exposure, finish: [], deband: 'none', bloom: tone.bloom ?? 'none', ground_3d: { kind: 'none' },
    status: { ...STATUS }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: 0.1,
    attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
  };
}
/** Tone map none at the exposure whose scale is 1 (#378's and #421's acceptance look): the linear-target tests. */
export const PLAIN_LOOK = look({ tone_map: 'none', exposure: -Math.log2(1.2) });
/** A filmic look with the shipped glow as bloom (#380's fixture values): the budget fixtures. */
export const BLOOM_LOOK = look({ tone_map: 'filmic', exposure: 0, bloom: { intensity: 0.3, radius: 0.85 } });
/** The same look with bloom off: AC2's control. */
export const NO_BLOOM_LOOK = look({ tone_map: 'filmic', exposure: 0 });

/** Writer texts as deep-show's shared documents write them: kind, then ID. */
export const AGENT = 'agent:sess-alpha';
/** A scene document as a session holds it (#378): an `id`, writer layers (layer ID → writer), every item in one of
 * them (the first unless the item names its `layer`). */
export function sessionDoc(id: string, size: [number, number], items: Record<string, JsonObject>, extra: JsonObject = {},
  layers: Record<string, string> = { main: AGENT }): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  const first = Object.keys(layers)[0]!;
  for (const [key, item] of Object.entries(items)) {
    withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: first, ...item };
  }
  const layerMap: JsonObject = {};
  let k = 0;
  for (const [layer, writer] of Object.entries(layers)) layerMap[layer] = { writer, title: layer, order: `a${k++}` };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #422 acceptance fixture.`, size, camera: 'cam', transport: { span: '10s' },
    requires: { modules: { scene3d: '^1' } }, layers: layerMap, ...extra, items: withIds,
  };
}

export type V3 = [number, number, number];
export type Rgb = [number, number, number];
export const box = (size: V3, at: JsonObject, extra: JsonObject = {}): JsonObject => ({ kind: 'mark.box@1', params: { size }, at, ...extra });
export const camera = (position: V3, target: V3, fov = 40, extra: JsonObject = {}): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov, ...extra } });
/** A camera orbiting `target` at `rate` degrees a second (a channel on its azimuth, as #380's fixtures orbit). */
export function orbiting(target: V3, distance: number, elevation: number, rate: number, span: number): { cam: JsonObject; channels: JsonObject } {
  return {
    cam: { kind: 'camera@1', params: { projection: 'perspective', target, orbit: { azimuth: 30, elevation, distance }, fov: 45, near: 0.1, far: 2000 } },
    channels: { spin: { target: 'items/cam/params/orbit/azimuth', type: 'f32', keys: { k0: { t: '0s', value: 30, interp: 'linear' }, k1: { t: `${span}s`, value: 30 + rate * span, interp: 'linear' } } } },
  };
}
/** A `material@1` item (Material): the fields given over the design's defaults. */
export const material = (params: JsonObject): JsonObject => ({ kind: 'material@1', params });
/** A smooth `ball@1` (Builder: `ball {radius, segments}`), 256 segments so its normals are the sphere's. */
export const ball = (radius: number, pos: V3, mat: string): JsonObject => ({ kind: 'ball@1', params: { radius, segments: 256 }, at: { pos }, material: mat });
/** A key sun (`light.sun@1`, shining along its own −Z, aimed by `at.rot`). */
export const sun = (illuminance: number, rot: V3, params: JsonObject = {}): JsonObject =>
  ({ kind: 'light.sun@1', params: { illuminance, color: [1, 1, 1], shadow: false, ...params }, at: { rot } });
/** The white furnace (README: Assumed surfaces): a sky whose gradient is white at both ends, no ambient gradient,
 * and the environment prefiltered from it at intensity 1, so the environment's radiance is 1 in every direction. */
export const FURNACE_SKY: JsonObject = {
  kind: 'sky@1',
  params: { top: [1, 1, 1, 1], low: [1, 1, 1, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0], environment: { from: 'sky', intensity: 1 } },
};
/** A black sky with no ambient and no environment: a sun is the only light. */
export const DARK_SKY: JsonObject = { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } };

// ---------------------------------------------------------------------------------------------------
// view3d (#378) and what this suite adds to it

export interface View3d {
  doc: string; look: JsonObject; size: [number, number]; frames?: number; fps?: number; from?: number;
  capture?: 'every' | number[]; targets?: ('final' | 'linear' | 'ids')[]; timings?: boolean;
  surface?: { internal_scale: number }; patches?: JsonObject[];
  /** This suite's: pack folders the document's recipes expand from; layers hidden (session state); the cascades. */
  packs?: string[]; hidden?: string[]; cascades?: boolean;
}
export const view3dCall = (v: View3d): JsonObject => ({ call: 'view3d', ...(v as unknown as JsonObject) });
export interface ViewFrame {
  frame: number; final: string | null; linear: string | null; ids: string | null; picks: Map<number, string> | null;
  gpu_ms: number | null; gpu_bytes: number | null; splits: number[] | null; notices: JsonObject[];
}
const optStr = (v: JsonValue | undefined, what: string): string | null => (v === undefined || v === null ? null : str(v, what));
const optNum = (v: JsonValue | undefined, what: string): number | null => (v === undefined || v === null ? null : num(v, what));
export function framesOf(reply: JsonObject, what: string): ViewFrame[] {
  answered(reply, what);
  return arr(reply['frames'], `${what}: frames`).map((v, i): ViewFrame => {
    const f = obj(v, `${what}: frames[${i}]`); const at = `${what}: frames[${i}]`;
    let picks: Map<number, string> | null = null;
    if (isObject(f['picks'])) picks = new Map(Object.entries(f['picks']).map(([k, id]) => [Number(k), str(id, `${at}.picks[${k}]`)]));
    let splits: number[] | null = null;
    if (f['cascades'] !== undefined) splits = arr(obj(f['cascades'], `${at}.cascades`)['splits'], `${at}.cascades.splits`).map((s, j) => num(s, `${at}.cascades.splits[${j}]`));
    return {
      frame: num(f['frame'], `${at}.frame`), final: optStr(f['final'], `${at}.final`), linear: optStr(f['linear'], `${at}.linear`), ids: optStr(f['ids'], `${at}.ids`), picks,
      gpu_ms: optNum(f['gpu_ms'], `${at}.gpu_ms`), gpu_bytes: optNum(f['gpu_bytes'], `${at}.gpu_bytes`), splits,
      notices: arr(f['notices'] ?? [], `${at}.notices`).map((n, j) => obj(n, `${at}.notices[${j}]`)),
    };
  });
}
export function frameAt(frames: ViewFrame[], n: number, what: string): ViewFrame {
  const f = frames.find((x) => x.frame === n);
  expect(f, `${what}: frame ${n} is in the reply`).toBeDefined();
  return f!;
}
export const set = (id: string, path: string, value: JsonValue): JsonObject => ({ op: 'set', id, path: `items/${id}/${path}`, value });

// Targets: files the binary wrote, each named by its SHA-256 (#378).
export function readNamed(out: string, hash: string | null, ext: string, what: string): Buffer {
  expect(hash, `${what} is written, named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${hash}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}
/** The linear target as read back (#378): little-endian f32 RGBA, rows top-down, `w × h × 16` bytes, before exposure. */
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
export const readPng = (out: string, hash: string | null, what: string): Image => decodePng(readNamed(out, hash, 'png', what));
/** The pixel hash a golden holds (README: Assumed surfaces): SHA-256 of the RGBA8 bytes, rows top-down. */
export const pixelHash = (image: Image): string => sha256(image.rgba);
/** The share of pixels whose channels differ by more than 2 codes between two equal-sized images. */
export function changedShare(a: Image, b: Image): number {
  let n = 0;
  for (let i = 0; i < a.rgba.length; i += 4) {
    if (Math.abs(a.rgba[i]! - b.rgba[i]!) > 2 || Math.abs(a.rgba[i + 1]! - b.rgba[i + 1]!) > 2 || Math.abs(a.rgba[i + 2]! - b.rgba[i + 2]!) > 2) n++;
  }
  return n / (a.width * a.height);
}

/** The object-ID target (#378): pick ID r + 2^8 g + 2^16 b + 2^24 a, 0 where nothing draws. */
export interface Ids { width: number; height: number; at: (x: number, y: number) => string | null; count: Map<string, number> }
export function readIds(out: string, f: ViewFrame, what: string): Ids {
  const png = decodePng(readNamed(out, f.ids, 'png', what));
  expect(png.channels, `${what} is an RGBA PNG`).toBe(4);
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
/** The pixels of `id` whose every neighbour within `r` px is `id` too (away from the silhouette). */
export function inside(ids: Ids, id: string, r: number): [number, number][] {
  const out: [number, number][] = [];
  for (let y = 0; y < ids.height; y++) for (let x = 0; x < ids.width; x++) {
    if (ids.at(x, y) !== id) continue;
    let all = true;
    for (let dy = -r; dy <= r && all; dy++) for (let dx = -r; dx <= r && all; dx++) if (ids.at(x + dx, y + dy) !== id) all = false;
    if (all) out.push([x, y]);
  }
  return out;
}

// PNG and animated PNG written by the suite (no filter, zlib level 9), so the same pixels give the same SHA-256.
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
/** An animated PNG of equal-sized frames at `fps`, looping: the castle's recording. */
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
/** Images laid left to right on a black strip, top-aligned. */
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
// `golden` and `decide` (#380), with this suite's pixel-hash oracle

/** The castle's goldens, committed under this folder of the checkout (README: The castle and its goldens). */
export const GOLDEN_STORE = join(REPO, 'tests', 'goldens', '422');
export const goldenCall = (fixture: string, png: string): JsonObject => ({ call: 'golden', store: GOLDEN_STORE, fixture, png, oracle: 'hash' });
export interface Golden { verdict: string; reason: string | null; numbers: JsonObject | null; oracle: string | null }
export function goldenOf(reply: JsonObject, what: string): Golden {
  expect(reply['code'], `${what}: the golden call was answered, not refused: ${shown(reply)}`).toBeUndefined();
  const verdict = str(reply['verdict'], `${what}: verdict`);
  expect(['PASS', 'FAIL', 'BLOCKED', 'INCONCLUSIVE'], `${what}: verdict is one of the four`).toContain(verdict);
  return {
    verdict, reason: typeof reply['reason'] === 'string' ? reply['reason'] : null,
    numbers: isObject(reply['numbers']) ? reply['numbers'] : null, oracle: typeof reply['oracle'] === 'string' ? reply['oracle'] : null,
  };
}

// ---------------------------------------------------------------------------------------------------
// The castle (README: The castle and its goldens)

export const CASTLE = 'packs/examples/castle.json';
export const CASTLE_LOOK = 'packs/examples/castle.look.json';
export const CASTLE_PACKS = [join(REPO, 'packs', 'composites-1.0.0')];
export const CASTLE_FPS = 30;
export interface Sample { k: number; frame: number; t: string }
/** The castle as committed, its look, its size, its span and its four sampled times (the quarter-turns of its orbit at
 * 30 fps); the description's own facts checked: floating islands, one sky, clouds, the showpiece class. */
export function castle(): { doc: string; look: JsonObject; size: [number, number]; seconds: number; samples: Sample[] } {
  const d = repoJson(CASTLE);
  const items = Object.values(obj(d['items'], `${CASTLE}: items`)).map((v) => obj(v, `${CASTLE}: an item`));
  const kinds = items.map((i) => str(i['kind'], `${CASTLE}: an item's kind`));
  expect(kinds.filter((k) => k === 'composites.island@1').length, `${CASTLE}: the castle stands on floating islands (two or more composites.island@1)`).toBeGreaterThanOrEqual(2);
  expect(kinds.filter((k) => k === 'sky@1').length, `${CASTLE}: one sky@1`).toBe(1);
  expect(kinds.some((k) => k === 'puff@1' || k === 'composites.cloud_bank@1'), `${CASTLE}: clouds (puff@1 or composites.cloud_bank@1 items)`).toBe(true);
  expect(isObject(d['budget']) ? d['budget']['class'] : undefined, `${CASTLE}: names the showpiece class`).toBe('showpiece');
  const span = /^(\d+(?:\.\d+)?)s$/.exec(str(obj(d['transport'], `${CASTLE}: transport`)['span'], `${CASTLE}: transport.span`));
  expect(span, `${CASTLE}: transport.span is one turn of the orbit in seconds, such as "12s"`).not.toBeNull();
  const seconds = Number(span![1]);
  const frames = seconds * CASTLE_FPS;
  expect(Number.isInteger(frames / 4), `${CASTLE}: its span (${seconds} s) is a whole number of frames at ${CASTLE_FPS} fps, divisible by 4`).toBe(true);
  const size = arr(d['size'], `${CASTLE}: size`).map((v, i) => num(v, `${CASTLE}: size[${i}]`)) as [number, number];
  const samples = [0, 1, 2, 3].map((k) => ({ k, frame: (k * frames) / 4, t: `${(k * seconds) / 4}s` }));
  return { doc: join(REPO, CASTLE), look: repoJson(CASTLE_LOOK), size, seconds, samples };
}

// ---------------------------------------------------------------------------------------------------
// The timing rule (technical design: Every task carries its own budgets): five runs after a warm-up; PASS when all
// five are within the limit, FAIL when all five are over it by more than the margin (the larger of 5% and the runs'
// spread), otherwise INCONCLUSIVE with all five.

export const RUNS = 5;
export function percentile(values: number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!;
}
export function judge(name: string, runs: number[], limit: number): void {
  const margin = Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9));
  const line = `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(line);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${line}`).toBe(false);
  inconclusive(line);
}
/** The showpiece and the window budgets (canvas primitives: The cost model). */
export const SHOWPIECE_GPU_MS = 10;
export const WINDOW_GPU_MS = 2;
export const GPU_BYTES = 256 * 1_000_000;

// ---------------------------------------------------------------------------------------------------
// Reviewed references: vectors, the transform order (Units and axes), #378's pinhole, a ray-sphere hit.

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
/** The direction toward a sun aimed by `rot` (it shines along its own −Z). */
export const towardSun = (rot: V3): V3 => scale(rotate(rot, [0, 0, -1]), -1);

/** #378's pinhole: position, target, +Y up, fov across the wider side. */
export interface Pinhole { position: V3; target: V3; fov: number; size: [number, number] }
function basis(cam: Pinhole): { f: V3; r: V3; u: V3; focal: number } {
  const f = unit(sub(cam.target, cam.position));
  const r = unit(cross(f, [0, 1, 0]));
  return { f, r, u: cross(r, f), focal: Math.max(...cam.size) / 2 / Math.tan(rad(cam.fov) / 2) };
}
export const focalOf = (cam: Pinhole): number => basis(cam).focal;
/** The unit ray through pixel (px, py)'s centre. */
export function pixelRay(cam: Pinhole, px: number, py: number): V3 {
  const { f, r, u, focal } = basis(cam);
  return unit(add(add(f, scale(r, (px + 0.5 - cam.size[0] / 2) / focal)), scale(u, -(py + 0.5 - cam.size[1] / 2) / focal)));
}
/** The solid angle of pixel (px, py) of the pinhole, in sr. */
export function pixelSolidAngle(cam: Pinhole, px: number, py: number): number {
  const focal = focalOf(cam);
  const dx = (px + 0.5 - cam.size[0] / 2) / focal; const dy = (py + 0.5 - cam.size[1] / 2) / focal;
  return Math.pow(1 + dx * dx + dy * dy, -1.5) / (focal * focal);
}
/** Where a ray from `o` along unit `d` first meets the sphere at `c` of radius `r`, or null. */
export function hitSphere(o: V3, d: V3, c: V3, r: number): V3 | null {
  const oc = sub(o, c); const b = dot(oc, d); const disc = b * b - (dot(oc, oc) - r * r);
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? add(o, scale(d, t)) : null;
}

// ---------------------------------------------------------------------------------------------------
// The lobes: GGX with height-correlated Smith visibility, α = roughness² (glTF 2.0, Appendix B), and the design's
// compensation (Material: "× (1 + F0 × (1 ÷ E − 1)) on direct light, with E the table's directional albedo").

export function ggxD(nh: number, a: number): number { const a2 = a * a; const d = nh * nh * (a2 - 1) + 1; return a2 / (Math.PI * d * d); }
export function smithV(nl: number, nv: number, a: number): number {
  const a2 = a * a;
  return 0.5 / (nl * Math.sqrt(nv * nv * (1 - a2) + a2) + nv * Math.sqrt(nl * nl * (1 - a2) + a2));
}
/** E(μo, α): the directional albedo of the GGX lobe with F = 1, by a 1024 × 64 midpoint rule over the half vector,
 * importance-mapped by D (h's pdf is D(h)·(n·h)). At α = 1 and μo = 1 it is 1 − ln 2. */
export function albedo(mu: number, a: number): number {
  if (a <= 0) return 1;
  const NU = 1024; const NP = 64; const a2 = a * a;
  const v: V3 = [Math.sqrt(Math.max(0, 1 - mu * mu)), 0, mu];
  let sum = 0;
  for (let j = 0; j < NU; j++) {
    const u = (j + 0.5) / NU;
    const c2 = (1 - u) / (1 + (a2 - 1) * u); const ct = Math.sqrt(c2); const st = Math.sqrt(Math.max(0, 1 - c2));
    for (let k = 0; k < NP; k++) {
      const phi = (2 * Math.PI * (k + 0.5)) / NP;
      const h: V3 = [st * Math.cos(phi), st * Math.sin(phi), ct];
      const vh = dot(v, h); if (vh <= 0) continue;
      const nl = 2 * vh * h[2] - v[2]; if (nl <= 0) continue;
      sum += (smithV(nl, mu, a) * nl * 4 * vh) / ct;
    }
  }
  return sum / (NU * NP);
}
/** E(μo) for one α, tabulated at 129 μo and read linearly. */
export function albedoTable(a: number): (mu: number) => number {
  const N = 128;
  const t = Array.from({ length: N + 1 }, (_, i) => albedo(Math.max(i / N, 5e-4), a));
  return (mu) => { const x = Math.min(Math.max(mu, 0), 1) * N; const i = Math.min(Math.floor(x), N - 1); return t[i]! + (t[i + 1]! - t[i]!) * (x - i); };
}
/** A material's lobe fields as the references read them (linear base color). */
export interface Lobe { base: Rgb; metallic: number; roughness: number }
/** f(l, v) × (n·l) of the glTF BRDF, its metal and dielectric lobes each shaded and then mixed by metallic, with the
 * specular lobes compensated on direct light. The dielectric's F0 is 0.04 (specular level 0.5, specular color white),
 * its diffuse Lambertian, weighted by 1 − F(v·h) (glTF's fresnel_mix). `E` is the lobe's albedo table. */
export function brdfCos(m: Lobe, n: V3, v: V3, l: V3, E: (mu: number) => number): Rgb {
  const nl = dot(n, l); const nv = dot(n, v);
  if (nl <= 0 || nv <= 0) return [0, 0, 0];
  const h = unit(add(l, v)); const vh = Math.max(dot(v, h), 0); const nh = Math.max(dot(n, h), 0);
  const a = m.roughness * m.roughness;
  const spec = ggxD(nh, a) * smithV(nl, nv, a);
  const e = E(nv); const w = Math.pow(1 - vh, 5);
  const fd = 0.04 + 0.96 * w;
  return [0, 1, 2].map((c) => {
    const base = m.base[c]!;
    const dielectric = (1 - fd) * (base / Math.PI) + fd * spec * (1 + 0.04 * (1 / e - 1));
    const metal = (base + (1 - base) * w) * spec * (1 + base * (1 / e - 1));
    return ((1 - m.metallic) * dielectric + m.metallic * metal) * nl;
  }) as Rgb;
}

/** The sphere fixture every furnace and sun test draws: one ball of radius 1 at the origin, seen from 6 m on +Z. */
export const SPHERE_SIZE: [number, number] = [320, 320];
export const SPHERE_CAM: Pinhole = { position: [0, 0, 6], target: [0, 0, 0], fov: 30, size: SPHERE_SIZE };
/** A document of one ball in `mat` under `sky` (and `light`, if any), with an object ID per item. */
export function sphereDoc(name: string, matId: string, mat: JsonObject, sky: JsonObject, light: JsonObject | null): JsonObject {
  return sessionDoc(`sphere-${name}`, SPHERE_SIZE, {
    cam: camera(SPHERE_CAM.position, SPHERE_CAM.target, SPHERE_CAM.fov, { near: 0.1, far: 100 }),
    sky,
    [matId]: material(mat),
    ball: ball(1, [0, 0, 0], matId),
    ...(light ? { sun: light } : {}),
  });
}
/** Renders each document once at `SPHERE_SIZE` and reads its linear, final and ID targets. */
export interface Drawn { linear: Linear; final: Image; ids: Ids }
export function drawSpheres(bin: string, out: string, docs: JsonObject[], planted?: GpuPlanted, look: JsonObject = PLAIN_LOOK): Drawn[] {
  const replies = runGpu(bin, out, docs.map((d, i) => view3dCall({ doc: writeJson(out, `sphere-${i}`, d), look, size: SPHERE_SIZE, frames: 1, capture: [0], targets: ['final', 'linear', 'ids'] })), planted);
  return replies.map((r, i) => {
    const f = frameAt(framesOf(r, `render ${i}`), 0, `render ${i}`);
    return { linear: readLinear(out, f.linear, SPHERE_SIZE, `render ${i}: linear`), final: readPng(out, f.final, `render ${i}: final`), ids: readIds(out, f, `render ${i}: ids`) };
  });
}
/** The furnace's own check: its background reads the environment's radiance, 1, within 1% (else the fixture isn't a
 * white furnace and nothing it reads counts). */
export function furnaceBackground(d: Drawn, what: string): string[] {
  let worst = 0; let at = '';
  for (let y = 0; y < d.ids.height; y += 4) for (let x = 0; x < d.ids.width; x += 4) {
    if (d.ids.at(x, y) !== null) continue;
    const c = d.linear.at(x, y);
    for (const v of c) if (Math.abs(v - 1) > worst) { worst = Math.abs(v - 1); at = `(${x}, ${y}) reads [${c.map((k) => k.toFixed(4)).join(', ')}]`; }
  }
  return worst > 0.01 ? [`${what}: the furnace's background isn't radiance 1 within 1%: ${at}`] : [];
}

// ---------------------------------------------------------------------------------------------------
// The cascades' closed form (Light policy: cascades): the practical split scheme, λ = split.

/** The N + 1 split distances along the view axis from `near` to `far`: λ·n·(f/n)^(i/N) + (1 − λ)·(n + (f − n)·i/N). */
export function closedSplits(near: number, far: number, n: number, lambda: number): number[] {
  return Array.from({ length: n + 1 }, (_, i) => lambda * near * Math.pow(far / near, i / n) + (1 - lambda) * (near + ((far - near) * i) / n));
}
