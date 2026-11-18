// Test-side tools for the #458 acceptance tests, relations group (criteria 10, 12, 13 and 14): the base's `deep-gpu`
// binary (#377's GPU layer, #378's `view3d`, #140's GPU seam with its `adapter` call and test-seam's `--adapters`,
// #380's `decide` and `golden`), built once per file per feature set and driven by JSON lines; the two calls this
// suite adds, `relation` and `full_lane` (README: The surface under test); the documents each relation is held on,
// every one generated here; and this suite's own reading of the targets a relation returns, with the issue's numbers.
// Nothing here stands in for the renderer, the lane's rule, the seam or the golden store under test.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/458/relations is four levels down). */
export const REPO = join(HERE, '..', '..', '..', '..');

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  10: 'AC10 #458.a35e570a',
  12: 'AC12 #458.d7eebc1a',
  13: 'AC13 #458.824452c4',
  14: 'AC14 #458.52b742e2',
} as const;

/** Every `it` passes this: a first cargo build can take many minutes. */
export const TIMEOUT = 3_600_000;

// ---------------------------------------------------------------------------------------------------
// JSON and verdict prefixes

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const shown = (v: JsonValue | undefined, n = 1500): string => JSON.stringify(v)?.slice(0, n) ?? 'undefined';
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${shown(v, 600)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${shown(v, 600)}`).toBe(true);
  return v as JsonValue[];
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${shown(v, 200)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${shown(v, 600)}`).toBe('string');
  return v as string;
}
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const SHA = /^[0-9a-f]{64}$/;
export const clone = <T extends JsonValue>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The criterion stays open, whatever the reason: never a pass (AGENTS.md: the four invariants). */
export function inconclusive(reason: string): never {
  return expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** A platform need is missing here: never a pass. */
export function blocked(reason: string): never {
  return expect.fail(`BLOCKED: ${reason}; this is not a pass`);
}
/** The GPU layer draws these pixels on macOS's Metal device, the reference platform. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these pixels on macOS's Metal device; this is ${process.platform}`);
}
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 12).join('\n  ')}`).toEqual([]);
}
/** A planted program's run: this suite's own check must fail on it, and some failure must name each of `names`. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  for (const name of names) {
    expect(failures.some((f) => f.includes(name)), `${what}: a failure names ${name}; the failures were:\n  ${failures.slice(0, 12).join('\n  ')}`).toBe(true);
  }
}
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

// ---------------------------------------------------------------------------------------------------
// The builds: deep-gpu per feature set, each built once per file and copied out of the target folder.

/** `default` is the shipped build; `test-seam` adds #140's `--adapters`. */
export type Build = 'default' | 'test-seam';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetDir = (): string => (process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target'));
const cargoArgs = (build: Build): string[] => ['build', '--locked', '--bin', 'deep-gpu', ...(build === 'default' ? [] : ['--features', build])];
function cargoBuild(build: Build): string {
  const env = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
  const run = spawnSync('cargo', cargoArgs(build), { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${cargoArgs(build).join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(-4000)}`;
  return '';
}
/** Builds every listed set before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useBuilds(builds: readonly Build[]): (build: Build) => string {
  let dir = '';
  const made = new Map<Build, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-458-relations-bin-'));
    for (const build of builds) {
      const error = cargoBuild(build);
      const bin = join(dir, exe(`deep-gpu-${build}`));
      if (error === '') copyFileSync(join(targetDir(), 'debug', exe('deep-gpu')), bin);
      made.set(build, { bin, error });
    }
  }, TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (build) => {
    const entry = made.get(build);
    if (!entry) throw Error(`the file didn't list the build ${build}`);
    expect(entry.error, `the binary builds: cargo ${cargoArgs(build).join(' ')}`).toBe('');
    return entry.bin;
  };
}
/** A fresh temporary folder per test (documents, outputs, stores), deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-458-relations-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--adapters <file>] [--planted <name>]`: one JSON line in, one JSON line out (#377).

/** The wrong programs this suite adds, each reachable only through `--planted` (README: Planted programs). */
export type Planted =
  | 'exposure_after_tone_map' | 'light_sum_clamped' | 'ortho_camera_snaps_to_grid' | 'shades_by_local_tangent'
  | 'shadow_brightens' | 'instances_skip_normal_target'
  | 'lane_adapter_from_configuration' | 'absolute_f32_world_positions' | 'light_cut_absolute_illuminance';
export interface Startup { planted?: Planted; adapters?: string; env?: Record<string, string> }

/** One process: the calls in order, a reply per call. */
export function runGpu(bin: string, out: string, calls: JsonObject[], startup: Startup = {}): JsonObject[] {
  const args = ['run', ...(startup.adapters ? ['--adapters', startup.adapters] : []), ...(startup.planted ? ['--planted', startup.planted] : [])];
  const name = `deep-gpu ${args.join(' ')}`;
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL', env: { ...process.env, ...(startup.env ?? {}) } });
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
// Files the binary wrote under `out`, each named by its SHA-256, and the pictures in them.

export function readNamed(out: string, hash: JsonValue | undefined, ext: string, what: string): Buffer {
  expect(hash, `${what} is written, named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${hash as string}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}
/** An f32 RGBA image, rows top-down, `w × h × 16` bytes (#378's `linear`, #418's `pre_tone`). */
export interface F32Image { width: number; height: number; data: Float32Array }
export function readF32(out: string, hash: JsonValue | undefined, size: readonly [number, number], what: string): F32Image {
  const file = readNamed(out, hash, 'f32', what);
  expect(file.length, `${what} holds ${size[0]} × ${size[1]} f32 RGBA pixels`).toBe(size[0] * size[1] * 16);
  const data = new Float32Array(size[0] * size[1] * 4);
  for (let i = 0; i < data.length; i++) data[i] = file.readFloatLE(i * 4);
  return { width: size[0], height: size[1], data };
}
export interface Image { width: number; height: number; /** RGBA, row-major. */ rgba: Uint8Array }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** Reads an 8-bit RGB or RGBA PNG with no interlace (copied from #1173's helpers; suites don't import each other). */
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
export function readPng(out: string, hash: JsonValue | undefined, what: string): Image {
  return decodePng(readNamed(out, hash, 'png', what));
}
const CRC = Uint32Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(bytes: Uint8Array): number { let c = 0xffffffff; for (const b of bytes) c = CRC[(c ^ b) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'latin1');
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
}
/** An 8-bit RGB PNG of seeded noise, w × h: a snapshot a blessing can name (over 32 colors, nothing blank). */
export function noisePng(seed: number, width = 64, height = 64): Buffer {
  let a = seed >>> 0;
  const next = (): number => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return (t ^ (t >>> 14)) >>> 0; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width * 3; x++) raw[y * (width * 3 + 1) + 1 + x] = next() & 255;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))]);
}
/** Every file under `dir`, by relative path, with its SHA-256: a golden store's whole state. */
export function listing(dir: string): string[] {
  const walk = (d: string, rel: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name), `${rel}${e.name}/`) : [`${rel}${e.name} ${sha256(readFileSync(join(d, e.name)))}`]);
  return walk(dir, '').sort();
}

// ---------------------------------------------------------------------------------------------------
// Looks and documents (the forms #421's, #425's and #419's suites draw through `view3d`)

/** A physical-basis `look@1`: no tone map, exposure 0 EV, one sample, a 1 px box filter, no bloom, no motion blur. */
export function look(extra: JsonObject = {}): JsonObject {
  return {
    id: 'look-458-relations', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'The #458 relations acceptance look.',
    palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', stone: '#d9dde3', sand: '#e6d3a3' },
    roles: { ground: 'night', ink: 'graphite', muted: 'slate', stone: 'stone', sand: 'sand' },
    themes: { light: {}, dark: {} },
    fonts: {
      body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
      mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
    },
    tone_map: 'none', exposure: 0, finish: [], deband: 'none', bloom: 'none', ground_3d: { kind: 'none' },
    samples: { live: 1, export: 1, at_rest: 'none' }, filter: 'box', filter_px: 1, vary: ['pixel'], sequence: 'r2', motion_blur: 'none',
    status: { pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464' },
    status_treatment: { core_min_px: 4, glyph: { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' } },
    min_distance: 0.1, attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
    ...extra,
  };
}
/** Motion blur by the velocity method (#419's fields at the design's defaults), which builds the velocity target. */
export const VELOCITY_BLUR: JsonObject = {
  scope: 'declared_moves', method: 'velocity', shutter_angle: 180, phase: 'centred', samples: 8, adaptive: true, exclude: [],
  velocity: { taps: 16, max: 32, tile: 20 },
};

export type V3 = [number, number, number];
/** A scene document as a view3d session holds it (#378): an `id`, one writer layer, every item in it. */
export function sceneDoc(id: string, size: [number, number], items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #458 relations acceptance fixture.`, size, camera: 'cam', transport: { span: '2s' },
    requires: { modules: { scene3d: '^1' } }, budget: { class: 'work_product' }, layers: { main: { writer: 'agent:sess-alpha', title: 'main', order: 'a0' } }, ...extra, items: withIds,
  };
}
export const box = (size: V3, pos: V3, mat: string, rot?: V3): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos, ...(rot ? { rot } : {}) }, material: mat });
/** A `ball@1` of 32 segments about its own Y axis: a turn of 45° about Y maps its mesh onto itself. */
export const ball = (radius: number, pos: V3, mat: string, rot?: V3): JsonObject => ({ kind: 'ball@1', params: { radius, segments: 32 }, at: { pos, ...(rot ? { rot } : {}) }, material: mat });
export const material = (params: JsonObject): JsonObject => ({ kind: 'material@1', params });
/** White and diffuse only (#421's photometry floor): its linear value is E ÷ π. */
export const WHITE: JsonObject = material({ base_color: [1, 1, 1, 1], metallic: 0, specular_level: 0, roughness: 1 });
/** A point light with a written range, so no automatic range enters (README: Readings). */
export const point = (power: number, pos: V3, range = 60): JsonObject => ({ kind: 'light.point@1', params: { power, range, color: [1, 1, 1] }, at: { pos } });
/** A sun (`light.sun@1`, shining along its own −Z, aimed by `at.rot` in degrees; [−90, 0, 0] is straight down). */
export const sun = (illuminance: number, rot: V3, shadow: boolean): JsonObject => ({ kind: 'light.sun@1', params: { illuminance, color: [1, 1, 1], shadow }, at: { rot } });
/** A black sky with no ambient and no environment: the lights are the only light. */
export const DARK_SKY: JsonObject = { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } };
const perspective = (position: V3, target: V3, fov = 40): JsonObject => ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov, near: 0.1, far: 200 } });
const linearChannel = (target: string, from: number, to: number, span: string): JsonObject =>
  ({ target, type: 'f32', keys: { k0: { t: '0s', value: from, interp: 'linear' }, k1: { t: span, value: to, interp: 'linear' } } });

