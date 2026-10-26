// Test-side tools for the #379 acceptance tests: `deep-gpu` (#377's binary) built per Cargo feature set and
// driven by JSON lines, with this suite's calls (`adapter`, `tick`, `live`, `canonical`, `allocate`,
// `release`); `deep-show` (#393's) for the document check's refusal and the registry's costs; the documents
// the scenarios open, generated here; the ladder's order and the expected-changes check the planted ladders
// must fail; pass-interval arithmetic; and the reference-Mac gate with the design's judge for timing results.
// Nothing here stands in for the meter, the ladder, the cache, the device or the perf lane under test.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/379 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const GPU_BIN = 'deep-gpu';
export const SHOW_BIN = 'deep-show';
const uplifted = (name: string): string => join(REPO, 'target', 'debug', process.platform === 'win32' ? `${name}.exe` : name);
/** A startup the binary refuses (an unknown argument, planted name or withheld feature) exits with this status after one line. */
export const REFUSED_EXIT = 2;

// ---------------------------------------------------------------------------------------------------
// The criteria's numbers.

export const MB = 1_000_000;
export const MIB = 2 ** 20;
/** "GPU memory stays under 256 MB per window full screen" (MB as the design writes it: 10^6 bytes). */
export const WINDOW_CAP_BYTES = 256 * MB;

/** The budget classes (Budget classes by class), as a document's `budget.class` names them. */
export const CLASSES = ['core_view', 'data_view', 'figure', 'work_product', 'showpiece', 'export'] as const;
export type BudgetClass = (typeof CLASSES)[number];
/** Each class's frame limits from the budget class table, in ms; export has no frame cap. */
export const CLASS_LIMITS: Record<BudgetClass, { gpu_ms: number | null; cpu_ms: number | null }> = {
  core_view: { gpu_ms: 1, cpu_ms: 2 },
  data_view: { gpu_ms: 2, cpu_ms: 2 },
  figure: { gpu_ms: 2, cpu_ms: 4 },
  work_product: { gpu_ms: 2, cpu_ms: 4 },
  showpiece: { gpu_ms: 10, cpu_ms: 4 },
  export: { gpu_ms: null, cpu_ms: null },
};

/**
 * The ladder, top to bottom: the four climb rungs above the class's base (the last listed is the first one
 * climbed), the base, then the run-time rungs below it in the design's order (refuse is the check's, before
 * a document shows, and is no live rung).
 */
export const LADDER = [
  'shadows_2x', 'full_res_effects', 'samples_4_moving', 'scale_1_moving',
  'base',
  'effects_off', 'lod_down', 'internal_scale_down', '30hz', 'freeze', 'placeholder',
] as const;
export type Rung = (typeof LADDER)[number];
export const REASONS = ['initial', 'headroom', 'frame_health', 'battery', 'you'] as const;
/** Lower on the ladder is a larger index. */
export const rungIndex = (rung: string): number => LADDER.indexOf(rung as Rung);

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

/** A test that can't be judged here fails with this, never passes: off macOS, off a reference Mac, or unsupported. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}

// ---------------------------------------------------------------------------------------------------
// Builds: `deep-gpu` per Cargo feature set, each built once per file and kept under its own name.

/** `default` is the shipped build; `test-meter` adds the stubs and the test writer (README: Builds). */
export type Build = 'default' | 'test-meter';
const featuresOf = (build: Build): string[] => (build === 'default' ? [] : [build]);

function cargoBuild(bin: string, features: string[]): string {
  const args = ['build', '--locked', '--bin', bin, ...(features.length ? ['--features', features.join(',')] : [])];
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}

export interface Builds { bin: (build?: Build) => string }

