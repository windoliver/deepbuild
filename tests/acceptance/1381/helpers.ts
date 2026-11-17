// Test-side tools for the #1381 acceptance tests (README: The surface under test). They drive `deep-gpu run [--planted
// <name>]` (#377) with `view3d` (#378) and its `ground_points` (#2017), `counts`, `capture`, `targets`, `timings` and
// `pixel_hash`, plus the fields this suite assumes (README: Assumed surfaces). Copied here, since suites never import each
// other: #2017's JSON-lines runner, look shape, PNG and APNG coding and the perf lane's judge. Every number a test judges
// comes from the binary; the only things computed here are the fixtures, the issue's closed forms and #1399's blank rule.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, loadavg, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type V3 = [number, number, number];
export type Size = [number, number];
export type Tile = [number, number];
export type Xz = [number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1381 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
/** Each criterion's ID: `#1381.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
export const AC = {
  1: '#1381.aa8d0d8a', 2: '#1381.60933b30', 3: '#1381.44fb6045', 4: '#1381.4970e130', 5: '#1381.1451e92c', 6: '#1381.82d06a5e', 7: '#1381.63539ab9',
} as const;
export const TIMEOUT = 3_600_000;
export const HD: Size = [1920, 1080];
/** The size the readout calls draw at: the readings don't depend on it. */
export const SMALL: Size = [640, 360];
const deg = (d: number): number => (d * Math.PI) / 180;

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
export function int(v: JsonValue | undefined, what: string): number {
  const n = num(v, what);
  expect(Number.isInteger(n) && n >= 0, `${what} is a whole number ≥ 0, got ${n}`).toBe(true);
  return n;
}
export const tileName = (t: Tile): string => `tile [${t[0]}, ${t[1]}]`;
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const SHA = /^[0-9a-f]{64}$/;

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
/** The one-minute load average, which the perf lane's `judgeLimit` reads at each run's start and end. */
export const load = (): number => loadavg()[0]!;
interface Bench { fingerprint: () => JsonObject; judgeLimit: (o: unknown) => JsonObject }
const bench = async (): Promise<Bench> => (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as Bench;
/** The perf lane's own rule (scripts/benchmark.mjs): five runs after warm-up, a reference Mac on mains power, Low Power
 * Mode off, thermal state nominal, and the load at each run's start and end within the cores. */
export async function judgeLimit(limit: number, runs: number[], loads: { start: number; end: number }[]): Promise<JsonObject> {
  const b = await bench();
  return b.judgeLimit({ limit, runs, fingerprint: b.fingerprint(), loads });
}
/** Why this machine can't judge a timing now, or '' when it can: the lane's verdict on five zero runs at this load. */
export async function timingProblem(): Promise<string> {
  const now = load();
  const v = await judgeLimit(1, [0, 0, 0, 0, 0], Array.from({ length: 5 }, () => ({ start: now, end: now })));
  return v['status'] === 'PASS' ? '' : String(v['reason'] ?? v['status']);
}

// ---------------------------------------------------------------------------------------------------
// The build: deep-gpu once per file, debug info and incremental builds off, copied out of the target folder.

const TOOLCHAIN = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
const targetDir = (): string => (process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target'));
const CARGO_ARGS = ['build', '--locked', '--bin', 'deep-gpu'];

/** Builds the debug `deep-gpu` and copies it into `dir`: its path, or cargo's error. */
function buildInto(dir: string): { path: string; error: string } {
  const env = {
    ...process.env, PATH: `${TOOLCHAIN}${delimiter}/opt/homebrew/opt/rustup/bin${delimiter}${process.env['PATH'] ?? ''}`,
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
/** Builds `deep-gpu` once, before the file's tests; a test whose build failed fails with cargo's error. */
export function useGpu(): () => string {
  let dir = '';
  let made = { path: '', error: 'not built' };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1381-bin-'));
    made = buildInto(dir);
  }, 2 * TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (): string => {
    expect(made.error, `the binary builds: cargo ${CARGO_ARGS.join(' ')}`).toBe('');
    return made.path;
  };
}
/** A fresh folder per test, deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1381-')); });
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

/** The wrong programs this suite plants in `deep-gpu run`, each reachable only through `--planted` (README: Planted
 * programs). */
export type Planted = 'terrain_no_horizon_bake' | 'terrain_occlusion_from_slope';

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
/** A `view3d` reply's frames, in order from `from`; INCONCLUSIVE where the binary says the platform can't draw. */
export function framesOf(reply: JsonObject, count: number, what: string, from = 0): JsonObject[] {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what}: view3d answered unsupported_platform`);
  expect(reply['code'], `${what}: view3d is answered, not refused: ${brief(reply)}`).toBeUndefined();
  const frames = arr(reply['frames'], `${what}: frames`).map((f, i) => obj(f, `${what}: frames[${i}]`));
  expect(frames.map((f) => f['frame']), `${what}: frames ${from} … ${from + count - 1}, in order`).toEqual(Array.from({ length: count }, (_, k) => from + k));
  return frames;
}
/** A file the binary wrote under `out`, named by its SHA-256 (#378). */
export function readNamed(out: string, hash: JsonValue | undefined, ext: string, what: string): Buffer {
  expect(hash, `${what} is written, named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${String(hash)}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}
/** A frame's `pixel_hash` (#378), present. */
export function pixelHash(frame: JsonObject, what: string): string {
  const h = frame['pixel_hash'];
  expect(typeof h === 'string' && h.length > 0, `${what}: the frame has its pixel_hash, got ${brief(h, 100)}`).toBe(true);
  return h as string;
}

// ---------------------------------------------------------------------------------------------------
// Looks, lights and items (#166's look shape; metres, +Y up)

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
    id, format: 1, basis: 'physical', license: 'Apache-2.0', description: `The #1381 acceptance look ${id}.`,
    palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', white: '#ffffff' },
    roles: { ground: 'night', ink: 'graphite', muted: 'slate' },
    themes: { light: {}, dark: {} }, fonts: FONTS,
    status: { ...STATUS }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: 0.1,
    attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
    tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' },
    ...change,
  };
}
/** The look criteria 1 to 6 draw in: nothing between the lit scene and the frame's code values. */
export const PLAIN = look3d('plain-1381');
/** The look the screenshots and the recording draw in, as a film would. */
export const FILMIC = look3d('filmic-1381', { tone_map: 'filmic', exposure: 0 });
export type LookName = 'plain' | 'filmic';
export const lookOf = (l: LookName): JsonObject => (l === 'plain' ? PLAIN : FILMIC);

const DAY_SKY: JsonObject = { kind: 'sky@1', params: { top: [0.15, 0.3, 0.75, 1], low: [0.6, 0.7, 0.85, 1], ambient_top: [0.6, 0.65, 0.75], ambient_low: [0.25, 0.25, 0.25] } };
const SUNSET_SKY: JsonObject = { kind: 'sky@1', params: { top: [0.12, 0.2, 0.45, 1], low: [0.95, 0.55, 0.3, 1], ambient_top: [0.12, 0.14, 0.22], ambient_low: [0.16, 0.1, 0.06] } };
const camera = (position: V3, target: V3, fov: number, near = 1, far = 12_000): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov, near, far } });
const material = (base: [number, number, number], roughness = 0.9): JsonObject => ({ kind: 'material@1', params: { base_color: [...base, 1], roughness, metallic: 0 } });
/**
 * The key sun: a `light.sun@1` casting the shadow, which shines along its local −Z, so `at.rot` [−e, y, 0] puts it e
 * degrees above the horizon, turned y about +Y; y = −90 puts it on the −x side, shining toward +x. `shadow_far` is the
 * last cascade's far end in metres; 0 sets the cascades to zero range (README: Assumed surfaces 2); left out, `auto`.
 */
