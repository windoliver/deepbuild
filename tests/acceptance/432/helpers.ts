// Test-side tools for the #432 acceptance tests: `deep-gpu` (#377's binary, with #378's `view3d`, #379's `live`, #380's
// and #429's `check_operator`) built once per file and driven by JSON lines, on wgpu's noop backend (`--backend noop`,
// the noop lane) or on macOS's Metal device; the readers of the fields this suite adds (README: The surface under
// test); and the fixture documents every criterion draws, generated here so each step is readable. Nothing here stands
// in for the operator check, the warm-up, the fusion, the meter or the renderer.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/432 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const BIN = 'deep-gpu';

/** Each criterion's ID: the first 8 hex digits of SHA-256 of its text (README: Criteria to tests). */
export const AC = {
  1: 'AC1 #432.e6a02864', 2: 'AC2 #432.e7e1c505', 3: 'AC3 #432.2bdf5706', 4: 'AC4 #432.b131b5d1', 5: 'AC5 #432.5c39ff99', 6: 'AC6 #432.b107949f',
} as const;

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${shown(v)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${shown(v)}`).toBe(true);
  return v as JsonValue[];
}
export const objs = (v: JsonValue | undefined, what: string): JsonObject[] => arr(v, what).map((x, i) => obj(x, `${what}[${i}]`));
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${shown(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${shown(v)}`).toBe('string');
  return v as string;
}
const optStr = (v: JsonValue | undefined): string | null => (typeof v === 'string' ? v : null);
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const SHA = /^[0-9a-f]{64}$/;
/** A 128-bit pipeline key, as 32 lowercase hex digits (Compile, validate and cache: `key`). */
export const KEY = /^[0-9a-f]{32}$/;
export const clone = <T extends JsonValue>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}

// ---------------------------------------------------------------------------------------------------
// The binary: built once per file, copied out of target/debug.

