// Test-side tools for the #1383 acceptance tests (README: The surface under test). They drive `deep-gpu run` (#377)
// with `view3d` (#378): its `capture`, `targets: ['final']`, `from`, `seeks`, `assets` and each frame's `pixel_hash`,
// plus the one reading this suite assumes, `cover_points` (README: Assumed surfaces 2), and `--planted` (#377).
// Copied here, since suites never import each other: the JSON-lines runner and the build, #166's look shape, #425's
// PNG and APNG coding and #2014's terrain plate. Every number a test judges comes from the binary; the only things
// computed here are the fixtures, their checker image, the ground's geometric normals and Laplacians the fields give,
// and the measures a test takes of the binary's own pixels.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type V3 = [number, number, number];
export type Size = [number, number];
export type XZ = [number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1383 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
/** Each criterion's ID: `#1383.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
export const AC = {
  1: '#1383.3bb69dac', 2: '#1383.c10c4d30', 3: '#1383.7dfe9767', 4: '#1383.3f20cff6',
  5: '#1383.4fb146a3', 6: '#1383.9241d5cb', 7: '#1383.12eb8d92', 8: '#1383.92cc9800',
} as const;
/** Each test's own timeout: a first build on a loaded machine takes many minutes, so builds get theirs in beforeAll. */
export const TIMEOUT = 3_600_000;
/** The frame rate a call draws at unless it says otherwise: frame n is at n ÷ 4 s. */
export const FPS = 4;

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const brief = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${brief(v, 600)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${brief(v, 600)}`).toBe(true);
  return v as JsonValue[];
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${brief(v, 200)}`).toBe(true);
  return v as number;
}
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const SHA = /^[0-9a-f]{64}$/;
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 30).join('\n  ')}`).toEqual([]);
}
export const fmt = (x: number, d = 4): string => x.toFixed(d);
export const at = (p: XZ): string => `(${p[0]}, ${p[1]})`;

// ---------------------------------------------------------------------------------------------------
// The machine

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** What the GPU draws is drawn on macOS's Metal device: off macOS a test fails INCONCLUSIVE. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the renderer draws on macOS's Metal device; this is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// The build: `cargo build --locked --bin deep-gpu` once per file, debug info and incremental builds off, copied out of
// the target folder (honoring CARGO_TARGET_DIR), with rustup's cargo put first on PATH.

const targetDir = (): string => (process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target'));
const CARGO_ARGS = ['build', '--locked', '--bin', 'deep-gpu'];
function buildInto(dir: string): { path: string; error: string } {
  const env = {
    ...process.env, PATH: `/opt/homebrew/opt/rustup/bin${delimiter}${process.env['PATH'] ?? ''}`,
    CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  };
  const r = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { path: '', error: `cargo could not run: ${r.error.message}` };
  if (r.status !== 0) {
    const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l));
    return { path: '', error: `cargo ${CARGO_ARGS.join(' ')} failed:\n${lines.join('\n').slice(-4000)}` };
  }
  const path = join(dir, 'deep-gpu');
  copyFileSync(join(targetDir(), 'debug', 'deep-gpu'), path);
  return { path, error: '' };
}
/** Builds deep-gpu once, before the file's tests; a test whose build failed fails with cargo's error. */
export function useGpu(): () => string {
  let dir = '';
  let made: { path: string; error: string } | null = null;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1383-bin-')); made = buildInto(dir); }, 2 * TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (): string => {
    expect(made, 'deep-gpu was built before the tests').not.toBeNull();
    expect(made!.error, `deep-gpu builds: cargo ${CARGO_ARGS.join(' ')}`).toBe('');
    return made!.path;
  };
}
/** A fresh folder per test, deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1383-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}
export function writeJson(dir: string, name: string, value: JsonObject): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one scenario `{out, calls}` in, one line out, one reply per call (#377).

/** The wrong programs this suite plants in `deep-gpu run`, each reachable only through `--planted` (README). */
export type Planted = 'cover_keeps_planar_uv' | 'triplanar_by_shaded_normal';

export function runGpu(bin: string, out: string, calls: JsonObject[], planted?: Planted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const label = `deep-gpu ${args.join(' ')}`;
  const r = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 3_000_000, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${label} did not finish within 3,000 s`);
  // A binary that refuses its arguments (an unknown --planted) exits before reading its input: its exit is judged below.
  if (r.error && (r.error as NodeJS.ErrnoException).code !== 'EPIPE') throw Error(`${label}: ${r.error.message}`);
  expect(r.status, `${label} exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${label}: one output line`).toBe(1);
  let answer: JsonValue;
  try { answer = JSON.parse(lines[0]!) as JsonValue; } catch { return expect.fail(`${label}: its line is JSON: ${lines[0]!.slice(0, 1500)}`); }
  const a = obj(answer, `${label}: the answer`);
  expect(a['ok'], `${label} accepted the scenario: ${brief(a, 3000)}`).toBe(true);
  const replies = arr(a['replies'], `${label}: replies`).map((x, i) => obj(x, `${label}: replies[${i}]`));
  expect(replies.length, `${label}: one reply per call`).toBe(calls.length);
  return replies;
}