/** Builds every listed `deep-gpu` set once, before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useBuilds(builds: readonly Build[]): Builds {
  let dir = '';
  const made = new Map<Build, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-379-bins-'));
    for (const build of builds) {
      if (made.has(build)) continue;
      const error = cargoBuild(GPU_BIN, featuresOf(build));
      const bin = join(dir, `${GPU_BIN}-${build}`);
      if (error === '') copyFileSync(uplifted(GPU_BIN), bin);
      made.set(build, { bin, error });
    }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(build: Build = 'default'): string {
      const entry = made.get(build);
      if (!entry) throw Error(`the file didn't list the build ${build} in useBuilds`);
      expect(entry.error, `the binary builds: cargo build --locked --bin ${GPU_BIN}${featuresOf(build).length ? ` --features ${featuresOf(build).join(',')}` : ''}`).toBe('');
      return entry.bin;
    },
  };
}

/** Builds `deep-show` (the shipped `full` set) once per file. */
export function useShowBuild(): () => string {
  let error = '';
  let dir = '';
  beforeAll(() => {
    error = cargoBuild(SHOW_BIN, []);
    dir = mkdtempSync(join(tmpdir(), 'deep-379-show-'));
    if (error === '') copyFileSync(uplifted(SHOW_BIN), join(dir, SHOW_BIN));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo build --locked --bin ${SHOW_BIN}`).toBe('');
    return join(dir, SHOW_BIN);
  };
}

// ---------------------------------------------------------------------------------------------------
// Starting a binary: one JSON line per input line out.

export interface Started { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string; ms: number }

export function start(bin: string, args: string[], inputs: (JsonValue | string)[], timeoutMs = 3_600_000): Started {
  const text = inputs.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n');
  const began = performance.now();
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(bin, args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const ms = performance.now() - began;
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${bin} ${args.join(' ')}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  const lines = stdout.split('\n').filter((line) => line !== '').map((line) => {
    try { return JSON.parse(line) as JsonValue; } catch { return line; }
  });
  return { status: run.status, signal: run.signal, timedOut, lines, stdout, stderr: run.stderr ?? '', ms };
}

/** The wrong programs `deep-gpu run --planted <name>` reaches, each only there (README: Planted programs). */
export type Planted =
  | 'sums_pass_intervals' | 'allocates_per_frame' | 'compiles_at_swap' | 'charges_first_holder' | 'keeps_unread_results'
  | 'formula_count' | 'steps_on_first_slow_frame' | 'skips_a_rung' | 'steps_every_writer' | 'shares_meter_with_worker';
export interface Startup { backend?: 'noop'; withhold?: 'timestamps'; planted?: Planted }
export const startArgs = (s: Startup = {}): string[] => [
  'run',
  ...(s.backend ? ['--backend', s.backend] : []),
  ...(s.withhold ? ['--withhold', s.withhold] : []),
  ...(s.planted ? ['--planted', s.planted] : []),
];

/** `deep-gpu run`: one scenario `{out, calls}`, accepted, with one reply per call. */
export function run(bin: string, out: string, calls: JsonObject[], startup: Startup = {}, timeoutMs?: number): JsonObject[] {
  const args = startArgs(startup);
  const s = start(bin, args, [{ out, calls }], timeoutMs);
  const shown = `${GPU_BIN} ${args.join(' ')}`;
  expect(s.timedOut, `${shown} finished within its timeout`).toBe(false);
  expect(s.status, `${shown} exited 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-3000)}`).toBe(0);
  expect(s.lines.length, `${shown}: one output line per input line`).toBe(1);
  const answer = obj(s.lines[0], `${shown}: the answer`);
  expect(answer['ok'], `${shown} refused the scenario: ${JSON.stringify(answer).slice(0, 2000)}`).toBe(true);
  const replies = arr(answer['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(calls.length);
  return replies;
}

/** One call in a fresh process; its reply, with a refusal (`code`) failing the test unless `refusalOk`. */
export function one(bin: string, out: string, call: JsonObject, startup: Startup = {}, timeoutMs?: number): JsonObject {
  const [reply] = run(bin, out, [call], startup, timeoutMs);
  return reply!;
}

/** A reply that is a refusal: its `code`, and `unsupported_platform` turned into INCONCLUSIVE. */
export function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} answered unsupported_platform`);
  expect(reply['code'], `${what} is answered, not refused: ${JSON.stringify(reply).slice(0, 1500)}`).toBeUndefined();
  return reply;
}

