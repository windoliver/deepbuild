// Test-side tools for the #538 acceptance tests (README: The surface under test). They build `deep-show` (the full set,
// the full set without the logic module, and that build with the planted data module) and, for the budgets, `deep-gpu`;
// assemble this suite's programs with #544's assembler (../544/wat, read only); keep evidence stores; drive `deep-show run`
// (one JSON scenario on stdin, one answer line, as #393, #535 and #1967 drive it) and read its replies and the PNGs it
// stores. PNG reading and writing come from ../467/helpers.ts by import. Nothing here stands in for the logic module, the
// column view, the cells, text or marks2d modules, or the renderer: every cell, frame, hash, issue and timing read here is
// the implementation's own; every expected value comes from the issue's text and this suite's programs.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import { decodePng, encodeRgbaPng, type Image } from '../467/helpers.ts';

export { decodePng, encodeRgbaPng, type Image };
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/538 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** rustup's cargo on this Mac (Homebrew's rustup keeps it off the default PATH); rust-toolchain.toml picks the release. */
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` } : {}),
};
const MIB = 1024 * 1024;

/** The builds' timeout (a first build takes many minutes on a loaded machine); each test passes its own. */
export const BUILD_TIMEOUT = 7_200_000;
export const TIMEOUT = 3_600_000;

/** Each criterion's ID (scripts/proof-change.mjs's `criterionId` of each criterion's text). */
export const AC = {
  1: 'AC1 #538.798488ed',
  2: 'AC2 #538.04486d9f',
  3: 'AC3 #538.d7b350a3',
  4: 'AC4 #538.5538b44f',
  5: 'AC5 #538.c737d5fc',
  6: 'AC6 #538.8cc15bf5',
  7: 'AC7 #538.4b946374',
  8: 'AC8 #538.ed6f8052',
  9: 'AC9 #538.304491be',
} as const;

/** A machine or tool that can't run a reading fails with this, never passes (invariant 2). */
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}; this is not a pass`); };
export const inconclusive = (why: string): never => expect.fail(`INCONCLUSIVE: ${why}; this is not a pass`);

// ---------------------------------------------------------------------------------------------------
// Time: 705,600,000 flicks a second; a 60 Hz step and a 60 fps frame are 11,760,000. A frame at step k's time reads the
// arrays as step k left them (Logic `logic@1`).

export const FLICKS = 705_600_000;
export const STEP = FLICKS / 60;
/** Step k's time in flicks. */
export const at = (k: number): number => k * STEP;

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

// ---------------------------------------------------------------------------------------------------
// Builds: `cargo build --locked --bin deep-show` with a build's features, and `--bin deep-gpu`, once per file, copied
// out of the target folder.

/** `full`: the default set. `no-logic`: the full set without the logic module (#403's `test-leave-out-logic`).
 * `no-logic-reads`: that build with this suite's planted data module (README: Plants). `gpu`: deep-gpu. */
export type Build = 'full' | 'no-logic' | 'no-logic-reads' | 'gpu';
export const PLANTED_DATA_FEATURE = 'test-data-reads-logic-array';
const FEATURES: Record<Build, string[]> = { full: [], 'no-logic': ['test-leave-out-logic'], 'no-logic-reads': ['test-leave-out-logic', PLANTED_DATA_FEATURE], gpu: [] };
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const binName = (b: Build): string => (b === 'gpu' ? 'deep-gpu' : 'deep-show');