export interface View { doc: string; size: Size; look?: JsonObject; fps?: number; from?: number; frames?: number; capture?: number[] | 'every'; seeks?: { after: number; to: number }[]; points?: { item: string; at: XZ[] }; assets?: Record<string, string> }
/** A `view3d` call (#378) at `fps` (FPS unless given), its `final` target written for the frames captured; `cover_points` when asked. */
export function view3d(v: View): JsonObject {
  return {
    call: 'view3d', doc: v.doc, look: v.look ?? PLAIN, size: [...v.size], fps: v.fps ?? FPS, from: v.from ?? 0, frames: v.frames ?? 1,
    ...(v.capture ? { capture: v.capture, targets: ['final'] } : {}),
    ...(v.seeks ? { seeks: v.seeks.map((s) => ({ ...s })) } : {}),
    ...(v.points ? { cover_points: { item: v.points.item, at: v.points.at.map((p) => [...p]) } } : {}),
    ...(v.assets ? { assets: { ...v.assets } } : {}),
  };
}
/** A `view3d` reply's frames, in the order drawn; INCONCLUSIVE where the binary says the platform can't draw. */
export function framesOf(reply: JsonObject, what: string): JsonObject[] {
  if (reply['code'] === 'unsupported_platform' || reply['code'] === 'gpu_unavailable') inconclusive(`${what}: view3d answered ${String(reply['code'])}`);
  expect(reply['code'], `${what}: view3d draws the document, not refuses it: ${brief(reply)}`).toBeUndefined();
  return arr(reply['frames'], `${what}: frames`).map((f, i) => obj(f, `${what}: frames[${i}]`));
}
/** The frame numbered `n` of `frames`. */
export function frameAt(frames: JsonObject[], n: number, what: string): JsonObject {
  const f = frames.find((x) => x['frame'] === n);
  expect(f, `${what}: frame ${n} is drawn (frames ${frames.map((x) => String(x['frame'])).slice(0, 30).join(', ')})`).toBeDefined();
  return f!;
}
/** A frame's `pixel_hash` (#378), the hash of the pixels it drew. */
export function hashOf(frame: JsonObject, what: string): string {
  const h = frame['pixel_hash'];
  expect(typeof h === 'string' && h.length > 0, `${what}: frame ${String(frame['frame'])} reports its pixel_hash, got ${brief(h, 100)}`).toBe(true);
  return h as string;
}
/** The `final` target a captured frame wrote under `out`, named by its SHA-256, decoded. */
export function finalOf(out: string, frame: JsonObject, what: string): Image {
  const hash = frame['final'];
  const label = `${what}: frame ${String(frame['frame'])}'s final target`;
  expect(hash, `${label} is written, named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${String(hash)}.png`));
  expect(sha256(file), `${label}'s file hashes to its name`).toBe(hash);
  return decodePng(file);
}

// ---------------------------------------------------------------------------------------------------
// `cover_points` (README: Assumed surfaces 2): what the fragment stage takes from a plate's cover at ground points.

export interface Entry { weight: number; triplanar: V3 | null }
export interface CoverPoint { at: XZ; curvature: number; entries: Entry[]; base: V3; roughness: number }
const v3 = (v: JsonValue | undefined, what: string): V3 => {
  const a = arr(v, what);
  expect(a.length, `${what} holds 3 numbers`).toBe(3);
  return [num(a[0], `${what}[0]`), num(a[1], `${what}[1]`), num(a[2], `${what}[2]`)];
};
/** A frame's `cover_points`, one per point asked, in order, each with one entry per cover entry. */
export function coverPointsOf(frame: JsonObject, asked: readonly XZ[], entries: number, what: string): CoverPoint[] {
  const rows = arr(frame['cover_points'], `${what}: the frame's \`cover_points\` (README: Assumed surfaces 2)`);
  expect(rows.length, `${what}: one cover_points reading per point asked`).toBe(asked.length);
  return rows.map((v, k) => {
    const w = `${what}: cover_points[${k}]`;
    const o = obj(v, w);
    const xz = arr(o['at'], `${w}.at`).map((n, i) => num(n, `${w}.at[${i}]`));
    expect(xz, `${w}: the point asked`).toEqual([...asked[k]!]);
    const list = arr(o['entries'], `${w}.entries`);
    expect(list.length, `${w}: one entry per cover entry`).toBe(entries);
    const es = list.map((e, j): Entry => {
      const eo = obj(e, `${w}.entries[${j}]`);
      return { weight: num(eo['weight'], `${w}.entries[${j}].weight`), triplanar: eo['triplanar'] === null ? null : v3(eo['triplanar'], `${w}.entries[${j}].triplanar`) };
    });
    return { at: asked[k]!, curvature: num(o['curvature'], `${w}.curvature`), entries: es, base: v3(o['base_color'], `${w}.base_color`), roughness: num(o['roughness'], `${w}.roughness`) };
  });
}

