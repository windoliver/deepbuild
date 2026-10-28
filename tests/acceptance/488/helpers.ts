// Test-side tools for the #488 acceptance tests: `deep-show` built per Cargo feature set (a build set
// plus the test canvas modules' features, as #387's suite builds it), driven by JSON lines; the
// scenario and its calls (deep_show, `eval`, and this suite's `rate`, `time`, `play`, `determinism`
// and `export`); the documents the tests draw; and the checks the criteria's planted programs must
// fail, each returning its failures as sentences that name what failed (a flick, a rate, a module).
// Nothing here stands in for the clock, the rate rule, the transport or render-back.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/488 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const SHOW_NAME = 'deep-show';
const UPLIFTED = join(REPO, 'target', 'debug', process.platform === 'win32' ? `${SHOW_NAME}.exe` : SHOW_NAME);

/** Flicks in one second (Time and the flick). */
export const FLICKS = 705_600_000;
/** Seconds to flicks, exact for up to five fraction digits. */
export const sec = (s: number): number => Math.round(s * FLICKS);
/** One display frame at 144 Hz: 4,900,000 flicks (144 is a valid display rate). */
export const DISPLAY_HZ = 144;
export const DISPLAY = FLICKS / DISPLAY_HZ;
/** The document frame at 60 fps, the transport's default rate. */
export const FRAME_60 = FLICKS / 60;

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
export function int(value: JsonValue | undefined, what: string): number {
  const n = num(value, what);
  expect(Number.isSafeInteger(n), `${what} is an integer below 2^53, got ${n}`).toBe(true);
  return n;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
export const clone = <T extends JsonValue>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// ---------------------------------------------------------------------------------------------------
// Builds: one `deep-show` per Cargo feature set, built once per file, each kept under its own name (#387).

export type BuildSet = 'core' | 'r1' | 'r2' | 'full';
/** The test canvas modules' Cargo features (README: The test canvas modules). */
export type TestFeature = 'test-tick' | 'test-frame-cache';
export interface Build { set: BuildSet; with?: TestFeature[] }
export const FULL: Build = { set: 'full' };
export const TICK: Build = { set: 'full', with: ['test-tick'] };
export const CACHE: Build = { set: 'full', with: ['test-frame-cache'] };

export const featuresOf = (build: Build): string[] => [build.set, ...(build.with ?? [])];
export const buildName = (build: Build): string => featuresOf(build).join('+');

function buildFeatures(features: string[]): string {
  const run = spawnSync('cargo', ['build', '--locked', '--bin', SHOW_NAME, '--no-default-features', '--features', features.join(',')], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo build --bin ${SHOW_NAME} --no-default-features --features ${features.join(',')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished/.test(l)).join('\n')}`;
  return '';
}

export interface Builds { bin: (build: Build) => string }

/** Builds every listed feature set once, before the file's tests; a test that asks for a build that failed fails with cargo's error. */
export function useBuilds(builds: readonly Build[]): Builds {
  let dir = '';
  const made = new Map<string, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-488-bins-'));
    for (const build of builds) {
      const name = buildName(build);
      if (made.has(name)) continue;
      const error = buildFeatures(featuresOf(build));
      const bin = join(dir, `${SHOW_NAME}-${name.replace(/[^a-z0-9+.-]/g, '_')}`);
      if (error === '') copyFileSync(UPLIFTED, bin);
      made.set(name, { bin, error });
    }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(build: Build): string {
      const entry = made.get(buildName(build));
      if (!entry) throw Error(`the file didn't list the build ${buildName(build)} in useBuilds`);
      expect(entry.error, `the binary builds: ${SHOW_NAME} with features ${featuresOf(build).join(',')}`).toBe('');
      return entry.bin;
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// Starting the binary: JSON lines in, one JSON line out per line in.

export interface Started { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string; ms: number }

export function start(bin: string, args: string[], inputs: (JsonValue | string)[], timeoutMs = 900_000): Started {
  const text = inputs.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n');
  const began = performance.now();
  const run = spawnSync(bin, args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const ms = performance.now() - began;
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${SHOW_NAME} ${args.join(' ')}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  const lines = stdout.split('\n').filter((line) => line !== '').map((line) => {
    try { return JSON.parse(line) as JsonValue; } catch { return line; }
  });
  return { status: run.status, signal: run.signal, timedOut, lines, stdout, stderr: run.stderr ?? '', ms };
}

/** One scenario line given as text, for a call whose numbers JSON.stringify can't write (2^62 flicks). */
export interface RawScenario { raw: string; calls: number }

/** `deep-show run`: one scenario, accepted, with one reply per call. */
export function run(bin: string, sc: JsonObject | RawScenario): JsonObject[] {
  const raw = 'raw' in sc && typeof sc.raw === 'string';
  const s = start(bin, ['run'], [raw ? (sc as RawScenario).raw : (sc as JsonObject)]);
  expect(s.timedOut, `${SHOW_NAME} run finished within its timeout`).toBe(false);
  expect(s.status, `${SHOW_NAME} run exited 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1000)}; stderr: ${s.stderr.slice(0, 2000)}`).toBe(0);
  expect(s.lines.length, `${SHOW_NAME} run: one output line per input line`).toBe(1);
  const out = obj(s.lines[0], `${SHOW_NAME} run: the answer`);
  expect(out['ok'], `${SHOW_NAME} run refused the scenario: ${JSON.stringify(out).slice(0, 2000)}`).toBe(true);
  const replies = arr(out['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  const calls = raw ? (sc as RawScenario).calls : arr((sc as JsonObject)['calls'], 'the scenario\'s calls').length;
  expect(replies.length, 'run: one reply per call').toBe(calls);
  return replies;
}

/**
 * The same, for a planted wrong program that may answer wrongly or not at all: `null` when the binary
 * didn't answer the scenario (a refusal, a crash or a timeout), which a check on the planted program
 * counts as its failure.
 */
export function tryRun(bin: string, sc: JsonObject | RawScenario): JsonObject[] | null {
  const raw = 'raw' in sc && typeof sc.raw === 'string';
  const s = start(bin, ['run'], [raw ? (sc as RawScenario).raw : (sc as JsonObject)]);
  if (s.timedOut || s.status !== 0 || s.lines.length !== 1 || !isObject(s.lines[0])) return null;
  const out = s.lines[0];
  if (out['ok'] !== true || !Array.isArray(out['replies'])) return null;
  const replies = out['replies'];
  const calls = raw ? (sc as RawScenario).calls : (((sc as JsonObject)['calls'] as JsonValue[]) ?? []).length;
  if (replies.length !== calls || !replies.every(isObject)) return null;
  return replies as JsonObject[];
}

// ---------------------------------------------------------------------------------------------------
// Scenarios and calls

/** A fresh evidence store root per test, deleted after it. */
export function useEvidence(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-488-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

export const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: canvas time', process: { pid: 4100, start: 1_000 } };
export const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }];
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
/** Document IDs: `doc(n)`; DOC.a and DOC.b are the first two. Each sits in its own panel `p<n>`. */
export const doc = (n: number): string => ulid('01JB88D', n);
export const DOC = { a: doc(1), b: doc(2) } as const;
export const MAX_DOCS = 8;

export interface ScenarioExtra { planted?: string }

/** A scenario with every document `doc(1)` … `doc(MAX_DOCS)` in its own visible panel. */
export function scenario(evidence: string, calls: JsonObject[], extra: ScenarioExtra = {}): JsonObject {
  const docs: JsonObject = {};
  const panels: JsonObject = {};
  for (let n = 1; n <= MAX_DOCS; n++) {
    docs[doc(n)] = { panel: `p${n}` };
    panels[`p${n}`] = { rect: [0, 0, 800, 600] };
  }
  const out: JsonObject = {
    evidence,
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } },
    processes: PROCESSES,
    panels,
    docs,
    calls,
  };
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) out[k] = v as JsonValue;
  return out;
}

