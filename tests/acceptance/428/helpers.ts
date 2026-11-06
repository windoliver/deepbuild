// Test-side tools for the #428 acceptance tests: the base's `deep-gpu` binary (#377's GPU layer with #378's `view3d`,
// #421's shading core, #422's sky and environment, #423's glTF import, #425's light cut), built once per file and
// driven by JSON lines; the calls, fields and planted programs this suite adds (README: Assumed surfaces); the
// documents the tests draw; the Khronos samples fetched by hash into a cache outside the checkout; the per-sample check
// against `reference.ts`; and the five-run timing rule. Nothing here stands in for the renderer or the import.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, homedir, loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';
import {
  applyDir, decodePng, deg, gltfMaterial, imageBytes, list, nodeName, orthoPoint, quad, readGltf, sampleReference, trace, traceable, unit,
  worlds, type Gltf, type Image, type JsonObject, type JsonValue, type Ortho, type Rgb, type SunLight, type Texture, type Traced, type Tri,
  type V3,
} from './reference.ts';

export type { JsonObject, JsonValue };
const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/428 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text (README: Criteria to tests). */
export const AC = {
  1: 'AC1 #428.df10ac08',
  2: 'AC2 #428.7a966fa8',
  3: 'AC3 #428.1870c341',
  4: 'AC4 #428.f0dfcbc8',
  5: 'AC5 #428.657b57c7',
  6: 'AC6 #428.1da426e1',
  7: 'AC7 #428.b8f33c38',
  8: 'AC8 #428.d719d951',
  9: 'AC9 #428.8c47edc1',
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
/** A missing input: BLOCKED, with what unblocks it. */
export function blocked(reason: string, unblock: string): never {
  expect.fail(`BLOCKED: ${reason}; unblock: ${unblock}`);
}
/** The reference Macs and their built-in displays (technical design: The reference Macs). */
export const REFERENCE_MACS: Record<string, [number, number]> = { 'Mac15,7': [3456, 2234], 'Mac15,12': [2560, 1664] };
/** The GPU layer draws these pixels on macOS's Metal device; anywhere else the test is INCONCLUSIVE. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these pixels on macOS's Metal device; this is ${process.platform}`);
}
/** Budgets count only on a reference Mac: off one, INCONCLUSIVE. Returns its display size, the castle's "full screen". */
export function requireReferenceMac(): [number, number] {
  requireMetal();
  let model: string | null = null;
  try { model = execFileSync('sysctl', ['-n', 'hw.model'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { model = null; }
  const display = model ? REFERENCE_MACS[model] : undefined;
  if (!display) inconclusive(`not a reference Mac (${Object.keys(REFERENCE_MACS).join(' or ')}): hw.model is ${model}`);
  return display;
}
/** The one-minute load per core: above 1 the machine is loaded, and a timing that misses reads INCONCLUSIVE. */
export const loadPerCore = (): number => loadavg()[0]! / cpus().length;

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
export function useGpu(): () => string {
  let dir = ''; let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-428-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(targetDir(), 'debug', exe('deep-gpu')), join(dir, exe('deep-gpu')));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => { expect(error, `the binary builds: cargo ${CARGO_ARGS.join(' ')}`).toBe(''); return join(dir, exe('deep-gpu')); };
}
/** A fresh temporary folder per test, deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-428-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one JSON line in, one JSON line out (#377).

/** The wrong programs this suite plants, each reachable only through `--planted` (README: Planted programs). */
export type GpuPlanted =
  | 'drops_dispersion' | 'absorption_ignores_thickness' | 'transmission_ignores_roughness' | 'dispersion_samples_once'
  | 'specular_color_ignored' | 'iridescence_ignores_thickness' | 'diffuse_lambert' | 'oren_nayar_uncompensated'
  | 'retroreflection_ignored' | 'flakes_by_pixel';
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
export function look(tone: 'none' | 'filmic', exposure: number): JsonObject {
  return {
    id: `look-428-${tone}`, format: 1, basis: 'physical', license: 'Apache-2.0', description: 'A #428 acceptance look.',
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
/** Tone map none at the exposure whose scale is 1 (#378's and #421's acceptance look): linear and final targets. */
export const PLAIN_LOOK = look('none', -Math.log2(1.2));
/** A filmic look for the pictures a person judges (AC9). */
export const SHOW_LOOK = look('filmic', 0);

export function sessionDoc(id: string, size: [number, number], items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #428 acceptance fixture.`, size, camera: 'cam', transport: { span: '4s' },
    requires: { modules: { scene3d: '^1' } }, layers: { main: { writer: 'agent:sess-428', title: 'Main', order: 'a0' } }, ...extra, items: withIds,
  };
}
export const camera = (position: V3, target: V3, fov: number, extra: JsonObject = {}): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov, near: 0.05, far: 200, ...extra } });
/** An orthographic `camera@1` looking along −Z at the view's target, `view_width` m across (Camera `camera@1`). */
export const orthoCamera = (o: Ortho): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'orthographic', position: [o.target[0], o.target[1], o.target[2] + 50], target: o.target, view_width: o.viewWidth, near: 0.1, far: 200 } });
export const material = (params: JsonObject): JsonObject => ({ kind: 'material@1', params });
/** A smooth `ball@1` with uv0 about the sphere (Builder: uv), so the anisotropic lobe has uv0's u around the y axis. */
export const ball = (radius: number, pos: V3, mat: string): JsonObject => ({ kind: 'ball@1', params: { radius, segments: 256, uv0: 'sphere' }, at: { pos }, material: mat });
/** A `mark.box@1` of `size` centred on `pos`, turned by `rot`. */
export const box = (size: V3, pos: V3, mat: string, rot: V3 = [0, 0, 0]): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos, rot }, material: mat });
/** A sun (`light.sun@1`, shining along its own −Z, aimed by `at.rot`), casting no shadow. */
export const sun = (illuminance: number, rot: V3): JsonObject => ({ kind: 'light.sun@1', params: { illuminance, color: [1, 1, 1], shadow: false }, at: { rot } });
/** A point light (`light.point@1`) of `power` lm with no radius and a range that never fades it here. */
export const pointLight = (power: number, pos: V3): JsonObject => ({ kind: 'light.point@1', params: { power, color: [1, 1, 1], radius: 0, range: 1000, shadow: false }, at: { pos } });
/** A black sky with no ambient and no environment: the document's lights are the only light (#422). */
export const DARK_SKY: JsonObject = { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } };
/** The white furnace (#422, README: Assumed surfaces): the environment's radiance is 1 in every direction. */
export const FURNACE_SKY: JsonObject = {
  kind: 'sky@1', params: { top: [1, 1, 1, 1], low: [1, 1, 1, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0], environment: { from: 'sky', intensity: 1 } },
};
/** A daylight sky lighting by its environment, for the pictures a person judges. */
export const SHOW_SKY: JsonObject = {
  kind: 'sky@1', params: { top: [0.25, 0.4, 0.8, 1], low: [0.8, 0.8, 0.78, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0], environment: { from: 'sky', intensity: 1 } },
};
/** An unlit material of one color: the backdrops. */
export const unlit = (c: Rgb): JsonObject => material({ base_color: [...c, 1], unlit: true });

