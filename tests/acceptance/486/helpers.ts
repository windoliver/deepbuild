// Test-side tools for the #486 acceptance tests: the base's `deep-gpu` binary (#377's GPU layer with #378's `view3d`,
// #379's `live`, #421's shading core, #422's sky and environment, #428's lobes, #429's operators as items, #431's
// `use@1`, #432's warm-up and `created` rows), built once per file and driven by JSON lines, on macOS's Metal device or
// on wgpu's noop backend (`--backend noop`, the noop lane); the operator outputs, steps and planted programs this suite
// adds (README: Assumed surfaces); the documents the tests draw and play; and PNG reading and writing (copied from #481's
// and #432's helpers, since suites don't import each other). Nothing here stands in for the renderer or the check: the
// CPU references are `reference.ts`.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';
import { reliefNormal, type V3 } from './reference.ts';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type Rgb = [number, number, number];
export type Size = [number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/486 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text (README: Criteria to tests). */
export const AC = {
  1: 'AC1 #486.fccdc529',
  2: 'AC2 #486.f7c1ed7f',
  3: 'AC3 #486.d12f88ca',
  4: 'AC4 #486.5d0001c4',
  5: 'AC5 #486.c1e9a9b8',
  6: 'AC6 #486.0887c8cd',
  7: 'AC7 #486.8b403bfa',
} as const;

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${shown(value)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${shown(value)}`).toBe(true);
  return value as JsonValue[];
}
export const objs = (v: JsonValue | undefined, what: string): JsonObject[] => arr(v, what).map((x, i) => obj(x, `${what}[${i}]`));
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${shown(value)}`).toBe('string');
  return value as string;
}
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const SHA = /^[0-9a-f]{64}$/;
const clone = <T extends JsonValue>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** At least one failure, and one that names each of `names` as a whole word: what a planted program must give. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  for (const name of names) {
    expect(failures.some((f) => hasWord(f, name)), `${what}: a failure names ${name}; the failures were:\n  ${failures.slice(0, 40).join('\n  ')}`).toBe(true);
  }
}
/** Whether `text` holds `word` whole: not inside a longer identifier (letters, digits and `_` join one). */
export function hasWord(text: string, word: string): boolean {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_])${esc}($|[^A-Za-z0-9_])`).test(text);
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
// as #166's and #481's suites do, for a shell that has rustup's toolchains but no cargo on its PATH).

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
  let dir = ''; let error = 'the build did not run';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-486-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(targetDir(), 'debug', exe('deep-gpu')), join(dir, exe('deep-gpu')));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => { expect(error, `the binary builds: cargo ${CARGO_ARGS.join(' ')}`).toBe(''); return join(dir, exe('deep-gpu')); };
}
/** A fresh temporary folder per test (documents, outputs), deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-486-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--backend noop] [--planted <name>]`: one JSON line in, one JSON line out (#377).

/** The wrong programs this suite plants, each reachable only through `--planted` (README: Planted programs). */
export type Planted = 'lobe_output_scales_field' | 'occlusion_scales_direct' | 'missing_lobe_turned_on' | 'bump_ignores_handedness' | 'coat_normal_bends_base';
/** Where a run draws: macOS's Metal device, or wgpu's noop backend (the noop lane: no GPU, the same frames and keys). */
export type Lane = 'metal' | 'noop';
export interface RunOptions { lane?: Lane; planted?: Planted }

export function runGpu(bin: string, out: string, calls: JsonObject[], o: RunOptions = {}): JsonObject[] {
  const args = ['run', ...(o.lane === 'noop' ? ['--backend', 'noop'] : []), ...(o.planted ? ['--planted', o.planted] : [])];
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
  const replies = objs(answer['replies'], `${name}: replies`);
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
/** A physical-basis `look@1` (#421's shape) with the tone map and exposure given and the look's ao off (Look: ao). */
function look(tone: 'none' | 'filmic', exposure: number): JsonObject {
  return {
    id: `look-486-${tone}`, format: 1, basis: 'physical', license: 'Apache-2.0', description: 'A #486 acceptance look.',
    palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', stone: '#d9dde3', sand: '#e6d3a3' },
    roles: { ground: 'night', ink: 'graphite', muted: 'slate', stone: 'stone', sand: 'sand' }, themes: { light: {}, dark: {} },
    fonts: {
      body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
      mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
    },
    tone_map: tone, exposure, finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' },
    status: { ...STATUS }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: 0.1,
    attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
  };
}
/** Tone map none at the exposure whose scale is 1 (#378's and #421's acceptance look): the linear-target tests. */
export const PLAIN_LOOK = look('none', -Math.log2(1.2));
/** A filmic look for the pictures a person judges (AC7). */
export const SHOW_LOOK = look('filmic', 0);

export const WRITER = 'agent:sess-486';
/** A scene document as a session holds it (#378): one writer layer, every item in it; it requires scene3d and effects
 * (a material operator is an effects item) and runs in the showpiece class, which takes material operators and
 * probes (Operator budgets by class; Light probe). */
export function sessionDoc(id: string, size: Size, items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #486 acceptance fixture.`, size, camera: 'cam', transport: { span: '4s' },
    requires: { modules: { scene3d: '^1', effects: '^1' } }, budget: { class: 'showpiece' },
    layers: { main: { writer: WRITER, title: 'Main', order: 'a0' } }, ...extra, items: withIds,
  };
}
/** The document as a `live` session takes it (#393's payload): no `id`, no `layers`, no item `layer`. */
export function payload(doc: JsonObject): JsonObject {
  const out = clone(doc);
  delete out['id'];
  delete out['layers'];
  for (const item of Object.values(obj(out['items'], 'items'))) delete (item as JsonObject)['layer'];
  return out;
}
/** #378's pinhole `camera@1`: fov across the wider side, +Y up. */
export const camera = (position: V3, target: V3, fov: number): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov, near: 0.05, far: 50 } });
/** #423's orthographic `camera@1`, looking along −Z at the origin, `width` m across the frame. */
export const ortho = (width: number): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'orthographic', position: [0, 0, 5], target: [0, 0, 0], view_width: width, near: 0.1, far: 20 } });
/** A `material@1` item (Material): the fields given over the design's defaults; `op` names its material operator. */
export const material = (params: JsonObject, op?: string): JsonObject => ({ kind: 'material@1', params: op ? { ...params, op } : params });
/** A `mark.box@1` of `size` centred on `pos`, with `at` fields beside `pos` (`rot` in degrees, `scale`). */
export const box = (size: V3, pos: V3, mat: string, at: JsonObject = {}): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos, ...at }, material: mat });
/** A smooth `ball@1` (Builder: `ball {radius, segments}`). */
export const ball = (radius: number, pos: V3, mat: string): JsonObject => ({ kind: 'ball@1', params: { radius, segments: 128 }, at: { pos }, material: mat });
/** A sun (`light.sun@1`, shining along its own −Z, aimed by `at.rot`), casting no shadow. */
export const sun = (illuminance: number, rot: V3): JsonObject => ({ kind: 'light.sun@1', params: { illuminance, color: [1, 1, 1], shadow: false }, at: { rot } });
/** A black sky with no ambient and no environment: the document's lights are the only light (#422). */
export const DARK_SKY: JsonObject = { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } };
/** The same black sky lighting and reflecting the shipped `studio` environment (Sky: environment): its background stays
 * the sky's own black, and the environment is the only ambient light. */
