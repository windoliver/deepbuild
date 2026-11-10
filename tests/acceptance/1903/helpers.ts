// Test-side tools for the #1903 acceptance tests: `deep-gpu` (#377's binary) built with `test-meter` and driven by
// JSON lines, on wgpu's noop backend (one test also on this Mac's own GPU), with this suite's calls `envelope` and
// `envelope_counts` and the limits decision `decide` takes (README: The surface under test); the documents those
// calls play, generated here; the environment fingerprints the stubs stand in with; the seeded input times; and the
// replies' parsers. Nothing here stands in for the envelope, the meter, the renderer, the warm-up or the check.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1903 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const BIN = 'deep-gpu';
const BUILD = ['build', '--locked', '--bin', BIN, '--features', 'test-meter'];

// ---------------------------------------------------------------------------------------------------
// The criteria's numbers and the design's.

/** The showpiece class's frame GPU limit, in ms (the budget class table): "the showpiece class's 10 ms". */
export const SHOWPIECE_GPU_MS = 10;
/** Five timed runs after warm-up (Frame budget: `expect: p95 within the class`). */
export const RUNS = 5;
/** Full screen on the reference Mac's display (Mac15,7's built-in 3456 × 2234 XDR display): the envelope's size. */
export const FULL_SCREEN: [number, number] = [3456, 2234];
/** The noop lane's count runs draw at this size; no count criterion names one. */
export const COUNT_PIXELS: [number, number] = [1280, 720];
export const FPS = 60;
/** The writer whose revisions every call checks and plays. */
export const WRITER = 'agent:alpha';
export const VERDICTS = ['PASS', 'FAIL', 'BLOCKED', 'INCONCLUSIVE'] as const;
export type Verdict = (typeof VERDICTS)[number];
/** The inclusive range a .. b. */
export const range = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// ---------------------------------------------------------------------------------------------------
// Environment fingerprints, the shape of scripts/benchmark.mjs's fingerprint(), that `stub_environment` stands in
// with (#1899's), and the device a calibration baseline is kept under.

export interface Fingerprint {
  model: string; chip: string; memoryBytes: number; power: 'ac' | 'battery';
  lowPowerMode: boolean; thermalState: 'nominal' | 'fair' | 'serious' | 'critical'; macosBuild: string;
}
/** The reference Mac (benchmark.mjs's first) on mains power, Low Power Mode off, thermal state nominal. */
export const REFERENCE: Fingerprint = {
  model: 'Mac15,7', chip: 'Apple M3 Pro', memoryBytes: 36 * 2 ** 30, power: 'ac', lowPowerMode: false, thermalState: 'nominal', macosBuild: '25B78',
};
/** A Mac measured later: an M1 (none of the reference Macs), in the same conditions. */
export const M1: Fingerprint = { ...REFERENCE, model: 'MacBookAir10,1', chip: 'Apple M1', memoryBytes: 16 * 2 ** 30 };
export interface Device { model: string; chip: string }
export const deviceOf = (f: Fingerprint): Device => ({ model: f.model, chip: f.chip });

