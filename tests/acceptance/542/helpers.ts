// Test-side tools for the #542 acceptance tests (README: The surface under test). They build the binaries a file needs
// (`deep-show`, `deep-input`, `deep-logic`, each once per file) and #544's assembler (../544/wat, read only), keep
// evidence stores, drive `deep-show run` and `deep-show screen` (one JSON scenario on stdin, as #539's suite drives
// them), `deep-input input` (#308's JSON lines, the input module's session at a frame rate) and `deep-logic` (#534's
// JSON lines, saves), and read their replies. PNG reading and writing come from ../467/helpers.ts by import. Nothing here
// stands in for the input module, the router, the text or scroll control, the logic module or the renderer: every
// entry, byte, hash, announcement and pixel read here is the implementation's own; every expected value comes from the
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
/** The checkout root (tests/acceptance/542 is three levels down). */
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
  1: 'AC1 #542.c4a60183',
  2: 'AC2 #542.e7435bc2',
  3: 'AC3 #542.8b5ba7e9',
  4: 'AC4 #542.8bfb66e0',
  5: 'AC5 #542.e6403c8d',
  6: 'AC6 #542.748790f7',
  7: 'AC7 #542.36e8999e',
  8: 'AC8 #542.49a44569',
  9: 'AC9 #542.f0bbc9b7',
  10: 'AC10 #542.5cccb17f',
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
/** The integers a text says, in order ("Row 190" and "row 190 of 200" both start with 190). */
export const intsOf = (text: string): number[] => (text.replace(/(\d)[,   ](?=\d{3}\b)/g, '$1').match(/-?\d+/g) ?? []).map(Number);
/** A string's UTF-8 bytes in hex, for messages: "65 cc 81". */
export const hexOf = (b: Uint8Array | string): string => [...(typeof b === 'string' ? Buffer.from(b, 'utf8') : b)].map((x) => x.toString(16).padStart(2, '0')).join(' ');

// ---------------------------------------------------------------------------------------------------
// Builds: `cargo build --locked --bin <name>` (the default features), once per file, copied out of the target.

