// Test-side tools for the #1937 acceptance tests: `deep-gpu` (#377's binary) built with `test-meter` and driven by
// JSON lines on Metal with this suite's call, `budget_fix`, beside #1899's `frame_budget` and #378's `view3d`
// (README: The surface under test); the over-class scene, as a writer's payload and as a session document; the stub
// meter whose readings follow the document measured; the reply's parser; a test-side applier for the fix's value ops;
// and the subject share read from the final and ID targets in OKLab. Nothing here stands in for the meter, the
// chooser, the render or the share under test.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1937 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const BIN = 'deep-gpu';
const BUILD = ['build', '--locked', '--bin', BIN, '--features', 'test-meter'];

// ---------------------------------------------------------------------------------------------------
// The criteria's numbers and the design's.

/** The showpiece class's frame GPU limit, in ms (the budget class table): "a 10 ms class". */
export const LIMIT_MS = 10;
/** The over-class fixture's frame GPU time, in ms: "a showpiece scene at 14 ms". */
export const SCENE_MS = 14;
/** A fix's subject share must be under this (AC1: "changes by under 2%"). */
export const FIX_SHARE = 0.02;
/** A set over this share is offered as a choice ask, never applied as the fix (Scope). */
export const CHOICE_SHARE = 0.05;
/** A pixel of the subject is changed when its OKLab differs by more than this (Scope). */
export const OKLAB_STEP = 0.02;
/** A prediction more than this far off its measured delta, as a share of it, is an `estimate` (AC2). */
export const ESTIMATE_BAND = 0.25;
export const RUNS = 5;
/** 300 frames a run at 60 fps, the design's floor for a frame-time p95. */
export const SECONDS = 5;
/** Every document here is drawn at this size; no criterion names one. */
export const SIZE: [number, number] = [320, 240];
/** The writer whose revision the calls check; also the session document's one layer's writer. */
export const WRITER = 'agent:alpha';
/** The candidates' closed list (Scope), as the reply names them (README: The budget_fix call). */
export const KNOBS = ['shadow_off', 'priority_down', 'lod_nearer', 'draw_distance', 'effect_quality_down', 'samples_down'] as const;
export type Knob = (typeof KNOBS)[number];
export const VERDICTS = ['PASS', 'FAIL', 'BLOCKED', 'INCONCLUSIVE'] as const;
export type Verdict = (typeof VERDICTS)[number];
/** The kept subject: `camera.framing`'s `keep`. */
export const KEEP = ['subject'];
/** The three shadowed lights. */
export const KEY = 'key';
export const FILL_A = 'fill-a';
export const FILL_B = 'fill-b';

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
function bool(value: JsonValue | undefined, what: string): boolean {
  expect(typeof value, `${what} is a boolean, got ${JSON.stringify(value)?.slice(0, 200)}`).toBe('boolean');
  return value as boolean;
}
function oneOf<T extends string>(v: JsonValue | undefined, values: readonly T[], what: string): T {
  const s = str(v, what);
  expect(values, `${what} is one of ${values.join(', ')}`).toContain(s);
  return s as T;
}
export const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
const clone = <T extends JsonValue>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const ms = (v: number): string => `${Number(v.toFixed(3))} ms`;
export const pct = (v: number): string => `${(v * 100).toFixed(2)}%`;

/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.join('\n  ')}`).toEqual([]);
}
/** At least one failure, and one that names each of `names`: what a planted program must give. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  for (const name of names) {
    expect(failures.some((f) => f.includes(name)), `${what}: a failure names ${name}; the failures were:\n  ${failures.join('\n  ')}`).toBe(true);
  }
}

// ---------------------------------------------------------------------------------------------------
// The machine: the subject share is read from pixels the GPU layer draws on macOS's Metal device.

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the subject share is read from pixels drawn on macOS's Metal device; this is ${process.platform}`);
}

/** A reference Mac's environment fingerprint (scripts/benchmark.mjs's first), in its conditions: AC2's "on the reference Mac". */
export const REFERENCE: JsonObject = {
  model: 'Mac15,7', chip: 'Apple M3 Pro', memoryBytes: 36 * 2 ** 30, power: 'ac', lowPowerMode: false, thermalState: 'nominal', macosBuild: '25B78',
};

// ---------------------------------------------------------------------------------------------------
// The build: `deep-gpu` with `test-meter` (the stub meter), built once per file.