export const STUDIO_SKY: JsonObject = { kind: 'sky@1', params: { ...(DARK_SKY['params'] as JsonObject), environment: { from: 'studio', intensity: 1 } } };
/** The white furnace (#422; README: Assumed surfaces): the environment's radiance is 1 in every direction. */
export const FURNACE_SKY: JsonObject = {
  kind: 'sky@1', params: { top: [1, 1, 1, 1], low: [1, 1, 1, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0], environment: { from: 'sky', intensity: 1 } },
};
/** A reflection probe (`light.probe@1`) whose box holds the plate (Light probe). */
export const PROBE: JsonObject = { kind: 'light.probe@1', params: { type: 'reflection', size: [3, 3, 3] }, at: { pos: [0, 0, 0.5] } };

// ---------------------------------------------------------------------------------------------------
// Material operators (#429's form as items: kind `gpu.material@1`, every other field in `params`; README: Assumed
// surfaces): `steps` from the public op table, `outputs` naming the step each output takes.

export function materialOp(about: string, steps: JsonObject, outputs: JsonObject): JsonObject {
  return { kind: 'gpu.material@1', params: { origin: 'composed', about, inputs: {}, steps, outputs, cost: { ns_per_px: 50 } } };
}
export const f32 = (value: number): JsonObject => ({ op: 'const@1', args: { value, type: 'f32' } });
export const vec2 = (value: [number, number]): JsonObject => ({ op: 'const@1', args: { value, type: 'vec2' } });
export const vec3 = (value: V3): JsonObject => ({ op: 'const@1', args: { value, type: 'vec3' } });
/** The part's uv0 (Every public step: Geometry `uv0`), and its u and v. */
export const UV: JsonObject = {
  uv: { op: 'uv0@1', args: {} },
  u: { op: 'split@1', args: { x: 'uv', pick: 'x' } },
  v: { op: 'split@1', args: { x: 'uv', pick: 'y' } },
};
/** Steps whose step `w` is `left` where uv0.u < 0.5 and `right` elsewhere. */
export function splitSteps(left: number, right: number): JsonObject {
  return { ...UV, half: f32(0.5), at_left: { op: 'lt@1', args: { a: 'u', b: 'half' } }, wl: f32(left), wr: f32(right), w: { op: 'select@1', args: { f: 'wr', t: 'wl', cond: 'at_left' } } };
}
/** A call of `core.bump@1` (`gpu.function@1`, scene3d's entry) on the height step `height`, at strength 1, as `use@1`
 * calls a step function (#431): read as `<call>.normal`. */