/** A fresh output folder per test, deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-379-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// The machine: macOS and Metal for device readings, a reference Mac for timings and its display.

const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
/** The reference Macs and their built-in displays in device px (technical design: The reference Macs). */
export const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', display: [3456, 2234] as [number, number] },
  { model: 'Mac15,12', chip: 'Apple M3', display: [2560, 1664] as [number, number] },
];
export function machineModel(): string | null {
  if (process.platform !== 'darwin') return null;
  try { return sh('sysctl', '-n', 'hw.model'); } catch { return null; }
}
/** Device readings (pass timestamps, Metal's allocated size) need macOS's Metal device. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`device readings need macOS's Metal device; this is ${process.platform}`);
}
/** The reference Mac this is, or INCONCLUSIVE. Power, Low Power Mode and load are not gated (the owner's rule). */
export function requireReferenceMac(): (typeof REFERENCE_MACS)[number] {
  requireMetal();
  const model = machineModel();
  const mac = REFERENCE_MACS.find((m) => m.model === model);
  if (!mac) inconclusive(`not a reference Mac (Mac15,7 or Mac15,12): hw.model is ${model}`);
  return mac;
}

const marginOf = (runs: number[], limit: number): number => Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / limit);
/**
 * The design's judge for a timing limit (Every task carries its own budgets): five runs after warm-up, on a
 * reference Mac; PASS when all five are within the limit, FAIL when all five are over it by more than the
 * margin (the larger of 5% and their spread), else INCONCLUSIVE, which fails here with that word.
 */
export function judge(name: string, runs: number[], limit: number): void {
  requireReferenceMac();
  expect(runs.length, `${name}: five runs`).toBe(5);
  const margin = marginOf(runs, limit);
  const shown = `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(shown);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${shown}`).toBe(false);
  inconclusive(shown);
}

// ---------------------------------------------------------------------------------------------------
// Documents: the writer's payload a session opens (#393's deep_show document: the envelope and ID maps, no
// `id`, no `layers`, no item `layer`), written to a file whose path the calls take.

export const LOOK: JsonObject = JSON.parse(readFileSync(join(HERE, 'fixtures', 'look.json'), 'utf8')) as JsonObject;
export const W = { alpha: 'agent:alpha', bravo: 'agent:bravo', test: 'agent:test-writer' } as const;

export interface DocSpec {
  title: string;
  class: BudgetClass;
  size: [number, number];
  /** How many 1 m boxes, on a 2.5 m grid (default 4). */
  boxes?: number;
  /** A channel slides box 0 for the whole span, so every frame draws while the view stays still. */
  moving?: boolean;
  /** More items, by ID, as the writer sends them. */
  items?: Record<string, JsonObject>;
  /** More fields of the `budget` envelope (caps that only tighten the class). */
  budget?: JsonObject;
}

