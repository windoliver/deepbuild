// Test-side tools for the #2691 acceptance tests (a mirror renders at half the internal size): `deep-gpu` (#377's
// binary) built for release by ../2189's `useRelease` and driven by JSON lines on this Mac's own Metal GPU, with #378's
// `view3d` and #379's `live` (no stub meter, no `--backend noop`); the documents the tests draw, each one another
// suite's own fixture built by that suite's helpers (#1903's every-pass scene, #465's and #166's fixtures, the shipped
// castle) or made here from their builders; the readings each run keeps under target/acceptance/2691/; and the merge
// base's readings in fixtures/base/, which are those files as this suite's run on the unchanged base kept them (README:
// The merge base's readings). Nothing here stands in for the renderer, the check, its estimate or the device.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { LOOK as ENVELOPE_LOOK, WRITER as ENVELOPE_WRITER } from '../1903/helpers.ts';
import {
  DAY_SKY, FILMIC as FILMIC_465, box, camera, flareShowcase, look3d as look465, material, mirrors, plate, sceneDoc, sun,
  type JsonObject, type JsonValue,
} from '../465/helpers.ts';
import {
  DEFAULTS, FILMIC as FILMIC_166, LAKE_WAVES, STEEP_WAVES, STILL, harbour, look3d as look166, type Water,
} from '../166/helpers.ts';