/** Builds once, before the file's tests; a test whose build failed fails with cargo's error. */
export function useBuild(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1937-bin-'));
    const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
    const run = spawnSync('cargo', BUILD, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
    if (run.error) error = `cargo could not run: ${run.error.message}`;
    else if (run.status !== 0) error = `cargo ${BUILD.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
    else copyFileSync(join(process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target'), 'debug', BIN), join(dir, BIN));
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
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1937-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// Running: `deep-gpu run [--planted <name>]` on Metal, one scenario, one reply per call.

/** The wrong program `--planted` reaches (README: Planted programs). */
export type Planted = 'picks_largest_gain';

export function run(bin: string, out: string, calls: JsonObject[], planted?: Planted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const name = `${BIN} ${args.join(' ')}`;
  const s = spawnSync(bin, args, {
    cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL',
  });
  const timedOut = s.error !== undefined && (s.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  expect(timedOut, `${name} finished within its timeout`).toBe(false);
  if (s.error) throw Error(`${name}: ${s.error.message}`);
  expect(s.status, `${name} exited 0 (${s.signal ?? 'no signal'}); stdout: ${(s.stdout ?? '').slice(0, 1500)}; stderr: ${(s.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (s.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(1);
  let answer: JsonValue;
  try { answer = JSON.parse(lines[0]!) as JsonValue; } catch { answer = lines[0]!; }
  const a = obj(answer, `${name}: the answer`);
  expect(a['ok'], `${name} accepted the scenario: ${shown(a)}`).toBe(true);
  const replies = arr(a['replies'], `${name}: replies`).map((r, i) => obj(r, `${name}: replies[${i}]`));
  expect(replies.length, `${name}: one reply per call`).toBe(calls.length);
  return replies;
}

/** A reply that is no refusal: `{code, …}` fails here, naming it; INCONCLUSIVE when the platform can't draw. */
export function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what} is answered, not refused: ${shown(reply)}`).toBeUndefined();
  return reply;
}

// ---------------------------------------------------------------------------------------------------
// The over-class scene (README: Fixtures): a pale 1.6 m box, the kept subject, on a grey floor under a camera; a key
// sun with shadows from above and in front, whose shadow of a bar out of view falls in a band across the subject's
// front face (about 30% of its pixels); and two fill spots with shadows, left and right, whose shadows fall on the
// floor, off the subject. A showpiece, its local shadows on for two spots.

export const LOOK: JsonObject = {
  id: 'look-1937', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'The #1937 acceptance look: tone map none at the exposure whose scale is 1.',
  palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', stone: '#d9dde3' },
  roles: { ground: 'night', ink: 'graphite', muted: 'slate', stone: 'stone' },
  themes: { light: {}, dark: {} },
  fonts: {
    body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
    mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  },
  tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ground_3d: { kind: 'none' },
  status: { pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464' },
  status_treatment: { core_min_px: 4, glyph: { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' } },
  min_distance: 0.1, attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
};

const spot = (pos: number[], rot: number[]): JsonObject =>
  ({ kind: 'light.spot@1', params: { power: 300, color: [1, 1, 1], inner: 20, outer: 35, shadow: true }, at: { pos, rot } });
const ITEMS: Record<string, JsonObject> = {
  cam: { kind: 'camera@1', params: { projection: 'perspective', position: [0, 3, 7], target: [0, 0.9, 0], fov: 40 } },
  grey: { kind: 'material@1', params: { base_color: [0.5, 0.5, 0.5, 1], roughness: 1, metallic: 0 } },
  pale: { kind: 'material@1', params: { base_color: [0.8, 0.8, 0.8, 1], roughness: 1, metallic: 0 } },
  floor: { kind: 'mark.box@1', params: { size: [20, 0.1, 20] }, at: { pos: [0, -0.05, 0] }, material: 'grey' },
  subject: { kind: 'mark.box@1', params: { size: [1.6, 1.6, 1.6] }, at: { pos: [0, 0.8, 0] }, material: 'pale' },
  // Above the frame, between the key sun and the subject's front face.
  bar: { kind: 'mark.box@1', params: { size: [3, 0.1, 0.25] }, at: { pos: [0, 3.8, 2.3] }, material: 'grey' },
  [KEY]: { kind: 'light.sun@1', params: { illuminance: 2, color: [1, 1, 1], shadow: true }, at: { rot: [-60, 0, 0] } },
  [FILL_A]: spot([-4, 3, 2], [-26.2, -63.4, 0]),
  [FILL_B]: spot([4, 3, 2], [-26.2, 63.4, 0]),
};

/** The scene as a session holds it (#378's view3d): an `id`, one writer layer, every item in it. */
export function sessionDoc(): JsonObject {
  const items: JsonObject = {};
  let order = 0;
  for (const [id, item] of Object.entries(ITEMS)) items[id] = { id, name: id, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...clone(item) };
  return {
    format: 1, id: 'over-class-1937', profile: 'scene', title: 'An over-class showpiece', description: 'A showpiece over its class: a #1937 acceptance fixture.',
    size: SIZE, camera: 'cam', transport: { span: '2s' }, requires: { modules: { scene3d: '^1' } }, budget: { class: 'showpiece' },
    light_policy: { shadowed: { spots: 2 } }, layers: { main: { writer: WRITER, title: 'Main', order: 'a0' } }, items,
  };
}
/** The writer's payload of the scene, as #393's deep_show and #1899's frame_budget take it: no `id`, no `layers`. */
export function payload(): JsonObject {
  const doc = sessionDoc();
  delete doc['id'];
  delete doc['layers'];
  for (const item of Object.values(obj(doc['items'], 'items'))) delete (item as JsonObject)['layer'];
  return doc;
}
/** Writes `value` as JSON under `dir` and returns its absolute path. */
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

/** The op that turns a light's shadows off, as Patch writes a value change. */
export const shadowOff = (light: string): JsonObject => ({ op: 'set', id: light, path: `items/${light}/params/shadow`, value: false });

// ---------------------------------------------------------------------------------------------------
// The stub meter (README: Stubs): every frame's passes cover 3 ms, plus each term that holds on the document as the
// run measures it: the key light's shadows 6 ms, each fill's 2.5 ms, so the scene reads 14 ms. The cost model's
// coefficients are the terms' `predicted_ms` (their `gpu_ms` when absent).

export interface Term { path: string; equals: JsonValue; gpu_ms: number; predicted_ms?: number }
export const BASE_MS = 3;
export const SHADOW_MS: Record<string, number> = { [KEY]: 6, [FILL_A]: 2.5, [FILL_B]: 2.5 };
/** The stub, with the cost model predicting each light's shadow at `predicted` ms (its measured cost when absent). */
export function stubMeter(predicted: Record<string, number> = {}): JsonObject {
  const terms: Term[] = Object.entries(SHADOW_MS).map(([light, gpu_ms]) => ({
    path: `items/${light}/params/shadow`, equals: true, gpu_ms, ...(predicted[light] === undefined ? {} : { predicted_ms: predicted[light] }),
  }));
  return { frames: [{ from: 0, gpu_ms: BASE_MS }], terms: terms as unknown as JsonValue };
}

// ---------------------------------------------------------------------------------------------------
// Calls.

export const budgetFixCall = (doc: string, stub: JsonObject): JsonObject => ({
  call: 'budget_fix', look: LOOK, writer: WRITER, doc, render: { seconds: SECONDS, pixels: SIZE }, keep: KEEP, stub_meter: stub, stub_environment: REFERENCE,
});
export const frameBudgetCall = (doc: string, stub: JsonObject): JsonObject => ({
  call: 'frame_budget', look: LOOK, writer: WRITER, doc, render: { seconds: SECONDS, pixels: SIZE }, stub_meter: stub, stub_environment: REFERENCE,
});
/** #378's view3d: frame 0 of the session document, its final and ID targets, with `ops` applied first as the writer's patch. */
export const view3dCall = (doc: string, ops: JsonObject[] = []): JsonObject => ({
  call: 'view3d', doc, look: LOOK, size: SIZE, frames: 1, capture: [0], targets: ['final', 'ids'],
  ...(ops.length ? { patches: [{ frame: 0, writer: WRITER, ops }] } : {}),
});

// ---------------------------------------------------------------------------------------------------
// Replies.

/** A frame-budget Result (#1899), as far as these tests read it: the verdict and the GPU limit's five runs. */
export interface Result { verdict: Verdict; limit_ms: number; gpuVerdict: Verdict; p95s: (number | null)[] }
export function resultOf(v: JsonValue | undefined, what: string): Result {
  const o = obj(v, what);
  const gpu = obj(obj(o['limits'], `${what}.limits`)['gpu'], `${what}.limits.gpu`);
  return {
    verdict: oneOf(o['verdict'], VERDICTS, `${what}.verdict`),
    limit_ms: num(gpu['limit_ms'], `${what}.limits.gpu.limit_ms`),
    gpuVerdict: oneOf(gpu['verdict'], VERDICTS, `${what}.limits.gpu.verdict`),
    p95s: arr(gpu['runs'], `${what}.limits.gpu.runs`).map((r, i) => {
      const p = obj(r, `${what}.limits.gpu.runs[${i}]`)['p95_ms'];
      return p === null ? null : num(p, `${what}.limits.gpu.runs[${i}].p95_ms`);
    }),
  };
}
/** Problems with a Result that should read `want` ms in each of its five runs. */
export function runsAt(r: Result, want: number, what: string): string[] {
  if (r.p95s.length !== RUNS) return [`${what} attaches ${r.p95s.length} runs, not ${RUNS}`];
  return r.p95s.flatMap((p, i) => (p !== null && Math.abs(p - want) <= 1e-6 ? [] : [`${what}: run ${i + 1}'s GPU p95 is ${p === null ? 'null' : ms(p)}, not ${ms(want)}`]));
}

export interface Candidate { knob: Knob; item: string | null; ops: JsonObject[]; predicted_ms: number; measured_ms: number; estimate: boolean; share: number }
export interface Chosen { of: number[]; ops: JsonObject[]; measured_ms: number; share: number; measured: Result }
export interface Ask { kind: string; options: { ops: JsonObject[]; share: number }[] }
export interface Fix { limit_ms: number; document: Result; candidates: Candidate[]; chosen: Chosen | null; fix: JsonObject[] | null; ask: Ask | null }

const opsOf = (v: JsonValue | undefined, what: string): JsonObject[] => arr(v, what).map((op, i) => obj(op, `${what}[${i}]`));
function shareOf(v: JsonValue | undefined, what: string): number {
  const s = num(v, what);
  expect(s >= 0 && s <= 1, `${what} is a share of the subject's pixels, in [0, 1], got ${s}`).toBe(true);
  return s;
}

/** Parses a budget_fix reply, failing at the first missing or mistyped field. */
export function fixOf(reply: JsonObject, what: string): Fix {
  answered(reply, what);
  const candidates = arr(reply['candidates'], `${what}: candidates`).map((v, i): Candidate => {
    const c = obj(v, `${what}: candidates[${i}]`);
    const at = `${what}: candidates[${i}] (${shown(c['knob'])} ${shown(c['item'])})`;
    return {
      knob: oneOf(c['knob'], KNOBS, `${at}.knob`),
      item: c['item'] === null ? null : str(c['item'], `${at}.item`),
      ops: opsOf(c['ops'], `${at}.ops`),
      predicted_ms: num(c['predicted_ms'], `${at}.predicted_ms`),
      measured_ms: num(c['measured_ms'], `${at}.measured_ms`),
      estimate: bool(c['estimate'], `${at}.estimate`),
      share: shareOf(c['share'], `${at}.share`),
    };
  });
  const chosen = reply['chosen'] === null ? null : (() => {
    const c = obj(reply['chosen'], `${what}: chosen`);
    return {
      of: arr(c['of'], `${what}: chosen.of`).map((i, k) => num(i, `${what}: chosen.of[${k}]`)),
      ops: opsOf(c['ops'], `${what}: chosen.ops`),
      measured_ms: num(c['measured_ms'], `${what}: chosen.measured_ms`),
      share: shareOf(c['share'], `${what}: chosen.share`),
      measured: resultOf(c['measured'], `${what}: chosen.measured`),
    };
  })();
  const ask = reply['ask'] === null ? null : (() => {
    const a = obj(reply['ask'], `${what}: ask`);
    return {
      kind: str(a['kind'], `${what}: ask.kind`),
      options: arr(a['options'], `${what}: ask.options`).map((v, i) => {
        const o = obj(v, `${what}: ask.options[${i}]`);
        return { ops: opsOf(o['ops'], `${what}: ask.options[${i}].ops`), share: shareOf(o['share'], `${what}: ask.options[${i}].share`) };
      }),
    };
  })();
  return {
    limit_ms: num(reply['limit_ms'], `${what}: limit_ms`),
    document: resultOf(reply['document'], `${what}: document`),
    candidates,
    chosen,
    fix: reply['fix'] === null ? null : opsOf(reply['fix'], `${what}: fix`),
    ask,
  };
}

/** The candidate that turns `light`'s shadows off, if the reply lists one. */
export const shadowCandidate = (f: Fix, light: string): Candidate | undefined => f.candidates.find((c) => c.knob === 'shadow_off' && c.item === light);
/** Ops compared as sets of their JSON. */
export const sameOps = (a: JsonObject[], b: JsonObject[]): boolean => {
  const key = (ops: JsonObject[]): string[] => ops.map((op) => JSON.stringify(Object.fromEntries(Object.entries(op).sort(([x], [y]) => x.localeCompare(y))))).sort();
  return JSON.stringify(key(a)) === JSON.stringify(key(b));
};

// ---------------------------------------------------------------------------------------------------
// The fix applied test-side: its ops are value changes (`set`, `unset`) on items' fields, as Patch writes them, so the
// payload the suite measures again is the scene with those values changed and nothing else.

export function applyOps(doc: JsonObject, ops: JsonObject[], what: string): JsonObject {
  const out = clone(doc);
  const items = obj(out['items'], 'items');
  for (const op of ops) {
    const kind = op['op'];
    expect(kind === 'set' || kind === 'unset', `${what}: ${shown(op)} is a value change (set or unset), which this suite applies to the payload`).toBe(true);
    const id = str(op['id'], `${what}: ${shown(op)}.id`);
    const path = str(op['path'], `${what}: ${shown(op)}.path`);
    expect(path.startsWith(`items/${id}/`), `${what}: ${shown(op)}'s path is under items/${id}/`).toBe(true);
    const steps = path.slice(`items/${id}/`.length).split('/');
    let at: JsonValue = obj(items[id], `${what}: the item ${id} the op names`);
    for (const step of steps.slice(0, -1)) {
      const o = at as JsonObject;
      if (!isObject(o[step])) o[step] = {};
      at = o[step]!;
    }
    const last = steps[steps.length - 1]!;
    if (kind === 'set') (at as JsonObject)[last] = op['value'] ?? null;
    else delete (at as JsonObject)[last];
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Pixels: #378's targets (files named by their SHA-256), the ID target's picks, and OKLab.

export interface ViewFrame { final: string; ids: string; picks: Map<number, string> }
export function frameOf(reply: JsonObject, what: string): ViewFrame {
  answered(reply, what);
  const f = obj(arr(reply['frames'], `${what}: frames`)[0], `${what}: frame 0`);
  const picks = new Map(Object.entries(obj(f['picks'], `${what}: frame 0's picks`)).map(([k, id]) => [Number(k), str(id, `${what}: picks[${k}]`)] as [number, string]));
  return { final: str(f['final'], `${what}: frame 0's final`), ids: str(f['ids'], `${what}: frame 0's ids`), picks };
}

interface Image { width: number; height: number; rgba: Uint8Array }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** Reads an 8-bit RGB or RGBA PNG with no interlace (#378's and #421's reader). */
function decodePng(file: Buffer): Image {
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
function readPng(out: string, hash: string, what: string): Image {
  expect(hash, `${what} is written, named by a SHA-256`).toMatch(/^[0-9a-f]{64}$/);
  return decodePng(readFileSync(join(out, `${hash}.png`)));
}

const linear = (c: number): number => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
/** OKLab of an 8-bit sRGB pixel (Ottosson's matrices). */
export function oklab(r8: number, g8: number, b8: number): [number, number, number] {
  const r = linear(r8); const g = linear(g8); const b = linear(b8);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** The share of the subject's pixels (the kept items in `base`'s ID target) whose OKLab moves more than 0.02 in `other`. */
export function subjectShare(out: string, base: ViewFrame, other: ViewFrame, what: string): { share: number; pixels: number } {
  const ids = readPng(out, base.ids, `${what}: the scene's ID target`);
  const a = readPng(out, base.final, `${what}: the scene's final frame`);
  const b = readPng(out, other.final, `${what}: the changed scene's final frame`);
  expect([a.width, a.height, b.width, b.height], `${what}: both frames are ${SIZE.join(' × ')}`).toEqual([...SIZE, ...SIZE]);
  let pixels = 0; let changed = 0;
  for (let i = 0; i < a.width * a.height; i++) {
    const o = i * 4;
    const pick = (ids.rgba[o]! + ids.rgba[o + 1]! * 256 + ids.rgba[o + 2]! * 65_536 + ids.rgba[o + 3]! * 16_777_216) >>> 0;
    if (pick === 0 || !KEEP.includes(base.picks.get(pick) ?? '')) continue;
    pixels++;
    const p = oklab(a.rgba[o]!, a.rgba[o + 1]!, a.rgba[o + 2]!);
    const q = oklab(b.rgba[o]!, b.rgba[o + 1]!, b.rgba[o + 2]!);
    if (Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) > OKLAB_STEP) changed++;
  }
  expect(pixels, `${what}: the subject covers pixels in the scene's ID target`).toBeGreaterThan(1000);
  return { share: changed / pixels, pixels };
}