// ---------------------------------------------------------------------------------------------------
// The relations and their fixtures (README: The fixtures). A fixture is the sides a relation compares: each side a
// document and a look, drawn at one size and frame.

export interface Side { doc: JsonObject; look: JsonObject }
export interface Fixture {
  relation: Relation; size: [number, number]; frame: number; fps: number; sides: Record<string, Side>;
  /** `ortho-shift` alone: the whole pixels the camera moved, x to the right and y down in the view. */
  k?: [number, number];
  /** glTF bytes the documents name by SHA-256. */
  assets?: Record<string, Buffer>;
}
export const RELATIONS = ['exposure-doubles', 'lights-add', 'ortho-shift', 'sphere-turn', 'occluder-never-brightens', 'instances-keep-hash', 'translation', 'light-level'] as const;
export type Relation = (typeof RELATIONS)[number];
/** The full lane's name for a relation's fixture (the canvas kit's scheme: `parity/<category>/<name>.<profile>`). */
export const fixtureName = (r: Relation): string => `parity/relation/${r}.scene`;

/** The sky's own exposure (Sky `sky@1`: `exposure: EV100`), written so its radiance stays put when a look's exposure
 * changes: unset, a sky takes the look's. */
const SKY_EV = 0;
/** Exposure +1 EV: a lit, shadowed room under a filmic tone map, and the same room one stop up. The look's `exposure`
 * is an EV100 (scale 1 ÷ (1.2 × 2^EV100)), so one stop more exposure is that number less 1 (README: Readings). */
