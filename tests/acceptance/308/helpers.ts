// Test-side tools for the #308 acceptance tests: the `deep-canvas input` subcommand (README: The surface under
// test), `deep-show run` built per Cargo feature set (the `registries`, `schedule`, `kit`, `packs`, `present` and
// `eval` calls and the seal's startup refusal, as #200's and #185's suites drive them), the documents the tests
// send, the f64 reference math the expected values come from (the issue's numbers), and the reference-Mac gate
// with the design's judge for timing results. Nothing here stands in for the input module: every value a test
// compares comes from a binary; every expected value from the issue's text, computed here in f64.

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect, type TestContext } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/308 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const FIXTURES = join(HERE, 'fixtures');
export const CANVAS_NAME = 'deep-canvas';
export const SHOW_NAME = 'deep-show';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** Builds stay light on the shared Mac: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV: NodeJS.ProcessEnv = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
/** A seal that refuses a build exits with this status, after one JSON line (#305). */
export const REFUSED_EXIT = 2;
export const DIGEST = /^(d1:)?[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------------------------------
// Time (Time and the flick)

/** Flicks in one second. */
export const FLICKS = 705_600_000;
/** Seconds to whole flicks (exact for the decimal seconds the tests write). */
export const fl = (s: number): number => Math.round(s * FLICKS);
export const secs = (flicks: number): number => flicks / FLICKS;
/** A seeded generator (mulberry32), so a failing run replays. */
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
/** A seeded shuffle of a copy of `xs`. */
export function shuffled<T>(xs: readonly T[], seed: number): T[] {
  const rand = seeded(seed);
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
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
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
export function strs(value: JsonValue | undefined, what: string): string[] {
  return arr(value, what).map((v, i) => str(v, `${what}[${i}]`));
}
export const show = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
/** Whether a value's JSON text holds `needle` (an ID, a name, a code). */
export const mentions = (value: JsonValue | undefined, needle: string): boolean => (JSON.stringify(value) ?? '').includes(needle);
/** One canonical text per JSON value (keys sorted at every depth). */
export function canon(value: JsonValue | undefined): string {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canon(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** A check that must fail on a planted program: at least one failure, and one naming each of `named`. */
export function failsNaming(failures: readonly string[], named: readonly string[], what: string): void {
  expect(failures.length, `${what}: the planted program passes the check it must fail`).toBeGreaterThan(0);
  for (const n of named) expect(failures.some((f) => f.includes(n)), `${what}: a failure names ${n}; the failures: ${failures.slice(0, 8).join(' | ')}`).toBe(true);
}
export const near = (got: number, want: number, tol = 1e-9): boolean => Math.abs(got - want) <= tol;

// ---------------------------------------------------------------------------------------------------
// Builds: `deep-canvas` once per file; `deep-show` once per feature set per file, each copied under its own name.

function cargo(args: string[], cwd = REPO, env: NodeJS.ProcessEnv = {}): string {
  const run = spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV, ...env } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  return run.status === 0 ? '' : `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n')}`;
}

/** `cargo build --locked -p deep-canvas --bin deep-canvas`, once per file; fails each test that asks for the binary when it can't be built. */
export function useCanvas(): { bin: () => string } {
  let error = '';
  beforeAll(() => { error = cargo(['build', '--locked', '-p', 'deep-canvas', '--bin', CANVAS_NAME]); }, 7_200_000);
  return { bin: () => { expect(error, `the binary builds: cargo build --locked -p deep-canvas --bin ${CANVAS_NAME}`).toBe(''); return join(TARGET, 'debug', exe(CANVAS_NAME)); } };
}

/** `deep-show` is built `--no-default-features --features <set>[,<with>…]`. */
export interface Build { set: 'full'; with?: string[] }
export const featuresOf = (b: Build): string[] => [b.set, ...(b.with ?? [])];
export const buildName = (b: Build): string => featuresOf(b).join('+');
export interface Builds { bin: (build: Build) => string }
export function useBuilds(builds: readonly Build[]): Builds {
  let dir = '';
  const made = new Map<string, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-308-bins-'));
    for (const b of builds) {
      const name = buildName(b);
      if (made.has(name)) continue;
      const bin = join(dir, `${SHOW_NAME}-${name.replace(/[^a-z0-9+.-]/g, '_')}`);
      const error = cargo(['build', '--locked', '--bin', SHOW_NAME, '--no-default-features', '--features', featuresOf(b).join(',')]);
      if (error === '') copyFileSync(join(TARGET, 'debug', exe(SHOW_NAME)), bin);
      made.set(name, { bin, error });
    }
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(b: Build): string {
      const entry = made.get(buildName(b));
      if (!entry) throw Error(`the file didn't list the build ${buildName(b)} in useBuilds`);
      expect(entry.error, `the binary builds: ${SHOW_NAME} with features ${featuresOf(b).join(',')}`).toBe('');
      return entry.bin;
    },
  };
}

export interface Started { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }
export function start(bin: string, args: string[], inputs: JsonValue[], timeoutMs = 1_800_000): Started {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const run = spawnSync(bin, args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${bin} ${args.join(' ')}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  const lines = stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  return { status: run.status, signal: run.signal, timedOut, lines, stdout, stderr: run.stderr ?? '' };
}

// ---------------------------------------------------------------------------------------------------
// The `deep-canvas input` surface (README: `input`)

export type Mods = ('shift' | 'cmd' | 'alt' | 'ctrl')[];
export type Op = JsonObject;
export interface InputLine {
  doc: JsonObject;
  viewport?: [number, number];
  fps?: [number, number];
  host?: 'app' | 'web_player';
  reduced_motion?: boolean;
  planted?: string;
  fill?: { control: string; count: number };
  summary?: boolean;
  ops: Op[];
}
export interface Entry {
  t: number; seq: number; control: string; value: JsonValue; writer: string; serial: number | undefined;
  samples: { t: number; value: JsonValue; at: [number, number] | undefined }[] | undefined; raw: JsonObject;
}
export interface Result { raw: JsonObject; value: JsonValue | undefined; count: number | undefined; appended: number; dropped: number }
export interface Ran { hash: string; fork_at: number | null; track: Entry[]; entries: number; results: Result[]; raw: JsonObject }

function entryOf(v: JsonValue, what: string): Entry {
  const o = obj(v, what);
  const samples = o['samples'] === undefined ? undefined : arr(o['samples'], `${what}.samples`).map((s, i) => {
    const so = obj(s, `${what}.samples[${i}]`);
    const at = Array.isArray(so['at']) ? ([num(so['at'][0], `${what}.samples[${i}].at[0]`), num(so['at'][1], `${what}.samples[${i}].at[1]`)] as [number, number]) : undefined;
    return { t: num(so['t'], `${what}.samples[${i}].t`), value: so['value'] ?? null, at };
  });
  return {
    t: num(o['t'], `${what}.t`), seq: num(o['seq'], `${what}.seq`), control: str(o['control'], `${what}.control`), value: o['value'] ?? null,
    writer: str(o['writer'], `${what}.writer`), serial: typeof o['serial'] === 'number' ? o['serial'] : undefined, samples, raw: o,
  };
}

/** `deep-canvas input`: one answer per line, in order; the run exits 0 with one line out per line in. Each answer is accepted. */
export function inputRuns(bin: string, lines: InputLine[]): Ran[] {
  const s = start(bin, ['input'], lines as unknown as JsonValue[]);
  expect(s.timedOut, `${CANVAS_NAME} input finished within its timeout`).toBe(false);
  expect(s.status, `${CANVAS_NAME} input exits 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 600)}; stderr: ${s.stderr.slice(-800)}`).toBe(0);
  expect(s.lines.length, `${CANVAS_NAME} input: one output line per input line; stdout: ${s.stdout.slice(0, 600)}`).toBe(lines.length);
  return s.lines.map((l, i) => {
    const o = obj(l, `input answer ${i}`);
    expect(o['ok'], `input line ${i} is accepted: ${show(o)}`).toBe(true);
    const results = arr(o['results'], `input answer ${i}: results`).map((r, k): Result => {
      const ro = obj(r, `input answer ${i}: results[${k}]`);
      return { raw: ro, value: ro['value'], count: typeof ro['count'] === 'number' ? ro['count'] : undefined, appended: typeof ro['appended'] === 'number' ? ro['appended'] : 0, dropped: typeof ro['dropped'] === 'number' ? ro['dropped'] : 0 };
    });
    expect(results.length, `input answer ${i}: one result per op`).toBe(lines[i]!.ops.length);
    const track = lines[i]!.summary ? [] : arr(o['track'], `input answer ${i}: track`).map((e, k) => entryOf(e, `input answer ${i}: track[${k}]`));
    return {
      hash: str(o['hash'], `input answer ${i}: hash`), fork_at: typeof o['fork_at'] === 'number' ? o['fork_at'] : null, track,
      entries: lines[i]!.summary ? num(o['entries'], `input answer ${i}: entries`) : track.length, results, raw: o,
    };
  });
}
export const inputRun = (bin: string, line: InputLine): Ran => inputRuns(bin, [line])[0]!;
/** A planted program's answer: null where it refuses or crashes (the criterion's check then fails on that). */
export function inputPlanted(bin: string, line: InputLine): Ran | null {
  const s = start(bin, ['input'], [line as unknown as JsonValue]);
  if (s.timedOut || s.status !== 0 || s.lines.length !== 1 || !isObject(s.lines[0]) || s.lines[0]['ok'] !== true) return null;
  return inputRuns(bin, [line])[0]!;
}

export const FPS: [number, number][] = [[30, 1], [60, 1], [120, 1]];

// ---------------------------------------------------------------------------------------------------
// Ops as the tests write them. Pointer coordinates are viewport px (1 px = 1 u in every fixture), t in flicks.

export const down = (x: number, y: number, t: number, mods: Mods = []): Op => ({ op: 'pointer', phase: 'down', at: [x, y], t: fl(t), mods });
export const move = (x: number, y: number, t: number, mods: Mods = []): Op => ({ op: 'pointer', phase: 'move', at: [x, y], t: fl(t), mods });
export const up = (x: number, y: number, t: number, mods: Mods = []): Op => ({ op: 'pointer', phase: 'up', at: [x, y], t: fl(t), mods });
export const key = (control: string, k: string, t: number, mods: Mods = [], extra: JsonObject = {}): Op => ({ op: 'key', control, key: k, t: fl(t), mods, ...extra });
export const setControl = (control: string, value: JsonValue, t: number): Op => ({ op: 'control', control, value, t: fl(t) });
export const tool = (control: string, value: JsonValue, t: number): Op => ({ op: 'tool', control, value, t: fl(t) });
export const seek = (t: number): Op => ({ op: 'seek', t: fl(t) });
export const advance = (t: number): Op => ({ op: 'advance', t: fl(t) });
export const read = (control: string, t: number, mode?: 'live' | 'golden' | 'export'): Op => ({ op: 'read', control, t: fl(t), ...(mode ? { mode } : {}) });
export const readChannel = (channel: string, t: number): Op => ({ op: 'read', channel, t: fl(t) });
export const panCamera = (dx: number, dy: number, t: number): Op => ({ op: 'drag', at: [10, 10], delta: [dx, dy], t: fl(t) });

/** A drag on the slider `gain` (handle centre at px(0.5)): the pointer events, their times and their px offsets from the press. */
export function dragOps(x0: number, y: number, t0: number, steps: { dx: number; dt: number; mods?: Mods }[]): Op[] {
  const ops: Op[] = [down(x0, y, t0)];
  let t = t0;
  let last = steps[steps.length - 1];
  for (const s of steps) { t += s.dt; ops.push(move(x0 + s.dx, y, t, s.mods ?? [])); last = s; }
  ops.push(up(x0 + (last?.dx ?? 0), y, t + 0.001, last?.mods ?? []));
  return ops;
}

export const valueOf = (r: Result, what: string): number => num(r.value, `${what}: value`);

// ---------------------------------------------------------------------------------------------------
// Documents (README: Documents)

/** The slider's geometry: a 200 px track from (100, 180) to (300, 180); the knob's centre is px(value). */
export const TRACK = { x0: 100, y: 180, travel: 200 } as const;
export const px = (v: number): number => TRACK.x0 + TRACK.travel * v;
/** The second slider `other`, on its own track (y 260), which a tour never keys. */
export const TRACK2 = { x0: 100, y: 260, travel: 200 } as const;
/** The drag_along rail: a polyline of 350 u (200 right, then 150 down); its value is the fraction of arc length. */
export const RAIL: [number, number][] = [[100, 100], [300, 100], [300, 250]];
export function railAt(v: number): [number, number] {
  const total = 350; let d = Math.min(Math.max(v, 0), 1) * total;
  for (let i = 0; i + 1 < RAIL.length; i++) {
    const a = RAIL[i]!; const b = RAIL[i + 1]!; const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d <= len + 1e-12) return [a[0] + ((b[0] - a[0]) * d) / len, a[1] + ((b[1] - a[1]) * d) / len];
    d -= len;
  }
  return [...RAIL[RAIL.length - 1]!] as [number, number];
}
/** Distance from (x, y) to the rail. */
export function railDistance(x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < RAIL.length; i++) {
    const a = RAIL[i]!; const b = RAIL[i + 1]!;
    const dx = b[0] - a[0]; const dy = b[1] - a[1];
    const u = Math.min(1, Math.max(0, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(x - (a[0] + u * dx), y - (a[1] + u * dy)));
  }
  return best;
}

const LAYER = 'main';
export function rectItem(id: string, name: string, order: string, x: number, y: number, w: number, h: number): JsonObject {
  return { id, kind: 'test.rect@1', layer: LAYER, name, order, params: { w, h, fill: [255, 255, 255] }, at: { pos: [x, y, 0] } };
}
const CAMERA: JsonObject = {
  id: 'cam', kind: 'camera@1', layer: LAYER, name: 'Camera', order: 'a0',
  params: { projection: 'orthographic', target: [320, 180, 0], view_width: 640, user: { zoom: [0.5, 4], zoom_rate: 0.005, pan: { bounds: 'none' } } },
};
/** The knobs: 20 × 20 u, centred on (100, 180) and (100, 260) at their controls' range minimum. */
export const KNOB = rectItem('knob', 'Knob', 'a1', 90, 170, 20, 20);
export const KNOB2 = rectItem('knob2', 'Second knob', 'a2', 90, 250, 20, 20);
export const BEAD = rectItem('bead', 'Bead', 'a3', 95, 95, 10, 10);
export const NEEDLE = rectItem('needle', 'Needle', 'a4', 40, 40, 20, 20);
export const CARD = rectItem('card', 'Card', 'a5', 300, 100, 120, 80);

/** A 640 × 360 board whose camera is the frame: 1 px is 1 u, so a pointer's px are the document's u. */
export function doc(tag: string, items: JsonObject[], controls: JsonObject, extra: JsonObject = {}): JsonObject {
  return {
    format: 1, id: `doc-308-${tag}`, profile: 'board', title: `#308 ${tag}`, description: `The #308 acceptance tests' document ${tag}.`, size: [640, 360], camera: 'cam',
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    controls,
    items: Object.fromEntries([CAMERA, ...items].map((i) => [String(i['id']), i])),
    ...extra,
  };
}
export const slider = (id: string, knob: string, track: { x0: number; y: number; travel: number }, extra: JsonObject = {}): JsonObject => ({
  kind: 'slider', class: 'document', label: id, role: 'slider', range: [0, 1], default: 0.5,
  handle: { item: knob, along: 'x', travel: track.travel, drag: 'along' }, ...extra,
});
export const GAIN: JsonObject = slider('Gain', 'knob', TRACK);
export const OTHER: JsonObject = slider('Other', 'knob2', TRACK2);
export const RAIL_CONTROL: JsonObject = {
  kind: 'drag_along', class: 'document', label: 'Rail', role: 'slider', range: [0, 1], default: 0,
  handle: { item: 'bead', along: { polyline: RAIL }, drag: 'along' },
};
export const MODE: JsonObject = {
  kind: 'stages', class: 'document', label: 'Mode', role: 'tablist', default: 'a',
  stages: { a: { label: 'A', keys: ['1'] }, b: { label: 'B', keys: ['2'] }, c: { label: 'C', keys: ['3'] } },
};
/** Seconds to a flick as the transition's span number the follow model writes (seconds as numbers). */
export const hoverControl = (smoothing: JsonValue): JsonObject => ({
  kind: 'hover', class: 'view', label: 'Card hover', role: 'group', range: [0, 10], default: 0, targets: { over: 'card' }, smoothing,
});
export const TRANSITION_03_OUT_CUBIC: JsonValue = { follow: { transition: { span: 0.3, interp: { ease: { name: 'out_cubic' } } } } };

/** Penner's out_cubic. */
export const outCubic = (u: number): number => 1 - (1 - u) ** 3;

// ---------------------------------------------------------------------------------------------------
// deep-show run: the sealed set's calls (#200's `registries`, #185's `schedule`, #138's `kit`, #306's packs)

export const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: input', process: { pid: 4100, start: 1_000 } };
export const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
export const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
export const DOC_A = '01JB308D00000000000000000A';

export function useEvidence(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-308-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}
export interface PackFixture { id: string; version: string; dir: string }
export const DIALPACK: PackFixture = { id: 'test/dialpack', version: '1.0.0', dir: join(FIXTURES, 'packs', 'dialpack-1.0.0') };
export const packAt = (p: PackFixture): string => `${p.id}@${p.version}`;

export function scenario(evidence: string, calls: JsonObject[], extra: { packs?: readonly PackFixture[] } = {}): JsonObject {
  return {
    evidence, sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } }, processes: PROCESSES,
    panels: { main: { rect: [0, 0, 800, 600] } }, docs: { [DOC_A]: { panel: 'main' } },
    ...(extra.packs ? { packs: extra.packs.map((p) => ({ id: p.id, dir: p.dir })) } : {}), calls,
  };
}
/** `deep-show run [--planted <name>]`: one scenario, accepted, with one reply per call. */
export function run(bin: string, sc: JsonObject, planted?: string): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const s = start(bin, args, [sc]);
  expect(s.timedOut, `${SHOW_NAME} ${args.join(' ')} finished within its timeout`).toBe(false);
  expect(s.status, `${SHOW_NAME} ${args.join(' ')} starts and exits 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-1500)}`).toBe(0);
  expect(s.lines.length, `${SHOW_NAME} run: one output line per input line`).toBe(1);
  const out = obj(s.lines[0], `${SHOW_NAME} run: the answer`);
  expect(out['ok'], `${SHOW_NAME} run refused the scenario: ${show(out)}`).toBe(true);
  const replies = arr(out['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(arr(sc['calls'], 'the scenario\'s calls').length);
  return replies;
}
/** One startup and a `registry` call: the seal took the set (exit 0) or refused it (exit 2, one line). */
export function startup(bin: string, planted?: string): Started {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const s = start(bin, args, [{ evidence: tmpdir(), calls: [{ call: 'registry' }] }]);
  expect(s.timedOut, `${SHOW_NAME} ${args.join(' ')} finished within its timeout`).toBe(false);
  return s;
}
export interface Refusal { reason: string; modules: string[]; registry: string | undefined; entries: JsonValue[]; rules: string[]; raw: JsonObject }
export function refusalOf(s: Started): Refusal | string {
  if (s.status !== REFUSED_EXIT) return `the startup exited ${s.status} (${s.signal ?? 'no signal'}), not ${REFUSED_EXIT} with the seal's refusal; stdout: ${s.stdout.slice(0, 600)}`;
  if (s.lines.length !== 1 || !isObject(s.lines[0])) return `the refusal is not one JSON line: ${s.stdout.slice(0, 600)}`;
  const raw = s.lines[0];
  if (raw['ok'] !== false || raw['code'] !== 'seal_refused') return `the line is not the seal's refusal: ${show(raw)}`;
  return {
    reason: typeof raw['reason'] === 'string' ? raw['reason'] : '', modules: Array.isArray(raw['modules']) ? raw['modules'].map(String) : [],
    registry: typeof raw['registry'] === 'string' ? raw['registry'] : undefined, entries: Array.isArray(raw['entries']) ? raw['entries'] : [],
    rules: Array.isArray(raw['rules']) ? raw['rules'].map(String) : [], raw,
  };
}
export interface Expected { reasons?: string[]; registry?: string; entries?: string[]; rules?: string[] }
/** The seal refused the build as the criterion says: `registry`, each of `entries` named (a kind or a control), each of `rules` (the kit part). */
export function refusalFailures(s: Started, want: Expected): string[] {
  const r = refusalOf(s);
  if (typeof r === 'string') return [`${want.entries?.join(', ') ?? 'the build'}: ${r}`];
  const failures: string[] = [];
  if (want.reasons && !want.reasons.includes(r.reason)) failures.push(`the refusal's reason is ${r.reason}, not ${want.reasons.join(' or ')}: ${show(r.raw)}`);
  if (want.registry !== undefined && r.registry !== want.registry) failures.push(`the refusal names the registry ${r.registry ?? 'none'}, not ${want.registry}: ${show(r.raw)}`);
  for (const e of want.entries ?? []) if (!mentions(r.entries, e)) failures.push(`the refusal doesn't name the entry ${e}: ${show(r.raw)}`);
  for (const rule of want.rules ?? []) if (!r.rules.includes(rule)) failures.push(`the refusal doesn't name the kit part ${rule}: ${show(r.raw)}`);
  return failures;
}
export function sealFailures(s: Started, what: string): string[] {
  return s.status === 0 ? [] : [`${what} did not seal: exit ${s.status}; ${s.stdout.slice(0, 800)} ${s.stderr.slice(-400)}`];
}