function keySun(illuminance: number, elevation: number, yaw: number, shadowFar?: number): JsonObject {
  return {
    kind: 'light.sun@1',
    params: { illuminance, color: [1, 0.9, 0.8], shadow: true, ...(shadowFar === undefined ? {} : { shadow_far: shadowFar }) },
    at: { rot: [-elevation, yaw, 0] },
  };
}

/** A scene document as a `view3d` session holds it (#378): every item in the one writer layer `main`, camera `cam`. */
function sessionDoc(id: string, size: Size, items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(4, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #1381 acceptance fixture.`, size: [...size], camera: 'cam', seed: 1381,
    requires: { modules: { scene3d: '^1' } }, budget: { class: 'work_product' },
    layers: { main: { writer: 'agent:alpha', title: 'Main', order: 'a0' } }, ...extra, items: withIds,
  };
}

// ---------------------------------------------------------------------------------------------------
// The terrain plates (#2014's form): `plate@1` with `params.terrain`, no `at`, so its own space is the world's. Samples
// lie `spacing` apart over `size`, centred on the origin. Tile [i, j] covers x from −size[0] ÷ 2 + i × tile to that +
// tile, and z likewise: i counts along +x from the −x edge, j along +z from the −z edge (#2017's naming). Each plate
// with a horizon writes the issue's Fields line, `horizon: {azimuths: 16, size: 257}`, beside `terrain` (README: Assumed
// surfaces 1), and holds 4,097 × 4,097 samples, the tile the issue's "257² for a 4,097² tile" names.