/** The scenario as text, with `marks` (`"<<<n>>>"` strings) replaced by the integer text `n`, for flicks past 2^53. */
export function rawScenario(sc: JsonObject, marks: Record<string, string>): RawScenario {
  let raw = JSON.stringify(sc);
  for (const [mark, text] of Object.entries(marks)) raw = raw.split(JSON.stringify(mark)).join(text);
  return { raw, calls: arr(sc['calls'], 'calls').length };
}

export const SIZE: [number, number] = [320, 200];
export interface ShowOptions { doc?: string; pixels?: boolean }
/** An agent's deep_show call: a whole revision of `document` (#393). */
export function show(document: JsonObject, options: ShowOptions = {}): JsonObject {
  const include = options.pixels ? ['issues', 'pixels'] : ['issues'];
  return { call: 'deep_show', session: ALPHA.id, doc: options.doc ?? DOC.a, document, include, ...(options.pixels ? { size: SIZE } : {}) };
}

export const outcome = (reply: JsonObject): string => String(reply['outcome']);

export interface Issue { code: string; severity: string; path?: string | undefined; raw: JsonObject }
export function issues(reply: JsonObject, what = 'the reply'): Issue[] {
  return arr(reply['issues'] ?? [], `${what}: issues`).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return { code: str(o['code'], `${what}: issues[${i}].code`), severity: str(o['severity'], `${what}: issues[${i}].severity`), path: typeof o['path'] === 'string' ? o['path'] : undefined, raw: o };
  });
}
/** A deep_show reply that presented its revision. */
export function presented(reply: JsonObject, what: string): void {
  expect(outcome(reply), `${what} is presented: ${JSON.stringify(reply).slice(0, 1500)}`).toBe('presented');
}
/**
 * A deep_show reply that refused its revision with an error issue of `code` at `path` whose JSON
 * names `named` (the rate the criterion says is named), returning that issue.
 */
