// Test-side tools for the #539 acceptance tests (README: The surface under test). They build `deep-show` (once per
// file) and #544's assembler (../544/wat, read only), keep evidence stores, drive `deep-show run` (one JSON scenario on
// stdin, one answer line, as #383's, #504's and #535's suites drive it) and `deep-show screen` (#1162's window), and
// read the replies and the PNGs they store. PNG reading and writing come from ../467/helpers.ts by import. Nothing here
// stands in for the input module, the hit test, the focus, the logic module, the renderer or the export: every entry,
// focus, announcement, byte, hash and pixel read here is the implementation's own; every expected value comes from the
// issue's text, the design and this suite's own programs.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import { decodePng, encodeApng, encodeRgbaPng, type Image } from '../467/helpers.ts';

export { decodePng, encodeApng, encodeRgbaPng, type Image };
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/539 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
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
  1: 'AC1 #539.798cb59a',
  2: 'AC2 #539.262f22dd',
  3: 'AC3 #539.78972f29',
  4: 'AC4 #539.953cfa78',
  5: 'AC5 #539.ece9dcef',
  6: 'AC6 #539.95971461',
} as const;

/** A host or tool this machine lacks: the test fails with this message, never passes (invariant 2). */
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}; this is not a pass`); };
export const inconclusive = (why: string): never => expect.fail(`INCONCLUSIVE: ${why}; this is not a pass`);

// ---------------------------------------------------------------------------------------------------
// Time: 705,600,000 flicks a second; a 60 Hz logic step is 11,760,000.

export const FLICKS = 705_600_000;
export const STEP = FLICKS / 60;
export const MS = FLICKS / 1000;
/** The scope's virtual clock (#383's): 120 Hz, the latch 2 ms before vsync, 0.5 ms of the checker. */
export const PERIOD = FLICKS / 120;
const CLOCK: JsonObject = { refresh_hz: 120, lead: 2 * MS, check: MS / 2 };
const DISPLAY: [number, number] = [1600, 900];
/** The display the reference window (1512 × 982 points) sits on. */
const WINDOW_DISPLAY: [number, number] = [1728, 1117];

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
/** The integers a label says, in order ("3, 2", "(3, 2)" and "Cell 3, 2" all say [3, 2]). */
export const intsOf = (text: string): number[] => (text.match(/-?\d+/g) ?? []).map(Number);

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
  if (!binsDir) binsDir = mkdtempSync(join(tmpdir(), 'deep-539-bins-'));
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
const WAT_TARGET = join(TARGET, 'acceptance-539-wat');
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
  const dir = mkdtempSync(join(tmpdir(), 'deep-539-wat-'));
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
export function getEvidence(evidence: string, h: string, what: string): Buffer {
  const path = join(evidence, h.slice(0, 2), h.slice(2));
  expect(existsSync(path), `${what}: the evidence store holds ${h}`).toBe(true);
  return readFileSync(path);
}
/** A fresh folder per call, deleted after the test. */
export function useTemp(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-539-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line on stdin, one answer `{ok, replies}`.

/** The scenario's `planted` values this suite adds (README: Planted twins). */
export type Planted = 'pick_resolves_on_replay' | 'hit_ignores_alive' | 'hit_by_quad_bounds' | 'export_keeps_live_hover' | 'focus_stops_on_hidden_rows';
export const SESSION = 'sess-539';
const SESSIONS: JsonObject = { [SESSION]: { thread: 'thread-539', name: 'Claude Code: game input', process: { pid: 4100, start: 1_000 } } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 4100, ppid: 1, start: 1_000 }];
/** Document IDs the hub minted (26 Crockford characters). */
export const DOC = (n: number): string => `01JB539D${String(n).padStart(18, '0')}`;
export type Rect = [number, number, number, number];

export interface ScenarioOptions { planted?: Planted; rect?: Rect; window?: [number, number] }
/**
 * A scenario: the agent's session, the process table, each document in a visible panel of its own (`rect`), the
 * scope's virtual clock and a display, the app's window when asked (for `screen`), `planted` when given, and the calls.
 */
export function scenario(evidence: string, docs: string[], calls: JsonObject[], o: ScenarioOptions = {}): JsonObject {
  const panels: JsonObject = {};
  const docMap: JsonObject = {};
  docs.forEach((d, i) => { panels[`p${i + 1}`] = { rect: o.rect ?? [0, 0, 896, 896] }; docMap[d] = { panel: `p${i + 1}` }; });
  return {
    evidence, sessions: SESSIONS, processes: PROCESSES, panels, docs: docMap, clock: CLOCK, display: o.window ? WINDOW_DISPLAY : DISPLAY,
    ...(o.window ? { window: o.window } : {}), ...(o.planted ? { planted: o.planted } : {}), calls,
  };
}
/** `deep-show run` on one scenario: exit 0, one answer line, ok, one reply per call, in call order. */
export function runShow(bin: string, sc: JsonObject, what: string): JsonObject[] {
  const tag = typeof sc['planted'] === 'string' && !what.includes(`planted ${sc['planted']}`) ? `${what} (planted ${sc['planted']})` : what;
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
/** `deep-show screen` (#1162): the scenario's calls run, then the app's window drawn at `t` flicks at `scale`, written to `out`. */
export function runScreen(bin: string, sc: JsonObject, out: string, t: number, scale: number, what: string): Image {
  const r = spawnSync(bin, ['screen'], { cwd: REPO, input: `${JSON.stringify({ ...sc, out, t, scale })}\n`, encoding: 'utf8', maxBuffer: 256 * MIB, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  const stdout = (r.stdout ?? '').trim();
  let reply: JsonValue;
  try { reply = JSON.parse(stdout.split('\n').pop() ?? '') as JsonValue; } catch { reply = stdout; }
  if (isObject(reply) && reply['code'] === 'unsupported_platform') inconclusive(`${what}: the app's window draws on macOS; this is ${process.platform}`);
  const o = obj(reply, `${what}: deep-show screen's answer (stderr ${(r.stderr ?? '').slice(-800)})`);
  expect(o['ok'], `${what}: deep-show screen draws the window: ${show(o)}`).toBe(true);
  expect(existsSync(out), `${what}: the window's PNG is written`).toBe(true);
  return decodePng(readFileSync(out));
}