/** The reference Macs and their conditions, as scripts/benchmark.mjs lists them. */
const REFERENCE_MACS: readonly (readonly [string, string, number])[] = [
  ['Mac15,7', 'Apple M3 Pro', 36 * 2 ** 30], ['Mac15,12', 'Apple M3', 16 * 2 ** 30], ['Mac17,10', 'Apple M5 Max', 64 * 2 ** 30],
];
/** Why this machine, as scripts/benchmark.mjs's `fingerprint()` reads it, is no reference Mac in its conditions; null when it is. */
export async function offReference(): Promise<string | null> {
  const bench = (await import(pathToFileURL(join(REPO, 'scripts', 'benchmark.mjs')).href)) as { fingerprint: () => JsonObject };
  const f = bench.fingerprint();
  const off: string[] = [];
  if (!REFERENCE_MACS.some(([model, chip, memory]) => f['model'] === model && f['chip'] === chip && f['memoryBytes'] === memory)) {
    off.push(`this Mac is ${JSON.stringify(f['model'])} (${JSON.stringify(f['chip'])}, ${JSON.stringify(f['memoryBytes'])} B), none of the reference Macs`);
  }
  if (f['power'] !== 'ac') off.push(`power is ${JSON.stringify(f['power'])}, not mains`);
  if (f['lowPowerMode'] !== false) off.push(`Low Power Mode is ${JSON.stringify(f['lowPowerMode'])}, not off`);
  if (f['thermalState'] !== 'nominal') off.push(`the thermal state is ${JSON.stringify(f['thermalState'])}, not nominal`);
  if (typeof f['macosBuild'] !== 'string' || f['macosBuild'] === '') off.push('the macOS build is missing');
  return off.length > 0 ? off.join('; ') : null;
}

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
const numOrNull = (v: JsonValue | undefined, what: string): number | null => (v === null ? null : num(v, what));
const strOrNull = (v: JsonValue | undefined, what: string): string | null => (v === null || v === undefined ? null : str(v, what));
function oneOf<T extends string>(v: JsonValue | undefined, values: readonly T[], what: string): T {
  const s = str(v, what);
  expect(values, `${what} is one of ${values.join(', ')}`).toContain(s);
  return s as T;
}

// ---------------------------------------------------------------------------------------------------
// The build: `deep-gpu` with `test-meter` (the stubs, the test canvas module `test.gpu`), built once per file.

/** Builds the `test-meter` set once, before the file's tests; a test whose build failed fails with cargo's error. */
export function useBuild(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1903-bin-'));
    const run = spawnSync('cargo', BUILD, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const target = process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');
    if (run.error) error = `cargo could not run: ${run.error.message}`;
    else if (run.status !== 0) error = `cargo ${BUILD.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
    else copyFileSync(join(target, 'debug', process.platform === 'win32' ? `${BIN}.exe` : BIN), join(dir, BIN));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo ${BUILD.join(' ')}`).toBe('');
    return join(dir, BIN);
  };
}

/** A fresh output folder per test, deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1903-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// Running: `deep-gpu run [--backend noop] [--planted <name>]`, one scenario, one reply per call.

/** The wrong programs `--planted` reaches (README: Planted programs). */
export type Planted =
  | 'times_each_pass_alone' | 'takes_first_measurement_as_limit' | 'holds_input' | 'held_input_meter_at_encode'
  | 'bind_group_per_item' | 'uploads_every_transform' | 'warms_per_item' | 'times_only_scene' | 'wait_clock_after_warmup';
export interface RunOptions { planted?: Planted; backend?: 'noop' | 'gpu' }