export function refusedNaming(reply: JsonObject, code: string, path: string, named: string, what: string): Issue {
  expect(outcome(reply), `${what} is refused: ${JSON.stringify(reply).slice(0, 1500)}`).toBe('refused');
  const found = issues(reply, what).filter((i) => i.code === code && i.severity === 'error' && i.path === path);
  expect(found.length, `${what}: an error issue ${code} at ${path}: ${JSON.stringify(reply['issues']).slice(0, 1500)}`).toBeGreaterThan(0);
  const naming = found.filter((i) => JSON.stringify(i.raw).includes(named));
  expect(naming.length, `${what}: the ${code} issue names the rate ${named}: ${JSON.stringify(found.map((i) => i.raw)).slice(0, 1500)}`).toBeGreaterThan(0);
  return naming[0]!;
}

export function snapshotOf(reply: JsonObject, what: string): string {
  expect(outcome(reply), `${what} evaluated: ${JSON.stringify(reply).slice(0, 1200)}`).toBe('evaluated');
  const list = arr(reply['snapshots'], `${what}: snapshots`);
  expect(list.length, `${what} carries one snapshot`).toBe(1);
  return str(obj(list[0], `${what}: snapshot`)['sha256'], `${what}: snapshot sha256`);
}

// The calls this suite adds (README: The surface under test).

/** `eval` with `t` as flicks (a JSON integer) or a time literal, and a render-back snapshot. */
export const evalPixels = (id: string, t: number | string): JsonObject => ({ call: 'eval', doc: id, t, pixels: true, size: SIZE });