export { useOut, useRelease } from '../2189/helpers.ts';
export { ENVELOPE_LOOK, ENVELOPE_WRITER };
export type { JsonObject, JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/2691 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
/** The merge base these tests were written at, whose readings fixtures/base/ holds. */
export const BASE_SHA = '89863843d85271d0aadcd9ca4702e411d67c7613';

/** Each criterion's ID: the first 8 hex digits of SHA-256 of its text, trimmed, white space collapsed (README). */
export const AC = {
  1: '#2691.ee689a34', 2: '#2691.49387bf5', 3: '#2691.ecd8e156', 4: '#2691.f1acfa43', 5: '#2691.bf51397a',
} as const;

// ---------------------------------------------------------------------------------------------------
// Verdict words and JSON

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** Everything here draws on macOS's Metal device; off it, INCONCLUSIVE. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the criteria are read on Metal, and this is ${process.platform}`);
}
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
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${shown(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${shown(v)}`).toBe('string');
  return v as string;
}
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const SHA = /^[0-9a-f]{64}$/;
export type Size = [number, number];
/** `[w, h]` of whole numbers above 0, or null for anything else (a reply that names no size). */
export function sizeOf(v: JsonValue | undefined): Size | null {
  return Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isInteger(n) && n > 0) ? [v[0] as number, v[1] as number] : null;
}
export const by = (s: readonly [number, number]): string => `${s[0]} × ${s[1]}`;
/** Half a size, each axis rounded up: the issue's "half the view's internal size, rounded up". */
export const half = (s: readonly [number, number]): Size => [Math.ceil(s[0] / 2), Math.ceil(s[1] / 2)];
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const path = join(dir, `${name.replace(/[^a-z0-9-]+/gi, '_')}.json`);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one scenario in, one line out (#377), on this Mac's GPU.

/** The wrong programs this suite adds to `deep-gpu run`, each reachable only through `--planted` (README). */
export type Planted = 'mirror_halves_twice' | 'mirror_samples_full_frame';

/** One `deep-gpu` scenario, accepted, with one reply per call, in one process. With no device, INCONCLUSIVE. */
export function runGpu(bin: string, out: string, calls: JsonObject[], planted?: Planted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const label = `deep-gpu ${args.join(' ')}`;
  const r = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 3_000_000, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${label} did not finish within 3,000 s`);
  if (r.error) throw Error(`${label}: ${r.error.message}`);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  let first: JsonValue = null;
  try { first = JSON.parse(lines[0] ?? 'null') as JsonValue; } catch { first = lines[0] ?? null; }
  // #377: a binary that finds no device answers one line {"ok": false, "code": "no_device", "reason"} and exits 1.
  if (r.status === 1 && isObject(first) && first['ok'] === false && first['code'] === 'no_device') inconclusive(`no Metal device: ${shown(first['reason'])}`);
  expect(r.status, `${label} exits 0 (${r.signal ?? 'no signal'})${planted ? `: the binary knows the planted program ${planted} (README: Planted programs)` : ''}; stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  expect(lines.length, `${label}: one output line`).toBe(1);
  const a = obj(first, `${label}: the answer`);
  expect(a['ok'], `${label} accepted the scenario: ${shown(a)}`).toBe(true);
  const replies = arr(a['replies'], `${label}: replies`).map((x, i) => obj(x, `${label}: replies[${i}]`));
  expect(replies.length, `${label}: one reply per call`).toBe(calls.length);
  const lost = replies.find((x) => x['code'] === 'no_device' || x['code'] === 'unsupported_platform');
  if (lost !== undefined) inconclusive(`the device could not be had: ${shown(lost)}`);
  return replies;
}
/** A reply the binary answered, not refused (any `code`). */
export function answered(reply: JsonObject, what: string): JsonObject {
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  return reply;
}

/** The GPU surface a `view3d` call draws through (#386): absent, internal scale 1. */
export interface SurfaceSpec { internal_scale: number }
/** `view3d` (#378, #386, #166): the fields this suite drives, all the base's. */
export interface View3d {
  doc: string; look: JsonObject; size: Size; frames?: number; fps?: number; from?: number; capture?: number[];
  targets?: ('final' | 'reflection')[]; timings?: boolean; surface?: SurfaceSpec; packs?: string[];
}
export const view3d = (v: View3d): JsonObject => ({ call: 'view3d', ...(v as unknown as JsonObject) });

/** A frame row of `view3d`: its index, its pixel hash and the row as given. */
export interface Frame { frame: number; pixel_hash: string; raw: JsonObject }
export function framesOf(reply: JsonObject, what: string): Frame[] {
  answered(reply, what);
  return arr(reply['frames'], `${what}: frames`).map((v, i): Frame => {
    const f = obj(v, `${what}: frames[${i}]`);
    const hash = str(f['pixel_hash'], `${what}: frames[${i}].pixel_hash`);
    expect(hash, `${what}: frames[${i}].pixel_hash is a SHA-256`).toMatch(SHA);
    return { frame: num(f['frame'], `${what}: frames[${i}].frame`), pixel_hash: hash, raw: f };
  });
}
export function frameAt(reply: JsonObject, n: number, what: string): Frame {
  const frames = framesOf(reply, what);
  const f = frames.find((x) => x.frame === n);
  expect(f, `${what}: frame ${n} is in the reply (frames ${frames.slice(0, 20).map((x) => x.frame).join(', ')})`).toBeDefined();
  return f!;
}
/** A file the binary wrote under `out`, named by its SHA-256, which it must hash to. */
export function readNamed(out: string, hash: JsonValue | undefined, ext: string, what: string): Buffer {
  const h = str(hash, `${what} (a file named by its SHA-256)`);
  expect(h, `${what} is named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${h}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(h);
  return file;
}

/** What a `view3d` reply says it drew through (#386's `surface`), with this suite's one added field, `mirror_px`:
 * the size in px the mirror's pass drew at, `[w, h]`; `null` here when the reply names none. */
export interface Drew { internal_scale: number; size_px: Size | null; internal_px: Size | null; mirror_px: Size | null; mirror_raw: JsonValue | undefined }
export function drewOf(reply: JsonObject, what: string): Drew {
  const s = obj(answered(reply, what)['surface'], `${what}: surface`);
  return {
    internal_scale: num(s['internal_scale'], `${what}: surface.internal_scale`), size_px: sizeOf(s['size_px']), internal_px: sizeOf(s['internal_px']),
    mirror_px: sizeOf(s['mirror_px']), mirror_raw: s['mirror_px'],
  };
}

// ---------------------------------------------------------------------------------------------------
// The machine, what each run keeps, and the merge base's readings

/** The machine a reading holds on: pixel hashes and device bytes are one machine's (the design's same-machine
 * determinism), by its model, its chip and its macOS build, as scripts/benchmark.mjs's fingerprint reads them. */
export interface Machine { model: string | null; chip: string | null; macosBuild: string | null }
export function machine(): Machine {
  const read = (command: string, ...args: string[]): string | null => {
    try { return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }).trim() || null; } catch { return null; }
  };
  return { model: read('sysctl', '-n', 'hw.model'), chip: read('sysctl', '-n', 'machdep.cpu.brand_string'), macosBuild: read('sw_vers', '-buildVersion') };
}
const git = (...args: string[]): string => spawnSync('git', args, { cwd: REPO, encoding: 'utf8' }).stdout?.trim() ?? '';
/** Where each run keeps its own readings: the mirror's size, the device's bytes, the hashes, the lake's picture. */
export const KEPT = join(REPO, 'target', 'acceptance', '2691');
/** The header every kept reading carries: the commit and the machine it was read on, and whether the work tree held
 * changes outside this folder and docs/evidence/2691/ (a reading of the merge base has none). */
