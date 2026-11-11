// Test-side tools for the blind redraft of #504's criterion 1 (README): `deep-show` built once per file
// (`--no-default-features --features full`) and driven by one JSON scenario per `deep-show run` (#393), in which the
// working agent shows the projectile board through `deep_show`, the board's frames are evaluated through `eval` (#387,
// with #493's film block) and its values are read through `deep_query` (#411), each with the board's input track; the
// board itself, written here as data; its input track; and the closed form of a projectile, which every expected value
// comes from. Nothing here stands in for the canvas: every value a test compares comes from the binary.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/504-redraft-ac1 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const SHOW = 'deep-show';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** rustup's cargo on this Mac (Homebrew's rustup keeps it off the default PATH). */
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
/** Builds stay light: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` } : {}),
};
const MIB = 1024 * 1024;
/** Every `it` and the build pass this timeout: a first build of `deep-show` takes many minutes on a loaded machine. */
export const TIMEOUT = 3_600_000;

/** Criterion 1's ID: `#504.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
export const AC1 = '#504.2171aba8';

// ---------------------------------------------------------------------------------------------------
// JSON and failure rules

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const brief = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${brief(v)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${brief(v)}`).toBe(true);
  return v as JsonValue[];
}
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** A planted program's run: the test's own check must fail on it, and some failure must name `named`. */
export function failsNaming(failures: readonly string[], named: RegExp, what: string): void {
  expect(failures.length, `${what}: the check passes the planted program it must fail`).toBeGreaterThan(0);
  expect(failures.some((f) => named.test(f)), `${what}: a failure names ${named}; the failures:\n  ${failures.slice(0, 12).join('\n  ')}`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// Time (Time and the flick: 705,600,000 flicks a second)

export const FLICKS = 705_600_000;
/** Seconds as whole flicks (every time here is a whole number of flicks). */
export const fl = (s: number): number => Math.round(s * FLICKS);

// ---------------------------------------------------------------------------------------------------
// The build: `deep-show` with the `full` set, once per file, copied out of target/.

const ARGS = ['build', '--locked', '--bin', SHOW, '--no-default-features', '--features', 'full'];

/** The file's build (in beforeAll) and a fresh evidence folder per run, all deleted after the file. */
export function useShow(): { bin: () => string; folder: () => string } {
  let dir = '';
  let bin = '';
  let error = 'not built';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-504-ac1-'));
    const r = spawnSync('cargo', ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * MIB, env: { ...process.env, ...CARGO_ENV } });
    if (r.error) {
      error = `cargo could not run: ${r.error.message}`;
    } else if (r.status !== 0) {
      const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Updating|Locking/.test(l));
      error = `cargo ${ARGS.join(' ')} failed:\n${lines.join('\n').slice(-4000)}`;
    } else {
      bin = join(dir, exe(SHOW));
      copyFileSync(join(TARGET, 'debug', exe(SHOW)), bin);
      error = '';
    }
  }, TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin: () => { expect(error, `the binary builds: cargo ${ARGS.join(' ')}`).toBe(''); return bin; },
    folder: () => mkdtempSync(join(dir, 'evidence-')),
  };
}

// ---------------------------------------------------------------------------------------------------
// The projectile board (README: The board): a 2D figure, 1200 × 675 u, the ground's top at y = 600 u, y down, 10 u
// to the metre, the launch point at (100, 600) u.

export const SIZE: [number, number] = [1200, 675];
/** Standard gravity, m/s². */
export const G = 9.80665;
/** u per metre. */
export const SCALE = 10;
/** Where the ball leaves from, u. */
export const LAUNCH: [number, number] = [100, 600];

export type Stage = 'launch' | 'top' | 'landing';
/** Each stage's moment of the flight, as a share of the flight's time, which the stage sets as `data/phase`. */
const PHASE: Record<Stage, number> = { launch: 0, top: 0.5, landing: 1 };
/** Each stage's shot: an explicit pose of the camera `cam`, its target in u. */
export const SHOTS: Record<Stage, { id: string; target: [number, number, number] }> = {
  launch: { id: 'launch-shot', target: [200, 500, 0] },
  top: { id: 'top-shot', target: [450, 350, 0] },
  landing: { id: 'landing-shot', target: [700, 500, 0] },
};
export const SLIDERS = { angle: { range: [15, 75], default: 45 }, speed: { range: [5, 30], default: 20 } } as const;
export const DEFAULT_STAGE: Stage = 'launch';
/** The readout's template: the two sliders' values, then the distance and height the drivers compute, in metres. */
const TEMPLATE = 'Angle {controls/angle/value} deg, speed {controls/speed/value} m/s, distance {data/x} m, height {data/y} m';
/** What the readout shows, in order (README: Readings). */
export const READOUT_NUMBERS = ['angle', 'speed', 'distance', 'height'] as const;