// ---------------------------------------------------------------------------------------------------
// Looks, lights and items (#166's look shape; metres, +Y up, right +X, the front facing +Z)

const FONTS: JsonObject = {
  body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
};
const STATUS: JsonObject = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
/** A physical-basis `look@1`: tone map none at the exposure whose scale is 1, no finish, deband, bloom, ao or 3D ground. */
function look3d(id: string, change: JsonObject = {}): JsonObject {
  return {
    id, format: 1, basis: 'physical', license: 'Apache-2.0', description: `The #1383 acceptance look ${id}.`,
    palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97' },
    roles: { ground: 'night', ink: 'graphite', muted: 'slate' },
    themes: { light: {}, dark: {} }, fonts: FONTS,
    status: { ...STATUS }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: 0.1,
    attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
    tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' },
    ...change,
  };
}
/** The look the measured frames draw in: nothing between the lit scene and the frame's code values. */
export const PLAIN = look3d('plain-1383');
/** The look the screenshots and the recording draw in, as a film would. */
export const FILMIC = look3d('filmic-1383', { tone_map: 'filmic', exposure: 0 });

export const DAY_SKY: JsonObject = { kind: 'sky@1', params: { top: [0.15, 0.3, 0.75, 1], low: [0.6, 0.7, 0.85, 1], ambient_top: [0.25, 0.25, 0.25], ambient_low: [0.1, 0.1, 0.1] } };
/** A sun: it shines along its local −Z, so `at.rot` [−e, y, 0] puts it e degrees above the horizon, turned y about +Y
 * (y −90: shining toward +X from the west; y −135: toward +X and +Z, from the north-west). No shadow. */
export const sun = (illuminance: number, rot: V3): JsonObject => ({ kind: 'light.sun@1', params: { illuminance, color: [1, 1, 1], shadow: false }, at: { rot } });
export const perspective = (position: V3, target: V3, fov: number, near = 0.5, far = 6000): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov, near, far } });
export const orthographic = (position: V3, target: V3, viewWidth: number): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'orthographic', position, target, view_width: viewWidth, near: 1, far: 200 } });
export const material = (base: V3, roughness: number, more: JsonObject = {}): JsonObject => ({ kind: 'material@1', params: { base_color: [...base, 1], roughness, metallic: 0, ...more } });

/** A scene document as a `view3d` session holds it (#378): every item in the one writer layer `main`. */
export function sessionDoc(id: string, size: Size, camera: string, items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(4, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #1383 acceptance fixture.`, size: [...size], camera, seed: 1383,
    transport: { span: '12s' }, requires: { modules: { scene3d: '^1' } }, budget: { class: 'work_product' },
    layers: { main: { writer: 'agent:alpha', title: 'Main', order: 'a0' } }, ...extra, items: withIds,
  };
}

// ---------------------------------------------------------------------------------------------------
// The terrain plate (#2014's form) and its cover (README: Assumed surfaces 1)

export interface Terrain { height: string | number; size: [number, number]; spacing: number }
/** A cover entry: its material, its `where` terms, its blend in metres and, when given, its projection and modify. */
export interface Cover { material: string; where: JsonObject; blend: number; projection?: 'uv' | 'triplanar' | 'auto'; modify?: JsonObject[] }
const coverJson = (c: Cover): JsonObject => ({
  material: c.material, where: c.where, blend: c.blend, ...(c.projection ? { projection: c.projection } : {}), ...(c.modify ? { modify: c.modify } : {}),
});
/** A terrain `plate@1`: `params.terrain` with `params.cover` beside it, its own material under the cover. */
export function plate(t: Terrain, mat: string, cover: Cover[], pos?: V3): JsonObject {
  return {
    kind: 'plate@1', params: { terrain: { height: t.height, size: [...t.size], spacing: t.spacing }, cover: cover.map(coverJson) }, material: mat,
    ...(pos ? { at: { pos: [...pos] } } : {}),
  };
}
/** The plate whose cover the readings ask about. */
export const PLATE_ID = 'ground';

// ---------------------------------------------------------------------------------------------------
// The checker (README: Fixtures): a 64 × 64 PNG of 2 × 2 cells, sRGB 40 and 215 grey, one image across a UV unit, so in
// metre UVs a cell is 0.5 m. It is the base colour map of the material `checker`.