/** A 3D scene document of `spec`: a camera and boxes drawn by scene3d, plus any test-module items. */
export function sceneDoc(spec: DocSpec): JsonObject {
  const items: JsonObject = {
    cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'perspective', target: [0, 0, 0], orbit: { azimuth: 30, elevation: 35, distance: 14 }, fov: 40 } },
  };
  const n = spec.boxes ?? 4;
  for (let i = 0; i < n; i++) {
    items[`box-${i}`] = {
      id: `box-${i}`, kind: 'mark.box@1', name: `Box ${i}`, order: `b${String(i).padStart(3, '0')}`,
      params: { size: [1, 1, 1], paint: { fill: { role: 'accent' } } }, at: { pos: [(i % 4) * 2.5 - 3.75, 0.5, Math.floor(i / 4) * 2.5 - 2.5] },
    };
  }
  const extra = spec.items ?? {};
  Object.assign(items, extra);
  const testKinds = Object.values(extra).some((it) => typeof it['kind'] === 'string' && (it['kind'] as string).startsWith('test.'));
  const doc: JsonObject = {
    format: 1, profile: 'scene', title: spec.title, description: `${spec.title}: a #379 acceptance fixture.`,
    size: spec.size, camera: 'cam',
    requires: { modules: { scene3d: '^1', ...(testKinds ? { 'test.gpu': '^1' } : {}) } },
    budget: { class: spec.class, ...(spec.budget ?? {}) },
    transport: { span: '60s' },
    items,
  };
  if (spec.moving) {
    doc['channels'] = { slide: { target: 'items/box-0/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: -3.75, interp: 'linear' }, k1: { t: '60s', value: 3.75, interp: 'linear' } } } };
  }
  return doc;
}

/** The test module's kinds (`test.gpu`, `test-meter` builds only): README, The test canvas module. */
export const texture = (id: string, size: [number, number], pattern: string): JsonObject => ({
  id, kind: 'test.texture@1', name: `Texture ${id}`, order: 'c0', params: { size, format: 'rgba8', mips: 'all', pattern }, at: { pos: [0, 2, 0] },
});
export const mesh = (id: string, vertices: number, seed: string, asset?: string): JsonObject => ({
  id, kind: 'test.mesh@1', name: `Mesh ${id}`, order: 'c1', params: { vertices, seed, ...(asset ? { asset } : {}) }, at: { pos: [0, 0, 2] },
});
export const burn = (id: string, loops: number): JsonObject => ({
  id, kind: 'test.burn@1', name: `Burn ${id}`, order: 'c2', params: { loops },
});

/** Writes `doc` under `dir` and returns its absolute path. */
export function writeDoc(dir: string, name: string, doc: JsonObject): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(doc));
  return path;
}

// ---------------------------------------------------------------------------------------------------
// The `live` call and its reply (README: The live call).

export interface Open { session: string; writer: string; doc: string; size?: [number, number] }
export type LiveEvent =
  | { frame: number; open: Open }
  | { frame: number; close: string }
  | { frame: number; revise: { session: string; doc: string } }
  | { frame: number; camera: { session: string; azimuth: number } }
  | { frame: number; rung: { session: string; to: Rung } }
  | { frame: number; canonical: { session: string; purpose: Purpose; frame: number; size: [number, number] } };
export type Purpose = 'render_back' | 'export' | 'frame_budget';
export type Report = 'passes' | 'hashes' | 'memory' | 'allocs' | 'meter';
/** A stub meter's charge for a writer over frames `from` … `to` (to the end when `to` is absent). */
export interface Charge { from: number; to?: number; gpu_ms: number; cpu_ms?: number }
export interface Interval { name: string; session: string; start_ms: number; end_ms: number; shares?: { writer: string; share: number }[] }
export interface StubMeter { writers?: Record<string, Charge[]>; passes?: { from: number; to: number; intervals: Interval[] }[]; operators?: Record<string, number> }
export interface BatteryReading { frame: number; percent: number; state: 'discharging' | 'charging' }
export interface LiveSpec {
  frames: number;
  sessions: Open[];
  events?: LiveEvent[];
  report?: Report[];
  fps?: number;
  stub_meter?: StubMeter;
  stub_battery?: BatteryReading[];
  assets?: Record<string, string>;
}
export const liveCall = (spec: LiveSpec): JsonObject => ({ call: 'live', look: LOOK, ...(spec as unknown as JsonObject) });