/**
 * The board as the agent writes it: an orthographic camera, the ground, the ball and the readout; two document-class
 * sliders and a stages control whose stages each set the flight's moment and name their shot; four drivers that
 * compute the ball's flight in closed form from the sliders, the moment and g, and move the ball by it. No logic
 * item, no world, no pack: nothing in it is code.
 */
export function board(): JsonObject {
  const flightVars = { a: 'controls/angle/value', v: 'controls/speed/value', p: 'data/phase', g: 'data/g' };
  const stage = (s: Stage, label: string): JsonObject => ({ label, shot: SHOTS[s].id, set: { 'data/phase': PHASE[s] } });
  const shot = (s: Stage): JsonObject => ({ camera: 'cam', move: 'hold', target: [...SHOTS[s].target] });
  return {
    format: 1, profile: 'figure', title: 'Projectile board',
    description: 'A ball launched at the angle and speed two sliders set, with launch, top and landing stages and a readout of the values that move it.',
    size: [...SIZE], camera: 'cam', transport: { span: '10s' },
    data: {
      g: { value: G, source: 'story' },
      scale: { value: SCALE, source: 'story' },
      phase: { value: 0, source: 'story' },
      x: { value: 0, source: 'story' },
      y: { value: 0, source: 'story' },
    },
    items: {
      cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [600, 337.5, 0], view_width: 1200 } },
      ground: { id: 'ground', kind: 'rect@1', name: 'Ground', role: 'decoration', order: 'a1', params: { box: [0, 600, 1200, 75], paint: { fill: { role: 'muted' } } } },
      ball: { id: 'ball', kind: 'circle@1', name: 'Ball', role: 'part', order: 'a2', params: { center: [0, 0], r: 8, paint: { fill: { role: 'accent' } } }, at: { pos: [LAUNCH[0], LAUNCH[1], 0] } },
      readout: { id: 'readout', kind: 'text@1', name: 'Readout', role: 'data', order: 'a3', params: { template: TEMPLATE, size: 18 }, at: { pos: [40, 40, 0] } },
    },
    drivers: {
      'flight-x': { target: 'data/x', expr: '2 * v * v * sin(rad(a)) * cos(rad(a)) * p / g', vars: flightVars, fallback: 0 },
      'flight-y': { target: 'data/y', expr: '2 * v * v * sin(rad(a)) * sin(rad(a)) * p * (1 - p) / g', vars: flightVars, fallback: 0 },
      'ball-x': { target: 'items/ball/at/pos/0', expr: `${LAUNCH[0]} + k * x`, vars: { k: 'data/scale', x: 'data/x' } },
      'ball-y': { target: 'items/ball/at/pos/1', expr: `${LAUNCH[1]} - k * y`, vars: { k: 'data/scale', y: 'data/y' } },
    },
    controls: {
      angle: { kind: 'slider', class: 'document', label: 'Angle', role: 'slider', range: [...SLIDERS.angle.range], default: SLIDERS.angle.default, increment: 1 },
      speed: { kind: 'slider', class: 'document', label: 'Speed', role: 'slider', range: [...SLIDERS.speed.range], default: SLIDERS.speed.default, increment: 0.5 },
      stage: {
        kind: 'stages', class: 'document', label: 'Stage', role: 'radiogroup', default: DEFAULT_STAGE,
        stages: { launch: stage('launch', 'Launch'), top: stage('top', 'Top'), landing: stage('landing', 'Landing') },
      },
    },
    shots: { [SHOTS.launch.id]: shot('launch'), [SHOTS.top.id]: shot('top'), [SHOTS.landing.id]: shot('landing') },
  };
}

// ---------------------------------------------------------------------------------------------------
// The input track (Input track): your entries, each `{t, seq, control, value, writer}`, the same on every call.

interface Entry { s: number; control: 'angle' | 'speed' | 'stage'; value: number | Stage }
const ENTRIES: Entry[] = [
  { s: 1, control: 'stage', value: 'top' },
  { s: 2, control: 'angle', value: 60 },
  { s: 3, control: 'speed', value: 25 },
  { s: 4, control: 'stage', value: 'landing' },
  { s: 6, control: 'stage', value: 'launch' },
];
export const TRACK: JsonValue[] = ENTRIES.map((e) => ({ t: fl(e.s), seq: 0, control: e.control, value: e.value, writer: 'you' }));
/** The glide a stage's shot takes from the pose shown at its entry (Control: "over 0.8 s"). */
export const GLIDE_S = 0.8;