export function exposureFixture(): Fixture {
  const doc = sceneDoc('exposure-458', [320, 200], {
    cam: perspective([4, 3.2, 6], [0, 0.5, 0]),
    sky: { kind: 'sky@1', params: { top: [0.2, 0.3, 0.5, 1], low: [0.4, 0.4, 0.4, 1], ambient_top: [0.08, 0.1, 0.14], ambient_low: [0.04, 0.04, 0.04], exposure: SKY_EV } },
    stone: material({ base_color: [0.6, 0.6, 0.6, 1], roughness: 0.8 }),
    clay: material({ base_color: [0.8, 0.35, 0.2, 1], roughness: 0.5 }),
    floor: box([10, 0.2, 10], [0, -0.1, 0], 'stone'),
    crate: box([1, 1, 1], [-1.2, 0.5, 0.4], 'clay'),
    orb: ball(0.6, [1.1, 0.6, -0.3], 'clay'),
    key: sun(3, [-55, -40, 0], true),
    lamp: point(600, [0.5, 2.5, 1.5]),
  });
  return { relation: 'exposure-doubles', size: [320, 200], frame: 0, fps: 30, sides: { base: { doc, look: look({ tone_map: 'filmic', exposure: 0 }) }, up: { doc, look: look({ tone_map: 'filmic', exposure: -1 }) } } };
}

