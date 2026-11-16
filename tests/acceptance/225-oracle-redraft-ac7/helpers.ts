// The #225 Oracle lane's tools for criterion 7 (README: The surface under test): `deep-show` built with cargo on the
// full set and driven by JSON lines (#393's `deep-show run`); the film the criterion describes, generated here at a
// frame rate, with a `vector_field@1` item whose stream table a group's warp flows along (#223's `flow`); the film
// played frame by frame through deep-show's `path` at t (#223); and the plane's geometry in f64, from which every
// expected value comes. Nothing here stands in for the vector field or the flow: every outline a test judges comes
// from the binary, or from a planted twin computed here and named as one. Written for this folder alone, since suites
// don't import each other.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type Pt = [number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (this folder is three levels down). */
const REPO = join(HERE, '..', '..', '..');
/** Every `it` passes this timeout: a first build of `deep-show` takes many minutes on a loaded machine. */
export const TIMEOUT = 3_600_000;

/**
 * Criterion 7's ID: `#225.` and the first 8 hex digits of SHA-256 of its text as the issue's `- [ ]` line holds it,
 * trimmed, white space collapsed (scripts/proof-change.mjs, criterionId).
 */
export const AC7 = 'AC7 #225.57b5ccba';
/** The criterion's bound: 0.5 px, read as 0.5 u on the film's 640 × 480 u frame drawn at 1 px a unit (README). */
export const TOL = 0.5;

// ---------------------------------------------------------------------------------------------------
// JSON and failure rules

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const brief = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${brief(v)}`).toBe(true);
  return v as JsonObject;
}
function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${brief(v)}`).toBe(true);
  return v as JsonValue[];
}
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** A judge that must fail on a wrong program: at least one failure, and one naming each of `named`. */
export function failsNaming(failures: readonly string[], named: readonly string[], what: string): void {
  expect(failures.length, `${what}: the wrong program passes the judge it must fail`).toBeGreaterThan(0);
  for (const n of named) expect(failures.some((f) => f.includes(n)), `${what}: a failure names ${n}; the failures: ${failures.slice(0, 8).join(' | ')}`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// Time (Time and the flick)

export const FLICKS = 705_600_000;
/** The two frame rates the criterion names. */
export const RATES = [24, 60] as const;
export type Rate = (typeof RATES)[number];
/** When the flow ends: its time is keyed from 0 at 0 s to π/2 at this time (README: The film). */
export const FLOW_END_S = 1;

// ---------------------------------------------------------------------------------------------------
// The build: `deep-show` with every module, copied out of target/.

const SHOW = 'deep-show';
const CARGO_ARGS = ['build', '--locked', '--bin', SHOW, '--no-default-features', '--features', 'full'];

/** Builds `deep-show` once, before the file's tests; a test whose build failed fails with cargo's error. */
export function useShow(): () => string {
  let dir = '';
  let made = { bin: '', error: 'the build did not run' };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-225-oracle-ac7-bin-'));
    const rustup = '/opt/homebrew/opt/rustup/bin';
    const env = {
      ...process.env,
      PATH: existsSync(rustup) ? `${rustup}${delimiter}${process.env['PATH'] ?? ''}` : (process.env['PATH'] ?? ''),
      CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
    };
    const r = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.error) { made = { bin: '', error: `cargo could not run: ${r.error.message}` }; return; }
    if (r.status !== 0) {
      const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l));
      made = { bin: '', error: `cargo ${CARGO_ARGS.join(' ')} failed:\n${lines.join('\n').slice(-4000)}` };
      return;
    }
    const target = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
    const bin = join(dir, SHOW);
    copyFileSync(join(target, 'debug', SHOW), bin);
    made = { bin, error: '' };
  }, 2 * TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (): string => {
    expect(made.error, `the binary builds: cargo ${CARGO_ARGS.join(' ')}`).toBe('');
    return made.bin;
  };
}

/** A fresh evidence folder for a test, deleted after it. */
export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-225-oracle-ac7-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// The plane (Frame and group: warp): a point's coordinates are its offset from `origin` in units of `unit`, y up.

