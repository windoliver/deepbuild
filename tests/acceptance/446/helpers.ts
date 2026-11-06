// Test-side tools for the #446 acceptance tests: the base's `deep-gpu` binary (#377's GPU layer with #378's `view3d`,
// #421's shading core, #422's light and sky and #424's cutaways), built once per file and driven by JSON lines; the
// calls and fields this suite adds (README: Assumed surfaces); the fixtures the criteria name (the blade and the plank
// that throw soft shadows, the house by day and at night, the engine cut by a plane), shared with the taste test so its
// screenshots are the same scenes; and the reviewed references the criteria are held to: the transform order, #378's
// pinhole, a ray-box hit, the disk's penumbra profile, PNG reading (copied in part from #424's helpers, since suites
// don't import each other). Nothing here stands in for the renderer or the light under test.

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
/** The checkout root (tests/acceptance/446 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text (README: Criteria to tests). */
export const AC = {
  1: 'AC1 #446.0ba58c87',
  2: 'AC2 #446.1a955ffe',
  3: 'AC3 #446.42931fc0',
  4: 'AC4 #446.9f0a17a9',
  5: 'AC5 #446.77ebb2fa',
  6: 'AC6 #446.3834c570',
  7: 'AC7 #446.5786734d',
  8: 'AC8 #446.d9d8c199',
  9: 'AC9 #446.cf21f50f',
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
/** At least one failure, and one that names each of `names`: what a wrong program must give. */
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
/** The GPU layer draws these pixels on macOS's Metal device, the reference platform. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these pixels on macOS's Metal device; this is ${process.platform}`);
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
    dir = mkdtempSync(join(tmpdir(), 'deep-446-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(targetDir(), 'debug', exe('deep-gpu')), join(dir, exe('deep-gpu')));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo ${CARGO_ARGS.join(' ')}`).toBe('');
    return join(dir, exe('deep-gpu'));
  };
}
/** A fresh temporary folder per test (documents, assets, outputs), deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-446-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one JSON line in, one JSON line out (#377).

/** `deep-gpu --planted` names this suite uses, each a wrong program reachable only there (README: Planted programs).
 * `cut_color_only` is #424's, at the base; the rest are new. */
export type GpuPlanted =
  | 'soft_noise_from_frame' | 'local_map_stale' | 'ies_peak_normalized' | 'cascade_unsnapped' | 'cascade_no_penumbra_reach'
  | 'cascade_filter_in_texels' | 'local_map_ignores_t' | 'local_map_rekeys_on_any_t' | 'cut_color_only' | 'cut_key_omits_planes';

/** One process: the calls in order, a reply per call. */
export function runGpu(bin: string, out: string, calls: JsonObject[], planted?: GpuPlanted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const name = `deep-gpu ${args.join(' ')}`;
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${name}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  expect(timedOut, `${name} finished within its timeout`).toBe(false);
  expect(run.status, `${name} exited 0 (${run.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(run.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  expect(lines.length, `${name}: one output line per input line`).toBe(1);
  const answer = obj(lines[0], `${name}: the answer`);
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
/** A physical-basis `look@1`: `tone_map` and `exposure` (EV100) as given, no bloom, no deband. */
export function look(tone_map: 'none' | 'filmic', exposure: number): JsonObject {
  return {
    id: `look-446-${tone_map}-${exposure}`, format: 1, basis: 'physical', license: 'Apache-2.0', description: 'A #446 acceptance look.',
    palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', stone: '#d9dde3', sand: '#e6d3a3' },
    roles: { ground: 'night', ink: 'graphite', muted: 'slate', stone: 'stone', sand: 'sand' },
    themes: { light: {}, dark: {} },
    fonts: {
      body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
      mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
    },
    tone_map, exposure, finish: [], deband: 'none', bloom: 'none', ground_3d: { kind: 'none' },
    status: { ...STATUS }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: 0.1,
    attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
  };
}
/** Tone map none at the exposure whose scale 1 ÷ (1.2 × 2^EV100) is 1: the linear target reads radiance in nits. Every
 * measuring fixture keeps its radiance near 1 at this exposure, so nothing clips. */
export const PLAIN_LOOK = look('none', -Math.log2(1.2));

export const AGENT = 'agent:sess-alpha';
/** A scene document as a session holds it (#378): one writer layer, every item in it, class showpiece, which allows
 * soft and local shadows (Light policy: both Cost lines). `extra` holds the policy, the collections and the channels. */
export function sessionDoc(id: string, size: [number, number], items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #446 acceptance fixture.`, size, camera: 'cam', transport: { span: '10s' },
    requires: { modules: { scene3d: '^1', effects: '^1' } }, budget: { class: 'showpiece' }, layers: { main: { writer: AGENT, title: 'main', order: 'a0' } }, ...extra, items: withIds,
  };
}
export type V3 = [number, number, number];
export const box = (size: V3, pos: V3, extra: JsonObject = {}): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos }, ...extra });
export const camera = (position: V3, target: V3, fov: number, extra: JsonObject = {}): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov, near: 0.1, far: 200, ...extra } });
/** An orthographic `camera@1` looking along −Z at `target`, `view_width` m across the frame. */
export const ortho = (target: V3, viewWidth: number): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'orthographic', position: [target[0], target[1], target[2] + 20], target, view_width: viewWidth, near: 0.1, far: 100 } });
export const material = (params: JsonObject): JsonObject => ({ kind: 'material@1', params });
/** A matte of linear albedo `rho`: no specular lobe, so its radiance under a light is ρ E cos θ ÷ π. */
export const matte = (rho: number, extra: JsonObject = {}): JsonObject => material({ base_color: [rho, rho, rho, 1], roughness: 1, specular_level: 0, ...extra });
/** A sun (`light.sun@1`), shining along its own −Z, aimed by `at.rot` (R = Rz·Ry·Rx, degrees). */
export const sun = (illuminance: number, rot: V3, params: JsonObject = {}): JsonObject =>
  ({ kind: 'light.sun@1', params: { illuminance, color: [1, 1, 1], ...params }, at: { rot } });