/** Lights A and B: two 120 lm point lights 2 m over a white diffuse floor, 1 m apart, under a black sky, bloom off.
 * Alone each reads at most 0.76 on the floor; together they read about 1.39 between them, past 1.0. */
export function lightsFixture(): Fixture {
  const doc = (a: boolean, b: boolean): JsonObject => sceneDoc(`lights-458-${a ? 'a' : ''}${b ? 'b' : ''}`, [320, 200], {
    cam: perspective([0, 5, 3.5], [0, 0, 0]),
    sky: DARK_SKY,
    white: WHITE,
    floor: box([10, 0.2, 10], [0, -0.1, 0], 'white'),
    ...(a ? { 'light-a': point(120, [-0.5, 2, 0]) } : {}),
    ...(b ? { 'light-b': point(120, [0.5, 2, 0]) } : {}),
  });
  const l = look();
  return { relation: 'lights-add', size: [320, 200], frame: 0, fps: 30, sides: { a: { doc: doc(true, false), look: l }, b: { doc: doc(false, true), look: l }, ab: { doc: doc(true, true), look: l } } };
}

/** One view pixel in metres for the orthographic fixture: 4 m across 320 px. */
export const ORTHO_M_PER_PX = 4 / 320;
/** An orthographic camera looking along −Z, 4 m across 320 px, over unlit shapes turned off the pixel grid, with no
 * light and so no shadow; `moved` is the same camera moved k = (7, −3) whole pixels in its plane. */
export function orthoFixture(): Fixture {
  const k: [number, number] = [7, -3];
  const doc = (shift: [number, number]): JsonObject => sceneDoc(`ortho-458-${shift[0] === 0 ? 'base' : 'moved'}`, [320, 240], {
    // The view's x runs along world +X and its y down along world −Y.
    cam: { kind: 'camera@1', params: { projection: 'orthographic', target: [shift[0] * ORTHO_M_PER_PX, -shift[1] * ORTHO_M_PER_PX, 0], orbit: { azimuth: 0, elevation: 0, distance: 20 }, view_width: 4 } },
    sky: DARK_SKY,
    red: material({ base_color: [0.9, 0.2, 0.15, 1], unlit: true }),
    blue: material({ base_color: [0.15, 0.3, 0.9, 1], unlit: true }),
    green: material({ base_color: [0.2, 0.8, 0.3, 1], unlit: true }),
    slab: box([1.2, 0.8, 0.4], [-0.7, 0.35, 0], 'red', [0, 0, 20]),
    tile: box([0.9, 0.9, 0.4], [0.8, -0.4, -1], 'blue', [0, 0, 50]),
    dot: ball(0.35, [0.1, 0.55, 1], 'green'),
  });
  const l = look();
  return { relation: 'ortho-shift', size: [320, 240], frame: 0, fps: 30, k, sides: { base: { doc: doc([0, 0]), look: l }, moved: { doc: doc(k), look: l } } };
}

/** An isotropic glossy sphere under a point light on its Y axis, and the same sphere turned 45° about that axis. */
export function sphereFixture(): Fixture {
  const doc = (turn: number): JsonObject => sceneDoc(`sphere-458-${turn}`, [240, 240], {
    cam: perspective([2.3, 2.1, 3.9], [0, 0, 0]),
    sky: DARK_SKY,
    gloss: material({ base_color: [0.8, 0.3, 0.2, 1], metallic: 0, roughness: 0.35 }),
    orb: ball(1, [0, 0, 0], 'gloss', [0, turn, 0]),
    lamp: point(2000, [0, 4, 0]),
  });
  const l = look();
  return { relation: 'sphere-turn', size: [240, 240], frame: 0, fps: 30, sides: { base: { doc: doc(0), look: l }, turned: { doc: doc(45), look: l } } };
}

/** A floor and a pedestal under a sun shining straight down that casts, with no other light; `with` adds an opaque
 * slab 6 m up, above the camera's view, whose shadow falls on the floor in view. */
export function occluderFixture(): Fixture {
  const doc = (withSlab: boolean): JsonObject => sceneDoc(`occluder-458-${withSlab ? 'with' : 'without'}`, [320, 200], {
    cam: perspective([2.4, 4.3, 5.2], [0, 0.3, 0], 35),
    sky: DARK_SKY,
    stone: material({ base_color: [0.6, 0.6, 0.6, 1], roughness: 0.9 }),
    floor: box([10, 0.2, 10], [0, -0.1, 0], 'stone'),
    pedestal: box([0.8, 0.6, 0.8], [-1.4, 0.3, -0.6], 'stone'),
    key: sun(3, [-90, 0, 0], true),
    ...(withSlab ? { slab: box([1.5, 0.2, 1.5], [0.5, 6, 0.3], 'stone') } : {}),
  });
  const l = look();
  return { relation: 'occluder-never-brightens', size: [320, 200], frame: 0, fps: 30, sides: { without: { doc: doc(false), look: l }, with: { doc: doc(true), look: l } } };
}