function cargoBuild(): string {
  const args = ['build', '--locked', '--bin', BIN];
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' } });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
/** `deep-gpu`, built once for the file; each test that calls it fails if the build did. */
export function useBin(): () => string {
  let dir = '';
  let bin = '';
  let error = 'the build did not run';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-432-bin-'));
    error = cargoBuild();
    bin = join(dir, BIN);
    if (error === '') copyFileSync(join(process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target'), 'debug', BIN), bin);
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo build --locked --bin ${BIN}`).toBe('');
    return bin;
  };
}
/** A fresh output folder per test, deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-432-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--backend noop] [--planted <name>]`: one scenario `{"out", "calls"}` per line in, one line out (#377).

/** The wrong programs this suite adds, each reachable only through `--planted` (README: Planted programs). */
export type Planted = 'warms_in_use_at_t0' | 'fuses_default_options' | 'warms_view_only';
/** Where a run draws: wgpu's noop backend (the noop lane, no GPU) or the default device (Metal on macOS). */
export type Lane = 'noop' | 'gpu';
export interface RunOptions { lane: Lane; planted?: Planted }

export function run(bin: string, out: string, calls: JsonObject[], o: RunOptions): JsonObject[] {
  const args = ['run', ...(o.lane === 'noop' ? ['--backend', 'noop'] : []), ...(o.planted ? ['--planted', o.planted] : [])];
  const r = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 3_000_000, killSignal: 'SIGKILL' });
  const name = `${BIN} ${args.join(' ')}`;
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${name}: ${r.error.message}`);
  expect(timedOut, `${name} finished within its timeout`).toBe(false);
  const stdout = r.stdout ?? '';
  expect(r.status, `${name} exited 0 (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, `${name}: the answer`);
  expect(answer['ok'], `${name} refused the scenario: ${shown(answer)}`).toBe(true);
  const replies = objs(answer['replies'], 'run: replies');
  expect(replies.length, 'run: one reply per call').toBe(calls.length);
  return replies;
}
export const run1 = (bin: string, out: string, call: JsonObject, o: RunOptions): JsonObject => run(bin, out, [call], o)[0]!;
/** A reply the binary answered, not refused; INCONCLUSIVE when it says the platform can't draw it. */
export function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  return reply;
}
/** Pixels are drawn on macOS's Metal device; elsewhere a test is INCONCLUSIVE, never a pass. */
export function requireGpu(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws on macOS's Metal device, the reference platform; this is ${process.platform}`);
}
/** The reference Macs (technical design: The reference Macs), by `hw.model`. */
export const REFERENCE_MACS = ['Mac15,7', 'Mac15,12'];
/** This machine's `hw.model`, or null off macOS. */
export function macModel(): string | null {
  if (process.platform !== 'darwin') return null;
  try { return execFileSync('sysctl', ['-n', 'hw.model'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
}
/** "Counted on the reference Mac": after the counts held here, INCONCLUSIVE on any other machine. */
export function requireReferenceMac(what: string): void {
  const model = macModel();
  if (!model || !REFERENCE_MACS.includes(model)) inconclusive(`${what} held on the noop lane and on this machine's GPU, but the criterion counts it on a reference Mac (${REFERENCE_MACS.join(' or ')}); hw.model is ${model ?? process.platform}`);
}
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(value));
  return p;
}

// ---------------------------------------------------------------------------------------------------
// Files the binary wrote under `out`, each named by its SHA-256.

export function readNamed(out: string, hash: JsonValue | undefined, ext: string, what: string): Buffer {
  expect(hash, `${what} is written, named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${hash as string}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}
/** An f32 RGBA image, rows top-down, `w × h × 16` bytes (#378's linear target, #418's pre_tone). */
export interface F32Image { width: number; height: number; at: (x: number, y: number) => [number, number, number, number] }
export function f32Image(file: Buffer, size: readonly [number, number], what: string): F32Image {
  expect(file.length, `${what} holds ${size[0]} × ${size[1]} f32 RGBA pixels`).toBe(size[0] * size[1] * 16);
  const o = (x: number, y: number): number => (y * size[0] + x) * 16;
  return {
    width: size[0], height: size[1],
    at: (x, y) => [file.readFloatLE(o(x, y)), file.readFloatLE(o(x, y) + 4), file.readFloatLE(o(x, y) + 8), file.readFloatLE(o(x, y) + 12)],
  };
}
export const readF32Image = (out: string, hash: JsonValue | undefined, size: readonly [number, number], what: string): F32Image =>
  f32Image(readNamed(out, hash, 'f32', what), size, what);

/** How many 10-bit code values `gpu` is from `ref`: 1/1023 of max(1, |ref|) per code, #429's and #431's reading. */
export function codes10(gpu: number, ref: number): number {
  if (!Number.isFinite(gpu) || !Number.isFinite(ref)) return gpu === ref ? 0 : Infinity;
  return (Math.abs(gpu - ref) * 1023) / Math.max(1, Math.abs(ref));
}
/** A seeded generator in [0, 1) (mulberry32), so every fixture is the same on every run. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------------
// Looks and documents

const STATUS: JsonObject = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
/** #424's plain physical look: tone map none at the exposure whose scale is 1, so the linear target is the scene's
 * linear light; no bloom, no deband, no finish effects of its own, no motion blur. */
export const PLAIN_LOOK: JsonObject = {
  id: 'look-432-plain', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'A #432 acceptance look.',
  palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', stone: '#d9dde3' },
  roles: { ground: 'night', ink: 'graphite', muted: 'slate', stone: 'stone' },
  themes: { light: {}, dark: {} },
  fonts: {
    body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
    mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  },
  tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ground_3d: { kind: 'none' },
  status: { ...STATUS }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: 0.1,
  attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
};

export const WRITER = 'agent:sess-alpha';
export const WRITER_B = 'agent:sess-bravo';
export type V3 = [number, number, number];
export type Size = [number, number];
export type Class = 'figure' | 'showpiece';
/** A scene document as a session holds it (#378): an `id`, one writer layer, every item in it; it requires effects. */
export function sceneDoc(id: string, size: Size, items: Record<string, JsonObject>, cls: Class, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #432 acceptance fixture.`, size, camera: 'cam', transport: { span: '10s' },
    requires: { modules: { scene3d: '^1', effects: '^1' } }, budget: { class: cls },
    layers: { main: { writer: WRITER, title: 'main', order: 'a0' } }, ...extra, items: withIds,
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
export const box = (size: V3, pos: V3, extra: JsonObject = {}): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos }, ...extra });
export const ball = (radius: number, pos: V3, segments: number, extra: JsonObject = {}): JsonObject =>
  ({ kind: 'ball@1', params: { radius, segments }, at: { pos }, ...extra });
/** An orthographic camera looking along −Z at the origin, `pxPerM` device px to the metre across a view `width` px wide. */
export const ortho = (width: number, pxPerM: number): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'orthographic', position: [0, 0, 20], target: [0, 0, 0], view_width: width / pxPerM, near: 0.1, far: 100 } });
export const camera = (position: V3, target: V3, fov: number): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov, near: 0.05, far: 100 } });
export const material = (params: JsonObject): JsonObject => ({ kind: 'material@1', params });
export const unlit = (color: V3, extra: JsonObject = {}): JsonObject => material({ base_color: [...color, 1], unlit: true, ...extra });
/** A black sky with no ambient and no environment: the background reads 0. */
export const DARK_SKY: JsonObject = { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } };
export const sun = (rot: V3, params: JsonObject): JsonObject => ({ kind: 'light.sun@1', params: { illuminance: 3, color: [1, 1, 1], ...params }, at: { rot } });
export const spot = (power: number, pos: V3, rot: V3, params: JsonObject): JsonObject => ({ kind: 'light.spot@1', params: { power, color: [1, 1, 1], ...params }, at: { pos, rot } });
export const point = (power: number, pos: V3, params: JsonObject): JsonObject => ({ kind: 'light.point@1', params: { power, color: [1, 1, 1], ...params }, at: { pos } });
/** A rectangle in device px, [x0, y0, x1, y1), as a thin box centred at z under an `ortho` camera. */
export function rectBox(rect: readonly [number, number, number, number], view: Size, pxPerM: number, z: number, extra: JsonObject = {}): JsonObject {
  const [x0, y0, x1, y1] = rect;
  const cx = ((x0 + x1) / 2 - view[0] / 2) / pxPerM; const cy = (view[1] / 2 - (y0 + y1) / 2) / pxPerM;
  return box([(x1 - x0) / pxPerM, (y1 - y0) / pxPerM, 0.02], [cx, cy, z], extra);
}
/** A patch op on an item's field (#378). */
export const set = (id: string, path: string, value: JsonValue): JsonObject => ({ op: 'set', id, path: `items/${id}/${path}`, value });
/** A linear channel on `path` from `a` at `t0` s to `b` at `t1` s, holding before and after. */
export const channel = (path: string, t0: number, a: number, t1: number, b: number): JsonObject =>
  ({ target: path, type: 'f32', keys: { k0: { t: `${t0}s`, value: a, interp: 'linear' }, k1: { t: `${t1}s`, value: b, interp: 'linear' } } });

