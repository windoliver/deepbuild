// Test-side tools for the #540 acceptance tests (README: The surface under test). They build `deep-show` (once per
// file) and #544's assembler (../544/wat, read only), keep evidence stores, drive `deep-show run` (one JSON scenario on
// stdin, one answer line, as #383's, #504's and #539's suites drive it) and read the replies. Nothing here stands in for
// the input module, the hit test, the logic module or the physics module: every entry, byte, hash and contact read here
// is the implementation's own; every expected value comes from the issue's text, the design, geometry.ts and this
// suite's own programs.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import type { V2, V3 } from './geometry.ts';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/540 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** rustup's cargo on this Mac (Homebrew's rustup keeps it off the default PATH). */
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` } : {}),
};
const MIB = 1024 * 1024;

/** The build's timeout (a first build of deep-show takes many minutes on a loaded machine); each test passes its own. */
export const BUILD_TIMEOUT = 3_600_000;
export const TIMEOUT = 1_800_000;

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: 'AC1 #540.ba264743',
  2: 'AC2 #540.88ffa39f',
  3: 'AC3 #540.c9bfe882',
  4: 'AC4 #540.5ca93239',
  5: 'AC5 #540.4d24f725',
  6: 'AC6 #540.097a4bdc',
  7: 'AC7 #540.cd0a870f',
  8: 'AC8 #540.430b1895',
  9: 'AC9 #540.3d447f83',
  10: 'AC10 #540.a41e287c',
  11: 'AC11 #540.2aa57686',
} as const;

/** A host or record this machine lacks: the test fails with this message, never passes (invariant 2). */
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}; this is not a pass`); };

// ---------------------------------------------------------------------------------------------------
// Time: 705,600,000 flicks a second.

export const FLICKS = 705_600_000;
export const MS = FLICKS / 1000;
/** A 60 Hz logic step, and the scope's 120 Hz frame (#383's virtual clock). */
export const STEP60 = FLICKS / 60;
export const FRAME = FLICKS / 120;
const CLOCK: JsonObject = { refresh_hz: 120, lead: 2 * MS, check: MS / 2 };
const DISPLAY: [number, number] = [2560, 1600];

// ---------------------------------------------------------------------------------------------------
// JSON

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: unknown, n = 1500): string => JSON.stringify(v)?.slice(0, n) ?? 'undefined';
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v, 600)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v, 600)}`).toBe(true);
  return v as JsonValue[];
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a number, got ${show(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${show(v, 600)}`).toBe('string');
  return v as string;
}
export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 30).join('\n  ')}`).toEqual([]);
}
/** A planted program's run: this suite's own judgement must fail it, and some failure must match every one of `named`. */
export function failsNaming(failures: readonly string[], named: RegExp[], what: string): void {
  expect(failures.length, `${what}: the criterion's check fails the planted program`).toBeGreaterThan(0);
  expect(failures.some((f) => named.every((n) => n.test(f))), `${what}: a failure names ${named.join(' and ')}; the failures:\n  ${failures.slice(0, 12).join('\n  ')}`).toBe(true);
}
/** Runs `make` once per file, the first time a test asks (a file's tests share one run of a scenario). */
export function once<T>(make: () => T): () => T {
  let done: { value: T } | null = null;
  return () => (done ??= { value: make() }).value;
}

// ---------------------------------------------------------------------------------------------------
// Builds: `cargo build --locked --bin deep-show` (the default `full` set), once per file, copied out of the target.