export const PLANE = { origin: [320, 240] as Pt, unit: 100 };
/** A plane point on screen (document u). */
export const toScreen = (q: Pt): Pt => [PLANE.origin[0] + q[0] * PLANE.unit, PLANE.origin[1] - q[1] * PLANE.unit];
/** A screen point (document u) in the plane. */
export const toPlane = (s: Pt): Pt => [(s[0] - PLANE.origin[0]) / PLANE.unit, (PLANE.origin[1] - s[1]) / PLANE.unit];

/** The unit square, in the plane, off the origin so a turn about it moves it: (1, 0), (2, 0), (2, 1), (1, 1). */
export const SQUARE: Pt[] = [[1, 0], [2, 0], [2, 1], [1, 1]];
/** The flow of F = (−y, x) for time θ is the turn by θ counterclockwise about the origin: its exact image. */
export const turn = (q: Pt, theta: number): Pt => [q[0] * Math.cos(theta) - q[1] * Math.sin(theta), q[0] * Math.sin(theta) + q[1] * Math.cos(theta)];
/** A closed outline through `corners`, written back to its start, on screen. */
export const outline = (corners: Pt[]): Pt[] => [...corners, corners[0]!].map(toScreen);
/** The criterion's expected end: the square rotated 90°, (0, 1), (0, 2), (−1, 2), (−1, 1), on screen. */
export const ROTATED: Pt[] = outline([[0, 1], [0, 2], [-1, 2], [-1, 1]]);

// ---------------------------------------------------------------------------------------------------
// The film (README: The film). Shell form for `deep show` (#393): no `id`, no `layers`, no item's `layer`.

/** The field's formula, as `vector_field@1`'s `fn` takes it. */
export interface Fn { x: string; y: string }
/** The criterion's field, F = (−y, x). */
export const SWIRL: Fn = { x: '-y', y: 'x' };