export const bumpCall = (height: string): JsonObject => ({ op: 'use@1', args: { name: 'core.bump@1', height, strength: 1 } });

// ---------------------------------------------------------------------------------------------------
// view3d (#378): the base's call, unchanged

export interface View3d { doc: string; look: JsonObject; size: Size; targets: ('final' | 'linear' | 'ids')[] }
export const view3dCall = (v: View3d): JsonObject => ({ call: 'view3d', frames: 1, capture: [0], ...(v as unknown as JsonObject) });
export function readNamed(out: string, hash: JsonValue | undefined, ext: string, what: string): Buffer {
  expect(hash, `${what} is written, named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${hash as string}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}
/** The linear target (#378): little-endian f32 RGBA, rows top-down, `w × h × 16` bytes, before exposure. */
export interface Linear { width: number; height: number; at: (x: number, y: number) => Rgb }
export function readLinear(out: string, hash: JsonValue | undefined, size: Size, what: string): Linear {
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
/** The object-ID target (#378): pick ID r + 2^8 g + 2^16 b + 2^24 a, 0 where nothing draws, named through `picks`. */
export interface Ids { width: number; height: number; at: (x: number, y: number) => string | null }
function readIds(out: string, frame: JsonObject, what: string): Ids {
  const png = decodePng(readNamed(out, frame['ids'], 'png', `${what}: ids`));
  const picks = new Map(Object.entries(obj(frame['picks'], `${what}: picks, the item each pick ID stands for`)).map(([k, id]) => [Number(k), str(id, `${what}.picks[${k}]`)]));
  const items: (string | null)[] = new Array(png.width * png.height);
  for (let i = 0; i < items.length; i++) {
    const o = i * 4;
    const pick = (png.rgba[o]! + png.rgba[o + 1]! * 256 + png.rgba[o + 2]! * 65_536 + png.rgba[o + 3]! * 16_777_216) >>> 0;
    items[i] = pick === 0 ? null : picks.get(pick) ?? `unknown:${pick}`;
  }
  return { width: png.width, height: png.height, at: (x, y) => (x < 0 || y < 0 || x >= png.width || y >= png.height ? null : items[Math.floor(y) * png.width + Math.floor(x)]!) };
}
/** Whether every pixel within `r` px of (x, y) shows one of `ids`: away from a silhouette, where MSAA mixes parts. */
export function insideAt(ids: Ids, of: readonly string[], x: number, y: number, r: number): boolean {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const id = ids.at(x + dx, y + dy); if (id === null || !of.includes(id)) return false; }
  return true;
}

/** Each document drawn once at its size, its linear, final and ID targets read. */
export interface Drawn { name: string; linear: Linear; final: Buffer; ids: Ids }
export function draw(bin: string, out: string, docs: { name: string; doc: JsonObject }[], planted?: Planted, view: JsonObject = PLAIN_LOOK): Drawn[] {
  const size = (d: JsonObject): Size => d['size'] as Size;
  const replies = runGpu(bin, out, docs.map((d) => view3dCall({ doc: writeJson(out, d.name, d.doc), look: view, size: size(d.doc), targets: ['final', 'linear', 'ids'] })), planted ? { planted } : {});
  return replies.map((r, i) => {
    const { name, doc } = docs[i]!;
    answered(r, name);
    const frame = objs(r['frames'], `${name}: frames`).find((f) => f['frame'] === 0);
    expect(frame, `${name}: frame 0 is in the reply`).toBeDefined();
    return { name, linear: readLinear(out, frame!['linear'], size(doc), `${name}: linear`), final: readNamed(out, frame!['final'], 'png', `${name}: final`), ids: readIds(out, frame!, name) };
  });
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
// Pixel comparisons

/** How many 10-bit code values `got` is from `want` (#429's reading): |got − want| × 1023 ÷ max(1, |want|). */
export function codes10(got: number, want: number): number {
  if (!Number.isFinite(got) || !Number.isFinite(want)) return got === want ? 0 : Infinity;
  return (Math.abs(got - want) * 1023) / Math.max(1, Math.abs(want));
}
export const worstCodes = (a: Rgb, b: Rgb): number => Math.max(codes10(a[0], b[0]), codes10(a[1], b[1]), codes10(a[2], b[2]));
export const fmt = (c: Rgb): string => `[${c.map((x) => x.toFixed(5)).join(', ')}]`;
/** The pixels where `got` and `want` differ by more than one 10-bit code value in some channel, among `judged`, each
 * named: `pixel (x, y) on <part>`. */
export interface Off { x: number; y: number; part: string; got: Rgb; want: Rgb; codes: number }
export function offPixels(got: Drawn, want: Drawn, judged: readonly { x: number; y: number; part: string }[]): Off[] {
  const out: Off[] = [];
  for (const p of judged) {
    const g = got.linear.at(p.x, p.y); const w = want.linear.at(p.x, p.y); const codes = worstCodes(g, w);
    if (codes > 1) out.push({ ...p, got: g, want: w, codes });
  }
  return out;
}
export const nameOff = (o: Off): string => `pixel (${o.x}, ${o.y}) on ${o.part} reads ${fmt(o.got)} where ${fmt(o.want)} is wanted (${o.codes.toFixed(1)} codes off)`;

// ---------------------------------------------------------------------------------------------------
// `live` (#379), with #432's `created` rows and `input` events, on the noop lane.

export interface Created { items: string[]; feature_set: string; target: string }
export interface ViewRow { frame: number; session: string; drawn: boolean; created: Created[] }
export interface Live { views: ViewRow[]; sessions: JsonObject[] }
export interface LiveSession { session: string; doc: string; size: Size }
export const liveCall = (frames: number, sessions: LiveSession[], events: JsonObject[]): JsonObject =>
  ({ call: 'live', look: PLAIN_LOOK, fps: 30, frames, sessions: sessions.map((s) => ({ ...s, writer: WRITER })), events });
/** An entry on a session's input track at frame `frame`'s flick, so that frame draws it (#432's `input` event). */
export const inputAt = (frame: number, session: string, control: string, value: JsonValue): JsonObject => ({ frame, input: { session, control, value } });
export function liveReply(reply: JsonObject, what: string): Live {
  answered(reply, what);
  const views: ViewRow[] = [];
  for (const [i, f] of objs(reply['frames'], `${what}: frames`).entries()) {
    const frame = f['frame'] as number;
    for (const [j, v] of objs(f['views'], `${what}: frames[${i}].views`).entries()) {
      const at = `${what}: frames[${i}].views[${j}]`;
      views.push({
        frame, session: str(v['session'], `${at}.session`), drawn: v['drawn'] === true,
        created: objs(v['created'], `${at}.created`).map((c, k) => ({
          items: arr(c['items'], `${at}.created[${k}].items`).map((x) => String(x)), feature_set: String(c['feature_set']), target: String(c['target']),
        })),
      });
    }
  }
  return { views, sessions: objs(reply['sessions'], `${what}: sessions`) };
}
export function sessionRow(live: Live, session: string): JsonObject {
  const s = live.sessions.find((x) => x['session'] === session);
  expect(s, `the live reply has a row for ${session}: ${shown(live.sessions)}`).toBeDefined();
  return s!;
}
/** The first frame a session's view drew. */
export const firstDrawn = (live: Live, session: string): number | null => live.views.find((v) => v.session === session && v.drawn)?.frame ?? null;
/** A toggle (Control, `role: switch` as the core's check requires) whose value shows or hides `part`: off at first. */
export const showToggle = (part: string): JsonObject => ({ kind: 'toggle', class: 'document', label: `Show ${part}`, role: 'switch', binds: [`items/${part}/visible`], default: false });
/** The frame the parts are turned on in, by their toggles: after the first frame. */
export const TURN_ON = 3;

/** A document's issue names `word` when its path, step, IDs, item or message holds it whole (not its `actual` value or
 * its generic `fix`). */
export function issueNames(issue: JsonObject, word: string): boolean {
  const fields: string[] = [];
  for (const k of ['path', 'step', 'item', 'output', 'operator', 'material', 'what', 'message']) if (typeof issue[k] === 'string') fields.push(issue[k] as string);
  if (Array.isArray(issue['ids'])) for (const id of issue['ids']) if (typeof id === 'string') fields.push(id);
  return fields.some((f) => hasWord(f, word));
}

// ---------------------------------------------------------------------------------------------------
// The plates. `mark.box@1`'s faces carry uv0 from 0 to 1 across them (the base's unit box): on the front face u runs
// along the box's own +x and v along its own −y. A 1 cm thick box, its front face at z = 0, facing the camera at +Z.

/** A plate whose u runs along +x and v down the frame (−y): the plain box. */
export const plate = (w: number, h: number, pos: [number, number], mat: string): JsonObject => box([w, h, 0.01], [pos[0], pos[1], -0.005], mat);
/** AC4's and AC5's plate: mirrored in y, so its u runs along +x and its v up (+y), tangent handedness +1. */
export const plateUp = (w: number, pos: [number, number], mat: string): JsonObject => box([w, w, 0.01], [pos[0], pos[1], -0.005], mat, { scale: [1, -1, 1] });
/** AC4's twin: turned half a turn about its normal, so its u runs the other way (−x) and its v up, handedness −1. */
export const twinUp = (w: number, pos: [number, number], mat: string): JsonObject => box([w, w, 0.01], [pos[0], pos[1], -0.005], mat, { rot: [0, 0, 180] });

/** Where the pixels of `parts` show in `a` and `b` both, `r` px inside them in each (MSAA mixes parts at silhouettes),
 * each named by the part it shows in `a`; `skip` drops pixels by position. */
export function judgedPixels(a: Drawn, partsA: readonly string[], b: Drawn, partsB: readonly string[], r: number, skip: (x: number, y: number) => boolean = () => false): { x: number; y: number; part: string }[] {
  const out: { x: number; y: number; part: string }[] = [];
  for (let y = 0; y < a.ids.height; y++) for (let x = 0; x < a.ids.width; x++) {
    if (skip(x, y) || !insideAt(a.ids, partsA, x, y, r) || !insideAt(b.ids, partsB, x, y, r)) continue;
    out.push({ x, y, part: a.ids.at(x, y)! });
  }
  return out;
}
/** Where one of `parts` shows in `a` and the same part in `b`, `r` px inside it in each, named by that part. */
export function samePartPixels(a: Drawn, b: Drawn, parts: readonly string[], r: number): { x: number; y: number; part: string }[] {
  const out: { x: number; y: number; part: string }[] = [];
  for (let y = 0; y < a.ids.height; y++) for (let x = 0; x < a.ids.width; x++) {
    const part = a.ids.at(x, y);
    if (part === null || !parts.includes(part) || !insideAt(a.ids, [part], x, y, r) || !insideAt(b.ids, [part], x, y, r)) continue;
    out.push({ x, y, part });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// AC1's coat plate, AC3's velvet and AC7's coat picture: a 1 m plate under a sun and the studio environment, seen from
// below its centre, the split at uv0.u = 0.5 falling on x = 0, which the camera's centre line holds.

export const SPLIT_SIZE: Size = [512, 512];
const SPLIT_CAM = camera([0, -0.55, 1.35], [0, 0, 0], 45);
/** Whether pixel x lies within one pixel of the split's column: the split line x = 0 falls on the frame's centre line. */
export const atSplit = (x: number): boolean => Math.abs(x + 0.5 - SPLIT_SIZE[0] / 2) < 1;
/** The coat plate's material: a red dielectric with the issue's coat of 0.5. */
export const COATED: JsonObject = { base_color: [0.55, 0.12, 0.1, 1], metallic: 0, roughness: 0.55, coat: 0.5, coat_roughness: 0.08 };
const coatLight = (): Record<string, JsonObject> => ({ cam: SPLIT_CAM, sky: STUDIO_SKY, sun: sun(2, [-35, 20, 0]) });
/** The plate whose operator `op` writes coat `left` where uv0.u < 0.5 and `right` elsewhere. */
export function coatOpDoc(name: string, op: string, left: number, right: number): JsonObject {
  return sessionDoc(name, SPLIT_SIZE, {
    ...coatLight(),
    [op]: materialOp(`#486 AC1: coat ${left} where uv0.u < 0.5, ${right} elsewhere.`, splitSteps(left, right), { coat: 'w' }),
    coated: material(COATED, op),
    plate: plate(1, 1, [0, 0], 'coated'),
  });
}
/** The same plate drawn as two halves, coat `left` on the left one and `right` on the right one, with no operator. */
export function coatHalvesDoc(name: string, left: number, right: number): JsonObject {
  return sessionDoc(name, SPLIT_SIZE, {
    ...coatLight(),
    coat_l: material({ ...COATED, coat: left }), coat_r: material({ ...COATED, coat: right }),
    left: plate(0.5, 1, [-0.25, 0], 'coat_l'), right: plate(0.5, 1, [0.25, 0], 'coat_r'),
  });
}