// ---------------------------------------------------------------------------------------------------
// The calls

/** The agent's `deep_show` of a whole document (#393), with its issues. */
export const showCall = (doc: string, document: JsonObject, at: number): JsonObject =>
  ({ call: 'deep_show', session: SESSION, doc, document, include: ['issues'], at });
/** A `deep_show` reply that presented its document, with no error; the message lists the issues when it didn't. */
export function presented(reply: JsonObject, what: string): void {
  expect(reply['outcome'], `${what} is presented: ${show(reply['issues'] ?? reply, 2500)}`).toBe('presented');
  const errors = issuesOf(reply).filter((i) => i['severity'] === 'error');
  expect(errors, `${what} is presented with no error`).toEqual([]);
}
export function issuesOf(reply: JsonObject): JsonObject[] {
  const list = reply['issues'];
  return Array.isArray(list) ? list.filter(isObject) : [];
}
/** An issue's own fields as text, without its prose (`what`, `fix`) or its close names: what it names. */
export const namedIn = (issue: JsonObject): string => { const { what: _w, fix: _f, close: _c, ...rest } = issue; return JSON.stringify(rest); };
/** `word` stands as a whole name in `text` (a dot or a slash may join it to others). */
export const names = (text: string, word: string): boolean => new RegExp(`(^|[^A-Za-z0-9_])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9_]|$)`).test(text);
/** The issue names item `id`: its `ids` hold it, or its `path` is `items/<id>` or under it. */
export function namesItem(issue: JsonObject, id: string): boolean {
  const ids = Array.isArray(issue['ids']) ? issue['ids'].map(String) : [];
  const path = typeof issue['path'] === 'string' ? issue['path'] : '';
  return ids.includes(id) || path === `items/${id}` || path.startsWith(`items/${id}/`);
}

export type Pt = [number, number];
/** The camera a panel's scope shows (#383's `state.camera`, `state.rect`), mapping a page point (u) to panel px. */
export interface View { target: number[]; width: number; rect: number[] }
export function viewOf(state: JsonObject, what: string): View {
  const cam = obj(state['camera'], `${what}: state.camera`);
  return {
    target: arr(cam['target'], `${what}: camera.target`).map((v, i) => num(v, `${what}: camera.target[${i}]`)),
    width: num(cam['view_width'], `${what}: camera.view_width`),
    rect: arr(state['rect'], `${what}: state.rect`).map((v, i) => num(v, `${what}: state.rect[${i}]`)),
  };
}
export function toPanel(v: View, [x, y]: Pt): Pt {
  const k = v.width / v.rect[2]!;
  return [v.rect[0]! + v.rect[2]! / 2 + (x - v.target[0]!) / k, v.rect[1]! + v.rect[3]! / 2 + (y - v.target[1]!) / k];
}