// ---------------------------------------------------------------------------------------------------
// view3d (#378) and the fields this suite reads

export interface View3d {
  doc: string; look: JsonObject; size: [number, number]; frames?: number; fps?: number; from?: number;
  capture?: 'every' | number[]; targets?: ('final' | 'linear' | 'ids')[]; timings?: boolean; surface?: { internal_scale: number };
  imports?: boolean; assets?: Record<string, string>; uris?: Record<string, Record<string, string>>; licenses?: Record<string, JsonObject>;
  packs?: string[]; light_cut?: boolean; cold?: boolean;
}
export const view3dCall = (v: View3d): JsonObject => ({ call: 'view3d', frames: 1, capture: [0], ...(v as unknown as JsonObject) });
export interface ViewFrame {
  frame: number; final: string | null; linear: string | null; ids: string | null; picks: Map<number, string> | null;
  gpu_ms: number | null; lightCut: { shaded: string[]; leftOut: string[] } | null;
}
const optStr = (v: JsonValue | undefined, what: string): string | null => (v === undefined || v === null ? null : str(v, what));
export function framesOf(reply: JsonObject, what: string): ViewFrame[] {
  answered(reply, what);
  return arr(reply['frames'], `${what}: frames`).map((v, i): ViewFrame => {
    const f = obj(v, `${what}: frames[${i}]`); const at = `${what}: frames[${i}]`;
    let picks: Map<number, string> | null = null;
    if (isObject(f['picks'])) picks = new Map(Object.entries(f['picks']).map(([k, id]) => [Number(k), str(id, `${at}.picks[${k}]`)]));
    let lightCut: ViewFrame['lightCut'] = null;
    if (f['light_cut'] !== undefined) {
      const c = obj(f['light_cut'], `${at}.light_cut`);
      lightCut = {
        shaded: arr(c['shaded'], `${at}.light_cut.shaded`).map((s, j) => str(obj(s, `${at}.light_cut.shaded[${j}]`)['light'], `${at}.light_cut.shaded[${j}].light`)),
        leftOut: arr(c['left_out'], `${at}.light_cut.left_out`).map((s, j) => str(s, `${at}.light_cut.left_out[${j}]`)),
      };
    }
    return {
      frame: num(f['frame'], `${at}.frame`), final: optStr(f['final'], `${at}.final`), linear: optStr(f['linear'], `${at}.linear`), ids: optStr(f['ids'], `${at}.ids`), picks,
      gpu_ms: f['gpu_ms'] === undefined || f['gpu_ms'] === null ? null : num(f['gpu_ms'], `${at}.gpu_ms`), lightCut,
    };
  });
}
export function frameAt(frames: ViewFrame[], n: number, what: string): ViewFrame {
  const f = frames.find((x) => x.frame === n);
  expect(f, `${what}: frame ${n} is in the reply`).toBeDefined();
  return f!;
}
export function readNamed(out: string, hash: string | null, ext: string, what: string): Buffer {
  expect(hash, `${what} is written, named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${hash}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}
/** The linear target (#378): little-endian f32 RGBA, rows top-down, before exposure. */
export interface Linear { width: number; height: number; at: (x: number, y: number) => Rgb; bytes: Buffer }
export function readLinear(out: string, hash: string | null, size: [number, number], what: string): Linear {
  const file = readNamed(out, hash, 'f32', what);
  expect(file.length, `${what} holds ${size[0]} × ${size[1]} f32 RGBA pixels`).toBe(size[0] * size[1] * 16);
  return { width: size[0], height: size[1], bytes: file, at: (x, y) => { const o = (y * size[0] + x) * 16; return [file.readFloatLE(o), file.readFloatLE(o + 4), file.readFloatLE(o + 8)]; } };
}
export const readPng = (out: string, hash: string | null, what: string): Image => decodePng(readNamed(out, hash, 'png', what));
export const px = (im: Image, x: number, y: number): Rgb => { const o = (y * im.width + x) * 4; return [im.rgba[o]!, im.rgba[o + 1]!, im.rgba[o + 2]!]; };
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
/** Whether every pixel within `r` px of (x, y) shows `id`. */
export function insideAt(ids: Ids, id: string, x: number, y: number, r: number): boolean {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (ids.at(x + dx, y + dy) !== id) return false;
  return true;
}
/** The pixels of `id` whose every neighbour within `r` px is `id` too. */
export function inside(ids: Ids, id: string, r: number): [number, number][] {
  const out: [number, number][] = [];
  for (let y = 0; y < ids.height; y++) for (let x = 0; x < ids.width; x++) if (ids.at(x, y) === id && insideAt(ids, id, x, y, r)) out.push([x, y]);
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
function ihdr(width: number, height: number): Buffer { const h = Buffer.alloc(13); h.writeUInt32BE(width, 0); h.writeUInt32BE(height, 4); h[8] = 8; h[9] = 2; return h; }
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export function encodePng(image: Image): Buffer {
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr(image.width, image.height)), chunk('IDAT', rows(image)), chunk('IEND', new Uint8Array(0))]);
}
/** An animated PNG of equal-sized frames at `fps`, looping: the dolly's recording. */
export function encodeApng(frames: Image[], fps: number): Buffer {
  const { width, height } = frames[0]!;
  const actl = Buffer.alloc(8); actl.writeUInt32BE(frames.length, 0); actl.writeUInt32BE(0, 4);
  const parts: Buffer[] = [SIGNATURE, chunk('IHDR', ihdr(width, height)), chunk('acTL', actl)];
  let seq = 0;
  frames.forEach((f, i) => {
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(seq++, 0); fctl.writeUInt32BE(width, 4); fctl.writeUInt32BE(height, 8);
    fctl.writeUInt16BE(1, 20); fctl.writeUInt16BE(fps, 22);
    parts.push(chunk('fcTL', fctl));
    const data = rows(f);
    if (i === 0) parts.push(chunk('IDAT', data));
    else { const s = Buffer.alloc(4); s.writeUInt32BE(seq++, 0); parts.push(chunk('fdAT', Buffer.concat([s, data]))); }
  });
  parts.push(chunk('IEND', new Uint8Array(0)));
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------------------------------
// The Khronos samples (README: The Khronos samples): fetched by hash on first use into a cache outside the checkout,
// checked never committed, handed to the product by hash only.

export const KHRONOS_COMMIT = 'edc7c9e67c639d230715049ee31f9a96a6babbbe';
export interface Pin { path: string; sha256: string; size: number }
export interface Sample { name: string; main: Pin; files: Record<string, Pin>; license: JsonObject }
const CC0 = 'https://creativecommons.org/publicdomain/zero/1.0/legalcode';
const CCBY = 'https://creativecommons.org/licenses/by/4.0/legalcode';
const lic = (id: 'CC0-1.0' | 'CC-BY-4.0', credit: string): JsonObject => ({ id, terms: id === 'CC0-1.0' ? CC0 : CCBY, shareable: true, credit });
const m = (name: string, rest: string): string => `Models/${name}/${rest}`;
export const SAMPLES = {
  SheenChair: {
    name: 'SheenChair', main: { path: m('SheenChair', 'glTF-Binary/SheenChair.glb'), sha256: 'f0af2a2b102d28d540236306ae19f8fb36842df76bd38cf76f063f9bd2853399', size: 4125648 }, files: {},
    license: lic('CC0-1.0', '© 2020 Wayfair, LLC; by Eric Chadwick (SheenChair, CC0 1.0)'),
  },
  AnisotropyStrengthTest: {
    name: 'AnisotropyStrengthTest', main: { path: m('AnisotropyStrengthTest', 'glTF-Binary/AnisotropyStrengthTest.glb'), sha256: '306321ff8214727b145188ceb56d96d2882b393d0b596fa089fd20b07e959834', size: 94444 }, files: {},
    license: lic('CC0-1.0', '2023, by Ed Mackey (AnisotropyStrengthTest, CC0 1.0)'),
  },
  DiffuseTransmissionTest: {
    name: 'DiffuseTransmissionTest', main: { path: m('DiffuseTransmissionTest', 'glTF-Binary/DiffuseTransmissionTest.glb'), sha256: 'cac9152a1215177c479f33cc0f5d1b64f92010311d2316dc42dde87fa505e282', size: 238336 }, files: {},
    license: lic('CC-BY-4.0', '© 2025 Darmstadt Graphics Group GmbH; model and textures by Eric Chadwick (DiffuseTransmissionTest, CC BY 4.0); Khronos and glTF logos are Khronos Group trademarks'),
  },
  AttenuationTest: {
    name: 'AttenuationTest', main: { path: m('AttenuationTest', 'glTF-Binary/AttenuationTest.glb'), sha256: '7ca161b7f8a9e4b2ac1f7f75816b5848bb31f3b4c226c4cb731b487c8809b756', size: 57532 }, files: {},
    license: lic('CC-BY-4.0', '© 2021 Analytical Graphics, Inc.; by Ed Mackey (AttenuationTest, CC BY 4.0)'),
  },
  DispersionTest: {
    name: 'DispersionTest', main: { path: m('DispersionTest', 'glTF-Binary/DispersionTest.glb'), sha256: 'bbac38386632b5a7a27289737963314c2f92095074dfdf0e8c0c1c25270b3e37', size: 2310944 }, files: {},
    license: lic('CC-BY-4.0', '© 2023 AGI; by Ed Mackey (DispersionTest, CC BY 4.0)'),
  },
  IridescenceDielectricSpheres: {
    name: 'IridescenceDielectricSpheres',
    main: { path: m('IridescenceDielectricSpheres', 'glTF/IridescenceDielectricSpheres.gltf'), sha256: 'fe156ca114515aa2606d35e3eea4940fcf9895559d474e14ec48dedf4e5a8575', size: 295192 },
    files: {
      'IridescenceDielectricSpheres.bin': { path: m('IridescenceDielectricSpheres', 'glTF/IridescenceDielectricSpheres.bin'), sha256: 'eeacab254dfd44b8e026a8ad9e865aa1b63711eb86fa7c36180a437845e97253', size: 34068 },
      'textures/guides.png': { path: m('IridescenceDielectricSpheres', 'glTF/textures/guides.png'), sha256: '01cef8cce29485f2e12c422aca6330b2ec869068f8035c3f006210678afc3573', size: 42439 },
    },
    license: lic('CC0-1.0', '2019, Khronos (IridescenceDielectricSpheres, CC0 1.0)'),
  },
  SpecularTest: {
    name: 'SpecularTest', main: { path: m('SpecularTest', 'glTF-Binary/SpecularTest.glb'), sha256: 'cf789c68c3ab4b74877da3c5992c612c213f9c901ed4fafbf9be362f434e48d9', size: 223376 }, files: {},
    license: lic('CC-BY-4.0', '© 2021 Analytical Graphics, Inc.; by Ed Mackey (SpecularTest, CC BY 4.0)'),
  },
} satisfies Record<string, Sample>;
export type SampleName = keyof typeof SAMPLES;
/** The cache, outside the checkout: files by SHA-256, never in the repository. */
export const KHRONOS_CACHE = join(homedir(), '.cache', 'deepbuild-acceptance', 'khronos');
async function pinned(pin: Pin): Promise<Buffer> {
  const file = join(KHRONOS_CACHE, pin.sha256);
  if (existsSync(file)) { const bytes = readFileSync(file); if (sha256(bytes) === pin.sha256) return bytes; }
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
  mkdirSync(KHRONOS_CACHE, { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, bytes); renameSync(temp, file);
  return bytes;
}
const gitBlob = (bytes: Buffer): string => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
let tracked: Set<string> | null = null;
function trackedBlobs(): Set<string> {
  if (tracked) return tracked;
  const ids = new Set<string>();
  for (const line of execFileSync('git', ['ls-tree', '-r', 'HEAD'], { cwd: REPO, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 }).split('\n')) { const id = line.split(/\s+/)[2]; if (id) ids.add(id); }
  for (const line of execFileSync('git', ['ls-files', '-s'], { cwd: REPO, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 }).split('\n')) { const id = line.split(/\s+/)[1]; if (id) ids.add(id); }
  tracked = ids;
  return ids;
}
export interface Fetched { sample: Sample; sha: string; gltf: Gltf; assets: Record<string, string>; uris: Record<string, Record<string, string>>; licenses: Record<string, JsonObject> }
/** A sample fetched by hash on first use, checked never committed, written under `dir` by hash for the product. */
export async function khronos(name: SampleName, dir: string): Promise<Fetched> {
  const sample: Sample = SAMPLES[name];
  const bytes = await pinned(sample.main);
  const files: Record<string, Buffer> = {};
  for (const [uri, pin] of Object.entries(sample.files)) files[uri] = await pinned(pin);
  const blobs = trackedBlobs();
  for (const [what, b] of [[sample.main.path, bytes] as const, ...Object.entries(sample.files).map(([u, p]) => [p.path, files[u]!] as const)]) {
    expect(blobs.has(gitBlob(b)), `${what} is never committed: no blob in HEAD or the index has its bytes`).toBe(false);
  }
  const assets: Record<string, string> = {};
  const put = (b: Buffer): string => { const s = sha256(b); const p = join(dir, s); if (!existsSync(p)) writeFileSync(p, b); assets[s] = p; return s; };
  const sha = put(bytes);
  const uris: Record<string, Record<string, string>> = {};
  if (Object.keys(files).length) uris[sha] = Object.fromEntries(Object.entries(files).map(([u, b]) => [u, put(b)]));
  return { sample, sha, gltf: readGltf(bytes, files), assets, uris, licenses: { [sha]: sample.license } };
}
/** A glTF file's whole scene as one item at the origin (#423's `mesh.asset@1` with `node: {scene: 0}`). */
export const sceneAsset = (sha: string): JsonObject => ({ kind: 'mesh.asset@1', params: { sha256: sha, node: { scene: 0 } }, at: { pos: [0, 0, 0] } });

// ---------------------------------------------------------------------------------------------------
// The import report (#423's `imports: true`).

export interface Imported { materials: Map<number, { name: JsonValue; params: JsonObject }>; dropped: { material: JsonValue; input: string }[] }
export function importOf(reply: JsonObject, item: string, what: string): Imported {
  answered(reply, what);
  const e = arr(reply['imports'], `${what}: imports`).map((x, i) => obj(x, `${what}: imports[${i}]`)).find((x) => x['item'] === item);
  expect(e, `${what}: imports has an entry for ${item}, got ${shown(reply['imports'])}`).toBeDefined();
  const materials = new Map<number, { name: JsonValue; params: JsonObject }>();
  for (const [i, v] of arr(e!['materials'], `${what}: materials`).entries()) {
    const mm = obj(v, `${what}: materials[${i}]`);
    materials.set(num(mm['index'], `${what}: materials[${i}].index`), { name: mm['name'] ?? null, params: obj(mm['params'], `${what}: materials[${i}].params`) });
  }
  const dropped = arr(e!['dropped'] ?? [], `${what}: dropped`).map((d, i) => { const o = obj(d, `${what}: dropped[${i}]`); return { material: o['material'] ?? null, input: str(o['input'], `${what}: dropped[${i}].input`) }; });
  return { materials, dropped };
}
const field = (params: JsonObject, path: string): JsonValue | undefined => path.split('.').reduce<JsonValue | undefined>((v, k) => (isObject(v) ? v[k] : undefined), params);
/** Each lobe field the file's extensions give, on the import's `material@1` params (README: Assumed surfaces). */
export function lobeFieldProblems(g: Gltf, im: Imported, model: string): string[] {
  const problems: string[] = [];
  const close = (a: JsonValue | undefined, b: number): boolean => typeof a === 'number' && Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
  for (const [i, mat] of list(g, 'materials').entries()) {
    const at = `${model} material ${i} (${(mat['name'] as string | undefined) ?? 'unnamed'})`;
    const got = im.materials.get(i);
    if (!got) { problems.push(`${at}: not in the import`); continue; }
    const p = got.params; const lobes = gltfMaterial(g, i); const e = (mat['extensions'] as JsonObject | undefined) ?? {};
    const want: [string, number][] = [];
    if (e['KHR_materials_sheen']) {
      want.push(['sheen.weight', 1], ['sheen.roughness', lobes.lobes.sheen?.roughness ?? 0]);
      (lobes.lobes.sheen?.color ?? [0, 0, 0]).forEach((c, k) => want.push([`sheen.color.${k}`, c]));
    }
    if (e['KHR_materials_anisotropy']) want.push(['anisotropy.strength', lobes.lobes.anisotropy!.strength], ['anisotropy.rotation', deg(lobes.lobes.anisotropy!.rotation)]);
    if (e['KHR_materials_diffuse_transmission']) {
      want.push(['translucency.amount', lobes.lobes.translucency!.amount]);
      lobes.lobes.translucency!.color.forEach((c, k) => want.push([`translucency.color.${k}`, c]));
      if (field(p, 'translucency.kind') !== 'thin') problems.push(`${at}: translucency.kind is ${shown(field(p, 'translucency.kind'))}, not thin (KHR_materials_diffuse_transmission)`);
    }
    if (e['KHR_materials_transmission']) want.push(['transmission', lobes.transmission]);
    if (e['KHR_materials_ior']) want.push(['ior', lobes.lobes.ior]);
    if (e['KHR_materials_volume']) {
      want.push(['absorption.thickness', lobes.thickness]);
      lobes.attenuationColor.forEach((c, k) => want.push([`absorption.attenuation.color.${k}`, c]));
      if (Number.isFinite(lobes.attenuationDistance)) want.push(['absorption.attenuation.distance', lobes.attenuationDistance]);
    }
    if (e['KHR_materials_dispersion']) want.push(['dispersion', lobes.dispersion]);
    if (e['KHR_materials_iridescence']) { const ir = lobes.lobes.iridescence!; want.push(['iridescence.weight', ir.weight], ['iridescence.ior', ir.ior], ['iridescence.thickness', ir.thickness]); }
    if (e['KHR_materials_specular']) {
      want.push(['specular_level', lobes.lobes.specular / 2]);
      lobes.lobes.specularColor.forEach((c, k) => want.push([`specular_color.${k}`, c]));
    }
    for (const [path, value] of want) {
      const v = path.split('.').reduce<JsonValue | undefined>((o, k) => (Array.isArray(o) ? o[Number(k)] : isObject(o) ? o[k] : undefined), p);
      if (!close(v, value)) problems.push(`${at}: ${path} is ${shown(v)}, the file gives ${value}`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------------
// A Khronos sample drawn orthographically and held to its CPU reference (README: Readings, the samples).

export interface SampleView {
  view: Ortho;
  /** `sun`: one sun behind the camera at π lx; `file`: the file's own KHR_lights_punctual light; `none`: no light. */
  light: 'sun' | 'file' | 'none';
  /** The test's backdrop: unlit boxes (README: The samples' views), and the CPU's flat form of it. */
  backdrop: { items: Record<string, JsonObject>; tris: Tri[]; color: (p: V3) => Rgb } | null;
  /** glTF material indices judged, and those each needing at least 50 judged pixels. */
  judged: number[]; required: number[];
}
const range = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const whiteBackdrop = (z: number): SampleView['backdrop'] => ({
  items: { backdrop_white: unlit([1, 1, 1]), backdrop: box([60, 60, 0.01], [0, 0, z - 0.005], 'backdrop_white') },
  tris: quad(-30, -30, 30, 30, z, -1, -1), color: () => [1, 1, 1],
});
/** Black at z with white lines 1 mm wide every 3 mm (x = −0.099 + 0.003 k), in front of it by 0.1 mm. */
function linesBackdrop(z: number): SampleView['backdrop'] {
  const items: Record<string, JsonObject> = { backdrop_black: unlit([0, 0, 0]), backdrop_white: unlit([1, 1, 1]), backdrop: box([0.4, 0.4, 0.001], [0, 0, z - 0.0005], 'backdrop_black') };
  const centres = range(0, 66).map((k) => -0.099 + 0.003 * k);
  centres.forEach((c, k) => { items[`line${k}`] = box([0.001, 0.12, 0.0001], [c, 0, z + 0.00005], 'backdrop_white'); });
  return {
    items, tris: quad(-0.2, -0.2, 0.2, 0.2, z, -1, -1),
    color: (p) => (Math.abs(p[1]) <= 0.06 && centres.some((c) => Math.abs(p[0] - c) < 0.0005) ? [1, 1, 1] : [0, 0, 0]),
  };
}
export const SAMPLE_VIEWS: Record<SampleName, SampleView> = {
  SheenChair: { view: { target: [0.1, 0.45, 0], viewWidth: 0.04, size: [400, 400] }, light: 'sun', backdrop: null, judged: [0], required: [0] },
  AnisotropyStrengthTest: { view: { target: [0, 3, 0], viewWidth: 7.2, size: [1152, 1152] }, light: 'sun', backdrop: null, judged: range(14, 48), required: [...range(15, 20), ...range(22, 27), ...range(29, 34), ...range(36, 41)] },
  DiffuseTransmissionTest: { view: { target: [2.4, -1.8, 0], viewWidth: 6, size: [960, 720] }, light: 'file', backdrop: null, judged: range(0, 9), required: [1, 2, 3, 4, 6, 7, 8, 9] },
  AttenuationTest: { view: { target: [1.25, 0, 0], viewWidth: 12, size: [960, 1120] }, light: 'none', backdrop: whiteBackdrop(-0.5), judged: [...range(0, 4), ...range(7, 11), ...range(13, 17)], required: [...range(0, 4), ...range(7, 11)] },
  DispersionTest: { view: { target: [0, 0, 0], viewWidth: 0.14, size: [1400, 800] }, light: 'none', backdrop: linesBackdrop(-0.012), judged: [0, ...range(3, 26)], required: [...range(8, 11), ...range(13, 16), ...range(18, 21), ...range(23, 26)] },
  IridescenceDielectricSpheres: { view: { target: [-1.75, 0, 10.5], viewWidth: 7, size: [1540, 770] }, light: 'sun', backdrop: null, judged: range(0, 343), required: [] },
  SpecularTest: { view: { target: [0.105, 0, 0], viewWidth: 0.6, size: [1200, 1600] }, light: 'sun', backdrop: null, judged: [], required: [] },
};
export const ASSET = 'asset';
/** The sample's document: the orthographic camera, a dark sky, the sample as one item, its backdrop and its light. */
export function sampleDoc(f: Fetched, sv: SampleView): JsonObject {
  return sessionDoc(`khronos-${f.sample.name}`, sv.view.size, {
    cam: orthoCamera(sv.view), sky: DARK_SKY, [ASSET]: sceneAsset(f.sha), ...(sv.backdrop?.items ?? {}),
    ...(sv.light === 'sun' ? { sun: sun(Math.PI, [0, 0, 0]) } : {}),
  });
}
/** The lights the CPU reference shades with: the doc's sun behind the camera, or the file's own directional lights. */
export function sampleLights(g: Gltf, sv: SampleView): SunLight[] {
  if (sv.light === 'sun') return [{ toward: [0, 0, 1], illuminance: Math.PI, color: [1, 1, 1] }];
  if (sv.light === 'none') return [];
  const defs = (((g.json['extensions'] as JsonObject | undefined)?.['KHR_lights_punctual'] as JsonObject | undefined)?.['lights'] as JsonObject[] | undefined) ?? [];
  const out: SunLight[] = [];
  for (const [i, w] of worlds(g)) {
    const li = ((list(g, 'nodes')[i]!['extensions'] as JsonObject | undefined)?.['KHR_lights_punctual'] as JsonObject | undefined)?.['light'];
    if (typeof li !== 'number') continue;
    const def = defs[li]!;
    expect(def['type'], `the file's light ${li} is directional (the reference reads only those)`).toBe('directional');
    // A light shines along its node's −Z, so the direction toward it is the node's +Z in the world.
    out.push({ toward: unit(applyDir(w, [0, 0, 1])), illuminance: typeof def['intensity'] === 'number' ? def['intensity'] : 1, color: (def['color'] as Rgb | undefined) ?? [1, 1, 1] });
  }
  expect(out.length, 'the file has a light').toBeGreaterThan(0);
  return out;
}
/** A pixel's corners (just inside it, as `sampleReference`'s copy test takes them) and the four positions of the standard
 * 4× MSAA pattern, as fractions of the pixel. */