/** A cube as glTF data: 24 vertices with flat normals, 12 triangles, counter-clockwise from outside. */
function cube(centre: V3, size: number): { positions: number[]; normals: number[]; indices: number[] } {
  const h = size / 2; const positions: number[] = []; const normals: number[] = []; const indices: number[] = [];
  const faces: [V3, V3, V3][] = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]]];
  for (const [n, u, v] of faces) {
    const base = positions.length / 3;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as [number, number][]) {
      for (let c = 0; c < 3; c++) positions.push(centre[c]! + h * (n[c]! + a * u[c]! + b * v[c]!));
      normals.push(...n);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions, normals, indices };
}
/** One JSON glTF with its buffer inline (#420's reader): node 0 is a mesh of two parts (two cubes, one primitive
 * each), node 1 a mesh of the first part alone and node 2 a mesh of the second alone, over the same accessors. */
export function partsGltf(): Buffer {
  const parts = [cube([-0.6, 0.5, 0], 1), cube([0.7, 0.35, 0.2], 0.7)];
  const chunks: Buffer[] = []; const views: JsonObject[] = []; const accessors: JsonObject[] = []; let offset = 0;
  const push = (b: Buffer, accessor: JsonObject): number => { views.push({ buffer: 0, byteOffset: offset, byteLength: b.length }); chunks.push(b); offset += b.length; accessors.push({ bufferView: views.length - 1, ...accessor }); return accessors.length - 1; };
  const f32 = (v: number[]): Buffer => { const b = Buffer.alloc(v.length * 4); v.forEach((x, i) => b.writeFloatLE(x, i * 4)); return b; };
  const u32 = (v: number[]): Buffer => { const b = Buffer.alloc(v.length * 4); v.forEach((x, i) => b.writeUInt32LE(x, i * 4)); return b; };
  const primitives = parts.map((p): JsonObject => {
    const lo = [0, 1, 2].map((c) => Math.min(...p.positions.filter((_, i) => i % 3 === c).map(Math.fround)));
    const hi = [0, 1, 2].map((c) => Math.max(...p.positions.filter((_, i) => i % 3 === c).map(Math.fround)));
    const position = push(f32(p.positions), { componentType: 5126, count: p.positions.length / 3, type: 'VEC3', min: lo, max: hi });
    const normal = push(f32(p.normals), { componentType: 5126, count: p.normals.length / 3, type: 'VEC3' });
    const indices = push(u32(p.indices), { componentType: 5125, count: p.indices.length, type: 'SCALAR' });
    return { attributes: { POSITION: position, NORMAL: normal }, indices, mode: 4 };
  });
  const bin = Buffer.concat(chunks);
  return Buffer.from(JSON.stringify({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0, 1, 2] }],
    nodes: [{ mesh: 0, name: 'whole' }, { mesh: 1, name: 'part-a' }, { mesh: 2, name: 'part-b' }],
    meshes: [{ primitives }, { primitives: [primitives[0]!] }, { primitives: [primitives[1]!] }],
    buffers: [{ byteLength: bin.length, uri: `data:application/octet-stream;base64,${bin.toString('base64')}` }],
    bufferViews: views, accessors,
  }));
}
/** A mesh of two parts sliding under a sun, with velocity blur on so the velocity target is built: as one mesh item,
 * and as an `instance@1` of its two parts, one instance of each, under the same item ID. Frame 15 of 30 fps. */
export function instancesFixture(): Fixture {
  const gltf = partsGltf(); const sha = sha256(gltf);
  const doc = (split: boolean): JsonObject => sceneDoc(`instances-458-${split ? 'instances' : 'mesh'}`, [320, 200], {
    cam: perspective([3, 2.6, 4.6], [0, 0.4, 0]),
    sky: DARK_SKY,
    clay: material({ base_color: [0.8, 0.35, 0.2, 1], roughness: 0.5 }),
    key: sun(3, [-55, -40, 0], false),
    ...(split
      ? {
        'part-a': { kind: 'mesh.asset@1', params: { sha256: sha, node: 1 }, material: 'clay', visible: false },
        'part-b': { kind: 'mesh.asset@1', params: { sha256: sha, node: 2 }, material: 'clay', visible: false },
        thing: { kind: 'instance@1', params: { of: ['part-a', 'part-b'], ids: [0, 1], proto: [0, 1], pos: [[0, 0, 0], [0, 0, 0]] }, at: { pos: [0, 0, 0] } },
      }
      : { thing: { kind: 'mesh.asset@1', params: { sha256: sha, node: 0 }, at: { pos: [0, 0, 0] }, material: 'clay' } }),
  }, { channels: { slide: linearChannel('items/thing/at/pos/0', -0.5, 0.5, '1s') } });
  const l = look({ motion_blur: VELOCITY_BLUR });
  return { relation: 'instances-keep-hash', size: [320, 200], frame: 15, fps: 30, assets: { [sha]: gltf }, sides: { mesh: { doc: doc(false), look: l }, instances: { doc: doc(true), look: l } } };
}