/**
 * The calls of one run on the scope's virtual clock, each at its own `at`, in order; each method gives the index of its
 * call (a click: its press and its release), so a test reads that call's reply.
 */
export class Script {
  readonly calls: JsonObject[] = [];
  private t = 0;
  /** The panel the next inputs, `scope`, `see` and `view` go to. */
  constructor(public panel = 'p1') {}
  /** The time of the last call, in flicks. */
  get now(): number { return this.t; }
  private add(c: JsonObject, gapMs: number): number {
    this.t += Math.round(gapMs * MS);
    this.calls.push({ ...c, at: this.t });
    return this.calls.length - 1;
  }
  present(doc: string, document: JsonObject): number { return this.add(showCall(doc, document, 0), 0.001); }
  scope(): number { return this.add({ call: 'scope', panel: this.panel }, 160); }
  input(event: JsonObject, gapMs = 100): number { return this.add({ call: 'input', panel: this.panel, event }, gapMs); }
  /** A press and a release 60 ms apart at panel px `p`. */
  click(p: Pt): [number, number] { return [this.input({ type: 'down', pos: p }, 200), this.input({ type: 'up', pos: p }, 60)]; }
  key(key: string): number { return this.input({ type: 'key', key }, 100); }
  move(p: Pt): number { return this.input({ type: 'move', pos: p }, 100); }
  /** A plain drag from `a` to `b` in panel px: a press, four moves, a release. */
  drag(a: Pt, b: Pt): number[] {
    const out = [this.input({ type: 'down', pos: a }, 200)];
    for (let i = 1; i <= 4; i++) out.push(this.input({ type: 'move', pos: [a[0] + ((b[0] - a[0]) * i) / 4, a[1] + ((b[1] - a[1]) * i) / 4] }, 16));
    out.push(this.input({ type: 'up', pos: b }, 16));
    return out;
  }
  see(): number { return this.add({ call: 'see', panel: this.panel }, 50); }
  view(): number { return this.add({ call: 'view', panel: this.panel }, 50); }
  /** `eval` at `t` flicks with a render-back snapshot (#387): the document's own frame. */
  eval(doc: string, t: number): number { return this.add({ call: 'eval', doc, t, pixels: true }, 50); }
  /** The export (#501, #504): every frame of the span as a PNG sequence in `out`, at `fps`. */
  export(doc: string, out: string, fps: number): number { return this.add({ call: 'export', doc, out, video: { codec: 'png_seq' }, frame_rate: [fps, 1] }, 50); }
  /** README: `logic`. The document's logic items stepped 0 to `steps` − 1 on its input track, with a check when asked. */
  logic(doc: string, steps: number, check?: 'logic.determinism'): number { return this.add({ call: 'logic', doc, steps, ...(check ? { check } : {}) }, 50); }
  /** Waits `ms` on the clock (the next call comes that much later). */
  wait(ms: number): void { this.t += Math.round(ms * MS); }
}

/** The camera the panel's scope shows a document with, before any input: a first run, the document presented and its scope read. */
export function scopeView(bin: string, evidence: string, doc: string, document: JsonObject, o: Omit<ScenarioOptions, 'planted'>, what: string): View {
  const s = new Script();
  s.present(doc, document);
  const i = s.scope();
  const r = runShow(bin, scenario(evidence, [doc], s.calls, o), `${what}: presented and its scope read`);
  presented(r[0]!, what);
  return viewOf(stateOf(r[i]!, `${what}: the scope`), `${what}: the scope`);
}