export const CHECKER_CELL_M = 0.5;
let checkerPng: Buffer | null = null;
export function checkerBytes(): Buffer {
  if (checkerPng) return checkerPng;
  const rgba = new Uint8Array(64 * 64 * 4);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const v = ((x >> 5) + (y >> 5)) % 2 === 0 ? 40 : 215;
    const o = (y * 64 + x) * 4;
    rgba[o] = v; rgba[o + 1] = v; rgba[o + 2] = v; rgba[o + 3] = 255;
  }
  checkerPng = encodePng({ width: 64, height: 64, rgba });
  return checkerPng;
}
export const checkerSha = (): string => sha256(checkerBytes());
/** The checker written under `dir`, as `view3d`'s `assets` names a file: `{sha256: path}`. */
export function checkerAsset(dir: string): Record<string, string> {
  const path = join(dir, `${checkerSha()}.png`);
  writeFileSync(path, checkerBytes());
  return { [checkerSha()]: path };
}
/** The document's `assets` entry for the checker (the document envelope's licensed assets). */
const checkerEntry = (): JsonObject => ({
  checker: { sha256: checkerSha(), kind: 'image', license: { id: 'CC0-1.0', terms: 'https://creativecommons.org/publicdomain/zero/1.0/legalcode', shareable: true, credit: 'Made by the #1383 acceptance suite' } },
});
const checkerMaterial = (): JsonObject => material([1, 1, 1], 0.8, { maps: { base_color: checkerSha() } });

// ---------------------------------------------------------------------------------------------------
// Criterion 1: the cliff. A 64 × 32 m plate at 0.25 m whose ground is flat at 0 for x ≤ −5 and rises at tan 70° to a
// plateau at 30 m: a 70° face from x = −5 to x ≈ 5.92 across the whole of z. Covered everywhere by the checker, its
// projection left at its default. Lit by a sun 45° up in the west, so the west-facing face and the flat ground both
// take direct light. Two orthographic views at 960 × 640, 23.3 m across (41.2 px a metre): straight down on the flat
// ground around (−18.5, 0, 0), and square onto the face from 60 m along its normal, centred on its middle.

export const TAN70 = Math.tan((70 * Math.PI) / 180);
export const CLIFF_SIZE: Size = [960, 640];
export const CLIFF_VIEW_M = 23.3;
const CLIFF: Terrain = { height: `clamp((position.x + 5) * ${TAN70}, 0, 30)`, size: [64, 32], spacing: 0.25 };
/** The face's middle and its outward normal, pointing up and west. */
export const FACE_MID: V3 = [-5 + 15 / TAN70, 15, 0];
export const FACE_NORMAL: V3 = [-Math.sin((70 * Math.PI) / 180), Math.cos((70 * Math.PI) / 180), 0];
export function cliffDoc(view: 'flat' | 'face'): JsonObject {
  const cam = view === 'flat'
    ? orthographic([-18.5, 50, 0], [-18.5, 0, 0], CLIFF_VIEW_M)
    : orthographic([FACE_MID[0] + 60 * FACE_NORMAL[0], FACE_MID[1] + 60 * FACE_NORMAL[1], 0], FACE_MID, CLIFF_VIEW_M);
  return sessionDoc(`cliff-1383-${view}`, CLIFF_SIZE, 'cam', {
    cam, sky: DAY_SKY, sun: sun(3, [-45, -90, 0]),
    turf: material([0.3, 0.42, 0.2], 0.9), checker: checkerMaterial(),
    [PLATE_ID]: plate(CLIFF, 'turf', [{ material: 'checker', where: {}, blend: 0 }]),
  }, { assets: checkerEntry() });
}

/** sRGB code value to linear. */
const linear = (c: number): number => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const LIN = Array.from({ length: 256 }, (_, c) => linear(c));
/** A pixel's linear luminance (Rec. 709 weights on the decoded channels). */
export function lumaAt(im: Image, x: number, y: number): number {
  const o = (y * im.width + x) * 4;
  return 0.2126 * LIN[im.rgba[o]!]! + 0.7152 * LIN[im.rgba[o + 1]!]! + 0.0722 * LIN[im.rgba[o + 2]!]!;
}
/** The checker's cell along one scan line, in px: the line's luminance thresholded halfway between its 10th and 90th
 * percentiles (linear light, so a blend weighted over one half still reads as that half's cell), each crossing placed
 * between its two pixels, and the mean run from the first crossing to the last. Null with under 6 crossings. */
export function cellAlong(values: readonly number[]): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  const lo = sorted[Math.floor(0.1 * (sorted.length - 1))]!;
  const hi = sorted[Math.floor(0.9 * (sorted.length - 1))]!;
  if (!(hi > 2 * lo + 0.01)) return null;
  const thr = (lo + hi) / 2;
  const edges: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const a = values[i - 1]! - thr; const b = values[i]! - thr;
    if ((a < 0) !== (b < 0)) edges.push(i - 1 + a / (a - b));
  }
  if (edges.length < 6) return null;
  return (edges[edges.length - 1]! - edges[0]!) / (edges.length - 1);
}
const median = (v: readonly number[]): number => { const s = [...v].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2; };
/** The checker's cell in metres along an image's rows and down its columns: the median over 9 scan lines each, spread
 * over the middle 80% of the frame, each line taken over the middle 96%; null where no line shows a checker. */