/** Criterion 13's translation, in metres. */
export const TRANSLATION: V3 = [1e7, -3e6, 5e6];
/** The items of the translation fixture that draw; a failure names one of them. */
export const TRANSLATED_ITEMS = ['floor', 'crate', 'post', 'orb', 'mover'] as const;
/** A lit, shadowed, velocity-blurred fixture: a floor, three shapes and a box sliding 4 m/s across the view under a
 * casting sun and a point light, velocity blur on, filmic at 0 EV; frame 15 of 30 fps. `moved` translates every item
 * that has a position, both lights (the sun has a direction only), the camera and the slide's keys by `by`. */
export function translationFixture(): Fixture {
  const doc = (by: V3): JsonObject => {
    const p = (v: V3): V3 => [v[0] + by[0], v[1] + by[1], v[2] + by[2]];
    return sceneDoc(`translation-458-${by[0] === 0 ? 'base' : 'moved'}`, [480, 270], {
      cam: perspective(p([6.8, 4.4, 5.2]), p([0, 0.6, 0])),
      sky: { kind: 'sky@1', params: { top: [0.2, 0.3, 0.5, 1], low: [0.4, 0.4, 0.4, 1], ambient_top: [0.08, 0.1, 0.14], ambient_low: [0.04, 0.04, 0.04] } },
      stone: material({ base_color: [0.6, 0.6, 0.6, 1], roughness: 0.8 }),
      clay: material({ base_color: [0.8, 0.35, 0.2, 1], roughness: 0.5 }),
      teal: material({ base_color: [0.1, 0.55, 0.6, 1], roughness: 0.4 }),
      floor: box([12, 0.2, 12], p([0, -0.1, 0]), 'stone'),
      crate: box([1, 1, 1], p([-1.6, 0.5, 0.8]), 'clay', [0, 25, 0]),
      post: box([0.4, 2, 0.4], p([1.6, 1, -1.2]), 'teal'),
      orb: ball(0.6, p([0.2, 0.6, 1.6]), 'teal'),
      mover: box([0.6, 0.6, 0.6], p([-2, 0.3, -0.4]), 'clay'),
      key: sun(3, [-55, -40, 0], true),
      lamp: point(3000, p([-2, 3, 1.5])),
    }, { channels: { slide: linearChannel('items/mover/at/pos/0', by[0] - 2, by[0] + 2, '1s') } });
  };
  const l = look({ tone_map: 'filmic', motion_blur: VELOCITY_BLUR });
  return { relation: 'translation', size: [480, 270], frame: 15, fps: 30, sides: { base: { doc: doc([0, 0, 0]), look: l }, moved: { doc: doc(TRANSLATION), look: l } } };
}

/** Criterion 14's scale, and the stops of exposure that undo it. */
export const LIGHT_SCALE = 1 / 100;
export const LIGHT_EV = Math.log2(100);
/** The light whose cut the planted policy changes: 800 lm, 11.3 m from the eye. */
export const FAR_LAMP = 'lamp-far';
/** A lit, shadowed room with every kind of light source the criterion names: a casting sun (50 lx), two point lights
 * with written ranges (`lamp-near`, 8,000 lm, 6.4 m from the eye; `lamp-far`, 800 lm, 11.3 m from the eye), a sky with
 * a gradient and ambient light, and an emissive box; bloom on with no threshold. `scaled` multiplies every light's
 * power (the sun's illuminance too), the sky's four colors and the emission's strength by 1/100, and its look raises
 * exposure by log2 100 EV: its `exposure`, an EV100, is that much lower. */
