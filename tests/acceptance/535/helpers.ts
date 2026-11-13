// Test-side tools for the #535 acceptance tests (README: The surface under test). They build `deep-show` (the full set,
// and the full set without the logic module), assemble this suite's programs with #544's assembler (../544/wat, read
// only), keep an evidence store, drive `deep-show run` (one JSON scenario on stdin, one answer line, as #393, #397, #421,
// #383 and #544 drive it) and read its replies and the PNGs it stores. PNG reading and writing come from ../467/helpers.ts
// by import, as #1653's suite takes them. Nothing here stands in for the logic module, the column view, the data module,
// the renderer, the spatial index or the interaction scope: every frame, hash, count, issue, bound and selection read here
// is the implementation's own; the expected values come from the issue's text and this suite's programs.

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
/** The checkout root (tests/acceptance/535 is three levels down). */
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

/** The builds' timeout (a first build of deep-show takes many minutes); each test passes its own. */
export const BUILD_TIMEOUT = 3_600_000;
export const TIMEOUT = 1_800_000;

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: 'AC1 #535.ae486076',
  2: 'AC2 #535.098d9861',
  3: 'AC3 #535.341f5d9a',
  4: 'AC4 #535.b9829532',
  5: 'AC5 #535.0f8922c0',
  6: 'AC6 #535.6cb0e483',
  7: 'AC7 #535.d39cd14c',
} as const;

/** A host or tool this machine lacks: the test fails with this message, never passes (invariant 2). */
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}; this is not a pass`); };

// ---------------------------------------------------------------------------------------------------
// Time: 705,600,000 flicks a second; a 60 Hz step and a 60 fps frame are 11,760,000.

export const FLICKS = 705_600_000;
export const STEP = FLICKS / 60;
/** Step k's time in flicks. */
export const at = (k: number): number => k * STEP;
/** A time in flicks as seconds to the millisecond, for messages. */
export const sOf = (t: number): string => `${(t / FLICKS).toFixed(3)} s`;

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
/** Runs `make` once per file, the first time a test asks (the files' tests share one run of a scenario). */
export function once<T>(make: () => T): () => T {
  let done: { value: T } | null = null;
  return () => (done ??= { value: make() }).value;
}

// ---------------------------------------------------------------------------------------------------
// Builds: `cargo build --locked --bin deep-show`, with the build's features, once per file, copied out of the target.

/** `full`: the default build set. `no-logic`: the full set without the logic module (#403's `test-leave-out-logic`). */
export type Build = 'full' | 'no-logic';
const FEATURES: Record<Build, string[]> = { full: [], 'no-logic': ['test-leave-out-logic'] };
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);

function cargo(args: string[], cwd: string, env: NodeJS.ProcessEnv): string {
  const run = spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { ...process.env, ...CARGO_ENV, ...env } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Updating|Locking|was not used|^warning|^\s*(\||=|-->)|^\s*\d+ \|/.test(l)).join('\n').slice(-4000)}`;
  return '';
}

let binsDir = '';
const built = new Map<Build, { bin: string; error: string }>();
function build(b: Build): { bin: string; error: string } {
  const known = built.get(b);
  if (known) return known;
  if (!binsDir) binsDir = mkdtempSync(join(tmpdir(), 'deep-535-bins-'));
  const bin = join(binsDir, exe(`deep-show-${b}`));
  const features = FEATURES[b];
  const error = cargo(['build', '--locked', '--bin', 'deep-show', ...(features.length ? ['--features', features.join(',')] : [])], REPO, {});
  if (error === '') copyFileSync(join(TARGET, 'debug', exe('deep-show')), bin);
  const out = { bin, error };
  built.set(b, out);
  return out;
}
/** Builds before a file's tests (the slow part), so each test's own time is its own. */
export function prebuild(list: Build[]): void {
  beforeAll(() => { for (const b of list) build(b); }, BUILD_TIMEOUT);
}
/** The built binary; a test that uses a build that failed fails, naming cargo's error. */
export function binOf(b: Build = 'full'): string {
  const out = build(b);
  expect(out.error, `deep-show (${b}) builds on this host`).toBe('');
  return out.bin;
}
afterAll(() => { if (binsDir) rmSync(binsDir, { recursive: true, force: true }); binsDir = ''; built.clear(); });