export interface Terrain { height: string; size: [number, number]; spacing: number; tile: number; lod_levels: number }
export const PLATE_ID = 'ground';
export const HORIZON = { azimuths: 16, size: 257 } as const;
const plateItem = (t: Terrain, mat: string, horizon: boolean): JsonObject => ({
  kind: 'plate@1', params: { terrain: { ...t, size: [...t.size] }, ...(horizon ? { horizon: { ...HORIZON } } : {}) }, material: mat,
});
export function tileOf(t: Terrain, x: number, z: number): Tile {
  return [Math.floor((x + t.size[0] / 2) / t.tile), Math.floor((z + t.size[1] / 2) / t.tile)];
}
/** One horizon texel in metres: the plate's size over the table's 256 steps, corner to corner (README: Readings). */
export const texelOf = (t: Terrain): number => t.size[0] / (HORIZON.size - 1);

/**
 * The ridge plate (criteria 1, 2, 4, 5, 6 and the sunset pictures): 8,192 × 8,192 m at 2 m, 4,097 × 4,097 samples, 16
 * × 16 tiles of 512 m, six levels. A straight ridge along z, its crest 100 m high at x = −1,024, falling linearly to a
 * flat floor at height 0 400 m either side; a second ridge, 140 m at x = 2,600, closes the valley 2.2 km east of the
 * first one's foot. The sun stands on the −x side.
 */
export const RIDGE: Terrain = {
  height: '100 * max(0, 1 - abs(position.x + 1024) / 400) + 140 * max(0, 1 - abs(position.x - 2600) / 400)',
  size: [8192, 8192], spacing: 2, tile: 512, lod_levels: 6,
};
export const CREST_X = -1024;
export const RIDGE_HEIGHT = 100;
/** The ridge's foot on its lee side, 400 m past the crest. */
export const LEE_FOOT = 400;
/** The issue's sun for criterion 1: 5° above the horizon. */
export const LOW_SUN = 5;
/** The shadow's reach from the crest under that sun: 100 m ÷ tan 5° = 1,143.005 m. */
export const REACH = RIDGE_HEIGHT / Math.tan(deg(LOW_SUN));
/** 32 m: 8,192 m over 256 texel steps. */
export const RIDGE_TEXEL = texelOf(RIDGE);
/** The view criteria 1 and 2 draw from: 2 km south of tiles [7, 7] and [9, 7], looking north across them. */
export const FAR_EYE: V3 = [256, 300, 2000];
export const FAR_TARGET: V3 = [256, 0, -256];
/** The sunset view (criteria 4 to 6 and the pictures): from the valley's south end, looking north up it. */
export const SUNSET_EYE: V3 = [800, 250, 2500];
export const SUNSET_TARGET: V3 = [300, 0, -500];
/** The sunset's cascades end 300 m out, so the valley's far floor is shaded past the last cascade. */
export const SUNSET_SHADOW_FAR = 300;
/** The sunset: the sun sinks linearly from 15° at 0 s to 3° at 3 s and holds (README: Fixtures). */
export const SUNSET = { from: 15, to: 3, seconds: 3 } as const;
export const sunsetElevation = (t: number): number => (t >= SUNSET.seconds ? SUNSET.to : SUNSET.from + ((SUNSET.to - SUNSET.from) * t) / SUNSET.seconds);
/** The sunset's frame rate for criteria 4 and 5: frame n at n ÷ 10 s, frames 0 to 30. */
export const SUNSET_FPS = 10;
export const SUNSET_FRAMES = SUNSET.seconds * SUNSET_FPS + 1;