// A light's `range` fades it, (1 − (d ÷ range)⁴)² at the base, so a fixture that reads a light's exact illuminance sets a
// range at least 25 times the distance, where the fade is within 0.001.
export const point = (power: number, pos: V3, params: JsonObject = {}): JsonObject => ({ kind: 'light.point@1', params: { power, color: [1, 1, 1], ...params }, at: { pos } });
export const spot = (power: number, pos: V3, rot: V3, params: JsonObject = {}): JsonObject => ({ kind: 'light.spot@1', params: { power, color: [1, 1, 1], ...params }, at: { pos, rot } });
/** A black sky with no ambient and no environment: the document's lights are the only light, the background reads 0. */
export const DARK_SKY: JsonObject = { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } };
/** A linear channel on `path` from `a` at 0 s to `b` at `span` s, holding after. */
export const linearChannel = (path: string, a: number, b: number, span: number): JsonObject =>
  ({ target: path, type: 'f32', keys: { k0: { t: '0s', value: a, interp: 'linear' }, k1: { t: `${span}s`, value: b, interp: 'linear' } } });
/** A patch op on an item's field (#378). */
export const set = (id: string, path: string, value: JsonValue): JsonObject => ({ op: 'set', id, path: `items/${id}/${path}`, value });
/** A `gpu.material@1` item (#429), composed, with the steps and outputs given. */
export const materialOp = (about: string, steps: JsonObject, outputs: JsonObject): JsonObject =>
  ({ kind: 'gpu.material@1', params: { about, origin: 'composed', inputs: {}, steps, outputs, cost: { ns_per_px: 50 } } });

// ---------------------------------------------------------------------------------------------------
// view3d (#378) and what this suite adds to it

