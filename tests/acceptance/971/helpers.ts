// Test-side tools for the #971 acceptance tests (README: The surface under test). `deep-gpu` (#377's binary, with
// #378's `view3d`) is built once per file and driven by JSON lines. This file adds the criterion IDs, the two planted
// names, the fixture documents (the two walls, the coloured patches, the temple), the look with the design's `local`
// field, the reply readers (the float targets, the final PNG as OKLab), the measures the criteria are held to (log2
// luminance against middle grey, each wall's levels away from its edge), and the perf lane's own five-run judge, read
// from scripts/benchmark.mjs in a child process. #418's helpers are imported for what is #418's and #382's: the look,
// the film with a status binding, the status report's readers, the PNG reader and OKLab. Nothing here stands in for the
// local tone map under test: every value a test compares comes from the binary, every expected value from the issue.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from 'vitest';
import {
  SHA, answered, arr, decodePng, framesOf, linearToOklab, look, luma, obj, sha256, shown, srgbDecode, str,
  type Frame, type Image, type JsonObject, type JsonValue, type Lin,
} from '../418/helpers.ts';

vi.setConfig({ testTimeout: 3_600_000, hookTimeout: 7_200_000 });

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/971 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
/** Every `it` passes this timeout: a first cargo build on the shared Mac takes many minutes. */
export const TIMEOUT = 3_600_000;

/** Each criterion's ID (scripts/proof-change.mjs, `criterionId`: `#971.` and the first 8 hex of SHA-256 of its text). */
export const AC = {
  1: 'AC1 #971.09d7d9af',
  2: 'AC2 #971.5cd62ea3',
  3: 'AC3 #971.fc809ae0',
  4: 'AC4 #971.0e27b835',
  5: 'AC5 #971.8fcd3c09',
  6: 'AC6 #971.a3ad5af8',
  7: 'AC7 #971.f19031be',
  8: 'AC8 #971.ae60e422',
  9: 'AC9 #971.573c2449',
} as const;

// ---------------------------------------------------------------------------------------------------
// Verdict words

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  return expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 20).join('\n  ')}`).toEqual([]);
}
/** Everything here draws on macOS's Metal device, the reference platform; off it, INCONCLUSIVE. */
export function requireGpu(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these pixels on macOS's Metal device; this is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// The build: deep-gpu built once per file and copied out of the target folder.

const CARGO_ARGS = ['build', '--locked', '--bin', 'deep-gpu'];
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
const targetDir = (): string => { const t = process.env['CARGO_TARGET_DIR']; return t ? resolve(REPO, t) : join(REPO, 'target'); };
function cargoBuild(): string {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
    CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
    ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` } : {}),
  };
  const r = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ENOENT') return `BLOCKED: cargo isn't on this machine (looked on PATH and in ${RUSTUP_BIN})`;
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${CARGO_ARGS.join(' ')} failed:\n${(r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Checking|Finished|Downloaded|Downloading|Updating|Locking/.test(l)).join('\n').slice(-4000)}`;
  return '';
}
/** deep-gpu, built once before the file's tests; a test that uses a build that failed fails with cargo's error, and
 * with `BLOCKED:` on a machine with no cargo. */
export function useGpu(): () => string {
  let dir = '';
  let error: string | undefined;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-971-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(targetDir(), 'debug', 'deep-gpu'), join(dir, 'deep-gpu'));
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (): string => {
    if (error?.startsWith('BLOCKED:')) throw Error(error);
    expect(error, `deep-gpu builds: cargo ${CARGO_ARGS.join(' ')}`).toBe('');
    return join(dir, 'deep-gpu');
  };
}
/** A fresh output folder per test, deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-971-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one scenario in, one line out (#377).

/** The wrong programs this suite adds to `deep-gpu run`, each reachable only through `--planted` (README). */
export type Planted = 'local_base_ignores_edges' | 'local_pyramid_fixed_levels';