// Operators: #429's form, as items of the writer's layer (kind `gpu.<kind>@1`, every other field in `params`).
export function asItem(op: JsonObject): JsonObject {
  const params = clone(op);
  delete params['id'];
  delete params['kind'];
  return { kind: `gpu.${op['kind'] as string}@1`, name: `Operator ${op['id'] as string}`, params };
}
/** The frame's color as a pass operator's input (Operator input: `texture: target {op: core, output: color}`). */
export const FRAME_COLOR: JsonObject = { type: 'texture', from: { texture: { target: { op: 'core', output: 'color' } } } };
/** Steps that pick lanes x, y, z of `v` and compose them into a vec3 named `to`. */
export function rgbOf(v: string, to: string): JsonObject {
  return {
    [`${to}_r`]: { op: 'split@1', args: { x: v, pick: 'x' } }, [`${to}_g`]: { op: 'split@1', args: { x: v, pick: 'y' } }, [`${to}_b`]: { op: 'split@1', args: { x: v, pick: 'z' } },
    [to]: { op: 'compose@1', args: { x: `${to}_r`, y: `${to}_g`, z: `${to}_b` } },
  };
}
export interface PassSpec { chain: 'effects' | 'finish'; order: string; resolution: 'full' | 'half'; cost: number; fuse?: 'pixel_wise' | 'none' }
/** A pixel-wise pass over the frame's color: it loads the color at its own pixel (`c`, its rgb as the vec3 `rgb` and
 * its alpha as `ca`), runs `body`, which ends in the vec3 step `res`, and writes `res` with the alpha kept. Every
 * texture read is at its own pixel, so it is pixel-wise (Compile, validate and cache: pass fusion). */
export function colorPass(id: string, body: JsonObject, spec: PassSpec): JsonObject {
  return {
    id, kind: 'pass', origin: 'composed', about: `The #432 fixture ${id}: a pixel-wise pass over the frame's color.`,
    inputs: { src: FRAME_COLOR },
    steps: {
      px: { op: 'pixel@1', args: {} },
      c: { op: 'load@1', args: { tex: 'src', ixy: 'px' } },
      ...rgbOf('c', 'rgb'),
      ca: { op: 'split@1', args: { x: 'c', pick: 'w' } },
      ...body,
      o_r: { op: 'split@1', args: { x: 'res', pick: 'x' } }, o_g: { op: 'split@1', args: { x: 'res', pick: 'y' } }, o_b: { op: 'split@1', args: { x: 'res', pick: 'z' } },
      out: { op: 'compose@1', args: { x: 'o_r', y: 'o_g', z: 'o_b', w: 'ca' } },
    },
    outputs: { color: 'out', blend: 'replace' },
    chain: spec.chain, order: spec.order, resolution: spec.resolution, cost: { ns_per_px: spec.cost }, fallback: 'look',
    ...(spec.fuse ? { fuse: spec.fuse } : {}),
  };
}
// The finish chain's steps (the design's films' and castle's chain: grain, vignette, tint, grade; and a halftone).
/** Grain: a seeded offset per pixel, ±amp/2, from the pixel's hash (no t, so a still frame stays still). */
export const grainBody = (amp: number): JsonObject => ({
  pxx: { op: 'split@1', args: { x: 'px', pick: 'x' } }, pxy: { op: 'split@1', args: { x: 'px', pick: 'y' } },
  h: { op: 'hash@1', args: { a: 'pxx', b: 'pxy' } }, r: { op: 'rand@1', args: { key: 'h' } },
  rc: { op: 'sub@1', args: { a: 'r', b: 0.5 } }, n: { op: 'mul@1', args: { a: 'rc', b: amp } },
  res: { op: 'add@1', args: { a: 'rgb', b: 'n' } },
});
/** Vignette: × (1 − k |uv − ½|²). */
export const vignetteBody = (k: number): JsonObject => ({
  uv: { op: 'screen_uv@1', args: {} }, d: { op: 'sub@1', args: { a: 'uv', b: 0.5 } }, dd: { op: 'dot@1', args: { a: 'd', b: 'd' } },
  kd: { op: 'mul@1', args: { a: 'dd', b: k } }, nk: { op: 'neg@1', args: { x: 'kd' } }, f: { op: 'add@1', args: { a: 'nk', b: 1 } },
  res: { op: 'mul@1', args: { a: 'rgb', b: 'f' } },
});
/** The day tint: × a warm color. */
export const tintDayBody = (): JsonObject => ({
  w: { op: 'const@1', args: { value: [1.06, 1.0, 0.9], type: 'vec3' } }, res: { op: 'mul@1', args: { a: 'rgb', b: 'w' } },
});
/** The night tint: toward a blue of the pixel's luminance, a graph of other steps than the day's. */
export const tintNightBody = (): JsonObject => ({
  l: { op: 'luminance@1', args: { rgb: 'rgb' } }, blue: { op: 'const@1', args: { value: [0.6, 0.7, 1.0], type: 'vec3' } },
  lb: { op: 'mul@1', args: { a: 'blue', b: 'l' } }, res: { op: 'mix@1', args: { a: 'rgb', b: 'lb', t: 0.6 } },
});
/** A grade: toward rgb² by `g`; each g is another literal, so another pipeline key (key: canonical steps and args). */
export const gradeBody = (g: number): JsonObject => ({
  sq: { op: 'mul@1', args: { a: 'rgb', b: 'rgb' } }, res: { op: 'mix@1', args: { a: 'rgb', b: 'sq', t: g } },
});
/** A halftone: paper or ink by whether the pixel's place in a `cell` px screen falls inside a dot sized by its
 * luminance; it reads the color at its own pixel only, so it is pixel-wise. */