export interface View { session: string; writer: string; rung: string; drawn: boolean; charged_gpu_ms: number; charged_cpu_ms: number; internal_scale: number; history_frames: number; pixel_hash: string | null | undefined }
export interface Pass { name: string; session: string | null; source: string; start_ns: number; end_ns: number; charged_ms: number; shares: { writer: string; share: number; charged_ms: number }[] | null }
export interface Held { writer: string; count_bytes: number; results: { key: string; bytes: number }[] }
export interface Frame {
  frame: number; gpu_ms: number; cpu_ms: number; gpu_source: string; views: View[];
  passes?: Pass[]; writers?: Held[]; cache?: { entries: number; bytes: number }; device_bytes?: number | null; allocs?: number;
}
export interface Change { frame: number; session: string; writer: string; from: string | null; to: string; reason: string; pipelines: string[]; compiled_by: number | null; thread: string | null; ui_thread: string; effective: number }
export interface Revision { rev: number; outcome: string; issues: JsonObject[] }
export interface SessionRow { session: string; writer: string; state: string; class: string | null; issues: JsonObject[]; revisions: Revision[] }
export interface Canonical { frame: number; session: string; purpose: string; pixel_hash: string | null; rung: string; internal_scale: number; operators: { operator: string; resolution: number }[] }
export interface MeterRow { scope: string; writer: string; session: string; rung: string; reason: string; limits: JsonObject; estimate: JsonObject; measured: number[] }
export interface Live { frames: Frame[]; changes: Change[]; sessions: SessionRow[]; canonicals: Canonical[]; meter: MeterRow[] | null; device_before: number | null }

const numOrNull = (v: JsonValue | undefined, what: string): number | null => (v === null ? null : num(v, what));

