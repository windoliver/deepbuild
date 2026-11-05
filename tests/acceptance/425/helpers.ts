// Test-side tools for the #425 acceptance tests: the base's `deep-gpu` binary (#377's GPU layer, with #378's
// `view3d`, #379's `live` and `canonical` calls, its `test-meter` build and stub meter, #420's `mesh.asset@1` and
// #421's light policy), built once per file per feature set and driven by JSON lines; the calls and fields this suite
// adds (README: Assumed surfaces); the documents the tests draw; the band, light-cut and level sweeps that reach one
// view from either side; a generated mesh asset; and PNG reading and writing for the taste call (copied from #422's
// and #379's helpers, since suites don't import each other). Nothing here stands in for the level of detail, the
// light cut, the masks, the ladder or the canonical render under test.

import { spawnSync } from 'node:child_process';
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
/** The checkout root (tests/acceptance/425 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text (README: Criteria to tests). */
export const AC = {
  1: 'AC1 #425.85981004',
  2: 'AC2 #425.fe13e22a',
  3: 'AC3 #425.4c1317b2',
  4: 'AC4 #425.96e311e5',
  5: 'AC5 #425.f5321458',
  6: 'AC6 #425.e26677a1',
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
// The builds: deep-gpu per feature set, each built once per file and copied out of the target folder.

/** `default` is the shipped build; `test-meter` adds #379's stub meter. */
export type Build = 'default' | 'test-meter';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetDir = (): string => process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');
const cargoArgs = (build: Build): string[] => ['build', '--locked', '--bin', 'deep-gpu', ...(build === 'default' ? [] : ['--features', build])];
function cargoBuild(build: Build): string {
  const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const run = spawnSync('cargo', cargoArgs(build), { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${cargoArgs(build).join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
/** Builds every listed set before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useBuilds(builds: readonly Build[]): (build: Build) => string {
  let dir = '';
  const made = new Map<Build, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-425-bin-'));
    for (const build of builds) {
      const error = cargoBuild(build);
      const bin = join(dir, exe(`deep-gpu-${build}`));
      if (error === '') copyFileSync(join(targetDir(), 'debug', exe('deep-gpu')), bin);
      made.set(build, { bin, error });
    }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (build) => {
    const entry = made.get(build);
    if (!entry) throw Error(`the file didn't list the build ${build}`);
    expect(entry.error, `the binary builds: cargo ${cargoArgs(build).join(' ')}`).toBe('');
    return entry.bin;
  };
}
/** A fresh temporary folder per test (documents, outputs), deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-425-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--backend noop] [--planted <name>]`: one JSON line in, one JSON line out (#377).

/** `deep-gpu --planted` names this suite adds, each a wrong program reachable only there (README: Planted programs). */
export type GpuPlanted =
  | 'band_hysteresis' | 'light_cut_hysteresis' | 'band_fade_by_wall_clock' | 'level_by_earlier_frame'
  | 'band_masks_independent' | 'blend_level_on_gpu' | 'climb_never_steps_down' | 'canonical_climbs'
  | 'reclimbs_without_view_change';
export interface Startup { planted?: GpuPlanted; backend?: 'noop' }

/** One process: the calls in order, a reply per call. */
export function runGpu(bin: string, out: string, calls: JsonObject[], startup: Startup = {}): JsonObject[] {
  const args = ['run', ...(startup.backend ? ['--backend', startup.backend] : []), ...(startup.planted ? ['--planted', startup.planted] : [])];
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
/** A reply that holds no refusal `code`; INCONCLUSIVE when the platform can't draw it. */
export function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  return reply;
}

// ---------------------------------------------------------------------------------------------------
// Looks and documents

/** A physical-basis `look@1` (#421's shape), filmic at exposure 0. */
export const LOOK: JsonObject = {
  id: 'look-425', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'The #425 acceptance look.',
  palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', stone: '#d9dde3', sand: '#e6d3a3' },
  roles: { ground: 'night', ink: 'graphite', muted: 'slate', stone: 'stone', sand: 'sand' },
  themes: { light: {}, dark: {} },
  fonts: {
    body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
    mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  },
  tone_map: 'filmic', exposure: 0, finish: [], deband: 'none', bloom: 'none', ground_3d: { kind: 'none' },
  status: { pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464' },
  status_treatment: { core_min_px: 4, glyph: { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' } },
  min_distance: 0.1, attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
};

export type V3 = [number, number, number];
/** A scene document as a view3d session holds it (#378): an `id`, one writer layer, every item in it. */
export function sessionDoc(id: string, size: [number, number], items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #425 acceptance fixture.`, size, camera: 'cam', transport: { span: '10s' },
    requires: { modules: { scene3d: '^1' } }, budget: { class: 'work_product' }, layers: { main: { writer: 'agent:sess-alpha', title: 'main', order: 'a0' } }, ...extra, items: withIds,
  };
}
export const box = (size: V3, pos: V3, mat: string): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos }, material: mat });
export const material = (base: [number, number, number], roughness: number): JsonObject => ({ kind: 'material@1', params: { base_color: [...base, 1], roughness } });
export const point = (power: number, pos: V3, extra: JsonObject = {}): JsonObject => ({ kind: 'light.point@1', params: { power, range: 500, color: [1, 1, 1], ...extra }, at: { pos } });
/** A key sun (`light.sun@1`, shining along its own −Z, aimed by `at.rot` in degrees) that casts, kept by its priority. */
export const sun = (illuminance: number): JsonObject =>
  ({ kind: 'light.sun@1', params: { illuminance, color: [1, 1, 1], shadow: true, priority: 10 }, at: { rot: [-60, 25, 0] } });

// ---------------------------------------------------------------------------------------------------
// Sweeps: a camera value that goes out and comes back, so frame n and frame 2L − n show the same view, reached from
// either side. The channel holds each frame's value exactly (`hold` keys between frames), so the two views are equal
// bit for bit, and a seek to frame n draws the same view with no history.

export const SWEEP_FPS = 32;
export interface Sweep { values: number[]; leg: number; last: number }
/** `out` (the out leg, frames 0 … L), then back (frames L + 1 … 2L), each value an f32. */
export function sweep(out: number[]): Sweep {
  const leg = out.length - 1;
  const f = out.map((v) => Math.fround(v));
  return { values: [...f, ...f.slice(0, leg).reverse()], leg, last: 2 * leg };
}
/** A `hold` channel giving frame n (at t = n ÷ fps) the value `values[n]`: key n sits half a frame before it. */
export function holdChannel(target: string, values: number[], fps = SWEEP_FPS): JsonObject {
  const keys: JsonObject = {};
  values.forEach((value, n) => { keys[`k${String(n).padStart(4, '0')}`] = { t: n === 0 ? '0s' : `${(2 * n - 1) / (2 * fps)}s`, value, interp: 'hold' }; });
  return { target, type: 'f32', keys };
}

/** The band and light-cut sweep (README: The fixtures): a clay ball with one band below 48 px, 30 fill lights and a
 * sun kept by their priority, and two lights, b-near and c-far, that trade the 32nd place as the camera dollies from
 * z = 6 to z = 30 m and back, in 0.25 m steps. */
export const BAND_SIZE: [number, number] = [320, 240];
export const BAND_SWEEP = sweep(Array.from({ length: 97 }, (_, k) => 6 + 0.25 * k));
export function bandItems(): Record<string, JsonObject> {
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [0, 1.5, 6], target: [0, 0, 0], fov: 40, near: 0.1, far: 200 } },
    stone: material([0.6, 0.6, 0.6], 0.8),
    clay: material([0.8, 0.35, 0.2], 0.5),
    ground: box([60, 0.2, 90], [0, -1.1, 15], 'stone'),
    ball: { kind: 'ball@1', params: { radius: 1, segments: 64 }, at: { pos: [0, 0, 0] }, material: 'clay', lod: { bands: [{ below_px: 48, show: 'box' }], margin: 0.1 } },
    sun: sun(1),
    'b-near': point(400, [-4, 0.5, 2]),
    'c-far': point(400, [4, 0.5, 34]),
  };
  for (let i = 0; i < 30; i++) {
    const a = (2 * Math.PI * i) / 30;
    items[`fill-${String(i).padStart(2, '0')}`] = point(50, [10 * Math.cos(a), 8, 15 + 10 * Math.sin(a)], { priority: 10 });
  }
  return items;
}
export const bandDoc = (): JsonObject =>
  sessionDoc('bands-425', BAND_SIZE, bandItems(), { channels: { dolly: holdChannel('items/cam/params/position/2', BAND_SWEEP.values) } });

// ---------------------------------------------------------------------------------------------------
// view3d (#378) and what this suite adds to it (README: Assumed surfaces 1–3)

export interface View3d {
  doc: string; look: JsonObject; size: [number, number]; frames?: number; fps?: number; from?: number;
  capture?: 'every' | number[]; targets?: ('final' | 'linear' | 'ids')[]; surface?: { internal_scale: number };
  assets?: Record<string, string>;
  /** This suite's: each frame's level-of-detail rows, its light cut, and each captured frame's band masks. */
  lod?: boolean; light_cut?: boolean; masks?: boolean;
}
export const view3dCall = (v: View3d): JsonObject => ({ call: 'view3d', fps: SWEEP_FPS, ...(v as unknown as JsonObject) });
export interface Blend { level: number; of: number }
export interface LodRow { item: string; bands: string[]; blend: Blend | null; level: number | null; errors_px: number[] | null; triangles: number | null; raw: JsonObject }
export interface Cut { shaded: { light: string; weight: number }[]; left_out: string[]; raw: JsonObject }
export interface MaskRow { item: string; pass: string; size: [number, number]; file: string }
export interface Frame3 { frame: number; pixel_hash: string | null; final: string | null; lod: LodRow[] | null; cut: Cut | null; masks: MaskRow[] | null }

const optNum = (v: JsonValue | undefined, what: string): number | null => (v === undefined || v === null ? null : num(v, what));
function lodRow(v: JsonValue, at: string): LodRow {
  const o = obj(v, at);
  const blend = o['blend'] === null || o['blend'] === undefined ? null : obj(o['blend'], `${at}.blend`);
  return {
    item: str(o['item'], `${at}.item`), bands: arr(o['bands'], `${at}.bands`).map((b, i) => str(b, `${at}.bands[${i}]`)),
    blend: blend ? { level: num(blend['level'], `${at}.blend.level`), of: num(blend['of'], `${at}.blend.of`) } : null,
    level: optNum(o['level'], `${at}.level`),
    errors_px: o['errors_px'] === null || o['errors_px'] === undefined ? null : arr(o['errors_px'], `${at}.errors_px`).map((e, i) => num(e, `${at}.errors_px[${i}]`)),
    triangles: optNum(o['triangles'], `${at}.triangles`), raw: o,
  };
}
export function framesOf(reply: JsonObject, what: string): Frame3[] {
  answered(reply, what);
  return arr(reply['frames'], `${what}: frames`).map((v, i): Frame3 => {
    const f = obj(v, `${what}: frames[${i}]`); const at = `${what}: frame ${String(f['frame'])}`;
    const c = f['light_cut'] === undefined ? null : obj(f['light_cut'], `${at}.light_cut`);
    return {
      frame: num(f['frame'], `${at}.frame`),
      pixel_hash: f['pixel_hash'] === null || f['pixel_hash'] === undefined ? null : str(f['pixel_hash'], `${at}.pixel_hash`),
      final: f['final'] === undefined || f['final'] === null ? null : str(f['final'], `${at}.final`),
      lod: f['lod'] === undefined ? null : arr(f['lod'], `${at}.lod`).map((r, j) => lodRow(r, `${at}.lod[${j}]`)),
      cut: c ? {
        shaded: arr(c['shaded'], `${at}.light_cut.shaded`).map((s, j) => { const o = obj(s, `${at}.light_cut.shaded[${j}]`); return { light: str(o['light'], 'a light'), weight: num(o['weight'], 'a weight') }; }),
        left_out: arr(c['left_out'], `${at}.light_cut.left_out`).map((s) => str(s, 'a light left out')), raw: c,
      } : null,
      masks: f['masks'] === undefined ? null : arr(f['masks'], `${at}.masks`).map((m, j) => {
        const o = obj(m, `${at}.masks[${j}]`); const size = arr(o['size'], `${at}.masks[${j}].size`);
        return { item: str(o['item'], 'a mask\'s item'), pass: str(o['pass'], 'a mask\'s pass'), size: [num(size[0], 'w'), num(size[1], 'h')], file: str(o['file'], 'a mask\'s file') };
      }),
    };
  });
}
export function frameAt(frames: Frame3[], n: number, what: string): Frame3 {
  const f = frames.find((x) => x.frame === n);
  expect(f, `${what}: frame ${n} is in the reply`).toBeDefined();
  return f!;
}
/** An item's row in a frame's `lod` report, or null (and a failure in `out`) when the frame has none. */
export function rowOf(f: Frame3, item: string, out: string[]): LodRow | null {
  if (f.lod === null) { out.push(`frame ${f.frame} carries no lod report`); return null; }
  const r = f.lod.find((x) => x.item === item);
  if (!r) out.push(`frame ${f.frame}'s lod report has no row for ${item}`);
  return r ?? null;
}

// ---------------------------------------------------------------------------------------------------
// The selection check: one view, reached from either side or by a seek, gives the same report and pixels.

export interface Played { play: Frame3[]; seeks: Frame3[] }
const key = (f: Frame3): string => JSON.stringify({ lod: f.lod?.map((r) => [r.item, r.bands, r.blend, r.level]) ?? null, cut: f.cut ? [f.cut.shaded, f.cut.left_out] : null });
/** The out-leg frames to seek: the first and the turn, each frame whose bands, blend, level or light cut differ from
 * the frame before it, and the two after it (where a fade, if there were one, would still show). */
export function seekFrames(play: Frame3[], s: Sweep): number[] {
  const want = new Set<number>([0, s.leg]);
  for (let k = 1; k <= s.leg; k++) {
    if (key(play[k]!) !== key(play[k - 1]!)) for (const j of [k, k + 1, k + 2]) if (j <= s.leg) want.add(j);
  }
  return [...want].sort((a, b) => a - b);
}
/** Plays the whole sweep in one session, then seeks each of `seekFrames` in a fresh process, one session each. */
export function playAndSeek(bin: string, out: string, call: View3d, s: Sweep, startup: Startup = {}): Played {
  const [p] = runGpu(bin, out, [view3dCall({ ...call, from: 0, frames: s.last + 1 })], startup);
  const play = framesOf(p!, 'the sweep');
  expect(play.map((f) => f.frame), 'the sweep reports every frame in order').toEqual(Array.from({ length: s.last + 1 }, (_, n) => n));
  const at = seekFrames(play, s);
  const replies = runGpu(bin, out, at.map((k) => view3dCall({ ...call, from: k, frames: 1 })), startup);
  return { play, seeks: replies.map((r, i) => frameAt(framesOf(r, `the seek to frame ${at[i]}`), at[i]!, `the seek to frame ${at[i]}`)) };
}
/** Every pair of frames that show one view (n and 2L − n, and a seek beside the frame it seeks) report the same
 * level-of-detail rows and light cut and draw the same pixels; each failure names its frames. */
export function sameViewProblems(p: Played, s: Sweep): string[] {
  const out: string[] = [];
  const compare = (a: Frame3, b: Frame3, how: string): void => {
    if (a.lod === null || b.lod === null) out.push(`frame ${a.frame} or frame ${b.frame} carries no lod report`);
    else if (JSON.stringify(a.lod.map((r) => r.raw)) !== JSON.stringify(b.lod.map((r) => r.raw))) out.push(`frame ${a.frame} and ${how} report other bands or levels: ${shown(a.lod.map((r) => r.raw))} vs ${shown(b.lod.map((r) => r.raw))}`);
    if (a.cut !== null || b.cut !== null) {
      if (JSON.stringify(a.cut?.raw ?? null) !== JSON.stringify(b.cut?.raw ?? null)) out.push(`frame ${a.frame} and ${how} report another light cut: ${shown(a.cut?.raw ?? null)} vs ${shown(b.cut?.raw ?? null)}`);
    }
    if (a.pixel_hash === null || a.pixel_hash !== b.pixel_hash) out.push(`frame ${a.frame} and ${how} draw other pixels: ${a.pixel_hash} vs ${b.pixel_hash}`);
  };
  for (let n = 0; n < s.leg; n++) compare(p.play[n]!, p.play[s.last - n]!, `frame ${s.last - n} (the same view, reached from the other side)`);
  for (const k of p.seeks) compare(p.play[k.frame]!, k, `a fresh process's seek to frame ${k.frame}`);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The mesh asset: a bumpy icosphere generated here, as a JSON glTF with its buffer inline (#420's reader), and the
// simplify job that gives it index-only levels (README: Assumed surfaces 4).

/** An icosphere of radius about 1, subdivided `depth` times (20 · 4^depth triangles), its radius bumped by a fixed
 * product of sines so its levels differ visibly. */
export function rockGltf(depth = 4): Buffer {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts: V3[] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  let faces: V3[] = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const norm = (v: V3): V3 => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; };
  verts = verts.map(norm);
  for (let d = 0; d < depth; d++) {
    const mid = new Map<string, number>();
    const m = (a: number, b: number): number => {
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      let i = mid.get(k);
      if (i === undefined) { const p = verts[a]!; const q = verts[b]!; i = verts.push(norm([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2])) - 1; mid.set(k, i); }
      return i;
    };
    faces = faces.flatMap(([a, b, c]) => { const ab = m(a, b); const bc = m(b, c); const ca = m(c, a); return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]] as V3[]; });
  }
  const pos = verts.map((v) => { const r = 1 + 0.08 * Math.sin(5 * v[0]) * Math.sin(5 * v[1]) * Math.sin(5 * v[2]); return [v[0] * r, v[1] * r, v[2] * r] as V3; });
  const p = Buffer.alloc(pos.length * 12); pos.forEach((v, i) => { p.writeFloatLE(v[0], i * 12); p.writeFloatLE(v[1], i * 12 + 4); p.writeFloatLE(v[2], i * 12 + 8); });
  const idx = Buffer.alloc(faces.length * 12); faces.forEach((f, i) => { idx.writeUInt32LE(f[0], i * 12); idx.writeUInt32LE(f[1], i * 12 + 4); idx.writeUInt32LE(f[2], i * 12 + 8); });
  const bin = Buffer.concat([p, idx]);
  const lo = [0, 1, 2].map((c) => Math.min(...pos.map((v) => Math.fround(v[c]!)))); const hi = [0, 1, 2].map((c) => Math.max(...pos.map((v) => Math.fround(v[c]!))));
  const gltf = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'rock' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    buffers: [{ byteLength: bin.length, uri: `data:application/octet-stream;base64,${bin.toString('base64')}` }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: p.length }, { buffer: 0, byteOffset: p.length, byteLength: idx.length }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: pos.length, type: 'VEC3', min: lo, max: hi },
      { bufferView: 1, componentType: 5125, count: faces.length * 3, type: 'SCALAR' },
    ],
  };
  return Buffer.from(JSON.stringify(gltf));
}
export const ROCK_TRIANGLES = 20 * 4 ** 4;
export interface Simplified { sha: string; path: string; triangles: number[]; lod_errors: number[] }
/** The simplify job's reply: its output, written under `out` as `<sha256>.gltf`, each level's triangles and the
 * probe's `lod_errors`. */