// AC3's velvet: the same plate seen at a grazing angle, where sheen shows, its operator `glaze` writing sheen 0.6 where
// uv0.u < 0.5 and 0 elsewhere; `bare` is the velvet with sheen weight 0.
const VELVET_CAM = camera([0, -1.1, 0.75], [0, 0, 0], 42);
const SHEEN_COLOR = [1, 0.85, 0.7, 1];
export const VELVET: JsonObject = { base_color: [0.08, 0.05, 0.25, 1], metallic: 0, roughness: 0.7, sheen: { weight: 0.6, color: SHEEN_COLOR, roughness: 0.35 } };
export const BARE: JsonObject = { ...VELVET, sheen: { weight: 0, color: SHEEN_COLOR, roughness: 0.35 } };
export const GLAZE = (): JsonObject => materialOp('#486 AC3: sheen 0.6 where uv0.u < 0.5, 0 elsewhere.', splitSteps(0.6, 0), { sheen: 'w' });
export const POLISH = (): JsonObject => materialOp('#486 AC3: coat roughness 0.2.', { cr: f32(0.2) }, { coat_roughness: 'cr' });
const velvetLight = (): Record<string, JsonObject> => ({ cam: VELVET_CAM, sky: STUDIO_SKY, sun: sun(3, [-20, 60, 0]) });
/** The velvet plate under `glaze`, the plate as velvet and bare halves, and the bare plate. */
export const velvetOpDoc = (): JsonObject => sessionDoc('velvet-op', SPLIT_SIZE, { ...velvetLight(), glaze: GLAZE(), velvet: material(VELVET, 'glaze'), plate: plate(1, 1, [0, 0], 'velvet') });
export const velvetHalvesDoc = (): JsonObject => sessionDoc('velvet-halves', SPLIT_SIZE, {
  ...velvetLight(), velvet_plain: material(VELVET), bare: material(BARE), left: plate(0.5, 1, [-0.25, 0], 'velvet_plain'), right: plate(0.5, 1, [0.25, 0], 'bare'),
});
export const bareDoc = (): JsonObject => sessionDoc('bare', SPLIT_SIZE, { ...velvetLight(), bare: material(BARE), plate: plate(1, 1, [0, 0], 'bare') });
/** A live session's document: `part`, a plate of material `mat` (whose params and operator are given), hidden until its
 * toggle `show` turns it on. */