/** One `deep-gpu` scenario, accepted, with one reply per call, in one process. */
export function runGpu(bin: string, out: string, calls: JsonObject[], planted?: Planted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const label = `deep-gpu ${args.join(' ')}`;
  const r = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 3_000_000, killSignal: 'SIGKILL' });
  const failed = (r.error as NodeJS.ErrnoException | undefined)?.code;
  if (failed === 'ETIMEDOUT') expect.fail(`${label} did not finish within 3,000 s`);
  // A binary that refuses its arguments exits before it reads the scenario, which the write meets as EPIPE; its exit
  // status and its line say so below.
  if (r.error && failed !== 'EPIPE') throw Error(`${label}: ${r.error.message}`);
  expect(r.status, `${label} exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${label}: one output line`).toBe(1);
  let answer: JsonValue;
  try { answer = JSON.parse(lines[0]!) as JsonValue; } catch { return expect.fail(`${label}: its line is JSON: ${lines[0]!.slice(0, 1500)}`); }
  const a = obj(answer, `${label}: the answer`);
  expect(a['ok'], `${label} accepted the scenario: ${shown(a)}`).toBe(true);
  const replies = arr(a['replies'], `${label}: replies`).map((x, i) => obj(x, `${label}: replies[${i}]`));
  expect(replies.length, `${label}: one reply per call`).toBe(calls.length);
  return replies;
}

export type Size = [number, number];
/** The targets this suite reads: the base's `final` and `pre_tone`, and this suite's `pre_curve` (README). */
export type Target = 'final' | 'pre_tone' | 'pre_curve';
/** `view3d` (#378) with the base's fields; nothing added but the target `pre_curve` (README). */
export interface View3d {
  doc: string; look: JsonObject; size: Size; frames?: number; fps?: number; from?: number;
  capture?: 'every' | number[]; targets?: Target[]; timings?: boolean; seeks?: { after: number; to: number }[]; states?: JsonObject;
}
export const view3d = (v: View3d): JsonObject => ({ call: 'view3d', ...(v as unknown as JsonObject) });

/** The frames of a reply the binary answered, not refused. */
export const drawn = (reply: JsonObject, what: string): Frame[] => framesOf(answered(reply, what), what);
/** Frame `n` of a reply's frames. */
export function frame(frames: Frame[], n: number, what: string): Frame {
  const f = frames.find((x) => x.frame === n);
  expect(f, `${what}: frame ${n} is in the reply (frames ${frames.slice(0, 12).map((x) => x.frame).join(', ')}${frames.length > 12 ? ', …' : ''})`).toBeDefined();
  return f!;
}
/** Each frame's GPU time (`timings: true`). */
export function gpuMs(frames: Frame[], what: string): number[] {
  return frames.map((f) => {
    const v = f.raw['gpu_ms'];
    expect(typeof v === 'number' && Number.isFinite(v), `${what}: frame ${f.frame}'s gpu_ms is a finite number, got ${shown(v)}`).toBe(true);
    return v as number;
  });
}
export const median = (xs: readonly number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };

function readNamed(out: string, hash: JsonValue | undefined, ext: string, what: string): Buffer {
  const h = str(hash, `${what} (a file named by its SHA-256)`);
  expect(h, `${what} is named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${h}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(h);
  return file;
}
/** A captured frame's final picture, the renderer's PNG byte for byte. */
export const finalPng = (out: string, f: Frame, what: string): Buffer => readNamed(out, f.raw['final'], 'png', `${what}: frame ${f.frame}'s final`);

/** A float target: little-endian f32 RGBA, rows top-down, `w × h × 16` bytes. `pre_tone` is #418's (the linear image the
 * tone-mapping pass reads, before exposure); `pre_curve` is this suite's (the linear image the tone curve reads). */
export interface Linear { width: number; height: number; rgba: Float32Array }
export function readLinear(out: string, f: Frame, target: 'pre_tone' | 'pre_curve', size: Size, what: string): Linear {
  const file = readNamed(out, f.raw[target], 'f32', `${what}: frame ${f.frame}'s ${target}`);
  expect(file.length, `${what}: ${target} holds ${size[0]} × ${size[1]} f32 RGBA pixels`).toBe(size[0] * size[1] * 16);
  const rgba = new Float32Array(size[0] * size[1] * 4);
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  for (let i = 0; i < rgba.length; i++) rgba[i] = view.getFloat32(i * 4, true);
  return { width: size[0], height: size[1], rgba };
}
/** The linear RGB of a float target at pixel (x, y). */
export function rgbAt(t: Linear, x: number, y: number): Lin {
  const o = (y * t.width + x) * 4;
  return [t.rgba[o]!, t.rgba[o + 1]!, t.rgba[o + 2]!];
}

// ---------------------------------------------------------------------------------------------------
// Levels (README: Readings): luminance is Rec. 709's, of linear RGB; middle grey is linear 0.18 after exposure; a level
// is a log2 luminance against middle grey, in stops.

export const MIDDLE_GREY = 0.18;
/** The linear luminance `stops` above middle grey. */
export const level = (stops: number): number => MIDDLE_GREY * 2 ** stops;
/** A linear colour's level: its log2 luminance against middle grey, in stops (−∞ for no light). */
export const stopsOf = (c: Lin): number => Math.log2(luma(c) / MIDDLE_GREY);

// ---------------------------------------------------------------------------------------------------
// The look (README: The surface under test)

/** The design's `local` field on a `look@1`, beside `tone_map`; a field left out takes the design's default. */
export interface Local { strength?: number; detail?: number; sigma?: number; levels?: number }
export type ToneMapField = 'none' | 'filmic' | 'neutral' | { agx: { white: number; contrast: number } };
/** The four tone maps, as #418's suite writes them (AgX at its defaults). */
export const TONE_MAPS: [string, ToneMapField][] = [['none', 'none'], ['filmic', 'filmic'], ['agx', { agx: { white: 16.29, contrast: 1.25 } }], ['neutral', 'neutral']];
/**
 * #418's physical `look@1` (the clean status map, exposure at the scale 1, `finish: []`, `deband: none`, `bloom: none`,
 * `ao: none`, no ground grid) under `toneMap`, with `local` beside it; with no `local` the look has no such field.
 */
export function lookWith(toneMap: ToneMapField, local?: Local, roles: Record<string, [number, number, number]> = {}): JsonObject {
  return look('look-971', roles, {
    description: 'The #971 acceptance look.', tone_map: toneMap as unknown as JsonValue,
    ...(local ? { local: local as unknown as JsonObject } : {}),
  });
}
/** The criteria's working setting: `local: {strength: 0.5}`, every other field at its default (README: Readings). */
export const HALF: Local = { strength: 0.5 };

// ---------------------------------------------------------------------------------------------------
// Documents (README: The fixtures). Every fixture is seen face on by an orthographic camera 30 m across the frame, so a
// 1920 × 1080 frame has 64 px a metre; every part is a box whose material emits its colour and reflects nothing, under a
// black sky with no light, so a pixel's linear value is its nearest part's emission. Boxes are given as rectangles in
// 1920 × 1080 pixels, [x, y, w, h] with y down from the frame's top; whole pixels there are whole pixels at 3840 × 2160.

export const FULL: Size = [1920, 1080];
export const UHD: Size = [3840, 2160];
const PX_PER_M = 64;
type Box = [number, number, number, number];

const ORTHO: JsonObject = { kind: 'camera@1', params: { projection: 'orthographic', position: [0, 0, 20], target: [0, 0, 0], view_width: FULL[0] / PX_PER_M, near: 0.1, far: 100 } };
const DARK_SKY: JsonObject = { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } };
/** A material that emits `rgb` (linear) and reflects nothing. */
const emits = (rgb: Lin): JsonObject => ({ kind: 'material@1', params: { base_color: [0, 0, 0, 1], roughness: 1, emission: [...rgb], emission_strength: 1 } });
/** A box seen face on, covering the rectangle `box`; a higher `layer` is nearer the camera. */
const rect = ([x, y, w, h]: Box, layer: number, material: string): JsonObject => ({
  kind: 'mark.box@1', params: { size: [w / PX_PER_M, h / PX_PER_M, 0.01] },
  at: { pos: [(x + w / 2 - FULL[0] / 2) / PX_PER_M, (FULL[1] / 2 - y - h / 2) / PX_PER_M, layer * 0.02] }, material,
});
/** A scene document as a session holds it (#378): every item in the one writer layer `main`, camera `cam`. */
function sceneDoc(id: string, description: string, items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(4, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description, size: [...FULL], camera: 'cam', seed: 971, transport: { span: '30s' },
    requires: { modules: { scene3d: '^1', effects: '^1' } }, layers: { main: { writer: 'agent:sess-alpha', title: 'main', order: 'a0' } }, ...extra, items: withIds,
  };
}

// The two walls (criteria 2 and 3)

/** The two-wall fixture's numbers, the issue's: the edge's place, the cell, each wall's level and the checker's amplitude. */
export const WALLS = { edge: 960, cell: 8, bright: 4, dark: -4, checker: 0.25, far: 64, near: 32 } as const;
export type Wall = 'bright' | 'dark';
/** The wall a pixel column lies on: the bright wall left of the edge, the dark wall right of it. */
export const wallOf = (x: number): Wall => (x < WALLS.edge ? 'bright' : 'dark');
/** Whether pixel (x, y) lies in a cell of its checker's higher level (+0.25 stop): the cells whose column and row sum is even. */
export const isHigh = (x: number, y: number): boolean => (Math.floor(x / WALLS.cell) + Math.floor(y / WALLS.cell)) % 2 === 0;
/** A pixel column's distance from the edge, from its centre, in px. */
export const fromEdge = (x: number): number => Math.abs(x + 0.5 - WALLS.edge);
/**
 * Two walls meeting at the vertical edge x = 960 of a 1920 × 1080 frame: the left one 4 stops above middle grey, the
 * right one 4 stops below, each a checker of 8 px cells at ±0.25 stop about its level, every part grey. Each wall is one
 * box at its lower level; the cells at its higher level are 16,200 instances of two 8 px boxes laid over them.
 */
export function wallsDoc(id: string): JsonObject {
  const grey = (stops: number): JsonObject => emits([level(stops), level(stops), level(stops)]);
  const ids: number[] = []; const proto: number[] = []; const pos: JsonValue[] = [];
  for (let j = 0; j < FULL[1] / WALLS.cell; j++) for (let i = 0; i < FULL[0] / WALLS.cell; i++) {
    if ((i + j) % 2 !== 0) continue;
    const x = i * WALLS.cell; const y = j * WALLS.cell;
    proto.push(wallOf(x) === 'bright' ? 0 : 1);
    pos.push([(x + WALLS.cell / 2 - FULL[0] / 2) / PX_PER_M, (FULL[1] / 2 - y - WALLS.cell / 2) / PX_PER_M, 0.02]);
    ids.push(ids.length);
  }
  const cell = (material: string): JsonObject => ({ kind: 'mark.box@1', params: { size: [WALLS.cell / PX_PER_M, WALLS.cell / PX_PER_M, 0.01] }, at: { pos: [0, 0, 0] }, material, visible: false });
  return sceneDoc(id, 'Two walls meeting at a sharp vertical edge, 4 stops above and below middle grey, each with a checker.', {
    cam: ORTHO, sky: DARK_SKY,
    'bright-low': grey(WALLS.bright - WALLS.checker), 'bright-high': grey(WALLS.bright + WALLS.checker),
    'dark-low': grey(WALLS.dark - WALLS.checker), 'dark-high': grey(WALLS.dark + WALLS.checker),
    'wall-bright': rect([0, 0, WALLS.edge, FULL[1]], 0, 'bright-low'),
    'wall-dark': rect([WALLS.edge, 0, FULL[0] - WALLS.edge, FULL[1]], 0, 'dark-low'),
    'cell-bright': cell('bright-high'), 'cell-dark': cell('dark-high'),
    cells: { kind: 'instance@1', params: { of: ['cell-bright', 'cell-dark'], ids, proto, pos } },
  });
}
/** A wall's levels in stops against middle grey: of all its measured pixels, of its checker's higher cells and of its lower. */
export interface WallLevels { mean: number; high: number; low: number }
/**
 * Each wall's mean log2 luminance against middle grey over every pixel at least 64 px from the edge (README:
 * Readings), and the means over its checker's higher cells and its lower cells there.
 */
export function wallLevels(image: Linear): Record<Wall, WallLevels> {
  const sum = { bright: { high: 0, highs: 0, low: 0, lows: 0 }, dark: { high: 0, highs: 0, low: 0, lows: 0 } };
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    if (fromEdge(x) < WALLS.far) continue;
    const s = sum[wallOf(x)];
    const v = stopsOf(rgbAt(image, x, y));
    if (isHigh(x, y)) { s.high += v; s.highs++; } else { s.low += v; s.lows++; }
  }
  const of = (s: { high: number; highs: number; low: number; lows: number }): WallLevels =>
    ({ mean: (s.high + s.low) / (s.highs + s.lows), high: s.high / s.highs, low: s.low / s.lows });
  return { bright: of(sum.bright), dark: of(sum.dark) };
}
/** What is wrong with the two-wall fixture as drawn with no `local` (its `pre_tone`, at the exposure scale 1): each wall
 * at its level and each checker at ±0.25 stop, as the criterion gives them. */
