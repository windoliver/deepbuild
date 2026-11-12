// Test-side tools for the #173 acceptance tests: the base's `deep-gpu` binary (#377's GPU layer with #378's `view3d`,
// #379's `live`, #380's `golden` and `decide`, #386's `surface`, #419's samples and classes, #422's packs and #1903's
// `envelope`), built once per file and driven by JSON lines; the fields this suite adds (README: Assumed surfaces);
// the castle as committed and the fixtures the criteria name (the red box crossing a grey wall, the sign whose emission
// a channel switches, the 1 px wire fence, the resolution chart, a still scene and an orbiting one); and the reviewed
// measures the criteria are held to: the frame-history grid in flicks, sRGB decoding and relative luminance, the
// flicker check's change rule, PNG reading and writing (copied in part from #419's and #422's helpers, since suites
// don't import each other) and the five-run rule through scripts/benchmark.mjs's own judgeLimit. Nothing here stands in
// for the renderer, the window, the resolve, the jumps or the canonical renders under test.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/173 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text (README: Criteria to tests). */
export const AC = {
  1: 'AC1 #173.594b573f',
  2: 'AC2 #173.66bdaff9',
  3: 'AC3 #173.3d79705e',
  4: 'AC4 #173.52d132b9',
  5: 'AC5 #173.7d65ca33',
  6: 'AC6 #173.126ffc47',
  7: 'AC7 #173.5e002fc0',
  8: 'AC8 #173.67e2e72d',
  9: 'AC9 #173.f5914d9c',
  10: 'AC10 #173.11b2d1f1',
  11: 'AC11 #173.77c9b0e7',
  12: 'AC12 #173.7c84d072',
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
export const shown = (v: JsonValue | undefined, n = 1500): string => JSON.stringify(v)?.slice(0, n) ?? 'undefined';
const clone = <T extends JsonValue>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Writes `value` as JSON under `dir` and returns its absolute path. */
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(value));
  return path;
}
/** A JSON file of the checkout (the castle, its look, budgets.json), as committed. */
export function repoJson(path: string): JsonObject {
  let text: string;
  try { text = readFileSync(join(REPO, path), 'utf8'); } catch (e) { return expect.fail(`${path} is in the checkout: ${(e as Error).message}`); }
  return obj(JSON.parse(text) as JsonValue, path);
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

interface Bench { fingerprint: () => JsonObject; judgeLimit: (o: JsonObject) => JsonObject; validateBudgets: (current: unknown, base: unknown) => void }
async function bench(): Promise<Bench> {
  return (await import(pathToFileURL(join(REPO, 'scripts', 'benchmark.mjs')).href)) as Bench;
}
/** The reference Macs, as scripts/benchmark.mjs lists them, with their built-in displays in device px (the 16-inch
 * panel for Mac15,7 and Mac17,10, the 13-inch Air's for Mac15,12). */
const REFERENCE_MACS: readonly { model: string; chip: string; memoryBytes: number; display: [number, number] }[] = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', memoryBytes: 36 * 2 ** 30, display: [3456, 2234] },
  { model: 'Mac15,12', chip: 'Apple M3', memoryBytes: 16 * 2 ** 30, display: [2560, 1664] },
  { model: 'Mac17,10', chip: 'Apple M5 Max', memoryBytes: 64 * 2 ** 30, display: [3456, 2234] },
];
/** Why this machine, as scripts/benchmark.mjs's `fingerprint()` reads it, is no reference Mac in its conditions (mains
 * power, Low Power Mode off, thermal state nominal); null when it is one. */
export async function offReference(): Promise<string | null> {
  const f = (await bench()).fingerprint();
  const off: string[] = [];
  if (!REFERENCE_MACS.some((m) => f['model'] === m.model && f['chip'] === m.chip && f['memoryBytes'] === m.memoryBytes)) {
    off.push(`this Mac is ${JSON.stringify(f['model'])} (${JSON.stringify(f['chip'])}, ${JSON.stringify(f['memoryBytes'])} B), none of the reference Macs`);
  }
  if (f['power'] !== 'ac') off.push(`power is ${JSON.stringify(f['power'])}, not mains`);
  if (f['lowPowerMode'] !== false) off.push(`Low Power Mode is ${JSON.stringify(f['lowPowerMode'])}, not off`);
  if (f['thermalState'] !== 'nominal') off.push(`the thermal state is ${JSON.stringify(f['thermalState'])}, not nominal`);
  return off.length > 0 ? off.join('; ') : null;
}
/** On a reference Mac in its conditions, its display in device px; anywhere else INCONCLUSIVE, never a pass. */
export async function requireReferenceMac(what: string): Promise<[number, number]> {
  requireMetal();
  const off = await offReference();
  if (off !== null) inconclusive(`${what} counts only on a reference Mac in its conditions: ${off}`);
  const f = (await bench()).fingerprint();
  return REFERENCE_MACS.find((m) => m.model === f['model'])!.display;
}
/** The one-minute load average, read at each timed run's start and end (scripts/benchmark.mjs's judgeLimit). */
export const load = (): number => loadavg()[0]!;
export interface Run { value: number; start: number; end: number }
export interface Judged { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; line: string }
/** The design's rule on five runs after warm-up, through scripts/benchmark.mjs's own judgeLimit: PASS when all five
 * are within, FAIL when all five are over by more than the margin, otherwise (and off a reference Mac, or loaded)
 * INCONCLUSIVE. */