const PIXEL_POINTS: [number, number][] = [[0.02, 0.02], [0.98, 0.02], [0.02, 0.98], [0.98, 0.98], [0.375, 0.125], [0.875, 0.375], [0.125, 0.625], [0.625, 0.875]];
/**
 * Whether the triangle the pixel's centre sees is the one every point of `PIXEL_POINTS` sees. At 4× MSAA a pixel where
 * two triangles meet keeps samples of both, and the one that doesn't hold the centre is shaded at the centre all the same,
 * from its attributes extrapolated past its edges (#1173); a reference taken at the centre can't hold such a pixel to 1%.
 */
function oneTriangleAt(tr: Traced, view: Ortho, x: number, y: number): boolean {
  const d: V3 = [0, 0, -1];
  const seen = (px: number, py: number): Tri | undefined =>
    trace(tr, orthoPoint(view, px, py, 1000), d, (h) => h.tri.node < 0 || h.front || tr.materials.get(h.tri.material)!.doubleSided)?.tri;
  const centre = seen(x + 0.5, y + 0.5);
  return PIXEL_POINTS.every(([fx, fy]) => seen(x + fx, y + fy) === centre);
}
export interface SampleRun { failures: string[]; judged: Map<number, number>; linear: Linear; final: Image; ids: Ids; out: string }
/**
 * Draws the sample (with `imports`), and holds every judged pixel 2 px inside its node to the CPU reference within 1%
 * per channel where the reference's channel is at least 0.02 (a white Lambertian square to the sun reads 1). Each
 * failure names the material. With `oneTriangle` (AC1 only, by the owner's approved proposal on #1173), a pixel is
 * judged only where one triangle lies under all of it (`oneTriangleAt`).
 */