export function wallsAsGiven(plain: Linear): string[] {
  const got = wallLevels(plain);
  const p: string[] = [];
  for (const wall of ['bright', 'dark'] as const) {
    const want = WALLS[wall];
    if (!(Math.abs(got[wall].mean - want) <= 0.01)) p.push(`the ${wall} wall is drawn at ${got[wall].mean.toFixed(4)} stops, not ${want}`);
    if (!(Math.abs(got[wall].high - got[wall].mean - WALLS.checker) <= 0.005)) p.push(`the ${wall} wall's higher cells are drawn ${(got[wall].high - got[wall].mean).toFixed(4)} stop above it, not ${WALLS.checker}`);
    if (!(Math.abs(got[wall].low - got[wall].mean + WALLS.checker) <= 0.005)) p.push(`the ${wall} wall's lower cells are drawn ${(got[wall].low - got[wall].mean).toFixed(4)} stop from it, not −${WALLS.checker}`);
  }
  return p;
}
/** What is wrong with the walls' levels under `local: {strength: 0.5}`: each wall's mean at +2 and −2 stops within 0.1
 * stop, measured at least 64 px from the edge (criterion 2's numbers; criterion 3's guard). */
export function wallsHalved(got: Record<Wall, WallLevels>): string[] {
  const p: string[] = [];
  for (const wall of ['bright', 'dark'] as const) {
    const want = WALLS[wall] / 2;
    if (!(Math.abs(got[wall].mean - want) <= 0.1)) p.push(`the ${wall} wall's mean log2 luminance at least ${WALLS.far} px from the edge is ${got[wall].mean.toFixed(4)} stops, not ${want > 0 ? '+' : '−'}${Math.abs(want)} within 0.1`);
  }
  return p;
}