function cargo(args: string[], cwd: string, env: NodeJS.ProcessEnv): string {
  const run = spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { ...process.env, ...CARGO_ENV, ...env } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Updating|Locking|was not used|^warning|^\s*(\||=|-->)|^\s*\d+ \|/.test(l)).join('\n').slice(-4000)}`;
  return '';
}
/** Whether deep-show's manifest declares cargo feature `name` (a build that names an undeclared one can't start). */
export function declared(name: string): boolean {
  const manifest = readFileSync(join(REPO, 'crates', 'deep-show', 'Cargo.toml'), 'utf8');
  return new RegExp(`^${name.replace(/-/g, '\\-')}\\s*=`, 'm').test(manifest);
}
const buildArgs = (b: Build, release: boolean): string[] =>
  ['build', '--locked', ...(release ? ['--release'] : []), '--bin', binName(b), ...(FEATURES[b].length ? ['--features', FEATURES[b].join(',')] : [])];
export const buildCommand = (b: Build, release = false): string => `cargo ${buildArgs(b, release).join(' ')}`;

let binsDir = '';
const built = new Map<string, { bin: string; error: string }>();
function build(b: Build, release = false): { bin: string; error: string } {
  const tag = `${b}${release ? '-release' : ''}`;
  const known = built.get(tag);
  if (known) return known;
  if (!binsDir) binsDir = mkdtempSync(join(tmpdir(), 'deep-538-bins-'));
  const bin = join(binsDir, exe(`${binName(b)}-${tag}`));
  const missing = FEATURES[b].filter((f) => !declared(f));
  const error = missing.length
    ? `deep-show declares no cargo feature ${missing.join(', ')} (README: Plants), so \`${buildCommand(b, release)}\` can't build`
    : cargo(buildArgs(b, release), REPO, {});
  if (error === '') copyFileSync(join(TARGET, release ? 'release' : 'debug', exe(binName(b))), bin);
  const out = { bin, error };
  built.set(tag, out);
  return out;
}
/** Builds before a file's tests (the slow part), so each test's own time is its own. */
export function prebuild(list: Build[]): void {
  beforeAll(() => { for (const b of list) build(b); }, BUILD_TIMEOUT);
}
/** The built binary; a test that uses a build that failed fails, naming the reason. */
export function binOf(b: Build = 'full', release = false): string {
  const out = build(b, release);
  expect(out.error, `${binName(b)} (${b}${release ? ', release' : ''}) builds on this host: ${buildCommand(b, release)}`).toBe('');
  return out.bin;
}
afterAll(() => { if (binsDir) rmSync(binsDir, { recursive: true, force: true }); binsDir = ''; built.clear(); });

// ---------------------------------------------------------------------------------------------------
// Programs: WebAssembly text assembled by #544's assembler (../544/wat, outside the workspace), in its own target.

export interface Program { name: string; bytes: Buffer; sha: string }
const WAT_DIR = join(REPO, 'tests', 'acceptance', '544', 'wat');
const WAT_TARGET = join(TARGET, 'acceptance-538-wat');
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
  const dir = mkdtempSync(join(tmpdir(), 'deep-538-wat-'));
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
// Folders: an evidence store (#15's layout: `<2 hex>/<62 hex>`, each file named by its bytes' SHA-256), one per test.

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
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-538-')); made.push(d); return d; };
}
/** Writes `value` as JSON under `dir`; its path. */
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

// ---------------------------------------------------------------------------------------------------
// Ordered tables. A JavaScript object always lists integer-like keys in ascending order, so a copy table whose keys must
// be stored in another order (criterion 3: 4, 17, 9) is held here as its JSON text and spliced into the scenario's line
// in place of a placeholder string. Everything else is JSON.stringify's.

const RAW = new Map<string, string>();
/** A JSON object written with its entries in exactly this order; in a document, the returned placeholder stands for it. */
export function ordered(entries: [string, JsonValue][]): string {
  const text = `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',')}}`;
  const placeholder = `@@ordered-${sha256(text).slice(0, 16)}@@`;
  RAW.set(placeholder, text);
  return placeholder;
}
/** A scenario's line: its JSON with every ordered table in place. */
export function lineOf(sc: JsonObject): string {
  let line = JSON.stringify(sc);
  for (const [placeholder, text] of RAW) line = line.split(JSON.stringify(placeholder)).join(text);
  return line;
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line on stdin, one answer `{ok, replies}`.

/** The scenario's `planted` values this suite adds (README: Plants). */
export type Planted = 'grid_wraps_index' | 'plural_en_rule_for_fr' | 'copy_keeps_first_position' | 'labels_keep_first_locale' | 'flip_holds_last_child';
export const SESSION = 'sess-538';
const SESSIONS: JsonObject = { [SESSION]: { thread: 'thread-538', name: 'Claude Code: live game state in text and cells', process: { pid: 4100, start: 1_000 } } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 4100, ppid: 1, start: 1_000 }];
/** Document IDs the hub minted (26 Crockford characters). */
export const DOC = (n: number): string => `01JB538D${String(n).padStart(18, '0')}`;
export type Rect = [number, number, number, number];

/** A scenario: the agent's session, the process table, each document in a visible panel of its own, `planted` when
 * given, and the calls. */