export interface Header { issue: 2691; commit: string; changed: string[]; machine: Machine; binary: string }
/** Keeps `value` as target/acceptance/2691/<name>.json, under the header, before anything is judged; answers that
 * path from the checkout's root. */
export function keep(name: string, value: JsonObject): string {
  mkdirSync(KEPT, { recursive: true });
  const changed = git('status', '--porcelain').split('\n').map((l) => l.slice(3)).filter((p) => p !== '' && !p.startsWith('tests/acceptance/2691/') && !p.startsWith('docs/evidence/2691/'));
  const header: Header = { issue: 2691, commit: git('rev-parse', 'HEAD'), changed, machine: machine(), binary: 'cargo build --locked --release --bin deep-gpu' };
  writeFileSync(join(KEPT, `${name}.json`), `${JSON.stringify({ ...(header as unknown as JsonObject), ...value }, null, 2)}\n`);
  return `target/acceptance/2691/${name}.json`;
}
const BASE_DIR = join(HERE, 'fixtures', 'base');
/** The merge base's reading `name`: fixtures/base/<name>.json, the file this suite's run on the unchanged base kept.
 * It must be a reading of the merge base's unchanged tree; on another machine than the one it was read on, or with
 * none kept, the test that needs it is INCONCLUSIVE. */
export function mergeBase(name: string): JsonObject {
  const path = join(BASE_DIR, `${name}.json`);
  if (!existsSync(path)) inconclusive(`no reading of the merge base is kept as tests/acceptance/2691/fixtures/base/${name}.json`);
  const base = obj(JSON.parse(readFileSync(path, 'utf8')) as JsonValue, `fixtures/base/${name}.json`);
  expect(base['commit'], `fixtures/base/${name}.json was read on the merge base ${BASE_SHA}`).toBe(BASE_SHA);
  expect(base['changed'], `fixtures/base/${name}.json was read on the merge base's unchanged tree`).toEqual([]);
  const [there, here] = [JSON.stringify(base['machine']), JSON.stringify(machine())];
  if (there !== here) inconclusive(`the merge base's ${name} reading was taken on ${there} and this machine is ${here}; pixel hashes and device bytes hold on one machine`);
  return base;
}
/** A file beside the merge base's readings, by its recorded SHA-256. */
export function mergeBaseFile(name: string, hash: JsonValue | undefined): Buffer {
  const file = readFileSync(join(BASE_DIR, name));
  expect(sha256(file), `fixtures/base/${name} is the file the merge base's reading names`).toBe(hash);
  return file;
}

// ---------------------------------------------------------------------------------------------------
// #1903's every-pass scene (criteria 1 and 4)

/** #1903's every-pass scene, the file ../2189 copied from its evidence, unchanged: a showpiece whose orbit camera turns
 * once over 60 s, with a sky, a shadowed sun and lamp, a mirror floor, a patterned material, a 400-element instancer
 * and a lens flare; its own `size` is 3456 × 2234. */
export const EVERY_PASS = join(REPO, 'tests', 'acceptance', '2189', 'fixtures', 'every-pass.json');
/** Full screen on the reference display, the scene's own size. */
export const FULL_SCREEN: Size = [3456, 2234];
/** The reference window in px: 1512 × 982 points at 2× (technical design: Decided, "The reference window"). */
export const REFERENCE_WINDOW: Size = [3024, 1964];
/** The every-pass scene with its camera at rest: the same document without its one channel, which turns the camera.
 * A showpiece's check sizes a view at 0.5 only while its camera moves, and at 1 at rest (the budget class table). */