export interface KitRule { rule: string; verdict: string; message: string }
export interface KitResult { verdict: string; rules: KitRule[]; raw: JsonObject }
export function kitResult(v: JsonValue | undefined, what: string): KitResult {
  const o = obj(v, what);
  const rules = arr(o['rules'] ?? [], `${what}.rules`).map((r, i) => {
    const ro = obj(r, `${what}.rules[${i}]`);
    return { rule: str(ro['rule'], `${what}.rules[${i}].rule`), verdict: str(ro['verdict'], `${what}.rules[${i}].verdict`), message: typeof ro['message'] === 'string' ? ro['message'] : '' };
  });
  return { verdict: str(o['verdict'], `${what}.verdict`), rules, raw: o };
}
export interface RegEntry { name: string; origin: string; module: string | undefined; value: JsonObject; kit: KitResult; raw: JsonObject }
export interface RegPlanted { name: string; result: KitResult; raw: JsonObject }
export interface RegListed { name: string; owner: string; fill: string[]; resolve: string; kit: string[]; planted: RegPlanted[]; entries: RegEntry[]; raw: JsonObject }
/** The listing `deep://registries/<core version>` (#200) of `name`: its contract fields, entries and planted entries. */
export function listedRegistry(reply: JsonObject, name: string): RegListed {
  const uri = str(reply['uri'], 'registries: uri');
  expect(uri, 'registries: published at deep://registries/<core version>').toMatch(/^deep:\/\/registries\/.+/);
  const row = arr(reply['registries'], 'registries: registries').map((v, i) => obj(v, `registries[${i}]`)).find((o) => o['kind'] === 'registry' && o['name'] === name);
  expect(row, `deep://registries lists the registry ${name}`).toBeDefined();
  const o = row!;
  return {
    name, owner: str(o['owner'], `${name}.owner`), fill: strs(o['fill'], `${name}.fill`), resolve: str(o['resolve'], `${name}.resolve`),
    kit: arr(o['kit'], `${name}.kit`).map((r, i) => str(obj(r, `${name}.kit[${i}]`)['rule'], `${name}.kit[${i}].rule`)),
    planted: arr(o['planted'], `${name}.planted`).map((p, i) => { const po = obj(p, `${name}.planted[${i}]`); return { name: str(po['name'], `${name}.planted[${i}].name`), result: kitResult(po['result'], `${name}.planted[${i}].result`), raw: po }; }),
    entries: arr(o['entries'], `${name}.entries`).map((e, i) => {
      const eo = obj(e, `${name}.entries[${i}]`);
      return { name: str(eo['name'], `${name}.entries[${i}].name`), origin: str(eo['origin'], `${name}.entries[${i}].origin`), module: typeof eo['module'] === 'string' ? eo['module'] : undefined, value: isObject(eo['value']) ? eo['value'] : {}, kit: kitResult(eo['kit'], `${name}.entries[${i}].kit`), raw: eo };
    }),
    raw: o,
  };
}
export const REGISTRIES: JsonObject = { call: 'registries' };
export const PACKS: JsonObject = { call: 'packs' };
export const installPackCall = (p: PackFixture): JsonObject => ({ call: 'install_pack', id: p.id, dir: p.dir });
export const kitCall = (modules: string[]): JsonObject => ({ call: 'kit', modules, sequences: 100, param_sets: 50 });
export interface KitPart { part: string; verdict: string; failures: JsonObject[] }
export function kitModule(reply: JsonObject, name: string): { verdict: string; parts: KitPart[]; failures: JsonObject[] } {
  const m = arr(reply['modules'], 'kit: modules').map((x, i) => obj(x, `kit: modules[${i}]`)).find((x) => x['module'] === name);
  expect(m, `the kit's report holds module ${name}`).toBeDefined();
  const failures = (v: JsonValue | undefined, w: string): JsonObject[] => arr(v ?? [], w).map((f, j) => obj(f, `${w}[${j}]`));
  const parts = arr(m!['parts'], `${name}.parts`).map((p, j) => {
    const po = obj(p, `${name}.parts[${j}]`);
    const part = str(po['part'], `${name}.parts[${j}].part`);
    const cases = arr(po['cases'] ?? [], `${name}.${part}.cases`).flatMap((c) => (isObject(c) && isObject(c['failure']) ? [c['failure']] : []));
    return { part, verdict: str(po['verdict'], `${name}.parts[${j}].verdict`), failures: [...failures(po['failures'], `${name}.${part}.failures`), ...cases] };
  });
  return { verdict: str(m!['verdict'], `${name}.verdict`), parts, failures: failures(m!['failures'], `${name}.failures`) };
}