/** Parses a `live` reply, failing at the first missing or mistyped field. */
export function liveReply(reply: JsonObject, what = 'the live call'): Live {
  answered(reply, what);
  const frames = arr(reply['frames'], `${what}: frames`).map((f, i): Frame => {
    const o = obj(f, `${what}: frames[${i}]`);
    const at = `${what}: frame ${o['frame']}`;
    const views = arr(o['views'], `${at}: views`).map((v, j): View => {
      const w = obj(v, `${at}: views[${j}]`);
      return {
        session: str(w['session'], `${at}: views[${j}].session`), writer: str(w['writer'], `${at}: views[${j}].writer`),
        rung: str(w['rung'], `${at}: views[${j}].rung`), drawn: w['drawn'] === true,
        charged_gpu_ms: num(w['charged_gpu_ms'], `${at}: views[${j}].charged_gpu_ms`), charged_cpu_ms: num(w['charged_cpu_ms'], `${at}: views[${j}].charged_cpu_ms`),
        internal_scale: num(w['internal_scale'], `${at}: views[${j}].internal_scale`), history_frames: num(w['history_frames'], `${at}: views[${j}].history_frames`),
        pixel_hash: w['pixel_hash'] === undefined ? undefined : w['pixel_hash'] === null ? null : str(w['pixel_hash'], `${at}: views[${j}].pixel_hash`),
      };
    });
    const out: Frame = {
      frame: num(o['frame'], `${what}: frames[${i}].frame`), gpu_ms: num(o['gpu_ms'], `${at}: gpu_ms`), cpu_ms: num(o['cpu_ms'], `${at}: cpu_ms`),
      gpu_source: str(o['gpu_source'], `${at}: gpu_source`), views,
    };
    if (o['passes'] !== undefined) {
      out.passes = arr(o['passes'], `${at}: passes`).map((p, j): Pass => {
        const q = obj(p, `${at}: passes[${j}]`);
        return {
          name: str(q['name'], `${at}: passes[${j}].name`), session: q['session'] === null || q['session'] === undefined ? null : str(q['session'], `${at}: passes[${j}].session`),
          source: str(q['source'], `${at}: passes[${j}].source`), start_ns: num(q['start_ns'], `${at}: passes[${j}].start_ns`), end_ns: num(q['end_ns'], `${at}: passes[${j}].end_ns`),
          charged_ms: num(q['charged_ms'], `${at}: passes[${j}].charged_ms`),
          shares: q['shares'] === undefined || q['shares'] === null ? null : arr(q['shares'], `${at}: passes[${j}].shares`).map((s, k) => {
            const r = obj(s, `${at}: passes[${j}].shares[${k}]`);
            return { writer: str(r['writer'], 'a share\'s writer'), share: num(r['share'], 'a share'), charged_ms: num(r['charged_ms'], 'a share\'s charge') };
          }),
        };
      });
    }
    if (o['writers'] !== undefined) {
      out.writers = arr(o['writers'], `${at}: writers`).map((h, j): Held => {
        const q = obj(h, `${at}: writers[${j}]`);
        return {
          writer: str(q['writer'], `${at}: writers[${j}].writer`), count_bytes: num(q['count_bytes'], `${at}: writers[${j}].count_bytes`),
          results: arr(q['results'], `${at}: writers[${j}].results`).map((r, k) => {
            const x = obj(r, `${at}: writers[${j}].results[${k}]`);
            return { key: str(x['key'], 'a result\'s key'), bytes: num(x['bytes'], 'a result\'s bytes') };
          }),
        };
      });
    }
    if (o['cache'] !== undefined) {
      const c = obj(o['cache'], `${at}: cache`);
      out.cache = { entries: num(c['entries'], `${at}: cache.entries`), bytes: num(c['bytes'], `${at}: cache.bytes`) };
    }
    if (o['device_bytes'] !== undefined) out.device_bytes = numOrNull(o['device_bytes'], `${at}: device_bytes`);
    if (o['allocs'] !== undefined) out.allocs = num(o['allocs'], `${at}: allocs`);
    return out;
  });
  const changes = arr(reply['changes'], `${what}: changes`).map((c, i): Change => {
    const o = obj(c, `${what}: changes[${i}]`);
    const at = `${what}: changes[${i}]`;
    return {
      frame: num(o['frame'], `${at}.frame`), session: str(o['session'], `${at}.session`), writer: str(o['writer'], `${at}.writer`),
      from: o['from'] === null ? null : str(o['from'], `${at}.from`), to: str(o['to'], `${at}.to`), reason: str(o['reason'], `${at}.reason`),
      pipelines: arr(o['pipelines'] ?? [], `${at}.pipelines`).map((p) => str(p, `${at}: a pipeline key`)),
      compiled_by: o['compiled_by'] === null || o['compiled_by'] === undefined ? null : num(o['compiled_by'], `${at}.compiled_by`),
      thread: o['thread'] === null || o['thread'] === undefined ? null : str(o['thread'], `${at}.thread`),
      ui_thread: str(o['ui_thread'], `${at}.ui_thread`), effective: num(o['effective'], `${at}.effective`),
    };
  });
  const sessions = arr(reply['sessions'], `${what}: sessions`).map((s, i): SessionRow => {
    const o = obj(s, `${what}: sessions[${i}]`);
    const at = `${what}: sessions[${i}]`;
    return {
      session: str(o['session'], `${at}.session`), writer: str(o['writer'], `${at}.writer`), state: str(o['state'], `${at}.state`),
      class: o['class'] === null || o['class'] === undefined ? null : str(o['class'], `${at}.class`),
      issues: arr(o['issues'], `${at}.issues`).map((x, j) => obj(x, `${at}.issues[${j}]`)),
      revisions: arr(o['revisions'], `${at}.revisions`).map((r, j) => {
        const q = obj(r, `${at}.revisions[${j}]`);
        return { rev: num(q['rev'], `${at}.revisions[${j}].rev`), outcome: str(q['outcome'], `${at}.revisions[${j}].outcome`), issues: arr(q['issues'] ?? [], 'issues').map((x) => obj(x, 'an issue')) };
      }),
    };
  });
  const canonicals = arr(reply['canonicals'] ?? [], `${what}: canonicals`).map((c, i) => canonicalOf(obj(c, `${what}: canonicals[${i}]`), `${what}: canonicals[${i}]`));
  const meter = reply['meter'] === undefined ? null : arr(reply['meter'], `${what}: meter`).map((m, i): MeterRow => {
    const o = obj(m, `${what}: meter[${i}]`);
    const at = `${what}: meter[${i}]`;
    return {
      scope: str(o['scope'], `${at}.scope`), writer: str(o['writer'], `${at}.writer`), session: str(o['session'], `${at}.session`),
      rung: str(o['rung'], `${at}.rung`), reason: str(o['reason'], `${at}.reason`), limits: obj(o['limits'], `${at}.limits`),
      estimate: obj(o['estimate'], `${at}.estimate`), measured: arr(o['measured'], `${at}.measured`).map((x) => num(x, `${at}: a measured frame`)),
    };
  });
  return { frames, changes, sessions, canonicals, meter, device_before: reply['device_before'] === undefined ? null : numOrNull(reply['device_before'], `${what}: device_before`) };
}