export function checkSample(bin: string, out: string, f: Fetched, sv: SampleView, planted?: GpuPlanted, oneTriangle = false): { run: SampleRun; reply: JsonObject } {
  const doc = writeJson(out, `sample-${f.sample.name}`, sampleDoc(f, sv));
  const [reply] = runGpu(bin, out, [view3dCall({ doc, look: PLAIN_LOOK, size: sv.view.size, targets: ['final', 'linear', 'ids'], imports: true, assets: f.assets, uris: f.uris, licenses: f.licenses })], planted);
  const frame = frameAt(framesOf(reply!, f.sample.name), 0, f.sample.name);
  const linear = readLinear(out, frame.linear, sv.view.size, `${f.sample.name}: linear`);
  const ids = readIds(out, frame, `${f.sample.name}: ids`);
  const final = readPng(out, frame.final, `${f.sample.name}: final`);
  const g = f.gltf;
  const tr = traceable(g, sv.backdrop?.tris ?? []);
  const textures = new Map<number, Texture>();
  for (const mi of sv.judged) {
    const gm = gltfMaterial(g, mi);
    if (gm.baseTexture) textures.set(gm.baseTexture.image, { image: decodePng(imageBytes(g, gm.baseTexture.image)), srgb: true });
    if (gm.normalTexture) textures.set(gm.normalTexture.image, { image: decodePng(imageBytes(g, gm.normalTexture.image)), srgb: false });
  }
  const pickOf = (node: number): string => `${ASSET}#${nodeName(g, node)}`;
  const wanted: [number, number][] = [];
  for (let y = 0; y < sv.view.size[1]; y++) for (let x = 0; x < sv.view.size[0]; x++) { const id = ids.at(x, y); if (id && id.startsWith(`${ASSET}#`) && insideAt(ids, id, x, y, 2)) wanted.push([x, y]); }
  const kept = oneTriangle ? wanted.filter(([x, y]) => oneTriangleAt(tr, sv.view, x, y)) : wanted;
  const ref = sampleReference(tr, { view: sv.view, lights: sampleLights(g, sv), backdrop: sv.backdrop?.tris ?? [], backdropColor: sv.backdrop?.color ?? (() => [0, 0, 0]), textures, judged: new Set(sv.judged) }, kept);
  const bad = new Map<number, { n: number; worst: string; off: number }>();
  const judged = new Map<number, number>();
  for (const p of ref) {
    if (!p.judged || p.node < 0 || ids.at(p.x, p.y) !== pickOf(p.node)) continue;
    const drawn = linear.at(p.x, p.y);
    let counted = false;
    for (let c = 0; c < 3; c++) {
      if (p.value[c]! < 0.02) continue;
      counted = true;
      const off = Math.abs(drawn[c]! - p.value[c]!) / p.value[c]!;
      if (off > 0.01) {
        const e = bad.get(p.material) ?? { n: 0, worst: '', off: 0 };
        e.n++;
        if (off > e.off) { e.off = off; e.worst = `(${p.x}, ${p.y}) channel ${c}: drawn ${drawn[c]!.toFixed(5)}, reference ${p.value[c]!.toFixed(5)}`; }
        bad.set(p.material, e);
      }
    }
    if (counted) judged.set(p.material, (judged.get(p.material) ?? 0) + 1);
  }
  const failures = [...bad.entries()].map(([mi, e]) => `${f.sample.name} material ${gltfMaterial(g, mi).name} (#${mi}): ${e.n} judged channel values off the CPU reference by more than 1%, worst ${(e.off * 100).toFixed(2)}% at ${e.worst}`);
  for (const mi of sv.required) {
    const n = judged.get(mi) ?? 0;
    if (n < 50) failures.push(`${f.sample.name} material ${gltfMaterial(g, mi).name} (#${mi}): only ${n} pixels could be judged (50 needed); is it drawn where the file puts it?`);
  }
  return { run: { failures, judged, linear, final, ids, out }, reply: reply! };
}
/** Σ radiance × pixel area over a node's pixels (ortho: m² a pixel), in the linear target: a mirror lobe's flux. */
export function nodeFlux(run: SampleRun, view: Ortho, pick: string): Rgb {
  const a = (view.viewWidth / view.size[0]) ** 2; const s: Rgb = [0, 0, 0];
  for (let y = 0; y < run.ids.height; y++) for (let x = 0; x < run.ids.width; x++) if (run.ids.at(x, y) === pick) { const c = run.linear.at(x, y); for (let k = 0; k < 3; k++) s[k] = s[k]! + c[k]! * a; }
  return s;
}