export const halftoneBody = (cell: number): JsonObject => ({
  pxf: { op: 'convert@1', args: { x: 'px', to: 'vec2<f32>' } }, q: { op: 'mul@1', args: { a: 'pxf', b: 1 / cell } },
  fq: { op: 'fract@1', args: { x: 'q' } }, cq: { op: 'sub@1', args: { a: 'fq', b: 0.5 } }, d: { op: 'length@1', args: { x: 'cq' } },
  l: { op: 'luminance@1', args: { rgb: 'rgb' } }, lc: { op: 'clamp@1', args: { x: 'l', lo: 0, hi: 1 } }, rad: { op: 'sqrt@1', args: { x: 'lc' } },
  hr: { op: 'mul@1', args: { a: 'rad', b: 0.7 } }, inside: { op: 'lt@1', args: { a: 'd', b: 'hr' } },
  paper: { op: 'const@1', args: { value: [0.95, 0.93, 0.88], type: 'vec3' } }, ink: { op: 'const@1', args: { value: [0.1, 0.1, 0.12], type: 'vec3' } },
  res: { op: 'select@1', args: { f: 'ink', t: 'paper', cond: 'inside' } },
});

// ---------------------------------------------------------------------------------------------------
// `live` (#379's call), with this suite's `input` event, `calibration` field, per-view `created` and
// `operator_pipelines`, and per-pass `key` and `operators` (README: The surface under test).

/** A pipeline created while drawing a frame: its key, the items it was created for, their feature set and the target. */
export interface Created { key: string; items: string[]; feature_set: string; target: string }
export interface OpShare { operator: string; share: number; ms: number }
export interface View { session: string; drawn: boolean; settled: boolean | null; created: Created[]; operator_pipelines: number }
export interface Pass { name: string; session: string | null; start_ns: number; end_ns: number; key: string | null; operators: OpShare[] }
export interface LiveFrame { frame: number; views: View[]; passes: Pass[] }
export interface Live { frames: LiveFrame[]; sessions: JsonObject[]; raw: JsonObject }

export interface Session { session: string; writer: string; doc: string; size: Size }
export interface LiveSpec { frames: number; fps: number; sessions: Session[]; events?: JsonObject[]; report?: string[]; calibration?: boolean }
export const liveCall = (s: LiveSpec): JsonObject => ({ call: 'live', look: PLAIN_LOOK, ...(s as unknown as JsonObject) });
/** An entry on a session's input track, stamped at frame `frame`'s flick, so that frame draws it (README). */
export const inputAt = (frame: number, session: string, control: string, value: JsonValue): JsonObject =>
  ({ frame, input: { session, control, value } });
export const reviseAt = (frame: number, session: string, doc: string): JsonObject => ({ frame, revise: { session, doc } });
/** Frame n of a live call draws t = (n − 1) ÷ fps (#379). */
export const timeOf = (frame: number, fps: number): number => (frame - 1) / fps;
export const seconds = (frame: number, fps: number): string => `${timeOf(frame, fps).toFixed(3)} s`;

function createdRows(v: JsonValue | undefined, at: string): Created[] {
  return objs(v, `${at}.created`).map((c, i) => {
    const w = `${at}.created[${i}]`;
    const key = str(c['key'], `${w}.key`);
    expect(key, `${w}.key is a 128-bit pipeline key`).toMatch(KEY);
    const items = arr(c['items'], `${w}.items`).map((x, j) => str(x, `${w}.items[${j}]`));
    return { key, items, feature_set: str(c['feature_set'], `${w}.feature_set`), target: str(c['target'], `${w}.target`) };
  });
}
export function liveReply(reply: JsonObject, what: string): Live {
  answered(reply, what);
  const frames = objs(reply['frames'], `${what}: frames`).map((f, i): LiveFrame => {
    const at = `${what}: frames[${i}]`;
    return {
      frame: num(f['frame'], `${at}.frame`),
      views: objs(f['views'], `${at}.views`).map((v, j) => ({
        session: str(v['session'], `${at}.views[${j}].session`), drawn: v['drawn'] === true,
        settled: typeof v['settled'] === 'boolean' ? v['settled'] : null,
        created: createdRows(v['created'], `${at}.views[${j}]`),
        operator_pipelines: num(v['operator_pipelines'], `${at}.views[${j}].operator_pipelines`),
      })),
      passes: objs(f['passes'] ?? [], `${at}.passes`).map((p, j) => ({
        name: String(p['name']), session: optStr(p['session']), start_ns: Number(p['start_ns']), end_ns: Number(p['end_ns']),
        key: optStr(p['key']),
        operators: p['operators'] === undefined ? [] : objs(p['operators'], `${at}.passes[${j}].operators`).map((o, k) => ({
          operator: str(o['operator'], `${at}.passes[${j}].operators[${k}].operator`),
          share: num(o['share'], `${at}.passes[${j}].operators[${k}].share`), ms: num(o['ms'], `${at}.passes[${j}].operators[${k}].ms`),
        })),
      })),
    };
  });
  return { frames, sessions: objs(reply['sessions'], `${what}: sessions`), raw: reply };
}
/** One session's view rows, frame by frame. */
export function viewsOf(live: Live, session: string): (View & { frame: number })[] {
  return live.frames.flatMap((f) => f.views.filter((v) => v.session === session).map((v) => ({ ...v, frame: f.frame })));
}
/** The first frame the session drew: its first frame (README: "the first frame" is the first one its view draws). */
export function firstDrawn(live: Live, session: string): number | null {
  return viewsOf(live, session).find((v) => v.drawn)?.frame ?? null;
}
export function sessionRow(live: Live, session: string): JsonObject {
  const s = live.sessions.find((x) => x['session'] === session);
  expect(s, `the live reply has a row for ${session}: ${shown(live.sessions)}`).toBeDefined();
  return s!;
}
/** A created pipeline, named: its items, its feature set, the target it draws into and the time. */
export const named = (c: Created, frame: number, fps: number): string =>
  `at ${seconds(frame, fps)} (frame ${frame}) pipeline ${c.key} was created for ${c.items.join(', ')}, feature set ${c.feature_set}, into ${c.target}`;