export function scenario(evidence: string, docs: string[], calls: JsonObject[], planted?: Planted): JsonObject {
  const panels: JsonObject = {};
  const docMap: JsonObject = {};
  docs.forEach((d, i) => { panels[`p${i + 1}`] = { rect: [0, 0, 800, 600] }; docMap[d] = { panel: `p${i + 1}` }; });
  return { evidence, sessions: SESSIONS, processes: PROCESSES, panels, docs: docMap, ...(planted ? { planted } : {}), calls };
}
/** `deep-show run` on one scenario: exit 0, one answer line, ok, one reply per call, in call order. */
export function runShow(bin: string, sc: JsonObject, what: string): JsonObject[] {
  const tag = typeof sc['planted'] === 'string' ? `${what} (planted ${sc['planted']})` : what;
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${lineOf(sc)}\n`, encoding: 'utf8', maxBuffer: 2048 * MIB, timeout: TIMEOUT, killSignal: 'SIGKILL' });
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
/** #200's startup refusal: `{"ok": false, "code": "seal_refused", "reason", "modules", "operators", "arrays", "what"}`, exit 2. */
export interface SealRefusal { modules: string[]; arrays: string[]; what: string; raw: JsonObject }
export function sealRefusalOf(bin: string, sc: JsonObject, what: string): SealRefusal {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${lineOf(sc)}\n`, encoding: 'utf8', maxBuffer: 64 * MIB, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  const stdout = r.stdout ?? '';
  expect(r.status, `${what}: the startup exits 2 with the seal's refusal; stdout: ${stdout.slice(0, 800)}; stderr: ${(r.stderr ?? '').slice(-800)}`).toBe(2);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: the refusal is one line: ${stdout.slice(0, 800)}`).toBe(1);
  const raw = obj(JSON.parse(lines[0]!) as JsonValue, `${what}: the refusal`);
  expect([raw['ok'], raw['code']], `${what}: the line is the seal's refusal: ${show(raw)}`).toEqual([false, 'seal_refused']);
  const strings = (v: JsonValue | undefined): string[] => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))) : []);
  return { modules: strings(raw['modules']), arrays: strings(raw['arrays']), what: typeof raw['what'] === 'string' ? raw['what'] : '', raw };
}

export interface ShowOptions { pixels?: boolean; timing?: boolean; check?: boolean }
/** The agent's `deep_show` of a whole document (#393), with its issues, and with `pixels` a snapshot, with `timing` the
 * check's times, with `check` the check's result. */
export const showCall = (doc: string, document: JsonObject, o: ShowOptions = {}): JsonObject => ({
  call: 'deep_show', session: SESSION, doc, document,
  include: ['issues', ...(o.pixels ? ['pixels'] : []), ...(o.timing ? ['timing'] : [])], ...(o.check ? { check: true } : {}),
});
/** `eval` at `t` flicks on the document's live session (#387), in the view's `locale` when given, with a render-back
 * snapshot when `pixels`. */
export const evalCall = (doc: string, t: number, o: { locale?: string; pixels?: boolean } = {}): JsonObject =>
  ({ call: 'eval', doc, t, pixels: o.pixels ?? true, ...(o.locale ? { view: { locale: o.locale } } : {}) });
/** `frames` (#387, #535): `count` frames of the live session one 60 fps frame apart from `from` (a time literal), each
 * frame's pixel hash with `pixels`, the frame's timings (README: The budgets) with `timings`. */
export const framesCall = (doc: string, count: number, o: { from?: string; pixels?: boolean; timings?: boolean } = {}): JsonObject =>
  ({ call: 'frames', doc, count, step: '1f', ...(o.from ? { from: o.from } : {}), pixels: o.pixels ?? false, ...(o.timings ? { timings: true } : {}) });
/** `determinism` (#488, #1897, #1967): each time played (every 60 Hz display frame from 0) and seeked (a fresh session a
 * second later, then back), each side with its render and each cell grid it shows. */
export const determinismCall = (doc: string, times: number[]): JsonObject => ({ call: 'determinism', doc, display_hz: 60, at_times: times, compare: 'same_machine' });