export function toggledDoc(name: string, mat: string, params: JsonObject, op: string, opItem: JsonObject, part: string): JsonObject {
  return sessionDoc(name, [320, 320], { ...velvetLight(), [op]: opItem, [mat]: material(params, op), [part]: plate(1, 1, [0, 0], mat) }, { controls: { show: showToggle(part) } });
}

// ---------------------------------------------------------------------------------------------------
// AC2's occlusion plate: the 1 m stone plate under a sun and the studio environment, inside a reflection probe, an
// emissive square on it; both materials run the same operator.

export const OCC_SIZE: Size = [512, 512];
const STONE: JsonObject = { base_color: [0.6, 0.6, 0.58, 1], metallic: 0, roughness: 0.5 };
const LAMP: JsonObject = { base_color: [0.1, 0.1, 0.1, 1], metallic: 0, roughness: 0.5, emission: [1, 0.5, 0.125], emission_strength: 4 };
/** `env`: the studio environment and the probe, or neither (the environment's lighting and the probes removed);
 * `occlusion`: the value the operator `occ` writes on both parts, or none for no operator. */
export function occlusionDoc(name: string, env: boolean, occlusion: number | null): JsonObject {
  const op = occlusion === null ? undefined : 'occ';
  return sessionDoc(name, OCC_SIZE, {
    cam: SPLIT_CAM, sky: env ? STUDIO_SKY : DARK_SKY, sun: sun(3, [-35, 20, 0]),
    ...(env ? { probe: PROBE } : {}),
    ...(op ? { occ: materialOp(`#486 AC2: occlusion ${occlusion} everywhere.`, { o: f32(occlusion!) }, { occlusion: 'o' }) } : {}),
    stone: material(STONE, op), lamp: material(LAMP, op),
    plate: plate(1, 1, [0, 0], 'stone'),
    square: box([0.3, 0.3, 0.004], [0.15, 0.1, 0.003], 'lamp'),
  });
}