/** Every pipeline a session created and every frame that reported settling, after its first frame (or from it, with
 * `fromFirst`), each named; a session that never drew is a problem too. */
export function warmProblems(live: Live, session: string, fps: number, fromFirst = false): string[] {
  const first = firstDrawn(live, session);
  if (first === null) return [`${session} never drew a frame`];
  const out: string[] = [];
  for (const v of viewsOf(live, session)) {
    if (v.frame < first || (v.frame === first && !fromFirst)) continue;
    for (const c of v.created) out.push(`${session}: ${named(c, v.frame, fps)}`);
    if (v.settled === false) out.push(`${session}: at ${seconds(v.frame, fps)} (frame ${v.frame}) the frame reports settling`);
    if (v.settled === null) out.push(`${session}: frame ${v.frame} reports no settled flag`);
  }
  return out;
}
/** The frames, after the first, at which a session created a pipeline. */
export function createdFrames(live: Live, session: string): number[] {
  const first = firstDrawn(live, session) ?? 0;
  return viewsOf(live, session).filter((v) => v.frame > first && v.created.length > 0).map((v) => v.frame);
}
export const createdAt = (live: Live, session: string, frame: number): Created[] =>
  viewsOf(live, session).find((v) => v.frame === frame)?.created ?? [];
/** A session's passes that run operators, frame by frame. */
export function operatorPasses(live: Live, session: string): { frame: number; passes: Pass[] }[] {
  return live.frames
    .map((f) => ({ frame: f.frame, passes: f.passes.filter((p) => p.session === session && p.operators.length > 0) }))
    .filter((x) => x.passes.length > 0);
}

// ---------------------------------------------------------------------------------------------------
// `view3d` (#378's call, with #418's `pre_tone` target).

export interface View3d { doc: string; size: Size; frames?: number; capture?: number[]; targets?: ('linear' | 'pre_tone')[] }
export const view3dCall = (v: View3d): JsonObject => ({ call: 'view3d', look: PLAIN_LOOK, frames: 1, capture: [0], ...(v as unknown as JsonObject) });
export function view3dFrame(reply: JsonObject, n: number, what: string): JsonObject {
  answered(reply, what);
  const f = objs(reply['frames'], `${what}: frames`).find((x) => x['frame'] === n);
  expect(f, `${what}: frame ${n} is in the reply`).toBeDefined();
  return f!;
}

// ---------------------------------------------------------------------------------------------------
// `check_operator` (#380, #429), with this suite's `parts` (README).

export interface Part { of: string; steps: string[]; fetches: number; estimate_ns: number; cost: string }
export interface Checked { outcome: string; issues: JsonObject[]; estimate_ns: number | null; parts: Part[]; raw: JsonObject }
export function checked(reply: JsonObject, what: string): Checked {
  answered(reply, what);
  const parts = reply['parts'] === undefined ? [] : objs(reply['parts'], `${what}: parts`).map((p, i) => ({
    of: str(p['of'], `${what}: parts[${i}].of`), steps: arr(p['steps'], `${what}: parts[${i}].steps`).map((s, j) => str(s, `${what}: parts[${i}].steps[${j}]`)),
    fetches: num(p['fetches'], `${what}: parts[${i}].fetches`), estimate_ns: num(p['estimate_ns'], `${what}: parts[${i}].estimate_ns`), cost: str(p['cost'], `${what}: parts[${i}].cost`),
  }));
  return {
    outcome: str(reply['outcome'], `${what}: outcome`), issues: objs(reply['issues'] ?? [], `${what}: issues`),
    estimate_ns: typeof reply['estimate_ns'] === 'number' ? reply['estimate_ns'] : null, parts, raw: reply,
  };
}

// ---------------------------------------------------------------------------------------------------
// The fixtures. Each is generated here; README: Fixtures gives their numbers.