export function cellsOf(im: Image, pxPerM: number): { rows: number | null; columns: number | null } {
  const lines = (n: number): number[] => Array.from({ length: 9 }, (_, k) => Math.round(n * (0.1 + 0.1 * k)));
  const span = (n: number): [number, number] => [Math.round(0.02 * n), Math.round(0.98 * n)];
  const [x0, x1] = span(im.width); const [y0, y1] = span(im.height);
  const rows = lines(im.height).map((y) => cellAlong(Array.from({ length: x1 - x0 }, (_, i) => lumaAt(im, x0 + i, y)))).filter((c): c is number => c !== null);
  const columns = lines(im.width).map((x) => cellAlong(Array.from({ length: y1 - y0 }, (_, i) => lumaAt(im, x, y0 + i)))).filter((c): c is number => c !== null);
  return { rows: rows.length >= 5 ? median(rows) / pxPerM : null, columns: columns.length >= 5 ? median(columns) / pxPerM : null };
}
export interface TexelReading { flat: number; down: number; across: number; failures: string[] }
/** Criterion 1's judge: the checker's cell down the face (the view's columns: its screen up is the face's up-slope
 * direction) and across it (the rows, along z), each against its cell on flat ground (the median of both directions
 * there), within 10%. Each failure names the stretch. */
export function texelJudge(flatIm: Image, faceIm: Image): TexelReading {
  const pxPerM = CLIFF_SIZE[0] / CLIFF_VIEW_M;
  const flat = cellsOf(flatIm, pxPerM); const face = cellsOf(faceIm, pxPerM);
  expect(flat.rows !== null && flat.columns !== null, `the flat ground shows the checker along both of the view's axes (cells ${brief(flat as unknown as JsonValue)})`).toBe(true);
  expect(face.rows !== null && face.columns !== null, `the 70° face shows the checker along both of the view's axes (cells ${brief(face as unknown as JsonValue)})`).toBe(true);
  const flatCell = (flat.rows! + flat.columns!) / 2;
  const failures: string[] = [];
  for (const [dir, cell] of [['down the face', face.columns!], ['across the face', face.rows!]] as const) {
    const ratio = cell / flatCell;
    if (Math.abs(ratio - 1) > 0.1) failures.push(`${dir}: the 70° face's checker cells are ${ratio.toFixed(2)}× their size on flat ground (${fmt(cell, 3)} m against ${fmt(flatCell, 3)} m), past 10%`);
  }
  return { flat: flatCell, down: face.columns!, across: face.rows!, failures };
}

// ---------------------------------------------------------------------------------------------------
// Criterion 2: four planes meeting at creases on sample lines. A 32 × 32 m plate at 2 m whose height rises at 1.2 toward
// +x and 0.4 toward −x, at 0.5 toward +z and 0.9 toward −z: each quadrant one plane, every cell inside one plane, so the
// geometric normal anywhere in a cell is its quadrant's. The vertices on the creases x = 0 and z = 0 average two planes'
// normals, so in the cells beside a crease the shaded normal leans away from the geometric one. The checker covers it,
// triplanar everywhere.

const VEE: Terrain = { height: '1.2 * max(position.x, 0) - 0.4 * min(position.x, 0) + 0.5 * max(position.z, 0) - 0.9 * min(position.z, 0)', size: [32, 32], spacing: 2 };
/** The geometric normal of VEE at (x, z) off its creases. */
export function veeNormal(x: number, z: number): V3 {
  const gx = x > 0 ? 1.2 : -0.4; const gz = z > 0 ? 0.5 : -0.9;
  const l = Math.hypot(gx, 1, gz);
  return [-gx / l, 1 / l, -gz / l];
}
/** Criterion 2's points: four inside each quadrant, away from the creases, and three in its cells beside a crease (by
 * x = 0, by z = 0, and at the apex), so the points inside the quadrants hold most of the readings. */
export const VEE_POINTS: XZ[] = [];
for (const sx of [1, -1]) for (const sz of [1, -1]) {
  VEE_POINTS.push([5 * sx, 7 * sz], [9 * sx, 11 * sz], [13 * sx, 3 * sz], [11 * sx, 13 * sz], [1 * sx, 7 * sz], [7 * sx, 1 * sz], [1 * sx, 1 * sz]);
}
/** The points in a cell beside a crease, where the shaded normal leans off the geometric one. */
export const besideCrease = (p: XZ): boolean => Math.abs(p[0]) < 2 || Math.abs(p[1]) < 2;
export function veeDoc(): JsonObject {
  return sessionDoc('vee-1383', [320, 180], 'cam', {
    cam: perspective([0, 40, 45], [0, 0, 0], 50), sky: DAY_SKY, sun: sun(3, [-45, -135, 0]),
    turf: material([0.3, 0.42, 0.2], 0.9), checker: checkerMaterial(),
    [PLATE_ID]: plate(VEE, 'turf', [{ material: 'checker', where: {}, blend: 0, projection: 'triplanar' }]),
  }, { assets: checkerEntry() });
}
/** Criterion 2's judge: at every point the entry's triplanar weights sum to 1 within 1e-5 and are |n|^p over the
 * geometric normal n, normalized: for each pair of axes ln(w_a ÷ w_y) ÷ ln(|n_a| ÷ |n_y|) gives the same p at every point,
 * within 1% of their median, and p > 0. Each failure names its point. */