/** Each control's value at `s` seconds: its last entry at or before then, its default before any (Control). */
export function stateAt(s: number): { stage: Stage; angle: number; speed: number } {
  const last = (c: Entry['control']): Entry | undefined => ENTRIES.filter((e) => e.control === c && e.s <= s).at(-1);
  return {
    stage: (last('stage')?.value as Stage | undefined) ?? DEFAULT_STAGE,
    angle: (last('angle')?.value as number | undefined) ?? SLIDERS.angle.default,
    speed: (last('speed')?.value as number | undefined) ?? SLIDERS.speed.default,
  };
}
/** The latest stage entry at or before `s`, with the stage current just before it; `null` before any. */
export function stageChangeAt(s: number): { s: number; from: Stage; to: Stage } | null {
  const e = ENTRIES.filter((x) => x.control === 'stage' && x.s <= s).at(-1);
  return e ? { s: e.s, from: stateAt(e.s - 1e-9).stage, to: e.value as Stage } : null;
}

// ---------------------------------------------------------------------------------------------------
// The closed form: a ball launched from the ground at `angle` degrees and `speed` m/s under g, no drag.

/** Where the ball is at a stage's moment, [distance, height] in m: at launch, at the top of its flight (where its
 * vertical speed is 0) and at landing (where its height is 0 again). */
export function flight(stage: Stage, angle: number, speed: number): [number, number] {
  const th = (angle * Math.PI) / 180;
  const vx = speed * Math.cos(th);
  const vy = speed * Math.sin(th);
  const tau = stage === 'launch' ? 0 : stage === 'top' ? vy / G : (2 * vy) / G;
  return [vx * tau, vy * tau - (G * tau * tau) / 2];
}
/** The ball's position on the board at `s` seconds, u. */
export function ballAt(s: number): [number, number] {
  const st = stateAt(s);
  const [x, y] = flight(st.stage, st.angle, st.speed);
  return [LAUNCH[0] + SCALE * x, LAUNCH[1] - SCALE * y];
}
/** What the readout shows at `s` seconds: the angle, the speed, the distance and the height. */
export function readoutAt(s: number): [number, number, number, number] {
  const st = stateAt(s);
  const [x, y] = flight(st.stage, st.angle, st.speed);
  return [st.angle, st.speed, x, y];
}

// ---------------------------------------------------------------------------------------------------
// The scenario (README: The surface under test)

const ALPHA = { id: 'sess-504', thread: 'thread-504', name: 'Claude Code: projectile board', process: { pid: 4100, start: 1_000 } } as const;
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 }];
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const DOC = ulid('01JB504D', 1);

/** The times the frames are evaluated (`eval`), s: before any entry, mid-glide toward the top, and settled after each change. */
export const EVAL_TIMES = [0.5, 1.4, 1.9, 2.9, 3.9, 4.9, 5.9, 7.9];
/** The times the board's values are read (`deep_query`), s. */
export const QUERY_TIMES = [0.5, 1.9, 2.9, 3.9, 5.9, 7.9];
export const BALL_POS = 'items/ball/at/pos';
export const READOUT_TEXT = 'items/readout/params/text';

/**
 * One process: the agent shows the board; the build's sealed set; the sandbox's counts; the board's frames at each
 * EVAL_TIMES with the film block; the sandbox's counts again; and the board's values at QUERY_TIMES. `eval` and
 * `deep_query` carry the input track. `planted` names a wrong program (README: Planted programs).
 */
export function scenario(evidence: string, planted?: string): JsonObject {
  const evals: JsonObject[] = EVAL_TIMES.map((s) => ({ call: 'eval', doc: DOC, t: fl(s), film: true, track: TRACK }));
  return {
    evidence,
    ...(planted === undefined ? {} : { planted }),
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: { ...ALPHA.process } } },
    processes: PROCESSES,
    panels: { main: { rect: [0, 0, SIZE[0], SIZE[1]] } },
    docs: { [DOC]: { panel: 'main' } },
    calls: [
      { call: 'deep_show', session: ALPHA.id, doc: DOC, document: board(), include: ['issues'] },
      { call: 'registry' },
      { call: 'sandbox' },
      ...evals,
      { call: 'sandbox' },
      { call: 'deep_query', session: ALPHA.id, doc: DOC, paths: [BALL_POS, READOUT_TEXT], at: QUERY_TIMES.map((s) => `${s}s`), track: TRACK },
    ],
  };
}