// ---------------------------------------------------------------------------------------------------
// The white furnace and the sphere fixtures (copied from #422's helpers).

export const SPHERE_SIZE: [number, number] = [320, 320];
export const SPHERE_CAM = { position: [0, 0, 6] as V3, target: [0, 0, 0] as V3, fov: 30, size: SPHERE_SIZE };
/** One ball of radius 1 at the origin in `mat` (id `mat`), under `sky` and `light`, seen from 6 m on +Z. */
export function sphereDoc(name: string, mat: JsonObject, sky: JsonObject, light: JsonObject | null): JsonObject {
  return sessionDoc(`sphere-${name}`, SPHERE_SIZE, {
    cam: camera(SPHERE_CAM.position, SPHERE_CAM.target, SPHERE_CAM.fov, { near: 0.1, far: 100 }), sky, [name]: material(mat), ball: ball(1, [0, 0, 0], name),
    ...(light ? { light } : {}),
  });
}
export interface Drawn { name: string; linear: Linear; final: Image; ids: Ids }
/** Each document drawn once at `SPHERE_SIZE`, its linear, final and ID targets read. */
export function drawSpheres(bin: string, out: string, docs: { name: string; doc: JsonObject }[], planted?: GpuPlanted): Drawn[] {
  const replies = runGpu(bin, out, docs.map((d) => view3dCall({ doc: writeJson(out, `sphere-${d.name}`, d.doc), look: PLAIN_LOOK, size: SPHERE_SIZE, targets: ['final', 'linear', 'ids'] })), planted);
  return replies.map((r, i) => {
    const f = frameAt(framesOf(r, docs[i]!.name), 0, docs[i]!.name);
    return { name: docs[i]!.name, linear: readLinear(out, f.linear, SPHERE_SIZE, `${docs[i]!.name}: linear`), final: readPng(out, f.final, `${docs[i]!.name}: final`), ids: readIds(out, f, `${docs[i]!.name}: ids`) };
  });
}
/** The furnace's own check: its background reads radiance 1 within 1%, else nothing it reads counts. */
export function furnaceBackground(d: Drawn): string[] {
  let worst = 0; let at = '';
  for (let y = 0; y < d.ids.height; y += 4) for (let x = 0; x < d.ids.width; x += 4) {
    if (d.ids.at(x, y) !== null) continue;
    for (const v of d.linear.at(x, y)) if (Math.abs(v - 1) > worst) { worst = Math.abs(v - 1); at = `(${x}, ${y})`; }
  }
  return worst > 0.01 ? [`${d.name}: the furnace's background isn't radiance 1 within 1% (${(worst * 100).toFixed(2)}% off at ${at})`] : [];
}
/** In the furnace, no pixel of the ball above 1.01 in any channel (pbrt-v4's pass rule, as #422 ported it). */
export function furnaceOver(d: Drawn, item = 'ball'): string[] {
  let worst = 0; let at = '';
  for (let y = 0; y < d.ids.height; y++) for (let x = 0; x < d.ids.width; x++) {
    if (d.ids.at(x, y) !== item) continue;
    const c = d.linear.at(x, y); const v = Math.max(c[0], c[1], c[2]);
    if (v > worst) { worst = v; at = `(${x}, ${y})`; }
  }
  return worst > 1.01 ? [`${d.name}: reflects more than it receives in the white furnace, ${worst.toFixed(4)} at ${at}`] : [];
}