// ---------------------------------------------------------------------------------------------------
// Programs: WebAssembly text assembled by #544's assembler (../544/wat, the `wat` crate, outside the workspace), built
// here into its own target folder.

export interface Program { name: string; bytes: Buffer; sha: string }
const WAT_DIR = join(REPO, 'tests', 'acceptance', '544', 'wat');
const WAT_TARGET = join(TARGET, 'acceptance-535-wat');
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
  const dir = mkdtempSync(join(tmpdir(), 'deep-535-wat-'));
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
// The evidence store (#15's layout: `<2 hex>/<62 hex>`, each file named by its bytes' SHA-256), one per test.

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
/** A PNG the evidence store holds, decoded. */
export const pngOf = (evidence: string, h: string, what: string): Image => decodePng(getEvidence(evidence, h, what));
/** A fresh folder per call, deleted after the test. */
export function useTemp(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-535-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line on stdin, one answer `{ok, replies}`.

/** The scenario's `planted` values this suite adds (README: Planted twins). */
export type Planted = 'hand_over_drops_last_range' | 'narrowing_wraps' | 'dead_rows_hidden_from_drawing_only' | 'keeps_rows_across_seek' | 'turns_about_corner';
export const SESSION = 'sess-535';
const SESSIONS: JsonObject = { [SESSION]: { thread: 'thread-535', name: 'Claude Code: game state', process: { pid: 4100, start: 1_000 } } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 4100, ppid: 1, start: 1_000 }];
/** Document IDs the hub minted (26 Crockford characters). */
export const DOC = (n: number): string => `01JB535D${String(n).padStart(18, '0')}`;
export type Rect = [number, number, number, number];

/** The interaction scope's virtual clock (#383's): 120 Hz, the latch 2 ms before vsync, 0.5 ms of the checker. */
export const MS = FLICKS / 1000;
export const PERIOD = FLICKS / 120;
const CLOCK: JsonObject = { refresh_hz: 120, lead: 2 * MS, check: MS / 2 };
const DISPLAY: [number, number] = [1600, 900];

export interface ScenarioOptions { planted?: Planted; clock?: boolean; rect?: Rect }
/** A scenario: the agent's session, the process table, each document in a visible panel of its own (`rect`, 800 × 600 by
 * default), the scope's clock when asked, `planted` when given, and the calls. */