// The coloured patches (criterion 4)

/** Eight hues, as linear RGB directions, and four saturations: each patch is white mixed toward its hue by its saturation. */
const HUES: Lin[] = [[1, 0.05, 0.05], [1, 0.4, 0.05], [1, 0.9, 0.1], [0.1, 1, 0.15], [0.05, 0.9, 1], [0.08, 0.15, 1], [0.5, 0.1, 1], [1, 0.1, 0.7]];
const SATURATIONS = [0.55, 0.7, 0.85, 1];
export const PATCH = { cols: 8, rows: 8, w: 240, h: 135, bright: 3, dark: -3 } as const;
/** The linear colour of the patch in column `c` and row `r`: row `r`'s hue at saturation `c mod 4`, its luminance 3
 * stops above middle grey in the left four columns and 3 stops below in the right four. */
export function patchColor(c: number, r: number): Lin {
  const hue = HUES[r]!; const s = SATURATIONS[c % 4]!;
  const mixed = hue.map((v) => 1 + (v - 1) * s) as Lin;
  const k = level(c < 4 ? PATCH.bright : PATCH.dark) / luma(mixed);
  return mixed.map((v) => v * k) as Lin;
}
/** The coloured fixture: 8 × 8 patches of 240 × 135 px filling a 1920 × 1080 frame, every patch of the left half at one
 * luminance (3 stops above middle grey) and every patch of the right half at another (3 stops below). */