// ---------------------------------------------------------------------------------------------------
// The timing rule (technical design: Every task carries its own budgets): five runs after a warm-up; PASS when all five
// are within the limit; FAIL when all five are over it by more than the margin (the larger of 5% and their spread) on a
// machine that isn't loaded; otherwise INCONCLUSIVE, which fails here with that word.

export const RUNS = 5;
export function percentile(values: number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!;
}
export function judge(name: string, runs: number[], limit: number): void {
  const margin = Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9));
  const line = `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%, load ${loadPerCore().toFixed(2)} a core)`;
  console.log(line);
  if (runs.every((r) => r < limit)) return;
  if (loadPerCore() > 1) inconclusive(`under load: ${line}`);
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${line}`).toBe(false);
  inconclusive(line);
}

// ---------------------------------------------------------------------------------------------------
// AC7's flake panel (AC9 shows it): a 1 m panel facing +Z, a sun 20° off its normal, the camera dollying in along its
// axis from 3.3 m to 3.0 m over the first second (README: Readings, flakes).

export const FLAKE_FPS = 30;
export const FLAKE_SEED = 428;
export const FLAKE_SUN: V3 = [0, 20, 0];
/** The camera's distance at frame n of the dolly. */
export const flakeCamZ = (frame: number): number => 3.3 - 0.3 * Math.min(frame / FLAKE_FPS, 1);
/** The fov at which the 1 m panel spans 1,000 px of 1,100 at 3 m (a 3,000 px focal length at that size). */
export const flakeFov = (size: number): number => (2 * Math.atan(size / 2 / ((3000 * size) / 1100)) * 180) / Math.PI;
export function flakeDoc(size: number, paint: JsonObject): JsonObject {
  return sessionDoc('flakes-428', [size, size], {
    cam: camera([0, 0, flakeCamZ(0)], [0, 0, 0], flakeFov(size)), sky: DARK_SKY, sun: sun(Math.PI, FLAKE_SUN),
    paint: material(paint), panel: box([1, 1, 0.002], [0, 0, 0], 'paint'),
  }, { channels: { dolly: { target: 'items/cam/params/position/2', type: 'f32', keys: { k0: { t: '0s', value: flakeCamZ(0), interp: 'linear' }, k1: { t: '1s', value: flakeCamZ(FLAKE_FPS), interp: 'linear' } } } } });
}
/** The flakes the criterion names, white metal at coat_roughness 0.3 under no coat, on a black base with no specular. */
export const FLAKE_PAINT: JsonObject = {
  base_color: [0, 0, 0, 1], metallic: 0, specular_level: 0, coat: 0, coat_roughness: 0.3, pattern_seed: FLAKE_SEED,
  flakes: { weight: 1, size: 0.01, tilt: 15, color: [1, 1, 1, 1] },
};