/** One scenario of `calls` on the noop lane (or, with `backend: 'gpu'`, this Mac's GPU); one reply per call. */
export function run(bin: string, out: string, calls: JsonObject[], options: RunOptions = {}): JsonObject[] {
  const args = ['run', ...((options.backend ?? 'noop') === 'noop' ? ['--backend', 'noop'] : []), ...(options.planted ? ['--planted', options.planted] : [])];
  const shown = `${BIN} ${args.join(' ')}`;
  const s = spawnSync(bin, args, {
    cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL',
  });
  const timedOut = s.error !== undefined && (s.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  expect(timedOut, `${shown} finished within its timeout`).toBe(false);
  if (s.error) throw Error(`${shown}: ${s.error.message}`);
  expect(s.status, `${shown} exited 0 (${s.signal ?? 'no signal'}); stdout: ${(s.stdout ?? '').slice(0, 1500)}; stderr: ${(s.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (s.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${shown}: one output line per input line`).toBe(1);
  let answer: JsonValue;
  try { answer = JSON.parse(lines[0]!) as JsonValue; } catch { answer = lines[0]!; }
  const a = obj(answer, `${shown}: the answer`);
  expect(a['ok'], `${shown} accepted the scenario: ${JSON.stringify(a).slice(0, 2000)}`).toBe(true);
  const replies = arr(a['replies'], `${shown}: replies`).map((r, i) => obj(r, `${shown}: replies[${i}]`));
  expect(replies.length, `${shown}: one reply per call`).toBe(calls.length);
  return replies;
}

/** A reply that is no refusal: `{code, …}` fails here, naming it. */
export function answered(reply: JsonObject, what: string): JsonObject {
  expect(reply['code'], `${what} is answered, not refused: ${JSON.stringify(reply).slice(0, 1500)}`).toBeUndefined();
  return reply;
}

// ---------------------------------------------------------------------------------------------------
// Documents, as the writer sends them (#393's deep_show payload: no `id`, no `layers`, no item `layer`), as
// `frame_budget` takes them. Each is generated here and written to the test's folder.

export type V3 = [number, number, number];
export const LOOK: JsonObject = JSON.parse(readFileSync(join(HERE, 'fixtures', 'look.json'), 'utf8')) as JsonObject;

/** Writes `doc` under `dir` and returns its absolute path. */
export function writeDoc(dir: string, name: string, doc: JsonObject): string {
  const path = join(dir, `${name.replace(/[^a-z0-9-]+/gi, '_')}.json`);
  writeFileSync(path, JSON.stringify(doc));
  return path;
}

/** A linear channel turning the orbit camera `cam` from `from`° to `to`° over the 60 s span. */
const orbit = (from: number, to: number): JsonObject => ({
  spin: { target: 'items/cam/params/orbit/azimuth', type: 'f32', keys: { k0: { t: '0s', value: from, interp: 'linear' }, k1: { t: '60s', value: to, interp: 'linear' } } },
});

/** The envelope's every-pass scene, as this suite stands it in (README: Fixtures). */
export interface SceneSpec { burns?: readonly string[]; nudge?: boolean }
/** The control the test inputs set (README: The `envelope` call, `inputs`). */
export const NUDGE = 'nudge';
/**
 * A showpiece: an orbit camera turning once over 60 s around a 1 m box; with `burns`, a `test.burn@1` pass per ID
 * (`test.gpu`, `test-meter` builds); with `nudge`, the toggle control `nudge` that lifts the box a quarter metre.
 */
export function sceneDoc(spec: SceneSpec = {}): JsonObject {
  const burns = spec.burns ?? [];
  const items: JsonObject = {
    cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'perspective', target: [0, 0, 0], orbit: { azimuth: 30, elevation: 35, distance: 14 }, fov: 40 } },
    box: { id: 'box', kind: 'mark.box@1', name: 'Box', order: 'b000', params: { size: [1, 1, 1], paint: { fill: { role: 'accent' } } }, at: { pos: [0, 0.5, 0] } },
  };
  burns.forEach((id, k) => { items[id] = { id, kind: 'test.burn@1', name: `Burn ${id}`, order: `c${k}`, params: { loops: 1 } }; });
  const doc: JsonObject = {
    format: 1, profile: 'scene', title: 'The envelope scene', description: 'The every-pass scene a #1903 acceptance test stands in.',
    size: FULL_SCREEN, camera: 'cam', requires: { modules: { scene3d: '^1', ...(burns.length > 0 ? { 'test.gpu': '^1' } : {}) } },
    budget: { class: 'showpiece' }, transport: { span: '60s' }, items, channels: orbit(30, 390),
  };
  if (spec.nudge) {
    doc['controls'] = { [NUDGE]: { kind: 'toggle', class: 'document', label: 'Nudge', role: 'switch', binds: ['items/box/at/pos/1'], range: [0.5, 0.75], default: false } };
  }
  return doc;
}