const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
function cargo(args: string[], cwd: string, env: NodeJS.ProcessEnv): string {
  const run = spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { ...process.env, ...CARGO_ENV, ...env } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Updating|Locking|was not used|^warning|^\s*(\||=|-->)|^\s*\d+ \|/.test(l)).join('\n').slice(-4000)}`;
  return '';
}
let binsDir = '';
let built: { bin: string; error: string } | null = null;
function build(): { bin: string; error: string } {
  if (built) return built;
  if (!binsDir) binsDir = mkdtempSync(join(tmpdir(), 'deep-540-bins-'));
  const bin = join(binsDir, exe('deep-show'));
  const error = cargo(['build', '--locked', '--bin', 'deep-show'], REPO, {});
  if (error === '') copyFileSync(join(TARGET, 'debug', exe('deep-show')), bin);
  built = { bin, error };
  return built;
}
/** Builds before a file's tests (the slow part), so each test's own time is its own. */
export function prebuild(): void {
  beforeAll(() => { build(); }, BUILD_TIMEOUT);
}
/** The built binary; a test that uses a build that failed fails, naming cargo's error. */
export function binOf(): string {
  const out = build();
  if (/cargo could not run/.test(out.error)) blocked(`${out.error}: this machine lacks the Rust toolchain`);
  expect(out.error, 'deep-show builds on this host: cargo build --locked --bin deep-show').toBe('');
  return out.bin;
}
afterAll(() => { if (binsDir) rmSync(binsDir, { recursive: true, force: true }); binsDir = ''; built = null; });

// ---------------------------------------------------------------------------------------------------
// Programs: WebAssembly text assembled by #544's assembler (../544/wat, outside the workspace), in its own target.

export interface Program { name: string; bytes: Buffer; sha: string }
const WAT_DIR = join(REPO, 'tests', 'acceptance', '544', 'wat');
const WAT_TARGET = join(TARGET, 'acceptance-540-wat');
let watBin = '';
function assembler(): string {
  if (watBin) return watBin;
  const error = cargo(['build', '--locked', '--manifest-path', join(WAT_DIR, 'Cargo.toml')], WAT_DIR, { CARGO_TARGET_DIR: WAT_TARGET });
  if (error) blocked(`#544's assembler (tests/acceptance/544/wat) didn't build: ${error}`);
  watBin = join(WAT_TARGET, 'debug', exe('acceptance-544-wat'));
  return watBin;
}
const assembled = new Map<string, Program>();
/** Assembles WebAssembly text into a Program. */
export function assemble(name: string, text: string): Program {
  const known = assembled.get(`${name}\n${text}`);
  if (known) return known;
  const dir = mkdtempSync(join(tmpdir(), 'deep-540-wat-'));
  try {
    const file = join(dir, `${name}.wat`);
    writeFileSync(file, text);
    const run = spawnSync(assembler(), [dir, file], { encoding: 'utf8', maxBuffer: 64 * MIB });
    if (run.status !== 0) throw Error(`the assembler refused ${name}: ${run.stderr.slice(-2000)}`);
    const bytes = readFileSync(join(dir, `${name}.wasm`));
    const p = { name, bytes, sha: sha256(bytes) };
    assembled.set(`${name}\n${text}`, p);
    return p;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------------
// The evidence store (#15's layout: `<2 hex>/<62 hex>`, each file named by its bytes' SHA-256) and temporary folders.

export function putEvidence(evidence: string, bytes: Uint8Array): string {
  const h = sha256(bytes);
  mkdirSync(join(evidence, h.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, h.slice(0, 2), h.slice(2)), bytes);
  return h;
}
/** A fresh folder per call, deleted after the test. */
export function useTemp(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-540-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line on stdin, one answer `{ok, replies}`.

/** The scenario's `planted` values this suite adds (README: Planted twins). */
export type Planted =
  | 'press_cell_next_frame' | 'box_corners_on_replay' | 'ground_meets_behind_eye' | 'surface_uv_nearest_vertex' | 'surface_hit_on_replay'
  | 'surface_at_rest' | 'throw_reads_camera' | 'box_keys_at_apply' | 'point_pick_one_pixel' | 'point_pick_nearest_depth';
export const SESSION = 'sess-540';
const SESSIONS: JsonObject = { [SESSION]: { thread: 'thread-540', name: 'Claude Code: game input', process: { pid: 4100, start: 1_000 } } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 4100, ppid: 1, start: 1_000 }];
/** Document IDs the hub minted (26 Crockford characters). */
export const DOC = (n: number): string => `01JB540D${String(n).padStart(18, '0')}`;

/** A document in a visible panel of its own: `p<i>`, `rect` [0, 0, w, h] (the frame fills it, 1 px a frame px). */
export interface Shown { id: string; size: V2 }
/**
 * A scenario: the agent's session, the process table, each document in a visible panel of its own, the scope's virtual
 * clock and a display, `planted` when given, and the calls.
 */
export function scenario(evidence: string, docs: readonly Shown[], calls: JsonObject[], planted?: Planted): JsonObject {
  const panels: JsonObject = {};
  const docMap: JsonObject = {};
  docs.forEach((d, i) => { panels[`p${i + 1}`] = { rect: [0, 0, d.size[0], d.size[1]] }; docMap[d.id] = { panel: `p${i + 1}` }; });
  return { evidence, sessions: SESSIONS, processes: PROCESSES, panels, docs: docMap, clock: CLOCK, display: DISPLAY, ...(planted ? { planted } : {}), calls };
}
/** `deep-show run` on one scenario: exit 0, one answer line, ok, one reply per call, in call order. */
export function runShow(bin: string, sc: JsonObject, what: string): JsonObject[] {
  const tag = typeof sc['planted'] === 'string' ? `${what} (planted ${sc['planted']})` : what;
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 2048 * MIB, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${tag}: deep-show run did not finish within its timeout`);
  const stdout = r.stdout ?? '';
  expect(r.status, `${tag}: deep-show run exits 0 (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 800)}; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${tag}: one answer line`).toBe(1);
  let parsed: JsonValue;
  try { parsed = JSON.parse(lines[0]!) as JsonValue; } catch { parsed = lines[0]!; }
  const out = obj(parsed, `${tag}: the answer`);
  expect(out['ok'], `${tag}: deep-show run answers the scenario ok${typeof sc['planted'] === 'string' ? ` (it takes the planted ${sc['planted']})` : ''}; got ${show(out)}`).toBe(true);
  const list = arr(out['replies'], `${tag}: replies`).map((x, i) => obj(x, `${tag}: replies[${i}]`));
  expect(list.length, `${tag}: one reply per call`).toBe(arr(sc['calls'], 'calls').length);
  return list;
}

/** The agent's `deep_show` of a whole document (#393), with its issues. */
export const showCall = (doc: string, document: JsonObject, at: number): JsonObject =>
  ({ call: 'deep_show', session: SESSION, doc, document, include: ['issues'], at });
export function issuesOf(reply: JsonObject): JsonObject[] {
  const list = reply['issues'];
  return Array.isArray(list) ? list.filter(isObject) : [];
}
/** A `deep_show` reply that presented its document, with no error; the message lists the issues when it didn't. */
export function presented(reply: JsonObject, what: string): void {
  expect(reply['outcome'], `${what} is presented: ${show(reply['issues'] ?? reply, 2500)}`).toBe('presented');
  expect(issuesOf(reply).filter((i) => i['severity'] === 'error'), `${what} is presented with no error`).toEqual([]);
}

// ---------------------------------------------------------------------------------------------------
// The calls of one run, on the scope's virtual clock, each at its own `at`, in order; each method gives the index of its
// call, so a test reads that call's reply.

export type Button = 'primary' | 'secondary' | 'middle';
export class Script {
  readonly calls: JsonObject[] = [];
  private t = 0;
  /** The panel the next inputs and `scope` go to. */
  constructor(public panel = 'p1') {}
  /** The time of the last call, in flicks. */
  get now(): number { return this.t; }
  private add(c: JsonObject, gap: number): number {
    this.t += Math.round(gap);
    this.calls.push({ ...c, at: this.t });
    return this.calls.length - 1;
  }
  present(doc: string, document: JsonObject): number { return this.add(showCall(doc, document, 0), MS / 1000); }
  scope(): number { return this.add({ call: 'scope', panel: this.panel }, 160 * MS); }
  /** An input `gap` flicks after the last call (README: `input`'s events). */
  input(event: JsonObject, gap = 100 * MS): number { return this.add({ call: 'input', panel: this.panel, event }, gap); }
  down(p: V2, button: Button = 'primary', gap = 200 * MS): number { return this.input({ type: 'down', pos: p, button }, gap); }
  move(p: V2, button: Button | null = 'primary', gap = FRAME): number { return this.input({ type: 'move', pos: p, ...(button ? { button } : {}) }, gap); }
  up(p: V2, button: Button = 'primary', gap = FRAME): number { return this.input({ type: 'up', pos: p, button }, gap); }
  /** A click: a press and a release 60 ms apart at `p`. */
  click(p: V2): [number, number] { return [this.down(p), this.up(p, 'primary', 60 * MS)]; }
  /** A drag with `button` through `points`: a press at the first, a move at each of the rest one frame apart, a release at the last. */
  drag(points: readonly V2[], button: Button = 'primary'): number[] {
    const out = [this.down(points[0]!, button)];
    for (const p of points.slice(1)) out.push(this.move(p, button));
    out.push(this.up(points[points.length - 1]!, button));
    return out;
  }
  /** The viewer's orbit: a drag with the middle button `dx` px to the right from `from` (README: The orbit). */
  orbit(from: V2, dx: number): number[] {
    return this.drag([1, 2, 3, 4].reduce<V2[]>((ps, i) => [...ps, [from[0] + (dx * i) / 4, from[1]]], [from]), 'middle');
  }
  /** README: `logic`. The document's logic items stepped 0 to `steps` − 1 on its input track, with a check when asked. */
  logic(doc: string, steps: number, check?: 'logic.determinism'): number { return this.add({ call: 'logic', doc, steps, ...(check ? { check } : {}) }, 50 * MS); }
  /** README: `world`. The world baked again from step 0 over the span, on the document's input track as the hub holds it. */
  world(doc: string, world: string): number { return this.add({ call: 'world', doc, world }, 50 * MS); }
  /** README: `match`. Every copy of the document's match run in lockstep over a test relay, `steps` match steps. */
  match(doc: string, steps: number): number { return this.add({ call: 'match', doc, steps }, 50 * MS); }
  /** Moves the clock to `t` flicks (the next call comes then, plus its own gap). */
  until(t: number): void { this.t = Math.max(this.t, t); }
}

/** A reply's scope state (#383's `state`). */
export function stateOf(reply: JsonObject, what: string): JsonObject {
  return obj(reply['state'], `${what}: state (${show(reply, 600)})`);
}
/** The 3D camera the scope shows (#383's `state.camera`: the pose with the viewer's offsets). */
export interface Seen { position: V3; target: V3; azimuth: number; fov: number; viewWidth: number }
export function cameraOf(reply: JsonObject, what: string): Seen {
  const c = obj(stateOf(reply, what)['camera'], `${what}: state.camera`);
  const v3 = (k: string): V3 => arr(c[k], `${what}: camera.${k}`).map((x, i) => num(x, `${what}: camera.${k}[${i}]`)) as V3;
  return { position: v3('position'), target: v3('target'), azimuth: num(c['azimuth'], `${what}: camera.azimuth`), fov: num(c['fov'], `${what}: camera.fov`), viewWidth: num(c['view_width'], `${what}: camera.view_width`) };
}
/** The entries an input appended to the document's input track (`input`'s `appended`, #504). */
export function appendedOf(reply: JsonObject, what: string): JsonObject[] {
  return arr(reply['appended'], `${what}: appended (${show(reply, 600)})`).map((e, i) => obj(e, `${what}: appended[${i}]`));
}
/** Every entry the calls `idx` appended for `control`, in order. */
export function entriesOf(replies: readonly JsonObject[], idx: readonly number[], control: string): JsonObject[] {
  return idx.flatMap((i) => appendedOf(replies[i]!, `call ${i}`)).filter((e) => e['control'] === control);
}

// ---------------------------------------------------------------------------------------------------
// A point control's value (README: An entry), decoded. A field the entry doesn't hold reads null (JSON null or absent).

export interface Hit { set: number; key: [number, number] }
export interface Surface { point: V3; normal: V3 | null; uv: V2 | null; face: number | null }
export interface PointValue {
  phase: string | null; button: string | null; cell: V2 | null; ground: V3 | null; hit: Hit | null; corners: (V3 | null)[] | null;
  surface: Surface | null; ray: { origin: V3; dir: V3 } | null; units: { keys: V2[]; truncated: boolean } | null;
}
const numbers = (v: JsonValue | undefined, n: number): number[] | null =>
  Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number') ? (v as number[]) : null;
export function valueOf(entry: JsonObject): PointValue {
  const v = isObject(entry['value']) ? entry['value'] : {};
  const hit = isObject(v['hit']) && typeof v['hit']['set'] === 'number' && numbers(v['hit']['key'], 2) ? { set: v['hit']['set'], key: numbers(v['hit']['key'], 2) as V2 } : null;
  const s = isObject(v['surface']) ? v['surface'] : null;
  const surface = s && numbers(s['point'], 3) ? {
    point: numbers(s['point'], 3) as V3, normal: numbers(s['normal'], 3) as V3 | null, uv: numbers(s['uv'], 2) as V2 | null, face: typeof s['face'] === 'number' ? s['face'] : null,
  } : null;
  const r = isObject(v['ray']) ? v['ray'] : null;
  const ray = r && numbers(r['origin'], 3) && numbers(r['dir'], 3) ? { origin: numbers(r['origin'], 3) as V3, dir: numbers(r['dir'], 3) as V3 } : null;
  const u = isObject(v['units']) ? v['units'] : null;
  const units = u && Array.isArray(u['keys']) ? { keys: u['keys'].map((k) => numbers(k, 2) as V2), truncated: u['truncated'] === true } : null;
  return {
    phase: typeof v['phase'] === 'string' ? v['phase'] : null, button: typeof v['button'] === 'string' ? v['button'] : null,
    cell: numbers(v['cell'], 2) as V2 | null, ground: numbers(v['ground'], 3) as V3 | null, hit,
    corners: Array.isArray(v['corners']) ? v['corners'].map((c) => numbers(c, 3) as V3 | null) : null, surface, ray, units,
  };
}
/** How a failure names an entry: its control, phase and flick. */
export const entryName = (e: JsonObject): string => `the ${valueOf(e).phase ?? '?'} entry of ${String(e['control'])} at t ${String(e['t'])}`;
export const entriesText = (list: readonly JsonObject[]): string => show(list.map((e) => ({ control: e['control'] ?? null, t: e['t'] ?? null, value: e['value'] ?? null })), 1500);
/** Two entries are the same: the same control, flick and value. */
export const sameEntry = (a: JsonObject, b: JsonObject): boolean => a['control'] === b['control'] && a['t'] === b['t'] && JSON.stringify(a['value']) === JSON.stringify(b['value']);

/** The entry's flick time and control appear together in some object of a check's failures. */
export function namesEntry(v: JsonValue | undefined, entry: JsonObject): boolean {
  if (Array.isArray(v)) return v.some((x) => namesEntry(x, entry));
  if (!isObject(v)) return false;
  if (v['control'] === entry['control'] && v['t'] === entry['t']) return true;
  return Object.values(v).some((x) => namesEntry(x, entry));
}

// ---------------------------------------------------------------------------------------------------
// `logic` (README; #539's call): each step's hash and arrays per logic item, the track it read, and the check when asked.

export interface LogicStep { step: number; t: number | null; hash: Record<string, string>; arrays: Record<string, JsonValue[]> }
export interface LogicRun { steps: LogicStep[]; track: JsonObject[]; check: JsonObject | null }
export function stepsOf(v: JsonValue | undefined, what: string): LogicStep[] {
  return arr(v, `${what}: steps`).map((s, i): LogicStep => {
    const o = obj(s, `${what}: steps[${i}]`);
    const hash = obj(o['hash'], `${what}: steps[${i}].hash`);
    const arrays = obj(o['arrays'], `${what}: steps[${i}].arrays`);
    return {
      step: num(o['step'], `${what}: steps[${i}].step`), t: typeof o['t'] === 'number' ? o['t'] : null,
      hash: Object.fromEntries(Object.entries(hash).map(([k, v]) => [k, str(v, `${what}: steps[${i}].hash.${k}`)])),
      arrays: Object.fromEntries(Object.entries(arrays).map(([k, v]) => [k, arr(v, `${what}: steps[${i}].arrays.${k}`)])),
    };
  });
}
export function logicOf(reply: JsonObject, what: string): LogicRun {
  expect(reply['code'], `${what}: the logic call answers, not refuses: ${show(reply, 1500)}`).toBeUndefined();
  const track = arr(reply['track'], `${what}: track`).map((e, i) => obj(e, `${what}: track[${i}]`));
  return { steps: stepsOf(reply['steps'], what), track, check: isObject(reply['check']) ? reply['check'] : null };
}
/** An array as the last step of a run left it, as numbers (a bool true reads 1). */
export function lastArray(steps: readonly LogicStep[], name: string): number[] | null {
  const a = steps[steps.length - 1]?.arrays[name];
  if (!Array.isArray(a)) return null;
  return a.map((x) => (x === true ? 1 : x === false ? 0 : typeof x === 'number' ? x : NaN));
}
/** The steps whose hashes differ between two runs, by item, the first first. */
export function hashDiff(a: readonly LogicStep[], b: readonly LogicStep[]): string | null {
  for (const s of a) {
    const o = b.find((x) => x.step === s.step);
    const differ = Object.keys({ ...s.hash, ...(o?.hash ?? {}) }).filter((k) => s.hash[k] !== o?.hash[k]);
    if (differ.length) return `step ${s.step}'s hash differs for ${differ.join(', ')}`;
  }
  return a.length === b.length ? null : `the runs report ${a.length} and ${b.length} steps`;
}
export const verdictOf = (check: JsonObject | null): string => (check && typeof check['verdict'] === 'string' ? check['verdict'] : `no verdict (${show(check, 400)})`);