export interface Patch { frame: number; writer: string; ops: JsonObject[] }
export interface View3d {
  doc: string; look?: JsonObject; size: [number, number]; from?: number; frames?: number; fps?: number;
  capture?: 'every' | number[]; targets?: ('final' | 'linear' | 'ids')[]; timings?: boolean; assets?: Record<string, string>;
  licenses?: Record<string, JsonObject>; patches?: Patch[]; cascades?: boolean;
  /** This suite's: report each frame's shadow passes and local maps (README: Assumed surfaces 7). */
  shadows?: boolean;
}
export const view3dCall = (v: View3d): JsonObject => ({ call: 'view3d', look: PLAIN_LOOK, frames: 1, capture: [0], ...(v as unknown as JsonObject) });

/** A local shadow map as a frame reports it (README: Assumed surfaces 7). */
export interface LocalMap { light: string; kind: string; key: string; drawn: boolean }
/** A cascade as a frame reports it: `clip`, column-major, is its snapped projection (README: Assumed surfaces 8). */
export interface CascadeMap { key: string; texel_m: number; clip: number[]; drawn: boolean }
export interface ViewFrame {
  frame: number; final: string | null; linear: string | null; ids: string | null; picks: Map<number, string> | null; pixel_hash: string | null;
  gpu_ms: number | null; passes_ms: Map<string, number> | null; shadows: { passes: number; maps: LocalMap[] } | null;
  splits: number[] | null; cascades: CascadeMap[] | null;
}
const optStr = (v: JsonValue | undefined, what: string): string | null => (v === undefined || v === null ? null : str(v, what));
export function framesOf(reply: JsonObject, what: string): ViewFrame[] {
  answered(reply, what);
  return arr(reply['frames'], `${what}: frames`).map((v, i): ViewFrame => {
    const f = obj(v, `${what}: frames[${i}]`); const at = `${what}: frames[${i}]`;
    let picks: Map<number, string> | null = null;
    if (isObject(f['picks'])) picks = new Map(Object.entries(f['picks']).map(([k, id]) => [Number(k), str(id, `${at}.picks[${k}]`)]));
    let shadows: ViewFrame['shadows'] = null;
    if (isObject(f['shadows'])) {
      const s = f['shadows'];
      shadows = {
        passes: num(s['passes'], `${at}.shadows.passes`),
        maps: arr(s['maps'], `${at}.shadows.maps`).map((m, j) => {
          const o = obj(m, `${at}.shadows.maps[${j}]`);
          expect(typeof o['drawn'], `${at}.shadows.maps[${j}].drawn`).toBe('boolean');
          return { light: str(o['light'], 'a map\'s light'), kind: str(o['kind'], 'a map\'s kind'), key: str(o['key'], 'a map\'s key'), drawn: o['drawn'] as boolean };
        }),
      };
    }
    let cascades: CascadeMap[] | null = null;
    let splits: number[] | null = null;
    if (isObject(f['cascades'])) {
      splits = arr(f['cascades']['splits'], `${at}.cascades.splits`).map((d) => num(d, 'a split'));
      cascades = arr(f['cascades']['maps'], `${at}.cascades.maps`).map((m, j) => {
        const o = obj(m, `${at}.cascades.maps[${j}]`);
        expect(typeof o['drawn'], `${at}.cascades.maps[${j}].drawn`).toBe('boolean');
        const clip = arr(o['clip'], `${at}.cascades.maps[${j}].clip`).map((c) => num(c, 'a clip entry'));
        expect(clip.length, `${at}.cascades.maps[${j}].clip holds 16 numbers`).toBe(16);
        return { key: str(o['key'], 'a cascade\'s key'), texel_m: num(o['texel_m'], 'a cascade\'s texel'), clip, drawn: o['drawn'] as boolean };
      });
    }
    return {
      frame: num(f['frame'], `${at}.frame`), final: optStr(f['final'], `${at}.final`), linear: optStr(f['linear'], `${at}.linear`), ids: optStr(f['ids'], `${at}.ids`), picks,
      pixel_hash: optStr(f['pixel_hash'], `${at}.pixel_hash`), gpu_ms: f['gpu_ms'] === undefined ? null : num(f['gpu_ms'], `${at}.gpu_ms`),
      passes_ms: isObject(f['passes_ms']) ? new Map(Object.entries(f['passes_ms']).map(([k, ms]) => [k, num(ms, `${at}.passes_ms.${k}`)])) : null,
      shadows, splits, cascades,
    };
  });
}
export function frameAt(frames: ViewFrame[], n: number, what: string): ViewFrame {
  const f = frames.find((x) => x.frame === n);
  expect(f, `${what}: frame ${n} is in the reply`).toBeDefined();
  return f!;
}
/** The one captured frame of a call. */
export const only = (reply: JsonObject, what: string): ViewFrame => { const f = framesOf(reply, what); expect(f.length, `${what}: one frame`).toBe(1); return f[0]!; };
/** A frame's shadow report, which every `shadows: true` call must carry. */
export function shadowsOf(f: ViewFrame, what: string): NonNullable<ViewFrame['shadows']> {
  expect(f.shadows, `${what}: frame ${f.frame} reports its shadows`).not.toBeNull();
  return f.shadows!;
}
export function cascadesOf(f: ViewFrame, what: string): CascadeMap[] {
  expect(f.cascades, `${what}: frame ${f.frame} reports its cascades`).not.toBeNull();
  return f.cascades!;
}
export function hashOf(f: ViewFrame, what: string): string {
  expect(f.pixel_hash, `${what}: frame ${f.frame} has a pixel hash`).not.toBeNull();
  return f.pixel_hash!;
}
/** The names of the shadow passes a frame's GPU timer saw (README: Assumed surfaces 9). */
export function shadowTimers(f: ViewFrame, what: string): string[] {
  expect(f.passes_ms, `${what}: frame ${f.frame} reports per-pass GPU timings`).not.toBeNull();
  return [...f.passes_ms!.keys()].filter((k) => /shadow|cascade/.test(k));
}