// `separate-items` (README: Fixtures): 4,000 separate 1 m boxes on an 80 × 50 grid 1.5 m apart, all in view of an orbit
// camera (elevation 60°, 300 m out, fov 40) turning once over 60 s; 400 looks (`material@1` items), item i wearing
// look i mod 400; and 12 feature sets, look m having set m mod 12: six patterns (none and five shipped ones), each
// lit or unlit. No instancer.
export const SEPARATE = { items: 4000, looks: 400, featureSets: 12, columns: 80, spacing: 1.5, twin: 40, perInstancer: 10 };
const PATTERNS = ['none', 'plaster', 'wood', 'rock', 'concrete', 'asphalt'] as const;
export const itemId = (i: number): string => `item-${String(i).padStart(4, '0')}`;
export const lookId = (m: number): string => `look-${String(m).padStart(3, '0')}`;
export const lookOf = (i: number): number => i % SEPARATE.looks;
export const featureSetOf = (m: number): number => m % SEPARATE.featureSets;
export function itemPos(i: number): V3 {
  const rows = SEPARATE.items / SEPARATE.columns;
  return [((i % SEPARATE.columns) - (SEPARATE.columns - 1) / 2) * SEPARATE.spacing, 0.5, (Math.floor(i / SEPARATE.columns) - (rows - 1) / 2) * SEPARATE.spacing];
}
function look(m: number): JsonObject {
  const f = featureSetOf(m);
  const pattern = PATTERNS[f % PATTERNS.length]!;
  return {
    id: lookId(m), kind: 'material@1', name: `Look ${m}`, order: `l${String(m).padStart(3, '0')}`,
    params: {
      base_color: [0.2 + (0.6 * (m % 20)) / 19, 0.3 + (0.5 * Math.floor(m / 20)) / 19, 0.5, 1], roughness: 0.3 + (0.5 * (m % 7)) / 6,
      ...(pattern === 'none' ? {} : { pattern }), ...(f >= PATTERNS.length ? { unlit: true } : {}),
    },
  };
}
function crowd(title: string, description: string, items: JsonObject): JsonObject {
  return {
    format: 1, profile: 'scene', title, description, size: FULL_SCREEN, camera: 'cam', requires: { modules: { scene3d: '^1' } },
    budget: { class: 'showpiece' }, transport: { span: '60s' },
    items: {
      cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'perspective', target: [0, 0, 0], orbit: { azimuth: 0, elevation: 60, distance: 300 }, fov: 40 } },
      sun: { id: 'sun', kind: 'light.sun@1', name: 'Sun', order: 'a1', params: { illuminance: 3, color: [1, 1, 1], shadow: false }, at: { rot: [-40, 20, 0] } },
      ...items,
    },
    channels: orbit(0, 360),
  };
}
/** `separate-items` (n = 4,000), or its 40-item twin (n = 40: items 0–39 over looks 0–39, all 12 feature sets). */
export function separateItemsDoc(n: number = SEPARATE.items): JsonObject {
  const items: JsonObject = {};
  for (let m = 0; m < Math.min(n, SEPARATE.looks); m++) items[lookId(m)] = look(m);
  for (let i = 0; i < n; i++) {
    items[itemId(i)] = { id: itemId(i), kind: 'mark.box@1', name: `Item ${i}`, order: `m${String(i).padStart(4, '0')}`, params: { size: [1, 1, 1] }, at: { pos: itemPos(i) }, material: lookId(lookOf(i)) };
  }
  return n === SEPARATE.items
    ? crowd('Separate items', '4,000 separate boxes over 400 looks that share 12 feature sets, all in view of an orbiting camera: a #1903 acceptance fixture.', items)
    : crowd(`Separate items, ${n}`, `${n} separate boxes of separate-items over the same 12 feature sets: a #1903 acceptance fixture.`, items);
}
/** The instanced twin: the same 4,000 boxes drawn as 400 instancers of 10, instancer m drawing look m's ten items. */
export function instancedTwinDoc(): JsonObject {
  const items: JsonObject = {};
  for (let m = 0; m < SEPARATE.looks; m++) {
    items[lookId(m)] = look(m);
    const proto = `proto-${String(m).padStart(3, '0')}`;
    items[proto] = { id: proto, kind: 'mark.box@1', name: `Prototype ${m}`, order: `p${String(m).padStart(3, '0')}`, params: { size: [1, 1, 1] }, at: { pos: [0, 0, 0] }, material: lookId(m), visible: false };
    const members = range(0, SEPARATE.perInstancer - 1).map((j) => m + j * SEPARATE.looks);
    const inst = `inst-${String(m).padStart(3, '0')}`;
    items[inst] = {
      id: inst, kind: 'instance@1', name: `Instancer ${m}`, order: `q${String(m).padStart(3, '0')}`,
      params: { of: [proto], ids: range(0, SEPARATE.perInstancer - 1), pos: members.map(itemPos) }, at: { pos: [0, 0, 0] },
    };
  }
  return crowd('Separate items, instanced', 'The boxes of separate-items drawn as 400 instancers of 10: a #1903 acceptance fixture.', items);
}