export function weightFailures(points: readonly CoverPoint[]): { failures: string[]; p: number } {
  const failures: string[] = [];
  const ps: { at: XZ; p: number; pair: string }[] = [];
  for (const pt of points) {
    const w = pt.entries[0]!.triplanar;
    if (w === null) { failures.push(`point ${at(pt.at)}: the entry samples by uv0 there, not triplanar`); continue; }
    const sum = w[0] + w[1] + w[2];
    if (!(Math.abs(sum - 1) <= 1e-5)) failures.push(`point ${at(pt.at)}: the weights ${w.map((x) => fmt(x, 6)).join(', ')} sum to ${sum.toPrecision(9)}, not 1 within 1e-5`);
    if (w.some((x) => !(x > 0))) { failures.push(`point ${at(pt.at)}: a weight is not above 0: ${w.join(', ')}`); continue; }
    const n = veeNormal(pt.at[0], pt.at[1]).map(Math.abs);
    ps.push({ at: pt.at, pair: 'x', p: Math.log(w[0] / w[1]) / Math.log(n[0]! / n[1]!) });
    ps.push({ at: pt.at, pair: 'z', p: Math.log(w[2] / w[1]) / Math.log(n[2]! / n[1]!) });
  }
  const p = ps.length ? median(ps.map((q) => q.p)) : NaN;
  if (!(p > 0)) failures.push(`the weights follow no |n|^p with p > 0 over the geometric normals (median p ${p})`);
  else for (const q of ps) if (!(Math.abs(q.p - p) <= 0.01 * p)) {
    failures.push(`point ${at(q.at)}: its ${q.pair} and y weights give p ${q.p.toFixed(4)} over its geometric normal, the others ${p.toFixed(4)}: not |n|^p of the geometric normal`);
  }
  return { failures, p };
}

// ---------------------------------------------------------------------------------------------------
// Criterion 3: a four-sided pyramid. A 64 × 64 m plate at 1 m, 32 − max(|x|, |z|): four 45° faces facing north (−Z),
// east (+X), south (+Z) and west (−X), meeting at an apex 32 m up. Rock, with one cover entry: snow where the ground
// faces north, `aspect: {direction: 0, min: 0.5}`, hard-edged.

const PYRAMID: Terrain = { height: '32 - max(abs(position.x), abs(position.z))', size: [64, 64], spacing: 1 };
/** Twelve points on the north face (z < 0) and their mirrors on the south face, each at least 3.5 m from a ridge. */
export const NORTH_POINTS: XZ[] = [[-4.5, -10.5], [0.5, -10.5], [4.5, -10.5], [-9.5, -18.5], [0.5, -18.5], [9.5, -18.5], [-17.5, -26.5], [-6.5, -26.5], [6.5, -26.5], [17.5, -26.5], [-1.5, -8.5], [2.5, -22.5]];
export const SOUTH_POINTS: XZ[] = NORTH_POINTS.map(([x, z]) => [x, -z]);
export function pyramidDoc(): JsonObject {
  return sessionDoc('pyramid-1383', [320, 180], 'cam', {
    cam: perspective([45, 60, 70], [0, 10, 0], 50), sky: DAY_SKY, sun: sun(3, [-45, -135, 0]),
    rock: material([0.32, 0.29, 0.26], 0.85), snow: material([0.92, 0.94, 0.97], 0.6),
    [PLATE_ID]: plate(PYRAMID, 'rock', [{ material: 'snow', where: { aspect: { direction: 0, min: 0.5 } }, blend: 0 }]),
  });
}

// ---------------------------------------------------------------------------------------------------
// Criterion 4: a ridge and a gully. A 96 × 64 m plate at 2 m: a Gaussian ridge 20 m high along z at x = 20 and a
// Gaussian gully 20 m deep along z at x = −20, each σ = 8 m. The Laplacian of the heights at the ridge's centre line is
// −20 ÷ σ² = −0.3125 per m and at the gully's +0.3125 (the other's share there is under 1e-5), so the curvature the issue
// reads, positive on a ridge, is +0.3125 there and −0.3125 in the gully.

const RIDGES: Terrain = { height: '20 * exp(-0.0078125 * ((position.x - 20) * (position.x - 20))) - 20 * exp(-0.0078125 * ((position.x + 20) * (position.x + 20)))', size: [96, 64], spacing: 2 };
export const RIDGE_POINTS: XZ[] = [[20, -16], [20, 0], [20, 16]];
export const GULLY_POINTS: XZ[] = [[-20, -16], [-20, 0], [-20, 16]];
/** |∇²h| at either centre line, per metre. */
export const LAPLACIAN = 20 / 64;
export function ridgesDoc(): JsonObject {
  return sessionDoc('ridges-1383', [320, 180], 'cam', {
    cam: perspective([0, 45, 70], [0, 0, 0], 55), sky: DAY_SKY, sun: sun(3, [-45, -135, 0]),
    rock: material([0.32, 0.29, 0.26], 0.85), moss: material([0.2, 0.35, 0.12], 0.9),
    [PLATE_ID]: plate(RIDGES, 'rock', [{ material: 'moss', where: { curvature: { min: 0 } }, blend: 0 }]),
  });
}