export function patchesDoc(id: string): JsonObject {
  const items: Record<string, JsonObject> = { cam: ORTHO, sky: DARK_SKY };
  for (let r = 0; r < PATCH.rows; r++) for (let c = 0; c < PATCH.cols; c++) {
    items[`ink-${c}-${r}`] = emits(patchColor(c, r));
    items[`patch-${c}-${r}`] = rect([c * PATCH.w, r * PATCH.h, PATCH.w, PATCH.h], 0, `ink-${c}-${r}`);
  }
  return sceneDoc(id, 'Sixty-four coloured patches: eight hues at four saturations, a bright half and a dark half.', items);
}

// The temple (criteria 1, 5, 6, 8 and 9)

const TINT = { stone: [1, 0.93, 0.8], shade: [0.8, 0.88, 1], sky: [0.55, 0.75, 1], lamp: [1, 0.7, 0.35], grey: [1, 1, 1] } satisfies Record<string, Lin>;
type Tint = keyof typeof TINT;
/**
 * The temple-style fixture, a front elevation in a 1920 × 1080 frame: a sunlit front (steps, six fluted columns, an
 * entablature and a pediment, about 4 stops above middle grey) and the shade under its colonnade (the wall behind the
 * columns, about 4 stops below), eight stops apart. In the shade: stone courses 0.3 stop apart, a doorway, two plaques and
 * two lamps' soft glows; in the sun: flutes 0.3 stop apart and a frieze whose shaded metopes and sunlit triglyphs are
 * 64 px wide each, offset 32 px from the frame's 64 px grid. With `cloud`, a dark cloud 1920 px wide slides in behind
 * the pediment from the left at 128 px a second for 15 s, so the frame changes at every frame until then.
 */