/** A patch op on an item's field (#378, #389). */
export const set = (id: string, path: string, value: JsonValue): JsonObject => ({ op: 'set', id, path: `items/${id}/${path}`, value });

// ---------------------------------------------------------------------------------------------------
// Seeded test input times (mulberry32), ns on a run's clock, sorted.

export function seededTimes(seed: number, count: number, untilNs: number): number[] {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: count }, () => Math.floor(next() * untilNs)).sort((x, y) => x - y);
}

/** The nearest-rank 95th percentile (the ⌈0.95 n⌉-th smallest). */
export function p95(values: number[]): number {
  const v = [...values].sort((x, y) => x - y);
  return v[Math.max(0, Math.ceil(0.95 * v.length) - 1)]!;
}

// ---------------------------------------------------------------------------------------------------
// The `envelope` call (README: The `envelope` call).

export const SCENE = 'scene';
export const SEPARATE_ITEMS = 'separate-items';
export const INSTANCED = 'separate-items/instanced';
/** The calibration baseline's metrics (README: Calibration metrics). */
export const SCENE_METRICS = ['frame_time_p99', 'seek_rebuild', 'peak_memory/app', 'peak_memory/decode_worker', 'export_throughput'] as const;
export const WAIT_FRESH = 'first_frame_wait/fresh';
export const WAIT_SAME = 'first_frame_wait/same_process';
export const RATIO = 'separate_items_ratio';

export interface FixtureStub { gpu_ms?: number; passes?: Record<string, number>; cpu_ms?: number; gpu_bytes: number }
export interface Readings { seek_rebuild_ms: number; peak_bytes: { app: number; decode_worker: number }; export_x: number }
export interface EnvelopeStub extends Readings { fixtures: Record<string, FixtureStub> }
/** The stub's readings of the reference Mac's first run. */
export const READINGS: Readings = { seek_rebuild_ms: 40, peak_bytes: { app: 900_000_000, decode_worker: 200_000_000 }, export_x: 3 };
/** A fixture whose every frame's passes cover `gpu_ms` of GPU, holding 100 MB on the device. */
export const flat = (gpu_ms: number): FixtureStub => ({ gpu_ms, gpu_bytes: 100_000_000 });
export const stubMeter = (fixtures: Record<string, FixtureStub>, readings: Readings = READINGS): EnvelopeStub => ({ ...readings, fixtures });

export interface EnvelopeSpec {
  store: string;
  scene: string;
  separate_items?: { doc: string; instanced: string };
  seconds: number;
  warmup?: number;
  inputs?: { control: string; at_ns: number[] };
  first_frame_wait?: boolean;
  report?: ('frames' | 'inputs')[];
  stub_meter?: EnvelopeStub;
  stub_display?: { rate_hz: number };
  stub_environment?: Fingerprint;
  stub_pipeline_delay_ms?: number;
}
export function envelopeCall(spec: EnvelopeSpec): JsonObject {
  const { seconds, ...rest } = spec;
  return { call: 'envelope', look: LOOK, writer: WRITER, render: { seconds, pixels: FULL_SCREEN }, ...(rest as unknown as JsonObject) };
}