export async function judge(name: string, limit: number, runs: Run[]): Promise<Judged> {
  const b = await bench();
  const r = b.judgeLimit({ limit, runs: runs.map((x) => x.value), fingerprint: b.fingerprint(), loads: runs.map((x) => ({ start: x.start, end: x.end })) });
  const status = String(r['status']) as Judged['status'];
  const line = `${name}: ${status}, runs ${runs.map((x) => x.value.toFixed(3)).join(', ')} against ${limit}${r['reason'] ? ` (${String(r['reason'])})` : ''}`;
  console.log(line);
  return { status, line };
}
/** scripts/benchmark.mjs's validateBudgets, the perf lane's own. */
export async function validateBudgets(current: unknown, base: unknown): Promise<void> {
  (await bench()).validateBudgets(current, base);
}
export const median = (values: number[]): number => {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

// ---------------------------------------------------------------------------------------------------
// The build: the shipped deep-gpu, once per file

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
    dir = mkdtempSync(join(tmpdir(), 'deep-173-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(targetDir(), 'debug', exe('deep-gpu')), join(dir, exe('deep-gpu')));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo ${CARGO_ARGS.join(' ')}`).toBe('');
    return join(dir, exe('deep-gpu'));
  };
}
/** A fresh temporary folder per test (documents, outputs, stores), deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-173-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one JSON line in, one JSON line out (#377). One run is one process: one app, one
// GPU, the calls in order.

/** `deep-gpu --planted` names this suite adds, each a wrong program reachable only there (README: Planted programs). */
export type GpuPlanted = 'keeps_frame_past_window' | 'determinism_hashes_live_view' | 'grid_at_refresh' | 'outlines_in_history';

export function runGpu(bin: string, out: string, calls: JsonObject[], planted?: GpuPlanted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const name = `deep-gpu ${args.join(' ')}`;
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 3_000_000, killSignal: 'SIGKILL' });
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
// Time: flicks, the display's frames and the frame-history grid (README: Assumed surfaces 2 and 3)

export const FLICKS = 705_600_000;
/** view3d's frame n on a display refreshing `fps` times a second: t = n × flicks ÷ fps. */
export const frameT = (n: number, fps: number): number => Math.floor((n * FLICKS) / fps);
/** Grid step k at the view's frame cap: k × flicks ÷ cap (30, 60 and 144 divide the flick rate). */
export const gridT = (k: number, cap: number): number => k * (FLICKS / cap);
/** The grid step frame n shows while history draws: the last at or before its time. */
export const shownStep = (n: number, fps: number, cap: number): number => Math.floor((n * cap) / fps);
/** The window of `window` grid steps ending at step k, oldest first, in flicks. */
export const windowEndingAt = (k: number, cap: number, window = 8): number[] => Array.from({ length: window }, (_, i) => gridT(k - window + 1 + i, cap));
export const secs = (t: number): string => `${Number((t / FLICKS).toFixed(4))} s`;

// ---------------------------------------------------------------------------------------------------
// Looks: #419's plain physical look (tone map none at the exposure whose scale is 1, one sample through a 1 px box
// filter), with the issue's frame-history fields (README: Assumed surfaces 1). Every call here sets `history`.