export function templeDoc(id: string, opts: { cloud?: boolean } = {}): JsonObject {
  const items: Record<string, JsonObject> = { cam: ORTHO, sky: DARK_SKY };
  let n = 0;
  const ink = (tint: Tint, stops: number): string => {
    const key = `ink-${tint}-${stops < 0 ? 'm' : 'p'}${Math.round(Math.abs(stops) * 100)}`;
    if (!items[key]) { const t = TINT[tint] as Lin; const k = level(stops) / luma(t); items[key] = emits(t.map((v) => v * k) as Lin); }
    return key;
  };
  const put = (box: Box, layer: number, tint: Tint, stops: number, name?: string): void => { items[name ?? `part-${String(n++).padStart(3, '0')}`] = rect(box, layer, ink(tint, stops)); };

  put([0, 0, 1920, 1080], 0, 'sky', 2.5, 'heaven');
  if (opts.cloud) put([0, 16, 1920, 288], 1, 'grey', 0.5, 'cloud');
  put([0, 992, 1920, 88], 2, 'stone', 3, 'ground');
  // Three steps, each with a shadow line under its edge.
  for (const [k, lift] of [[0, 4.1], [1, 4], [2, 3.9]] as const) {
    const x = 160 - 32 * k; const y = 872 + 40 * k;
    put([x, y, 1920 - 2 * x, 40], 2, 'stone', lift);
    put([x, y + 36, 1920 - 2 * x, 4], 3, 'stone', 1.5);
  }
  // The shade under the colonnade: the wall behind the columns, in courses, with a doorway, two plaques and two lamps.
  put([192, 432, 1536, 440], 2, 'shade', -4.1, 'wall');
  for (let k = 0; k < 11; k++) put([192, 432 + 40 * k, 1536, 20], 3, 'shade', -3.8);
  put([880, 544, 160, 328], 4, 'shade', -3.3);
  put([896, 560, 128, 312], 5, 'grey', -6, 'door');
  for (const x of [336, 1488]) put([x, 568, 96, 144], 4, 'shade', -3.2);
  for (const cx of [672, 1248]) for (let k = 0; k < 10; k++) {
    const s = 160 - 16 * k;
    put([cx - s / 2, 620 - s / 2, s, s], 6 + k, 'lamp', -3.7 + 0.3 * k);
  }
  // Six columns, each 96 px wide with six flutes, a capital and a base.
  for (let k = 0; k < 6; k++) {
    const x = 192 + 288 * k;
    put([x, 432, 96, 440], 22, 'stone', 3.85);
    for (let f = 0; f < 6; f++) put([x + 8 + 16 * f, 456, 8, 400], 23, 'stone', 4.15);
    put([x - 16, 432, 128, 24], 24, 'stone', 4.1);
    put([x - 8, 856, 112, 16], 24, 'stone', 3.9);
  }
  // The entablature: an architrave, a frieze of shaded metopes and sunlit triglyphs, and a cornice.
  put([176, 400, 1568, 32], 22, 'stone', 4);
  put([176, 428, 1568, 4], 23, 'stone', 3.6);
  put([176, 336, 1568, 64], 22, 'stone', 4, 'frieze');
  for (let c = 0; c < 23; c++) {
    const x = 224 + 64 * c;
    if (c % 2 === 0) put([x, 336, 64, 64], 23, 'shade', -4);
    else for (const g of [20, 40]) put([x + g, 344, 4, 48], 23, 'stone', 3);
  }
  put([160, 312, 1600, 24], 22, 'stone', 4.2);
  // The pediment, in twelve courses, around its tympanum.
  for (let r = 0; r < 12; r++) {
    const half = 800 - 64 * r; const y = 296 - 16 * r;
    put([960 - half, y, 2 * half, 16], 22, 'stone', r % 2 === 0 ? 4.05 : 3.95);
    if (r >= 1 && r <= 7) put([960 - half + 128, y, 2 * half - 256, 16], 23, 'stone', 2.8);
  }
  // The cloud's centre goes from 1920 px left of the frame's to the frame's centre, in metres, over 15 s.
  const extra: JsonObject = opts.cloud
    ? { channels: { drift: { target: 'items/cloud/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: -FULL[0] / PX_PER_M, interp: 'linear' }, k1: { t: '15s', value: 0, interp: 'linear' } } } } }
    : {};
  return sceneDoc(id, 'A temple front in the sun and the shade under its colonnade, eight stops apart.', items, extra);
}

// ---------------------------------------------------------------------------------------------------
// The final picture in OKLab

/** sRGB's decode at each 8-bit code. */
const DECODE = Float64Array.from({ length: 256 }, (_, v) => srgbDecode(v / 255));
/** A final PNG's pixels as linear RGB, three f64 a pixel; with `halve`, each 2 × 2 block's mean (a box filter, in linear
 * light), so a 3840 × 2160 picture comes back at 1920 × 1080. */
export function linearOf(png: Buffer, size: Size, halve: boolean, what: string): Float64Array {
  const image: Image = decodePng(png);
  expect([image.width, image.height], `${what} is ${size[0]} × ${size[1]}`).toEqual(size);
  const step = halve ? 2 : 1;
  const w = size[0] / step; const h = size[1] / step;
  const out = new Float64Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    let sum = 0;
    for (let dy = 0; dy < step; dy++) for (let dx = 0; dx < step; dx++) sum += DECODE[image.rgba[((y * step + dy) * size[0] + x * step + dx) * 4 + c]!]!;
    out[(y * w + x) * 3 + c] = sum / (step * step);
  }
  return out;
}
/** The share of pixels at which two linear pictures of one size lie more than `tolerance` apart in OKLab (ΔE, the
 * distance between the two colours). */
export function shareApart(a: Float64Array, b: Float64Array, tolerance: number): number {
  expect(a.length, 'the two pictures hold the same pixels').toBe(b.length);
  let apart = 0;
  for (let i = 0; i < a.length; i += 3) {
    const p = linearToOklab([a[i]!, a[i + 1]!, a[i + 2]!]); const q = linearToOklab([b[i]!, b[i + 1]!, b[i + 2]!]);
    if (!(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) <= tolerance)) apart++;
  }
  return apart / (a.length / 3);
}

// ---------------------------------------------------------------------------------------------------
// The budget's judge: the perf lane's own, with the load at each run's start and end (#1830).

/** A run's one-minute load average, read at its start and at its end. */
export interface Load { start: number; end: number }
export const loadNow = (): number => loadavg()[0]!;
/** Runs the perf lane's own scripts/benchmark.mjs in a child process (its `fingerprint`, `judgeLimit` and
 * `validateBudgets`), so the suite judges a budget exactly as the lane does without importing the lane. */
export function lane(code: string, input: JsonValue = null): JsonValue {
  const script = `import * as b from ${JSON.stringify(join(REPO, 'scripts', 'benchmark.mjs'))};\nconst input = JSON.parse(process.argv[1]);\nconst out = await (async () => { ${code} })();\nprocess.stdout.write(JSON.stringify(out ?? null));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(input)], { cwd: REPO, encoding: 'utf8', timeout: 120_000 });
  expect(r.status, `scripts/benchmark.mjs ran: ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
  return JSON.parse(r.stdout) as JsonValue;
}
/** The lane's `judgeLimit` on this machine's fingerprint, with one load per run. */
function judgeLimit(limit: number, runs: number[], loads: Load[]): JsonObject {
  return obj(lane('return b.judgeLimit({ limit: input.limit, runs: input.runs, fingerprint: b.fingerprint(), loads: input.loads });', { limit, runs, loads: loads as unknown as JsonValue }), 'judgeLimit');
}
/** Why a timing can't count on this machine now (off the reference Macs, not on mains, Low Power Mode, thermal state,
 * or loaded past its cores, as the lane's `judgeLimit` reads it), or '' when it can. Nothing waits for it to change. */
export function timingProblem(): string {
  const now = loadNow();
  const v = judgeLimit(1, [0, 0, 0, 0, 0], Array.from({ length: 5 }, () => ({ start: now, end: now })));
  return v['status'] === 'PASS' ? '' : String(v['reason'] ?? v['status']);
}
/** One budget judged by the lane's rule on five runs after a warm-up, each with its load: PASS passes, FAIL fails, and
 * INCONCLUSIVE or BLOCKED fails `INCONCLUSIVE:` with its reason, never a pass. */
export function judge(name: string, limit: number, runs: number[], loads: Load[]): void {
  const v = judgeLimit(limit, runs, loads);
  const line = `${name}: ${String(v['status'])} ${runs.map((r) => r.toFixed(4)).join(', ')} against ${limit}, the load at each run's start and end ${loads.map((l) => `${l.start.toFixed(2)}-${l.end.toFixed(2)}`).join(', ')}${v['reason'] ? ` (${String(v['reason'])})` : ''}`;
  console.log(line);
  if (v['status'] === 'PASS') return;
  expect(v['status'], `FAIL: ${line}`).not.toBe('FAIL');
  inconclusive(line);
}