export interface RunTimes { p50_ms: number | null; p95_ms: number | null; p99_ms: number | null }
export interface PassRow { item: string | null; name: string; p95_ms: number | null }
export interface FrameTime { limit_ms: number; verdict: Verdict; runs: RunTimes[]; margin: number | null; passes: PassRow[] }
export interface FixtureRow { fixture: string; verdict: Verdict; why: string | null; frame_time: FrameTime | null }
export interface InputLimit {
  limit_frames: number; rate_hz: number | null; limit_ms: number | null; verdict: Verdict;
  runs: { p95_ms: number | null; p95_frames: number | null }[]; margin: number | null; missing: string | null;
}
export interface DeviceValue { device: Device; value: number }
export interface Metric {
  metric: string; unit: string; better: 'lower' | 'higher'; measured: number | null; limit: number | null;
  verdict: Verdict; baseline: DeviceValue[]; why: string | null;
}
export interface Ask { id: string; kind: string; metrics: { metric: string; baseline: DeviceValue[] }[] }
export interface Open { open: 'fresh' | 'same_process'; ms: number; pipelines: number }
export interface FrameLog { fixture: string; run: number; frame: number; latched_ns: number; encoded_ns: number; presented_ns: number }
export interface InputLog { run: number; input: number; arrived_ns: number; frame: number; presented_ns: number; ms: number }
export interface Envelope {
  verdict: Verdict;
  fixtures: FixtureRow[];
  input: InputLimit;
  calibration: Metric[];
  asks: Ask[];
  first_frame_wait: Open[] | null;
  frames: FrameLog[] | null;
  inputs: InputLog[] | null;
}

function valuesOf(v: JsonValue | undefined, at: string): DeviceValue[] {
  return arr(v, at).map((b, i) => {
    const o = obj(b, `${at}[${i}]`);
    const d = obj(o['device'], `${at}[${i}].device`);
    return { device: { model: str(d['model'], `${at}[${i}].device.model`), chip: str(d['chip'], `${at}[${i}].device.chip`) }, value: num(o['value'], `${at}[${i}].value`) };
  });
}

function frameTimeOf(v: JsonValue | undefined, at: string): FrameTime | null {
  if (v === null || v === undefined) return null;
  const o = obj(v, at);
  return {
    limit_ms: num(o['limit_ms'], `${at}.limit_ms`),
    verdict: oneOf(o['verdict'], VERDICTS, `${at}.verdict`),
    runs: arr(o['runs'], `${at}.runs`).map((r, i) => {
      const x = obj(r, `${at}.runs[${i}]`);
      return { p50_ms: numOrNull(x['p50_ms'], `${at}.runs[${i}].p50_ms`), p95_ms: numOrNull(x['p95_ms'], `${at}.runs[${i}].p95_ms`), p99_ms: numOrNull(x['p99_ms'], `${at}.runs[${i}].p99_ms`) };
    }),
    margin: numOrNull(o['margin'] ?? null, `${at}.margin`),
    passes: arr(o['passes'], `${at}.passes`).map((p, i) => {
      const x = obj(p, `${at}.passes[${i}]`);
      return { item: strOrNull(x['item'], `${at}.passes[${i}].item`), name: str(x['name'], `${at}.passes[${i}].name`), p95_ms: numOrNull(x['p95_ms'], `${at}.passes[${i}].p95_ms`) };
    }),
  };
}