const STATUS: JsonObject = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
const PLAIN_LOOK: JsonObject = {
  id: 'look-173-plain', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'A #173 acceptance look.',
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

/** Frame history on: the antialias window of 8 (the issue's default mode and window). */
export const HISTORY_ON: JsonObject = { mode: 'antialias', window: 8 };
/** Frame history off. */
export const HISTORY_OFF: JsonObject = { mode: 'none' };
/** Temporal upscaling over the window of 8. */
export const HISTORY_UPSCALE: JsonObject = { mode: 'upscale', window: 8 };
/** The resolve with its colour clamp off, so a test judges one rejection at a time (README: Readings). */
export const reject = (depth: boolean, reactive: 'auto' | string[]): JsonObject => ({ depth, clamp: 'none', reactive });

export interface LookOpts {
  history: JsonObject; scale?: number; reject?: JsonObject;
  live?: number; export?: number; atRest?: 'none' | 'settle'; filter?: 'box' | 'blackman_harris'; filterPx?: number;
}
/** The plain look with the given frame history (and `scale`, `reject`) and #419's samples fields: by default one
 * sample live and in export, no settle, a 1 px box filter. */
export function look(o: LookOpts): JsonObject {
  const l: JsonObject = {
    ...clone(PLAIN_LOOK),
    samples: { live: o.live ?? 1, export: o.export ?? 1, at_rest: o.atRest ?? 'none' },
    filter: o.filter ?? 'box', filter_px: o.filterPx ?? 1, vary: ['pixel'], sequence: 'r2', motion_blur: 'none',
    history: o.history,
  };
  if (o.scale !== undefined) l['scale'] = o.scale;
  if (o.reject !== undefined) l['reject'] = o.reject;
  return l;
}

// ---------------------------------------------------------------------------------------------------
// The castle as committed (packs/examples/castle.json, its look and its pack, as #422 left them): a flythrough whose
// camera orbits once over its 24 s span.

export const CASTLE = 'packs/examples/castle.json';
export const CASTLE_LOOK = 'packs/examples/castle.look.json';
export const CASTLE_PACKS = [join(REPO, 'packs', 'composites-1.0.0')];
export const CASTLE_FPS = 30;
/** The castle's battlements: its `composites.tower@1` items. */
export const TOWERS = ['tower_nw', 'tower_ne', 'tower_se', 'tower_sw', 'tower_east'] as const;
export interface Castle { doc: string; json: JsonObject; look: JsonObject; size: [number, number]; packs: string[] }
/** The castle as committed; the facts the tests lean on checked: its size, an orbit channel on its camera, its towers. */
export function castle(): Castle {
  const json = repoJson(CASTLE);
  const size = arr(json['size'], `${CASTLE}: size`).map((v, i) => num(v, `${CASTLE}: size[${i}]`)) as [number, number];
  const channels = obj(json['channels'], `${CASTLE}: channels`);
  expect(Object.values(channels).some((c) => isObject(c) && c['target'] === 'items/cam/params/orbit/azimuth'), `${CASTLE}: a channel turns the camera's orbit (the flythrough)`).toBe(true);
  const items = obj(json['items'], `${CASTLE}: items`);
  for (const t of TOWERS) expect(obj(items[t], `${CASTLE}: ${t}`)['kind'], `${CASTLE}: ${t} is a tower`).toBe('composites.tower@1');
  return { doc: join(REPO, CASTLE), json, look: repoJson(CASTLE_LOOK), size, packs: CASTLE_PACKS };
}
/** The castle's own look with the given frame history (and `scale`, `reject`). */
export function castleLook(c: Castle, history: JsonObject, extra: JsonObject = {}): JsonObject {
  return { ...clone(c.look), history, ...extra };
}
/** The castle with each tower's stroke slot drawing a 1 px ink outline (README: Assumed surfaces 11), written under `dir`. */
export function strokedCastle(c: Castle, dir: string): string {
  const json = clone(c.json);
  const items = obj(json['items'], 'items');
  for (const t of TOWERS) {
    const params = obj(obj(items[t], t)['params'], `${t}.params`);
    params['paint'] = { ...(isObject(params['paint']) ? params['paint'] : {}), stroke: { role: 'ink', width: 1 } };
  }
  return writeJson(dir, 'castle-stroked', json);
}

// ---------------------------------------------------------------------------------------------------
// Documents

export const AGENT = 'agent:sess-alpha';
/** A scene document as a session holds it (#378): an `id`, one writer layer, every item in it. */
export function sessionDoc(id: string, size: [number, number], items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(4, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #173 acceptance fixture.`, size, camera: 'cam', transport: { span: '24s' },
    requires: { modules: { scene3d: '^1' } }, layers: { main: { writer: AGENT, title: 'main', order: 'a0' } }, ...extra, items: withIds,
  };
}
/** The writer's payload of a session document, as `live` (#379) and `envelope` (#1903) take it: no `id`, no `layers`,
 * no item `layer`. */
export function payload(doc: JsonObject): JsonObject {
  const out = clone(doc);
  delete out['id'];
  delete out['layers'];
  for (const item of Object.values(obj(out['items'], 'items'))) delete (item as JsonObject)['layer'];
  return out;
}

export type V3 = [number, number, number];
export type Rgb = [number, number, number];
export const box = (size: V3, pos: V3, extra: JsonObject = {}): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos }, ...extra });
/** An orthographic `camera@1` looking along −Z at `target`, `view_width` m across the frame. */
export const ortho = (target: V3, viewWidth: number): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'orthographic', position: [target[0], target[1], target[2] + 20], target, view_width: viewWidth, near: 0.1, far: 100 } });
/** A perspective `camera@1` on an orbit about `target`, as the castle's camera is. */
export const orbitCamera = (target: V3, azimuth: number, elevation: number, distance: number, fov: number): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', target, orbit: { azimuth, elevation, distance }, fov, near: 0.5, far: 200 } });
export const material = (params: JsonObject): JsonObject => ({ kind: 'material@1', params });
/** An unlit opaque material of linear `color`, both faces drawn. */
export const unlit = (color: Rgb): JsonObject => material({ base_color: [...color, 1], unlit: true, double_sided: true });
/** A black sky with no ambient and no environment: the background reads 0. */
export const DARK_SKY: JsonObject = { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } };
/** An f32 channel on `path` through `keys` ([seconds, value, interp = linear]). */
export function channel(path: string, keys: [number, number, ('linear' | 'hold')?][]): JsonObject {
  const k: JsonObject = {};
  keys.forEach(([t, value, interp], i) => { k[`k${i}`] = { t: `${t}s`, value, interp: interp ?? 'linear' }; });
  return { target: path, type: 'f32', keys: k };
}