export function everyPassAtRest(dir: string): string {
  const doc = obj(JSON.parse(readFileSync(EVERY_PASS, 'utf8')) as JsonValue, 'the every-pass scene');
  const channels = obj(doc['channels'], 'the every-pass scene\'s channels');
  expect(Object.values(channels).map((c) => (isObject(c) ? c['target'] : null)), 'the every-pass scene\'s only channel turns its camera').toEqual(['items/cam/params/orbit/azimuth']);
  const rest: JsonObject = { ...doc };
  delete rest['channels'];
  return writeJson(dir, 'every-pass-at-rest', rest);
}

// ---------------------------------------------------------------------------------------------------
// Criterion 2: every fixture of ../465 and ../166, as those suites' helpers build them and their tests draw them

/** One fixture at internal scale 1: its document, look and size as the suite's own test draws it, and the frames read. */
export interface ScaleOne { name: string; doc: JsonObject; look: JsonObject; size: Size; frames: number[] }
/** The fixtures ../465/helpers.ts and ../166/helpers.ts export (`mirrors`, `flareShowcase`, `harbour`), in every
 * variant, look, size and frame their suites' tests draw them at (30 fps, each frame opened by a seek). */
export function scaleOneFixtures(): ScaleOne[] {
  const room: Size = [640, 360]; const shot: Size = [1280, 720]; const lake: Size = [480, 270]; const small: Size = [320, 180];
  const [mirror465, seek166, defaults166, foam166] = [look465('mirror-465'), look166('seek-166'), look166('defaults-166'), look166('foam-166')];
  const named: JsonObject = { mirror: { strength: 1, blur: 0, plane: 'lake' } };
  const foamy: Water = { waves: STEEP_WAVES, foam: { threshold: 0.6 }, wake: { item: 'boat', span: 8 } };
  const waves: Water = { waves: LAKE_WAVES, ripples: { strength: 0.3 } };
  return [
    // ../465/mirror.test.ts
    { name: '465/mirrors-both', doc: mirrors('both', room), look: mirror465, size: room, frames: [0, 17, 44] },
    { name: '465/mirrors-m1_plain', doc: mirrors('m1_plain', room), look: mirror465, size: room, frames: [17] },
    { name: '465/mirrors-m2_plain', doc: mirrors('m2_plain', room), look: mirror465, size: room, frames: [0] },
    { name: '465/mirrors-no_m2', doc: mirrors('no_m2', room), look: mirror465, size: room, frames: [0] },
    // ../465/taste.test.ts
    { name: '465/taste-flare', doc: flareShowcase(shot, false), look: FILMIC_465, size: shot, frames: [0] },
    { name: '465/taste-mirror', doc: mirrors('both', shot), look: FILMIC_465, size: shot, frames: [0] },
    { name: '465/taste-moving', doc: flareShowcase(room, true), look: FILMIC_465, size: room, frames: [0, 30, 59] },
    // ../166/seek.test.ts
    { name: '166/lake-seek', doc: harbour('lake-seek', lake, { ...waves, rain: 50 }), look: seek166, size: lake, frames: [17, 44, 89] },
    { name: '166/lake-dry', doc: harbour('lake-dry', lake, { ...waves, rain: 0 }), look: seek166, size: lake, frames: [44] },
    { name: '166/lake-smooth', doc: harbour('lake-smooth', lake, { waves: LAKE_WAVES, ripples: { strength: 0 }, rain: 50 }), look: seek166, size: lake, frames: [44] },
    // ../166/defaults.test.ts
    { name: '166/lake-bare', doc: harbour('lake-bare', lake, {}, { waterExtra: {} }), look: defaults166, size: lake, frames: [0, 20, 45] },
    { name: '166/lake-spelled', doc: harbour('lake-spelled', lake, DEFAULTS, { waterExtra: named }), look: defaults166, size: lake, frames: [20] },
    { name: '166/lake-wind6', doc: harbour('lake-wind6', lake, { ...DEFAULTS, waves: { wind: { speed: 6, direction: 0 } } }, { waterExtra: named }), look: defaults166, size: lake, frames: [20] },
    { name: '166/lake-half-mirror', doc: harbour('lake-half-mirror', lake, DEFAULTS, { waterExtra: { mirror: { strength: 0.5, blur: 0, plane: 'lake' } } }), look: defaults166, size: lake, frames: [20] },
    { name: '166/lake-red-tint', doc: harbour('lake-red-tint', lake, { ...DEFAULTS, absorption: { color: [0.5, 0.1, 0.1], depth: 3 } }, { waterExtra: named }), look: defaults166, size: lake, frames: [20] },
    // ../166/foam.test.ts
    { name: '166/lake-foamy', doc: harbour('lake-foamy', small, foamy, { boat: true }), look: foam166, size: small, frames: [600] },
    { name: '166/lake-no-foam', doc: harbour('lake-no-foam', small, { ...foamy, foam: { threshold: 1 } }, { boat: true }), look: foam166, size: small, frames: [600] },
    { name: '166/lake-no-wake', doc: harbour('lake-no-wake', small, { ...foamy, wake: 'none' }, { boat: true }), look: foam166, size: small, frames: [600] },
    // ../166/taste.test.ts
    { name: '166/taste-lake', doc: harbour('lake', shot, waves), look: FILMIC_166, size: shot, frames: [30] },
    { name: '166/taste-rain', doc: harbour('rain', shot, { ...waves, rain: 50 }), look: FILMIC_166, size: shot, frames: [30] },
    { name: '166/taste-foam', doc: harbour('foam', shot, foamy, { boat: true }), look: FILMIC_166, size: shot, frames: [360] },
    { name: '166/taste-rain-wake', doc: harbour('rain-wake', room, { waves: LAKE_WAVES, rain: 50, foam: { threshold: 0.6 }, wake: { item: 'boat', span: 8 } }, { boat: true }), look: FILMIC_166, size: room, frames: [270, 359] },
  ];
}
/** What one frame of a fixture drew: its pixel hash and the size its reply names for the mirror's pass. */
export interface Drawn { name: string; frame: number; size: Size; pixel_hash: string; mirror_px: Size | null }
/** Every fixture's frames, each opened by a seek at 30 fps and internal scale 1, in one process. */
export function drawScaleOne(bin: string, out: string, planted?: Planted): Drawn[] {
  const fixtures = scaleOneFixtures();
  const asked = fixtures.flatMap((f) => {
    const doc = writeJson(out, f.name, f.doc);
    return f.frames.map((frame) => ({ f, frame, call: view3d({ doc, look: f.look, size: f.size, from: frame, frames: 1, fps: 30 }) }));
  });
  const replies = runGpu(bin, out, asked.map((a) => a.call), planted);
  return asked.map(({ f, frame }, i): Drawn => {
    const what = `${f.name} frame ${frame}`;
    const drew = drewOf(replies[i]!, what);
    expect(drew.internal_scale, `${what} drew at internal scale 1`).toBe(1);
    return { name: f.name, frame, size: f.size, pixel_hash: frameAt(replies[i]!, frame, what).pixel_hash, mirror_px: drew.mirror_px };
  });
}
/** Criterion 2's check: each frame's pixel hash against the merge base's, one sentence per frame that differs, naming
 * the fixture, the frame, both hashes and the size its mirror's pass drew at. */