/** Parses one envelope result, failing at the first missing or mistyped field. */
export function envelopeOf(reply: JsonObject, what: string): Envelope {
  answered(reply, what);
  const input = obj(reply['input'], `${what}: input`);
  const ffw = reply['first_frame_wait'];
  return {
    verdict: oneOf(reply['verdict'], VERDICTS, `${what}: verdict`),
    fixtures: arr(reply['fixtures'], `${what}: fixtures`).map((f, i) => {
      const o = obj(f, `${what}: fixtures[${i}]`);
      const at = `${what}: fixture ${JSON.stringify(o['fixture'])}`;
      return { fixture: str(o['fixture'], `${at}.fixture`), verdict: oneOf(o['verdict'], VERDICTS, `${at}.verdict`), why: strOrNull(o['why'], `${at}.why`), frame_time: frameTimeOf(o['frame_time'], `${at}.frame_time`) };
    }),
    input: {
      limit_frames: num(input['limit_frames'], `${what}: input.limit_frames`),
      rate_hz: numOrNull(input['rate_hz'] ?? null, `${what}: input.rate_hz`),
      limit_ms: numOrNull(input['limit_ms'] ?? null, `${what}: input.limit_ms`),
      verdict: oneOf(input['verdict'], VERDICTS, `${what}: input.verdict`),
      runs: arr(input['runs'], `${what}: input.runs`).map((r, i) => {
        const x = obj(r, `${what}: input.runs[${i}]`);
        return { p95_ms: numOrNull(x['p95_ms'], `${what}: input.runs[${i}].p95_ms`), p95_frames: numOrNull(x['p95_frames'], `${what}: input.runs[${i}].p95_frames`) };
      }),
      margin: numOrNull(input['margin'] ?? null, `${what}: input.margin`),
      missing: strOrNull(input['missing'], `${what}: input.missing`),
    },
    calibration: arr(reply['calibration'], `${what}: calibration`).map((m, i) => {
      const o = obj(m, `${what}: calibration[${i}]`);
      const at = `${what}: metric ${JSON.stringify(o['metric'])}`;
      return {
        metric: str(o['metric'], `${at}.metric`), unit: str(o['unit'], `${at}.unit`), better: oneOf(o['better'], ['lower', 'higher'] as const, `${at}.better`),
        measured: numOrNull(o['measured'], `${at}.measured`), limit: numOrNull(o['limit'], `${at}.limit`),
        verdict: oneOf(o['verdict'], VERDICTS, `${at}.verdict`), baseline: valuesOf(o['baseline'], `${at}.baseline`), why: strOrNull(o['why'], `${at}.why`),
      };
    }),
    asks: arr(reply['asks'], `${what}: asks`).map((a, i) => {
      const o = obj(a, `${what}: asks[${i}]`);
      return {
        id: str(o['id'], `${what}: asks[${i}].id`), kind: str(o['kind'], `${what}: asks[${i}].kind`),
        metrics: arr(o['metrics'], `${what}: asks[${i}].metrics`).map((m, j) => {
          const x = obj(m, `${what}: asks[${i}].metrics[${j}]`);
          return { metric: str(x['metric'], `${what}: asks[${i}].metrics[${j}].metric`), baseline: valuesOf(x['baseline'], `${what}: asks[${i}].metrics[${j}].baseline`) };
        }),
      };
    }),
    first_frame_wait: ffw === null || ffw === undefined ? null : arr(ffw, `${what}: first_frame_wait`).map((w, i) => {
      const o = obj(w, `${what}: first_frame_wait[${i}]`);
      return { open: oneOf(o['open'], ['fresh', 'same_process'] as const, `${what}: first_frame_wait[${i}].open`), ms: num(o['ms'], `${what}: first_frame_wait[${i}].ms`), pipelines: num(o['pipelines'], `${what}: first_frame_wait[${i}].pipelines`) };
    }),
    frames: reply['frames'] === undefined ? null : arr(reply['frames'], `${what}: frames`).map((f, i) => {
      const o = obj(f, `${what}: frames[${i}]`);
      const at = `${what}: frames[${i}]`;
      return {
        fixture: str(o['fixture'], `${at}.fixture`), run: num(o['run'], `${at}.run`), frame: num(o['frame'], `${at}.frame`),
        latched_ns: num(o['latched_ns'], `${at}.latched_ns`), encoded_ns: num(o['encoded_ns'], `${at}.encoded_ns`), presented_ns: num(o['presented_ns'], `${at}.presented_ns`),
      };
    }),
    inputs: reply['inputs'] === undefined ? null : arr(reply['inputs'], `${what}: inputs`).map((x, i) => {
      const o = obj(x, `${what}: inputs[${i}]`);
      const at = `${what}: inputs[${i}]`;
      return {
        run: num(o['run'], `${at}.run`), input: num(o['input'], `${at}.input`), arrived_ns: num(o['arrived_ns'], `${at}.arrived_ns`),
        frame: num(o['frame'], `${at}.frame`), presented_ns: num(o['presented_ns'], `${at}.presented_ns`), ms: num(o['ms'], `${at}.ms`),
      };
    }),
  };
}