export function simplifiedOf(reply: JsonObject, out: string, what: string): Simplified {
  answered(reply, what);
  const sha = str(reply['sha256'], `${what}: sha256`);
  expect(sha, `${what}: sha256`).toMatch(SHA);
  const path = join(out, `${sha}.gltf`);
  expect(sha256(readFileSync(path)), `${what}: ${sha}.gltf hashes to its name`).toBe(sha);
  return {
    sha, path,
    triangles: arr(reply['levels'], `${what}: levels`).map((l, i) => num(obj(l, `${what}: levels[${i}]`)['triangles'], `${what}: levels[${i}].triangles`)),
    lod_errors: arr(reply['lod_errors'], `${what}: lod_errors`).map((e, i) => num(e, `${what}: lod_errors[${i}]`)),
  };
}
/** The level sweep: the leveled rock at the origin, the camera on +Z from 1.5 m to 60 m and back, geometrically. */
export const LEVEL_SWEEP = sweep(Array.from({ length: 97 }, (_, k) => 1.5 * 40 ** (k / 96)));
export const levelDoc = (sha: string): JsonObject => sessionDoc('levels-425', BAND_SIZE, {
  cam: { kind: 'camera@1', params: { projection: 'perspective', position: [0, 0, 1.5], target: [0, 0, 0], fov: 40, near: 0.05, far: 200 } },
  clay: material([0.7, 0.5, 0.35], 0.6),
  rock: { kind: 'mesh.asset@1', params: { sha256: sha, node: 0 }, at: { pos: [0, 0, 0] }, material: 'clay' },
  sun: sun(3),
}, { channels: { dolly: holdChannel('items/cam/params/position/2', LEVEL_SWEEP.values) } });