export function lightLevelFixture(): Fixture {
  const doc = (s: number): JsonObject => sceneDoc(`light-level-458-${s === 1 ? 'base' : 'scaled'}`, [320, 200], {
    cam: perspective([0, 3, 8], [0, 0.5, 0]),
    sky: { kind: 'sky@1', params: { top: [0.2 * s, 0.3 * s, 0.5 * s, 1], low: [0.4 * s, 0.4 * s, 0.4 * s, 1], ambient_top: [0.8 * s, 1 * s, 1.4 * s], ambient_low: [0.4 * s, 0.4 * s, 0.4 * s], exposure: SKY_EV } },
    stone: material({ base_color: [0.6, 0.6, 0.6, 1], roughness: 0.8 }),
    clay: material({ base_color: [0.8, 0.35, 0.2, 1], roughness: 0.5 }),
    ember: material({ base_color: [0, 0, 0, 1], roughness: 1, emission: [1, 0.6, 0.2], emission_strength: 40 * s }),
    floor: box([14, 0.2, 14], [0, -0.1, 0], 'stone'),
    crate: box([1, 1, 1], [-1.4, 0.5, 1], 'clay', [0, 25, 0]),
    wall: box([3, 1.6, 0.3], [2, 0.8, -4.2], 'stone'),
    glow: box([0.5, 0.5, 0.5], [0.6, 0.25, 1.6], 'ember'),
    key: sun(50 * s, [-55, -40, 0], true),
    'lamp-near': point(8000 * s, [-1.5, 1.5, 2], 30),
    [FAR_LAMP]: point(800 * s, [2, 1.5, -3], 30),
  });
  const l = (stops: number): JsonObject => look({ exposure: 7 - stops, bloom: { intensity: 0.04, radius: 0.85 } });
  return { relation: 'light-level', size: [320, 200], frame: 0, fps: 30, sides: { base: { doc: doc(1), look: l(0) }, scaled: { doc: doc(LIGHT_SCALE), look: l(LIGHT_EV) } } };
}

// ---------------------------------------------------------------------------------------------------
// The calls (README: The surface under test)

/** Writes a fixture's documents and assets under `dir`; returns the `relation` call and, per side, a `view3d` call
 * of the base that draws the side's document (a fixture check: the document passes the check and draws). */
export function callsFor(dir: string, f: Fixture): { relation: JsonObject; draws: JsonObject[]; sides: string[] } {
  const assets: Record<string, string> = {};
  for (const [sha, bytes] of Object.entries(f.assets ?? {})) { const path = join(dir, `${sha}.gltf`); writeFileSync(path, bytes); assets[sha] = path; }
  const sides: JsonObject = {}; const draws: JsonObject[] = [];
  for (const [name, side] of Object.entries(f.sides)) {
    const doc = writeJson(dir, `${f.relation}-${name}`, side.doc);
    sides[name] = { doc, look: side.look };
    draws.push({ call: 'view3d', doc, look: side.look, size: f.size, class: 'export', fps: f.fps, from: f.frame, frames: 1, capture: 'every', targets: ['final'], ...(f.assets ? { assets } : {}) });
  }
  const relation: JsonObject = { call: 'relation', relation: f.relation, size: f.size, frame: f.frame, fps: f.fps, sides, ...(f.k ? { k: f.k } : {}), ...(f.assets ? { assets } : {}) };
  return { relation, draws, sides: Object.keys(f.sides) };
}
/** A fixture check: the base's `view3d` drew the side's document, frame and all. */
export function drew(reply: JsonObject, what: string): void {
  answered(reply, what);
  const frames = arr(reply['frames'], `${what}: frames`);
  expect(frames.length, `${what}: one frame drawn`).toBe(1);
  expect(obj(frames[0], `${what}: frames[0]`)['final'], `${what}: its final target is written`).toMatch(SHA);
}