export function scaleOneFailures(drawn: Drawn[], base: JsonObject): string[] {
  const hashes = obj(base['hashes'], 'the merge base\'s hashes');
  const failures: string[] = [];
  for (const d of drawn) {
    const key = `${d.name}@${d.frame}`;
    const want = hashes[key];
    if (typeof want !== 'string') { failures.push(`${d.name} frame ${d.frame}: the merge base's readings hold no hash for it`); continue; }
    if (want === d.pixel_hash) continue;
    const mirror = d.mirror_px === null ? 'its reply names no size for a mirror\'s pass' : `its mirror's pass drew at ${by(d.mirror_px)}, where half of its ${by(d.size)} is ${by(half(d.size))}`;
    failures.push(`${d.name} frame ${d.frame}: pixel hash ${d.pixel_hash}, the merge base's ${want}; ${mirror}`);
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 3: the half-size room

/** A room seen steeply from above, so its 60 m mirror floor fills the frame: a red unlit post (the marker, whose
 * reflection lies in the frame's upper left quarter), three lit crates, a day sky and a sun without shadows. Nothing
 * in it is sized in px of the frame: no blur and no roughness on the mirror, no line, point or label, no flare, no
 * waves, so a view at internal scale 0.5 and a canonical render at half its size draw the same mirrored picture.
 * The camera's target lies on the floor. `floor` is a plain mirror, or a still water reflecting through its own. */
export function halfSizeRoom(size: Size, floor: 'mirror' | 'water'): JsonObject {
  const surface: JsonObject = floor === 'mirror'
    ? { base_color: [0.1, 0.1, 0.1, 1], metallic: 0, roughness: 0, mirror: { strength: 1, blur: 0, plane: 'floor' } }
    : { roughness: 0, water: STILL as unknown as JsonObject };
  const doc = sceneDoc(`half-size-room-${floor}`, size, {
    cam: camera([0, 7, 6], [0, 0, 0], 50), sky: DAY_SKY, sun: sun(3, [-50, 30, 0]),
    floor_mat: material(surface), marker_mat: material({ base_color: [1, 0, 0, 1], unlit: true }),
    wood: material({ base_color: [0.7, 0.45, 0.3, 1], roughness: 0.6 }), stone: material({ base_color: [0.5, 0.52, 0.55, 1], roughness: 0.8 }),
    floor: plate([60, 60], [0, 0, 0], [0, 0, 0], 'floor_mat'),
    marker: box([0.4, 1.2, 0.4], [-2.2, 0.6, -3.2], 'marker_mat'),
    crate1: box([1.2, 1.2, 1.2], [2.6, 0.6, -1.5], 'wood'), crate2: box([0.8, 2.0, 0.8], [3.2, 1.0, 1.6], 'stone'), crate3: box([1.6, 0.6, 1.0], [-1.0, 0.3, 2.4], 'wood'),
  });
  if (floor === 'water') obj(obj(obj(doc['items'], 'items')['floor'], 'floor')['params'], 'the floor\'s params')['grid'] = [64, 64];
  return doc;
}
export const HALF_LOOK = look465('half-size-2691');
/** The view's size and the canonical render's: half of it, so both draw 640 × 360 internal px and a 320 × 180 mirror. */
export const VIEW: Size = [1280, 720];
export const CANONICAL: Size = [640, 360];

/** A `reflection` target (#166): f32 RGBA, rows top-down, at the frame's internal size: at each pixel of a part that
 * reflects, the linear color its mirror lookup returned (alpha 1); 0 elsewhere. */
export interface Reflection { hash: string; size: Size; v: Float32Array }
export function readReflection(out: string, reply: JsonObject, frame: number, size: Size, what: string): Reflection {
  const row = frameAt(reply, frame, what).raw;
  const file = readNamed(out, row['reflection'], 'f32', `${what}: reflection`);
  expect(file.length, `${what}: its reflection target holds ${by(size)} pixels of 4 f32`).toBe(size[0] * size[1] * 16);
  const v = new Float32Array(size[0] * size[1] * 4);
  for (let i = 0; i < v.length; i++) v[i] = file.readFloatLE(i * 4);
  return { hash: str(row['reflection'], `${what}: reflection`), size, v };
}
/** The marker in a reflection target: its pixels (red above 0.5, green and blue under 0.1) and their centroid in px. */
export function marker(t: Reflection): { pixels: number; at: [number, number] } {
  let n = 0; let sx = 0; let sy = 0;
  for (let p = 0; p < t.size[0] * t.size[1]; p++) {
    if (t.v[p * 4]! > 0.5 && t.v[p * 4 + 1]! < 0.1 && t.v[p * 4 + 2]! < 0.1) { n++; sx += p % t.size[0]; sy += Math.floor(p / t.size[0]); }
  }
  return { pixels: n, at: n === 0 ? [Number.NaN, Number.NaN] : [sx / n, sy / n] };
}
/** How the view's mirrored picture stands against the canonical render's: each reflection target's SHA-256, the
 * marker's offset in px (the view's centroid less the canonical render's), and the sentence a failure carries, which
 * names both hashes, how many texels differ and that offset. */
export interface Compared { view: string; canonical: string; offset: [number, number]; sentence: string }
export function compareReflections(view: Reflection, canonical: Reflection, what: string): Compared {
  const [a, b] = [marker(view), marker(canonical)];
  // Two blank targets never match as a pass: the canonical render shows the marker and a floor that reflects.
  expect(b.pixels, `${what}: the canonical render's reflection shows the marker (at least 200 px of it)`).toBeGreaterThanOrEqual(200);
  let reflecting = 0; let differ = 0;
  for (let p = 0; p < canonical.size[0] * canonical.size[1]; p++) {
    if (canonical.v[p * 4 + 3]! > 0) reflecting++;
    if ([0, 1, 2, 3].some((c) => view.v[p * 4 + c] !== canonical.v[p * 4 + c])) differ++;
  }
  expect(reflecting, `${what}: at least half of the canonical render's pixels reflect`).toBeGreaterThanOrEqual((canonical.size[0] * canonical.size[1]) / 2);
  const offset: [number, number] = [a.at[0] - b.at[0], a.at[1] - b.at[1]];
  const moved = a.pixels === 0 ? 'the marker\'s reflection is missing from the view' : `the marker's reflection is offset by (${offset[0].toFixed(2)}, ${offset[1].toFixed(2)}) px`;
  return {
    view: view.hash, canonical: canonical.hash, offset,
    sentence: `${what}: the reflection at internal scale 0.5 (${view.hash}) against the canonical render's at half the size (${canonical.hash}): ${differ} of ${canonical.size[0] * canonical.size[1]} texels differ, and ${moved} against the canonical render's`,
  };
}

// ---------------------------------------------------------------------------------------------------
// Criterion 5: the castle on a lake

/** The frame of the castle's flythrough the pictures show: its first. */
export const LAKE_FRAME = 0;
/** The shipped castle (packs/examples/castle.json, its look and its pack) standing in a lake, since the shipped castle
 * has none: a 4 km plate `lake` at y = 0, the castle's ground, whose material `lake_water` is a mirror at strength 0.85
 * with no blur over dark water; the sky without its height fog, which lay below the island where the lake now is; and
 * the camera's target lowered to the water (README: Ambiguities, the castle's lake). */
export function castleLake(): { doc: JsonObject; look: JsonObject; packs: string[] } {
  const examples = join(REPO, 'packs', 'examples');
  const doc = obj(JSON.parse(readFileSync(join(examples, 'castle.json'), 'utf8')) as JsonValue, 'packs/examples/castle.json');
  const look = obj(JSON.parse(readFileSync(join(examples, 'castle.look.json'), 'utf8')) as JsonValue, 'packs/examples/castle.look.json');
  const items = obj(doc['items'], 'the castle\'s items');
  expect(Object.values(items).filter((i) => isObject(i) && isObject(i['params']) && (i['params']['mirror'] !== undefined || i['params']['water'] !== undefined)), 'the shipped castle has no mirror and no water of its own').toEqual([]);
  items['lake_water'] = { id: 'lake_water', kind: 'material@1', name: 'Lake water', order: 'z000', params: { base_color: [0.02, 0.05, 0.07, 1], metallic: 0, roughness: 0, mirror: { strength: 0.85, blur: 0, plane: 'lake' } } };
  items['lake'] = { id: 'lake', kind: 'plate@1', name: 'Lake', order: 'z001', params: { grid: [1, 1], size: [4000, 4000] }, at: { pos: [0, 0, 0] }, material: 'lake_water' };
  const sky = obj(obj(items['sky'], 'the castle\'s sky')['params'], 'the sky\'s params');
  delete sky['fog_height'];
  const target = arr(obj(obj(items['cam'], 'the castle\'s camera')['params'], 'the camera\'s params')['target'], 'the camera\'s target');
  expect(target.length, 'the camera\'s target is [x, y, z]').toBe(3);
  target[1] = 0;
  return { doc, look, packs: [join(REPO, 'packs', 'composites-1.0.0')] };
}