export interface RidgeOptions {
  size: Size;
  /** `still` holds the sun at `elevation`; `sunset` keys its elevation by a channel (SUNSET). */
  sun: { still: number } | 'sunset';
  /** `far` is FAR_EYE with zero-range cascades; `sunset` is SUNSET_EYE with cascades to 300 m. */
  view: 'far' | 'sunset';
  look?: LookName;
  /** The plate's `horizon`, on by default; off draws the plate as the base does (README: Assumed surfaces 1). */
  horizon?: boolean;
  /** A swaying tree beside the eye, whose GPU deform runs one compute pass a frame (#2016): criterion 4's control. */
  tree?: boolean;
}
export function ridgeDoc(o: RidgeOptions): JsonObject {
  const far = o.view === 'far';
  const elevation = o.sun === 'sunset' ? SUNSET.from : o.sun.still;
  const items: Record<string, JsonObject> = {
    cam: far ? camera(FAR_EYE, FAR_TARGET, 60) : camera(SUNSET_EYE, SUNSET_TARGET, 60),
    sky: SUNSET_SKY,
    sun: keySun(10, elevation, -90, far ? 0 : SUNSET_SHADOW_FAR),
    rock: material([0.46, 0.4, 0.33]),
    [PLATE_ID]: plateItem(RIDGE, 'rock', o.horizon ?? true),
  };
  if (o.tree) {
    items['needles'] = material([0.2, 0.45, 0.22], 1);
    items['tree'] = {
      kind: 'lathe@1', params: { outline: [[0.6, 0, false], [0.6, 4, false], [4, 4, false], [0, 14, false]], segments: 8 }, material: 'needles',
      modifiers: [{ kind: 'mod.sway@1', params: { amount: 0.3, wind: { direction: 0, speed: 5, gust: { scale: 20 } }, seed: 7 } }],
      at: { pos: [760, 0, 2380] },
    };
  }
  const extra: JsonObject = o.sun === 'sunset'
    ? { channels: { sunset: { target: 'items/sun/at/rot/0', type: 'f32', keys: { k0: { t: '0s', value: -SUNSET.from, interp: 'linear' }, k1: { t: `${SUNSET.seconds}s`, value: -SUNSET.to, interp: 'linear' } } } } }
    : {};
  const name = `ridge-1381-${o.view}-${o.sun === 'sunset' ? 'sunset' : `sun${o.sun.still}`}${o.horizon === false ? '-bare' : ''}${o.tree ? '-tree' : ''}`;
  return sessionDoc(name, o.size, items, extra);
}

/**
 * The crater plate (criterion 3 and the occlusion pictures): 2,048 × 2,048 m at 0.5 m, 4,097 × 4,097 samples, 8 × 8
 * tiles of 256 m, six levels. A flat floor at height 0 out to 300 m from the centre, a wall rising linearly to the rim
 * at 600 m, and a plateau at the rim's height beyond: 600 × tan 30° = 346.41 m, so from the floor's centre the rim
 * stands 30° high in every direction and nothing beyond it stands higher.
 */