// ---------------------------------------------------------------------------------------------------
// view3d (#378) and what this suite adds to it (README: Assumed surfaces 2 to 9)

export interface View3d {
  doc: string; look: JsonObject; size: [number, number]; fps: number; frames: number;
  from?: number; capture?: 'every' | number[]; targets?: ('final' | 'ids')[]; packs?: string[];
  seeks?: { after: number; to: number }[]; surface?: JsonObject; timings?: boolean;
  /** This suite's (README: Assumed surfaces). */
  class?: 'live' | 'export' | 'render_back'; cap?: number; stalls?: { after: number; ms: number }[];
  scrubs?: { after: number; through: number[]; release: number }[];
  viewer?: { frame: number; camera: { azimuth: number } }[];
  determinism?: { at_times: number[] };
}
export const view3dCall = (v: View3d): JsonObject => ({ call: 'view3d', ...(v as unknown as JsonObject) });

/** A frame's frame-history report (README: Assumed surfaces 2), times in flicks. */
export interface History { mode: string; shows: number; window: number[]; rendered: number[] }
export interface Samples { drawn: number; settling: boolean }
export interface ViewFrame {
  frame: number; final: string | null; ids: string | null; picks: Map<number, string> | null;
  history: History | null; samples: Samples | null; passesMs: Map<string, number> | null; wallMs: number | null;
}
const optStr = (v: JsonValue | undefined, what: string): string | null => (v === undefined || v === null ? null : str(v, what));
const times = (v: JsonValue | undefined, what: string): number[] => arr(v, what).map((x, i) => num(x, `${what}[${i}]`));
/** A view3d reply's frames, in the order drawn; a frame's `history`, `samples` and timings are null when it reports none. */
export function framesOf(reply: JsonObject, what: string): ViewFrame[] {
  answered(reply, what);
  return arr(reply['frames'], `${what}: frames`).map((v, i): ViewFrame => {
    const f = obj(v, `${what}: frames[${i}]`); const at = `${what}: frames[${i}]`;
    let history: History | null = null;
    if (f['history'] !== undefined) {
      const h = obj(f['history'], `${at}.history`);
      history = { mode: str(h['mode'], `${at}.history.mode`), shows: num(h['shows'], `${at}.history.shows`), window: times(h['window'], `${at}.history.window`), rendered: times(h['rendered'], `${at}.history.rendered`) };
    }
    let samples: Samples | null = null;
    if (f['samples'] !== undefined) {
      const s = obj(f['samples'], `${at}.samples`);
      samples = { drawn: num(s['drawn'], `${at}.samples.drawn`), settling: s['settling'] === true };
    }
    let picks: Map<number, string> | null = null;
    if (isObject(f['picks'])) picks = new Map(Object.entries(f['picks']).map(([k, id]) => [Number(k), str(id, `${at}.picks[${k}]`)]));
    let passesMs: Map<string, number> | null = null;
    if (isObject(f['passes_ms'])) passesMs = new Map(Object.entries(f['passes_ms']).map(([k, ms]) => [k, num(ms, `${at}.passes_ms[${k}]`)]));
    return {
      frame: num(f['frame'], `${at}.frame`), final: optStr(f['final'], `${at}.final`), ids: optStr(f['ids'], `${at}.ids`), picks, history, samples, passesMs,
      wallMs: typeof f['wall_ms'] === 'number' ? f['wall_ms'] : null,
    };
  });
}
/** The last frame entry numbered `n` (a scrub or a seek may draw a frame twice; the last is the one shown after it). */
export function frameAt(frames: ViewFrame[], n: number, what: string): ViewFrame {
  const all = frames.filter((x) => x.frame === n);
  expect(all.length, `${what}: frame ${n} is in the reply (frames ${frames.map((x) => x.frame).slice(0, 40).join(', ')})`).toBeGreaterThan(0);
  return all[all.length - 1]!;
}
/** What a view3d reply says it drew through (#386's `surface`); nulls where it says nothing. */
export function surfaceOf(reply: JsonObject): { internal_scale: number | null; upscale: string | null } {
  const s = isObject(reply['surface']) ? reply['surface'] : {};
  return {
    internal_scale: typeof s['internal_scale'] === 'number' ? s['internal_scale'] : null,
    upscale: typeof s['upscale'] === 'string' ? s['upscale'] : null,
  };
}