// AC1: a ball of radius 5 m and 256 segments under an orthographic camera 5.12 m across (512 px at 100 px/m), so its
// front covers every pixel of the frame (the frame's corner is 3.62 m from the centre). Unlit 0.8 grey at adjust opacity
// 0.5 over the black sky: a fade, which draws a depth pass of its own triangles and then its color where depth is equal
// (#424), so every pixel reads linear 0.4. `operator: true` gives its color through a material operator.
export const BALL = { size: [512, 512] as Size, pxPerM: 100, radius: 5, segments: 256, level: 0.8, opacity: 0.5 };
export function ballDoc(id: string, operator: boolean): JsonObject {
  const items: Record<string, JsonObject> = { cam: ortho(BALL.size[0], BALL.pxPerM), sky: DARK_SKY };
  if (operator) {
    items['grey'] = asItem({
      id: 'grey', kind: 'material', origin: 'composed', about: 'The #432 fixture grey: a flat base color from a step.', inputs: {},
      steps: { c: { op: 'const@1', args: { value: [BALL.level, BALL.level, BALL.level], type: 'vec3' } } }, outputs: { base_color: 'c' }, cost: { ns_per_px: 0.1 },
    });
    items['ball_m'] = unlit([1, 1, 1], { op: 'grey' });
  } else {
    items['ball_m'] = unlit([BALL.level, BALL.level, BALL.level]);
  }
  items['ball'] = ball(BALL.radius, [0, 0, 0], BALL.segments, { material: 'ball_m', adjust: { opacity: BALL.opacity } });
  return sceneDoc(id, BALL.size, items, 'showpiece');
}

// AC2: a 480 × 240 view of 32 unlit boxes in an 8 × 4 grid of 60 px squares, seeded colors in [0.05, 0.95], under the
// effects chain grain, vignette, tint and grade, each pixel-wise, at full resolution, declaring 0.1, 0.2, 0.3 and 0.4 ns
// a px, so a fused pass splits by shares 0.1, 0.2, 0.3 and 0.4. `fuse: none` on every operator gives the unfused chain;
// the fused chain leaves `fuse` at its default, pixel_wise.
export const CHAIN = { size: [480, 240] as Size, pxPerM: 100, cell: 60, ops: ['grain', 'vignette', 'tint', 'grade'], costs: [0.1, 0.2, 0.3, 0.4] };
export function chainDoc(id: string, fuse: 'pixel_wise' | 'none'): JsonObject {
  const items: Record<string, JsonObject> = { cam: ortho(CHAIN.size[0], CHAIN.pxPerM), sky: DARK_SKY };
  const rnd = seeded(432);
  for (let row = 0; row < CHAIN.size[1] / CHAIN.cell; row++) {
    for (let col = 0; col < CHAIN.size[0] / CHAIN.cell; col++) {
      const color: V3 = [0.05 + 0.9 * rnd(), 0.05 + 0.9 * rnd(), 0.05 + 0.9 * rnd()];
      items[`m${row}_${col}`] = unlit(color);
      items[`b${row}_${col}`] = rectBox([col * CHAIN.cell, row * CHAIN.cell, (col + 1) * CHAIN.cell, (row + 1) * CHAIN.cell], CHAIN.size, CHAIN.pxPerM, 0, { material: `m${row}_${col}` });
    }
  }
  const bodies = [grainBody(0.04), vignetteBody(0.8), tintDayBody(), gradeBody(0.3)];
  CHAIN.ops.forEach((op, k) => {
    items[op] = asItem(colorPass(op, bodies[k]!, { chain: 'effects', order: `a${k}`, resolution: 'full', cost: CHAIN.costs[k]!, ...(fuse === 'none' ? { fuse } : {}) }));
  });
  return sceneDoc(id, CHAIN.size, items, 'showpiece');
}

// AC3: a composed pass that lifts the frame's color (before: px, c, lift), calls the shipped blur on it (`b`), and dims
// the blurred color (after: dim, out). Whole, it would read 1 + 2 × 31 + 1 fetches, past a pass's 32.
export const SOFT = { before: ['px', 'c', 'lift'], blur: 'b', after: ['dim', 'out'], radius: 6 };
export function softOperator(): JsonObject {
  return {
    id: 'soft', kind: 'pass', origin: 'composed', about: 'The #432 fixture soft: a lift, the shipped blur, then a dim.',
    inputs: { src: FRAME_COLOR }, uses: ['blur@1'],
    steps: {
      px: { op: 'pixel@1', args: {} },
      c: { op: 'load@1', args: { tex: 'src', ixy: 'px' } },
      lift: { op: 'mul@1', args: { a: 'c', b: 1.2 } },
      b: { op: 'use@1', args: { name: 'blur@1', src: 'lift', radius: SOFT.radius } },
      dim: { op: 'mul@1', args: { a: 'b', b: 0.8 } },
      out: { op: 'add@1', args: { a: 'dim', b: 0.02 } },
    },
    outputs: { color: 'out', blend: 'replace' }, chain: 'effects', order: 'a0', resolution: 'full', cost: { ns_per_px: 100 }, fallback: 'look',
  };
}