// ---------------------------------------------------------------------------------------------------
// Criterion 5: wet ground. A flat 16 × 16 m plate at 1 m, turf under a cover of soil (base colour 0.5, 0.4, 0.3 in
// linear light, roughness 0.8) everywhere, with `modify: [{kind: wet, amount: 1}]`, or without `modify`.

const FLAT: Terrain = { height: 0, size: [16, 16], spacing: 1 };
export const SOIL_BASE: V3 = [0.5, 0.4, 0.3];
export const SOIL_ROUGHNESS = 0.8;
export const WET_POINTS: XZ[] = [[-4.5, -4.5], [0.5, 0.5], [4.5, -2.5], [-2.5, 5.5]];
export function wetDoc(wet: boolean): JsonObject {
  return sessionDoc(`wet-1383${wet ? '' : '-dry'}`, [320, 180], 'cam', {
    cam: perspective([0, 10, 18], [0, 0, 0], 50), sky: DAY_SKY, sun: sun(3, [-35, -135, 0]),
    turf: material([0.3, 0.42, 0.2], 0.5), soil: material(SOIL_BASE, SOIL_ROUGHNESS),
    [PLATE_ID]: plate(FLAT, 'turf', [{ material: 'soil', where: {}, blend: 0, ...(wet ? { modify: [{ kind: 'wet', amount: 1 }] } : {}) }]),
  });
}

// ---------------------------------------------------------------------------------------------------
// The fixture document (criteria 6, 7 and 8; README: Fixtures). Three terrain plates under one sun 35° up in the
// north-west, a day sky and one camera per shot; each plate 129 × 129 samples:
// - `cliff`, at the origin: criterion 1's cliff, 64 m along z at 0.5 m, on ground corrugated along z (±1.2 m, slopes to
//   23°), under the checker.
// - `peaks`, centred at (0, 0, −1,500): a 1,024 m square at 8 m, two massifs (430 m and 310 m) with folds; rock, under
//   snow above a line that falls from 420 m to 120 m over 0 to 10 s (entry 0), and snow on north faces above a line
//   120 m lower that falls from 300 m to 0 m (entry 1, `aspect: {direction: 0, min: 0.4}`), each blended over 6 m.
// - `field`, centred at (150, 0, 40): 128 m square at 1 m, gentle swells (±1.5 m), under soil that a rain wets: `modify:
//   [{kind: wet, amount}]`, the amount keyed from 0 at 2 s to 1 at 6 s.
// With `defaults`, every field this issue adds is left at its default: no `aspect` on entry 1, no `modify` on the
// field's soil and no rain channel; `set` then sets one of them away from its default (criterion 7).

export type Shot = 'cliff' | 'snow' | 'field';
export type FieldSet = 'projection uv' | 'projection triplanar' | 'where.aspect' | 'where.curvature' | 'modify wet' | 'modify dust';
/** The shot each field set away from its default shows on: where that field's plate is seen. */
export const SHOT_OF: Record<FieldSet, Shot> = {
  'projection uv': 'cliff', 'projection triplanar': 'cliff', 'where.aspect': 'snow', 'where.curvature': 'snow', 'modify wet': 'field', 'modify dust': 'field',
};
const CLIFF_RIPPLED: Terrain = { height: `clamp((position.x + 5) * ${TAN70}, 0, 30) + 1.2 * sin(position.z * 0.35)`, size: [64, 64], spacing: 0.5 };
const PEAKS: Terrain = {
  height: '430 * exp(-0.0000173 * ((position.x + 150) * (position.x + 150) + (position.z + 120) * (position.z + 120))) + 310 * exp(-0.0000296 * ((position.x - 210) * (position.x - 210) + (position.z - 60) * (position.z - 60))) + 30 * sin(position.x * 0.027) * cos(position.z * 0.031)',
  size: [1024, 1024], spacing: 8,
};
const FIELD: Terrain = { height: '1.5 * sin(position.x * 0.11) * cos(position.z * 0.09)', size: [128, 128], spacing: 1 };
export const PEAKS_AT: V3 = [0, 0, -1500];
export const FIELD_AT: V3 = [150, 0, 40];
/** The snow lines: entry 0 from 420 m to 120 m and entry 1 from 300 m to 0 m, keyed at 0 s and 10 s. */
export const SNOW_FALL = { from: 420, to: 120, north: 120, seconds: 10 } as const;
const line = (target: string, keys: [number, number][]): JsonObject =>
  ({ target, type: 'f32', keys: Object.fromEntries(keys.map(([t, value], i) => [`k${i}`, { t: `${t}s`, value, interp: 'linear' }])) });