export interface Held {
  relation: string; result: string; reason: string;
  /** Each side's targets, by name: the SHA-256 that names its file under `out`. */
  sides: Record<string, Record<string, string>>;
  first: JsonObject | null;
  reply: JsonObject;
}
/** A `relation` reply. */
export function heldOf(reply: JsonObject, f: Fixture, what: string): Held {
  answered(reply, what);
  expect(reply['relation'], `${what}: the reply names its relation`).toBe(f.relation);
  const result = str(reply['result'], `${what}: result`);
  expect(['PASS', 'FAIL'], `${what}: on a hardware adapter a relation that ran is PASS or FAIL, got ${result}: ${shown(reply, 800)}`).toContain(result);
  const sides: Record<string, Record<string, string>> = {};
  const got = obj(reply['sides'], `${what}: sides`);
  for (const name of Object.keys(f.sides)) {
    const targets = obj(got[name], `${what}: sides.${name}`);
    sides[name] = Object.fromEntries(Object.entries(targets).map(([t, h]) => [t, str(h, `${what}: sides.${name}.${t}`)]));
  }
  return { relation: f.relation, result, reason: typeof reply['reason'] === 'string' ? reply['reason'] : '', sides, first: isObject(reply['first']) ? reply['first'] : null, reply };
}
/** The lane's own verdict on a relation that must hold. */
export function lanePasses(h: Held, what: string): void {
  expect(h.result, `${what}: the lane holds ${h.relation}: ${h.reason}`).toBe('PASS');
}
/** The lane's own verdict on a planted program: FAIL, its reason naming the relation. */
export function laneFailsNaming(h: Held, what: string): void {
  expect(h.result, `${what}: the lane fails ${h.relation} on the planted program`).toBe('FAIL');
  expect(h.reason, `${what}: the lane's FAIL names the relation`).toContain(h.relation);
}
function target(h: Held, side: string, name: string, what: string): string {
  const hash = h.sides[side]?.[name];
  expect(hash, `${what}: side ${side} carries its ${name} target (it has ${Object.keys(h.sides[side] ?? {}).join(', ') || 'none'})`).toMatch(SHA);
  return hash!;
}
export const f32Of = (out: string, h: Held, f: Fixture, side: string, name: string, what: string): F32Image => readF32(out, target(h, side, name, what), f.size, `${what}: ${side}'s ${name} target`);
export const pngOf = (out: string, h: Held, side: string, name: string, what: string): Image => readPng(out, target(h, side, name, what), `${what}: ${side}'s ${name} target`);
export const hashOf = (h: Held, side: string, name: string, what: string): string => target(h, side, name, what);

// ---------------------------------------------------------------------------------------------------
// This suite's own reading of a relation, from the files the lane returned

/** Criterion 14's tolerance of a linear pixel, the issue's number: 1e-4 relative. */
export const REL = 1e-4;
/** Criterion 10 gives its float relations no number: two steps of a 16-bit float, 2⁻⁹ relative, the precision the
 * base's linear targets hold (README: Readings). */
export const STEP16 = 2 ** -9;
/** Pixels whose R, G or B in `got` isn't within `tol` relative of `want(x, y, c)`; each failure names `relation` and
 * the pixel. `want` returns null where the relation says nothing. */
export function linearProblems(relation: string, got: F32Image, want: (x: number, y: number, c: number) => number | null, tol: number): string[] {
  const off = (a: number, b: number): boolean => !(Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b)));
  const p: string[] = [];
  for (let y = 0; y < got.height; y++) for (let x = 0; x < got.width; x++) for (let c = 0; c < 3; c++) {
    const w = want(x, y, c); if (w === null) continue;
    const g = got.data[(y * got.width + x) * 4 + c]!;
    if (off(g, w)) { p.push(`${relation}: pixel (${x}, ${y}) channel ${c} reads ${g}, the relation gives ${w}`); break; }
  }
  return p;
}
export const at = (im: F32Image, x: number, y: number, c: number): number => im.data[(y * im.width + x) * 4 + c]!;
/** How many pixels have a channel above `floor`. */
export function brighterThan(im: F32Image, floor: number): number {
  let n = 0;
  for (let i = 0; i < im.data.length; i += 4) if (Math.max(im.data[i]!, im.data[i + 1]!, im.data[i + 2]!) > floor) n++;
  return n;
}
/** How many pixels differ at all between two linear images. */
export function differing(a: F32Image, b: F32Image): number {
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) n++;
  return n;
}
/** Criterion 13's measure over two 8-bit frames: each pixel's largest channel difference in code values. */
export function codeDifferences(a: Image, b: Image): { within1: number; worst: number; worstAt: [number, number]; pixels: number } {
  expect([b.width, b.height], 'the two frames have one size').toEqual([a.width, a.height]);
  let within1 = 0; let worst = 0; let worstAt: [number, number] = [0, 0];
  for (let i = 0; i < a.rgba.length; i += 4) {
    const d = Math.max(Math.abs(a.rgba[i]! - b.rgba[i]!), Math.abs(a.rgba[i + 1]! - b.rgba[i + 1]!), Math.abs(a.rgba[i + 2]! - b.rgba[i + 2]!));
    if (d <= 1) within1++;
    if (d > worst) { worst = d; worstAt = [(i / 4) % a.width, Math.floor(i / 4 / a.width)]; }
  }
  return { within1, worst, worstAt, pixels: a.width * a.height };
}
/** The distinct colors of an 8-bit frame, counted up to `cap`. */
export function colors(im: Image, cap = 64): number {
  const seen = new Set<number>();
  for (let i = 0; i < im.rgba.length && seen.size < cap; i += 4) seen.add((im.rgba[i]! << 16) | (im.rgba[i + 1]! << 8) | im.rgba[i + 2]!);
  return seen.size;
}