// AC4: the product figure. A table under a shadowed sun; a cloth whose sheen weight a channel keys from `sheenFrom` at
// 2.9 s to 0.6 at 3 s; a glass ball, opaque, whose transmission the toggle `glass_toggle` sets to 0.9; a lampshade of
// alpha mode mask, its shadow mode none, which the toggle `shade_toggle` sets to cast. The shade is the scene's only
// mask part, so its caster in the sun's map is a feature set no other part brings.
export const PRODUCT = { size: [640, 360] as Size, fps: 30, frames: 181, sheenFrom: 2.9, sheenTo: 3, sheen: 0.6, toggleAt: 4 };
export function productDoc(id: string, sheenStart: number): JsonObject {
  return sceneDoc(id, PRODUCT.size, {
    cam: camera([0, 1.3, 2.6], [0, 0.55, 0], 35), sky: DARK_SKY,
    sun: sun([-45, 30, 0], { shadow: true, cascades: 3 }),
    table_m: material({ base_color: [0.45, 0.35, 0.25, 1], roughness: 0.6 }),
    table: box([2, 0.05, 1.2], [0, 0.4, 0], { material: 'table_m' }),
    cloth_m: material({ base_color: [0.6, 0.1, 0.15, 1], roughness: 0.8, sheen: { weight: sheenStart, color: [1, 1, 1], roughness: 0.5 } }),
    cloth: box([0.8, 0.01, 0.5], [-0.3, 0.43, 0], { material: 'cloth_m' }),
    glass_m: material({ base_color: [0.9, 0.95, 1, 1], roughness: 0.05, transmission: 0, ior: 1.5 }),
    glass: ball(0.12, [0.3, 0.55, 0.1], 64, { material: 'glass_m' }),
    shade_m: material({ base_color: [0.95, 0.9, 0.8, 0.9], roughness: 0.7, alpha_mode: 'mask', alpha_cutoff: 0.5, shadow: 'none' }),
    shade: box([0.3, 0.25, 0.3], [0.6, 0.85, -0.2], { material: 'shade_m' }),
  }, 'figure', {
    channels: { sheen: channel('items/cloth_m/params/sheen/weight', PRODUCT.sheenFrom, sheenStart, PRODUCT.sheenTo, PRODUCT.sheen) },
    controls: {
      glass_toggle: { kind: 'toggle', class: 'document', label: 'Glass', binds: ['items/glass_m/params/transmission'], range: [0, 0.9], default: false },
      shade_toggle: { kind: 'toggle', class: 'document', label: 'Shade shadow', binds: ['items/shade_m/params/shadow'], options: ['none', 'cast'], default: false },
    },
  });
}
/** The frame of the first time after `t` s, and of `t` s itself, at `fps`. */
export const frameAfter = (t: number, fps: number): number => Math.floor(t * fps + 1e-9) + 2;
export const frameAt = (t: number, fps: number): number => Math.round(t * fps) + 1;

// AC4's cap: eleven parts, each its own material with its own pattern (none and the ten shipped), opaque, unlit-free
// and shadow none, under an unshadowed sun: eleven feature sets in use. A variant set `skin` whose options each patch
// every material's alpha mode or unlit flag reaches more: options solid (no patch) and sheer (alpha blend) give 22;
// adding cut (alpha mask) and flat (unlit) gives 44, past the look's 32.
export const PATTERNS = ['none', 'plaster', 'stone_courses', 'roof_tiles', 'wood', 'rock', 'grass', 'cobbles', 'glass_curtain', 'concrete', 'asphalt'];
export const capPart = (k: number): string => `part${k}`;
export const capMaterial = (k: number): string => `skin${k}`;
export function capDoc(id: string, over: boolean): JsonObject {
  const items: Record<string, JsonObject> = { cam: camera([0, 3, 9], [0, 0, 0], 40), sky: DARK_SKY, sun: sun([-40, 20, 0], { shadow: false }) };
  PATTERNS.forEach((p, k) => {
    items[capMaterial(k)] = material({ base_color: [0.3 + 0.05 * k, 0.5, 0.6, 0.7], roughness: 0.5, shadow: 'none', ...(p === 'none' ? {} : { pattern: p }) });
    items[capPart(k)] = box([0.6, 0.6, 0.6], [-5 + k, 0, 0], { material: capMaterial(k) });
  });
  const every = (path: string, value: JsonValue): JsonObject[] => PATTERNS.map((_, k) => set(capMaterial(k), path, value));
  const options: JsonObject[] = [
    { name: 'solid', label: 'Solid', patch: [] },
    { name: 'sheer', label: 'Sheer', patch: every('params/alpha_mode', 'blend') },
  ];
  if (over) options.push({ name: 'cut', label: 'Cut', patch: every('params/alpha_mode', 'mask') }, { name: 'flat', label: 'Flat', patch: every('params/unlit', true) });
  return sceneDoc(id, [640, 360], items, 'figure', {
    variants: { skin: { default: 'solid', options } },
    controls: { skin_choice: { kind: 'choice', class: 'document', label: 'Skin', variant: 'skin' } },
  });
}