export function flowFilm(fps: Rate, fn: Fn): JsonObject {
  const item = (id: string, kind: string, order: string, params: JsonObject, extra: JsonObject = {}): JsonObject =>
    ({ id, kind, name: `Item ${id}`, order, params, ...extra });
  const d = `M ${outline(SQUARE).map((p) => `${p[0]} ${p[1]}`).join(' L ')}`;
  return {
    format: 1, profile: 'film', title: `Flow ${fps} fps`, description: `The #225 oracle lane's square carried by a vector field's flow, at ${fps} fps.`,
    size: [640, 480],
    transport: { span: '2s', frame_rate: [fps, 1] },
    requires: { modules: { data: '^1' } },
    channels: {
      flow_time: {
        target: 'items/g/params/warp/flow/time', type: 'f32',
        keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: `${FLOW_END_S}s`, value: Math.PI / 2, interp: 'linear' } },
      },
    },
    items: {
      swirl: item('swirl', 'vector_field@1', 'a0', { fn: { x: fn.x, y: fn.y }, streams: { starts: { points: [[1, 0, 0]] }, step: 0.05, time: 2 * Math.PI } }),
      g: item('g', 'group@1', 'a1', {
        warp: {
          linear: { matrix: [[1, 0], [0, 1]] }, mix: 1, plane: { origin: [...PLANE.origin], unit: PLANE.unit, y: 'up' },
          flow: { streams: 'swirl', time: 0 },
        },
      }),
      square: item('square', 'path@1', 'a2', { d, paint: { stroke: { role: 'ink', width: 2 } } }, { parent: 'g' }),
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line in, one answer line out, exit 0 (#393).

const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
/** `deep show` from your shell: it writes as you. */
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
const DOC = '01JB225D000000000000000007';

/** One `deep-show run` process: its replies, one per call. */
function run(bin: string, evidence: string, calls: JsonObject[]): JsonObject[] {
  const sc: JsonObject = {
    evidence,
    sessions: { 'sess-alpha': { thread: 'thread-alpha', name: 'Claude Code: vector fields', process: { pid: 4100, start: 1_000 } } },
    processes: PROCESSES,
    panels: { main: { rect: [0, 0, 1920, 1080] } },
    docs: { [DOC]: { panel: 'main' } },
    calls,
  };
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  expect(timedOut, 'deep-show run finished within its timeout').toBe(false);
  expect(r.error?.message ?? '', 'deep-show run started').toBe('');
  expect(r.status, `deep-show run exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, 'deep-show run: one output line').toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, 'deep-show run: the answer');
  expect(out['ok'], `deep-show run accepted the scenario: ${brief(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], 'deep-show run: replies').map((x, i) => obj(x, `deep-show run: replies[${i}]`));
  expect(replies.length, 'deep-show run: one reply per call').toBe(calls.length);
  return replies;
}

/** The film shown, its export plan, and the square as `path` draws it at each frame from 0 to the flow's end, in order. */
export interface Played { fps: Rate; shown: JsonObject; plan: JsonObject; frames: { t: number; reply: JsonObject }[] }

/** The frame times at `fps` from 0 to the flow's end, both included, in whole flicks. */
export const frameTimes = (fps: Rate): number[] => Array.from({ length: fps * FLOW_END_S + 1 }, (_, k) => (k * FLICKS) / fps);

/**
 * Plays the film at `fps` in one process: `deep show` from your shell, the export plan at the film's own rate (#488's
 * `export` with no `out`), then deep-show's `path` of the square at every frame time in order, as playing draws them.
 */
export function play(bin: string, evidence: string, fps: Rate, fn: Fn): Played {
  const times = frameTimes(fps);
  const replies = run(bin, evidence, [
    { call: 'deep show', peer: YOU_PEER, doc: DOC, document: flowFilm(fps, fn), include: ['issues'] },
    { call: 'export', doc: DOC },
    ...times.map((t): JsonObject => ({ call: 'path', doc: DOC, item: 'square', t })),
  ]);
  return { fps, shown: replies[0]!, plan: replies[1]!, frames: times.map((t, i) => ({ t, reply: replies[2 + i]! })) };
}

/** A drawn reply's sub-paths, each a list of points (u), or null when it isn't one. */
function subpaths(reply: JsonObject): Pt[][] | null {
  if (reply['outcome'] === 'refused' || !Array.isArray(reply['subpaths'])) return null;
  const out: Pt[][] = [];
  for (const s of reply['subpaths']) {
    if (!Array.isArray(s)) return null;
    const line: Pt[] = [];
    for (const p of s) {
      if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number' || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
      line.push([p[0], p[1]]);
    }
    out.push(line);
  }
  return out.length ? out : null;
}

/**
 * Why a played film isn't a film presented with no error, at its own frame rate, with the square drawn at every frame;
 * empty when it is. Each failure starts with the rate.
 */
export function notPlayed(p: Played): string[] {
  const at = `${p.fps} fps`;
  const notices = [...(Array.isArray(p.shown['notices']) ? p.shown['notices'] : []), ...(Array.isArray(p.shown['issues']) ? p.shown['issues'] : [])].filter(isObject);
  const failures = [
    ...(p.shown['outcome'] === 'presented' ? [] : [`${at}: the film's outcome is ${brief(p.shown['outcome'])}: ${brief(p.shown, 1500)}`]),
    ...notices.filter((n) => n['severity'] === 'error').map((n) => `${at}: the check raises an error: ${brief(n, 600)}`),
    ...notices.filter((n) => n['code'] === 'unknown_kind').map((n) => `${at}: an item is skipped as a kind the build doesn't know: ${brief(n, 600)}`),
  ];
  if (failures.length) return failures;
  const rate = p.plan['frame_rate'];
  if (p.plan['outcome'] !== 'planned' || !Array.isArray(rate) || rate[0] !== p.fps || rate[1] !== 1 || p.plan['frame'] !== FLICKS / p.fps) {
    failures.push(`${at}: the export plan is not the film's own rate [${p.fps}, 1] with a frame of ${FLICKS / p.fps} flicks: ${brief(p.plan, 600)}`);
  }
  for (const f of p.frames) if (subpaths(f.reply) === null) failures.push(`${at}: deep-show path draws no square at ${f.t} flicks: ${brief(f.reply, 600)}`);
  return failures;
}

/** The square as the film's last played frame draws it, at the flow's end. */
export function lastDrawn(p: Played): Pt[][] {
  const last = p.frames[p.frames.length - 1]!;
  expect(last.t, `${p.fps} fps: the last played frame is the flow's end`).toBe(FLOW_END_S * FLICKS);
  const s = subpaths(last.reply);
  expect(s, `${p.fps} fps: the last frame draws the square: ${brief(last.reply, 600)}`).not.toBeNull();
  return s!;
}

// ---------------------------------------------------------------------------------------------------
// The judge: both ways between two outlines, each point of either (sampled every 0.25 u) within the bound of the other.

const dist = (a: Pt, b: Pt): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
function toSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const u = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dy);
}
function toLines(p: Pt, lines: Pt[][]): number {
  let best = Infinity;
  for (const l of lines) {
    if (l.length === 1) best = Math.min(best, dist(p, l[0]!));
    for (let i = 1; i < l.length; i++) best = Math.min(best, toSegment(p, l[i - 1]!, l[i]!));
  }
  return best;
}
function densify(lines: Pt[][], step = 0.25): Pt[] {
  const out: Pt[] = [];
  for (const l of lines) {
    if (l.length) out.push(l[0]!);
    for (let i = 1; i < l.length; i++) {
      const n = Math.max(1, Math.ceil(dist(l[i - 1]!, l[i]!) / step));
      for (let k = 1; k <= n; k++) out.push([l[i - 1]![0] + ((l[i]![0] - l[i - 1]![0]) * k) / n, l[i - 1]![1] + ((l[i]![1] - l[i - 1]![1]) * k) / n]);
    }
  }
  return out;
}
/** The farthest any point of `from` lies from `to`, and where. */
function farthest(from: Pt[][], to: Pt[][]): { d: number; at: Pt } {
  let worst = { d: 0, at: from[0]?.[0] ?? ([0, 0] as Pt) };
  for (const p of densify(from)) { const d = toLines(p, to); if (d > worst.d) worst = { d, at: p }; }
  return worst;
}
/** How far the drawn square strays from the square rotated 90°, both ways (u). */
export const stray = (drawn: Pt[][]): number => Math.max(farthest(drawn, [ROTATED]).d, farthest([ROTATED], drawn).d);

const short = (x: number): string => String(Number(x.toFixed(3)));
/** The criterion's judge on the square at the flow's end at `fps`: within 0.5 px of the square rotated 90°, both ways. */
export function judgeEnd(fps: Rate, drawn: Pt[][]): string[] {
  const at = `${fps} fps, the frame at ${FLOW_END_S} s`;
  const failures: string[] = [];
  const a = farthest(drawn, [ROTATED]);
  if (a.d > TOL) failures.push(`${at}: the drawn square strays ${short(a.d)} u from the square rotated 90°, at (${a.at.map(short).join(', ')})`);
  const b = farthest([ROTATED], drawn);
  if (b.d > TOL) failures.push(`${at}: the square rotated 90° lies ${short(b.d)} u from the drawn square, at (${b.at.map(short).join(', ')})`);
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// Planted twins in test code (README: Wrong programs): outlines a right and a wrong flow would draw, computed here.

const F = (q: Pt): Pt => [-q[1], q[0]];
/** The design's flow: RK4 over F at a fixed step, whole steps then the remainder, for `time`. */
export function rk4(q: Pt, time: number, step: number): Pt {
  const whole = Math.floor(time / step);
  const steps = [...Array<number>(whole).fill(step), ...(time - whole * step > 0 ? [time - whole * step] : [])];
  const a = (p: Pt, k: Pt, s: number): Pt => [p[0] + k[0] * s, p[1] + k[1] * s];
  for (const h of steps) {
    const k1 = F(q); const k2 = F(a(q, k1, h / 2)); const k3 = F(a(q, k2, h / 2)); const k4 = F(a(q, k3, h));
    q = [q[0] + (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]), q[1] + (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])];
  }
  return q;
}
/** The wrong flow that integrates between frames: one Euler step a frame, by the keyed time's change since the last. */
export function eulerPerFrame(q: Pt, fps: Rate): Pt {
  const h = Math.PI / 2 / (fps * FLOW_END_S);
  for (let k = 0; k < fps * FLOW_END_S; k++) { const v = F(q); q = [q[0] + h * v[0], q[1] + h * v[1]]; }
  return q;
}
/** The square's outline, every point moved by `f` in the plane (sampled every 0.25 u, so a curved image is drawn as one). */
export const carried = (f: (q: Pt) => Pt): Pt[][] => [densify([outline(SQUARE)]).map((s) => toScreen(f(toPlane(s))))];