// ---------------------------------------------------------------------------------------------------
// AC4's relief plates: the 1 m plate (handedness +1) and its twin (u the other way, handedness −1) side by side, white,
// diffuse only (specular level 0 leaves the Lambertian lobe alone), each under `relief`: height 0.2 × uv0.v m through
// core.bump@1 at strength 1, its normal the material's `normal`. Lit by one of three unshadowed suns of π lx, so a pixel
// reads n · l.

export const RELIEF_SIZE: Size = [640, 320];
export const RELIEF_CAM = { position: [0, 0, 2.6] as V3, target: [0, 0, 0] as V3, fov: 50 };
/** The three suns' `at.rot`: straight on, 40° toward +x, 40° toward +y. */
export const RELIEF_SUNS: V3[] = [[0, 0, 0], [0, 40, 0], [-40, 0, 0]];
export const SLOPE = 0.2;
export const ANALYTIC = reliefNormal(SLOPE);
const CHALK: JsonObject = { base_color: [1, 1, 1, 1], metallic: 0, roughness: 1, specular_level: 0 };
export const RELIEF = (): JsonObject => materialOp('#486 AC4: relief from height 0.2 × uv0.v m by core.bump@1.', {
  ...UV, h: { op: 'mul@1', args: { a: 'v', b: SLOPE } }, relief_call: bumpCall('h'),
}, { normal: 'relief_call.normal' });
export function reliefDoc(k: number): JsonObject {
  return sessionDoc(`relief-sun${k}`, RELIEF_SIZE, {
    cam: camera(RELIEF_CAM.position, RELIEF_CAM.target, RELIEF_CAM.fov), sky: DARK_SKY, sun: sun(Math.PI, RELIEF_SUNS[k]!),
    relief: RELIEF(), chalk: material(CHALK, 'relief'),
    plate: plateUp(1, [-0.6, 0], 'chalk'), twin: twinUp(1, [0.6, 0], 'chalk'),
  });
}
/** The same call inside a repeat of 4 trips with a stop_if: the call is `relief_call`, in the repeat's body. */
export function loopedReliefDoc(): JsonObject {
  return sessionDoc('relief-loop', [320, 320], {
    cam: camera(RELIEF_CAM.position, RELIEF_CAM.target, RELIEF_CAM.fov), sky: DARK_SKY, sun: sun(Math.PI, [0, 0, 0]),
    relief_loop: materialOp('#486 AC4: core.bump@1 called inside a repeat with a stop_if.', {
      ...UV, h: { op: 'mul@1', args: { a: 'v', b: SLOPE } },
      march: {
        op: 'repeat@1',
        args: {
          count: 4, index: 'k', accumulate: { acc: 0 },
          body: {
            relief_call: bumpCall('h'),
            nz: { op: 'split@1', args: { x: 'relief_call.normal', pick: 'z' } },
            acc: { op: 'add@1', args: { a: 'acc', b: 'nz' } },
            stop: { op: 'ge@1', args: { a: 'acc', b: 2 } },
          },
          stop_if: 'stop',
        },
      },
      col: { op: 'compose@1', args: { x: 'march.acc', y: 'march.acc', z: 'march.acc' } },
    }, { base_color: 'col' }),
    chalk: material(CHALK, 'relief_loop'),
    plate: plateUp(1, [0, 0], 'chalk'),
  });
}