// ---------------------------------------------------------------------------------------------------
// Pictures: the targets the binary wrote (each named by its SHA-256, #378), PNG reading and writing, sRGB.

export function readNamed(out: string, hash: string | null, ext: string, what: string): Buffer {
  expect(hash, `${what} is written, named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${hash}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}
export interface Image { width: number; height: number; rgba: Uint8Array }
export const px = (im: Image, x: number, y: number): Rgb => { const o = (y * im.width + x) * 4; return [im.rgba[o]!, im.rgba[o + 1]!, im.rgba[o + 2]!]; };
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
/** Reads an 8-bit RGB or RGBA PNG with no interlace. */
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(SIGNATURE)) throw Error('not a PNG');
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
export const readPng = (out: string, hash: string | null, what: string): Image => decodePng(readNamed(out, hash, 'png', what));

/** IEC 61966-2-1's sRGB decode of an 8-bit code, in linear light. */
export const srgbDecode = (code: number): number => { const c = code / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const DECODE = Float64Array.from({ length: 256 }, (_, i) => srgbDecode(i));
/** Each pixel's relative luminance in linear light (the flicker check's, WCAG's weights through the sRGB decode). */
export function lumaOf(im: Image): Float32Array {
  const out = new Float32Array(im.width * im.height);
  for (let i = 0; i < out.length; i++) out[i] = 0.2126 * DECODE[im.rgba[i * 4]!]! + 0.7152 * DECODE[im.rgba[i * 4 + 1]!]! + 0.0722 * DECODE[im.rgba[i * 4 + 2]!]!;
  return out;
}
/** The largest of the three channels' code differences at a pixel. */
export const codeDiff = (a: Image, b: Image, x: number, y: number): number => {
  const p = px(a, x, y); const q = px(b, x, y);
  return Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2]));
};

/** The flicker check's change (crates/deep-canvas/src/film_audit.rs, `changes`): a pixel changes from one frame to the
 * next when its relative luminance moves by more than 0.1 with the darker of the two below 0.80. The count of such
 * pixel changes over consecutive frames: twice the flashes, pixel by pixel. */
export function flickerChanges(frames: Float32Array[]): number {
  let changes = 0;
  for (let k = 1; k < frames.length; k++) {
    const a = frames[k - 1]!; const b = frames[k]!;
    for (let i = 0; i < a.length; i++) if (Math.abs(b[i]! - a[i]!) > 0.1 && Math.min(a[i]!, b[i]!) < 0.8) changes++;
  }
  return changes;
}

/** The object-ID target (#378's): an 8-bit RGBA PNG whose pixel holds pick ID r + 2^8 g + 2^16 b + 2^24 a (0: nothing). */
export interface Ids { width: number; height: number; at: (x: number, y: number) => string | null }
export function readIds(out: string, f: ViewFrame, what: string): Ids {
  const png = decodePng(readNamed(out, f.ids, 'png', what));
  expect(f.picks, `${what}: the frame names the item each pick ID stands for`).not.toBeNull();
  const items: (string | null)[] = new Array(png.width * png.height);
  for (let i = 0; i < items.length; i++) {
    const o = i * 4;
    const pick = (png.rgba[o]! + png.rgba[o + 1]! * 256 + png.rgba[o + 2]! * 65_536 + png.rgba[o + 3]! * 16_777_216) >>> 0;
    items[i] = pick === 0 ? null : f.picks!.get(pick) ?? null;
  }
  return { width: png.width, height: png.height, at: (x, y) => (x < 0 || y < 0 || x >= png.width || y >= png.height ? null : items[y * png.width + x]!) };
}

// PNG and APNG written by the suite (no filter, zlib level 9), so the same pixels give the same SHA-256.
function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}
const ihdr = (w: number, h: number): Buffer => { const b = Buffer.alloc(13); b.writeUInt32BE(w, 0); b.writeUInt32BE(h, 4); b[8] = 8; b[9] = 2; return b; };
function rows(image: Image): Buffer {
  const raw = Buffer.alloc((image.width * 3 + 1) * image.height);
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const o = (y * image.width + x) * 4; const r = y * (image.width * 3 + 1) + 1 + x * 3;
    raw[r] = image.rgba[o]!; raw[r + 1] = image.rgba[o + 1]!; raw[r + 2] = image.rgba[o + 2]!;
  }
  return deflateSync(raw, { level: 9 });
}
/** An animated PNG of equal-sized frames at `fps`, looping: a recording of the canvas's own frames. */
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

// ---------------------------------------------------------------------------------------------------
// The red box crossing a grey wall (AC2): an orthographic view 3.2 m across 320 × 180 (100 px/m); a grey wall facing
// the camera at z = 0, an 0.8 × 0.6 m red box at z = 1 in front of it sliding +x at 1.2 m/s (4 px per grid step at the
// 30 fps cap), its left edge at 4k px at step k. At step 30 the judged pixels, columns 105 and 106 on rows 70–109, were
// covered at steps 23–26 by at least 1.5 px and uncovered from step 27 by at least 1.5 px: 3 grid steps after the box
// uncovered them, with the box over them in half of the window.

export const TRAIL = { size: [320, 180] as [number, number], viewWidth: 3.2, fps: 30, judged: 30, uncovered: 27, columns: [105, 106], rows: [70, 110] as [number, number], from: -1.2, speed: 1.2, half: 0.4 };
export function trailDoc(): JsonObject {
  return sessionDoc('trail-173', TRAIL.size, {
    cam: ortho([0, 0, 0], TRAIL.viewWidth), sky: DARK_SKY, grey: unlit([0.2, 0.2, 0.2]), red: unlit([0.8, 0.05, 0.05]),
    wall: box([3.6, 2.2, 0.1], [0, 0, -0.05], { material: 'grey' }),
    slider: box([2 * TRAIL.half, 0.6, 0.2], [TRAIL.from, 0, 1], { material: 'red' }),
  }, { channels: { cross: channel('items/slider/at/pos/0', [[0, TRAIL.from], [2, TRAIL.from + 2 * TRAIL.speed]]) } });
}
/** The box's left edge in view px at grid step k, from the document's own numbers. */
export const trailLeftEdge = (k: number): number => TRAIL.size[0] / 2 + (TRAIL.from + TRAIL.speed * (k / TRAIL.fps) - TRAIL.half) * (TRAIL.size[0] / TRAIL.viewWidth);

// ---------------------------------------------------------------------------------------------------
// The sign (AC3): a 1.2 × 0.6 m sign facing the camera on a black sky, no light, its material emitting (0.1, 0.12, 0.15)
// × a strength a channel holds at 0 and switches to 4 at 1 s; the orthographic camera (100 px/m) pans +x at 0.3 m/s,
// 1 px a frame at 30 fps, so the view moves and the sign's interior, inset 4 px, sits at x 104 − n … 215 − n, y 64–115.

export const SIGN = { size: [320, 180] as [number, number], viewWidth: 3.2, fps: 30, pan: 0.3, half: [0.6, 0.3] as [number, number], inset: 4 };
export function signDoc(): JsonObject {
  const pan: [number, number][] = [[0, 0], [4, 4 * SIGN.pan]];
  return sessionDoc('sign-173', SIGN.size, {
    cam: ortho([0, 0, 0], SIGN.viewWidth), sky: DARK_SKY,
    glow: material({ base_color: [0, 0, 0, 1], emission: [0.1, 0.12, 0.15], emission_strength: 0, roughness: 1 }),
    sign: box([2 * SIGN.half[0], 2 * SIGN.half[1], 0.1], [0, 0, 0], { material: 'glow' }),
  }, {
    channels: {
      pan_x: channel('items/cam/params/position/0', pan), aim_x: channel('items/cam/params/target/0', pan),
      switch: channel('items/glow/params/emission_strength', [[0, 0, 'hold'], [1, 4, 'hold']]),
    },
  });
}
/** The sign's interior at frame n, inset 4 px: [x0, x1) × [y0, y1). */
export function signInterior(n: number): { x0: number; x1: number; y0: number; y1: number } {
  const k = SIGN.size[0] / SIGN.viewWidth; const cx = SIGN.size[0] / 2 - SIGN.pan * (n / SIGN.fps) * k; const cy = SIGN.size[1] / 2;
  return { x0: Math.ceil(cx - SIGN.half[0] * k + SIGN.inset), x1: Math.floor(cx + SIGN.half[0] * k - SIGN.inset), y0: Math.ceil(cy - SIGN.half[1] * k + SIGN.inset), y1: Math.floor(cy + SIGN.half[1] * k - SIGN.inset) };
}

// ---------------------------------------------------------------------------------------------------
// The 1 px wire fence (AC4 and the taste call): a 2 × 2.4 m panel of 21 vertical and 25 horizontal wires 0.1 m apart,
// each a flat ribbon 0.0084 m wide, light grey (unlit 0.6) on a black sky, at the orbit's target 10 m away. A camera's
// `fov` spans the view's width (the base's camera.rs: view width 2 · distance · tan(fov ÷ 2)), so 30° over 640 px puts
// 119.4 px on a metre there and each wire is 1.0 px wide. The orbit turns at 10° a second from −12°, so over the judged
// frames 8–127 at 60 fps (−10.7° to 9.2°) no point of the fence moves more than 0.12 px a frame (`fenceMotion`).

export const FENCE = {
  size: [640, 360] as [number, number], fps: 60, frames: 128, judgedFrom: 8, wire: 0.0084, grey: 0.6,
  target: [0, 1.5, 0] as V3, distance: 10, elevation: 4, fov: 30, azimuthFrom: -12, degPerS: 10,
};
const fenceXs = Array.from({ length: 21 }, (_, i) => -1 + 0.1 * i);
const fenceYs = Array.from({ length: 25 }, (_, j) => 0.3 + 0.1 * j);
export function fenceDoc(): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: orbitCamera(FENCE.target, FENCE.azimuthFrom, FENCE.elevation, FENCE.distance, FENCE.fov), sky: DARK_SKY, wire: unlit([FENCE.grey, FENCE.grey, FENCE.grey]),
  };
  fenceXs.forEach((x, i) => { items[`v_${String(i).padStart(2, '0')}`] = box([FENCE.wire, 2.4, 0.001], [x, 1.5, 0], { material: 'wire' }); });
  fenceYs.forEach((y, j) => { items[`h_${String(j).padStart(2, '0')}`] = box([2, FENCE.wire, 0.001], [0, y, 0], { material: 'wire' }); });
  const turn: [number, number][] = [[0, FENCE.azimuthFrom], [4, FENCE.azimuthFrom + 4 * FENCE.degPerS]];
  return sessionDoc('fence-173', FENCE.size, items, { channels: { turn: channel('items/cam/params/orbit/azimuth', turn) } });
}
/** The pinhole the fence is judged by: the view px of world point `p` with the orbit at `azimuth`, `fov` across the
 * view's width (the base's camera.rs), the view's centre at 0. The azimuth's sign convention doesn't change a distance
 * on the symmetric fence. */
function fenceScreen(p: V3, azimuth: number): [number, number] {
  const rad = (d: number): number => (d * Math.PI) / 180;
  const t = FENCE.target; const ce = Math.cos(rad(FENCE.elevation));
  const cam: V3 = [t[0] + FENCE.distance * ce * Math.sin(rad(azimuth)), t[1] + FENCE.distance * Math.sin(rad(FENCE.elevation)), t[2] + FENCE.distance * ce * Math.cos(rad(azimuth))];
  const norm = (v: V3): V3 => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; };
  const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const f = norm([t[0] - cam[0], t[1] - cam[1], t[2] - cam[2]]);
  const r = norm([-f[2], 0, f[0]]);
  const u: V3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const q: V3 = [p[0] - cam[0], p[1] - cam[1], p[2] - cam[2]];
  const focal = FENCE.size[0] / 2 / Math.tan(rad(FENCE.fov) / 2);
  return [(focal * dot(q, r)) / dot(q, f), (focal * dot(q, u)) / dot(q, f)];
}
/** The fence's px per metre at the orbit's target. */
export const fencePxPerM = (): number => FENCE.size[0] / (2 * FENCE.distance * Math.tan((FENCE.fov * Math.PI) / 360));
/** The most any wire crossing of the fence moves in view px from one judged frame to the next. */
export function fenceMotion(): number {
  let most = 0;
  const az = (n: number): number => FENCE.azimuthFrom + (FENCE.degPerS * n) / FENCE.fps;
  for (let n = FENCE.judgedFrom; n + 1 < FENCE.frames; n++) for (const x of fenceXs) for (const y of fenceYs) {
    const a = fenceScreen([x, y, 0], az(n)); const b = fenceScreen([x, y, 0], az(n + 1));
    most = Math.max(most, Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return most;
}

// ---------------------------------------------------------------------------------------------------
// The resolution chart (AC4): an orthographic view 4 m across 400 × 300 (100 px/m) of 100 white bars 1 px wide on
// black, one on each even column from 100 to 298, 4 m tall; the camera pans along the bars (up, 0.25 m/s), so the view
// moves and every bar stays on its column.

export const CHART = { size: [400, 300] as [number, number], viewWidth: 4, fps: 30, judged: 16, columns: [100, 300] as [number, number], rows: [40, 260] as [number, number] };
export function chartDoc(): JsonObject {
  const items: Record<string, JsonObject> = { cam: ortho([0, 0, 0], CHART.viewWidth), sky: DARK_SKY, white: unlit([1, 1, 1]) };
  for (let i = 0; i < 100; i++) {
    const c = CHART.columns[0] + 2 * i;
    items[`bar_${String(i).padStart(3, '0')}`] = box([0.01, 4, 0.01], [(c + 0.5 - CHART.size[0] / 2) / 100, 0, 0], { material: 'white' });
  }
  const pan: [number, number][] = [[0, 0], [2, 0.5]];
  return sessionDoc('chart-173', CHART.size, items, { channels: { pan_y: channel('items/cam/params/position/1', pan), aim_y: channel('items/cam/params/target/1', pan) } });
}
/** The chart's contrast at 1 px detail: over its rows, the mean relative luminance of the bars' columns less that of
 * the columns between them. */
export function barContrast(im: Image): number {
  const y = lumaOf(im);
  let sum = 0; let rowsN = 0;
  for (let r = CHART.rows[0]; r < CHART.rows[1]; r++) {
    let on = 0; let off = 0;
    for (let c = CHART.columns[0]; c < CHART.columns[1]; c += 2) { on += y[r * im.width + c]!; off += y[r * im.width + c + 1]!; }
    sum += (on - off) / ((CHART.columns[1] - CHART.columns[0]) / 2); rowsN++;
  }
  return sum / rowsN;
}

// ---------------------------------------------------------------------------------------------------
// The still scene (AC6): #419's, a lit floor, a block turned 23° and a ball under a casting sun, seen in perspective,
// nothing moving. The orbiting scene (AC6, AC7, AC9): an orbit camera turning 15° a second about six boxes on a floor
// under a casting sun; `moving: false` holds it still.

export const STILL_SIZE: [number, number] = [320, 240];
export function stillDoc(): JsonObject {
  return sessionDoc('still-173', STILL_SIZE, {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [2.5, 2, 4], target: [0, 0.3, 0], fov: 40, near: 0.1, far: 100 } },
    sky: DARK_SKY,
    grey: material({ base_color: [0.6, 0.6, 0.6, 1], roughness: 0.6 }),
    orange: material({ base_color: [0.8, 0.35, 0.1, 1], roughness: 0.4 }),
    floor: box([6, 0.1, 6], [0, -0.05, 0], { material: 'grey' }),
    block: box([0.8, 0.8, 0.8], [-0.5, 0.4, 0], { material: 'orange', at: { pos: [-0.5, 0.4, 0], rot: [0, 23, 0] } }),
    ball: { kind: 'ball@1', params: { radius: 0.35, segments: 64 }, at: { pos: [0.7, 0.35, 0.3] }, material: 'grey' },
    sun: { kind: 'light.sun@1', params: { illuminance: 3, color: [1, 1, 1], shadow: true }, at: { rot: [-50, 30, 0] } },
  });
}
export function orbitDoc(size: [number, number], moving = true, span = 24): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: orbitCamera([0, 0.5, 0], 0, 20, 9, 45), sky: DARK_SKY,
    grey: material({ base_color: [0.55, 0.55, 0.55, 1], roughness: 0.7 }),
    floor: box([12, 0.1, 12], [0, -0.05, 0], { material: 'grey' }),
    sun: { kind: 'light.sun@1', params: { illuminance: 3, color: [1, 1, 1], shadow: true }, at: { rot: [-45, 35, 0] } },
  };
  const colors: Rgb[] = [[0.8, 0.2, 0.1], [0.1, 0.5, 0.8], [0.2, 0.7, 0.2], [0.8, 0.7, 0.1], [0.6, 0.2, 0.7], [0.9, 0.9, 0.9]];
  colors.forEach((c, i) => {
    const a = (i / colors.length) * 2 * Math.PI;
    items[`m_${i}`] = material({ base_color: [...c, 1], roughness: 0.4 });
    items[`box_${i}`] = box([0.8, 0.4 + 0.2 * i, 0.8], [2.5 * Math.cos(a), 0.2 + 0.1 * i, 2.5 * Math.sin(a)], { material: `m_${i}` });
  });
  return sessionDoc(`orbit-173-${moving ? 'moving' : 'still'}`, size, items, {
    transport: { span: `${span}s` }, budget: { class: 'showpiece' },
    ...(moving ? { channels: { orbit: channel('items/cam/params/orbit/azimuth', [[0, 0], [span, 15 * span]]) } } : {}),
  });
}