export const CRATER_RIM_HEIGHT = 600 * Math.tan(deg(30));
export const CRATER: Terrain = {
  height: `min(${CRATER_RIM_HEIGHT}, max(0, (hypot(position.x, position.z) - 300) * ${CRATER_RIM_HEIGHT / 300}))`,
  size: [2048, 2048], spacing: 0.5, tile: 256, lod_levels: 6,
};
/** The floor centre's sky occlusion in closed form: 1 − sin² 30° = 0.75. */
export const CRATER_OCCLUSION = 1 - Math.sin(deg(30)) ** 2;
export function craterDoc(o: { size: Size; look?: LookName; horizon?: boolean; zeroRange?: boolean }): JsonObject {
  return sessionDoc(`crater-1381${o.horizon === false ? '-bare' : ''}`, o.size, {
    cam: camera([0, 560, 980], [0, 0, -60], 60),
    sky: DAY_SKY,
    sun: keySun(2.5, 38, -60, o.zeroRange ? 0 : undefined),
    rock: material([0.5, 0.46, 0.4]),
    [PLATE_ID]: plateItem(CRATER, 'rock', o.horizon ?? true),
  });
}

// ---------------------------------------------------------------------------------------------------
// Reading a frame's ground points (#2017's `ground_points`, README: Assumed surfaces 3)

export interface GroundRow { x: number; z: number; tile: Tile | null; sun: number; occlusion: number }
/** The view3d field that asks for readings at ground points of the plate. */
export const groundPoints = (at: readonly Xz[]): JsonObject => ({ item: PLATE_ID, at: at.map((p) => [...p]) });
/** The frame's `ground_points`, in the order asked, each with its sun visibility and sky occlusion in 0..1. */
export function groundRows(frame: JsonObject, asked: readonly Xz[], what: string): GroundRow[] {
  const rows = arr(frame['ground_points'], `${what}: the frame's \`ground_points\``);
  expect(rows.length, `${what}: one reading per point asked`).toBe(asked.length);
  return rows.map((v, k) => {
    const at = `${what}: ground_points[${k}]`;
    const o = obj(v, at);
    const xz = arr(o['at'], `${at}.at`).map((n, i) => num(n, `${at}.at[${i}]`));
    expect(xz, `${at}: the point asked`).toEqual([...asked[k]!]);
    const t = o['tile'];
    const tile: Tile | null = Array.isArray(t) && t.length === 2 ? [int(t[0], `${at}.tile[0]`), int(t[1], `${at}.tile[1]`)] : null;
    const sun = num(o['sun_visibility'], `${at}.sun_visibility (README: Assumed surfaces 3)`);
    const occlusion = num(o['occlusion'], `${at}.occlusion (README: Assumed surfaces 3)`);
    expect(sun >= -1e-6 && sun <= 1 + 1e-6, `${at}: sun_visibility ${sun} lies in 0..1`).toBe(true);
    expect(occlusion >= -1e-6 && occlusion <= 1 + 1e-6, `${at}: occlusion ${occlusion} lies in 0..1`).toBe(true);
    return { x: xz[0]!, z: xz[1]!, tile, sun, occlusion };
  });
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

/**
 * #1399's blank guard, test-side: why a frame is blank, or '' when it isn't. A frame is blank when 98% of its pixels
 * sit at luma 0.06 or under, or it holds under 32 distinct colors, or under 5% of its pixels differ from its modal
 * color, so two matching blank frames never pass.
 */
export function blankReason(image: Image): string {
  const total = image.width * image.height;
  const counts = new Map<number, number>();
  let dark = 0;
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    const r = image.rgba[o]!; const g = image.rgba[o + 1]!; const b = image.rgba[o + 2]!; const a = image.rgba[o + 3]!;
    if ((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 <= 0.06) dark++;
    const key = ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let modal = 0;
  for (const n of counts.values()) if (n > modal) modal = n;
  if (dark >= 0.98 * total) return `${((100 * dark) / total).toFixed(1)}% of its pixels are dark`;
  if (counts.size < 32) return `it holds ${counts.size} distinct colors, under 32`;
  if (total - modal < 0.05 * total) return `${((100 * (total - modal)) / total).toFixed(2)}% of its pixels differ from its modal color, under 5%`;
  return '';
}