// ---------------------------------------------------------------------------------------------------
// AC5's coated plate: a 2 m red metal plate (roughness 0.2) under a coat of 1 (coat roughness 0.1) whose operator
// `coat_tilt` writes a coat normal tilted atan 0.2 = 11.31° toward −v (the plate's v runs up), under one sun 45° from the
// normal on the −v side, seen from above so both lobes' peaks fall on the frame's centre column.

export const COAT_SIZE: Size = [512, 512];
export const COAT_CAM = { position: [0, 0.6, 1.0] as V3, target: [0, -0.067, 0] as V3, fov: 45 };
export const COAT_SUN: V3 = [45, 0, 0];
export const COAT_LOBES = { roughness: 0.2, coatRoughness: 0.1, coat: 1, baseF0: [1, 0, 0] as V3 };
export function coatTiltDoc(): JsonObject {
  return sessionDoc('coat-tilt', COAT_SIZE, {
    cam: camera(COAT_CAM.position, COAT_CAM.target, COAT_CAM.fov), sky: DARK_SKY, sun: sun(1, COAT_SUN),
    coat_tilt: materialOp('#486 AC5: a coat normal tilted 11.31° toward −v.', { cn: vec3(ANALYTIC) }, { coat_normal: 'cn' }),
    lacquer: material({ base_color: [1, 0, 0, 1], metallic: 1, roughness: COAT_LOBES.roughness, coat: COAT_LOBES.coat, coat_roughness: COAT_LOBES.coatRoughness }, 'coat_tilt'),
    plate: plateUp(2, [0, 0], 'lacquer'),
  });
}

// ---------------------------------------------------------------------------------------------------
// AC6: a material whose operator writes every lobe output the issue lists, each lobe on in the material, and the white
// furnace's eight lobes at full strength.

/** A material with every lobe on (off 0, its color off white), at half strength. */
export const LACQUER: JsonObject = {
  base_color: [0.6, 0.3, 0.2, 1], metallic: 0, roughness: 0.5, coat: 0.5, coat_roughness: 0.1,
  sheen: { weight: 0.5, color: [1, 1, 1, 1], roughness: 0.5 }, specular_color: [0.9, 0.9, 1], anisotropy: { strength: 0.5, rotation: 0 },
  translucency: { kind: 'thin', amount: 0.5 }, transmission: 0.5, subsurface: { weight: 0.5 }, iridescence: { weight: 0.5, thickness: 400 },
  diffuse_roughness: 0.5,
};
/** Its operator: each of the issue's lobe outputs, a constant. */
export const LACQUER_OP = (): JsonObject => materialOp('#486 AC6: every lobe output, each a constant.', {
  coat: f32(1), coat_roughness: f32(0.2), coat_normal: vec3([0, 0, 1]), sheen: f32(1), sheen_color: vec3([1, 0.9, 0.8]), sheen_roughness: f32(0.4),
  specular_level: f32(0.5), specular_color: vec3([1, 0.95, 0.9]), anisotropy: vec2([0.5, 30]), translucency: f32(0.5), transmission: f32(0.5),
  subsurface: f32(0.5), iridescence_thickness: f32(300), diffuse_roughness: f32(0.5),
}, {
  coat: 'coat', coat_roughness: 'coat_roughness', coat_normal: 'coat_normal', sheen: 'sheen', sheen_color: 'sheen_color', sheen_roughness: 'sheen_roughness',
  specular_level: 'specular_level', specular_color: 'specular_color', anisotropy: 'anisotropy', translucency: 'translucency', transmission: 'transmission',
  subsurface: 'subsurface', iridescence_thickness: 'iridescence_thickness', diffuse_roughness: 'diffuse_roughness',
});