export type Bin = 'deep-show' | 'deep-input' | 'deep-logic';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
function cargo(args: string[], cwd: string, env: NodeJS.ProcessEnv): string {
  const run = spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { ...process.env, ...CARGO_ENV, ...env } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Updating|Locking|was not used|^warning|^\s*(\||=|-->)|^\s*\d+ \|/.test(l)).join('\n').slice(-4000)}`;
  return '';
}
let binsDir = '';
const built = new Map<Bin, { bin: string; error: string }>();
function build(name: Bin): { bin: string; error: string } {
  const known = built.get(name);
  if (known) return known;
  if (!binsDir) binsDir = mkdtempSync(join(tmpdir(), 'deep-542-bins-'));
  const bin = join(binsDir, exe(name));
  const error = cargo(['build', '--locked', '--bin', name], REPO, {});
  if (error === '') copyFileSync(join(TARGET, 'debug', exe(name)), bin);
  const out = { bin, error };
  built.set(name, out);
  return out;
}
/** Builds the binaries a file uses before its tests (the slow part), so each test's own time is its own. */
export function prebuild(...names: Bin[]): void {
  beforeAll(() => { for (const n of names) build(n); }, BUILD_TIMEOUT);
}
/** A built binary; a test that uses a build that failed fails, naming cargo's error. */
export function binOf(name: Bin): string {
  const out = build(name);
  if (/cargo could not run/.test(out.error)) blocked(`${out.error}: this machine lacks the Rust toolchain`);
  expect(out.error, `${name} builds on this host: cargo build --locked --bin ${name}`).toBe('');
  return out.bin;
}
afterAll(() => { if (binsDir) rmSync(binsDir, { recursive: true, force: true }); binsDir = ''; built.clear(); });

// ---------------------------------------------------------------------------------------------------
// Programs: WebAssembly text assembled by #544's assembler (../544/wat, outside the workspace), in its own target.

export interface Program { name: string; bytes: Buffer; sha: string; b64: string }
const WAT_DIR = join(REPO, 'tests', 'acceptance', '544', 'wat');
const WAT_TARGET = join(TARGET, 'acceptance-542-wat');
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
  const dir = mkdtempSync(join(tmpdir(), 'deep-542-wat-'));
  try {
    const file = join(dir, `${name}.wat`);
    writeFileSync(file, text);
    const run = spawnSync(assembler(), [dir, file], { encoding: 'utf8', maxBuffer: 64 * MIB });
    if (run.status !== 0) throw Error(`the assembler refused ${name}: ${run.stderr.slice(-2000)}`);
    const bytes = readFileSync(join(dir, `${name}.wasm`));
    const p = { name, bytes, sha: sha256(bytes), b64: bytes.toString('base64') };
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
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-542-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line on stdin, one answer `{ok, replies}`.

/** The scenario's `planted` values this suite adds to deep-show (README: Planted twins). */
export type ShowPlanted = 'text_normalizes_nfc' | 'wheel_to_list_everywhere' | 'text_commits_on_ime_confirm' | 'scroll_tail_survives_keys';
export const SESSION = 'sess-542';
const SESSIONS: JsonObject = { [SESSION]: { thread: 'thread-542', name: 'Claude Code: game input', process: { pid: 4200, start: 1_000 } } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 4200, ppid: 1, start: 1_000 }];
/** Document IDs the hub minted (26 Crockford characters). */
export const DOC = (n: number): string => `01JB542D${String(n).padStart(18, '0')}`;
export type Rect = [number, number, number, number];
export type Pt = [number, number];

export interface ScenarioOptions { planted?: ShowPlanted; rect?: Rect; window?: [number, number] }
/**
 * A scenario: the agent's session, the process table, each document in a visible panel of its own (`rect`, by default
 * the 480 × 240 px panel that shows the fixtures' 480 × 240 u page at 1 px a u), the scope's virtual clock and a display,
 * the app's window when asked (for `screen`), `planted` when given, and the calls.
 */
export function scenario(evidence: string, docs: string[], calls: JsonObject[], o: ScenarioOptions = {}): JsonObject {
  const panels: JsonObject = {};
  const docMap: JsonObject = {};
  docs.forEach((d, i) => { panels[`p${i + 1}`] = { rect: o.rect ?? [0, 0, 480, 240] }; docMap[d] = { panel: `p${i + 1}` }; });
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

/** The agent's `deep_show` of a whole document (#393), with its issues. */
export const showCall = (doc: string, document: JsonObject, at: number): JsonObject =>
  ({ call: 'deep_show', session: SESSION, doc, document, include: ['issues'], at });
/** A `deep_show` reply that presented its document, with no error; the message lists the issues when it didn't. */
export function presented(reply: JsonObject, what: string): void {
  const issues = Array.isArray(reply['issues']) ? reply['issues'].filter(isObject) : [];
  expect(reply['outcome'], `${what} is presented: ${show(reply['issues'] ?? reply, 2500)}`).toBe('presented');
  expect(issues.filter((i) => i['severity'] === 'error'), `${what} is presented with no error`).toEqual([]);
}

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
/** Two cameras are the same: target and view width equal within 1e-9 of their size. */
export const sameCamera = (a: View, b: View): boolean =>
  Math.abs(a.width - b.width) <= 1e-9 * Math.max(1, Math.abs(a.width)) && a.target.length === b.target.length && a.target.every((x, i) => Math.abs(x - b.target[i]!) <= 1e-9 * Math.max(1, Math.abs(x)));
export const cameraText = (v: View): string => `{target ${show(v.target.map((x) => +x.toFixed(6)))}, view width ${+v.width.toFixed(6)}}`;

/** A scroll event's fields (README: Events): `delta` in px, or in lines with `unit: "line"`; `momentum` marks the tail. */
export interface Scroll { phase: 'begin' | 'change' | 'end'; pos: Pt; delta: Pt; unit?: 'line'; momentum?: true }

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
  /** A key press (#383's `key`, with `mods` such as `["cmd"]`). */
  key(key: string, mods: string[] = []): number { return this.input({ type: 'key', key, ...(mods.length ? { mods } : {}) }, 100); }
  /** Text typed into the focused field (#383's `text`). */
  text(text: string): number { return this.input({ type: 'text', text }, 100); }
  /** README: a paste of `text` into the focused field. */
  paste(text: string): number { return this.input({ type: 'paste', text }, 100); }
  /** README: the input seam's test backend's input method, its marked text (the composition) now `marked`. */
  ime(marked: string): number { return this.input({ type: 'ime', marked }, 100); }
  /** README: one scroll event, 16 ms after the call before (#383's gestures' pace). */
  scroll(s: Scroll, gapMs = 16): number {
    return this.input({ type: 'scroll', phase: s.phase, pos: s.pos, delta: s.delta, ...(s.unit ? { unit: s.unit } : {}), ...(s.momentum ? { momentum: true } : {}) }, gapMs);
  }
  /** One wheel line at `pos`: `n` lines down (a positive n) or up. */
  wheel(pos: Pt, n = 1): number { return this.scroll({ phase: 'change', pos, delta: [0, n], unit: 'line' }, 100); }
  see(): number { return this.add({ call: 'see', panel: this.panel }, 50); }
  /** `read` (#504): the saved document's hash. */
  read(doc: string): number { return this.add({ call: 'read', doc }, 50); }
  revisions(doc: string): number { return this.add({ call: 'revisions', doc }, 50); }
  /** `eval` at `t` flicks with a render-back snapshot (#387): the document's own frame, the frame a golden records. */
  eval(doc: string, t: number): number { return this.add({ call: 'eval', doc, t, pixels: true }, 50); }
  /** #539's `logic`: the document's logic items stepped 0 to `steps` − 1 on its input track. */
  logic(doc: string, steps: number): number { return this.add({ call: 'logic', doc, steps }, 50); }
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
/** The Tab stop with focus (#539's `state.focus`): a control's own ID, or null. */
export const focusOf = (reply: JsonObject, what: string): string | null => {
  const f = stateOf(reply, what)['focus'];
  return f === null || f === undefined ? null : str(f, `${what}: state.focus`);
};
/** The entries an input appended to the document's input track (`input`'s `appended`, #504). */
export function appendedOf(reply: JsonObject, what: string): JsonObject[] {
  return arr(reply['appended'], `${what}: appended (${show(reply, 600)})`).map((e, i) => obj(e, `${what}: appended[${i}]`));
}
/** The entries' brief form, for messages; a text value is shown with its bytes. */
export const entriesText = (list: JsonObject[]): string => show(list.map((e) => ({
  control: e['control'] ?? null, t: e['t'] ?? null, writer: e['writer'] ?? null,
  value: typeof e['value'] === 'string' ? `${JSON.stringify(e['value']).slice(0, 80)} (${Buffer.byteLength(e['value'], 'utf8')} B)` : e['value'] ?? null,
})), 900);
/** An entry named in a message: its control and stamp. */
export const entryName = (e: JsonObject): string => `{control: ${String(e['control'])}, t: ${String(e['t'])}}`;

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

/** `logic` (#539's README): each step's arrays per logic item, and the track it read. */
export interface LogicStep { step: number; arrays: Record<string, JsonValue[]> }
export interface LogicRun { steps: LogicStep[]; track: JsonObject[] }
export function logicOf(reply: JsonObject, what: string): LogicRun {
  expect(reply['code'], `${what}: the logic call answers, not refuses: ${show(reply, 1500)}`).toBeUndefined();
  const steps = arr(reply['steps'], `${what}: steps`).map((s, i): LogicStep => {
    const o = obj(s, `${what}: steps[${i}]`);
    const arrays = obj(o['arrays'], `${what}: steps[${i}].arrays`);
    return { step: num(o['step'], `${what}: steps[${i}].step`), arrays: Object.fromEntries(Object.entries(arrays).map(([k, v]) => [k, arr(v, `${what}: steps[${i}].arrays.${k}`)])) };
  });
  const track = arr(reply['track'], `${what}: track`).map((e, i) => obj(e, `${what}: track[${i}]`));
  return { steps, track };
}
/** An i32 array of a step as numbers, or null. */
export function ints(run: { steps: { step: number; arrays: Record<string, JsonValue[]> }[] }, k: number, name: string): number[] | null {
  const a = run.steps.find((s) => s.step === k)?.arrays[name];
  return Array.isArray(a) && a.every((v) => typeof v === 'number') ? (a as number[]) : null;
}

// ---------------------------------------------------------------------------------------------------
// `deep-input input` (#308): one session of the input module per line in, one answer per line out.

/** The `planted` values this suite adds to deep-input (README: Planted twins). */
export type InputPlanted = 'scroll_rounds_each_frame' | 'scroll_snaps_to_nearest';
export interface InputRun { hash: string; track: JsonObject[]; results: JsonObject[] }
/** One session per frame rate, all in one `deep-input input` process; each answer ok, with its hash, track and results. */
export function runInput(doc: JsonObject, viewport: [number, number], fps: number[], ops: JsonObject[], what: string, planted?: InputPlanted): InputRun[] {
  const lines = fps.map((f) => ({ doc, viewport, fps: [f, 1], ...(planted ? { planted } : {}), ops }));
  const tag = `${what}${planted ? ` (planted ${planted})` : ''}`;
  const r = spawnSync(binOf('deep-input'), ['input'], { cwd: REPO, input: `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 256 * MIB, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  expect(r.status, `${tag}: deep-input input exits 0; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const out = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(out.length, `${tag}: one answer per session`).toBe(lines.length);
  return out.map((l, i) => {
    let parsed: JsonValue;
    try { parsed = JSON.parse(l) as JsonValue; } catch { parsed = l; }
    const a = obj(parsed, `${tag} at ${fps[i]} fps: the answer`);
    expect(a['ok'], `${tag} at ${fps[i]} fps: deep-input plays the session (ok: true): ${show(a, 800)}`).toBe(true);
    return {
      hash: str(a['hash'], `${tag} at ${fps[i]} fps: hash`),
      track: arr(a['track'], `${tag} at ${fps[i]} fps: track`).map((e, j) => obj(e, `${tag}: track[${j}]`)),
      results: arr(a['results'], `${tag} at ${fps[i]} fps: results`).map((e, j) => obj(e, `${tag}: results[${j}]`)),
    };
  });
}

// ---------------------------------------------------------------------------------------------------
// `deep-logic` (#531, #534): JSON lines in, one reply per line out, in order, exit 0.

export function runLogic(calls: JsonObject[], what: string): JsonObject[] {
  const r = spawnSync(binOf('deep-logic'), [], { cwd: REPO, input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 2048 * MIB, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  expect(r.status, `${what}: deep-logic exits 0; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const out = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(out.length, `${what}: one reply per call (stdout: ${(r.stdout ?? '').slice(0, 600)})`).toBe(calls.length);
  return out.map((l, i) => {
    let parsed: JsonValue;
    try { parsed = JSON.parse(l) as JsonValue; } catch { parsed = l; }
    return obj(parsed, `${what}: reply ${i}`);
  });
}
export interface Checkpoint { step: number; deep_hash: string }
export interface StepRow { step: number; row: string; arrays: Record<string, JsonValue[]> }
/** A `bake` or `open_save` reply's steps (each step's item hashes and arrays as one comparable row) and checkpoints. */
export function stepsAndCheckpoints(reply: JsonObject, what: string): { steps: StepRow[]; checkpoints: Record<string, Checkpoint[]> } {
  const steps = arr(reply['steps'], `${what}: steps`).map((s, i) => {
    const o = obj(s, `${what}: steps[${i}]`);
    const items = obj(o['items'], `${what}: steps[${i}].items`);
    const arrays = obj(o['arrays'] ?? {}, `${what}: steps[${i}].arrays`);
    const hashes = Object.entries(items).sort().map(([id, x]) => [id, isObject(x) ? x['hash'] ?? null : null]);
    return { step: num(o['step'], `${what}: steps[${i}].step`), row: JSON.stringify([hashes, Object.entries(arrays).sort()]), arrays: arrays as Record<string, JsonValue[]> };
  });
  const checkpoints = Object.fromEntries(Object.entries(obj(reply['checkpoints'] ?? {}, `${what}: checkpoints`)).map(([id, list]) => [id, arr(list, `${what}: checkpoints.${id}`).map((c, i) => {
    const o = obj(c, `${what}: checkpoints.${id}[${i}]`);
    return { step: num(o['step'], `${what}: checkpoints.${id}[${i}].step`), deep_hash: str(o['deep_hash'], `${what}: checkpoints.${id}[${i}].deep_hash`) };
  })]));
  return { steps, checkpoints };
}

// ---------------------------------------------------------------------------------------------------
// Pixels

/** Re-encodes a decoded picture so the same pixels always give the same bytes (criterion 10's files). */
export const pngBytes = (im: Image): Buffer => encodeRgbaPng(im.width, im.height, (x, y) => {
  const o = (y * im.width + x) * 4;
  return [im.rgba[o]!, im.rgba[o + 1]!, im.rgba[o + 2]!, im.rgba[o + 3]!];
});