// AC5: the finish figure. A still board of boxes under the finish chain grain, vignette, tint and grade (chain finish,
// half resolution, each 0.1 ns a px), with the variant sets `time` (day, night: each sets the tint's steps) and
// `medium` (print: creates the halftone pass after the grade; screen: the empty patch, so the chain has none), each
// picked by a document-class choice control; `grades: true` adds the set `look` of nine options g0 … g8, each setting
// the grade's steps to another blend (g_k = 0.1 + 0.05 k).
export const FINISH = { size: [640, 360] as Size, fps: 30, cost: 0.1 };
export const GRADES = Array.from({ length: 9 }, (_, k) => `g${k}`);
const gradeOf = (k: number): number => 0.1 + 0.05 * k;
const finishSpec = (order: string): PassSpec => ({ chain: 'finish', order, resolution: 'half', cost: FINISH.cost });
/** An operator's steps, as a variant's patch sets them: the item's `params/steps`. */
const stepsOf = (id: string, body: JsonObject, order: string): JsonValue => obj(colorPass(id, body, finishSpec(order))['steps'], `${id}'s steps`);
export function halftoneItem(): JsonObject {
  return { ...asItem(colorPass('halftone', halftoneBody(6), finishSpec('a4'))), id: 'halftone', name: 'halftone', order: 'a900' };
}
export function finishItems(grain = 0.03): Record<string, JsonObject> {
  const items: Record<string, JsonObject> = { cam: ortho(FINISH.size[0], 100), sky: DARK_SKY };
  const rnd = seeded(4320);
  for (let k = 0; k < 8; k++) {
    items[`m${k}`] = unlit([0.1 + 0.8 * rnd(), 0.1 + 0.8 * rnd(), 0.1 + 0.8 * rnd()]);
    items[`b${k}`] = rectBox([(k % 4) * 160, Math.floor(k / 4) * 180, (k % 4 + 1) * 160, (Math.floor(k / 4) + 1) * 180], FINISH.size, 100, 0, { material: `m${k}` });
  }
  items['grain'] = asItem(colorPass('grain', grainBody(grain), finishSpec('a0')));
  items['vignette'] = asItem(colorPass('vignette', vignetteBody(0.8), finishSpec('a1')));
  items['tint'] = asItem(colorPass('tint', tintDayBody(), finishSpec('a2')));
  items['grade'] = asItem(colorPass('grade', gradeBody(gradeOf(0)), finishSpec('a3')));
  return items;
}
export function finishExtra(grades: boolean): JsonObject {
  const variants: JsonObject = {
    time: { default: 'day', options: [
      { name: 'day', label: 'Day', patch: [set('tint', 'params/steps', stepsOf('tint', tintDayBody(), 'a2'))] },
      { name: 'night', label: 'Night', patch: [set('tint', 'params/steps', stepsOf('tint', tintNightBody(), 'a2'))] },
    ] },
    medium: { default: 'screen', options: [
      { name: 'print', label: 'Print', patch: [{ op: 'create', item: halftoneItem() }] },
      { name: 'screen', label: 'Screen', patch: [] },
    ] },
  };
  const controls: JsonObject = {
    time_choice: { kind: 'choice', class: 'document', label: 'Time', variant: 'time' },
    medium_choice: { kind: 'choice', class: 'document', label: 'Medium', variant: 'medium' },
  };
  if (grades) {
    variants['look'] = { default: 'g0', options: GRADES.map((name, k) => ({ name, label: `Grade ${k}`, patch: [set('grade', 'params/steps', stepsOf('grade', gradeBody(gradeOf(k)), 'a3'))] })) };
    controls['look_choice'] = { kind: 'choice', class: 'document', label: 'Grade', variant: 'look' };
  }
  return { variants, controls };
}
export const finishDoc = (id: string, grades: boolean): JsonObject => sceneDoc(id, FINISH.size, finishItems(), 'figure', finishExtra(grades));

// AC6: a shadowed sun of 3 cascades, a shadowed spot aimed straight down and a shadowed point lamp, each reaching an
// opaque crate, a mask-alpha leaf card and an instancer of nine pegs, over a ground; the policy shadows one spot and
// one point lamp.
export const SHADOWS = { size: [640, 360] as Size, casters: { opaque: 'crate', mask: 'leaf', instanced: 'pegs' } };
export function shadowDoc(id: string): JsonObject {
  const ids = Array.from({ length: 9 }, (_, i) => 100 + i);
  return sceneDoc(id, SHADOWS.size, {
    cam: camera([0, 2.5, 4], [0, 0.3, 0], 40), sky: DARK_SKY,
    sun: sun([-50, 30, 0], { shadow: true, cascades: 3 }),
    spot: spot(800, [0, 3, 0], [-90, 0, 0], { shadow: true, radius: 0.05, range: 12 }),
    lamp: point(400, [1, 2.5, 1], { shadow: true, radius: 0.05, range: 12 }),
    ground_m: material({ base_color: [0.6, 0.6, 0.6, 1], roughness: 1 }),
    ground: box([10, 0.1, 10], [0, -0.05, 0], { material: 'ground_m' }),
    crate_m: material({ base_color: [0.7, 0.5, 0.3, 1], roughness: 0.6 }),
    crate: box([0.5, 0.5, 0.5], [-0.8, 0.25, 0], { material: 'crate_m' }),
    leaf_m: material({ base_color: [0.2, 0.6, 0.2, 0.8], roughness: 0.6, alpha_mode: 'mask', alpha_cutoff: 0.5, double_sided: true }),
    leaf: { kind: 'slab@1', params: { size: [0.6, 0.6, 0.02] }, at: { pos: [0, 0.4, 0] }, material: 'leaf_m' },
    peg_m: material({ base_color: [0.3, 0.3, 0.8, 1], roughness: 0.5 }),
    peg: box([0.12, 0.3, 0.12], [0.8, 0.15, -2], { material: 'peg_m' }),
    pegs: { kind: 'instance@1', params: { of: ['peg'], ids, pos: ids.map((_, i) => [0.6 + 0.2 * (i % 3), 0.15, -0.2 + 0.2 * Math.floor(i / 3)]), hidden: [] }, at: { pos: [0, 0, 0] } },
  }, 'showpiece', { light_policy: { shadowed: { spots: 1, points: 1 } } });
}

/** Every fixture document a criterion here plays, by name: AC1's "every fixture document". */
export function everyFixture(): Record<string, JsonObject> {
  return {
    ball: ballDoc('ball-432', false), ball_operator: ballDoc('ball-op-432', true),
    chain: chainDoc('chain-432', 'pixel_wise'), chain_unfused: chainDoc('chain-unfused-432', 'none'),
    product: productDoc('product-432', 0), product_moving: productDoc('product-moving-432', 0.3), cap_under: capDoc('cap-under-432', false),
    finish: finishDoc('finish-432', false), finish_grades: finishDoc('finish-grades-432', true),
    shadows: shadowDoc('shadows-432'),
  };
}