// ---------------------------------------------------------------------------------------------------
// The live call (#379) and its reply, as far as these tests read it

export const ALPHA = 'agent:alpha';
export const CLIMB = ['shadows_2x', 'full_res_effects', 'samples_4_moving', 'scale_1_moving'] as const;
/** A showpiece as its writer sends it (#393's payload: no `id`, no `layers`): boxes on a ground under a casting sun;
 * `orbiting` turns its camera by a channel (its view moves, so it draws at the class's render scale while moving),
 * else a channel slides one box and the view stays still. */
export function showpiece(orbiting: boolean): JsonObject {
  const items: JsonObject = {
    cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'perspective', target: [0, 0, 0], orbit: { azimuth: 30, elevation: 30, distance: 12 }, fov: 40 } },
    stone: { id: 'stone', kind: 'material@1', name: 'Stone', order: 'a1', params: { base_color: [0.6, 0.6, 0.6, 1], roughness: 0.8 } },
    ground: { id: 'ground', kind: 'mark.box@1', name: 'Ground', order: 'a2', params: { size: [20, 0.2, 20] }, at: { pos: [0, -0.1, 0] }, material: 'stone' },
    sun: { id: 'sun', kind: 'light.sun@1', name: 'Sun', order: 'a3', params: { illuminance: 3, shadow: true }, at: { rot: [-55, 30, 0] } },
  };
  for (let i = 0; i < 6; i++) {
    items[`box-${i}`] = { id: `box-${i}`, kind: 'mark.box@1', name: `Box ${i}`, order: `b${i}`, params: { size: [1, 1 + (i % 3), 1] }, at: { pos: [(i % 3) * 2.5 - 2.5, (1 + (i % 3)) / 2, Math.floor(i / 3) * 2.5 - 1.25] }, material: 'stone' };
  }
  const channels = orbiting
    ? { orbit: { target: 'items/cam/params/orbit/azimuth', type: 'f32', keys: { k0: { t: '0s', value: 30, interp: 'linear' }, k1: { t: '60s', value: 390, interp: 'linear' } } } }
    : { slide: { target: 'items/box-0/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: -2.5, interp: 'linear' }, k1: { t: '60s', value: 2.5, interp: 'linear' } } } };
  return {
    format: 1, profile: 'scene', title: 'A #425 showpiece', description: 'A #425 acceptance fixture.', size: [480, 320], camera: 'cam',
    requires: { modules: { scene3d: '^1' } }, budget: { class: 'showpiece' }, transport: { span: '60s' }, items, channels,
  };
}
export const LIVE_SIZE: [number, number] = [480, 320];
export type Purpose = 'render_back' | 'export';
export interface Charge { from: number; to?: number; gpu_ms: number }
export type LiveEvent =
  | { frame: number; camera: { session: string; azimuth: number } }
  | { frame: number; rung: { session: string; to: string } }
  | { frame: number; canonical: { session: string; purpose: Purpose; frame: number; size: [number, number] } };
export interface LiveSpec { doc: string; frames: number; charges: Charge[]; events?: LiveEvent[]; capture?: number[] }
/** One session, `s`, of ALPHA's document at LIVE_SIZE, its writer charged by the stub meter. */
export const liveCall = (l: LiveSpec): JsonObject => ({
  call: 'live', look: LOOK, frames: l.frames, fps: 60, sessions: [{ session: 's', writer: ALPHA, doc: l.doc, size: LIVE_SIZE }],
  events: (l.events ?? []) as unknown as JsonValue, stub_meter: { writers: { [ALPHA]: l.charges as unknown as JsonValue } },
  ...(l.capture ? { capture: l.capture } : {}),
});
export const canonicalEvents = (at: number): LiveEvent[] =>
  (['render_back', 'export'] as Purpose[]).map((purpose) => ({ frame: at, canonical: { session: 's', purpose, frame: 10, size: LIVE_SIZE } }));
export interface LiveView { frame: number; rung: string; internal_scale: number; final: string | null }
export interface Change { frame: number; from: string | null; to: string; reason: string; effective: number }
export interface Canonical { frame: number; purpose: string; pixel_hash: string | null; rung: string }
export interface Live { views: LiveView[]; changes: Change[]; canonicals: Canonical[] }
export function canonicalOf(o: JsonObject, at: string): Canonical {
  answered(o, at);
  return { frame: num(o['frame'], `${at}.frame`), purpose: str(o['purpose'], `${at}.purpose`), pixel_hash: o['pixel_hash'] === null ? null : str(o['pixel_hash'], `${at}.pixel_hash`), rung: str(o['rung'], `${at}.rung`) };
}
export function liveOf(reply: JsonObject, what: string): Live {
  answered(reply, what);
  const views = arr(reply['frames'], `${what}: frames`).map((f, i): LiveView => {
    const o = obj(f, `${what}: frames[${i}]`); const at = `${what}: frame ${String(o['frame'])}`;
    const v = arr(o['views'], `${at}: views`).map((x) => obj(x, `${at}: a view`)).find((x) => x['session'] === 's');
    const w = obj(v, `${at}: the view of s`);
    return { frame: num(o['frame'], `${at}.frame`), rung: str(w['rung'], `${at}: rung`), internal_scale: num(w['internal_scale'], `${at}: internal_scale`), final: typeof w['final'] === 'string' ? w['final'] : null };
  });
  const changes = arr(reply['changes'], `${what}: changes`).map((c, i): Change => {
    const o = obj(c, `${what}: changes[${i}]`); const at = `${what}: changes[${i}]`;
    return { frame: num(o['frame'], `${at}.frame`), from: o['from'] === null ? null : str(o['from'], `${at}.from`), to: str(o['to'], `${at}.to`), reason: str(o['reason'], `${at}.reason`), effective: num(o['effective'], `${at}.effective`) };
  }).filter((c) => c.from !== null);
  const canonicals = arr(reply['canonicals'] ?? [], `${what}: canonicals`).map((c, i) => canonicalOf(obj(c, `${what}: canonicals[${i}]`), `${what}: canonicals[${i}]`));
  return { views, changes, canonicals };
}
export const said = (c: Change): string => `frame ${c.frame}: ${c.from} → ${c.to} (${c.reason}, from frame ${c.effective})`;
/** A fresh process's canonical render of `doc`'s frame 10, with no live session (#379's `canonical` call). */
export const freshCanonical = (doc: string, purpose: Purpose): JsonObject => ({ call: 'canonical', look: LOOK, writer: ALPHA, doc, size: LIVE_SIZE, frame: 10, purpose });

// ---------------------------------------------------------------------------------------------------
// PNG reading and writing (the taste call's pictures): 8-bit RGB or RGBA, no interlace; written with no filter at
// zlib level 9, so the same pixels give the same SHA-256.

export interface Image { width: number; height: number; rgba: Uint8Array }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
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
  return { width, height, rgba };
}
/** A file the binary wrote under `out`, named by its SHA-256 (#378). */
export function readNamed(out: string, hash: string | null, ext: string, what: string): Buffer {
  expect(hash, `${what} is written, named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${hash}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
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
/** Images laid left to right on a black strip, top-aligned. */
export function sideBySide(images: Image[]): Image {
  const width = images.reduce((s, im) => s + im.width, 0); const height = Math.max(...images.map((im) => im.height));
  const rgba = new Uint8Array(width * height * 4);
  let x0 = 0;
  for (const im of images) {
    for (let y = 0; y < im.height; y++) rgba.set(im.rgba.subarray(y * im.width * 4, (y + 1) * im.width * 4), (y * width + x0) * 4);
    x0 += im.width;
  }
  return { width, height, rgba };
}