/** A document as your shell sends it (`deep show`): a film of one rectangle, with the given `controls` if any. */
export function showDoc(tag: string, controls?: JsonObject): JsonObject {
  return {
    format: 1, profile: 'film', title: `#308 ${tag}`, description: `The #308 acceptance tests' film ${tag}.`, size: [640, 360], transport: { span: '6s' },
    ...(controls ? { controls } : {}),
    items: { box: { id: 'box', kind: 'rect@1', name: 'Box', order: 'a0', params: { box: [0, 0, 20, 20], paint: { fill: { role: 'muted' } } }, at: { pos: [40, 40, 0] } } },
  };
}
export const present = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep show', peer: YOU_PEER, doc, document, include: ['issues'] });
export const evalCall = (doc: string, t = 0): JsonObject => ({ call: 'eval', doc, t });

// ---------------------------------------------------------------------------------------------------
// The reference-Mac gate and the design's judge for timing results (as tests/acceptance/200 and 185).

const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why a timing here would be a reading, not a budget result; null on a reference Mac fit to judge. Mains power never gates. */
export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, power: string, therm: string;
  try {
    model = sh('sysctl', '-n', 'hw.model'); chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30); power = sh('pmset', '-g'); therm = sh('pmset', '-g', 'therm');
  } catch (e) { return `cannot read the machine: ${(e as Error).message}`; }
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  const [one] = loadavg();
  if (one! > availableParallelism()) return `loaded past its core count: 1-minute load ${one!.toFixed(1)} on ${availableParallelism()} cores`;
  return null;
}
export type Judged = { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; shown: string };
/** The design's rule on five runs: PASS all within the limit, FAIL all over it by more than the margin (the larger of 5% and their spread), else INCONCLUSIVE. */
export function judgeRuns(name: string, runs: number[], limit: number): Judged {
  const margin = Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9));
  const text = `${name}: ${runs.map((r) => r.toFixed(4)).join(', ')} against ${limit.toFixed(4)} (margin ${(margin * 100).toFixed(0)}%)`;
  if (runs.length !== 5) return { status: 'INCONCLUSIVE', shown: `${text}: not five runs` };
  if (runs.every((r) => r <= limit)) return { status: 'PASS', shown: text };
  if (runs.every((r) => r > limit * (1 + margin))) return { status: 'FAIL', shown: text };
  return { status: 'INCONCLUSIVE', shown: text };
}
export const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
export { type TestContext };