/** A reply's scope state (#383's `state`). */
export function stateOf(reply: JsonObject, what: string): JsonObject {
  return obj(reply['state'], `${what}: state (${show(reply, 600)})`);
}
/** The Tab stop with focus (README: `state.focus`): a row as `<set>#<key>`, a control as its own ID, or null. */
export const focusOf = (reply: JsonObject, what: string): string | null => {
  const f = stateOf(reply, what)['focus'];
  return f === null || f === undefined ? null : str(f, `${what}: state.focus`);
};
export const selectionOf = (reply: JsonObject, what: string): JsonValue[] => arr(stateOf(reply, what)['selection'], `${what}: state.selection`);
/** The entries an input appended to the document's input track (`input`'s `appended`, #504). */
export function appendedOf(reply: JsonObject, what: string): JsonObject[] {
  return arr(reply['appended'], `${what}: appended (${show(reply, 600)})`).map((e, i) => obj(e, `${what}: appended[${i}]`));
}
/** A pick entry's value as the README gives it: `{set, key: [k0, k1]}`. */
export interface Pick { set: number; key: [number, number] }
export function pickOf(entry: JsonObject): Pick | null {
  const v = entry['value'];
  if (!isObject(v) || typeof v['set'] !== 'number' || !Array.isArray(v['key']) || v['key'].length !== 2) return null;
  const [a, b] = v['key'];
  return typeof a === 'number' && typeof b === 'number' ? { set: v['set'], key: [a, b] } : null;
}
export const pickText = (p: Pick | null): string => (p ? `{set ${p.set}, key (${p.key[0]}, ${p.key[1]})}` : 'no pick');
/** The entries' brief form, for messages. */
export const entriesText = (list: JsonObject[]): string => show(list.map((e) => ({ control: e['control'] ?? null, value: e['value'] ?? null, writer: e['writer'] ?? null, t: e['t'] ?? null })), 600);

/** `see` (#376): the panel's accessibility tree and every announcement made so far. */
export interface Seen { tree: JsonObject[]; announcements: { t: number | null; id: string; text: string }[] }
export function seenOf(reply: JsonObject, what: string): Seen {
  const tree = arr(reply['tree'], `${what}: see.tree (${show(reply, 600)})`).map((n, i) => obj(n, `${what}: tree[${i}]`));
  const announcements = arr(reply['announcements'], `${what}: see.announcements`).map((a, i) => {
    const o = obj(a, `${what}: announcements[${i}]`);
    return { t: typeof o['t'] === 'number' ? o['t'] : null, id: String(o['id'] ?? ''), text: String(o['text'] ?? '') };
  });
  return { tree, announcements };
}

// ---------------------------------------------------------------------------------------------------
// `logic` (README): each step's hash and arrays per logic item, the track it read, and the check when asked.

export interface LogicStep { step: number; t: number | null; hash: Record<string, string>; arrays: Record<string, JsonValue[]> }
export interface LogicRun { steps: LogicStep[]; track: JsonObject[]; check: JsonObject | null }
export function logicOf(reply: JsonObject, what: string): LogicRun {
  expect(reply['code'], `${what}: the logic call answers, not refuses: ${show(reply, 1500)}`).toBeUndefined();
  const steps = arr(reply['steps'], `${what}: steps`).map((s, i): LogicStep => {
    const o = obj(s, `${what}: steps[${i}]`);
    const hash = obj(o['hash'], `${what}: steps[${i}].hash`);
    const arrays = obj(o['arrays'], `${what}: steps[${i}].arrays`);
    return {
      step: num(o['step'], `${what}: steps[${i}].step`), t: typeof o['t'] === 'number' ? o['t'] : null,
      hash: Object.fromEntries(Object.entries(hash).map(([k, v]) => [k, str(v, `${what}: steps[${i}].hash.${k}`)])),
      arrays: Object.fromEntries(Object.entries(arrays).map(([k, v]) => [k, arr(v, `${what}: steps[${i}].arrays.${k}`)])),
    };
  });
  const track = arr(reply['track'], `${what}: track`).map((e, i) => obj(e, `${what}: track[${i}]`));
  return { steps, track, check: isObject(reply['check']) ? reply['check'] : null };
}

// ---------------------------------------------------------------------------------------------------
// Pixels: a page point (u) read in a picture of the whole page, at the picture's own scale.

export type Rgb = [number, number, number];
export function pagePixel(im: Image, page: [number, number], [x, y]: Pt): Rgb {
  const px = Math.floor((x * im.width) / page[0]);
  const py = Math.floor((y * im.height) / page[1]);
  const o = (py * im.width + px) * 4;
  return [im.rgba[o]!, im.rgba[o + 1]!, im.rgba[o + 2]!];
}
/** The largest per-channel difference in code values. */
export const codeOff = (a: Rgb, b: Rgb): number => Math.max(...[0, 1, 2].map((k) => Math.abs(a[k]! - b[k]!)));
/** Re-encodes a decoded picture so the same pixels always give the same bytes (criterion 6's files). */
export const pngBytes = (im: Image): Buffer => encodeRgbaPng(im.width, im.height, (x, y) => {
  const o = (y * im.width + x) * 4;
  return [im.rgba[o]!, im.rgba[o + 1]!, im.rgba[o + 2]!, im.rgba[o + 3]!];
});