/** One evaluated frame: its time, the revision it evaluated, its nodes and steps, and the camera's pose. */
export interface Frame { s: number; rev: JsonValue; nodes: JsonObject[]; steps: JsonValue[]; camera: JsonObject | null; raw: JsonObject }
/** What one run of the board answered. */
export interface Board {
  rev: number;
  /** The registry's sealed canvas modules, and its operators by key. */
  modules: string[];
  operators: JsonObject;
  runsBefore: JsonValue;
  runsAfter: JsonValue;
  frames: Frame[];
  /** The ball's evaluated position at each QUERY_TIMES, or the value read when it isn't two numbers. */
  ball: JsonValue[];
  /** What the readout shows at each QUERY_TIMES. */
  readout: JsonValue[];
}

/**
 * Runs the scenario and reads its replies. A run that can't be read at all fails here, planted or not: the scenario
 * accepted, the board presented, each frame evaluated, the deep_query answered with a value per time.
 */
export function runBoard(bin: string, evidence: string, planted?: string): Board {
  const sc = scenario(evidence, planted);
  const calls = arr(sc['calls'], 'the calls').length;
  const of = planted === undefined ? '' : ` (planted ${planted})`;
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 1024 * MIB, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${SHOW} run: ${r.error.message}`);
  const stdout = r.stdout ?? '';
  expect(timedOut, `${SHOW} run${of} finished within its timeout`).toBe(false);
  expect(r.status, `${SHOW} run${of} exits 0; stdout: ${stdout.slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${SHOW} run${of}: one output line per input line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${SHOW} run${of}: the answer`);
  expect(out['ok'], `${SHOW} run refused the scenario${of}: ${brief(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], `${SHOW} run${of}: replies`).map((v, i) => obj(v, `${SHOW} run${of}: replies[${i}]`));
  expect(replies.length, `${SHOW} run${of}: one reply per call`).toBe(calls);

  const shown = replies[0]!;
  expect(shown['outcome'], `the agent's deep_show of the projectile board is presented${of}: ${brief(shown, 3000)}`).toBe('presented');
  const rev = shown['rev'];
  expect(typeof rev, `the deep_show reply names its revision${of}: ${brief(shown, 600)}`).toBe('number');

  const registry = replies[1]!;
  const modules = arr(registry['modules'], `the registry's modules${of}`).filter((m): m is string => typeof m === 'string');
  const operators = obj(registry['operators'], `the registry's operators${of}`);
  const runsBefore = replies[2]!['runs'] ?? null;

  const frames = EVAL_TIMES.map((s, k): Frame => {
    const e = replies[3 + k]!;
    expect(e['outcome'], `the frame at ${s} s is evaluated${of}: ${brief(e, 2000)}`).toBe('evaluated');
    const film = obj(e['film'], `the frame at ${s} s: its film block${of}`);
    const cameras = obj(film['cameras'], `the frame at ${s} s: film.cameras${of}`);
    return {
      s, rev: e['rev'] ?? null, raw: e,
      nodes: arr(e['nodes'], `the frame at ${s} s: nodes${of}`).map((n, i) => obj(n, `the frame at ${s} s: nodes[${i}]${of}`)),
      steps: arr(e['steps'], `the frame at ${s} s: steps${of}`),
      camera: isObject(cameras['cam']) ? cameras['cam'] : null,
    };
  });
  const runsAfter = replies[3 + EVAL_TIMES.length]!['runs'] ?? null;

  const query = replies[4 + EVAL_TIMES.length]!;
  const values = obj(query['values'], `the deep_query reply's values${of} (${brief(query, 2000)})`);
  const ball = arr(values[BALL_POS], `deep_query values["${BALL_POS}"]${of}`);
  const readout = arr(values[READOUT_TEXT], `deep_query values["${READOUT_TEXT}"]${of}`);
  expect(ball.length, `deep_query: one ball position per time read${of}`).toBe(QUERY_TIMES.length);
  expect(readout.length, `deep_query: one readout per time read${of}`).toBe(QUERY_TIMES.length);
  return { rev: rev as number, modules, operators, runsBefore, runsAfter, frames, ball, readout };
}

/** The first two numbers of a position, or null. */
export function xy(v: JsonValue | undefined): [number, number] | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const [x, y] = v;
  return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}
/** The numbers a text shows, in order (a U+2212 minus read as `-`). */
export function numbersIn(text: string): number[] {
  return (text.replace(/−/g, '-').match(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
}