export function canonicalOf(o: JsonObject, at: string): Canonical {
  answered(o, at);
  return {
    frame: num(o['frame'], `${at}.frame`), session: o['session'] === undefined ? '' : str(o['session'], `${at}.session`), purpose: str(o['purpose'], `${at}.purpose`),
    pixel_hash: o['pixel_hash'] === null ? null : str(o['pixel_hash'], `${at}.pixel_hash`), rung: str(o['rung'], `${at}.rung`),
    internal_scale: num(o['internal_scale'], `${at}.internal_scale`),
    operators: arr(o['operators'], `${at}.operators`).map((p, i) => {
      const q = obj(p, `${at}.operators[${i}]`);
      return { operator: str(q['operator'], `${at}.operators[${i}].operator`), resolution: num(q['resolution'], `${at}.operators[${i}].resolution`) };
    }),
  };
}

/** The view a frame shows for a session, or a failure naming the frame. */
export function viewOf(frame: Frame, session: string): View {
  const v = frame.views.find((x) => x.session === session);
  expect(v, `frame ${frame.frame} has a view of ${session}`).toBeDefined();
  return v!;
}
export const changesOf = (live: Live, session: string): Change[] => live.changes.filter((c) => c.session === session);

// ---------------------------------------------------------------------------------------------------
// The ladder check the planted ladders must fail: each writer's changes against the expected ones, every
// difference a sentence naming the frame and the rung.

export interface Expected { frame: number; from: string | null; to: string; reason: string }
export function ladderProblems(live: Live, expected: Record<string, Expected[]>): string[] {
  const problems: string[] = [];
  for (const [session, want] of Object.entries(expected)) {
    const got = changesOf(live, session);
    const n = Math.max(got.length, want.length);
    for (let i = 0; i < n; i++) {
      const g = got[i];
      const w = want[i];
      if (g && w && g.frame === w.frame && g.from === w.from && g.to === w.to && g.reason === w.reason) continue;
      if (g && w) problems.push(`frame ${g.frame}: ${session} (${g.writer}) moved ${g.from} → ${g.to} (${g.reason}), where frame ${w.frame} should move ${w.from} → ${w.to} (${w.reason})`);
      else if (g) problems.push(`frame ${g.frame}: ${session} (${g.writer}) moved ${g.from} → ${g.to} (${g.reason}), a change that shouldn't happen`);
      else problems.push(`frame ${w!.frame}: ${session} should move ${w!.from} → ${w!.to} (${w!.reason}) and didn't`);
      break;
    }
  }
  return problems;
}