// ---------------------------------------------------------------------------------------------------
// The cross-machine record (criterion 2): this machine's box entries, written to a file; the other machine's read from
// the path DEEP_540_OTHER_RECORD names (README: The other machine).

export const RECORDS = join(TARGET, 'acceptance-540');
export const PLATFORM = `${process.platform}-${process.arch}`;
/** The pair the criterion names: macOS on arm64 and Linux on aarch64 (Node names both arches arm64). */
export const PAIR: Record<string, string> = { 'darwin-arm64': 'linux-arm64', 'linux-arm64': 'darwin-arm64' };
export function writeRecord(name: string, record: JsonObject): string {
  mkdirSync(RECORDS, { recursive: true });
  const file = join(RECORDS, `${name}-${PLATFORM}.json`);
  writeFileSync(file, `${JSON.stringify({ platform: process.platform, arch: process.arch, ...record }, null, 1)}\n`);
  return file;
}
export function otherRecord(): JsonObject {
  const path = process.env['DEEP_540_OTHER_RECORD'];
  const want = PAIR[PLATFORM];
  if (!want) return blocked(`criterion 2 compares macOS arm64 with Linux aarch64, and this machine is ${PLATFORM}`);
  if (!path) return blocked(`DEEP_540_OTHER_RECORD names no record; run this test on ${want} and point the variable at the box-entries-${want}.json it writes`);
  if (!existsSync(path)) return blocked(`DEEP_540_OTHER_RECORD names ${path}, which doesn't exist`);
  const o = JSON.parse(readFileSync(path, 'utf8')) as JsonValue;
  if (!isObject(o) || `${String(o['platform'])}-${String(o['arch'])}` !== want) blocked(`the record ${path} is from ${isObject(o) ? `${String(o['platform'])}-${String(o['arch'])}` : 'nowhere'}, not ${want}, the other machine of the pair`);
  return o as JsonObject;
}