export interface RateOptions { t?: number | string; k?: number; source?: boolean }
/** `rate`: the rule for one frame rate `[p, q]`, with `t` (flicks; a string is a mark for `rawScenario`) or `k` (a frame index). */
export function frameRate(pq: [number, number], options: RateOptions = {}): JsonObject {
  const out: JsonObject = { call: 'rate', frame_rate: pq };
  if (options.t !== undefined) out['t'] = options.t;
  if (options.k !== undefined) out['k'] = options.k;
  return out;
}
/** `rate`: the rule for one sample rate in Hz; `source: true` asks as a source (resampled when invalid). */
export function sampleRate(hz: number, options: RateOptions = {}): JsonObject {
  const out: JsonObject = { call: 'rate', sample_rate: hz };
  if (options.t !== undefined) out['t'] = options.t;
  if (options.k !== undefined) out['k'] = options.k;
  if (options.source) out['source'] = true;
  return out;
}
export const timeCall = (id: string, text: string): JsonObject => ({ call: 'time', doc: id, text });
export const playCall = (id: string, to: number, displayHz = DISPLAY_HZ): JsonObject => ({ call: 'play', doc: id, display_hz: displayHz, to });
export interface DeterminismOptions { play?: 'warm' | 'cold'; at_times?: number[]; displayHz?: number }
export function determinismCall(id: string, options: DeterminismOptions = {}): JsonObject {
  const out: JsonObject = { call: 'determinism', doc: id, display_hz: options.displayHz ?? DISPLAY_HZ };
  if (options.play !== undefined) out['play'] = options.play;
  if (options.at_times !== undefined) out['at_times'] = options.at_times;
  return out;
}
export interface ExportOptions { frame_rate?: [number, number]; sample_rate?: number }
export function exportCall(id: string, options: ExportOptions = {}): JsonObject {
  const out: JsonObject = { call: 'export', doc: id };
  if (options.frame_rate !== undefined) out['frame_rate'] = options.frame_rate;
  if (options.sample_rate !== undefined) out['audio'] = { sample_rate: options.sample_rate };
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Replies

/** The text a `rate` reply names a rate by: `p/q` for a frame rate, `<Hz> Hz` for a sample rate. */
export const frameRateText = (pq: [number, number]): string => `${pq[0]}/${pq[1]}`;
export const sampleRateText = (hz: number): string => `${hz} Hz`;

export interface Rate { outcome: string; rate: string; length: number | null; index: number | null; t: number | null; raw: JsonObject }
export function rateReply(reply: JsonObject, what: string): Rate {
  const o = outcome(reply);
  expect(['valid', 'refused', 'resampled'], `${what}: outcome is valid, refused or resampled: ${JSON.stringify(reply).slice(0, 600)}`).toContain(o);
  return {
    outcome: o,
    rate: str(reply['rate'], `${what}: rate`),
    length: reply['length'] === undefined ? null : int(reply['length'], `${what}: length`),
    index: reply['index'] === undefined ? null : int(reply['index'], `${what}: index`),
    t: reply['t'] === undefined ? null : int(reply['t'], `${what}: t`),
    raw: reply,
  };
}
/** A valid rate's whole-flick length. */
export function validLength(reply: JsonObject, what: string): number {
  const r = rateReply(reply, what);
  expect(r.outcome, `${what} is valid: ${JSON.stringify(reply).slice(0, 600)}`).toBe('valid');
  expect(r.length, `${what}: a valid rate names its whole-flick length`).not.toBeNull();
  return r.length!;
}

/**
 * Criterion 6's check on one `rate` reply (or none, when the planted program didn't answer): the
 * index must be `expected`; each failure names the time and the index given.
 */
export function indexFailures(reply: JsonObject | null | undefined, t: string, expected: number, what: string): string[] {
  if (!reply) return [`${what}: no reply for t = ${t}`];
  if (outcome(reply) !== 'valid') return [`${what}: t = ${t} was not answered valid: ${JSON.stringify(reply).slice(0, 300)}`];
  const index = reply['index'];
  if (typeof index !== 'number' || !Number.isSafeInteger(index)) return [`${what}: t = ${t} gave no integer index: ${JSON.stringify(index)}`];
  if (index !== expected) return [`${what}: t = ${t} gave frame ${index}, not ${expected}`];
  return [];
}

/**
 * Criterion 5's rule check on a sample rate: `valid` must match the whole-flick rule (705,600,000 ÷ Hz
 * is an integer); each failure names the rate.
 */
export function sampleRuleFailures(reply: JsonObject | null | undefined, hz: number, what: string): string[] {
  const whole = FLICKS % hz === 0;
  if (!reply) return [`${what}: no reply for ${hz} Hz`];
  const o = outcome(reply);
  if (whole && o !== 'valid') return [`${what}: ${hz} Hz has a whole-flick sample (${FLICKS / hz}) but was answered ${o}`];
  if (!whole && o === 'valid') return [`${what}: ${hz} Hz has no whole-flick sample (${FLICKS / hz}) but was answered valid`];
  if (!whole && !JSON.stringify(reply).includes(String(hz))) return [`${what}: the reply for ${hz} Hz doesn't name the rate: ${JSON.stringify(reply).slice(0, 300)}`];
  return [];
}

export interface Side { pixels: string; results: Map<string, { module: string; result: string }> }
export interface Compared { t: number; play: Side; seek: Side }
export interface Determinism { at_times: number[]; frames: Compared[]; raw: JsonObject }

const SHA = /^[0-9a-f]{64}$/;
function side(value: JsonValue | undefined, what: string): Side {
  const o = obj(value, what);
  const pixels = str(o['pixels'], `${what}: pixels`);
  expect(pixels, `${what}: pixels is a SHA-256 of the canonical render's PNG`).toMatch(SHA);
  const results = new Map<string, { module: string; result: string }>();
  for (const [i, n] of arr(o['nodes'], `${what}: nodes`).entries()) {
    const node = obj(n, `${what}: nodes[${i}]`);
    const id = `${str(node['operator'], `${what}: nodes[${i}].operator`)}@${node['item'] === null || node['item'] === undefined ? '(document)' : str(node['item'], `${what}: nodes[${i}].item`)}`;
    results.set(id, { module: str(node['module'], `${what}: nodes[${i}].module`), result: str(node['result'], `${what}: nodes[${i}].result`) });
  }
  return { pixels, results };
}

/** A `determinism` reply, its form checked: the times compared, ascending and unique, and each time's two sides. */
export function determinism(reply: JsonObject, what: string): Determinism {
  expect(outcome(reply), `${what} compared: ${JSON.stringify(reply).slice(0, 1200)}`).toBe('compared');
  const at_times = arr(reply['at_times'], `${what}: at_times`).map((v, i) => int(v, `${what}: at_times[${i}]`));
  for (let i = 1; i < at_times.length; i++) expect(at_times[i]! > at_times[i - 1]!, `${what}: at_times is ascending and unique at [${i}]: ${at_times[i - 1]} then ${at_times[i]}`).toBe(true);
  const frames = arr(reply['frames'], `${what}: frames`).map((v, i): Compared => {
    const f = obj(v, `${what}: frames[${i}]`);
    return { t: int(f['t'], `${what}: frames[${i}].t`), play: side(f['play'], `${what}: frames[${i}].play`), seek: side(f['seek'], `${what}: frames[${i}].seek`) };
  });
  expect(frames.map((f) => f.t), `${what}: one comparison per time, in at_times order`).toEqual(at_times);
  return { at_times, frames, raw: reply };
}

/**
 * Criterion 1's and 7's check: at every time, the seek's canonical render equals the play's, pixel for
 * pixel, and so does every node's result. Failures are in time order; each names the flick, and the
 * modules of the nodes whose results differ there.
 */
export function seekPlayFailures(d: Determinism, what: string): string[] {
  const failures: string[] = [];
  for (const f of d.frames) {
    const differing: string[] = [];
    for (const [id, p] of f.play.results) {
      const s = f.seek.results.get(id);
      if (!s) differing.push(`${id} (module ${p.module}) missing from the seek`);
      else if (s.result !== p.result) differing.push(`${id} (module ${p.module})`);
    }
    for (const [id, s] of f.seek.results) if (!f.play.results.has(id)) differing.push(`${id} (module ${s.module}) missing from the play`);
    if (f.play.pixels !== f.seek.pixels) failures.push(`${what}: at ${f.t} flicks the seek's frame differs from the play's (pixels ${f.seek.pixels.slice(0, 12)}… against ${f.play.pixels.slice(0, 12)}…); results differ on ${differing.length ? differing.join(', ') : 'no node'}`);
    else if (differing.length) failures.push(`${what}: at ${f.t} flicks the seek's results differ from the play's on ${differing.join(', ')} while the pixels agree`);
  }
  return failures;
}
/** The first flick at which a comparison failed, from its failures. */
export function firstFailingFlick(failures: readonly string[]): number | null {
  const m = /at (-?\d+) flicks/.exec(failures[0] ?? '');
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------------------------------------------
// Documents as an agent sends them

export const rect = (id: string, box: number[], order: string, role = 'muted', extra: JsonObject = {}): JsonObject =>
  ({ id, kind: 'rect@1', name: `Rect ${id}`, order, params: { box, paint: { fill: { role } } }, ...extra });
export const label = (id: string, text: string, pos: [number, number], order: string): JsonObject =>
  ({ id, kind: 'text@1', name: `Label ${id}`, order, params: { text, font: 'body', size: 13, box: { w: 160, h: 20 } }, at: { pos: [pos[0], pos[1], 0] } });
export const SEED_OF_DOCS = 488;
export function board(title: string, items: JsonObject[], extra: JsonObject = {}): JsonObject {
  return {
    format: 1, profile: 'board', seed: SEED_OF_DOCS, title,
    description: `${title}, drawn by a test agent through deep_show for the #488 acceptance tests.`,
    size: SIZE, items: Object.fromEntries(items.map((i) => [String(i['id']), i])), ...extra,
  };
}
export const requires = (modules: Record<string, string>): JsonObject => ({ requires: { modules } });
/** A clip that slides the rect in `slot` along x from `from` to `to` over `span` (a time literal), placed at `start`. */
export function slide(item: string, from: number, to: number, span = '2s', start = '0s'): JsonObject {
  return {
    clips: { slide: { slots: { target: { type: 'rect@1', required: true } }, span: 'auto', channels: { x: { target: 'slot:target/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: from, interp: 'linear' }, k1: { t: span, value: to, interp: 'linear' } } } } } },
    placements: { p: { clip: 'slide', slots: { target: item }, start } },
  };
}
/** The backdrop every board starts with. */
export const BACK = rect('back', [0, 0, 320, 200], 'a0', 'ground');
/** A board whose rect `mover` slides from x 16 to 216 over 2 s and rests; the document spans 3 s. */
export const SLIDING: JsonObject = board('Sliding rect', [
  BACK, rect('mover', [0, 0, 40, 30], 'a1', 'ink', { at: { pos: [16, 40, 0] } }), rect('r2', [16, 100, 40, 30], 'a2'), label('l1', 'Canvas time', [16, 150], 'a3'),
], { transport: { span: '3s' }, ...slide('mover', 16, 216) });
/** A board with nothing that moves. */
export const STILL: JsonObject = board('Still board', [BACK, rect('r1', [16, 40, 40, 30], 'a1', 'ink'), rect('r2', [16, 100, 40, 30], 'a2'), label('l1', 'Still', [16, 150], 'a3')], { transport: { span: '3s' } });