/** The furnace's lobes: each its output at full strength (value 1), the field that has the lobe at half strength, and
 * the same field at full strength (the field-driven twin). */
interface FurnaceLobe { lobe: string; full: JsonValue; half: JsonObject; fieldFull: JsonObject }
export const FURNACE_LOBES: FurnaceLobe[] = [
  { lobe: 'coat', full: 1, half: { coat: 0.5 }, fieldFull: { coat: 1 } },
  { lobe: 'sheen', full: 1, half: { sheen: { weight: 0.5, color: [1, 1, 1, 1] } }, fieldFull: { sheen: { weight: 1, color: [1, 1, 1, 1] } } },
  { lobe: 'translucency', full: 1, half: { translucency: { kind: 'thin', amount: 0.5 } }, fieldFull: { translucency: { kind: 'thin', amount: 1 } } },
  { lobe: 'transmission', full: 1, half: { transmission: 0.5 }, fieldFull: { transmission: 1 } },
  { lobe: 'subsurface', full: 1, half: { subsurface: { weight: 0.5 } }, fieldFull: { subsurface: { weight: 1 } } },
  { lobe: 'specular_level', full: 1, half: { specular_level: 0.5 }, fieldFull: { specular_level: 1 } },
  { lobe: 'anisotropy', full: [1, 0], half: { anisotropy: { strength: 0.5, rotation: 0 } }, fieldFull: { anisotropy: { strength: 1, rotation: 0 } } },
  { lobe: 'diffuse_roughness', full: 1, half: { diffuse_roughness: 0.5 }, fieldFull: { diffuse_roughness: 1 } },
];
export const FURNACE_SIZE: Size = [640, 320];
const WHITE: JsonObject = { base_color: [1, 1, 1, 1], metallic: 0, roughness: 0.5 };
/** Ball k's centre: a 4 × 2 grid, 0.5 m apart, under the 2 m wide orthographic view. */
const ballAt = (k: number): V3 => [-0.75 + 0.5 * (k % 4), k < 4 ? 0.25 : -0.25, 0];
/** The furnace with a white ball per lobe, `ball_<lobe>`: through its operator (`fromOutputs`), or by its field. */
export function furnaceDoc(fromOutputs: boolean): JsonObject {
  const items: Record<string, JsonObject> = { cam: ortho(2), sky: FURNACE_SKY };
  FURNACE_LOBES.forEach((l, k) => {
    const value: JsonObject = Array.isArray(l.full) ? vec2(l.full as [number, number]) : f32(l.full as number);
    if (fromOutputs) items[`full_${l.lobe}`] = materialOp(`#486 AC6: ${l.lobe} at full strength.`, { x: value }, { [l.lobe]: 'x' });
    items[`white_${l.lobe}`] = material({ ...WHITE, ...(fromOutputs ? l.half : l.fieldFull) }, fromOutputs ? `full_${l.lobe}` : undefined);
    items[`ball_${l.lobe}`] = ball(0.2, ballAt(k), `white_${l.lobe}`);
  });
  return sessionDoc(fromOutputs ? 'furnace-outputs' : 'furnace-fields', FURNACE_SIZE, items);
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

// ---------------------------------------------------------------------------------------------------
// AC7's relief picture: ripples 3 mm high, six to the metre each way, through core.bump@1 on a clay plate under a low
// sun and the studio environment.

export function ripplesDoc(): JsonObject {
  const k = 2 * Math.PI * 6;
  return sessionDoc('ripples', [640, 640], {
    cam: camera([0, -0.9, 1.3], [0, 0, 0], 45), sky: STUDIO_SKY, sun: sun(3, [-70, 30, 0]),
    ripples: materialOp('#486 AC7: ripples through core.bump@1.', {
      ...UV, fu: { op: 'mul@1', args: { a: 'u', b: k } }, fv: { op: 'mul@1', args: { a: 'v', b: k } },
      su: { op: 'sin@1', args: { x: 'fu' } }, sv: { op: 'sin@1', args: { x: 'fv' } }, s: { op: 'add@1', args: { a: 'su', b: 'sv' } },
      h: { op: 'mul@1', args: { a: 's', b: 0.003 } }, relief_call: bumpCall('h'),
    }, { normal: 'relief_call.normal' }),
    clay: material({ base_color: [0.72, 0.6, 0.48, 1], metallic: 0, roughness: 0.45 }, 'ripples'),
    plate: plateUp(1, [0, 0], 'clay'),
  });
}