/** The fixture's row, or undefined when the result has none. */
export const fixtureRow = (e: Envelope, name: string): FixtureRow | undefined => e.fixtures.find((f) => f.fixture === name);
/** The calibration metric's row; a result without it fails here, naming it. */
export function metricRow(e: Envelope, name: string, what: string): Metric {
  const m = e.calibration.find((x) => x.metric === name);
  expect(m, `${what}: the calibration baseline has a ${name} row`).toBeDefined();
  return m!;
}
export const sameDevice = (a: Device, b: Device): boolean => a.model === b.model && a.chip === b.chip;

// ---------------------------------------------------------------------------------------------------
// `decide` (#380's call) with a limits decision (README: Your limits).

export function decideCall(store: string, via: 'you' | 'agent', limits: Record<string, number>): JsonObject {
  return { call: 'decide', store, via, decision: { limits } };
}

// ---------------------------------------------------------------------------------------------------
// The `envelope_counts` call (README: The `envelope_counts` call), on the noop lane.

export interface Patch { frame: number; ops: JsonObject[] }
export function countsCall(doc: string, seconds: number, patches?: Patch[]): JsonObject {
  return {
    call: 'envelope_counts', look: LOOK, writer: WRITER, doc, render: { seconds, pixels: COUNT_PIXELS },
    ...(patches ? { patches: patches as unknown as JsonValue[] } : {}),
  };
}
export interface Batch { batch: string; items: string[] }
export interface CountFrame { frame: number; encoded: Batch[]; bind_groups: number; buffers: number; pipelines: number; uploaded_bytes: number }
export interface Counts { warmup: number; frames: CountFrame[] }
export function countsOf(reply: JsonObject, what: string): Counts {
  answered(reply, what);
  const w = obj(reply['warmup'], `${what}: warmup`);
  return {
    warmup: num(w['pipelines'], `${what}: warmup.pipelines`),
    frames: arr(reply['frames'], `${what}: frames`).map((f, i) => {
      const o = obj(f, `${what}: frames[${i}]`);
      const at = `${what}: frames[${i}]`;
      return {
        frame: num(o['frame'], `${at}.frame`),
        encoded: arr(o['encoded'], `${at}.encoded`).map((b, j) => {
          const x = obj(b, `${at}.encoded[${j}]`);
          return { batch: str(x['batch'], `${at}.encoded[${j}].batch`), items: arr(x['items'], `${at}.encoded[${j}].items`).map((id, k) => str(id, `${at}.encoded[${j}].items[${k}]`)) };
        }),
        bind_groups: num(o['bind_groups'], `${at}.bind_groups`), buffers: num(o['buffers'], `${at}.buffers`),
        pipelines: num(o['pipelines'], `${at}.pipelines`), uploaded_bytes: num(o['uploaded_bytes'], `${at}.uploaded_bytes`),
      };
    }),
  };
}