export function scenario(evidence: string, docs: string[], calls: JsonObject[], o: ScenarioOptions = {}): JsonObject {
  const panels: JsonObject = {};
  const docMap: JsonObject = {};
  docs.forEach((d, i) => { panels[`p${i + 1}`] = { rect: o.rect ?? [0, 0, 800, 600] }; docMap[d] = { panel: `p${i + 1}` }; });
  return {
    evidence, sessions: SESSIONS, processes: PROCESSES, panels, docs: docMap,
    ...(o.clock ? { clock: CLOCK, display: DISPLAY } : {}), ...(o.planted ? { planted: o.planted } : {}), calls,
  };
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

export interface ShowOptions { pixels?: boolean; size?: [number, number]; at?: number }
/** The agent's `deep_show` of a whole document (#393), with its issues and, with `pixels`, a snapshot and `batches`. */
export const showCall = (doc: string, document: JsonObject, o: ShowOptions = {}): JsonObject => ({
  call: 'deep_show', session: SESSION, doc, document, include: o.pixels ? ['issues', 'pixels'] : ['issues'],
  ...(o.size ? { size: o.size } : {}), ...(o.at !== undefined ? { at: o.at } : {}),
});
/** A `deep_show` reply that presented its document: the message lists the issues when it didn't. */
export function presented(reply: JsonObject, what: string): void {
  expect(reply['outcome'], `${what} is presented: ${show(reply['issues'] ?? reply, 2500)}`).toBe('presented');
}
/** `eval` at `t` flicks on the document's live session (#387), with a render-back snapshot. */
export const evalCall = (doc: string, t: number): JsonObject => ({ call: 'eval', doc, t, pixels: true });
/** `frames` (#387, #856): `count` frames of the live session one 60 fps frame apart from `from` (a time literal; 0 when
 * absent), with each frame's pixel hash when `pixels`. */
export const framesCall = (doc: string, count: number, o: { from?: string; pixels?: boolean } = {}): JsonObject =>
  ({ call: 'frames', doc, count, step: '1f', ...(o.from ? { from: o.from } : {}), pixels: o.pixels ?? false });
/** `determinism` (#488, #1897): each time played (every 60 Hz display frame from 0, warm) and seeked (a fresh session one
 * second later, then back), on this machine. */
export const determinismCall = (doc: string, times: number[]): JsonObject => ({ call: 'determinism', doc, display_hz: 60, at_times: times, compare: 'same_machine' });

/** An `eval` reply's one snapshot's SHA-256 (a PNG in the evidence store). */
export function snapshotOf(reply: JsonObject, what: string): string {
  expect(reply['outcome'], `${what} is evaluated: ${show(reply, 1500)}`).toBe('evaluated');
  const snaps = arr(reply['snapshots'], `${what}: snapshots`);
  expect(snaps.length, `${what}: one snapshot`).toBe(1);
  return str(obj(snaps[0], `${what}: snapshots[0]`)['sha256'], `${what}: snapshots[0].sha256`);
}
/** A `deep_show` reply's snapshot (the first: Vello CPU's) SHA-256. */
export function shownSnapshot(reply: JsonObject, what: string): string {
  const snaps = arr(reply['snapshots'], `${what}: snapshots`);
  expect(snaps.length, `${what}: a snapshot`).toBeGreaterThan(0);
  return str(obj(snaps[0], `${what}: snapshots[0]`)['sha256'], `${what}: snapshots[0].sha256`);
}
/** A `frames` reply's frames. */
export function framesOf(reply: JsonObject, count: number, what: string): JsonObject[] {
  const list = arr(reply['frames'], `${what}: frames (${show(reply, 600)})`).map((f, i) => obj(f, `${what}: frames[${i}]`));
  expect(list.length, `${what}: one entry per frame asked`).toBe(count);
  return list;
}
/** Every issue of a reply, as objects. */
export function issuesOf(reply: JsonObject): JsonObject[] {
  const list = reply['issues'];
  return Array.isArray(list) ? list.filter(isObject) : [];
}
/** An issue's own fields as text, without its prose (`what`, `fix`) or its close names: what it names. */
export const namedIn = (issue: JsonObject): string => { const { what: _w, fix: _f, close: _c, ...rest } = issue; return JSON.stringify(rest); };
/** `word` stands as a whole name in `text`. */
export const names = (text: string, word: string): boolean => new RegExp(`(^|[^A-Za-z0-9_])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9_]|$)`).test(text);
/** The issue names item `id`: its `ids` hold it, or its `path` is `items/<id>` or under it. */
export function namesItem(issue: JsonObject, id: string): boolean {
  const ids = Array.isArray(issue['ids']) ? issue['ids'].map(String) : [];
  const path = typeof issue['path'] === 'string' ? issue['path'] : '';
  return ids.includes(id) || path === `items/${id}` || path.startsWith(`items/${id}/`);
}

// ---------------------------------------------------------------------------------------------------
// Pixels

export type Rgb = [number, number, number];
export const pixel = (im: Image, x: number, y: number): Rgb => {
  const o = (y * im.width + x) * 4;
  return [im.rgba[o]!, im.rgba[o + 1]!, im.rgba[o + 2]!];
};
/** Within `tol` codes on every channel. */
export const near = (a: Rgb, b: Rgb, tol = 3): boolean => a.every((v, i) => Math.abs(v - b[i]!) <= tol);
/** The SHA-256 of a region's RGBA bytes, row by row: [x, y, w, h] in device px. */
export function regionHash(im: Image, [x0, y0, w, h]: Rect): string {
  const rows: Buffer[] = [];
  for (let y = y0; y < y0 + h; y++) rows.push(Buffer.from(im.rgba.subarray((y * im.width + x0) * 4, (y * im.width + x0 + w) * 4)));
  return sha256(Buffer.concat(rows));
}
/** Re-encodes a decoded picture so the same pixels always give the same bytes (AC7's files). */
export const pngBytes = (im: Image): Buffer => encodeRgbaPng(im.width, im.height, (x, y) => {
  const o = (y * im.width + x) * 4;
  return [im.rgba[o]!, im.rgba[o + 1]!, im.rgba[o + 2]!, im.rgba[o + 3]!];
});