export interface FixtureOpts { shot: Shot; size: Size; defaults?: boolean; set?: FieldSet }
export function fixtureDoc(o: FixtureOpts): JsonObject {
  const written = !o.defaults;
  const set = o.set;
  const cliffCover: Cover = { material: 'checker', where: {}, blend: 0, ...(set === 'projection uv' ? { projection: 'uv' as const } : set === 'projection triplanar' ? { projection: 'triplanar' as const } : {}) };
  const northWhere: JsonObject = { height: { min: SNOW_FALL.from - SNOW_FALL.north } };
  if (written || set === 'where.aspect') northWhere['aspect'] = { direction: 0, min: 0.4 };
  if (set === 'where.curvature') northWhere['curvature'] = { min: 0 };
  const snow: Cover[] = [
    { material: 'snow', where: { height: { min: SNOW_FALL.from } }, blend: 6 },
    { material: 'snow', where: northWhere, blend: 6 },
  ];
  const modify = written ? [{ kind: 'wet', amount: 0 }] : set === 'modify wet' ? [{ kind: 'wet', amount: 1 }] : set === 'modify dust' ? [{ kind: 'dust', amount: 1 }] : undefined;
  const channels: JsonObject = {
    snowline: line('items/peaks/params/cover/0/where/height/min', [[0, SNOW_FALL.from], [SNOW_FALL.seconds, SNOW_FALL.to]]),
    'snowline-north': line('items/peaks/params/cover/1/where/height/min', [[0, SNOW_FALL.from - SNOW_FALL.north], [SNOW_FALL.seconds, SNOW_FALL.to - SNOW_FALL.north]]),
    ...(written ? { rain: line('items/field/params/cover/0/modify/0/amount', [[2, 0], [6, 1]]) } : {}),
  };
  const cams: Record<Shot, JsonObject> = {
    cliff: perspective([-48, 14, 42], [0, 11, -4], 55),
    snow: perspective([1400, 520, -1450], [0, 170, -1500], 45),
    field: perspective([205, 18, 100], [170, 0, 62], 50),
  };
  const id = `fixture-1383-${o.shot}${o.defaults ? '-defaults' : ''}${set ? `-${set.replace(/[ .]/g, '-')}` : ''}`;
  return sessionDoc(id, o.size, `cam-${o.shot}`, {
    'cam-cliff': cams.cliff, 'cam-snow': cams.snow, 'cam-field': cams.field,
    sky: DAY_SKY, sun: sun(3, [-35, -135, 0]),
    turf: material([0.18, 0.32, 0.1], 0.9), rock: material([0.32, 0.29, 0.26], 0.85), snow: material([0.92, 0.94, 0.97], 0.6),
    soil: material([0.32, 0.22, 0.14], 0.8), checker: checkerMaterial(),
    cliff: plate(CLIFF_RIPPLED, 'turf', [cliffCover]),
    peaks: plate(PEAKS, 'rock', snow, PEAKS_AT),
    field: plate(FIELD, 'turf', [{ material: 'soil', where: {}, blend: 0, ...(modify ? { modify } : {}) }], FIELD_AT),
  }, { assets: checkerEntry(), channels });
}

// ---------------------------------------------------------------------------------------------------
// #1399's golden guard, applied to every frame a test compares by hash: at least 32 distinct colours and at least 5% of
// its pixels off its modal colour, so two blank frames never match.

export function blankness(im: Image): string {
  const counts = new Map<number, number>();
  for (let i = 0; i < im.width * im.height; i++) {
    const k = (im.rgba[4 * i]! << 16) | (im.rgba[4 * i + 1]! << 8) | im.rgba[4 * i + 2]!;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const modal = Math.max(...counts.values());
  const off = 1 - modal / (im.width * im.height);
  return counts.size >= 32 && off >= 0.05 ? '' : `${counts.size} distinct colours and ${(100 * off).toFixed(1)}% off the modal colour (the guard asks 32 and 5%)`;
}

// ---------------------------------------------------------------------------------------------------
// PNG reading and writing (#425's): 8-bit RGB or RGBA, no interlace; written with no filter at zlib level 9, so the
// same pixels give the same SHA-256.

export interface Image { width: number; height: number; rgba: Uint8Array }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let pos = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (pos < file.length) {
    const len = file.readUInt32BE(pos); const type = file.toString('latin1', pos + 4, pos + 8); const body = file.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}`);
  const channels = color === 6 ? 4 : 3; const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const row = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? row[i - channels]! : 0; const b = previous[i]!; const c = i >= channels ? previous[i - channels]! : 0; const x = row[i]!;
      const v = filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + b : filter === 3 ? x + ((a + b) >> 1) : filter === 4 ? x + paeth(a, b, c) : NaN;
      if (Number.isNaN(v)) throw Error(`PNG filter ${filter}`);
      row[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      rgba[o] = row[x * channels]!; rgba[o + 1] = row[x * channels + 1]!; rgba[o + 2] = row[x * channels + 2]!; rgba[o + 3] = channels === 4 ? row[x * channels + 3]! : 255;
    }
    previous = row;
  }
  return { width, height, rgba };
}
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
/** An animated PNG of equal-sized frames at `fps`, looping. */
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