// Targets: files the binary wrote, each named by its SHA-256 (#378).
export function readNamed(out: string, hash: string | null, ext: string, what: string): Buffer {
  expect(hash, `${what} is written, named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${hash}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}
/** The linear target as read back (#378): little-endian f32 RGBA, rows top-down, `w × h × 16` bytes. */
export interface Linear { width: number; height: number; at: (x: number, y: number) => number }
/** Its red channel, enough here: every light and matte in these fixtures is white or grey. */
export function readLinear(out: string, f: ViewFrame, size: [number, number], what: string): Linear {
  const file = readNamed(out, f.linear, 'f32', what);
  expect(file.length, `${what} holds ${size[0]} × ${size[1]} f32 RGBA pixels`).toBe(size[0] * size[1] * 16);
  return { width: size[0], height: size[1], at: (x, y) => file.readFloatLE((y * size[0] + x) * 16) };
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
/** Whether every pixel within `r` px of (x, y) shows `id` (away from its silhouette). */
export function within(ids: Ids, x: number, y: number, id: string | null, r: number): boolean {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (ids.at(x + dx, y + dy) !== id) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------------
// Reviewed references: vectors, the transform order (Units and axes), #378's pinhole, the orthographic view, a box hit.

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
export const rad = (d: number): number => (d * Math.PI) / 180;
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
function basis(cam: Pinhole): { f: V3; r: V3; u: V3; focal: number } {
  const f = unit(sub(cam.target, cam.position));
  const r = unit(cross(f, [0, 1, 0]));
  return { f, r, u: cross(r, f), focal: Math.max(...cam.size) / 2 / Math.tan(rad(cam.fov) / 2) };
}
/** The unit ray through frame point (sx, sy) in px, pixel (x, y)'s centre at (x + 0.5, y + 0.5). */
export function rayAt(cam: Pinhole, sx: number, sy: number): V3 {
  const { f, r, u, focal } = basis(cam);
  return unit(add(add(f, scale(r, (sx - cam.size[0] / 2) / focal)), scale(u, -(sy - cam.size[1] / 2) / focal)));
}
/** Where world point `p` lands in the frame, px (the inverse of `rayAt`), and its view depth. */
export function project(cam: Pinhole, p: V3): [number, number, number] {
  const { f, r, u, focal } = basis(cam);
  const d = sub(p, cam.position); const z = dot(d, f);
  return [cam.size[0] / 2 + (focal * dot(d, r)) / z, cam.size[1] / 2 - (focal * dot(d, u)) / z, z];
}
/** The orthographic view `ortho()` makes: frame px of world point `p`. */
export function orthoProject(target: V3, viewWidth: number, size: [number, number], p: readonly number[]): [number, number] {
  const k = size[0] / viewWidth;
  return [size[0] / 2 + (p[0]! - target[0]) * k, size[1] / 2 - (p[1]! - target[1]) * k];
}
/** The world (x, y) at pixel (px, py)'s centre in that view. */
export function orthoPoint(target: V3, viewWidth: number, size: [number, number], px: number, py: number): [number, number] {
  const k = size[0] / viewWidth;
  return [(px + 0.5 - size[0] / 2) / k + target[0], (size[1] / 2 - py - 0.5) / k + target[1]];
}
/** The entry and exit distances of a ray through a box of `size` centred at `c`, or null. */
export function hitBox(o: V3, d: V3, c: V3, size: V3): [number, number] | null {
  let t0 = -Infinity; let t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    const h = size[k]! / 2; const lo = o[k]! - c[k]!;
    if (Math.abs(d[k]!) < 1e-12) { if (Math.abs(lo) > h) return null; continue; }
    let a = (-h - lo) / d[k]!; let b = (h - lo) / d[k]!;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
  }
  return t0 <= t1 && t1 > 0 ? [t0, t1] : null;
}

// ---------------------------------------------------------------------------------------------------
// Penumbra width. A profile runs across one shadow edge, 1 lit to 0 dark, one sample a pixel. Its width is
// 6 ∫ v (1 − v) dx, which is W for a linear ramp of width W and reads through the per-pixel disk rotation's noise where
// a 10–90% crossing doesn't. The reference is the same measure of the profile a uniform disk of radius R px gives
// behind a straight edge: the share of the disk uncovered at offset u.

export function penumbraWidth(profile: readonly number[]): number {
  return 6 * profile.reduce((sum, v) => { const c = Math.min(Math.max(v, 0), 1); return sum + c * (1 - c); }, 0);
}
export function diskWidth(R: number): number {
  const p: number[] = [];
  for (let u = -R - 2; u <= R + 2; u += 0.25) {
    const k = Math.min(Math.max(u / R, -1), 1);
    p.push((Math.acos(k) - k * Math.sqrt(1 - k * k)) / Math.PI);
  }
  return penumbraWidth(p) * 0.25;
}

// ---------------------------------------------------------------------------------------------------
// The fixtures the criteria name, shared with the taste test (README: Fixtures).

/** AC1's blade: a 0.1 m blade 4 m tall and 3 m wide standing on a plate (the plate faces +Z, so an orthographic view from
 * +Z sees it in plan at 80 px/m), under a sun 45° up from +X, which throws its shadow toward −X. A point on the shadow's
 * side edge y = ±1.5 at x = −s is shaded by the blade's edge s up, √2 s away along the ray, so the penumbra is
 * 2 √2 s tan(angle ÷ 2) across, thin at the foot (s → 0). The plate reads ρ E cos 45° ÷ π = 0.8 lit. */
export const SOFT = { size: [640, 480] as [number, number], width: 8, target: [-1.5, 0, 0] as V3, rot: [0, 45, 0] as V3, lit: 0.8, K: 80 };
const SOFT_POLICY: JsonObject = { soft: { method: 'pcss', max_penumbra: 128 } };
export function bladeDoc(angle: number, opts: { policy?: JsonObject; items?: Record<string, JsonObject>; extra?: JsonObject } = {}): JsonObject {
  return sessionDoc(`blade-${angle}`, SOFT.size, {
    cam: ortho(SOFT.target, SOFT.width), sky: DARK_SKY, grey: matte(0.8),
    plate: box([9, 7, 0.1], [-1.5, 0, -0.05], { material: 'grey' }),
    blade: box([0.1, 3, 4], [0, 0, 2], { material: 'grey' }),
    sun: sun(Math.PI * Math.SQRT2, SOFT.rot, { shadow: true, angle }),
    ...opts.items,
  }, { light_policy: { ...SOFT_POLICY, ...opts.policy }, ...opts.extra });
}
/** AC1's plank: a plank whose straight edge x = 0 hangs 2 m over the plate, under a spot 6 m up on that edge's line
 * aiming down. The penumbra under a light of radius r is 2 r × 2 ÷ 4 = r across at the plate. The plate reads
 * ρ I cos θ ÷ (π d²), 0.8 straight below the spot. */
export const PLANK = { height: 6, power: 1421.2, rho: 0.8 };
export function plankDoc(radius: number): JsonObject {
  return sessionDoc(`plank-${radius}`, SOFT.size, {
    cam: ortho(SOFT.target, SOFT.width), sky: DARK_SKY, grey: matte(PLANK.rho),
    plate: box([9, 7, 0.1], [-1.5, 0, -0.05], { material: 'grey' }),
    plank: box([4, 8, 0.1], [-2, 0, 2], { material: 'grey' }),
    lamp: spot(PLANK.power, [0, 0, PLANK.height], [0, 0, 0], { radius, shadow: true, inner: 28, outer: 30, range: 200 }),
  }, { light_policy: { ...SOFT_POLICY, shadowed: { spots: 1 } } });
}

/** The house, built of boxes (README: Readings): two rooms side by side under a roof, inside x ∈ [−5, 5], z ∈ [−4, 4],
 * 2.7 m tall, a wall between them, and in the south wall (z = 4) two windows at x ∈ ±[1.5, 3.5], y ∈ [0.9, 2.1], glazed
 * under `shadow: auto` unless `glass` says otherwise. By day a 20,000 lx sun and a blue sky; at night two shadowed point
 * lamps, two shadowed downlights and an unshadowed lamp that keeps to its room. The looks are EV 11 by day (a sunlit
 * wall, ρ E cos θ ÷ π ≈ 2,700 nits, times 1 ÷ (1.2 × 2^11) is 1.1 before the filmic curve, so it doesn't white out) and
 * EV 1.5 at night (the floor under a 900 lm lamp 1.9 m up, about 3.8 nits, times 0.29 is 1.1). */
export const HOUSE = {
  size: [800, 500] as [number, number], rho: 0.6, sunRot: [-45, 20, 0] as V3, sun: 20_000,
  dayLook: look('filmic', 11), nightLook: look('filmic', 1.5),
  window: { x: [-3.5, -1.5] as [number, number], y: [0.9, 2.1] as [number, number], z: 4, thick: 0.1 },
};
export function houseDoc(mode: 'day' | 'night', opts: { glass?: 'auto' | 'cast'; cam?: JsonObject; sky?: JsonObject } = {}): JsonObject {
  const h = 2.7; const wall = { material: 'wall' }; const floor = { material: 'floor' };
  const items: Record<string, JsonObject> = {
    cam: opts.cam ?? camera([9.5, 4.2, 14], [0, 1.1, 0], 40),
    sky: opts.sky ?? (mode === 'day'
      ? { kind: 'sky@1', params: { top: [0.25, 0.45, 0.85, 1], low: [0.8, 0.85, 0.9, 1], ambient_top: [450, 520, 650], ambient_low: [260, 240, 210] } }
      : { kind: 'sky@1', params: { top: [0.01, 0.015, 0.05, 1], low: [0.03, 0.04, 0.09, 1], ambient_top: [0.05, 0.07, 0.14], ambient_low: [0.02, 0.02, 0.03] } }),
    wall: matte(HOUSE.rho), floor: matte(HOUSE.rho), wood: matte(0.35), ground_mat: matte(0.25),
    shade_mat: matte(0.8, { emission: [1, 0.8, 0.55, 1], emission_strength: mode === 'night' ? 6 : 0 }),
    glass: material({ base_color: [1, 1, 1, 1], roughness: 0.02, transmission: 1, ior: 1.5, shadow: opts.glass ?? 'auto' }),
    ground: box([60, 0.2, 60], [0, -0.3, 0], { material: 'ground_mat' }),
    floor_l: box([5, 0.2, 8], [-2.5, -0.1, 0], floor), floor_r: box([5, 0.2, 8], [2.5, -0.1, 0], floor),
    roof: box([10.8, 0.2, 8.8], [0, h + 0.1, 0], wall),
    wall_w: box([0.2, h, 8.4], [-5.1, h / 2, 0], wall), wall_e: box([0.2, h, 8.4], [5.1, h / 2, 0], wall),
    wall_n: box([10.4, h, 0.2], [0, h / 2, -4.1], wall), wall_m: box([0.2, h, 8], [0, h / 2, 0], wall),
    wall_s1: box([1.7, h, 0.2], [-4.35, h / 2, 4], wall), wall_s2: box([3, h, 0.2], [0, h / 2, 4], wall), wall_s3: box([1.7, h, 0.2], [4.35, h / 2, 4], wall),
    sill_l: box([2, 0.9, 0.2], [-2.5, 0.45, 4], wall), sill_r: box([2, 0.9, 0.2], [2.5, 0.45, 4], wall),
    head_l: box([2, 0.6, 0.2], [-2.5, 2.4, 4], wall), head_r: box([2, 0.6, 0.2], [2.5, 2.4, 4], wall),
    pane_l: box([2, 1.2, 0.02], [-2.5, 1.5, 4], { material: 'glass' }), pane_r: box([2, 1.2, 0.02], [2.5, 1.5, 4], { material: 'glass' }),
    table_l: box([1.4, 0.75, 0.8], [-3.6, 0.375, -2], { material: 'wood' }), table_r: box([1.4, 0.75, 0.8], [3.6, 0.375, -2], { material: 'wood' }),
    shade_l: box([0.3, 0.3, 0.3], [-2.5, 2.2, 0], { material: 'shade_mat' }), shade_r: box([0.3, 0.3, 0.3], [2.5, 2.2, 0], { material: 'shade_mat' }),
  };
  const collections: JsonObject = {
    living: { members: ['floor_l', 'wall_w', 'wall_m', 'wall_s1', 'sill_l', 'head_l', 'table_l'] },
    furniture_l: { members: ['table_l'] }, furniture_r: { members: ['table_r'] },
  };
  if (mode === 'day') {
    items['sun'] = sun(HOUSE.sun, HOUSE.sunRot, { shadow: true, cascades: 3 });
  } else {
    items['lamp_l'] = point(900, [-2.5, 1.9, 0], { shadow: true, casters: 'furniture_l', radius: 0.05, range: 9 });
    items['lamp_r'] = point(900, [2.5, 1.9, 0], { shadow: true, casters: 'furniture_r', radius: 0.05, range: 9 });
    items['down_l'] = spot(1500, [-3.6, 2.6, -2], [-90, 0, 0], { shadow: true, inner: 25, outer: 35, range: 6 });
    items['down_r'] = spot(1500, [3.6, 2.6, -2], [-90, 0, 0], { shadow: true, inner: 25, outer: 35, range: 6 });
    items['wash'] = point(300, [-4.6, 2.3, 2], { receivers: 'living', range: 8 });
  }
  return sessionDoc(`house-${mode}-${opts.glass ?? 'auto'}`, HOUSE.size, items, {
    collections, light_policy: { soft: { method: 'pcss' }, contact: { length: 0.3, samples: 16 }, shadowed: { spots: 2, points: 2 } },
  });
}
/** The floor points the day's sun reaches through the left window, with a margin: the ray toward the sun, `l`, clears
 * the opening on both faces of the wall. */
export function inSunPool(p: V3, l: V3, margin: number): boolean {
  const w = HOUSE.window;
  return [w.z - w.thick, w.z + w.thick].every((z) => {
    const t = (z - p[2]) / l[2]; const x = p[0] + t * l[0]; const y = p[1] + t * l[1];
    return t > 0 && x > w.x[0] + margin && x < w.x[1] - margin && y > w.y[0] + margin && y < w.y[1] - margin;
  });
}

/** AC8's engine: #424's double-sided block over its crankshaft, with a piston inside whose +X face (0.45 m square, at
 * x = −0.1) looks at the key light, a sun or a spot on the +X side shining along −X. `cut` is a document `cutaway@1`
 * whose plane x > offset faces that light. Through the cut the face receives π lx from the sun, about π lx from the
 * spot, so it reads about 0.8. The camera looks in through the opening. */
export const ENGINE = {
  size: [480, 360] as [number, number], rho: 0.8, offset: 0.2, closed: 1.6, sunE: Math.PI,
  cam: { position: [6, 0.6, 0.8] as V3, target: [-0.3, 0.45, 0] as V3, fov: 30, size: [480, 360] as [number, number] } as Pinhole,
  spot: { pos: [8, 0.475, 0] as V3, power: 2592 },
  face: { x: -0.1, y: [0.25, 0.7] as [number, number], z: [-0.225, 0.225] as [number, number] },
};
export function engineDoc(key: 'sun' | 'spot', shadows: 'cut' | 'whole', offset = ENGINE.offset): JsonObject {
  const c = ENGINE.cam;
  return sessionDoc(`engine-${key}-${shadows}`, ENGINE.size, {
    cam: camera(c.position, c.target, c.fov, { near: 0.1, far: 30 }), sky: DARK_SKY,
    block_mat: material({ base_color: [0.35, 0.45, 0.6, 1], roughness: 0.6, double_sided: true }),
    crank_mat: material({ base_color: [0.85, 0.55, 0.2, 1], roughness: 0.4 }),
    ground_mat: matte(0.3), piston_mat: matte(ENGINE.rho),
    ground: box([20, 0.1, 20], [0, -1.25, 0], { material: 'ground_mat' }),
    block: box([3, 1.5, 1.5], [0, 0, 0], { material: 'block_mat' }),
    crank_shaft: box([3.8, 0.24, 0.24], [0, 0, 0], { material: 'crank_mat' }),
    crank_web1: box([0.18, 0.75, 0.4], [-0.9, 0.18, 0], { material: 'crank_mat' }),
    crank_web2: box([0.18, 0.75, 0.4], [0, -0.18, 0], { material: 'crank_mat' }),
    crank_web3: box([0.18, 0.75, 0.4], [0.9, 0.18, 0], { material: 'crank_mat' }),
    piston: box([0.45, 0.45, 0.45], [-0.325, 0.475, 0], { material: 'piston_mat' }),
    cut: { kind: 'cutaway@1', params: { planes: [{ normal: [1, 0, 0], offset }], class: 'document', shadows } },
    key: key === 'sun' ? sun(ENGINE.sunE, [0, 90, 0], { shadow: true }) : spot(ENGINE.spot.power, ENGINE.spot.pos, [0, 90, 0], { shadow: true, inner: 15, outer: 20, range: 200 }),
  }, { light_policy: { shadowed: { spots: 1 } } });
}