/** Every frame from `from` to `to` draws `session` at `rung`, as the frames report: failures name the frame and rung. */
export function rungProblems(live: Live, session: string, from: number, to: number, rung: string): string[] {
  const out: string[] = [];
  for (const f of live.frames.filter((x) => x.frame >= from && x.frame <= to)) {
    const v = f.views.find((x) => x.session === session);
    if (!v) out.push(`frame ${f.frame}: no view of ${session}`);
    else if (v.rung !== rung) out.push(`frame ${f.frame}: ${session} drew at ${v.rung}, not ${rung}`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Pass intervals (Meter and degrade ladder): a frame's GPU time is the time its passes cover; each pass is
// charged only the part of its interval after every earlier pass's interval ends.

/** The length of the union of the intervals, in the intervals' unit. */
export function covered(intervals: [number, number][]): number {
  const s = intervals.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0;
  let end = -Infinity;
  let start = -Infinity;
  for (const [a, b] of s) {
    if (a > end) { if (end > start) total += end - start; start = a; end = b; } else end = Math.max(end, b);
  }
  if (end > start) total += end - start;
  return total;
}
/** Each pass's charge, in the passes' order: the part of its interval after every earlier pass's interval ends. */
export function charges(intervals: [number, number][]): number[] {
  let latest = -Infinity;
  return intervals.map(([a, b]) => {
    const charge = Math.max(0, b - Math.max(a, latest));
    latest = Math.max(latest, b);
    return charge;
  });
}

/** Frames whose `gpu_ms` isn't the time their passes cover, or whose passes' charges break the rule: one sentence each. */
export function passProblems(frames: Frame[], toleranceMs: number): string[] {
  const out: string[] = [];
  for (const f of frames) {
    const passes = f.passes ?? [];
    if (!passes.length) { out.push(`frame ${f.frame}: no passes reported`); continue; }
    const iv = passes.map((p): [number, number] => [p.start_ns / 1e6, p.end_ns / 1e6]);
    const union = covered(iv);
    if (Math.abs(f.gpu_ms - union) > toleranceMs) out.push(`frame ${f.frame}: gpu_ms ${f.gpu_ms} isn't the ${union.toFixed(4)} ms its passes cover (their intervals sum to ${iv.reduce((s, [a, b]) => s + b - a, 0).toFixed(4)} ms)`);
    const want = charges(iv);
    passes.forEach((p, i) => {
      if (Math.abs(p.charged_ms - want[i]!) > toleranceMs) out.push(`frame ${f.frame}: pass ${p.name} is charged ${p.charged_ms} ms, not the ${want[i]!.toFixed(4)} ms after earlier passes end`);
      if (p.shares) {
        const total = p.shares.reduce((s, x) => s + x.share, 0);
        if (Math.abs(total - 1) > 1e-6) out.push(`frame ${f.frame}: pass ${p.name}'s shares sum to ${total}`);
        for (const s of p.shares) if (Math.abs(s.charged_ms - p.charged_ms * s.share) > toleranceMs) out.push(`frame ${f.frame}: pass ${p.name} charges ${s.writer} ${s.charged_ms} ms, not ${p.charged_ms} × ${s.share}`);
      }
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// deep-show (#393's scenario binary): one scenario, accepted, with one reply per call.

export function showRun(bin: string, scenario: JsonObject): JsonObject[] {
  const s = start(bin, ['run'], [scenario], 1_800_000);
  expect(s.timedOut, `${SHOW_BIN} run finished within its timeout`).toBe(false);
  expect(s.status, `${SHOW_BIN} run exited 0 (${s.signal ?? 'no signal'}); stderr: ${s.stderr.slice(-3000)}`).toBe(0);
  expect(s.lines.length, `${SHOW_BIN} run: one output line per input line`).toBe(1);
  const answer = obj(s.lines[0], `${SHOW_BIN} run: the answer`);
  expect(answer['ok'], `${SHOW_BIN} run refused the scenario: ${JSON.stringify(answer).slice(0, 2000)}`).toBe(true);
  const replies = arr(answer['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(arr(scenario['calls'], 'the scenario\'s calls').length);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// Statistics.

export function p95(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]!;
}