/** A `deep_show` reply that presented its document. */
export function presented(reply: JsonObject, what: string): void {
  expect(reply['outcome'], `${what} is presented: ${show(reply['issues'] ?? reply, 2500)}`).toBe('presented');
}
/** An `eval` reply's one snapshot's SHA-256 (a PNG in the evidence store). */
export function snapshotOf(reply: JsonObject, what: string): string {
  expect(reply['outcome'], `${what} is evaluated: ${show(reply, 1500)}`).toBe('evaluated');
  const snaps = arr(reply['snapshots'], `${what}: snapshots`);
  expect(snaps.length, `${what}: one snapshot`).toBe(1);
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
export const errorsOf = (reply: JsonObject): JsonObject[] => issuesOf(reply).filter((i) => i['severity'] === 'error');
/** An issue's own fields as text, without its prose (`what`, `fix`) or its close names: what it names. */
export const namedIn = (issue: JsonObject): string => { const { what: _w, fix: _f, close: _c, ...rest } = issue; return JSON.stringify(rest); };
/** `word` stands as a whole name in `text` (a dot, a bracket or a slash may join it to others). */
export const names = (text: string, word: string): boolean => new RegExp(`(^|[^A-Za-z0-9_])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9_]|$)`).test(text);
/** The issue names item `id`: its `ids` hold it, or its `path` is `items/<id>` or under it. */
export function namesItem(issue: JsonObject, id: string): boolean {
  const ids = Array.isArray(issue['ids']) ? issue['ids'].map(String) : [];
  const path = typeof issue['path'] === 'string' ? issue['path'] : '';
  return ids.includes(id) || path === `items/${id}` || path.startsWith(`items/${id}/`);
}
/** An issue's own field: at its top level, as the base flattens a frame's issues (#535), or under `actual`. */
export function field(issue: JsonObject, name: string): JsonValue | undefined {
  if (name in issue) return issue[name];
  const actual = issue['actual'];
  return isObject(actual) ? actual[name] : undefined;
}
/** Every number in an issue's own fields (not its prose). */
export function numbersOf(v: JsonValue | undefined): number[] {
  if (typeof v === 'number') return [v];
  if (Array.isArray(v)) return v.flatMap(numbersOf);
  if (isObject(v)) return Object.entries(v).filter(([k]) => k !== 'what' && k !== 'fix' && k !== 'close').flatMap(([, x]) => numbersOf(x));
  return [];
}

// ---------------------------------------------------------------------------------------------------
// Pixels

export type Rgb = [number, number, number];
export const pixel = (im: Image, x: number, y: number): Rgb => {
  const o = (Math.floor(y) * im.width + Math.floor(x)) * 4;
  return [im.rgba[o]!, im.rgba[o + 1]!, im.rgba[o + 2]!];
};
/** The SHA-256 of a region's RGBA bytes, row by row: [x, y, w, h] in device px. */
export function regionHash(im: Image, [x0, y0, w, h]: Rect): string {
  const rows: Buffer[] = [];
  for (let y = y0; y < y0 + h; y++) rows.push(Buffer.from(im.rgba.subarray((y * im.width + x0) * 4, (y * im.width + x0 + w) * 4)));
  return sha256(Buffer.concat(rows));
}
/** The pixels in a region (the whole picture without one) that differ from the picture's top-left pixel, the ground no
 * item draws on: 0 when nothing is drawn there. */
export function inked(im: Image, region: Rect = [0, 0, im.width, im.height]): number {
  const ground = pixel(im, 0, 0);
  let n = 0;
  for (let y = region[1]; y < region[1] + region[3]; y++) {
    for (let x = region[0]; x < region[0] + region[2]; x++) {
      const p = pixel(im, x, y);
      if (p[0] !== ground[0] || p[1] !== ground[1] || p[2] !== ground[2]) n++;
    }
  }
  return n;
}
/** Re-encodes a decoded picture so the same pixels always give the same bytes (AC9's files). */
export const pngBytes = (im: Image): Buffer => encodeRgbaPng(im.width, im.height, (x, y) => {
  const o = (y * im.width + x) * 4;
  return [im.rgba[o]!, im.rgba[o + 1]!, im.rgba[o + 2]!, im.rgba[o + 3]!];
});

// ---------------------------------------------------------------------------------------------------
// Timing: the perf lane's rule, scripts/benchmark.mjs's judgeLimit and fingerprint imported, never copied (the reference
// Macs, mains power, Low Power Mode off, thermal state nominal, the load at each run's start and end under the cores).

export const load = (): number => loadavg()[0]!;
export async function judgeLimit(limit: number, runs: number[], loads: { start: number; end: number }[]): Promise<JsonObject> {
  const bench = (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as { fingerprint: () => JsonObject; judgeLimit: (o: unknown) => JsonObject };
  return bench.judgeLimit({ limit, runs, fingerprint: bench.fingerprint(), loads });
}
export async function validateBudgets(current: JsonObject, base: JsonObject): Promise<void> {
  const bench = (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as { validateBudgets: (c: unknown, b: unknown) => void };
  bench.validateBudgets(current, base);
}
export const median = (values: number[]): number => { const s = [...values].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]!; };
